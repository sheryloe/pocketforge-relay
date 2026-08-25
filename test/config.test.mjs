import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { loadConfig } from '../src/config.mjs';

test('uses bounded defaults when optional settings are absent', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8787);
  assert.equal(config.maxConcurrentJobs, 1);
  assert.equal(config.maxQueuedJobs, 20);
  assert.equal(config.maxRetainedJobs, 100);
  assert.equal(config.generatedToken, true);
  assert.equal(config.token.length, 32);
  assert.deepEqual(config.actions, { enabled: false, githubToken: null, targetsFile: null });
  assert.equal(config.deviceActions.enabled, false);
  assert.equal(config.artifactIntegrityKey, null);
});

test('accepts only a canonical 32-byte artifact integrity key', () => {
  const encoded = Buffer.alloc(32, 9).toString('base64url');
  assert.deepEqual(loadConfig({ POCKETFORGE_ARTIFACT_INTEGRITY_KEY: encoded }).artifactIntegrityKey, Buffer.alloc(32, 9));
  assert.throws(() => loadConfig({ POCKETFORGE_ARTIFACT_INTEGRITY_KEY: 'short' }), /at least 32 bytes/);
  assert.throws(() => loadConfig({ POCKETFORGE_ARTIFACT_INTEGRITY_KEY: 'not+base64' }), /canonical base64url/);
});

test('enables Android device actions only with absolute tools, store, and decoded secrets', () => {
  const secret16 = Buffer.alloc(32, 1).toString('base64url');
  const secret32 = Buffer.alloc(32, 2).toString('base64url');
  const env = {
    POCKETFORGE_ADB_PATH: path.resolve('tools/adb.exe'),
    POCKETFORGE_APKANALYZER_PATH: path.resolve('tools/apkanalyzer.bat'),
    POCKETFORGE_APKSIGNER_PATH: path.resolve('tools/apksigner.bat'),
    POCKETFORGE_DEVICE_ACTION_STORE_ROOT: path.resolve('device-actions'),
    POCKETFORGE_DEVICE_ID_SECRET: secret16,
    POCKETFORGE_EVIDENCE_INTEGRITY_KEY: secret32,
  };
  const config = loadConfig(env);
  assert.equal(config.deviceActions.enabled, true);
  assert.deepEqual(config.deviceActions.deviceIdSecret, Buffer.alloc(32, 1));
  assert.equal(config.deviceActions.maxConcurrentActions, 1);
  assert.deepEqual(config.deviceActions.evidenceIntegrityKey, Buffer.alloc(32, 2));
  assert.throws(() => loadConfig({ POCKETFORGE_ADB_PATH: env.POCKETFORGE_ADB_PATH }), /require all/);
  assert.throws(() => loadConfig({ ...env, POCKETFORGE_ADB_PATH: 'relative/adb' }), /absolute trimmed path/);
  assert.throws(() => loadConfig({ ...env, POCKETFORGE_DEVICE_ID_SECRET: 'not+base64' }), /canonical base64url/);
  assert.throws(() => loadConfig({ ...env, MAX_CONCURRENT_DEVICE_ACTIONS: '5' }), /MAX_CONCURRENT_DEVICE_ACTIONS/);
});

test('rejects a build data directory exposed by the public static tree', () => {
  const publicDir=loadConfig({}).publicDir;
  assert.throws(() => loadConfig({POCKETFORGE_DATA_DIR:path.join(publicDir,'jobs')}),/must not overlap the public static directory/);
});

test('rejects an existing data-directory link that resolves into public', async t => {
  const publicDir=loadConfig({}).publicDir;
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pf-public-data-link-'));
  const link=path.join(temp,'linked-data');
  try { await fs.symlink(publicDir,link,process.platform==='win32'?'junction':'dir'); }
  catch(error) { await fs.rm(temp,{recursive:true,force:true}); if(['EPERM','EACCES'].includes(error.code)) return t.skip('Directory links are unavailable.'); throw error; }
  assert.throws(()=>loadConfig({POCKETFORGE_DATA_DIR:link}),/must not overlap the public static directory/);
  await fs.rm(temp,{recursive:true,force:true});
});

test('accepts explicit settings at their supported boundaries', () => {
  const config = loadConfig({
    POCKETFORGE_TOKEN: '123456789012345678901234',
    POCKETFORGE_DATA_DIR: './relay-data',
    HOST: '0.0.0.0',
    PORT: '65535',
    MAX_CONCURRENT_JOBS: '4',
    MAX_QUEUED_JOBS: '1000',
    MAX_RETAINED_JOBS: '10000',
    STEP_TIMEOUT_MS: '1000',
    MAX_LOG_LINES: '20000',
    MAX_ARTIFACT_FILES: '1000',
    MAX_ARTIFACT_BYTES: '1024',
  });
  assert.equal(config.generatedToken, false);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 65535);
  assert.equal(config.maxConcurrentJobs, 4);
  assert.equal(config.maxQueuedJobs, 1000);
  assert.equal(config.maxRetainedJobs, 10000);
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
  assert.throws(() => loadConfig({ MAX_QUEUED_JOBS: '0' }), /MAX_QUEUED_JOBS/);
  assert.throws(() => loadConfig({ MAX_RETAINED_JOBS: '10001' }), /MAX_RETAINED_JOBS/);
  assert.throws(() => loadConfig({ STEP_TIMEOUT_MS: '-1' }), /STEP_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ MAX_LOG_LINES: '1.5' }), /MAX_LOG_LINES/);
});

test('rejects weak user-supplied bearer tokens', () => {
  assert.throws(() => loadConfig({ POCKETFORGE_TOKEN: 'short-token' }), /at least 24 characters/);
});

test('enables GitHub Actions only with a paired server-only token and target file', () => {
  const config = loadConfig({
    POCKETFORGE_GITHUB_TOKEN: 'github_pat_example_token_value',
    POCKETFORGE_ACTIONS_TARGETS_FILE: './config/actions-targets.example.json',
  });
  assert.equal(config.actions.enabled, true);
  assert.equal(config.actions.githubToken, 'github_pat_example_token_value');
  assert.equal(config.actions.targetsFile, path.resolve('./config/actions-targets.example.json'));

  assert.throws(
    () => loadConfig({ POCKETFORGE_GITHUB_TOKEN: 'github_pat_example_token_value' }),
    /must be configured together/,
  );
  assert.throws(
    () => loadConfig({ POCKETFORGE_ACTIONS_TARGETS_FILE: './targets.json' }),
    /must be configured together/,
  );
  assert.throws(
    () => loadConfig({ POCKETFORGE_GITHUB_TOKEN: ' token ', POCKETFORGE_ACTIONS_TARGETS_FILE: './targets.json' }),
    /must be non-empty trimmed text/,
  );
  assert.throws(
    () => loadConfig({ POCKETFORGE_GITHUB_TOKEN: 'token', POCKETFORGE_ACTIONS_TARGETS_FILE: 'targets.json\n' }),
    /non-empty trimmed path/,
  );
});
