# MVP Acceptance Criteria

The v0.1 MVP is accepted when a maintainer can start the bundled demo from the
mobile UI, observe authenticated live status, and download the generated
artifacts, while automated tests verify the input and execution boundaries.

Required checks:

- `npm run check` passes;
- `npm test` passes;
- unauthenticated API requests are rejected;
- each job receives a distinct workspace;
- arbitrary repository URLs, refs, and commands are rejected;
- build output is bounded and artifacts are collected within configured limits;
- all environment-dependent checks are explicitly marked `NOT RUN`.
