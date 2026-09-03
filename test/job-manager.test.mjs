import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobManager, resolveGitCommit } from '../src/job-manager.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('job creation rejects fields outside the public contract', async () => {
  const manager=new JobManager(makeConfig());
  assert.throws(()=>manager.createJob({sourceType:'demo',presetId:'demo-web',command:'whoami'}),error=>error.statusCode===400&&/Unexpected job field/.test(error.message));
  await manager.shutdown();
});

test('demo jobs reject ignored repository controls', async () => {
  const manager=new JobManager(makeConfig());
  assert.throws(()=>manager.createJob({sourceType:'demo',presetId:'demo-web',repository:'https://github.com/example/example'}),error=>error.statusCode===400&&/Demo jobs/.test(error.message));
  await manager.shutdown();
});

test('bundled demo completes workspace-to-artifact loop with redacted logs', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-jobs-'));
  const manager = new JobManager(makeConfig({ dataDir }));
  try {
    const created = manager.createJob({ sourceType: 'demo', presetId: 'demo-web', label: 'Automated demo' });
    manager.addLog(manager.jobs.get(created.id), 'stdout', `relay=${manager.config.token}`);
    const completed = await waitForFinal(manager, created.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.exitCode, 0);
    assert.ok(completed.logs.some(entry => entry.message === 'relay=[REDACTED]'));
    assert.ok(completed.logs.some(entry => entry.message.includes('Created dist/index.html')));
    assert.ok(completed.artifacts.some(artifact => artifact.relativePath === 'dist/index.html'));
    assert.ok(completed.artifacts.some(artifact => artifact.relativePath === '.pocketforge-result/build-summary.json'));
  } finally {
    await manager.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('queue capacity rejects excess work and async shutdown waits for the active process', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-shutdown-'));
  const dataDir = path.join(sandbox, 'data');
  const examplesDir = path.join(sandbox, 'examples');
  await fs.mkdir(path.join(examplesDir, 'hello-web'), { recursive: true });
  await fs.writeFile(path.join(examplesDir, 'hello-web', 'build.mjs'), 'setTimeout(() => {}, 30000);\n');
  const manager = new JobManager(makeConfig({ dataDir, examplesDir, maxQueuedJobs: 1 }));
  try {
    const active = manager.createJob({ sourceType: 'demo', presetId: 'demo-web' });
    await waitForStatus(manager, active.id, 'running');
    const queued = manager.createJob({ sourceType: 'demo', presetId: 'demo-web' });
    assert.equal(manager.getJob(queued.id).status, 'queued');
    assert.throws(
      () => manager.createJob({ sourceType: 'demo', presetId: 'demo-web' }),
      error => error.statusCode === 429 && /queue is full/.test(error.message),
    );
    await manager.shutdown();
    assert.equal(manager.activeCount, 0);
    assert.equal(manager.getJob(active.id).status, 'cancelled');
    assert.equal(manager.getJob(queued.id).status, 'cancelled');
    await fs.access(path.join(dataDir, 'jobs', active.id, 'source', '.pocketforge-result', 'build-summary.json'));
    assert.throws(
      () => manager.createJob({ sourceType: 'demo', presetId: 'demo-web' }),
      error => error.statusCode === 503 && /shutting down/.test(error.message),
    );
  } finally {
    await manager.shutdown();
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test('retention evicts only old completed records and leaves their artifact files intact', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-retention-'));
  const manager = new JobManager(makeConfig({ dataDir, maxRetainedJobs: 1 }));
  try {
    const first = manager.createJob({ sourceType: 'demo', presetId: 'demo-web' });
    await waitForFinal(manager, first.id);
    const artifactPath = path.join(dataDir, 'jobs', first.id, 'source', 'dist', 'index.html');
    await fs.access(artifactPath);
    const second = manager.createJob({ sourceType: 'demo', presetId: 'demo-web' });
    await waitForFinal(manager, second.id);
    assert.equal(manager.getJob(first.id), null);
    assert.equal(manager.getJob(second.id).status, 'succeeded');
    assert.equal(manager.listJobs().length, 1);
    await fs.access(artifactPath);
  } finally {
    await manager.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('resolves a cloned source to one exact commit with fixed git arguments', async () => {
  const calls=[];
  const commit='A'.repeat(40);
  const result=await resolveGitCommit({
    sourceDir:path.resolve('source'),timeoutMs:1000,signal:new AbortController().signal,onLog:()=>{},
    runStep:async request=>{calls.push(request);request.onLog('stdout',commit);return{code:0};},
  });
  assert.equal(result,'a'.repeat(40));
  assert.deepEqual(calls[0].step,{name:'Resolve cloned commit',command:'git',args:['rev-parse','--verify','HEAD^{commit}']});
  await assert.rejects(resolveGitCommit({
    sourceDir:path.resolve('source'),timeoutMs:1000,signal:new AbortController().signal,onLog:()=>{},
    runStep:async request=>{request.onLog('stdout','main');},
  }),/exact Git commit/);
});

test('completed job history remains readable after the manager restarts', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-history-'));
  const first = new JobManager(makeConfig({ dataDir }));
  let id;
  try {
    id = first.createJob({ sourceType: 'demo', presetId: 'demo-web', label: 'Restarted demo' }).id;
    await waitForFinal(first, id);
    await first.shutdown();
    const second = new JobManager(makeConfig({ dataDir }));
    try {
      assert.equal(second.getJob(id), null);
      const history = await second.getJobHistory(id);
      assert.equal(history[0].status, 'queued');
      assert.equal(history.at(-1).type, 'complete');
      assert.equal(history.at(-1).status, 'succeeded');
      const jobs = await second.listJobHistory();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].id, id);
      assert.equal(jobs[0].label, 'Restarted demo');
      assert.equal(jobs[0].recovered, true);
      assert.equal(jobs[0].status, 'succeeded');
      assert.ok(jobs[0].logs.some(entry => entry.message.includes('Created dist/index.html')));
      const htmlArtifact = jobs[0].artifacts.find(candidate => candidate.relativePath === 'dist/index.html');
      const artifact = await second.getArtifact(id, htmlArtifact.id);
      assert.equal((await fs.readFile(artifact.absolutePath, 'utf8')).includes('<!doctype html>'), true);
    } finally { await second.shutdown(); }
  } finally {
    await first.shutdown();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('deletes one terminal job workspace, snapshots, and durable history together', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-delete-job-'));
  const manager = new JobManager(makeConfig({ dataDir }));
  try {
    const id = manager.createJob({ sourceType: 'demo', presetId: 'demo-web', label: 'Delete me' }).id;
    await waitForFinal(manager, id);
    await fs.access(path.join(dataDir, 'jobs', id));
    await fs.access(path.join(dataDir, 'artifact-snapshots', id));
    assert.equal(await manager.deleteJobData(id), true);
    assert.equal(manager.getJob(id), null);
    assert.equal(await manager.getJobHistory(id), null);
    await assert.rejects(fs.access(path.join(dataDir, 'jobs', id)), error => error.code === 'ENOENT');
    await assert.rejects(fs.access(path.join(dataDir, 'artifact-snapshots', id)), error => error.code === 'ENOENT');
    assert.equal(await manager.deleteJobData(id), false);
  } finally { await manager.shutdown(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('refuses full deletion for a non-terminal durable job', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-delete-active-'));
  const manager = new JobManager(makeConfig({ dataDir }));
  const id = '123e4567-e89b-42d3-a456-426614174000';
  try {
    await manager.eventStore.append(id, { sequence: 1, timestamp: '2026-08-25T00:00:00.000Z', type: 'status', status: 'running' });
    await manager.eventStore.flush();
    await assert.rejects(manager.deleteJobData(id), error => error.statusCode === 409 && /terminal/.test(error.message));
    assert.equal((await manager.getJobProjection(id)).status, 'running');
  } finally { await manager.shutdown(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('startup finalizes a durable non-terminal history as interrupted', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-interrupted-'));
  const manager = new JobManager(makeConfig({ dataDir }));
  const id = '123e4567-e89b-42d3-a456-426614174000';
  try {
    await manager.eventStore.append(id, { sequence: 1, timestamp: '2026-08-25T00:00:00.000Z', type: 'status', status: 'running' });
    await manager.eventStore.flush();
    assert.equal(await manager.recoverInterruptedJobs(), 1);
    const projection = await manager.getJobProjection(id);
    assert.equal(projection.status, 'failed');
    assert.equal(projection.interrupted, true);
    assert.equal(projection.error, 'Relay restarted before job completion.');
    assert.equal(await manager.recoverInterruptedJobs(), 0);
  } finally { await manager.shutdown(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

function makeConfig(overrides = {}) {
  return {
    dataDir: overrides.dataDir,
    examplesDir: overrides.examplesDir || path.join(root, 'examples'),
    token: 'relay-token-12345678901234567890',
    maxConcurrentJobs: 1,
    maxQueuedJobs: 20,
    maxRetainedJobs: 100,
    stepTimeoutMs: 30_000,
    maxLogLines: 1_000,
    maxArtifactFiles: 20,
    maxArtifactBytes: 2 * 1024 * 1024,
    ...overrides,
  };
}

async function waitForStatus(manager, id, status) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (manager.getJob(id)?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${status}.`);
}

async function waitForFinal(manager, id) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const job = manager.getJob(id);
    if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for final job state.');
}
