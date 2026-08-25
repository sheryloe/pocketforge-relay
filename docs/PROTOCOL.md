# MVP HTTP Protocol

All `/api/*` routes except `/api/health` require `Authorization: Bearer <POCKETFORGE_TOKEN>`.

- `GET /api/health`
- `GET /api/presets`
- `GET /api/capabilities`
- `GET /api/jobs`
- `POST /api/jobs`
- `GET /api/jobs/{jobId}`
- `GET /api/jobs/{jobId}/history`
- `POST /api/jobs/{jobId}/cancel`
- `GET /api/jobs/{jobId}/events` using Server-Sent Events
- `GET /api/jobs/{jobId}/artifacts/{artifactId}`

Demo request:
```json
{"sourceType":"demo","presetId":"demo-web","label":"Phone demo"}
```

Versioned request:
```json
{"schemaVersion":1,"payload":{"sourceType":"demo","presetId":"demo-web"}}
```

Unknown versions and malformed envelopes are rejected. The unwrapped request
remains supported for protocol-v1 clients. Every SSE JSON payload includes
`"schemaVersion":1` while preserving its existing event fields.

GitHub request:
```json
{"sourceType":"github","repository":"https://github.com/owner/repository","ref":"main","presetId":"npm-test"}
```

## Adapter contract v1

`GET /api/capabilities` returns the relay protocol version and one descriptor
for each built-in adapter. Every descriptor has a stable identifier, adapter
kind, contract version, enabled state, and a sorted list of bounded capability
identifiers. Disabled adapters are still advertised so clients can distinguish
"known but disabled" from "unknown". The AI agent descriptor is disabled; this
endpoint does not claim that an AI adapter exists.

Clients must reject contract versions they do not understand instead of
guessing compatibility. Capability identifiers describe available operations;
they never grant authority or bypass authentication and approval.

## Durable job history

`GET /api/jobs/{jobId}/history` returns protocol-v1 events recorded for that
server-issued job identifier. Records are appended in increasing sequence order
and remain readable after a relay restart. Each job log is bounded by byte and
record-size limits; malformed, linked, changed, or oversized files fail closed.

At startup, a valid non-terminal history receives fixed `failed` and `complete`
events with `interrupted: true`. This safely closes the audit record; the relay
does not restore an in-memory job, resume an orphaned process, or make old
artifact paths active after restart.

Failed local jobs may include a `failure` object with fixed `tool`, `category`,
`code`, and `summary` fields. See [`FAILURE_DIAGNOSTICS.md`](FAILURE_DIAGNOSTICS.md).

## Artifact digests

Every collected local artifact includes a lowercase hexadecimal `sha256` field.
The authenticated download repeats that value in `X-Artifact-SHA256`. Collection
hashes one opened file handle and excludes a file if its identity, size, or
timestamps change before hashing finishes.

Before sending response headers, each local-artifact download re-hashes the
same opened file handle and repeats the identity and metadata checks. A digest
mismatch returns `409` without serving artifact bytes. Downloads use relay-owned
exclusive snapshots and a deterministic manifest. With
`POCKETFORGE_ARTIFACT_INTEGRITY_KEY`, the manifest is authenticated using
HMAC-SHA256; without it, the manifest explicitly records SHA-256-only mode.
This proves possession of the configured relay key, not external build-service
identity or public-key provenance.

This pre-1.0 API may change. The remaining target protocol work includes
resumable offsets, signed pairing, runner identity, isolated execution, and
external build-service provenance.
