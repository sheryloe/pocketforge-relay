import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPocketForgeServer } from '../src/http-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'test-actions-token';
const id = '33333333-3333-4333-8333-333333333333';

test('Actions routes remain authenticated and disabled by default', async () => {
  const server = createPocketForgeServer({ config: { publicDir: root, token }, manager: {} });
  const base = await listen(server);
  try {
    assert.equal((await fetch(`${base}/api/actions/targets`)).status, 401);
    const targets = await request(base, '/api/actions/targets');
    assert.equal(targets.response.status, 200);
    assert.deepEqual(targets.body, { enabled: false, targets: [] });
    const approval = await request(base, '/api/actions/approvals', { method: 'POST', body: {} });
    assert.equal(approval.response.status, 503);
    assert.equal(approval.body.code, 'actions_disabled');
  } finally {
    await close(server);
  }
});

test('Actions HTTP contract exposes public state and bounded artifact downloads', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-http-'));
  const artifactPath = path.join(directory, 'evidence.zip');
  await fs.writeFile(artifactPath, 'verified zip');
  const calls = [];
  const publicRun = {
    id,
    label: 'Phone review',
    targetId: 'android-debug',
    repository: 'https://github.com/example/mobile',
    ref: 'main',
    workflow: 'android.yml',
    status: 'running',
    createdAt: '2026-08-13T00:00:00.000Z',
    startedAt: '2026-08-13T00:00:00.000Z',
    finishedAt: null,
    currentStep: 'build: assemble',
    remoteRunId: 42,
    remoteUrl: 'https://github.com/example/mobile/actions/runs/42',
    remoteStatus: 'in_progress',
    remoteConclusion: null,
    cancelRequested: false,
    errorCode: null,
    error: null,
    logs: [],
    artifacts: [{ id: '0', name: 'evidence.zip', relativePath: 'remote/evidence.zip', size: 12, contentType: 'application/zip', sha256: 'abc', githubDigest: null, sourceName: 'logs' }],
  };
  const actionsManager = {
    listTargets: () => [{ id: 'android-debug', name: 'Android debug', repository: 'https://github.com/example/mobile', workflow: 'android.yml', refs: ['main'], inputs: {}, artifactNames: [] }],
    createApproval: body => {
      calls.push(['approval', body]);
      return { id: 'approval_00000000000000000001', createdAt: '2026-08-13T00:00:00.000Z', expiresAt: '2026-08-13T00:05:00.000Z', label: body.label, target: { id: body.targetId, ref: body.ref } };
    },
    createRun: body => { calls.push(['run', body]); return publicRun; },
    listRuns: () => [publicRun],
    getRun: runId => runId === id ? publicRun : null,
    cancelRun: async runId => { calls.push(['cancel', runId]); return runId === id ? { ...publicRun, cancelRequested: true } : null; },
    getArtifact: (runId, artifactId) => runId === id && artifactId === '0'
      ? { id: '0', name: 'evidence.zip', absolutePath: artifactPath, contentType: 'application/zip' }
      : null,
  };
  const server = createPocketForgeServer({ config: { publicDir: root, token }, manager: {}, actionsManager });
  const base = await listen(server);
  try {
    const targets = await request(base, '/api/actions/targets');
    assert.equal(targets.body.enabled, true);
    assert.equal(targets.body.targets[0].id, 'android-debug');

    const approval = await request(base, '/api/actions/approvals', {
      method: 'POST',
      body: { targetId: 'android-debug', ref: 'main', label: 'Phone review' },
    });
    assert.equal(approval.response.status, 201);
    assert.equal(approval.body.approval.target.id, 'android-debug');

    const run = await request(base, '/api/actions/runs', {
      method: 'POST',
      body: { approvalId: approval.body.approval.id, decision: 'approve' },
    });
    assert.equal(run.response.status, 202);
    assert.equal(run.body.run.id, id);
    assert.equal(JSON.stringify(run.body).includes(artifactPath), false);

    const listed = await request(base, '/api/actions/runs');
    assert.equal(listed.body.runs.length, 1);
    const fetched = await request(base, `/api/actions/runs/${id}`);
    assert.equal(fetched.body.run.remoteRunId, 42);

    const invalidCancel = await request(base, `/api/actions/runs/${id}/cancel`, { method: 'POST', body: { runId: 99 } });
    assert.equal(invalidCancel.response.status, 400);
    assert.equal(invalidCancel.body.code, 'actions_input');
    const cancelled = await request(base, `/api/actions/runs/${id}/cancel`, { method: 'POST', body: {} });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.run.cancelRequested, true);

    const artifact = await fetch(`${base}/api/actions/runs/${id}/artifacts/0`, { headers: authHeaders() });
    assert.equal(artifact.status, 200);
    assert.equal(artifact.headers.get('content-type'), 'application/zip');
    assert.equal(await artifact.text(), 'verified zip');

    const unexpected = await request(base, '/api/actions/approvals', { method: 'POST', body: { targetId: 'android-debug', ref: 'main', secret: 'no' } });
    assert.equal(unexpected.response.status, 400);
    assert.equal(unexpected.body.code, 'actions_input');
    const oversized = await fetch(`${base}/api/actions/approvals`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 'android-debug', ref: 'main', label: 'x'.repeat(20_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(calls.map(call => call[0]), ['approval', 'run', 'cancel']);
  } finally {
    await close(server);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeEventStreams?.();
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function request(base, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { ...authHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
