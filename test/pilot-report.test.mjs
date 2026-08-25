import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePilotReport } from '../src/pilot-report.mjs';

const valid = {
  schemaVersion: 1,
  repository: 'https://github.com/example/project',
  resolvedCommit: 'a'.repeat(40),
  cleanCheckout: true,
  commands: [{ command: 'npm test', exitCode: 0 }],
  artifacts: [{ path: 'dist/app.js', sha256: 'b'.repeat(64) }],
};

test('accepts complete external pilot evidence', () => {
  assert.equal(validatePilotReport(valid), valid);
});

test('rejects incomplete or inferred pilot evidence', () => {
  assert.throws(() => validatePilotReport({ ...valid, cleanCheckout: false }), /recorded as clean/);
  assert.throws(() => validatePilotReport({ ...valid, resolvedCommit: 'main' }), /full Git commit/);
  assert.throws(() => validatePilotReport({ ...valid, commands: [] }), /commands are required/);
  assert.throws(() => validatePilotReport({ ...valid, artifacts: [{ path: 'x', sha256: 'unknown' }] }), /artifact evidence/);
});
