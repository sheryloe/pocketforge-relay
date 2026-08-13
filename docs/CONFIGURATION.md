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
| `STEP_TIMEOUT_MS` | `600000` | Integer from 1000 to 3600000 |
| `MAX_LOG_LINES` | `4000` | Integer from 100 to 20000 |
| `MAX_ARTIFACT_FILES` | `100` | Integer from 1 to 1000 |
| `MAX_ARTIFACT_BYTES` | `26214400` | Integer from 1024 to 262144000 |

For repeatable use, set `POCKETFORGE_TOKEN` explicitly. When it is omitted, the
server prints a new random token at startup. Binding `HOST=0.0.0.0` exposes the
service to the local network; only do this on a trusted network.
