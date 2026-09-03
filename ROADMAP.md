# Roadmap

## v0.1 - Working orchestration spine (delivered)

- Mobile PWA, bearer authentication, bounded job queue, SSE logs, artifacts.
- Bundled demo and fixed Node.js, Gradle, and CMake presets.
- Contract-tested, disabled-by-default GitHub Actions and Android device-evidence
  adapters with authenticated APIs.
- English, Korean, and Japanese UI and maintained README editions.
- Restart-readable jobs in the mobile UI, verified recovered-artifact downloads,
  and explicit full deletion for one terminal job's retained data.
- Security, protocol, architecture, and verification documentation.

Contract tests cover both adapter paths. One allowlisted public Actions dispatch,
poll, log ZIP, and required artifact ZIP passed live on 2026-08-25; cancellation
remains `NOT RUN`. Physical Android-device execution also remains `NOT RUN`.

## v0.2 - Durable trust foundation (in progress)

- Versioned protocol schema and adapter contracts.
- Append-only event persistence, restart-readable audit history, authenticated
  current-state projection, and startup finalization of interrupted histories
  are implemented for local and Actions runs. Orphaned OS processes and remote
  Actions observations are never resumed or redispatched.
- An opt-in digest-pinned container boundary now wraps fixed preset steps with
  non-root execution, no network, read-only rootfs, dropped capabilities, and
  CPU/memory/PID/tmpfs limits. Real daemon execution remains `NOT RUN` here.
- Collection-time and pre-download SHA-256 verification, relay-owned local
  snapshots, and optional dedicated-key HMAC-SHA256 manifests are implemented.
  External build-service provenance remains planned.
- Fixed public diagnostics for common Gradle, npm, and CMake failures are
  implemented; fixture coverage should expand with sanitized pilot evidence.
- The dependency-free external `yocto-queue` pilot remains recorded. A second
  clean remote-clone self-pilot at commit `f19848e` exercised committed-lockfile
  `npm ci --ignore-scripts` and all 145 upstream tests successfully.

Exit evidence for v0.2 includes versioned compatibility fixtures, forced-restart
recovery tests, non-root/default-deny/resource-limit container checks, and a
sanitized pilot report recording a pinned commit, clean checkout, commands,
exit codes, and artifact digests.

The adapter descriptor, capability negotiation, versioned job-request envelope,
and versioned SSE payload slices are implemented as protocol version 1. The
documented legacy job request remains compatible.

## v0.3 - Human-governed agent loop (target)

- A provider-neutral proposal-only manager and conformance suite now enforce
  server-owned evidence previews, expiring one-shot consent, bounded output,
  fixed timeouts, and no execution. A production provider transport remains
  unconfigured and live model use is `NOT RUN`.
- Authenticated status, preview, and explicit-approval HTTP routes expose that
  contract when a manager is configured; the default server remains disabled.
- The EN/KO/JA mobile UI now implements evidence selection, exact disclosure
  preview, explicit consent, and text-only structured proposal rendering. A
  configured provider transport remains intentionally separate.
- Agent-assisted repair branches with explicit human approval.
- Signed user/device pairing, policy adapters, and approval before install,
  merge, release, or deploy.

AI assistance must not bypass allowlists, turn user text into shell commands, or
represent inferred success as executed verification. Model output remains
untrusted input. Source, logs, screenshots, or evidence may be sent to an
external AI provider only after explicit operator opt-in.

Exit evidence for v0.3 includes an agent-adapter conformance fixture,
proposal-only/no-side-effect tests, denial tests without external-provider
opt-in, and approval-gate tests for install, merge, release, and deploy.

Dates and scope are intentionally evidence-driven. Planned capabilities are not
represented as implemented until code and verification records exist.

## September 2026 release gates

This weekday plan starts after the ten-day candidate-preparation batch. A day
closes only when its evidence is recorded as `PASS`, `FAIL`, or `NOT RUN`.
Failed blocking gates stop publication; they do not trigger unrelated feature
work.

| Date | Gate | Completion evidence |
| --- | --- | --- |
| 2026-09-11 | Publish the reviewed candidate branch | The maintainer explicitly approves the exact public repository destination; the branch is pushed and the remote SHA matches local. |
| 2026-09-14 | PR and CI | One focused PR contains all candidate commits, Actions concludes successfully for the exact head SHA, review is resolved, the PR is merged, and local `main` is fast-forwarded. |
| 2026-09-15 | GitHub metadata | The public description begins with `An open`, the documented topics are present, the homepage decision is explicit, and license/issues/settings are re-read through the API. |
| 2026-09-16 | Remote clean checkout | A new clone of merged `origin/main` passes `npm ci --ignore-scripts`, `npm run check`, 164 tests or the then-current exact count, and clean status. |
| 2026-09-17 | Candidate mobile review | The Codex in-app browser, not Chrome automation, checks EN/KO/JA at 390 x 844, refresh persistence, overflow, focus, labels, contrast, touch targets, and console output; unavailable checks remain `NOT RUN`. |
| 2026-09-18 | Evidence reconciliation | Any defect found on September 17 receives a focused fix and regression test; otherwise no code is added. Verification and release checklist statements match executed evidence. |
| 2026-09-21 | Security release review | Arbitrary-command denial, environment allowlisting, redaction, limits, artifact containment, one-shot approvals, and non-persistent approval secrets are reviewed against tests and public docs. |
| 2026-09-22 | External integration decision | Decide whether prior live Actions evidence is sufficient for v0.1. Do not dispatch again, connect an AI provider, or access a private repository without a separate explicit approval. |
| 2026-09-23 | Container boundary decision | Run a real digest-pinned container only if a daemon and reviewed image are available; otherwise record `NOT RUN` without adding fallback code. |
| 2026-09-24 | Android boundary decision | Run SDK/device checks only with configured tools, an authorized device, and participant consent; otherwise retain every physical-device item as `NOT RUN`. |
| 2026-09-25 | Contributor surface | Re-read the live issue forms, security route, starter issues, and pilot instructions; record broken links or rendering as `FAIL` and fix only confirmed defects. |
| 2026-09-28 | Release decision | Audit sections 1-6 of the release checklist and list every exception. Choose release, hold, or reject from evidence; do not create a tag yet. |
| 2026-09-29 | Approved pre-release | Only after an explicit release approval, create annotated tag `v0.1.0` and the GitHub pre-release from the reviewed notes. Otherwise record `NOT RUN`. |
| 2026-09-30 | Publication verification | If published, download every release asset, verify its digest, confirm the immutable tag/SHA, close the candidate ledger, and plan the next evidence milestone. |

## v0.5 - Contributor ecosystem foundation (delivered)

- Bounded bug, pilot, adapter, and good-first-issue forms with private security
  routing and explicit trust/verification questions.
- Five real starter issues with independently testable acceptance criteria,
  linked from the maintained contribution guide and EN/KO/JA READMEs.
- Three evidence-focused pilot slots and a strict machine-verifiable report
  contract with two recorded clean-checkout reports.
- External contributors, downstream adapters, downloads, active installations,
  and response-time history remain unobserved; no adoption metric is inferred
  from these contribution paths.
