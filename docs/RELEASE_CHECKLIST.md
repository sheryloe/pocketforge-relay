# Release Readiness Checklist

This checklist prepares the first GitHub release without declaring one. The
current state is **Unreleased** even though `package.json` contains a version.
A version field alone is not a Git tag or published GitHub release.

## Status vocabulary

- `PASS`: executed for the candidate commit and the expected result was
  observed.
- `FAIL`: executed for the candidate commit and the expected result was not
  observed.
- `NOT RUN`: not executed for the candidate commit; include the reason.

Candidate checklist updated: 2026-08-31. Commands, immutable SHAs, run links,
and artifact digests are recorded in [`VERIFICATION.md`](VERIFICATION.md).

## 1. Candidate identity and repository state

- [x] Record candidate version: PASS (`0.1.0`)
- [x] Record full candidate commit SHA: PASS
  (`3f690bd5208b1c8e8f123c11748b0277eb68fd70`)
- [x] Confirm the working tree is clean: PASS
- [x] Confirm `main` and the intended remote commit agree: PASS
- [x] Review every candidate diff for secrets and unrelated files: PASS
- [x] Confirm version, changelog, tag, and release title will agree: PASS
  (`0.1.0`, intended `v0.1.0`; changelog remains `Unreleased` until approval)

## 2. Automated and local verification

- [x] Clean dependency installation: PASS
- [x] `npm run check`: PASS
- [x] `npm test`: PASS (164 passed, 0 failed)
- [x] Bundled demo from stopped server to downloaded artifact: PASS
- [x] Invalid configuration exits before startup: PASS
- [x] Graceful shutdown with active and queued work: PASS (automated contract)
- [x] Focused GitHub Actions core, HTTP, and PWA tests: PASS
- [x] Focused Android adapter, runtime, HTTP, recovery, deletion, and PWA tests:
  PASS
- [x] English/Korean/Japanese catalog and README parity tests: PASS
- [x] Final `git diff --check`: PASS

For each item, record the command, exit code, timestamp, environment, and
evidence path or URL in [`VERIFICATION.md`](VERIFICATION.md).

## 3. Security and operating boundary

- [x] No arbitrary user text becomes a shell command: PASS
- [x] Child-process environment allowlist test passes: PASS
- [x] Token and defensive secret-redaction tests pass: PASS
- [x] Queue, timeout, workspace, log, and artifact limits pass: PASS
- [x] Artifact path traversal and symlink checks pass: PASS
- [x] Actions approvals are single-use and cancellation is adapter-owned: PASS
- [x] Actions credential, signed URL, workspace, and absolute-path omission tests
  pass: PASS
- [x] Android configuration is disabled by default and rejects partial or weak
  secret configuration: PASS
- [x] Android APK snapshot, exact device binding, and one-shot approval tests
  pass: PASS
- [x] Android action-store recovery rejects linked, escaping, unexpected, or
  tampered entries: PASS
- [x] Android evidence downloads re-verify HMAC/digests and explicit deletion
  rejects unsafe paths: PASS
- [x] Approval secrets are absent from public state, DOM, URLs, logs, and browser
  storage: PASS
- [x] `SECURITY.md`, threat model, configuration, and README warnings agree: PASS
- [x] Release notes state that the runner is not a hardened sandbox: PASS
- [x] Release notes restrict use to trusted repositories and networks: PASS

## 4. User and contributor experience

- [x] Quick start works from a clean checkout: PASS
- [ ] PWA layout is inspected in the Codex in-app browser: `NOT RUN`
- [ ] English, Korean, and Japanese UI states are inspected at mobile width with
  no horizontal overflow: `NOT RUN`
- [ ] Locale selection persists across refresh while approval secrets do not:
  `NOT RUN`
- [x] Android privacy disclosure and explicit evidence-deletion confirmation are
  reviewed in every supported language: PASS (automated contract)
- [ ] Keyboard, focus, labels, contrast, and touch targets are reviewed:
  `NOT RUN`
- [x] Contribution and security-reporting links resolve: PASS
- [ ] Pilot and good-first-issue forms render in GitHub: `NOT RUN`
- [x] Repository description has no typo and describes the control-plane scope:
  PASS
- [x] Topics, license, homepage, and issue settings are reviewed: PASS

## 5. GitHub release evidence

- [x] GitHub Actions run for the candidate commit concludes successfully: PASS
- [x] Workflow URL and immutable candidate SHA are recorded: PASS
- [x] Release notes are derived from the `Unreleased` changelog entries: PASS
- [x] License and known limitations appear in the release notes: PASS
- [ ] Annotated tag and GitHub release are created only after all blocking gates
  pass: `NOT RUN`
- [ ] Published assets are downloaded again and their digests checked:
  `NOT RUN`

Do not create a tag or GitHub release while this checklist is being drafted.
Those are explicit external writes and belong to the final, approved release
step.

## 6. Integration claims kept separate

These checks are not required to describe the v0.1 orchestration spine, but
their status must be prominent. They cannot be inferred from unit tests.

- [x] External GitHub repository cloned end to end: PASS
- [x] Live GitHub Actions dispatch and conclusion polling: PASS
- [x] Artifact downloaded from the identified workflow run: PASS
- [ ] Real Android Gradle build with SDK/JDK: `NOT RUN`
- [ ] Physical Android device authorized and identified: `NOT RUN`
- [ ] APK installed and launched on that device: `NOT RUN`
- [ ] Runtime logs or crash result captured and sanitized: `NOT RUN`
- [ ] Screenshot captured with participant consent: `NOT RUN`
- [ ] Real project-specific CMake build: `NOT RUN`

Until an item passes, release notes and demonstrations must say `NOT RUN`, not
"supported", "integrated", or "verified".

## 7. Pilot launch

- [ ] Open no more than the three slots defined in
  [`PILOT_PROGRAM.md`](PILOT_PROGRAM.md): `NOT RUN`
- [ ] Confirm the participant has accepted the trust and privacy boundaries:
  `NOT RUN`
- [ ] Confirm public evidence contains no secrets or private paths: `NOT RUN`
- [ ] Measure actual acknowledgement and triage times separately from response
  targets: `NOT RUN`
- [ ] Link every accepted report to a decision, commit, or follow-up issue:
  `NOT RUN`

## Release decision

Release only when all blocking sections 1-5 are `PASS` or have a documented,
reviewed exception. Section 6 may remain `NOT RUN` for the initial orchestration
release, but every such limitation must be stated. The Android segment in
[`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) remains prohibited until all relevant device
checks in section 6 are `PASS`.
