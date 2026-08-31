# MVP Verification Record

Artifact manifests are deterministic JSON evidence with SHA-256 integrity and
optional dedicated-key HMAC-SHA256 authentication. HMAC proves possession of
the configured relay key, not public-key signer identity or external provenance.

Initial record: 2026-08-13

Latest automated rerun: 2026-08-31

## v0.1.0 pre-release candidate rerun

Tested source commit:
`26194daa9a2024da5c1962429ecb5dc93eb8bbab`

The commit was cloned with `--no-hardlinks` into a new temporary directory and
verified without reusing the working tree:

```powershell
npm ci --ignore-scripts
npm run check
npm test
git diff --check
```

- Clean dependency installation: PASS (1 package audited, 0 vulnerabilities)
- Syntax checks: PASS
- Automated tests: 164 passed, 0 failed
- Clean checkout status after verification: PASS
- Focused README/PWA accessibility, lifecycle, and localization contracts:
  18 passed, 0 failed
- Actual 390 x 844 browser rerun for this candidate: `NOT RUN`
- Candidate GitHub Actions CI: PASS
  ([PR-head run 33344000191](https://github.com/sheryloe/pocketforge-relay/actions/runs/33344000191),
  [merged-main run 33344072357](https://github.com/sheryloe/pocketforge-relay/actions/runs/33344072357))
- Candidate PR and merge: PASS
  ([PR #19](https://github.com/sheryloe/pocketforge-relay/pull/19), merge commit
  `3f690bd5208b1c8e8f123c11748b0277eb68fd70`)
- GitHub repository metadata review: PASS after correcting the description,
  publishing the documented topics, and setting the README homepage. Apache-2.0,
  public visibility, issues, and `main` as the default branch were re-read.

The clean checkout also ran the server from a stopped state and submitted one
protocol-v1 bundled-demo job. Health returned 200, an unauthenticated job list
returned 401, and job `a655709c-f287-40b4-82cb-9616bfab089c` succeeded with
exit code 0. Every authenticated download returned 200 and its manifest,
`X-Artifact-SHA256` header, and downloaded-file SHA-256 matched:

- `.pocketforge-result/build-summary.json`:
  `dd37771b13c6903d62263160fe364c9ce56d92d99a3f963817bf0d494470ff44`
- `dist/build-report.json`:
  `ff5e014dcaff61844182ce57ba1865edd36bc8e79e658a6376343dffeda90d80`
- `dist/index.html`:
  `2d3b09b6d76d0646a8d0709ace8c3c1fe2a86efa333e83ac9f8d5391fa8a15ac`

## Merged-main publication verification

The merged GitHub `main` commit
`3f690bd5208b1c8e8f123c11748b0277eb68fd70` was cloned from the public remote
into a new directory on 2026-08-31. The clone passed `npm ci --ignore-scripts`
with 0 reported vulnerabilities, `npm run check`, all 164 tests, `git diff
--check`, and clean status.

GitHub Actions run
[33344072357](https://github.com/sheryloe/pocketforge-relay/actions/runs/33344072357)
also completed successfully for that exact merge SHA after the `main` push.

The clean clone then started the real server and submitted one protocol-v1
bundled-demo job. Health returned 200, an unauthenticated job list returned 401,
and job `ae143432-4b5c-4d84-88a7-8928eadac9e8` succeeded with exit code 0.
Every download returned 200 and its manifest, `X-Artifact-SHA256` header, and
downloaded-file SHA-256 matched:

- `.pocketforge-result/build-summary.json`:
  `9e05a1b881edbff0f7d6bdccd321b3b444b6af368fb6b01182d56bd371451a49`
- `dist/build-report.json`:
  `d5f5c856061ca6a94b9eae027279104f8add06c6a603bbeab8173e791915d689`
- `dist/index.html`:
  `c6bf4b93ed267ccaa4d537003f0c217312c95616d9505076356a893497a21b89`

The candidate browser rerun, release tag, GitHub pre-release, and published
asset re-download remain `NOT RUN`.

## Environment

- Node.js: v24.15.0
- npm: 11.12.1
- Git: 2.50.1.windows.1

## Commands

```bash
npm run check
npm test
```

## Result

- Syntax checks: PASS
- Automated tests: 164 passed, 0 failed
- Restart-readable mobile job discovery and recovered artifact download: PASS
- Terminal full-data deletion contract and confirmation UI: PASS
- Destructive deletion click during real-browser inspection: `NOT RUN`
  (confirmation contract was exercised by automated manager/HTTP tests)
- Forced-restart interrupted-history finalization: PASS
- Protocol-v1 request and SSE envelope compatibility: PASS
- Signed and unsigned artifact-manifest verification: PASS
- Docker daemon integration: `NOT RUN` (CLI installed; daemon unavailable)
- Digest-pinned container configuration and fixed-argument boundary tests: PASS
- Non-root, no-network, read-only-rootfs, dropped-capability, no-new-privileges,
  CPU, memory, PID, and tmpfs argument contract: PASS
- Clean remote clone at `f19848e4f9153fc2bc681a6e0c497898b5ddf237`,
  `npm ci --ignore-scripts`, and 145-test upstream self-pilot: PASS
- Focused GitHub Actions core and HTTP integration suite: 31 passed, 0 failed
- Live allowlisted GitHub Actions dispatch and conclusion polling: PASS
  ([run 32813892748](https://github.com/sheryloe/pocketforge-relay/actions/runs/32813892748))
- Live run-log ZIP and required `relay-evidence` ZIP collection: PASS
- Relay evidence re-download SHA-256: PASS
  (`9c0a259c9245689c1548bcd4bb2d41ff525f1dea51510db3a6abc464f6f3eb98`)
- Live GitHub Actions cancellation: `NOT RUN`
- Focused hardening regression suite: 20 of 20 repeated runs passed
- Bundled demo process execution: PASS
- Demo artifact collection: PASS
- HTTP health endpoint: PASS
- Bearer-token rejection and acceptance: PASS
- Repository URL validation: PASS
- Git ref validation: PASS
- Preset source compatibility: PASS
- npm lockfile enforcement: PASS
- Canonical artifact relative paths on Windows: PASS
- Configuration defaults and supported boundaries: PASS
- Malformed and out-of-range configuration rejection: PASS
- Weak user-supplied token rejection: PASS
- Child-process environment allowlist and ambient-secret exclusion: PASS
- Exact relay-token and defensive secret-pattern log redaction: PASS
- Waiting-queue capacity rejection: PASS
- HTTP admission-control status propagation: PASS
- Completed-job retention without active-job or artifact-file deletion: PASS
- Active-child cancellation and asynchronous shutdown completion: PASS
- HTTP test cleanup waits for job finalization: PASS
- Invalid explicit configuration exits before server startup: PASS
- GitHub Actions disabled-by-default and paired configuration validation: PASS
- Authenticated Actions target, approval, run, cancellation, and artifact routes: PASS
- Actions server-owned workspace and public secret/path omission: PASS
- Actions active-run capacity, cancellation, and abort-and-wait shutdown: PASS
- Actions terminal-result deferral until evidence finalization: PASS
- Actions artifact download digest header and pre-header tamper rejection: PASS
- Restart-readable Actions state and retained artifact path reconstruction: PASS
- Interrupted Actions restart finalization without redispatch: PASS
- Android device integration disabled-by-default and all-or-none configuration: PASS
- Android tool paths and independent 32-byte secret validation: PASS
- Succeeded-job and APK-only server-side artifact resolution: PASS
- Android public/private device identity separation and exact binding drift checks: PASS
- Action-owned APK snapshot containment, stability, digest, metadata, and signer binding: PASS
- Five-minute one-shot Android approval and physical-device alias mutex: PASS
- Fixed install, package/base-APK, launch epoch, PID/UID, and foreground checks: PASS
- Bounded logcat, crash, and screenshot collection with fail-closed parsing: PASS
- HMAC evidence manifest, retained-file digest verification, and tamper rejection: PASS
- Authenticated device list, prepare, approve, status, evidence, and deletion routes: PASS
- Action-store startup recovery, abandoned-snapshot cleanup, and symlink rejection: PASS
- Android approval-token omission from public state, DOM, and browser storage: PASS
- Android evidence consent, retention disclosure, and explicit deletion PWA flow: PASS
- English/Korean/Japanese catalog key parity and referenced-key coverage: PASS
- Locale-only persistence and offline locale-bundle coverage: PASS
- English/Korean/Japanese README structural and link parity: PASS
- English/Korean/Japanese AI-direction, implementation-boundary, data-consent,
  Actions, and Android claim parity: PASS
- Relative Markdown links in the maintained READMEs and roadmap: PASS
- Five live good-first-issue links and bounded proposal-form contracts: PASS
- External contributor or downstream adapter participation: `NOT RUN`
- Protocol-v1 adapter descriptors and authenticated capability discovery: PASS
- Bounded append-only job history and restart-readable audit events: PASS
- Fixed, non-reflective npm, Gradle, and CMake failure diagnostics: PASS
- Proposal-only provider-neutral adapter and bounded evidence preview: PASS
- Expiring explicit consent, single use, timeout, and structured-output rejection: PASS
- Live external AI provider and model output: `NOT RUN`
- Authenticated proposal-agent status, preview, and approval HTTP contract: PASS
- Disabled-by-default proposal routes and capability state: PASS
- Collection-time local artifact SHA-256 and download digest header: PASS
- Changed local artifact rejection before download response headers: PASS
- Current Android-integrated PWA at 390 x 844 in the Codex in-app browser: PASS
- Bundled demo followed by relay restart and recovered mobile job rendering at
  390 x 844: PASS
- Recovered-job deletion review visible at 390 x 844: PASS
- English/Korean/Japanese live locale switching at 390 x 844: PASS
- English/Korean/Japanese horizontal overflow at 390 x 844: PASS (0 overflowing locales)
- Browser console errors during connection, bundled demo, and locale switching: PASS (0 errors)

## Verified demo outputs

- `dist/index.html`
- `dist/build-report.json`
- `.pocketforge-result/build-summary.json`

## Boundary

The test suite verifies the MVP orchestration path and defensive input checks. A live local server health request also returned `ok: true`. It does not certify the process runner as a hardened sandbox. The trusted-repository warning remains applicable.

Android tests use injected fake `adb`, `apkanalyzer`, and `apksigner` responses
plus temporary local files. They exercise the core, runtime, authenticated HTTP
surface, recovery/deletion paths, and PWA contract without installing Android
tools or mutating a real device. GitHub Actions tests use fake HTTP responses and
temporary local workspaces; they do not contact GitHub.

## Implemented but not exercised in this environment

- End-to-end cloning of an external GitHub repository over the network
- A real Android Gradle build with Android SDK/JDK toolchains
- A real CMake project build with project-specific native toolchains
- Cross-device LAN access from a physical phone
- Live GitHub Actions cancellation and private-repository access
- Real `adb`, `apkanalyzer`, and `apksigner` process execution
- Physical-device discovery and authorization
- APK installation and launch on a physical device
- Physical-device package/digest/PID/UID/foreground verification
- Physical-device logcat, crash, or screenshot collection
- Private-repository access with a least-privilege GitHub credential

These paths require external repositories, credentials, toolchains, or devices
and are **NOT RUN**. They are not represented as verified by the automated test
suite, even where the corresponding adapter, API, and PWA contracts are
implemented.
