# Configuration

PocketForge Relay uses environment variables and has no runtime configuration
dependency. Invalid explicit values stop startup with a clear error instead of
silently falling back.

| Variable | Default | Accepted value |
| --- | --- | --- |
| `POCKETFORGE_TOKEN` | Random per-process token | At least 24 characters |
| `POCKETFORGE_DATA_DIR` | `.pocketforge` | Writable path |
| `HOST` | `127.0.0.1` | Node.js listen host, such as `0.0.0.0` |
| `PORT` | `8787` | Integer from 1 to 65535 |
| `MAX_CONCURRENT_JOBS` | `1` | Integer from 1 to 4 |
| `MAX_QUEUED_JOBS` | `20` | Integer from 1 to 1000 |
| `MAX_RETAINED_JOBS` | `100` | Integer from 1 to 10000 |
| `STEP_TIMEOUT_MS` | `600000` | Integer from 1000 to 3600000 |
| `MAX_LOG_LINES` | `4000` | Integer from 100 to 20000 |
| `MAX_ARTIFACT_FILES` | `100` | Integer from 1 to 1000 |
| `MAX_ARTIFACT_BYTES` | `26214400` | Integer from 1024 to 262144000 |
| `POCKETFORGE_ARTIFACT_INTEGRITY_KEY` | Disabled | Canonical base64url encoding of at least 32 random bytes |
| `POCKETFORGE_ACTIONS_TARGETS_FILE` | Disabled | Path to the server-owned Actions target JSON catalog |
| `POCKETFORGE_GITHUB_TOKEN` | Disabled | Non-empty GitHub token, no surrounding whitespace or line breaks, at most 4096 characters |
| `POCKETFORGE_ADB_PATH` | Disabled | Absolute path to `adb` |
| `POCKETFORGE_APKANALYZER_PATH` | Disabled | Absolute path to `apkanalyzer` |
| `POCKETFORGE_APKSIGNER_PATH` | Disabled | Absolute path to `apksigner` |
| `POCKETFORGE_DEVICE_ACTION_STORE_ROOT` | Disabled | Absolute relay-owned directory outside `POCKETFORGE_DATA_DIR/jobs` |
| `POCKETFORGE_DEVICE_ID_SECRET` | Disabled | Canonical base64url encoding of at least 32 random bytes |
| `POCKETFORGE_EVIDENCE_INTEGRITY_KEY` | Disabled | Canonical base64url encoding of at least 32 distinct random bytes |
| `MAX_CONCURRENT_DEVICE_ACTIONS` | `1` | Integer from 1 to 4 when Android device actions are enabled |

For repeatable use, set `POCKETFORGE_TOKEN` explicitly. When it is omitted, the
server prints a new random token at startup. Binding `HOST=0.0.0.0` exposes the
service to the local network; only do this on a trusted network.

`POCKETFORGE_ARTIFACT_INTEGRITY_KEY` is independent of the bearer token. When
configured, it authenticates local artifact manifests with HMAC-SHA256 and must
remain stable for the evidence lifetime. When omitted, manifests explicitly use
digest-only SHA-256 mode.

`MAX_QUEUED_JOBS` limits waiting work; a full queue rejects new jobs with HTTP
429. `MAX_RETAINED_JOBS` limits completed in-memory job records. Active and
queued jobs are never evicted. When an old completed record is evicted, its
workspace and artifact files remain on disk under `POCKETFORGE_DATA_DIR`; disk
retention is an operator responsibility in this MVP.

Build children receive a fixed environment allowlist rather than the relay's
whole environment. It includes process lookup, temporary and user directories,
locale settings, certificate paths, and the documented Java, Android, CMake,
compiler, and package-discovery toolchain variables used by the presets. Relay
tokens, cloud credentials, package registry tokens, proxy credentials, and
arbitrary host variables are not forwarded. Authenticated dependency installs
that require ambient environment credentials are therefore outside the v0.1
contract.

GitHub Actions support is disabled unless both
`POCKETFORGE_ACTIONS_TARGETS_FILE` and `POCKETFORGE_GITHUB_TOKEN` are present.
Supplying only one stops startup. The catalog is loaded and validated before the
server listens; it must be a bounded regular JSON file and cannot be a symbolic
link. The token and catalog path stay on the server and are never part of an API
response or build-child environment. See
[`GITHUB_ACTIONS.md`](GITHUB_ACTIONS.md) for the target schema and least-privilege
credential guidance.

Android device actions are disabled unless all six `POCKETFORGE_ADB_PATH`
through `POCKETFORGE_EVIDENCE_INTEGRITY_KEY` settings above are present.
Supplying only part of the set stops startup. The action store is created and
canonicalized before the server listens and must not overlap the build jobs
directory or the unauthenticated public static directory. `POCKETFORGE_DATA_DIR`
is likewise rejected when its canonical path overlaps the public directory,
including through an existing directory link. Both secrets must be persistent, independently generated values;
they are decoded at startup and never enter API responses or child build
environments. `MAX_CONCURRENT_DEVICE_ACTIONS` limits simultaneous destructive
approvals across devices and also bounds heavyweight APK preparation plus
unapproved snapshots waiting for confirmation. See
[`ANDROID_DEVICE_EVIDENCE.md`](ANDROID_DEVICE_EVIDENCE.md) for the approval,
download verification, deletion, and remaining real-device verification rules.
