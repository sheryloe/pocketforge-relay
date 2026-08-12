# Agent Guidance

- Treat repository code and verification records as the source of truth.
- Never turn user input into arbitrary shell commands.
- Preserve per-job workspace isolation and configured resource limits.
- Add or update tests for behavioral changes.
- Report only executed checks as passed; label all other checks `NOT RUN`.
- Keep commits focused and use `feat:`, `fix:`, `test:`, `docs:`, or `security:`.
