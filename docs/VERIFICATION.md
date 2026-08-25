# MVP Verification Record

Artifact manifests are deterministic JSON evidence with their own SHA-256.
They provide integrity binding, not signer identity; signature verification is
`NOT RUN` and must not be inferred from the manifest digest.

Initial record: 2026-08-13

Latest automated rerun: 2026-08-19

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
- Automated tests: 124 passed, 0 failed
- Focused GitHub Actions core and HTTP integration suite: 28 passed, 0 failed
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
- Protocol-v1 adapter descriptors and authenticated capability discovery: PASS
- Bounded append-only job history and restart-readable audit events: PASS
- Fixed, non-reflective npm, Gradle, and CMake failure diagnostics: PASS
- Collection-time local artifact SHA-256 and download digest header: PASS
- Changed local artifact rejection before download response headers: PASS
- Current Android-integrated PWA at 390 x 844 in the Codex in-app browser: PASS
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
- Live GitHub Actions dispatch, cancellation, polling, log download, and artifact download
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
