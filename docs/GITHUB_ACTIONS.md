# GitHub Actions Runner Adapter

PocketForge Relay's GitHub Actions adapter reuses an existing
`workflow_dispatch` workflow instead of cloning a repository and recreating CI
on the relay host. The adapter core is connected to an authenticated relay HTTP
API and the mobile review surface.

## Status

Implemented core:

- a versioned, bounded JSON allowlist of repositories, refs, workflows, fixed
  non-secret inputs, and required artifact names;
- an expiring, bounded, single-use mobile approval record;
- dispatch using the GitHub REST API version `2026-03-10`;
- direct observation of the `workflow_run_id` returned by dispatch;
- bounded run and job polling with ETag and rate-limit handling;
- cancellation limited to runs dispatched by the same adapter instance,
  completed-run logs, and workflow artifact downloads;
- download byte and file limits, SHA-256 calculation, partial-file cleanup, and
  ZIP preservation without extraction; pre-existing destination files are
  never replaced or deleted;
- a non-terminal `collecting_evidence` state after GitHub reports completion,
  so success is published only after required evidence has finalized;
- pre-download SHA-256 re-verification and an `X-Artifact-SHA256` response
  header for every retained Actions artifact;
- token removal before following temporary download redirects;
- disabled-by-default environment configuration, server-owned run workspaces,
  bounded concurrent in-memory run state, and graceful observation shutdown;
- authenticated target, approval, dispatch, status, cancellation, and artifact
  download routes whose public representations omit credentials and absolute
  filesystem paths.

Still not integrated:

- persistence across relay restarts;
- webhook observation;
- live cancellation, private-repository access, or self-hosted runners.

The allowlisted `pocketforge-evidence.yml` target was dispatched through the
relay on 2026-08-25. Run
[32813892748](https://github.com/sheryloe/pocketforge-relay/actions/runs/32813892748)
completed successfully; the relay collected the run log ZIP and required
`relay-evidence` ZIP and the downloaded artifact matched SHA-256
`9c0a259c9245689c1548bcd4bb2d41ff525f1dea51510db3a6abc464f6f3eb98`.

## Configuration contract

Use [`../config/actions-targets.example.json`](../config/actions-targets.example.json)
as the shape of the server-owned configuration. Each target fixes:

- one exact `https://github.com/owner/repository`;
- one workflow file name without a path;
- one or more exact allowed refs;
- zero or more fixed, non-secret workflow inputs;
- the exact names of artifacts required as evidence.

The workflow input `pocketforge_request_id` is reserved. The relay supplies it
from its job identifier. A target may define at most 24 other inputs so the
dispatch stays within GitHub's 25-input contract.

Set `POCKETFORGE_ACTIONS_TARGETS_FILE` to the catalog path and
`POCKETFORGE_GITHUB_TOKEN` to the credential. They must be configured together;
with both absent, the integration is disabled. Both values are server-only.
They are never returned by an API, put in a URL, copied into a local build
environment, or sent to the browser. Startup rejects an invalid, oversized, or
symbolic-link catalog before listening.

For a personal test installation, use an expiring fine-grained personal access
token restricted to the configured repository with `Actions: write`. For a
long-lived or multi-user installation, use a GitHub App installation token.
The adapter deliberately does not validate a token prefix or fixed length.

## Approval and execution contract

The HTTP integration has two separate operations:

1. `createApproval({ targetId, ref, label })` resolves an exact allowlist entry
   and returns an immutable preview. It does not contact GitHub.
2. `runApproved({ approvalId, decision: "approve", jobId, workspace })`
   atomically consumes that approval before dispatching.

Approvals expire after five minutes by default, are held only in memory, and
can be used once. The approval is an explicit confirmation against accidental
or replayed writes; it is not an additional authentication factor.

The integration must create the absolute per-job `workspace` itself. A client
must never choose a filesystem path.

## Authenticated HTTP contract

Every route below requires the relay bearer token. JSON request bodies are
limited to 16 KiB and reject fields outside the documented contract.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/actions/targets` | none | `{ enabled, targets }` |
| `POST /api/actions/approvals` | `{ targetId, ref, label? }` | `201 { approval }` |
| `POST /api/actions/runs` | `{ approvalId, decision: "approve" }` | `202 { run }` |
| `GET /api/actions/runs` | none | `{ runs }` |
| `GET /api/actions/runs/{id}` | none | `{ run }` |
| `POST /api/actions/runs/{id}/cancel` | empty object | `{ run }` |
| `GET /api/actions/runs/{id}/artifacts/{artifactId}` | none | ZIP download |

The server generates the run identifier and derives its workspace under
`POCKETFORGE_DATA_DIR/action-runs`; neither value can be supplied by the client.
Public run objects contain the allowlisted target identity, state, timestamps,
bounded logs, verified GitHub run URL and identifier, errors, and public
artifact metadata. They never contain the GitHub token, catalog path,
workspace, or artifact absolute path.

Cancellation also uses the target, ref, and remote run identifier already
bound to the server-side run record. The client cannot substitute an arbitrary
GitHub run ID. If a cancellation arrives before dispatch has produced a
verified run ID, local observation is aborted; an ambiguous dispatch remains
`needs_attention` rather than being represented as safely cancelled.

On shutdown, new approvals and runs are rejected, pending approvals are
discarded, active observations are aborted, and the server waits for their
local completion. Shutdown does not claim that an already-dispatched remote
workflow stopped; such a result remains `needs_attention` when its terminal
state was not observed.

Run states map as follows:

| GitHub state | PocketForge state |
| --- | --- |
| `requested`, `waiting`, `pending`, `queued` | `queued` |
| `in_progress` | `running` |
| completed with `success` | `succeeded` |
| completed with `cancelled` | `cancelled` |
| completed with failure-like conclusion | `failed` |
| unknown dispatch outcome, observation deadline, or missing success evidence | `needs_attention` |

`needs_attention` is intentional. If a dispatch connection fails or GitHub
returns a server error, the relay cannot know whether a run was created. A POST
is therefore never retried automatically. If the event observer fails after a
successful dispatch, the result retains the remote run ID and URL and also
becomes `needs_attention`; the consumed approval cannot be replayed.

Cancellation is available only while the same in-memory adapter instance owns
an active or not-yet-resolved `(target, run ID)` binding created by its own
successful dispatch. A caller cannot use an allowlisted repository plus an
arbitrary run ID to cancel someone else's workflow. The binding is removed once
the run is observed as terminal or cancellation is accepted.

## GitHub REST operations

Every API request sends:

```text
Accept: application/vnd.github+json
Authorization: Bearer <server-only-token>
X-GitHub-Api-Version: 2026-03-10
```

The adapter uses only these allowlisted operations:

```text
POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches
GET  /repos/{owner}/{repo}/actions/runs/{run_id}
GET  /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100
POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel
GET  /repos/{owner}/{repo}/actions/runs/{run_id}/logs
GET  /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts?per_page=100
GET  /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip
```

Version `2026-03-10` returns `workflow_run_id`, `run_url`, and `html_url` from
the dispatch call. The relay uses that run identifier directly and does not
guess which recent run belongs to a request.

GitHub's log and artifact endpoints return temporary HTTP redirects. The
adapter handles redirects manually, accepts only HTTPS URLs without embedded
credentials, and sends no GitHub authorization or API-version header to the
temporary storage host. Temporary transport errors do not expose the signed
download URL. Downloads use exclusive destination creation; a collision leaves
the existing file unchanged. ZIP files are not extracted.

If evidence collection fails after one or more ZIP files were downloaded, the
result becomes `needs_attention` for an otherwise successful run and explicitly
lists those already collected files as partial evidence. They are not left in
the workspace as unreported orphan files.

## Target workflow requirements

The configured workflow must exist on the repository's default branch and
accept `workflow_dispatch`. A typical workflow starts with:

```yaml
name: PocketForge Android
run-name: PocketForge ${{ inputs.pocketforge_request_id }}

on:
  workflow_dispatch:
    inputs:
      pocketforge_request_id:
        description: PocketForge audit identifier
        required: true
        type: string
      variant:
        description: Fixed build variant
        required: true
        type: choice
        options: [debug]
```

The workflow should upload the exact required artifact names configured in the
allowlist. Inputs and refs remain untrusted strings inside GitHub Actions. Do
not interpolate them directly into an inline shell script. Prefer a fixed
choice, an action input, or an intermediate environment variable with safe
quoting.

Allowlisted refs should be protected branches or protected tags. Someone who
can modify the workflow on an allowlisted ref can change the code the runner
executes, regardless of the relay's target allowlist.

## Verification

The unit tests use injected `fetch`, clocks, delays, and a fake adapter client.
They require no GitHub secret and verify:

- allowlist validation and exact ref resolution;
- approval-before-write, expiry, capacity, and single use;
- the pinned API version and dispatch response contract;
- no retry after ambiguous dispatch or cancellation;
- remote-run retention after observer failure and rejection of approval replay;
- cancellation ownership binding for exact adapter-created runs;
- bounded GET retry and polling metadata;
- token removal across download redirects and signed-URL error redaction;
- content-length and streamed-byte limits with partial-file cleanup and
  pre-existing destination preservation;
- state and step mapping;
- explicit partial-evidence reporting and ZIP-only storage.
- paired disabled-by-default configuration and startup catalog loading;
- authenticated HTTP routes, strict request fields, and the 16 KiB body bound;
- server-owned workspaces, public path/token omission, active-run capacity,
  cancellation, and graceful abort-and-wait shutdown.

Run:

```powershell
npm.cmd test
node --check src/action-targets.mjs
node --check src/github-actions-client.mjs
node --check src/github-actions-runner.mjs
```

Live public-repository dispatch, hosted-runner observation, and real log/artifact
redirects are recorded above. Cancellation, private-repository access, and
self-hosted runners remain `NOT RUN`.

## Official references

- [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event)
- [Workflow run endpoints](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2026-03-10)
- [Workflow job endpoints](https://docs.github.com/en/rest/actions/workflow-jobs?apiVersion=2026-03-10)
- [Workflow artifact endpoints](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10)
- [REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions?apiVersion=2026-03-10)
- [REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Keeping API credentials secure](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure)
- [Secure use of GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use)
