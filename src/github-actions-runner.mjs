import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publicActionTargets, resolveActionTarget } from './action-targets.mjs';
import { GitHubActionsError } from './github-actions-client.mjs';

const APPROVAL_ID = /^[A-Za-z0-9_-]{20,100}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention']);

class ObserverCallbackError extends Error {
  constructor() {
    super('The run event observer failed.');
    this.name = 'ObserverCallbackError';
  }
}

class EvidenceCollectionError extends Error {
  constructor(artifacts) {
    super('GitHub Actions evidence collection failed.');
    this.name = 'EvidenceCollectionError';
    this.artifacts = Object.freeze([...artifacts]);
  }
}

export class ActionApprovalError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ActionApprovalError';
    this.code = code;
  }
}

export class ActionApprovalStore {
  #catalog;
  #ttlMs;
  #maxPending;
  #now;
  #randomId;
  #approvals = new Map();

  constructor({ catalog, ttlMs = 5 * 60_000, maxPending = 20, now = Date.now, randomId = approvalId } = {}) {
    publicActionTargets(catalog);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 15 * 60_000) {
      throw new Error('Approval ttlMs must be between 30000 and 900000.');
    }
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 100) {
      throw new Error('Approval maxPending must be between 1 and 100.');
    }
    if (typeof now !== 'function' || typeof randomId !== 'function') throw new Error('Approval clock and id generator must be functions.');
    this.#catalog = catalog;
    this.#ttlMs = ttlMs;
    this.#maxPending = maxPending;
    this.#now = now;
    this.#randomId = randomId;
  }

  create({ targetId, ref, label = '' } = {}) {
    this.prune();
    if (this.#approvals.size >= this.#maxPending) {
      throw new ActionApprovalError('The pending GitHub Actions approval limit has been reached.', 'approval_limit');
    }
    const target = resolveActionTarget(this.#catalog, targetId, ref);
    const safeLabel = validateLabel(label);
    const id = this.#randomId();
    if (typeof id !== 'string' || !APPROVAL_ID.test(id) || this.#approvals.has(id)) {
      throw new Error('Approval id generator returned an invalid or duplicate id.');
    }
    const createdAtMs = this.#now();
    const record = Object.freeze({ id, createdAtMs, expiresAtMs: createdAtMs + this.#ttlMs, label: safeLabel, target });
    this.#approvals.set(id, record);
    return publicApproval(record);
  }

  consume(approvalIdValue, decision) {
    if (decision !== 'approve') throw new ActionApprovalError('Explicit decision "approve" is required.', 'approval_decision');
    if (typeof approvalIdValue !== 'string' || !APPROVAL_ID.test(approvalIdValue)) {
      throw new ActionApprovalError('Approval id is invalid.', 'approval_not_found');
    }
    const record = this.#approvals.get(approvalIdValue);
    if (!record) throw new ActionApprovalError('Approval was not found or was already consumed.', 'approval_not_found');
    this.#approvals.delete(approvalIdValue);
    if (record.expiresAtMs <= this.#now()) {
      throw new ActionApprovalError('Approval has expired.', 'approval_expired');
    }
    return Object.freeze({ approvalId: record.id, label: record.label, target: record.target });
  }

  prune() {
    const now = this.#now();
    for (const [id, record] of this.#approvals) {
      if (record.expiresAtMs <= now) this.#approvals.delete(id);
    }
  }

  get size() {
    this.prune();
    return this.#approvals.size;
  }
}

export class GitHubActionsRunnerAdapter {
  #client;
  #catalog;
  #approvals;
  #pollIntervalMs;
  #runTimeoutMs;
  #maxJobs;
  #maxArtifactFiles;
  #maxArtifactBytes;
  #sleep;
  #now;
  #ownedRuns = new Map();

  constructor({
    client,
    catalog,
    approvals,
    pollIntervalMs = 5_000,
    runTimeoutMs = 60 * 60_000,
    maxJobs = 100,
    maxArtifactFiles = 20,
    maxArtifactBytes = 25 * 1024 * 1024,
    sleep = delay,
    now = Date.now,
  } = {}) {
    assertClient(client);
    publicActionTargets(catalog);
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) {
      throw new Error('pollIntervalMs must be between 1000 and 60000.');
    }
    if (!Number.isSafeInteger(runTimeoutMs) || runTimeoutMs < pollIntervalMs || runTimeoutMs > 6 * 60 * 60_000) {
      throw new Error('runTimeoutMs must be between pollIntervalMs and 21600000.');
    }
    if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 100) throw new Error('maxJobs must be between 1 and 100.');
    if (!Number.isSafeInteger(maxArtifactFiles) || maxArtifactFiles < 1 || maxArtifactFiles > 100) throw new Error('maxArtifactFiles must be between 1 and 100.');
    if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1024 || maxArtifactBytes > 1024 * 1024 * 1024) throw new Error('maxArtifactBytes must be between 1024 and 1073741824.');
    if (typeof sleep !== 'function' || typeof now !== 'function') throw new Error('Runner sleep and clock must be functions.');
    this.#client = client;
    this.#catalog = catalog;
    this.#approvals = approvals ?? new ActionApprovalStore({ catalog });
    this.#pollIntervalMs = pollIntervalMs;
    this.#runTimeoutMs = runTimeoutMs;
    this.#maxJobs = maxJobs;
    this.#maxArtifactFiles = maxArtifactFiles;
    this.#maxArtifactBytes = maxArtifactBytes;
    this.#sleep = sleep;
    this.#now = now;
  }

  listTargets() {
    return publicActionTargets(this.#catalog);
  }

  createApproval(input) {
    return this.#approvals.create(input);
  }

  async runApproved({ approvalId, decision, jobId = crypto.randomUUID(), workspace, signal, onEvent = () => {} } = {}) {
    if (typeof jobId !== 'string' || !REQUEST_ID.test(jobId)) throw new Error('jobId is invalid.');
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('workspace must be an absolute relay-controlled path.');
    if (typeof onEvent !== 'function') throw new Error('onEvent must be a function.');
    const approved = this.#approvals.consume(approvalId, decision);
    const emit = async event => {
      try {
        await onEvent(Object.freeze({ jobId, ...event }));
      } catch {
        throw new ObserverCallbackError();
      }
    };
    const emitBestEffort = async event => {
      try {
        await emit(event);
      } catch {}
    };
    const base = {
      jobId,
      targetId: approved.target.id,
      label: approved.label,
      repository: approved.target.repository,
      ref: approved.target.ref,
      workflow: approved.target.workflow,
      remoteRunId: null,
      remoteUrl: null,
      remoteStatus: null,
      remoteConclusion: null,
      artifacts: [],
      errorCode: null,
      error: null,
    };
    try {
      await emit({ type: 'status', status: 'dispatching', target: previewTarget(approved.target) });
    } catch {
      return finish(base, 'failed', 'observer_callback_failed', 'Run event observation failed before GitHub dispatch; no workflow was started.');
    }

    let dispatched;
    try {
      throwIfAborted(signal);
      dispatched = await this.#client.dispatchWorkflow({ target: approved.target, requestId: jobId, signal });
    } catch (error) {
      const unknown = error instanceof GitHubActionsError && error.code === 'dispatch_unknown';
      const result = finish(base, unknown ? 'needs_attention' : 'failed', unknown ? 'dispatch_unknown' : 'dispatch_rejected', publicError(error));
      await emitBestEffort({ type: 'status', status: result.status, errorCode: result.errorCode, error: result.error });
      return result;
    }
    base.remoteRunId = dispatched.runId;
    base.remoteUrl = dispatched.htmlUrl;
    this.#rememberOwnedRun(approved.target, dispatched.runId);
    const observerFailure = async () => {
      const result = finish(base, 'needs_attention', 'observer_callback_failed', 'Run event observation failed after GitHub dispatch; the remote workflow may still be active.');
      await emitBestEffort({ type: 'status', status: result.status, errorCode: result.errorCode, error: result.error, remoteUrl: base.remoteUrl });
      return result;
    };
    try {
      await emit({ type: 'remote', runId: dispatched.runId, htmlUrl: dispatched.htmlUrl });
    } catch {
      return observerFailure();
    }

    const deadline = this.#now() + this.#runTimeoutMs;
    let etag = null;
    let status = null;
    let run = null;
    let nextPollMs = this.#pollIntervalMs;
    const seenSteps = new Map();
    try {
      while (this.#now() < deadline) {
        throwIfAborted(signal);
        const polled = await this.#client.getWorkflowRun({
          owner: approved.target.owner,
          repo: approved.target.repo,
          runId: dispatched.runId,
          etag,
          signal,
        });
        etag = polled.etag ?? etag;
        nextPollMs = Math.max(this.#pollIntervalMs, polled.pollIntervalMs ?? 0);
        if (!polled.notModified) {
          run = polled.run;
          base.remoteStatus = run.status;
          base.remoteConclusion = run.conclusion;
          const mapped = mapRunStatus(run);
          if (mapped !== status) {
            status = mapped;
            await emit({ type: 'status', status, remoteStatus: run.status, remoteConclusion: run.conclusion, remoteUrl: run.htmlUrl });
          }
          if (status === 'needs_attention') {
            return finish(base, status, 'unknown_remote_status', `GitHub returned unsupported workflow status ${run.status}.`);
          }
        }

        if (status === 'queued' || status === 'running') {
          const jobs = await this.#client.listWorkflowJobs({
            owner: approved.target.owner,
            repo: approved.target.repo,
            runId: dispatched.runId,
            maxJobs: this.#maxJobs,
            signal,
          });
          await emitJobChanges(jobs, seenSteps, emit);
        }
        if (status && TERMINAL.has(status)) break;
        await this.#sleep(nextPollMs, signal);
      }
    } catch (error) {
      if (error instanceof ObserverCallbackError) return observerFailure();
      const aborted = signal?.aborted;
      const result = finish(base, 'needs_attention', aborted ? 'observation_aborted' : 'observation_failed', aborted ? 'Remote workflow observation stopped; the GitHub run may still be active.' : publicError(error));
      await emitBestEffort({ type: 'status', status: result.status, errorCode: result.errorCode, error: result.error, remoteUrl: base.remoteUrl });
      return result;
    }

    if (!run || !status || !TERMINAL.has(status)) {
      const result = finish(base, 'needs_attention', 'observation_timeout', 'Remote workflow observation reached its bounded deadline; the GitHub run may still be active.');
      await emitBestEffort({ type: 'status', status: result.status, errorCode: result.errorCode, error: result.error, remoteUrl: base.remoteUrl });
      return result;
    }

    this.#forgetOwnedRun(approved.target.id, dispatched.runId);

    try {
      const artifacts = await this.#collectEvidence({ target: approved.target, run, workspace, signal });
      base.artifacts = artifacts;
      await emit({ type: 'artifacts', artifacts: artifacts.map(publicArtifact) });
    } catch (error) {
      if (error instanceof ObserverCallbackError) return observerFailure();
      if (error instanceof EvidenceCollectionError) {
        base.artifacts = [...error.artifacts];
        if (base.artifacts.length > 0) {
          try {
            await emit({ type: 'artifacts', artifacts: base.artifacts.map(publicArtifact), partial: true });
          } catch {
            return observerFailure();
          }
        }
      }
      if (status === 'succeeded') {
        const result = finish(base, 'needs_attention', 'evidence_collection_failed', publicError(error));
        await emitBestEffort({ type: 'status', status: result.status, errorCode: result.errorCode, error: result.error, remoteConclusion: base.remoteConclusion });
        return result;
      }
      try {
        await emit({ type: 'log', channel: 'system', message: `Remote evidence was incomplete after a ${status} run.` });
      } catch {
        return observerFailure();
      }
    }

    const result = finish(base, status, null, null);
    try {
      await emit({ type: 'complete', result: publicResult(result) });
    } catch {
      return observerFailure();
    }
    return result;
  }

  async cancelRemote({ targetId, ref, runId, signal } = {}) {
    const target = resolveActionTarget(this.#catalog, targetId, ref);
    if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('runId must be a positive safe integer.');
    const key = ownedRunKey(target.id, runId);
    const owned = this.#ownedRuns.get(key);
    if (!owned || owned.ref !== target.ref || owned.owner !== target.owner || owned.repo !== target.repo) {
      throw new ActionApprovalError('The GitHub Actions run is not owned by this adapter instance.', 'run_not_owned');
    }
    const result = await this.#client.cancelWorkflowRun({ owner: target.owner, repo: target.repo, runId, signal });
    if (result.accepted || result.alreadyFinished) this.#ownedRuns.delete(key);
    return result;
  }

  async #collectEvidence({ target, run, workspace, signal }) {
    const remoteDir = path.join(workspace, 'remote');
    await fs.mkdir(remoteDir, { recursive: true });
    const artifacts = [];
    let remainingBytes = this.#maxArtifactBytes;
    if (1 + target.artifactNames.length > this.#maxArtifactFiles) {
      throw new Error(`Required remote evidence exceeds the configured ${this.#maxArtifactFiles}-file limit.`);
    }

    try {
      const logName = `github-actions-${run.id}-logs.zip`;
      const logDownload = await this.#client.downloadRunLogs({
        owner: target.owner,
        repo: target.repo,
        runId: run.id,
        destination: path.join(remoteDir, logName),
        maxBytes: remainingBytes,
        signal,
      });
      remainingBytes -= logDownload.size;
      artifacts.push(remoteArtifact(artifacts.length, logName, logDownload, null, 'github-actions-logs'));
      const listed = await this.#client.listRunArtifacts({
        owner: target.owner,
        repo: target.repo,
        runId: run.id,
        maxArtifacts: 100,
        signal,
      });
      const selected = [];
      for (const requiredName of target.artifactNames) {
        const matches = listed.filter(item => item.name === requiredName && !item.expired);
        if (matches.length !== 1) throw new Error(`Required GitHub Actions artifact is missing or ambiguous: ${requiredName}`);
        selected.push(matches[0]);
      }
      const declaredTotal = selected.reduce((sum, item) => sum + item.size, 0);
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > remainingBytes) {
        throw new Error(`Required GitHub Actions artifacts exceed the configured ${this.#maxArtifactBytes}-byte limit.`);
      }
      for (const artifact of selected) {
        const fileName = `${artifact.id}-${safeFilePart(artifact.name)}.zip`;
        const download = await this.#client.downloadArtifact({
          owner: target.owner,
          repo: target.repo,
          artifactId: artifact.id,
          destination: path.join(remoteDir, fileName),
          maxBytes: remainingBytes,
          signal,
        });
        remainingBytes -= download.size;
        artifacts.push(remoteArtifact(artifacts.length, fileName, download, artifact.digest, artifact.name));
      }
      return artifacts;
    } catch {
      throw new EvidenceCollectionError(artifacts);
    }
  }

  #rememberOwnedRun(target, runId) {
    this.#ownedRuns.set(ownedRunKey(target.id, runId), Object.freeze({
      targetId: target.id,
      ref: target.ref,
      owner: target.owner,
      repo: target.repo,
      runId,
    }));
  }

  #forgetOwnedRun(targetId, runId) {
    this.#ownedRuns.delete(ownedRunKey(targetId, runId));
  }
}

function assertClient(client) {
  const methods = ['dispatchWorkflow', 'getWorkflowRun', 'listWorkflowJobs', 'listRunArtifacts', 'downloadRunLogs', 'downloadArtifact', 'cancelWorkflowRun'];
  if (!client || methods.some(method => typeof client[method] !== 'function')) {
    throw new Error('A complete GitHub Actions client is required.');
  }
}

function mapRunStatus(run) {
  if (['requested', 'waiting', 'pending', 'queued'].includes(run.status)) return 'queued';
  if (run.status === 'in_progress') return 'running';
  if (run.status !== 'completed') return 'needs_attention';
  if (run.conclusion === 'success') return 'succeeded';
  if (run.conclusion === 'cancelled') return 'cancelled';
  if (['failure', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale'].includes(run.conclusion)) return 'failed';
  return 'needs_attention';
}

async function emitJobChanges(jobs, seen, emit) {
  for (const job of jobs) {
    for (const step of job.steps) {
      const key = `${job.id}:${step.number}`;
      const signature = `${step.status}:${step.conclusion ?? ''}`;
      if (seen.get(key) === signature) continue;
      seen.set(key, signature);
      await emit({
        type: 'step',
        currentStep: `${job.name}: ${step.name}`,
        remoteJobId: job.id,
        status: step.status,
        conclusion: step.conclusion,
      });
    }
  }
}

function finish(base, status, errorCode, error) {
  return Object.freeze({ ...base, artifacts: [...base.artifacts], status, errorCode, error });
}

function publicResult(result) {
  return {
    jobId: result.jobId,
    targetId: result.targetId,
    repository: result.repository,
    ref: result.ref,
    workflow: result.workflow,
    status: result.status,
    remoteRunId: result.remoteRunId,
    remoteUrl: result.remoteUrl,
    remoteStatus: result.remoteStatus,
    remoteConclusion: result.remoteConclusion,
    artifacts: result.artifacts.map(publicArtifact),
    errorCode: result.errorCode,
    error: result.error,
  };
}

function remoteArtifact(id, fileName, download, githubDigest, sourceName) {
  return Object.freeze({
    id: String(id),
    name: fileName,
    relativePath: `remote/${fileName}`,
    absolutePath: download.path,
    size: download.size,
    contentType: 'application/zip',
    sha256: download.sha256,
    githubDigest,
    sourceName,
  });
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

function publicApproval(record) {
  return {
    id: record.id,
    createdAt: new Date(record.createdAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    label: record.label,
    target: previewTarget(record.target),
  };
}

function previewTarget(target) {
  return {
    id: target.id,
    name: target.name,
    repository: target.repository,
    workflow: target.workflow,
    ref: target.ref,
    inputs: { ...target.inputs },
    artifactNames: [...target.artifactNames],
  };
}

function validateLabel(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new ActionApprovalError('Approval label must be text.', 'approval_input');
  const label = value.trim();
  if (label.length > 80) throw new ActionApprovalError('Approval label must be 80 characters or fewer.', 'approval_input');
  return label;
}

function approvalId() {
  return crypto.randomBytes(24).toString('base64url');
}

function ownedRunKey(targetId, runId) {
  return `${targetId}:${runId}`;
}

function safeFilePart(value) {
  return value.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100);
}

function publicError(error) {
  if (error instanceof GitHubActionsError || error instanceof ActionApprovalError) return error.message;
  return 'GitHub Actions runner operation failed.';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error('Operation aborted.');
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Operation aborted.'));
      return;
    }
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new Error('Operation aborted.'));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
