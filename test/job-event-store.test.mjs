import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobEventStore, projectJobEvents } from '../src/job-event-store.mjs';

const jobId = '123e4567-e89b-42d3-a456-426614174000';

test('appends bounded job events and reads them after a new store instance starts', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-events-'));
  try {
    const first = new JobEventStore(path.join(sandbox, 'events'));
    await first.append(jobId, { sequence: 1, timestamp: '2026-08-16T00:00:00.000Z', type: 'status', status: 'queued' });
    await first.append(jobId, { schemaVersion: 99, jobId: '123e4567-e89b-42d3-a456-426614174001', sequence: 2, timestamp: '2026-08-16T00:00:01.000Z', type: 'status', status: 'running' });
    await first.flush();
    const recovered = await new JobEventStore(path.join(sandbox, 'events')).read(jobId);
    assert.deepEqual(recovered.map(event => [event.sequence, event.type, event.status]), [[1, 'status', 'queued'], [2, 'status', 'running']]);
    assert.ok(recovered.every(event => event.schemaVersion === 1 && event.jobId === jobId));
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('projects the latest durable state without claiming process recovery', () => {
  const projected = projectJobEvents([
    { jobId, type: 'status', status: 'queued', job: { id: jobId, label: 'Durable demo', sourceType: 'demo', presetId: 'demo-web', createdAt: '2026-08-20T00:00:00.000Z' } },
    { jobId, type: 'step', currentStep: 'Build' },
    { jobId, type: 'log', log: { sequence: 1, channel: 'system', message: 'Started' } },
    { jobId, type: 'artifacts', artifacts: [{ id: '0', sha256: 'a'.repeat(64) }] },
    { jobId, type: 'complete', status: 'succeeded', finishedAt: '2026-08-20T00:00:00.000Z', exitCode: 0, error: null },
  ]);
  assert.equal(projected.id, jobId);
  assert.equal(projected.jobId, jobId);
  assert.equal(projected.label, 'Durable demo');
  assert.equal(projected.sourceType, 'demo');
  assert.equal(projected.presetId, 'demo-web');
  assert.equal(projected.status, 'succeeded');
  assert.equal(projected.currentStep, null);
  assert.equal(projected.recovered, true);
  assert.deepEqual(projected.logs, [{ sequence: 1, channel: 'system', message: 'Started' }]);
  assert.deepEqual(projected.artifacts, [{ id: '0', sha256: 'a'.repeat(64) }]);
  assert.equal(projectJobEvents(null), null);
});

test('deletes only the selected regular event log', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-events-delete-'));
  try {
    const store = new JobEventStore(path.join(sandbox, 'events'));
    await store.append(jobId, { sequence: 1, type: 'complete', status: 'succeeded' });
    await store.flush();
    assert.equal(await store.delete(jobId), true);
    assert.equal(await store.read(jobId), null);
    assert.equal(await store.delete(jobId), false);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('lists only fixed regular event-log names', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-events-list-'));
  try {
    const root = path.join(sandbox, 'events'); const store = new JobEventStore(root);
    await store.append(jobId, { sequence: 1, type: 'status', status: 'queued' }); await store.flush();
    assert.deepEqual(await store.listJobIds(), [jobId]);
    await fs.writeFile(path.join(root, 'unexpected.txt'), 'x');
    await assert.rejects(store.listJobIds(), /unexpected entry/);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('rejects unsafe ids, oversized records, and malformed persisted sequences', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-events-bad-'));
  try {
    const store = new JobEventStore(path.join(sandbox, 'events'), { maxRecordBytes: 256 });
    await assert.rejects(store.read('../escape'), /Job id is malformed/);
    await store.append(jobId, { sequence: 1, timestamp: 'x', type: 'log', log: { message: 'x'.repeat(512) } });
    await assert.rejects(store.flush(), /record is oversized/);
    const root = path.join(sandbox, 'malformed');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, `${jobId}.jsonl`), [
      JSON.stringify({ schemaVersion: 1, jobId, sequence: 2, type: 'status' }),
      JSON.stringify({ schemaVersion: 1, jobId, sequence: 1, type: 'status' }),
    ].join('\n'));
    await assert.rejects(new JobEventStore(root).read(jobId), /log is malformed/);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});
