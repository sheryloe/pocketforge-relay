import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
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
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.match(health.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
    const unauthorized=await fetch(`${base}/api/jobs`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('www-authenticate'),'Bearer realm="PocketForge Relay"');
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

test('HTTP API accepts a protocol-v1 job envelope and rejects unknown versions', async () => {
  const manager = { createJob: body => ({ id: 'job', ...body }) };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/jobs`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  try {
    const accepted = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ schemaVersion: 1, payload: { sourceType: 'demo', presetId: 'demo-web' } }) });
    assert.equal(accepted.status, 202); assert.equal((await accepted.json()).job.presetId, 'demo-web');
    const rejected = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ schemaVersion: 2, payload: {} }) });
    assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /unsupported/);
  } finally { await closeServer(server); }
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

test('static files support HEAD and reject state-changing methods', async () => {
  const server=createPocketForgeServer({config:{publicDir:path.join(root,'public'),token:'test-token'},manager:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/index.html`;
  try {
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))>0);
    const post=await fetch(url,{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
  } finally { await closeServer(server); }
});

test('health supports body-free probes', async () => {
  const server=createPocketForgeServer({config:{publicDir:root,token:'test-token'},manager:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { const response=await fetch(`http://127.0.0.1:${server.address().port}/api/health`,{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('cache-control'),'no-store'); }
  finally { await closeServer(server); }
});

test('health rejects unsupported methods without requesting credentials', async () => {
  const server=createPocketForgeServer({config:{publicDir:root,token:'test-token'},manager:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { const response=await fetch(`http://127.0.0.1:${server.address().port}/api/health`,{method:'POST'});assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');assert.equal(response.headers.get('www-authenticate'),null); }
  finally { await closeServer(server); }
});

test('static files use validators for lightweight mobile refreshes', async () => {
  const server=createPocketForgeServer({config:{publicDir:path.join(root,'public'),token:'test-token'},manager:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/index.html`;
  try {
    const first=await fetch(url);const etag=first.headers.get('etag');assert.match(etag,/^"[0-9a-f]+-[0-9a-f]+"$/);
    const cached=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal(await cached.text(),'');
  } finally { await closeServer(server); }
});

test('JSON endpoints reject an untyped request body', async () => {
  const manager = { createJob() { throw new Error('must not run'); } };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs`, {
      method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'text/plain' }, body: '{}',
    });
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), { error: 'Content-Type must be application/json.' });
  } finally { await closeServer(server); }
});

test('JSON endpoints reject an oversized declared body before reading it', async () => {
  const manager = { createJob() { throw new Error('must not run'); } };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await rawRequest(server, {
      method: 'POST', path: '/api/jobs',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', 'Content-Length': String(64 * 1024 + 1) },
    });
    assert.equal(response.status, 413);
    assert.match(response.body, /too large/);
  } finally { await closeServer(server); }
});

test('HTTP API serves authenticated durable job history', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const manager = { getJobHistory: async value => value === id ? [{ schemaVersion: 1, jobId: id, sequence: 1, type: 'status', status: 'succeeded' }] : null };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/jobs/${id}/history`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).events[0].status, 'succeeded');
  } finally { await closeServer(server); }
});

test('HTTP API serves an authenticated restart projection', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const manager = { getJobProjection: async value => value === id ? { jobId: id, status: 'succeeded' } : null };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${id}/projection`, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job.status, 'succeeded');
  } finally { await closeServer(server); }
});

test('HTTP API lists authenticated durable job projections', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const manager = { listJobHistory: async () => [{ id, status: 'succeeded', recovered: true }] };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/job-history`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).jobs[0].id, id);
  } finally { await closeServer(server); }
});

test('HTTP API requires an explicit decision before deleting terminal history', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  let deleted = false;
  const manager = { deleteJobHistory: async () => { deleted = true; return true; } };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/jobs/${id}/history`;
  try {
    const denied = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'keep' }) });
    assert.equal(denied.status, 400); assert.equal(deleted, false);
    const accepted = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'delete' }) });
    assert.equal(accepted.status, 200); assert.equal(deleted, true);
  } finally { await closeServer(server); }
});

test('HTTP API requires an explicit decision before deleting all terminal job data', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  let deleted = false;
  const manager = { deleteJobData: async () => { deleted = true; return true; } };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/jobs/${id}`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  try {
    const denied = await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ decision: 'keep' }) });
    assert.equal(denied.status, 400); assert.equal(deleted, false);
    const accepted = await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ decision: 'delete' }) });
    assert.equal(accepted.status, 200); assert.equal(deleted, true);
  } finally { await closeServer(server); }
});

test('artifact download publishes the collection-time SHA-256 digest', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-http-artifact-'));
  const file = path.join(sandbox, 'artifact.txt');
  await fs.writeFile(file, 'artifact');
  const manager = { getArtifact: () => ({ absolutePath: file, name: 'artifact.txt', contentType: 'text/plain; charset=utf-8', sha256: 'c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c' }) };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/123e4567-e89b-42d3-a456-426614174000/artifacts/0`, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-artifact-sha256'), 'c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c');
    assert.equal(await response.text(), 'artifact');
  } finally {
    await closeServer(server);
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test('artifact download rejects bytes changed after collection', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-http-tamper-'));
  const file = path.join(sandbox, 'artifact.txt');
  await fs.writeFile(file, 'tampered');
  const manager = { getArtifact: () => ({ absolutePath: file, name: 'artifact.txt', contentType: 'text/plain; charset=utf-8', sha256: 'c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c' }) };
  const server = createPocketForgeServer({ config: { publicDir: root, token: 'test-token' }, manager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/123e4567-e89b-42d3-a456-426614174000/artifacts/0`, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Artifact changed after collection.' });
  } finally {
    await closeServer(server);
    await fs.rm(sandbox, { recursive: true, force: true });
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
    assert.match(body, /"schemaVersion":1/);
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

function rawRequest(server, options) {
  return new Promise((resolve, reject) => {
    const request=http.request({host:'127.0.0.1',port:server.address().port,...options},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error',reject);request.end();
  });
}
