# Changelog

All notable changes to PocketForge Relay will be recorded in this file.
The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and intends to use [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once releases are published.

## [Unreleased]

### Added

- Authenticated protocol-v1 capability discovery with strict built-in adapter
  descriptors and explicit disabled states.
- Bounded append-only job event logs with authenticated history reads that
  remain available after relay restart.
- Mobile-first installable PWA for starting and observing allowlisted build jobs.
- Bearer-authenticated API, Server-Sent Events, per-job workspaces, and
  authenticated artifact downloads.
- Bounded waiting and completed-job retention with a bundled zero-dependency
  demonstration project.
- Node.js, Android Gradle, and CMake preset definitions.
- Optional, disabled-by-default GitHub Actions dispatch with exact target/ref
  allowlists, expiring one-shot approval, bounded observation, cancellation of
  adapter-owned runs, and authenticated ZIP evidence downloads.
- Optional, disabled-by-default Android device evidence with action-owned APK
  snapshots, exact device binding, one-shot approval, install/launch/log/crash/
  screenshot collection, authenticated evidence downloads, restart recovery,
  and explicit evidence deletion.
- English, Korean, and Japanese PWA catalogs with browser-language selection,
  an explicit selector, offline caching, and locale-only persistence.
- English, Korean, and Japanese README editions with automated structural and
  link-parity checks.
- Architecture, protocol, configuration, threat-model, contribution, and
  verification documentation.

### Security

- Strict validation for repository URLs, Git refs, configuration values, and
  artifact paths.
- Child-process environment allowlisting and defensive log-secret redaction.
- Admission limits, process cancellation, and graceful asynchronous shutdown.
- Windows SDK batch-wrapper metacharacter rejection and fixed-argument process
  invocation without accepting client-supplied commands.
- GitHub credential and signed-download URL redaction, server-owned workspaces,
  exclusive downloads, and cancellation ownership checks.
- Canonically contained APK snapshots outside job workspaces, SHA-256 and signer
  binding, opaque device identifiers, HMAC-authenticated evidence manifests,
  symlink rejection, and verification before every download or deletion.
- Android approval secrets held only in memory and a PWA consent step that
  discloses log, crash, and full-screen capture before device mutation.

### Verification boundary

- The bundled demonstration and automated test suite have local verification
  records in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).
- The Actions and Android core/API/PWA contracts are covered by local automated
  tests, but live GitHub dispatch and real Android execution remain separate
  integration claims.
- External GitHub cloning, live GitHub Actions dispatch/cancellation/download,
  a real Android SDK/JDK build, physical-device installation/launch, runtime log
  or crash capture, and screenshots are `NOT RUN` until each is recorded as
  `PASS` with dated evidence.
- The process runner is not a hardened sandbox and is limited to trusted
  repositories and trusted networks.

No Git tag or GitHub release is represented by this `Unreleased` section.
