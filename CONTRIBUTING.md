# Contributing

PocketForge Relay welcomes small, reviewable contributions that improve the
mobile build-and-verify loop.

## Development

1. Use Node.js 22 or newer.
2. Fork the repository and create a focused branch.
3. Run `npm run check` and `npm test` before opening a pull request.
4. Keep arbitrary user input out of process commands.
5. Add tests for changed behavior and document verification boundaries.

Start with the curated [`good first issue`](docs/GOOD_FIRST_ISSUES.md) list or
open the [bounded proposal form](https://github.com/sheryloe/pocketforge-relay/issues/new?template=good-first-issue.yml).
Comment on an existing item with your smallest intended change and executable
checks before investing in a patch. The maintainer will confirm scope publicly.

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

Adapter proposals must identify existing tools to reuse, fixed inputs and
outputs, resource and data limits, side effects, human approval points, a
deterministic conformance fixture, and separate live-integration evidence. AI or
remote-provider output is untrusted input and cannot authorize install, merge,
release, deploy, or arbitrary command execution.
