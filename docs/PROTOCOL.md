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

This is an audit history, not execution recovery. The relay does not restore an
in-memory job, resume an interrupted process, or make old artifact paths active
after restart.

This pre-1.0 API may change. The remaining target protocol work includes
versioned request/event envelopes, resumable offsets, signed pairing, runner
identity, and generic artifact digests.
