# MVP HTTP Protocol

All `/api/*` routes except `/api/health` require `Authorization: Bearer <POCKETFORGE_TOKEN>`.

- `GET /api/health`
- `GET /api/presets`
- `GET /api/jobs`
- `POST /api/jobs`
- `GET /api/jobs/{jobId}`
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

This pre-1.0 API may change. The target protocol adds schema versions, capability negotiation, resumable offsets, signed pairing, runner identity, artifact digests, and adapter metadata.
