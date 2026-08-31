# v0.2 Completion Plan

This plan separates repository work from evidence that requires an external
service, container daemon, SDK, or physical device. A capability is complete
only after its implementation, focused tests, documentation, full regression,
GitHub pull request, CI, merge, and `main` synchronization all succeed.

## Repository implementation

| Priority | Slice | Completion evidence |
| --- | --- | --- |
| P0 | Interrupted-job recovery | Startup scan safely appends fixed terminal evidence to valid non-terminal histories; forced-restart tests pass. It does not resume an orphaned OS process. |
| P0 | Protocol v1 envelopes | Versioned create-job requests and SSE payloads work while the documented legacy request remains compatible; fixtures reject unknown versions. |
| P0 | Artifact manifest authentication | A dedicated optional 32-byte key produces and verifies HMAC-SHA256 manifest evidence; unsigned mode remains explicit. |
| P1 | Container runner boundary | An optional digest-pinned image uses fixed Docker arguments for non-root execution, no network, dropped capabilities, read-only root, bounded CPU, memory, PIDs, and time. Host mode keeps the trusted-repository warning. |

## External execution gates

| Gate | Current status | Required evidence |
| --- | --- | --- |
| Container daemon integration | `NOT RUN` until a pinned image is selected and available | Recorded image digest, non-root identity, denied network, read-only root, enforced CPU/memory/PID/time limits, build exit code, artifact digest |
| Live GitHub Actions | `PASS` for one public allowlisted target at run [32813892748](https://github.com/sheryloe/pocketforge-relay/actions/runs/32813892748); cancellation and private repositories remain `NOT RUN` | Dispatch/run ID, exact ref and resolved commit, terminal conclusion, bounded downloaded evidence digest |
| Android SDK and physical device | `NOT RUN` without the SDK/JDK/tool paths and an authorized participant device | Build, APK signature, device identity, explicit approval, install/launch/log/screenshot evidence and deletion result |
| Dependency-based external Node pilot | `PASS` for clean commit-pinned `yocto-queue` at `f19848e4f9153fc2bc681a6e0c497898b5ddf237`; other repositories remain unverified | Trusted repository with committed lockfile, clean checkout, pinned commit, `npm ci --ignore-scripts`, upstream test exit code, artifact digests |

## Delivery order

Each repository slice is implemented with focused tests before documentation.
The combined branch is pushed, reviewed by GitHub Actions, merged without
squashing the focused history, and synchronized back to local `main`.
