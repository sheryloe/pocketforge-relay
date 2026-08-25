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
- Evidence-assisted issue triage, failure classification, and repair proposals
  remain to be connected to the mobile UI and a configured provider.
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
