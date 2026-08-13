import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseActionTargets } from '../src/action-targets.mjs';
import { GitHubActionsError } from '../src/github-actions-client.mjs';
import { ActionApprovalError, ActionApprovalStore, GitHubActionsRunnerAdapter } from '../src/github-actions-runner.mjs';

function catalog() {
  return parseActionTargets({
    schemaVersion: 1,
    targets: [{
      id: 'android-debug',
      name: 'Android debug APK',
      repository: 'https://github.com/example/mobile-app',
      workflow: 'pocketforge-android.yml',
      refs: ['main'],
      inputs: { variant: 'debug' },
      artifactNames: ['app-debug-apk'],
    }],
  });
}

test('approval is explicit, bounded, expiring, and single-use', () => {
  let now = Date.parse('2026-08-13T00:00:00Z');
  let sequence = 0;
  const store = new ActionApprovalStore({
    catalog: catalog(),
    ttlMs: 30_000,
    maxPending: 1,
    now: () => now,
    randomId: () => `approval_${String(++sequence).padStart(20, '0')}`,
  });
  const approval = store.create({ targetId: 'android-debug', ref: 'main', label: 'Phone review' });
  assert.equal(approval.target.repository, 'https://github.com/example/mobile-app');
  assert.equal(approval.target.inputs.variant, 'debug');
  assert.throws(() => store.create({ targetId: 'android-debug', ref: 'main' }), error => error.code === 'approval_limit');
  assert.throws(() => store.consume(approval.id, 'yes'), error => error.code === 'approval_decision');
  const consumed = store.consume(approval.id, 'approve');
  assert.equal(consumed.target.ref, 'main');
  assert.throws(() => store.consume(approval.id, 'approve'), error => error.code === 'approval_not_found');

  const expiring = store.create({ targetId: 'android-debug', ref: 'main' });
  now += 30_000;
  assert.throws(() => store.consume(expiring.id, 'approve'), error => error instanceof ActionApprovalError && error.code === 'approval_expired');
});

test('approved run dispatches once, maps remote steps, and collects ZIP evidence without extracting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-runner-'));
  const events = [];
  const calls = [];
  let polls = 0;
  const client = fakeClient({
    dispatchWorkflow: async input => {
      calls.push(['dispatch', input]);
      return { runId: 123, runUrl: 'https://api.github.com/repos/example/mobile-app/actions/runs/123', htmlUrl: 'https://github.com/example/mobile-app/actions/runs/123' };
    },
    getWorkflowRun: async () => {
      polls += 1;
      if (polls === 1) return { notModified: false, etag: '"1"', pollIntervalMs: null, run: remoteRun('in_progress', null) };
      return { notModified: false, etag: '"2"', pollIntervalMs: null, run: remoteRun('completed', 'success') };
    },
    listWorkflowJobs: async () => [{ id: 77, name: 'build', status: 'in_progress', conclusion: null, steps: [{ number: 1, name: 'Assemble', status: 'in_progress', conclusion: null }] }],
    listRunArtifacts: async () => [{ id: 44, name: 'app-debug-apk', size: 50, expired: false, digest: 'sha256:github' }],
    downloadRunLogs: async ({ destination }) => {
      await fs.writeFile(destination, 'logs');
      return { path: destination, size: 4, sha256: 'logs-sha' };
    },
    downloadArtifact: async ({ destination }) => {
      await fs.writeFile(destination, 'apk-zip');
      return { path: destination, size: 7, sha256: 'artifact-sha' };
    },
  });
  const adapter = new GitHubActionsRunnerAdapter({
    client,
    catalog: catalog(),
    pollIntervalMs: 1000,
    runTimeoutMs: 10_000,
    maxArtifactFiles: 5,
    maxArtifactBytes: 4096,
    sleep: async () => {},
  });
  try {
    const approval = adapter.createApproval({ targetId: 'android-debug', ref: 'main', label: 'Phone approved' });
    assert.equal(calls.length, 0, 'approval preview must not perform a GitHub write');
    const result = await adapter.runApproved({
      approvalId: approval.id,
      decision: 'approve',
      jobId: 'job-123',
      workspace: directory,
      onEvent: event => events.push(event),
    });
    assert.equal(calls.length, 1);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.remoteConclusion, 'success');
    assert.equal(result.artifacts.length, 2);
    assert.equal(result.artifacts[0].relativePath, 'remote/github-actions-123-logs.zip');
    assert.equal(result.artifacts[1].name, '44-app-debug-apk.zip');
    assert.ok(events.some(event => event.type === 'status' && event.status === 'dispatching'));
    assert.ok(events.some(event => event.type === 'step' && event.currentStep === 'build: Assemble'));
    assert.ok(events.some(event => event.type === 'complete'));
    assert.throws(() => adapter.createApproval({ targetId: 'android-debug', ref: 'feature/untrusted' }), /not allowlisted/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('ambiguous dispatch becomes needs_attention and never enters polling', async () => {
  let polls = 0;
  const client = fakeClient({
    dispatchWorkflow: async () => {
      throw new GitHubActionsError('Workflow dispatch outcome is unknown; it was not retried.', { code: 'dispatch_unknown', cause: new Error('secret transport details') });
    },
    getWorkflowRun: async () => {
      polls += 1;
      throw new Error('must not poll');
    },
  });
  const adapter = new GitHubActionsRunnerAdapter({ client, catalog: catalog(), pollIntervalMs: 1000, runTimeoutMs: 5000 });
  const approval = adapter.createApproval({ targetId: 'android-debug', ref: 'main' });
  const result = await adapter.runApproved({
    approvalId: approval.id,
    decision: 'approve',
    jobId: 'job-unknown',
    workspace: path.resolve(os.tmpdir(), 'pf-actions-unknown'),
  });
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.errorCode, 'dispatch_unknown');
  assert.equal(result.error.includes('secret transport details'), false);
  assert.equal(polls, 0);
});

test('observer failure after dispatch preserves the remote run and cannot replay approval', async () => {
  let dispatches = 0;
  let polls = 0;
  const client = fakeClient({
    dispatchWorkflow: async () => {
      dispatches += 1;
      return { runId: 123, runUrl: 'https://api.github.com/repos/example/mobile-app/actions/runs/123', htmlUrl: 'https://github.com/example/mobile-app/actions/runs/123' };
    },
    getWorkflowRun: async () => {
      polls += 1;
      throw new Error('must not poll after observer failure');
    },
  });
  const adapter = new GitHubActionsRunnerAdapter({ client, catalog: catalog(), pollIntervalMs: 1000, runTimeoutMs: 5000 });
  const approval = adapter.createApproval({ targetId: 'android-debug', ref: 'main' });
  const result = await adapter.runApproved({
    approvalId: approval.id,
    decision: 'approve',
    jobId: 'job-observer-failed',
    workspace: path.resolve(os.tmpdir(), 'pf-actions-observer-failed'),
    onEvent: event => {
      if (event.type === 'remote') throw new Error('mobile observer disconnected');
    },
  });
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.errorCode, 'observer_callback_failed');
  assert.equal(result.remoteRunId, 123);
  assert.equal(result.remoteUrl, 'https://github.com/example/mobile-app/actions/runs/123');
  assert.equal(dispatches, 1);
  assert.equal(polls, 0);
  await assert.rejects(
    adapter.runApproved({ approvalId: approval.id, decision: 'approve', jobId: 'job-replay', workspace: path.resolve(os.tmpdir(), 'pf-actions-replay') }),
    error => error instanceof ActionApprovalError && error.code === 'approval_not_found',
  );
  assert.equal(dispatches, 1);
});

test('successful remote run without required evidence becomes needs_attention', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-missing-'));
  const client = fakeClient({
    dispatchWorkflow: async () => ({ runId: 123, runUrl: 'https://api.github.com/repos/example/mobile-app/actions/runs/123', htmlUrl: 'https://github.com/example/mobile-app/actions/runs/123' }),
    getWorkflowRun: async () => ({ notModified: false, etag: null, pollIntervalMs: null, run: remoteRun('completed', 'success') }),
    downloadRunLogs: async ({ destination }) => {
      await fs.writeFile(destination, 'logs');
      return { path: destination, size: 4, sha256: 'logs-sha' };
    },
    listRunArtifacts: async () => [],
  });
  const adapter = new GitHubActionsRunnerAdapter({ client, catalog: catalog(), pollIntervalMs: 1000, runTimeoutMs: 5000, maxArtifactBytes: 4096 });
  try {
    const approval = adapter.createApproval({ targetId: 'android-debug', ref: 'main' });
    const result = await adapter.runApproved({ approvalId: approval.id, decision: 'approve', jobId: 'job-no-evidence', workspace: directory });
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.remoteConclusion, 'success');
    assert.equal(result.errorCode, 'evidence_collection_failed');
    assert.equal(result.error, 'GitHub Actions runner operation failed.');
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].relativePath, 'remote/github-actions-123-logs.zip');
    assert.equal(await fs.readFile(result.artifacts[0].absolutePath, 'utf8'), 'logs');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('cancel delegates only a remote run created and retained by this adapter instance', async () => {
  const calls = [];
  const client = fakeClient({
    dispatchWorkflow: async () => ({ runId: 123, runUrl: 'https://api.github.com/repos/example/mobile-app/actions/runs/123', htmlUrl: 'https://github.com/example/mobile-app/actions/runs/123' }),
    cancelWorkflowRun: async input => {
      calls.push(input);
      return { accepted: true, alreadyFinished: false };
    },
  });
  const adapter = new GitHubActionsRunnerAdapter({ client, catalog: catalog(), pollIntervalMs: 1000, runTimeoutMs: 5000 });
  const approval = adapter.createApproval({ targetId: 'android-debug', ref: 'main' });
  const run = await adapter.runApproved({
    approvalId: approval.id,
    decision: 'approve',
    jobId: 'job-to-cancel',
    workspace: path.resolve(os.tmpdir(), 'pf-actions-cancel'),
    onEvent: event => {
      if (event.type === 'remote') throw new Error('stop observation but retain ownership');
    },
  });
  assert.equal(run.status, 'needs_attention');
  await assert.rejects(
    adapter.cancelRemote({ targetId: 'android-debug', ref: 'main', runId: 124 }),
    error => error instanceof ActionApprovalError && error.code === 'run_not_owned',
  );
  const result = await adapter.cancelRemote({ targetId: 'android-debug', ref: 'main', runId: 123 });
  assert.equal(result.accepted, true);
  assert.deepEqual(calls[0], { owner: 'example', repo: 'mobile-app', runId: 123, signal: undefined });
  await assert.rejects(
    adapter.cancelRemote({ targetId: 'android-debug', ref: 'main', runId: 123 }),
    error => error instanceof ActionApprovalError && error.code === 'run_not_owned',
  );
});

function fakeClient(overrides = {}) {
  const defaults = {
    dispatchWorkflow: async () => { throw new Error('not configured'); },
    getWorkflowRun: async () => { throw new Error('not configured'); },
    listWorkflowJobs: async () => [],
    listRunArtifacts: async () => [],
    downloadRunLogs: async () => { throw new Error('not configured'); },
    downloadArtifact: async () => { throw new Error('not configured'); },
    cancelWorkflowRun: async () => ({ accepted: true, alreadyFinished: false }),
  };
  return { ...defaults, ...overrides };
}

function remoteRun(status, conclusion) {
  return {
    id: 123,
    status,
    conclusion,
    htmlUrl: 'https://github.com/example/mobile-app/actions/runs/123',
    runAttempt: 1,
    headBranch: 'main',
    headSha: 'a'.repeat(40),
    workflowId: 456,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:01Z',
  };
}
