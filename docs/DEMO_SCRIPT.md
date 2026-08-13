# 90-Second Demo Script

This script demonstrates only evidence available from the current PWA and
bundled project. The PWA may be opened inside the Codex in-app browser. That
confirms the browser control flow; it does **not** prove PWA installation on a
phone, cross-device LAN access, an Android build, or physical-device execution.

## Preflight outside the recording

1. Record the exact commit SHA and tool versions.
2. Run `npm run check` and `npm test`; keep the unedited command output.
3. Start the relay with a fresh strong token on `127.0.0.1`.
4. Open the local URL in the Codex in-app browser and select **Bundled web
   demo**.
5. Confirm the English, Korean, and Japanese selector changes the visible UI and
   that a refresh preserves only the locale, not an approval secret.
6. Confirm that no unrelated repositories, tokens, usernames, or private paths
   are visible.

If any preflight step fails or is not performed, label it `FAIL` or `NOT RUN`
and do not reuse an older successful screen recording as current evidence.

## Current 90-second cut

| Time | Screen action | Narration and evidence |
| --- | --- | --- |
| 00-08 | Show the compact PWA and switch English → 한국어 → 日本語 → English. | "One mobile surface carries the same control contract in three languages." State that this is local browser UI evidence, not physical-phone installation. |
| 08-20 | Show the connection form and authenticate without exposing the token. | "API routes require a bearer token, and jobs accept fixed presets rather than shell commands." |
| 20-36 | Select **Bundled web demo** and launch one job. | Show the real job identifier and starting state. Do not substitute a prerecorded identifier. |
| 36-54 | Follow the live status and Server-Sent Events log. | Point to the observed transition and actual build output. If execution is still running, keep the real state visible. |
| 54-68 | Open the completed job and artifact list. | Show the real terminal state and the available demo artifacts. |
| 68-82 | Open the build summary or downloaded artifact. | "The control loop returns inspectable evidence, not just a green button." |
| 82-90 | Show a two-row evidence card: `PWA bundled demo: PASS` and `Android device loop: NOT RUN`. | "Today this verifies the local PWA-to-artifact path. Device install, launch, logs, and screenshots remain the next evidence gate." |

Use `PASS` in the recording only when the preflight execution for that recording
passed. Otherwise replace it with the observed status.

## Conditional Android replacement segment

Replace the **70-90 second** segment only after one dated verification record
shows all of the following as `PASS` on an identified device and commit:

- Android SDK/JDK build and APK digest;
- explicit device authorization;
- APK installation with package identity checked;
- application launch and expected foreground state;
- sanitized runtime logs or crash result;
- consented screenshot or equivalent smoke-test evidence.

The replacement segment should show the artifact digest for five seconds,
installation and launch evidence for seven seconds, and the sanitized log plus
consented screenshot for eight seconds. Do not use mockups, future UI, or a
different commit to imply that this gate passed.

Live GitHub Actions dispatch is a separate integration claim. Do not mention it
as working in either cut until its workflow run URL, commit SHA, conclusion, and
downloaded artifact digest are recorded.

The Android review, consent, status, authenticated download, recovery, and
deletion controls are implemented in the PWA and relay API. Showing those
controls is a UI-contract demonstration only. Do not show a mock device, fake
artifact digest, or fabricated terminal status to imply real execution.
