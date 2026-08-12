# Security Policy

## Supported versions

PocketForge Relay is pre-1.0 software. Security fixes are applied to the latest
release and the `main` branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting when it is enabled for the repository. Until that is
available, contact the maintainer through the private contact method listed on
their GitHub profile and include reproduction steps, affected version, impact,
and any suggested mitigation.

## Current trust boundary

The MVP executes allowlisted commands but is not a hardened sandbox. It should
only process trusted public repositories and should be operated on a trusted
network. Never expose it directly to the public internet or treat bearer-token
authentication as multi-user authorization.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for detailed assumptions.
