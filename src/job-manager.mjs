import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collectArtifacts, publicArtifacts, snapshotArtifacts, verifyArtifactManifest, writeArtifactManifest, writeBuildSummary } from './artifacts.mjs';
import { JobEventStore, projectJobEvents } from './job-event-store.mjs';
import { classifyBuildFailure } from './failure-parsers.mjs';
import { runProcessStep } from './process-runner.mjs';
import { assertPresetSupportsSource, getPreset, resolvePresetSteps } from './presets.mjs';
import { createLogRedactor, normalizeGitHubRepository, validateGitRef, validateLabel } from './security.mjs';

const FINAL = new Set(['succeeded', 'failed', 'cancelled']);
const NO_EVENT_STORE = Object.freeze({
  append: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  read: async () => null,
  delete: async () => false,
  listJobIds: async () => [],
});

export class JobManager {
  constructor(config) {
    this.config = config;
    this.jobs = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.stopped = false;
    this.shutdownPromise = null;
    this.idleWaiters = new Set();
    this.finishedSequence = 0;
    this.redactLog = createLogRedactor([config.token]);
    this.eventStore = config.eventStore || (config.dataDir ? new JobEventStore(path.join(config.dataDir, 'job-events')) : NO_EVENT_STORE);
  }

  createJob(input = {}) {
    if (this.stopped) throw statusError('Runner is shutting down.', 503);
    this.pruneRetainedJobs();
    if (this.queue.length >= (this.config.maxQueuedJobs ?? 20)) {
      throw statusError('Job queue is full. Try again after a queued job starts.', 429);
    }
    const sourceType = input.sourceType === 'github' ? 'github' : input.sourceType === 'demo' ? 'demo' : null;
    if (!sourceType) throw new Error('sourceType must be either demo or github.');
    const preset = getPreset(String(input.presetId || ''));
    assertPresetSupportsSource(preset, sourceType);
    const job = {
      id: crypto.randomUUID(),
      label: validateLabel(input.label),
      sourceType,
      repository: sourceType === 'github' ? normalizeGitHubRepository(input.repository) : null,
      ref: sourceType === 'github' ? validateGitRef(input.ref) : null,
      resolvedCommit: null,
      presetId: preset.id,
      presetName: preset.name,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      error: null,
      failure: null,
      currentStep: null,
      workspace: null,
      sourceDir: null,
      logs: [],
      artifacts: [],
      artifactManifest: null,
      eventSequence: 0,
      persistedEventSequence: 0,
      events: new EventEmitter(),
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.emit(job, { type: 'status', status: 'queued' });
    this.pump();
    return this.publicJob(job);
  }

  listJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(job => this.publicJob(job));
  }

  getJob(id) {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : null;
  }

  getJobHistory(id) {
    return this.eventStore.read(String(id));
  }

  async getJobProjection(id) {
    const events = await this.getJobHistory(id);
    return projectJobEvents(events);
  }

  async listJobHistory() {
    const projections = [];
    for (const id of await this.eventStore.listJobIds()) {
      const projection = await this.getJobProjection(id);
      if (projection) projections.push(projection);
    }
    return projections.sort((a, b) => String(b.finishedAt || b.createdAt || '').localeCompare(String(a.finishedAt || a.createdAt || '')));
  }

  async deleteJobHistory(id) {
    const projection = await this.getJobProjection(id);
    if (!projection) return false;
    if (!FINAL.has(projection.status)) throw statusError('Only terminal job history can be deleted.', 409);
    return this.eventStore.delete(String(id));
  }

  async deleteJobData(id) {
    await this.eventStore.flush();
    const projection = await this.getJobProjection(id);
    if (!projection) return false;
    if (!FINAL.has(projection.status)) throw statusError('Only terminal job data can be deleted.', 409);
    await removeOwnedJobDirectory(path.join(this.config.dataDir, 'jobs'), String(id));
    await removeOwnedJobDirectory(path.join(this.config.dataDir, 'artifact-snapshots'), String(id));
    await this.eventStore.delete(String(id));
    const job = this.jobs.get(String(id));
    if (job) { job.events.removeAllListeners(); this.jobs.delete(String(id)); }
    return true;
  }

  async recoverInterruptedJobs() {
    let recovered = 0;
    for (const id of await this.eventStore.listJobIds()) {
      const events = await this.eventStore.read(id);
      const projection = projectJobEvents(events);
      if (!projection || FINAL.has(projection.status)) continue;
      const sequence = events.at(-1).sequence;
      const finishedAt = new Date().toISOString();
      await this.eventStore.append(id, { sequence: sequence + 1, timestamp: finishedAt, type: 'status', status: 'failed' });
      await this.eventStore.append(id, { sequence: sequence + 2, timestamp: finishedAt, type: 'complete', status: 'failed', finishedAt, exitCode: 1, error: 'Relay restarted before job completion.', interrupted: true });
      recovered++;
    }
    await this.eventStore.flush();
    return recovered;
  }

  async getArtifact(id, artifactId) {
    const job = this.jobs.get(id);
    const projection = job ? null : await this.getJobProjection(id);
    const artifact = (job?.artifacts || projection?.artifacts || []).find(candidate => candidate.id === String(artifactId)) || null;
    const artifactManifest = job?.artifactManifest || projection?.artifactManifest;
    if (!artifact || !artifactManifest) return null;
    const snapshotDir = path.join(this.config.dataDir, 'artifact-snapshots', String(id));
    const manifest = await verifyArtifactManifest({ manifest: artifactManifest, snapshotDir, integrityKey: this.config.artifactIntegrityKey });
    const entry = manifest.artifacts.find(candidate => candidate.id === artifact.id);
    const publicArtifact = publicArtifacts([artifact])[0];
    if (!entry || JSON.stringify(entry) !== JSON.stringify(publicArtifact)) throw statusError('Artifact does not match its manifest.', 409);
    return { ...artifact, absolutePath: path.join(snapshotDir, `${artifact.id}-${artifact.sha256}`) };
  }

  resolveDeviceArtifact(id, artifactId) {
    const job = this.jobs.get(String(id));
    if (!job) throw statusError('Job not found.', 404);
    if (job.status !== 'succeeded') throw statusError('Device evidence requires a succeeded build job.', 409);
    const artifact = job.artifacts.find(candidate => candidate.id === String(artifactId));
    if (!artifact) throw statusError('Artifact not found.', 404);
    if (artifact.contentType !== 'application/vnd.android.package-archive'
      || path.extname(artifact.absolutePath).toLowerCase() !== '.apk') {
      throw statusError('Device evidence requires an APK artifact.', 400);
    }
    if (!job.sourceDir || !path.isAbsolute(job.sourceDir) || !path.isAbsolute(artifact.absolutePath)) {
      throw statusError('Build workspace is unavailable.', 409);
    }
    return Object.freeze({
      jobId: job.id,
      jobStatus: job.status,
      repository: job.repository,
      resolvedCommit: job.resolvedCommit,
      artifactId: artifact.id,
      artifactPath: artifact.absolutePath,
      workspaceRoot: job.sourceDir,
    });
  }

  subscribe(id, listener) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.events.on('event', listener);
    return () => job.events.off('event', listener);
  }

  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (FINAL.has(job.status)) return this.publicJob(job);
    job.controller.abort();
    if (job.status === 'queued') {
      this.queue = this.queue.filter(queuedId => queuedId !== job.id);
      job.error = 'Cancelled before execution.';
      job.finishedAt = new Date().toISOString();
      job.finishedSequence = ++this.finishedSequence;
      this.setStatus(job, 'cancelled');
      this.emit(job, { type: 'complete', job: this.publicJob(job) });
      this.pruneRetainedJobs();
    }
    return this.publicJob(job);
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    for (const job of this.jobs.values()) {
      if (!FINAL.has(job.status)) this.cancelJob(job.id);
    }
    this.queue = [];
    const idle = this.activeCount === 0
      ? Promise.resolve()
      : new Promise(resolve => this.idleWaiters.add(resolve));
    this.shutdownPromise = idle.then(() => this.eventStore.flush());
    return this.shutdownPromise;
  }

  async pump() {
    if (this.stopped) return;
    while (this.activeCount < this.config.maxConcurrentJobs && this.queue.length) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      this.activeCount++;
      this.runJob(job)
        .catch(error => this.addLog(job, 'system', `Internal runner error: ${safeJobError(error)}`))
        .finally(() => {
          this.activeCount--;
          if (this.activeCount === 0) {
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
          }
          this.pump();
        });
    }
  }

  async runJob(job) {
    const preset = getPreset(job.presetId);
    const workspace = path.join(this.config.dataDir, 'jobs', job.id);
    const sourceDir = path.join(workspace, 'source');
    job.workspace = workspace;
    job.sourceDir = sourceDir;
    job.startedAt = new Date().toISOString();
    this.setStatus(job, 'preparing');
    let finalStatus = 'failed';
    try {
      await fs.mkdir(workspace, { recursive: true });
      if (job.sourceType === 'demo') {
        this.addLog(job, 'system', 'Copying the bundled hello-web project into an isolated job workspace.');
        await fs.cp(path.join(this.config.examplesDir, 'hello-web'), sourceDir, { recursive: true });
      } else {
        await runProcessStep({
          step: { name: 'Clone repository', command: 'git', args: ['clone', '--depth', '1', '--single-branch', '--branch', job.ref, job.repository, 'source'] },
          cwd: workspace,
          timeoutMs: this.config.stepTimeoutMs,
          signal: job.controller.signal,
          onLog: (channel, message) => this.addLog(job, channel, message),
        });
        job.resolvedCommit = await resolveGitCommit({
          sourceDir,
          timeoutMs: this.config.stepTimeoutMs,
          signal: job.controller.signal,
          onLog: (channel, message) => this.addLog(job, channel, message),
        });
      }
      if (job.controller.signal.aborted) throw abortError();
      this.setStatus(job, 'running');
      for (const step of resolvePresetSteps(preset, sourceDir)) {
        job.currentStep = step.name;
        this.emit(job, { type: 'step', currentStep: step.name });
        this.addLog(job, 'system', `Starting: ${step.name}`);
        await runProcessStep({
          step,
          cwd: sourceDir,
          timeoutMs: this.config.stepTimeoutMs,
          signal: job.controller.signal,
          onLog: (channel, message) => this.addLog(job, channel, message),
        });
        this.addLog(job, 'system', `Completed: ${step.name}`);
      }
      job.exitCode = 0;
      finalStatus = 'succeeded';
    } catch (error) {
      if (error?.name === 'AbortError' || job.controller.signal.aborted) {
        job.error = 'Job cancelled.';
        this.addLog(job, 'system', job.error);
        finalStatus = 'cancelled';
      } else {
        job.exitCode = 1;
        job.error = safeJobError(error);
        this.addLog(job, 'stderr', job.error);
        job.failure = classifyBuildFailure(job.presetId, job.logs);
        finalStatus = 'failed';
      }
    }
    job.currentStep = null;
    job.finishedAt = new Date().toISOString();
    job.finishedSequence = ++this.finishedSequence;
    try {
      await writeBuildSummary(job, sourceDir, finalStatus);
      const collected = await collectArtifacts({
        sourceDir,
        preset,
        maxFiles: this.config.maxArtifactFiles,
        maxBytes: this.config.maxArtifactBytes,
      });
      job.artifacts = await snapshotArtifacts({ artifacts: collected, snapshotDir: path.join(this.config.dataDir, 'artifact-snapshots', job.id), maxBytes: this.config.maxArtifactBytes });
      job.artifactManifest = await writeArtifactManifest({ job, artifacts: job.artifacts, snapshotDir: path.join(this.config.dataDir, 'artifact-snapshots', job.id), integrityKey: this.config.artifactIntegrityKey });
      this.emit(job, { type: 'artifacts', artifacts: publicArtifacts(job.artifacts), manifest: job.artifactManifest });
    } catch (error) {
      this.addLog(job, 'stderr', `Artifact collection failed: ${safeJobError(error)}`);
    }
    this.setStatus(job, finalStatus);
    this.emit(job, { type: 'complete', job: this.publicJob(job) });
    this.pruneRetainedJobs();
  }

  addLog(job, channel, message) {
    const entry = {
      sequence: ++job.eventSequence,
      timestamp: new Date().toISOString(),
      channel,
      message: this.redactLog(String(message ?? '').replace(/\u0000/g, '')),
    };
    if (!entry.message && channel !== 'system') return;
    job.logs.push(entry);
    if (job.logs.length > this.config.maxLogLines) {
      job.logs.splice(0, job.logs.length - this.config.maxLogLines);
    }
    this.emit(job, { type: 'log', log: entry });
  }

  setStatus(job, status) {
    job.status = status;
    this.emit(job, { type: 'status', status, job: this.publicJob(job) });
  }

  emit(job, event) {
    job.events.emit('event', event);
    this.eventStore.append(job.id, persistedEvent(job, event, ++job.persistedEventSequence));
  }

  pruneRetainedJobs() {
    const retained = this.config.maxRetainedJobs ?? 100;
    const completed = [...this.jobs.values()]
      .filter(job => FINAL.has(job.status))
      .sort((a, b) => b.finishedSequence - a.finishedSequence);
    for (const job of completed.slice(retained)) {
      this.jobs.delete(job.id);
      job.events.removeAllListeners();
    }
  }

  publicJob(job) {
    return {
      id: job.id,
      label: job.label,
      sourceType: job.sourceType,
      repository: job.repository,
      ref: job.ref,
      resolvedCommit: job.resolvedCommit,
      presetId: job.presetId,
      presetName: job.presetName,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      error: job.error,
      failure: job.failure,
      currentStep: job.currentStep,
      logs: [...job.logs],
      artifacts: publicArtifacts(job.artifacts),
      artifactManifest: job.artifactManifest,
    };
  }
}

function persistedEvent(job, event, sequence) {
  const base = { sequence, timestamp: new Date().toISOString(), type: event.type };
  if (event.type === 'status') return { ...base, status: event.status, job: durableJob(job) };
  if (event.type === 'step') return { ...base, currentStep: event.currentStep };
  if (event.type === 'log') return { ...base, log: event.log };
  if (event.type === 'artifacts') return { ...base, artifacts: event.artifacts, manifest: event.manifest };
  return { ...base, status: job.status, finishedAt: job.finishedAt, exitCode: job.exitCode, error: job.error };
}

function durableJob(job) {
  if (!job || typeof job.id !== 'string') return {};
  return {
    id: job.id, label: job.label, sourceType: job.sourceType, repository: job.repository,
    ref: job.ref, resolvedCommit: job.resolvedCommit, presetId: job.presetId,
    presetName: job.presetName, status: job.status, createdAt: job.createdAt,
    startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode,
    error: job.error, failure: job.failure, currentStep: job.currentStep,
  };
}

async function removeOwnedJobDirectory(root, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Job id is malformed.');
  const target = path.join(root, id);
  let targetStat;
  try { targetStat = await fs.lstat(target); } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Job data directory is unsafe.');
  await fs.mkdir(root, { recursive: true });
  const quarantine = path.join(root, `.${id}.delete-${crypto.randomUUID()}`);
  await fs.rename(target, quarantine);
  const stat = await fs.lstat(quarantine);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Job data directory is unsafe.');
  const realRoot = await fs.realpath(root); const realTarget = await fs.realpath(quarantine);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`)) throw new Error('Job data directory escapes its relay root.');
  await fs.rm(quarantine, { recursive: true });
  return true;
}

export async function resolveGitCommit({ sourceDir, timeoutMs, signal, onLog, runStep = runProcessStep }) {
  const stdout = [];
  await runStep({
    step: { name: 'Resolve cloned commit', command: 'git', args: ['rev-parse', '--verify', 'HEAD^{commit}'] },
    cwd: sourceDir,
    timeoutMs,
    signal,
    onLog: (channel, message) => {
      onLog(channel, message);
      if (channel === 'stdout') stdout.push(String(message));
    },
  });
  if (stdout.length !== 1 || !/^[a-f0-9]{40}$/i.test(stdout[0].trim())) {
    throw new Error('Unable to bind the build to one exact Git commit.');
  }
  return stdout[0].trim().toLowerCase();
}

function abortError() {
  const error = new Error('Job cancelled.');
  error.name = 'AbortError';
  return error;
}

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeJobError(error) {
  const message = String(error?.message || 'Build failed.');
  if (/^[A-Za-z0-9 .:_-]{1,240}$/.test(message) && !/[A-Za-z]:\\|\/[A-Za-z0-9_.-]+\//.test(message)) return message;
  return 'Build failed during a server-managed operation.';
}
