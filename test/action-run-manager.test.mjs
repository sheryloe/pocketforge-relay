import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ActionRunManager, createActionsRuntime } from '../src/action-run-manager.mjs';

const runId = '11111111-1111-4111-8111-111111111111';
const relayToken = 'relay-secret-123456789012345';
const githubToken = 'github_pat_manager_secret_1234567890';

test('runtime loads the bounded target catalog without contacting GitHub', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-runtime-'));
  let networkCalls = 0;
  const config = {
    dataDir,
    token: relayToken,
    maxConcurrentJobs: 1,
    maxRetainedJobs: 10,
    maxLogLines: 100,
    maxArtifactFiles: 10,
    maxArtifactBytes: 4096,
    actions: {
      enabled: true,
      githubToken,
      targetsFile: path.resolve('config/actions-targets.example.json'),
    },
  };
  const manager = await createActionsRuntime(config, { fetchImpl: async () => { networkCalls++; throw new Error('must not run'); } });
  try {
    const targets = manager.listTargets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, 'android-debug');
    assert.equal(networkCalls, 0);
  } finally {
    await manager.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('manager owns workspaces and exposes only redacted public run data', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-manager-'));
  let workspace;
  const adapter = fakeAdapter({
    runApproved: async input => {
      workspace = input.workspace;
      const artifactPath = path.join(workspace, 'evidence.zip');
      await fs.writeFile(artifactPath, 'zip');
      await input.onEvent({ type: 'remote', runId: 42, htmlUrl: 'https://github.com/example/mobile/actions/runs/42' });
      await input.onEvent({ type: 'status', status: 'running', remoteStatus: 'in_progress', remoteConclusion: null });
      await input.onEvent({ type: 'step', currentStep: 'build: assemble' });
      await input.onEvent({ type: 'log', channel: 'system', message: `token=${githubToken}` });
      return {
        jobId: input.jobId,
        label: 'Phone review',
        targetId: 'android-debug',
        repository: 'https://github.com/example/mobile',
        ref: 'main',
        workflow: 'android.yml',
        status: 'succeeded',
        remoteRunId: 42,
        remoteUrl: 'https://github.com/example/mobile/actions/runs/42',
        remoteStatus: 'completed',
        remoteConclusion: 'success',
        artifacts: [{ id: '0', name: 'evidence.zip', relativePath: 'remote/evidence.zip', absolutePath: artifactPath, size: 3, contentType: 'application/zip', sha256: 'abc', githubDigest: null, sourceName: 'logs' }],
        errorCode: null,
        error: null,
      };
    },
  });
  const manager = new ActionRunManager({
    adapter,
    dataDir,
    maxLogLines: 100,
    secrets: [relayToken, githubToken],
    randomId: () => runId,
  });
  try {
    const approval = manager.createApproval({ targetId: 'android-debug', ref: 'main', label: 'Phone review' });
    const initial = manager.createRun({ approvalId: approval.id, decision: 'approve' });
    assert.equal(initial.id, runId);
    assert.equal(initial.status, 'dispatching');
    const completed = await waitFor(() => manager.getRun(runId)?.finishedAt && manager.getRun(runId));
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.remoteRunId, 42);
    assert.equal(completed.artifacts[0].relativePath, 'remote/evidence.zip');
    assert.equal(Object.hasOwn(completed.artifacts[0], 'absolutePath'), false);
    assert.equal(JSON.stringify(completed).includes(githubToken), false);
    assert.match(completed.logs[0].message, /\[REDACTED\]/);
    assert.equal(workspace, path.join(dataDir, 'action-runs', runId));
    assert.equal(manager.getArtifact(runId, '0').absolutePath, path.join(workspace, 'evidence.zip'));
  } finally {
    await manager.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('manager bounds active runs and aborts an undispatched run', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-capacity-'));
  let approvalSequence = 0;
  let runSequence = 0;
  const adapter = fakeAdapter({
    createApproval: input => approval(`approval_${String(++approvalSequence).padStart(20, '0')}`, input.label),
    runApproved: ({ jobId, signal }) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({
        jobId,
        label: '',
        targetId: 'android-debug',
        repository: 'https://github.com/example/mobile',
        ref: 'main',
        workflow: 'android.yml',
        status: 'failed',
        remoteRunId: null,
        remoteUrl: null,
        remoteStatus: null,
        remoteConclusion: null,
        artifacts: [],
        errorCode: 'dispatch_rejected',
        error: 'GitHub Actions runner operation failed.',
      }), { once: true });
    }),
  });
  const manager = new ActionRunManager({
    adapter,
    dataDir,
    maxConcurrentRuns: 1,
    maxLogLines: 100,
    randomId: () => `22222222-2222-4222-8222-${String(++runSequence).padStart(12, '0')}`,
  });
  try {
    const firstApproval = manager.createApproval({ targetId: 'android-debug', ref: 'main' });
    const first = manager.createRun({ approvalId: firstApproval.id, decision: 'approve' });
    const secondApproval = manager.createApproval({ targetId: 'android-debug', ref: 'main' });
    assert.throws(
      () => manager.createRun({ approvalId: secondApproval.id, decision: 'approve' }),
      error => error.statusCode === 429 && error.code === 'actions_capacity',
    );
    const cancelling = await manager.cancelRun(first.id);
    assert.equal(cancelling.cancelRequested, true);
    const completed = await waitFor(() => manager.getRun(first.id)?.finishedAt && manager.getRun(first.id));
    assert.equal(completed.status, 'cancelled');
    assert.equal(completed.errorCode, 'cancelled_before_dispatch');
    await manager.shutdown();
    await manager.shutdown();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

function fakeAdapter(overrides = {}) {
  return {
    listTargets: () => [{ id: 'android-debug', name: 'Android debug', repository: 'https://github.com/example/mobile', workflow: 'android.yml', refs: ['main'], inputs: {}, artifactNames: [] }],
    createApproval: input => approval('approval_00000000000000000001', input.label),
    runApproved: async () => { throw new Error('not configured'); },
    cancelRemote: async () => ({ accepted: true, alreadyFinished: false }),
    ...overrides,
  };
}

function approval(id, label = '') {
  return {
    id,
    createdAt: '2026-08-13T00:00:00.000Z',
    expiresAt: '2099-08-13T00:05:00.000Z',
    label: label ?? '',
    target: { id: 'android-debug', name: 'Android debug', repository: 'https://github.com/example/mobile', workflow: 'android.yml', ref: 'main', inputs: {}, artifactNames: [] },
  };
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for action run completion.');
}
