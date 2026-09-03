# Proposal-only agent contract

PocketForge Relay's first agent boundary is deliberately provider-neutral and
proposal-only. It does not execute commands, write patches, approve workflows,
install APKs, merge branches, release, or deploy.

## Consent sequence

1. A caller selects a server-owned local job or Actions run by UUID and one
   fixed intent: failure explanation, repair plan, or verification plan.
2. The manager resolves that source itself and returns the exact bounded
   evidence preview: status, repository/ref, fixed failure data, the last 20
   redacted log excerpts, and up to 20 artifact names/digests.
3. No provider is called until the caller submits the preview UUID with the
   exact decision `approve`. The preview expires after five minutes by default
   and is consumed before the provider call, so it cannot be replayed.
4. Provider output must match the proposal schema. Unknown fields such as
   `command` or `patch`, absolute/escaping paths, unbounded text, and unknown
   step kinds fail closed.

The accepted result contains only a summary, diagnosis, bounded `inspect`,
`edit`, or `test` advice, risks, and verification suggestions. These are still
untrusted recommendations. A person must separately review and perform any
change through the existing bounded build, Actions, Android, and Git workflows.

## Authenticated HTTP contract

When a proposal manager is configured, the bearer-authenticated API exposes:

- `GET /api/agent` for enabled state and the adapter descriptor;
- `POST /api/agent/previews` with `sourceType`, server-owned `sourceId`, and a
  fixed `intent`; and
- `POST /api/agent/proposals` with the preview UUID and exact decision
  `approve`.

The default server has no provider adapter and returns `503` from proposal
creation routes. No provider call occurs during preview, and an approval is
single-use even when the provider fails.

## Adapter contract

An adapter supplies a lowercase identifier, semantic version, and one method:

```js
await adapter.propose({ intent, evidence, signal })
```

`evidence` is produced by the relay rather than accepted from the request.
`signal` is aborted on the configured timeout. Calls are bounded, never retried,
and provider errors are replaced with fixed public errors.

The conformance core, authenticated HTTP contract, and fake-adapter tests are
implemented. No production OpenAI, Anthropic, or other provider transport is
configured, no evidence was sent to an external model, and live model output
remains `NOT RUN`.

The mobile PWA exposes the same two-step contract in English, Korean, and
Japanese. It sends only a selected relay-owned source UUID and fixed intent to
create the preview, requires a checked disclosure consent before approval, and
renders accepted output with text-only DOM operations.
