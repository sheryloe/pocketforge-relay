# Roadmap

## v0.1 - Working orchestration spine (delivered)

- Mobile PWA, bearer authentication, bounded job queue, SSE logs, artifacts.
- Bundled demo and fixed Node.js, Gradle, and CMake presets.
- Contract-tested, disabled-by-default GitHub Actions and Android device-evidence
  adapters with authenticated APIs.
- English, Korean, and Japanese UI and maintained README editions.
- Security, protocol, architecture, and verification documentation.

Contract tests cover these paths, but live external Actions dispatch and physical
Android-device execution remain separate `NOT RUN` integration claims.

## v0.2 - Durable trust foundation (next)

- Versioned protocol schema and adapter contracts.
- Append-only event persistence and restart recovery.
- Rootless container runner, immutable evidence manifests, provenance, and
  tighter resource isolation.
- Gradle, npm, and CMake failure parsers.
- One reproducible pilot against a trusted external Node.js repository.

Exit evidence for v0.2 includes versioned compatibility fixtures, forced-restart
recovery tests, non-root/default-deny/resource-limit container checks, and a
sanitized pilot report recording a pinned commit, clean checkout, commands,
exit codes, and artifact digests.

## v0.3 - Human-governed agent loop (target)

- Provider-neutral agent adapter and conformance suite.
- Evidence-assisted issue triage, failure classification, and repair proposals.
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
