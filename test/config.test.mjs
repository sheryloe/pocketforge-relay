import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

test('uses bounded defaults when optional settings are absent', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8787);
  assert.equal(config.maxConcurrentJobs, 1);
  assert.equal(config.generatedToken, true);
  assert.equal(config.token.length, 32);
});

test('accepts explicit settings at their supported boundaries', () => {
  const config = loadConfig({
    POCKETFORGE_TOKEN: '123456789012345678901234',
    POCKETFORGE_DATA_DIR: './relay-data',
    HOST: '0.0.0.0',
    PORT: '65535',
    MAX_CONCURRENT_JOBS: '4',
    STEP_TIMEOUT_MS: '1000',
    MAX_LOG_LINES: '20000',
    MAX_ARTIFACT_FILES: '1000',
    MAX_ARTIFACT_BYTES: '1024',
  });
  assert.equal(config.generatedToken, false);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 65535);
  assert.equal(config.maxConcurrentJobs, 4);
  assert.equal(config.stepTimeoutMs, 1000);
  assert.equal(config.maxLogLines, 20000);
  assert.equal(config.maxArtifactFiles, 1000);
  assert.equal(config.maxArtifactBytes, 1024);
  assert.equal(config.dataDir, path.resolve('./relay-data'));
});

test('rejects malformed and out-of-range numeric settings', () => {
  assert.throws(() => loadConfig({ PORT: '8787oops' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ MAX_CONCURRENT_JOBS: '5' }), /MAX_CONCURRENT_JOBS/);
  assert.throws(() => loadConfig({ STEP_TIMEOUT_MS: '-1' }), /STEP_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ MAX_LOG_LINES: '1.5' }), /MAX_LOG_LINES/);
});

test('rejects weak user-supplied bearer tokens', () => {
  assert.throws(() => loadConfig({ POCKETFORGE_TOKEN: 'short-token' }), /at least 24 characters/);
});
