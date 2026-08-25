import fs from 'node:fs/promises';
import path from 'node:path';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(['status', 'step', 'log', 'artifacts', 'complete']);

export class JobEventStore {
  constructor(root, { maxBytesPerJob = 2 * 1024 * 1024, maxRecordBytes = 16 * 1024 } = {}) {
    if (!path.isAbsolute(root)) throw new Error('Job event store must use an absolute path.');
    this.root = root;
    this.maxBytesPerJob = maxBytesPerJob;
    this.maxRecordBytes = maxRecordBytes;
    this.pending = Promise.resolve();
    this.firstError = null;
  }

  append(jobId, event) {
    this.pending = this.pending.catch(() => {}).then(() => this.#append(jobId, event)).catch(error => {
      this.firstError ||= error;
    });
    return this.pending;
  }

  async flush() {
    await this.pending;
    if (this.firstError) throw this.firstError;
  }

  async read(jobId) {
    const file = this.#file(jobId);
    let before;
    try { before = await fs.lstat(file); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || before.size > this.maxBytesPerJob) throw new Error('Job event log is unsafe or oversized.');
    const handle = await fs.open(file, 'r');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Job event log changed before reading.');
      const text = await handle.readFile('utf8');
      let previous = 0;
      return text.trimEnd().split('\n').filter(Boolean).map(line => {
        if (Buffer.byteLength(line) > this.maxRecordBytes) throw new Error('Job event record is oversized.');
        const record = JSON.parse(line);
        if (record.schemaVersion !== 1 || record.jobId !== jobId || !EVENT_TYPES.has(record.type)
          || !Number.isSafeInteger(record.sequence) || record.sequence <= previous) throw new Error('Job event log is malformed.');
        previous = record.sequence;
        return record;
      });
    } finally { await handle.close(); }
  }

  async delete(jobId) {
    const file = this.#file(jobId);
    let before;
    try { before = await fs.lstat(file); }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('Job event log is unsafe.');
    await fs.unlink(file);
    return true;
  }

  async #append(jobId, event) {
    const file = this.#file(jobId);
    await fs.mkdir(this.root, { recursive: true });
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Job event store root is unsafe.');
    const record = { ...event, schemaVersion: 1, jobId };
    if (!EVENT_TYPES.has(record.type) || !Number.isSafeInteger(record.sequence) || record.sequence < 1) throw new Error('Job event record is malformed.');
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > this.maxRecordBytes) throw new Error('Job event record is oversized.');
    let handle;
    try { handle = await fs.open(file, 'ax+'); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('Job event log is unsafe.');
      handle = await fs.open(file, 'r+');
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        await handle.close();
        throw new Error('Job event log changed before writing.');
      }
    }
    try {
      const stat = await handle.stat();
      if (stat.size + Buffer.byteLength(line) > this.maxBytesPerJob) throw new Error('Job event log reached its configured limit.');
      await handle.write(line, stat.size, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
  }

  #file(jobId) {
    if (!JOB_ID.test(String(jobId || ''))) throw new Error('Job id is malformed.');
    return path.join(this.root, `${jobId}.jsonl`);
  }
}

export function projectJobEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const projection = { jobId: events[0].jobId, status: null, currentStep: null, finishedAt: null, exitCode: null, error: null, artifacts: [] };
  for (const event of events) {
    if (event.type === 'status') projection.status = event.status;
    if (event.type === 'step') projection.currentStep = event.currentStep;
    if (event.type === 'artifacts') projection.artifacts = event.artifacts;
    if (event.type === 'complete') {
      projection.status = event.status;
      projection.currentStep = null;
      projection.finishedAt = event.finishedAt;
      projection.exitCode = event.exitCode;
      projection.error = event.error;
    }
  }

  return Object.freeze(projection);
}
