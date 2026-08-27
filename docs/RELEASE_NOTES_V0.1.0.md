# PocketForge Relay v0.1.0: Orchestration Spine

Pre-release candidate notes. No tag or GitHub release has been created.

PocketForge Relay v0.1.0 provides a mobile-first, provider-neutral control
plane for the trusted repository `code -> build -> artifact -> verify` loop.
It runs allowlisted build presets in isolated per-job workspaces and exposes
bounded, authenticated state, logs, artifacts, and evidence through an
installable English, Korean, and Japanese PWA.

## Highlights

- Node.js, Android Gradle, CMake, and bundled zero-dependency demo presets
- protocol-v1 requests and SSE events with restart-readable job history
- relay-owned artifact snapshots with SHA-256 verification and optional HMAC
- disabled-by-default GitHub Actions and Android device-evidence adapters with
  explicit, expiring, one-shot approvals
- a disabled-by-default provider-neutral proposal agent that returns bounded,
  non-executable advice only after evidence preview and explicit approval
- English, Korean, and Japanese PWA and README coverage

## Executed evidence

- local syntax checks and 164 automated tests: `PASS`
- bundled demo build and artifact collection: `PASS`
- clean, commit-pinned external `yocto-queue` clone, dependency install, tests,
  and artifact digest: `PASS`
- one allowlisted live GitHub Actions dispatch, terminal observation, log and
  artifact collection, and SHA-256 re-download verification: `PASS`
- mobile PWA review at 390 x 844 in English, Korean, and Japanese: `PASS`

The immutable release-candidate commit and its clean-checkout rerun will be
recorded before publication.

## Known limitations

- The process runner is not a hardened sandbox. Use only trusted repositories
  and trusted networks.
- The opt-in container boundary is contract-tested, but real Docker daemon
  execution is `NOT RUN` in the recorded environment.
- Live GitHub Actions cancellation and private-repository access are `NOT RUN`.
- Real Android SDK/JDK builds, physical-device discovery, installation, launch,
  logs, crash capture, and screenshots are `NOT RUN`.
- The external AI provider path is `NOT RUN`; no source, logs, artifacts, or
  screenshots are sent to a model by default.
- Cross-device LAN access from a physical phone and real project-specific CMake
  toolchains are `NOT RUN`.

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

Detailed commands, run links, digests, and evidence boundaries are maintained
in [`VERIFICATION.md`](VERIFICATION.md).
