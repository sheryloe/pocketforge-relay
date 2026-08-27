# Pilot Program

PocketForge Relay will run a small, evidence-focused pilot before making broad
adoption claims. The first cohort has exactly **three active slots**. A slot is
complete only when its report contains reproducible results and an explicit
`PASS`, `FAIL`, or `NOT RUN` status for each attempted check.

## Pilot slots

| Slot | Focus | Entry gate | Current evidence boundary |
| --- | --- | --- | --- |
| 1 | Bundled demo through the PWA in the Codex in-app browser or another browser | Release-candidate local checks pass | Shows the web control loop, not physical-phone behavior |
| 2 | One trusted public Node.js repository | External network clone is exercised safely | Clean commit-pinned `yocto-queue` clone, lockfile install, tests, and artifact digest are recorded as `PASS`; this does not generalize to other repositories |
| 3 | Android build and device evidence | SDK/JDK build, authorized device installation, launch, logs, and screenshots all pass the readiness gate | Real Android build and physical-device checks are currently `NOT RUN` |

Slot 3 must not be advertised or opened as a working-device pilot until its
entry gate is `PASS`. If the gate remains `NOT RUN`, the slot stays reserved and
the public demo ends with that limitation.

## Eligibility and safety

A pilot participant must:

- use a trusted public repository or the bundled demo;
- run the relay on a maintainer-controlled, trusted machine and network;
- avoid production credentials and private source code;
- accept that the current runner is not a hardened sandbox;
- follow [`SECURITY.md`](../SECURITY.md) for suspected vulnerabilities rather
  than creating a public issue.

The relay does not automatically transmit pilot logs, artifacts, or screenshots
to the maintainer. A participant chooses what to attach to a GitHub report.
GitHub issues are public and remain subject to GitHub's retention and privacy
terms.

## Consent and privacy

Before sharing evidence, the participant must:

1. Review every log excerpt, artifact name, and screenshot.
2. Remove tokens, authorization headers, environment values, private URLs,
   usernames, email addresses, machine names, and sensitive absolute paths.
3. Confirm permission to share repository content and any screen content.
4. Prefer the smallest sanitized excerpt that reproduces the result.
5. Keep raw artifacts local unless their public release is intentional.

Logs and screenshots are optional. Attaching either is affirmative consent to
publish that specific sanitized material in the issue. Do not attach material
that belongs to an employer, client, or another person without permission.

## Required reproduction record

Each report must contain the following fields:

- pilot slot and tested commit SHA;
- date, time, and timezone;
- host OS and architecture;
- Node.js, npm, and Git versions;
- browser name and version;
- phone or emulator model, OS version, connection method, and authorization
  state when device behavior is tested;
- repository URL or `bundled-demo`, exact Git ref, and selected preset;
- relevant configuration names with all secret values replaced by `[REDACTED]`;
- ordered reproduction steps from a stopped server;
- expected result and observed result;
- job identifier, terminal state, and relevant HTTP status code;
- exact commands executed and exit codes;
- sanitized log excerpt with the first and last relevant events;
- artifact names, sizes, and digests when available;
- screenshot or recording only after the consent checks above;
- one status per check: `PASS`, `FAIL`, or `NOT RUN`, with `NOT RUN` reasons.

`PASS` means the named check was executed and its expected result was observed.
It does not imply that adjacent platforms, devices, or integrations passed.

## Issue taxonomy

Use the existing issue forms where possible and one of these title prefixes:

- `pilot:` for a completed pilot report;
- `bug:` for a reproducible non-security defect;
- `adapter:` for a bounded adapter proposal;
- `docs:` for documentation accuracy or clarity;
- `accessibility:` for keyboard, screen-reader, contrast, or touch issues;
- `evidence:` for a missing or contradictory verification record;
- `good first issue:` for a small contribution proposal with acceptance tests.

Suspected vulnerabilities have no public prefix. Report them privately according
to [`SECURITY.md`](../SECURITY.md).

## Maintainer response targets

The pilot sets the following service targets:

- acknowledge a complete non-security report within two business days;
- classify it or request missing evidence within five business days;
- post a status update at least every seven calendar days while actively being
  investigated;
- close the loop with the fixing commit, documentation decision, or a clear
  reason for not proceeding.

These are **targets for the pilot, not observed historical metrics or
guarantees**. Actual timestamps should be measured from the public issue history
before they are cited in an open-source program application.

## Cohort completion criteria

The first cohort is complete when:

- all three slots are either completed or explicitly recorded as `NOT RUN` with
  their blockers;
- at least one report is reproduced independently by the maintainer;
- every accepted defect has a linked decision or focused follow-up issue;
- no public report contains secrets or non-consensual logs or screenshots;
- observed participation and response times are reported separately from the
  targets above.
