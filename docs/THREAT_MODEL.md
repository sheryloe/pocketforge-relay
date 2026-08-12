# Threat Model

## Assets
Host filesystem, operating-system account, relay token, future source/provider credentials, checked-out source, logs, artifacts, approvals, and connected devices.

## Trust zones
1. Mobile client: authenticated but input remains untrusted.
2. Relay: trusted coordinator.
3. Repository: untrusted executable input.
4. Build process: repository-controlled code under the relay account in v0.1.
5. Artifact: untrusted until verified.
6. Network: untrusted unless protected by loopback, trusted LAN, VPN, or TLS proxy.

## Current controls
- Fixed presets and direct process argument arrays
- Validated GitHub URLs and refs
- Long bearer token with constant-time comparison
- Bounds for request body, execution time, logs, artifact count, and artifact size
- Symlink rejection and real-path containment during artifact discovery
- Loopback default with explicit LAN opt-in

## Remaining risks
Repository scripts have host-account authority, the child inherits the relay environment, no built-in TLS/rate limiting/rotation/RBAC exists, and workspace separation is not a sandbox.

## Target controls
Rootless container or micro-VM, read-only base, default-deny egress, CPU/memory/process/disk/time quotas, minimal environment, short-lived secret leases, signed pairing and revocation, immutable audit events, SBOM and provenance, and approval before install/publish/merge/release/deploy.
