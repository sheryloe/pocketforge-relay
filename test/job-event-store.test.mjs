import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobEventStore } from '../src/job-event-store.mjs';

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
