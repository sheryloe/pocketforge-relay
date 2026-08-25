import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadActionTargets } from './action-targets.mjs';
import { GitHubActionsClient } from './github-actions-client.mjs';
import { ActionApprovalError, GitHubActionsRunnerAdapter } from './github-actions-runner.mjs';
import { JobEventStore, projectJobEvents } from './job-event-store.mjs';
import { createLogRedactor } from './security.mjs';

const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention']);
const RUN_STATUSES = new Set(['dispatching', 'queued', 'running', 'collecting_evidence', ...FINAL_STATUSES]);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const REMOTE_ARTIFACT = /^remote\/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/;

export async function createActionsRuntime(config, { fetchImpl } = {}) {
  if (!config?.actions?.enabled) return null;
  const catalog = await loadActionTargets(config.actions.targetsFile);
  const client = new GitHubActionsClient({ token: config.actions.githubToken, fetchImpl });
  const adapter = new GitHubActionsRunnerAdapter({
    client,
    catalog,
    maxArtifactFiles: Math.min(config.maxArtifactFiles ?? 100, 100),
    maxArtifactBytes: config.maxArtifactBytes ?? 25 * 1024 * 1024,
  });
  const manager = new ActionRunManager({
    adapter,
    dataDir: config.dataDir,
    maxConcurrentRuns: config.maxConcurrentJobs ?? 1,
    maxRetainedRuns: config.maxRetainedJobs ?? 100,
    maxLogLines: config.maxLogLines ?? 4_000,
    secrets: [config.token, config.actions.githubToken],
  });
  await manager.initialize();
  return manager;
}

export class ActionRunManager {
  constructor({
    adapter,
    dataDir,
    maxConcurrentRuns = 1,
    maxRetainedRuns = 100,
    maxLogLines = 4_000,
    secrets = [],
    now = Date.now,
    randomId = crypto.randomUUID,
    eventStore,
  } = {}) {
    if (!adapter || ['listTargets', 'createApproval', 'runApproved', 'cancelRemote'].some(method => typeof adapter[method] !== 'function')) {
      throw new Error('A complete GitHub Actions runner adapter is required.');
    }
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('Action run dataDir must be an absolute path.');
    if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 4) throw new Error('maxConcurrentRuns must be between 1 and 4.');
    if (!Number.isSafeInteger(maxRetainedRuns) || maxRetainedRuns < 1 || maxRetainedRuns > 10_000) throw new Error('maxRetainedRuns must be between 1 and 10000.');
    if (!Number.isSafeInteger(maxLogLines) || maxLogLines < 100 || maxLogLines > 20_000) throw new Error('maxLogLines must be between 100 and 20000.');
    if (typeof now !== 'function' || typeof randomId !== 'function') throw new Error('Action run clock and id generator must be functions.');
    this.adapter = adapter;
    this.runRoot = path.join(dataDir, 'action-runs');
    this.eventStore = eventStore || new JobEventStore(path.join(dataDir, 'action-run-events'));
    this.maxConcurrentRuns = maxConcurrentRuns;
    this.maxRetainedRuns = maxRetainedRuns;
    this.maxLogLines = maxLogLines;
    this.now = now;
    this.randomId = randomId;
    this.redactLog = createLogRedactor(secrets);
    this.runs = new Map();
    this.approvals = new Map();
    this.tasks = new Set();
    this.finishedSequence = 0;
    this.stopped = false;
    this.shutdownPromise = null;
    fs.mkdirSync(this.runRoot, { recursive: true });
  }

  async initialize() {
    const ids = await this.eventStore.listJobIds();
    const recovered = [];
    for (const id of ids) {
      const events = await this.eventStore.read(id);
      const projection = projectJobEvents(events);
      if (!projection) continue;
      recovered.push(this.recoverRun(id, projection, events.at(-1).sequence));
    }
    recovered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const run of recovered.slice(0, this.maxRetainedRuns)) this.runs.set(run.id, run);
    await this.eventStore.flush();
    return this;
  }

  listTargets() {
    return this.adapter.listTargets();
  }

  createApproval(input) {
    if (this.stopped) throw statusError('GitHub Actions runner is shutting down.', 503, 'actions_stopping');
    this.pruneApprovals();
    try {
      const approval = this.adapter.createApproval(input);
      this.approvals.set(approval.id, approval);
      return cloneApproval(approval);
    } catch (error) {
      if (error instanceof ActionApprovalError) throw error;
      throw statusError(error?.message || 'Invalid GitHub Actions approval request.', 400, 'approval_input');
    }
  }

  createRun({ approvalId, decision } = {}) {
    if (this.stopped) throw statusError('GitHub Actions runner is shutting down.', 503, 'actions_stopping');
    this.pruneApprovals();
    if (this.tasks.size >= this.maxConcurrentRuns) {
      throw statusError('The active GitHub Actions run limit has been reached.', 429, 'actions_capacity');
    }
    if (decision !== 'approve') {
      throw new ActionApprovalError('Explicit decision "approve" is required.', 'approval_decision');
    }
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new ActionApprovalError('Approval was not found, expired, or already consumed.', 'approval_not_found');

    const id = this.randomId();
    if (typeof id !== 'string' || !RUN_ID.test(id) || this.runs.has(id)) throw new Error('Action run id generator returned an invalid or duplicate id.');
    const workspace = path.join(this.runRoot, id);
    fs.mkdirSync(workspace);
    this.approvals.delete(approvalId);
    const createdAt = new Date(this.now()).toISOString();
    const run = {
      id,
      label: approval.label,
      targetId: approval.target.id,
      repository: approval.target.repository,
      ref: approval.target.ref,
      workflow: approval.target.workflow,
      status: 'dispatching',
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      currentStep: null,
      remoteRunId: null,
      remoteUrl: null,
      remoteStatus: null,
      remoteConclusion: null,
      cancelRequested: false,
      errorCode: null,
      error: null,
      logs: [],
      artifacts: [],
      eventSequence: 0,
      durableSequence: 0,
      controller: new AbortController(),
      finishedSequence: null,
    };
    this.runs.set(id, run);
    this.persist(run, 'status', { status: run.status });

    let operation;
    try {
      operation = this.adapter.runApproved({
        approvalId,
        decision,
        jobId: id,
        workspace,
        signal: run.controller.signal,
        onEvent: event => this.onEvent(run, event),
      });
    } catch (error) {
      operation = Promise.reject(error);
    }
    const task = Promise.resolve(operation)
      .then(result => this.finishRun(run, result))
      .catch(error => this.failRun(run, error))
      .finally(() => {
        this.tasks.delete(task);
        this.pruneRuns();
      });
    this.tasks.add(task);
    return this.publicRun(run);
  }

  listRuns() {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(run => this.publicRun(run));
  }

  getRun(id) {
    const run = this.runs.get(id);
    return run ? this.publicRun(run) : null;
  }

  getArtifact(id, artifactId) {
    const run = this.runs.get(id);
    return run?.artifacts.find(artifact => artifact.id === String(artifactId)) ?? null;
  }

  async cancelRun(id) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (FINAL_STATUSES.has(run.status)) return this.publicRun(run);
    run.cancelRequested = true;
    if (run.remoteRunId === null) {
      run.controller.abort();
      this.addLog(run, 'system', 'Cancellation requested before a verified remote run identifier was available.');
      return this.publicRun(run);
    }
    const result = await this.adapter.cancelRemote({
      targetId: run.targetId,
      ref: run.ref,
      runId: run.remoteRunId,
    });
    this.addLog(run, 'system', result.accepted
      ? 'GitHub accepted the workflow cancellation request.'
      : 'GitHub reported that the workflow was already finished.');
    return this.publicRun(run);
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    for (const run of this.runs.values()) {
      if (!run.finishedAt) run.controller.abort();
    }
    this.approvals.clear();
    this.shutdownPromise = Promise.allSettled([...this.tasks]).then(() => this.eventStore.flush());
    return this.shutdownPromise;
  }

  onEvent(run, event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'status') {
      if (typeof event.status === 'string') {
        run.status = FINAL_STATUSES.has(event.status) ? 'collecting_evidence' : event.status;
      }
      if (typeof event.remoteStatus === 'string') run.remoteStatus = event.remoteStatus;
      if (event.remoteConclusion === null || typeof event.remoteConclusion === 'string') run.remoteConclusion = event.remoteConclusion;
      if (typeof event.remoteUrl === 'string') run.remoteUrl = event.remoteUrl;
      if (typeof event.errorCode === 'string') run.errorCode = event.errorCode;
      if (typeof event.error === 'string') run.error = this.redactLog(event.error);
      this.persist(run, 'status', { status: run.status });
      return;
    }
    if (event.type === 'remote') {
      if (Number.isSafeInteger(event.runId) && event.runId > 0) run.remoteRunId = event.runId;
      if (typeof event.htmlUrl === 'string') run.remoteUrl = event.htmlUrl;
      this.persist(run, 'status', { status: run.status });
      return;
    }
    if (event.type === 'step') {
      run.currentStep = typeof event.currentStep === 'string' ? event.currentStep.slice(0, 500) : null;
      this.persist(run, 'step', { currentStep: run.currentStep });
      return;
    }
    if (event.type === 'log') this.addLog(run, event.channel, event.message);
  }

  finishRun(run, result) {
    run.label = result.label ?? run.label;
    run.targetId = result.targetId ?? run.targetId;
    run.repository = result.repository ?? run.repository;
    run.ref = result.ref ?? run.ref;
    run.workflow = result.workflow ?? run.workflow;
    const cancelledBeforeVerifiedDispatch = run.controller.signal.aborted
      && result.remoteRunId === null
      && result.status === 'failed'
      && result.errorCode === 'dispatch_rejected';
    run.status = cancelledBeforeVerifiedDispatch ? 'cancelled' : result.status;
    run.remoteRunId = result.remoteRunId;
    run.remoteUrl = result.remoteUrl;
    run.remoteStatus = result.remoteStatus;
    run.remoteConclusion = result.remoteConclusion;
    run.errorCode = cancelledBeforeVerifiedDispatch ? 'cancelled_before_dispatch' : result.errorCode;
    run.error = cancelledBeforeVerifiedDispatch
      ? 'Cancelled before GitHub dispatch was verified.'
      : result.error ? this.redactLog(result.error) : null;
    run.artifacts = Array.isArray(result.artifacts) ? [...result.artifacts] : [];
    run.currentStep = null;
    run.finishedAt = new Date(this.now()).toISOString();
    run.finishedSequence = ++this.finishedSequence;
    this.persist(run, 'artifacts', { artifacts: run.artifacts.map(publicArtifact), manifest: null });
    this.persist(run, 'complete', { status: run.status, finishedAt: run.finishedAt, exitCode: null, error: run.error, interrupted: false });
  }

  failRun(run, error) {
    const aborted = run.controller.signal.aborted;
    const safeApprovalError = error instanceof ActionApprovalError;
    const remoteMayBeActive = run.remoteRunId !== null;
    run.status = remoteMayBeActive ? 'needs_attention' : aborted ? 'cancelled' : 'failed';
    run.errorCode = remoteMayBeActive ? 'observation_failed' : aborted ? 'cancelled_before_dispatch' : safeApprovalError ? error.code : 'runner_error';
    run.error = remoteMayBeActive
      ? 'GitHub Actions observation stopped after dispatch; the remote workflow may still be active.'
      : aborted ? 'Cancelled before GitHub dispatch was verified.'
      : safeApprovalError ? this.redactLog(error.message) : 'GitHub Actions runner operation failed.';
    run.currentStep = null;
    run.finishedAt = new Date(this.now()).toISOString();
    run.finishedSequence = ++this.finishedSequence;
    this.persist(run, 'complete', { status: run.status, finishedAt: run.finishedAt, exitCode: null, error: run.error, interrupted: false });
  }

  addLog(run, channel, message) {
    const text = this.redactLog(String(message ?? '').replace(/\u0000/g, '')).slice(0, 16_000);
    if (!text) return;
    const log = {
      sequence: ++run.eventSequence,
      timestamp: new Date(this.now()).toISOString(),
      channel: ['stdout', 'stderr', 'system'].includes(channel) ? channel : 'system',
      message: text,
    };
    run.logs.push(log);
    if (run.logs.length > this.maxLogLines) run.logs.splice(0, run.logs.length - this.maxLogLines);
    this.persist(run, 'log', { log: { ...log } });
  }

  pruneApprovals() {
    const now = this.now();
    for (const [id, approval] of this.approvals) {
      if (Date.parse(approval.expiresAt) <= now) this.approvals.delete(id);
    }
  }

  pruneRuns() {
    const completed = [...this.runs.values()]
      .filter(run => run.finishedSequence !== null)
      .sort((a, b) => b.finishedSequence - a.finishedSequence);
    for (const run of completed.slice(this.maxRetainedRuns)) this.runs.delete(run.id);
  }

  publicRun(run) {
    return {
      id: run.id,
      label: run.label,
      targetId: run.targetId,
      repository: run.repository,
      ref: run.ref,
      workflow: run.workflow,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      currentStep: run.currentStep,
      remoteRunId: run.remoteRunId,
      remoteUrl: run.remoteUrl,
      remoteStatus: run.remoteStatus,
      remoteConclusion: run.remoteConclusion,
      cancelRequested: run.cancelRequested,
      errorCode: run.errorCode,
      error: run.error,
      logs: run.logs.map(log => ({ ...log })),
      artifacts: run.artifacts.map(publicArtifact),
    };
  }

  persist(run, type, extra) {
    this.eventStore.append(run.id, {
      type,
      sequence: ++run.durableSequence,
      job: durableRun(run),
      ...extra,
    });
  }

  recoverRun(id, projection, durableSequence) {
    validateRecoveredRun(id, projection);
    const workspace = path.join(this.runRoot, id);
    const workspaceStat = fs.lstatSync(workspace);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) throw new Error('Recovered Actions workspace is unsafe.');
    const artifacts = projection.artifacts.map(artifact => recoverArtifact(workspace, artifact));
    const wasTerminal = FINAL_STATUSES.has(projection.status) && typeof projection.finishedAt === 'string';
    const run = {
      ...projection,
      id,
      status: wasTerminal ? projection.status : 'needs_attention',
      finishedAt: wasTerminal ? projection.finishedAt : new Date(this.now()).toISOString(),
      currentStep: null,
      errorCode: wasTerminal ? projection.errorCode : 'relay_restarted',
      error: wasTerminal ? projection.error : 'Relay restarted before GitHub Actions evidence finalization.',
      logs: projection.logs.slice(-this.maxLogLines).map(log => ({ ...log })),
      artifacts,
      eventSequence: projection.logs.reduce((highest, log) => Math.max(highest, log.sequence || 0), 0),
      durableSequence,
      controller: new AbortController(),
      finishedSequence: ++this.finishedSequence,
    };
    if (!wasTerminal) {
      this.persist(run, 'complete', { status: run.status, finishedAt: run.finishedAt, exitCode: null, error: run.error, interrupted: true });
    }
    return run;
  }
}

function durableRun(run) {
  const { logs, artifacts, ...record } = run;
  return {
    id: record.id, label: record.label, targetId: record.targetId,
    repository: record.repository, ref: record.ref, workflow: record.workflow,
    status: record.status, createdAt: record.createdAt, startedAt: record.startedAt,
    finishedAt: record.finishedAt, currentStep: record.currentStep,
    remoteRunId: record.remoteRunId, remoteUrl: record.remoteUrl,
    remoteStatus: record.remoteStatus, remoteConclusion: record.remoteConclusion,
    cancelRequested: record.cancelRequested, errorCode: record.errorCode, error: record.error,
  };
}

function validateRecoveredRun(id, run) {
  if (run.id !== id || !RUN_STATUSES.has(run.status)
    || !validText(run.label, 500) || !validText(run.targetId, 100)
    || !validText(run.repository, 500) || !validText(run.ref, 300) || !validText(run.workflow, 200)
    || !validTimestamp(run.createdAt) || !validTimestamp(run.startedAt)
    || (run.finishedAt !== null && !validTimestamp(run.finishedAt))
    || (run.remoteRunId !== null && (!Number.isSafeInteger(run.remoteRunId) || run.remoteRunId < 1))
    || (run.remoteUrl !== null && !validText(run.remoteUrl, 1_000))
    || typeof run.cancelRequested !== 'boolean' || !Array.isArray(run.logs) || !Array.isArray(run.artifacts)) {
    throw new Error('Recovered Actions run is malformed.');
  }
}

function recoverArtifact(workspace, artifact) {
  const match = typeof artifact?.relativePath === 'string' && artifact.relativePath.match(REMOTE_ARTIFACT);
  if (!match || artifact.name !== match[1] || !/^\d+$/.test(String(artifact.id))
    || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || !SHA256.test(artifact.sha256)
    || !validText(artifact.contentType, 100) || !validText(artifact.sourceName, 200)) {
    throw new Error('Recovered Actions artifact is malformed.');
  }
  const absolutePath = path.join(workspace, 'remote', match[1]);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.size) throw new Error('Recovered Actions artifact is unsafe or changed.');
  return { ...artifact, absolutePath };
}

function validText(value, max) {
  return typeof value === 'string' && value.length <= max && !value.includes('\u0000');
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function publicArtifact(artifact) {
  return {
    id: artifact.id,
    name: artifact.name,
    relativePath: artifact.relativePath,
    size: artifact.size,
    contentType: artifact.contentType,
    sha256: artifact.sha256,
    githubDigest: artifact.githubDigest,
    sourceName: artifact.sourceName,
  };
}

function cloneApproval(approval) {
  return {
    ...approval,
    target: {
      ...approval.target,
      inputs: { ...approval.target.inputs },
      artifactNames: [...approval.target.artifactNames],
    },
  };
}

function statusError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
