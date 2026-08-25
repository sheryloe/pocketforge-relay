# Changelog

## 2026-08-26 - Actions evidence finalization

- Keep completed remote runs in `collecting_evidence` until required logs and
  artifacts finish collecting, then publish the true terminal state.
- Publish each retained Actions artifact SHA-256 and re-verify the file before
  download headers, rejecting post-collection changes with HTTP 409.

## 2026-08-25 - v0.5 contributor ecosystem foundation

- Publish five bounded starter issues with executable acceptance criteria.
- Strengthen adapter proposals around reuse, fixed contracts, approval points,
  conformance fixtures, and separate live evidence.
- Route suspected vulnerabilities to the private security policy and disable
  unstructured blank issues.
- Link the maintained starter backlog from CONTRIBUTING and every README locale
  without claiming external contributors or adoption.

## 2026-08-25 - v0.3 live hosted evidence

- Add a commit-pinned hosted evidence workflow and exact public-repository
  target catalog.
- Bound artifact-list rechecks after GitHub's observed post-completion
  publication lag without ever retrying dispatch.
- Complete live relay approval, dispatch, polling, log ZIP collection, required
  artifact ZIP collection, and SHA-256 re-download verification in run
  [32813892748](https://github.com/sheryloe/pocketforge-relay/actions/runs/32813892748).
- Keep live cancellation, private repositories, Android SDK, and physical
  devices explicit as `NOT RUN`.

## 2026-08-25 - v0.2 container boundary

- Add an opt-in, digest-pinned container wrapper for fixed preset steps with a
  non-root identity, no network, read-only rootfs, dropped capabilities, and
  bounded CPU, memory, PIDs, and tmpfs.
- Record a clean remote-clone lockfile pilot that passes `npm ci --ignore-scripts`
  and all 145 tests at commit `f19848e`.
- Keep real Docker daemon execution explicit as `NOT RUN`.

## 2026-08-25 - v0.1 lifecycle completion

- Discover completed jobs after a relay restart and retain their bounded logs,
  metadata, artifact manifests, and verified artifact downloads.
- Add an English/Korean/Japanese mobile flow that explicitly deletes one
  terminal job record, workspace, logs, and artifact snapshots together.
- Verify the live mobile flow at 390 x 844 through build, restart recovery, and
  irreversible-delete review without executing the destructive confirmation.

## 2026-08-25 - v0.2 completion candidate

- Finalize valid non-terminal job histories as interrupted during startup.
- Accept protocol-v1 job envelopes and version every job SSE payload.
- Authenticate artifact manifests with an optional dedicated HMAC-SHA256 key.
- Keep container daemon, live Actions, and physical Android evidence explicit
  as `NOT RUN` external gates.

## 2026-08-20

- Added authenticated current-state projection from durable job events.
- The projection is read-only evidence; interrupted process resumption remains `NOT RUN`.

## 2026-08-21

- Added authenticated, explicit deletion for one terminal job event history.
- Running or otherwise non-terminal histories cannot be deleted through this lifecycle API.

## 2026-08-22

- Artifact downloads now use relay-owned, exclusive snapshots created from verified collected bytes.
- Signed manifests and external provenance are still `NOT RUN`.

## 2026-08-23

- Added exclusive schema-versioned artifact manifests bound to repository, ref,
  resolved commit, preset, sizes, media types, and SHA-256 digests.
- These manifests are hashed but not cryptographically signed.

## 2026-08-24

- Local artifact downloads now re-read and hash the stable manifest before
  matching the requested artifact metadata and verifying its bytes.

## 2026-08-25

- Added a strict external Node pilot-report contract and verifier.
- Recorded a clean, commit-pinned `yocto-queue` syntax/FIFO pilot with an
  `index.js` SHA-256. Upstream `npm test` remains explicitly `NOT RUN` because
  the pinned repository has no dependency lockfile.

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
- Fixed, non-reflective npm, Android Gradle, and CMake failure diagnostics in
  failed job state and build summaries.
- Collection-time SHA-256 digests in local artifact state and authenticated
  download response headers.
- Pre-download identity, metadata, and SHA-256 verification that rejects changed
  local artifacts before response headers are sent.
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
