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

Initial checklist status: `NOT RUN`. Existing entries in
[`VERIFICATION.md`](VERIFICATION.md) are baseline evidence, not a substitute for
the release-candidate rerun.

## 1. Candidate identity and repository state

- [ ] Record candidate version: `NOT RUN`
- [ ] Record full candidate commit SHA: `NOT RUN`
- [ ] Confirm the working tree is clean: `NOT RUN`
- [ ] Confirm `main` and the intended remote commit agree: `NOT RUN`
- [ ] Review every candidate diff for secrets and unrelated files: `NOT RUN`
- [ ] Confirm version, changelog, tag, and release title will agree: `NOT RUN`

## 2. Automated and local verification

- [ ] Clean dependency installation: `NOT RUN`
- [ ] `npm run check`: `NOT RUN`
- [ ] `npm test`: `NOT RUN`
- [ ] Bundled demo from stopped server to downloaded artifact: `NOT RUN`
- [ ] Invalid configuration exits before startup: `NOT RUN`
- [ ] Graceful shutdown with active and queued work: `NOT RUN`
- [ ] Focused GitHub Actions core, HTTP, and PWA tests: `NOT RUN`
- [ ] Focused Android adapter, runtime, HTTP, recovery, deletion, and PWA tests:
  `NOT RUN`
- [ ] English/Korean/Japanese catalog and README parity tests: `NOT RUN`
- [ ] Final `git diff --check`: `NOT RUN`

For each item, record the command, exit code, timestamp, environment, and
evidence path or URL in [`VERIFICATION.md`](VERIFICATION.md).

## 3. Security and operating boundary

- [ ] No arbitrary user text becomes a shell command: `NOT RUN`
- [ ] Child-process environment allowlist test passes: `NOT RUN`
- [ ] Token and defensive secret-redaction tests pass: `NOT RUN`
- [ ] Queue, timeout, workspace, log, and artifact limits pass: `NOT RUN`
- [ ] Artifact path traversal and symlink checks pass: `NOT RUN`
- [ ] Actions approvals are single-use and cancellation is adapter-owned:
  `NOT RUN`
- [ ] Actions credential, signed URL, workspace, and absolute-path omission tests
  pass: `NOT RUN`
- [ ] Android configuration is disabled by default and rejects partial or weak
  secret configuration: `NOT RUN`
- [ ] Android APK snapshot, exact device binding, and one-shot approval tests
  pass: `NOT RUN`
- [ ] Android action-store recovery rejects linked, escaping, unexpected, or
  tampered entries: `NOT RUN`
- [ ] Android evidence downloads re-verify HMAC/digests and explicit deletion
  rejects unsafe paths: `NOT RUN`
- [ ] Approval secrets are absent from public state, DOM, URLs, logs, and browser
  storage: `NOT RUN`
- [ ] `SECURITY.md`, threat model, configuration, and README warnings agree:
  `NOT RUN`
- [ ] Release notes state that the runner is not a hardened sandbox: `NOT RUN`
- [ ] Release notes restrict use to trusted repositories and networks: `NOT RUN`

## 4. User and contributor experience

- [ ] Quick start works from a clean checkout: `NOT RUN`
- [ ] PWA layout is inspected in the Codex in-app browser: `NOT RUN`
- [ ] English, Korean, and Japanese UI states are inspected at mobile width with
  no horizontal overflow: `NOT RUN`
- [ ] Locale selection persists across refresh while approval secrets do not:
  `NOT RUN`
- [ ] Android privacy disclosure and explicit evidence-deletion confirmation are
  reviewed in every supported language: `NOT RUN`
- [ ] Keyboard, focus, labels, contrast, and touch targets are reviewed:
  `NOT RUN`
- [ ] Contribution and security-reporting links resolve: `NOT RUN`
- [ ] Pilot and good-first-issue forms render in GitHub: `NOT RUN`
- [ ] Repository description has no typo and describes the control-plane scope:
  `NOT RUN`
- [ ] Topics, license, homepage, and issue settings are reviewed: `NOT RUN`

## 5. GitHub release evidence

- [ ] GitHub Actions run for the candidate commit concludes successfully:
  `NOT RUN`
- [ ] Workflow URL and immutable candidate SHA are recorded: `NOT RUN`
- [ ] Release notes are derived from the `Unreleased` changelog entries:
  `NOT RUN`
- [ ] License and known limitations appear in the release notes: `NOT RUN`
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

- [ ] External GitHub repository cloned end to end: `NOT RUN`
- [ ] Live GitHub Actions dispatch and conclusion polling: `NOT RUN`
- [ ] Artifact downloaded from the identified workflow run: `NOT RUN`
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
