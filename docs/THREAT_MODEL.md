# Threat Model

## Assets
Host filesystem, operating-system account, relay token, GitHub credential,
device-ID secret, evidence-integrity key, checked-out source, APK snapshots,
logs, artifacts, approvals, retained evidence, and connected devices.

## Trust zones
1. Mobile client: authenticated but input remains untrusted.
2. Relay: trusted coordinator.
3. Repository: untrusted executable input.
4. Build process: repository-controlled code under the relay account in v0.1.
5. Artifact: untrusted until verified.
6. Network: untrusted unless protected by loopback, trusted LAN, VPN, or TLS proxy.
7. Action store: relay-managed but mutable by other code with the same operating-system identity.
8. Android device: physically external and authorized by ADB, but not cryptographically paired to one relay user.

## Current controls
- Fixed presets and direct process argument arrays
- Validated GitHub URLs and refs
- Long bearer token with constant-time comparison
- Bounds for request body, execution time, logs, artifact count, and artifact size
- Bounds for waiting jobs and retained completed job records
- Fixed child-process environment allowlist that excludes ambient relay and cloud secrets
- Best-effort log redaction for the relay token, authorization values, secret-labelled assignments, and recognizable provider token formats
- Symlink rejection and real-path containment during artifact discovery
- Loopback default with explicit LAN opt-in
- Graceful shutdown cancels queued work, terminates active children, and waits for job finalization
- Optional GitHub Actions dispatch limited to exact server-owned repository,
  workflow, ref, fixed-input, and artifact-name allowlists
- Expiring single-use dispatch approvals and cancellation limited to remote runs
  created by the same adapter instance
- GitHub authorization stripped before temporary artifact redirects, with ZIP
  byte limits, exclusive file creation, and no archive extraction
- Android device integration disabled unless every server-owned tool path,
  action-store path, and independent 32-byte secret is configured
- Server-resolved succeeded jobs and APK artifact identifiers; clients cannot
  provide an APK path, package name, activity, device serial, ADB argument, or command
- Action-owned APK snapshot outside the job workspace with canonical
  containment, symlink rejection, source-stability checks, SHA-256, package/
  version metadata, signer-certificate binding, and exclusive creation
- Opaque public device IDs backed by fresh exact device fingerprints and a
  physical-device mutex that collapses ADB transport aliases
- Five-minute, single-use Android approval bound to job, snapshot digest, and
  exact device identity; the approval secret is returned once and held only in
  PWA memory
- Fixed install, identity verification, launch, PID/UID, foreground, bounded
  logcat/crash, and PNG screenshot commands with fail-closed parsing
- HMAC-authenticated evidence manifest plus SHA-256 and size verification for
  every retained file before authenticated download
- Canonical and symlink checks during action-store recovery and download, plus
  canonical containment and fixed-entry validation before explicit evidence
  deletion; unexpected or unverifiable startup entries fail closed
- PWA consent disclosure for potentially sensitive logs, crash output, and the
  full device screen before Android approval

## Remaining risks
Repository scripts still have host-account authority, redaction cannot prove that every possible secret format is removed, no built-in TLS/rate limiting/rotation/RBAC exists, and workspace separation is not a sandbox. Completed-record eviction does not delete job workspaces, so operators must manage disk retention separately.

The optional GitHub credential remains in relay process memory. A person who
can change a workflow on an allowlisted ref controls what that workflow runs,
so protected refs and a least-privilege, expiring credential remain operator
requirements. Actions approvals, run ownership, and status are in memory only;
after restart, an unresolved remote workflow cannot be cancelled through the
old relay instance. Shutdown aborts local observation but does not itself prove
remote cancellation.

Android snapshot and evidence isolation is not a security boundary while the
relay and repository-controlled processes share an operating-system account.
Such code may attempt to change or delete the action store; the manifest HMAC
detects retained-file modification but cannot prevent deletion or prove physical
device authenticity. ADB authorization is not signed user pairing. Logs, crash
output, and screenshots can contain personal or confidential data, and the
runtime has explicit deletion but no automatic retention sweeper. A process
restart loses unapproved Android actions and approval secrets; only complete,
verified terminal evidence is recovered.

On Windows, SDK `.bat` wrappers run through a fixed absolute command processor
with metacharacter rejection, but timeout termination of the direct wrapper does
not yet guarantee termination of all Java grandchildren. Real-device `dumpsys`
formats also vary by Android/OEM; parsing fails closed, but device fixtures do
not replace physical-device verification.

## Target controls
Rootless container or micro-VM, read-only base, default-deny egress, CPU/memory/process/disk/time quotas, minimal environment, short-lived secret leases, signed pairing and revocation, immutable audit events, SBOM and provenance, and approval before install/publish/merge/release/deploy.
