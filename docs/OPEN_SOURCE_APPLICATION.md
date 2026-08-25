# Open-source Program Application Brief

PocketForge Relay is an open-source, mobile-first control plane that lets maintainers start, observe, and verify build jobs from a phone while execution occurs on local, self-hosted, or cloud runners. Its long-term goal is a provider-neutral protocol connecting mobile clients, coding agents, isolated runners, artifacts, and real-device feedback.

AI support would be used to triage issues, reproduce failures, generate adapter conformance tests, review security-boundary changes, classify build logs, check documentation parity, draft release notes from verified changes, and help contributors navigate unfamiliar build ecosystems.

Before submitting an application, attach observed and dated evidence such as releases, downloads, active opt-in relay instances, external contributors, downstream adapters, merged PRs, resolved maintainer issues, security response history, and a demo of request → build → artifact → device verification. Never present projected metrics as observed metrics.

## Observed evidence

| Date | Evidence | Observed result | Source |
| --- | --- | --- | --- |
| 2026-08-13 | First merged feature PR | PR #1 was merged to `main` as commit `df32cf4` | [PR #1](https://github.com/sheryloe/pocketforge-relay/pull/1), [commit](https://github.com/sheryloe/pocketforge-relay/commit/df32cf4357437f90f0f9fac2969d58e8fc40fa36) |
| 2026-08-13 | GitHub-hosted CI | Dependency install, syntax checks, and the test job completed successfully | [Actions run 31662358775](https://github.com/sheryloe/pocketforge-relay/actions/runs/31662358775) |
| 2026-08-13 | Local automated verification | 111 tests passed and 0 failed on the merged candidate | [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-13 | Mobile-browser demonstration | EN/KO/JA switching, zero horizontal overflow, zero console errors, and three bundled-demo artifacts at 390 x 844 | [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-14 | v0.2 foundation candidate | Syntax checks passed; 122 tests passed and 0 failed with adapter-contract, durable-history, and failure-diagnostic coverage | [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-18 | Local artifact integrity candidate | Syntax checks passed; 123 tests passed and 0 failed with collection-time SHA-256 and authenticated download-header coverage | [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-19 | Local artifact download verification | Syntax checks passed; 124 tests passed and 0 failed with pre-download identity, metadata, and SHA-256 checks | [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-25 | Trust-foundation integration | PR #3 merged 18 focused commits after GitHub Actions passed; local regression passed 133 tests with immutable snapshots, manifests, and an observed pinned external pilot | [PR #3](https://github.com/sheryloe/pocketforge-relay/pull/3), [`VERIFICATION.md`](VERIFICATION.md) |
| 2026-08-25 | v0.2 completion candidate | Syntax checks and 139 tests passed locally with forced-restart finalization, protocol-v1 envelopes, and optional dedicated-key HMAC-SHA256 manifests | [`VERIFICATION.md`](VERIFICATION.md) |

These entries show repository maintenance and local/browser verification. They
do not establish downloads, active installations, external contributors, or
physical-device operation.

## Current gaps

- No GitHub release, download history, or active opt-in relay count exists yet.
- No external contributor or downstream adapter has been observed yet.
- A dependency-free pinned external Node.js syntax/FIFO pilot passed; its
  upstream dependency-based `npm test` remains `NOT RUN` because that revision
  has no lockfile.
- Physical Android installation, launch, logs, crash capture, and screenshots
  remain `NOT RUN`.
- Live dispatch, cancellation, and artifact collection through the optional
  GitHub Actions adapter remain `NOT RUN`.

## Next 30-day outcomes

These are goals, not observed metrics:

1. Complete one trusted public Node.js pilot from a pinned commit and clean
   checkout, recording commands, exit codes, artifact digests, and a sanitized
   `PASS`, `FAIL`, or `NOT RUN` report.
2. Publish v0.1 only after the release checklist records every applicable gate
   and limitation.
3. Open bounded contribution paths and seek at least one independently authored
   issue, fixture, documentation fix, or adapter proposal.
4. Keep the Android pilot slot closed until SDK/JDK and physical-device evidence
   is actually executed and recorded.
