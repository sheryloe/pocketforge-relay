# Contributing

PocketForge Relay welcomes small, reviewable contributions that improve the
mobile build-and-verify loop.

## Development

1. Use Node.js 22 or newer.
2. Fork the repository and create a focused branch.
3. Run `npm run check` and `npm test` before opening a pull request.
4. Keep arbitrary user input out of process commands.
5. Add tests for changed behavior and document verification boundaries.

## Good contribution areas

- build-log parsers for Gradle, CMake, npm, Flutter, and React Native;
- source and runner adapter contracts;
- artifact provenance and verification;
- accessibility and mobile-browser improvements;
- isolation, redaction, and authorization safeguards;
- reproducible sample repositories.

Use Conventional Commit prefixes such as `feat:`, `fix:`, `test:`, `docs:`,
and `security:`. A pull request should explain what changed, why, user impact,
and the exact checks executed. Mark environmental checks as `NOT RUN` when they
were not performed.
