import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPocketForgeServer } from '../src/http-app.mjs';
import { JobManager } from '../src/job-manager.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('HTTP API authenticates and accepts demo job', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-http-'));
  const config = {
    rootDir: root,
    publicDir: path.join(root, 'public'),
    examplesDir: path.join(root, 'examples'),
    dataDir,
    token: 'test-token',
    maxConcurrentJobs: 1,
    maxQueuedJobs: 20,
    maxRetainedJobs: 100,
    stepTimeoutMs: 30_000,
    maxLogLines: 1_000,
    maxArtifactFiles: 20,
    maxArtifactBytes: 2 * 1024 * 1024,
  };
  const manager = new JobManager(config);
  const server = createPocketForgeServer({ config, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/jobs`)).status, 401);
    const capabilitiesResponse = await fetch(`${base}/api/capabilities`, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(capabilitiesResponse.status, 200);
    const capabilities = await capabilitiesResponse.json();
    assert.equal(capabilities.protocolVersion, 1);
    assert.equal(capabilities.adapters.find(adapter => adapter.id === 'ai-agent').enabled, false);
    const response = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'demo', presetId: 'demo-web' }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.ok(['queued', 'preparing', 'running', 'succeeded'].includes(payload.job.status));
    assert.match(payload.job.id, /^[0-9a-f-]{36}$/i);
  } finally {
    await manager.shutdown();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('HTTP API preserves admission-control status codes', async () => {
  const config = {
    publicDir: path.join(root, 'public'),
    token: 'test-token',
  };
  const manager = {
    createJob() {
      const error = new Error('Job queue is full.');
      error.statusCode = 429;
      throw error;
    },
  };
  const server = createPocketForgeServer({ config, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'demo', presetId: 'demo-web' }),
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'Job queue is full.' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('SSE ends completed snapshots without retaining a subscription', async () => {
  const snapshot = { id: '00000000-0000-0000-0000-000000000001', status: 'succeeded' };
  const manager = {
    getJob: () => snapshot,
    subscribe() { throw new Error('Completed jobs must not be subscribed.'); },
  };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${snapshot.id}/events`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(response.status, 200);
    const body = await within(response.text());
    assert.match(body, /event: snapshot/);
    assert.match(body, /"status":"succeeded"/);
  } finally {
    await closeServer(server);
  }
});

test('SSE sends complete, unsubscribes, and releases the connection', async () => {
  const snapshot = { id: '00000000-0000-0000-0000-000000000002', status: 'running' };
  let listener;
  let unsubscribeCount = 0;
  const manager = {
    getJob: () => snapshot,
    subscribe(_id, next) { listener = next; return () => { unsubscribeCount++; }; },
  };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${snapshot.id}/events`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    listener({ type: 'complete', job: { ...snapshot, status: 'succeeded' } });
    const body = await within(response.text());
    assert.match(body, /event: complete/);
    assert.equal(unsubscribeCount, 1);
  } finally {
    await closeServer(server);
  }
});

test('server shutdown closes an active SSE stream before waiting for close', async () => {
  const snapshot = { id: '00000000-0000-0000-0000-000000000003', status: 'running' };
  let unsubscribeCount = 0;
  const manager = {
    getJob: () => snapshot,
    subscribe: () => () => { unsubscribeCount++; },
  };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${snapshot.id}/events`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeEventStreams();
  await within(Promise.all([closed, response.text()]));
  assert.equal(unsubscribeCount, 1);
});

async function closeServer(server) {
  server.closeEventStreams?.();
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function within(promise, timeoutMs = 2_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for HTTP completion.')), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
