import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const GITHUB_API_VERSION = '2026-03-10';
const API_BASE = 'https://api.github.com/';
const USER_AGENT = 'pocketforge-relay/0.1';
const PART = /^[A-Za-z0-9_.-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9_.-]{1,100}\.ya?ml$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const RUN_STATUS = new Set(['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting', 'pending']);
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class GitHubActionsError extends Error {
  constructor(message, { code = 'github_actions_error', status = null } = {}) {
    // Do not retain transport causes: fetch implementations may include request
    // headers in them, and this error can cross a log or API boundary.
    super(message);
    this.name = 'GitHubActionsError';
    this.code = code;
    this.status = status;
  }
}

export class GitHubActionsClient {
  #token;
  #fetch;
  #sleep;
  #requestTimeoutMs;
  #downloadTimeoutMs;
  #maxJsonBytes;
  #maxGetRetries;
  #maxRetryDelayMs;

  constructor({
    token,
    fetchImpl = globalThis.fetch,
    sleep = delay,
    requestTimeoutMs = 15_000,
    downloadTimeoutMs = 120_000,
    maxJsonBytes = 1024 * 1024,
    maxGetRetries = 2,
    maxRetryDelayMs = 60_000,
  } = {}) {
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token)) {
      throw new Error('A non-empty GitHub token without line breaks is required.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    if (typeof sleep !== 'function') throw new Error('A sleep implementation is required.');
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
    this.#requestTimeoutMs = boundedInteger(requestTimeoutMs, 1_000, 60_000, 'requestTimeoutMs');
    this.#downloadTimeoutMs = boundedInteger(downloadTimeoutMs, 1_000, 600_000, 'downloadTimeoutMs');
    this.#maxJsonBytes = boundedInteger(maxJsonBytes, 1024, 10 * 1024 * 1024, 'maxJsonBytes');
    this.#maxGetRetries = boundedInteger(maxGetRetries, 0, 5, 'maxGetRetries');
    this.#maxRetryDelayMs = boundedInteger(maxRetryDelayMs, 1_000, 300_000, 'maxRetryDelayMs');
  }

  async dispatchWorkflow({ target, requestId, signal } = {}) {
    const coordinates = targetCoordinates(target);
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
      throw new Error('PocketForge request id is invalid.');
    }
    const inputs = { ...(target.inputs ?? {}), pocketforge_request_id: requestId };
    const endpoint = workflowEndpoint(coordinates, 'dispatches');
    let response;
    try {
      response = await this.#fetchOnce(endpoint, {
        method: 'POST',
        headers: this.#apiHeaders({ json: true }),
        body: JSON.stringify({ ref: coordinates.ref, inputs }),
        redirect: 'manual',
      }, signal);
    } catch (cause) {
      throw new GitHubActionsError('Workflow dispatch outcome is unknown; it was not retried.', { code: 'dispatch_unknown', cause });
    }
    if (response.status !== 200) {
      await discard(response);
      const code = response.status >= 500 ? 'dispatch_unknown' : 'dispatch_rejected';
      const message = code === 'dispatch_unknown'
        ? 'Workflow dispatch outcome is unknown; it was not retried.'
        : `GitHub rejected the workflow dispatch with status ${response.status}.`;
      throw new GitHubActionsError(message, { code, status: response.status });
    }
    let payload;
    try {
      payload = await readJsonLimited(response, this.#maxJsonBytes);
      return normalizeDispatch(payload, coordinates);
    } catch (cause) {
      throw new GitHubActionsError('Workflow dispatch succeeded but its run identifier could not be verified; it was not retried.', { code: 'dispatch_unknown', status: response.status, cause });
    }
  }

  async getWorkflowRun({ owner, repo, runId, etag, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(runId, 'runId');
    const headers = etag ? { 'If-None-Match': String(etag) } : {};
    const response = await this.#get(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/runs/${id}`, { headers, signal, allowNotModified: true });
    if (response.status === 304) {
      await discard(response);
      return { notModified: true, etag: response.headers.get('etag') || etag || null, pollIntervalMs: pollInterval(response) };
    }
    const payload = await readJsonLimited(response, this.#maxJsonBytes);
    return {
      notModified: false,
      etag: response.headers.get('etag'),
      pollIntervalMs: pollInterval(response),
      run: normalizeRun(payload, id, coordinates),
    };
  }

  async listWorkflowJobs({ owner, repo, runId, maxJobs = 100, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(runId, 'runId');
    const limit = boundedInteger(maxJobs, 1, 100, 'maxJobs');
    const response = await this.#get(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/runs/${id}/jobs?per_page=100`, { signal });
    const payload = await readJsonLimited(response, this.#maxJsonBytes);
    if (!payload || !Array.isArray(payload.jobs) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
      throw new GitHubActionsError('GitHub returned an invalid workflow jobs response.', { code: 'invalid_response' });
    }
    if (payload.total_count > limit || payload.jobs.length > limit) {
      throw new GitHubActionsError(`Workflow run exceeds the configured ${limit}-job limit.`, { code: 'response_limit' });
    }
    return payload.jobs.map(normalizeJob);
  }

  async listRunArtifacts({ owner, repo, runId, maxArtifacts = 100, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(runId, 'runId');
    const limit = boundedInteger(maxArtifacts, 1, 100, 'maxArtifacts');
    const response = await this.#get(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/runs/${id}/artifacts?per_page=100`, { signal });
    const payload = await readJsonLimited(response, this.#maxJsonBytes);
    if (!payload || !Array.isArray(payload.artifacts) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
      throw new GitHubActionsError('GitHub returned an invalid workflow artifacts response.', { code: 'invalid_response' });
    }
    if (payload.total_count > limit || payload.artifacts.length > limit) {
      throw new GitHubActionsError(`Workflow run exceeds the configured ${limit}-artifact limit.`, { code: 'response_limit' });
    }
    return payload.artifacts.map(normalizeArtifact);
  }

  async cancelWorkflowRun({ owner, repo, runId, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(runId, 'runId');
    const endpoint = apiUrl(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/runs/${id}/cancel`);
    let response;
    try {
      response = await this.#fetchOnce(endpoint, {
        method: 'POST',
        headers: this.#apiHeaders(),
        redirect: 'manual',
      }, signal);
    } catch (cause) {
      throw new GitHubActionsError('Workflow cancellation outcome is unknown; it was not retried.', { code: 'cancel_unknown', cause });
    }
    if (response.status !== 202 && response.status !== 409) {
      await discard(response);
      const code = response.status >= 500 ? 'cancel_unknown' : 'cancel_rejected';
      throw new GitHubActionsError(`GitHub workflow cancellation returned status ${response.status}; it was not retried.`, { code, status: response.status });
    }
    await discard(response);
    return { accepted: response.status === 202, alreadyFinished: response.status === 409 };
  }

  async downloadRunLogs({ owner, repo, runId, destination, maxBytes, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(runId, 'runId');
    return this.#download(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/runs/${id}/logs`, destination, maxBytes, signal);
  }

  async downloadArtifact({ owner, repo, artifactId, destination, maxBytes, signal } = {}) {
    const coordinates = repositoryCoordinates(owner, repo);
    const id = positiveId(artifactId, 'artifactId');
    return this.#download(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/artifacts/${id}/zip`, destination, maxBytes, signal);
  }

  async #download(apiPath, destination, maxBytes, signal) {
    const limit = boundedInteger(maxBytes, 1, 1024 * 1024 * 1024, 'maxBytes');
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
      throw new Error('Download destination must be an absolute path controlled by the relay.');
    }
    let response;
    try {
      response = await this.#fetchOnce(apiUrl(apiPath), {
        method: 'GET',
        headers: this.#apiHeaders(),
        redirect: 'manual',
      }, signal);
    } catch (cause) {
      throw new GitHubActionsError('GitHub did not provide a download redirect.', { code: 'download_failed', cause });
    }
    if (response.status !== 302) {
      await discard(response);
      throw new GitHubActionsError(`GitHub download endpoint returned status ${response.status}.`, { code: 'download_failed', status: response.status });
    }
    const firstLocation = response.headers.get('location');
    await discard(response);
    const operationSignal = combinedSignal(signal, this.#downloadTimeoutMs);
    let temporaryUrl = validateTemporaryUrl(firstLocation, apiUrl(apiPath));
    let downloadResponse;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      try {
        downloadResponse = await this.#fetchOnce(temporaryUrl, {
          method: 'GET',
          headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
          redirect: 'manual',
        }, operationSignal, this.#downloadTimeoutMs);
      } catch {
        throw new GitHubActionsError('GitHub temporary download failed.', { code: 'download_failed' });
      }
      if (![301, 302, 303, 307, 308].includes(downloadResponse.status)) break;
      const next = downloadResponse.headers.get('location');
      await discard(downloadResponse);
      if (redirects === 3) throw new GitHubActionsError('GitHub download exceeded the redirect limit.', { code: 'download_failed' });
      temporaryUrl = validateTemporaryUrl(next, temporaryUrl);
    }
    if (!downloadResponse?.ok || !downloadResponse.body) {
      const status = downloadResponse?.status ?? null;
      if (downloadResponse) await discard(downloadResponse);
      throw new GitHubActionsError(`GitHub temporary download returned status ${status ?? 'unknown'}.`, { code: 'download_failed', status });
    }
    const declared = contentLength(downloadResponse);
    if (declared !== null && declared > limit) {
      await discard(downloadResponse);
      throw new GitHubActionsError(`GitHub download exceeds the configured ${limit}-byte limit.`, { code: 'download_limit' });
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let size = 0;
    let destinationCreated = false;
    let destinationHandle;
    const hash = crypto.createHash('sha256');
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        size += bytes.length;
        if (size > limit) {
          callback(new GitHubActionsError(`GitHub download exceeds the configured ${limit}-byte limit.`, { code: 'download_limit' }));
          return;
        }
        hash.update(bytes);
        callback(null, bytes);
      },
    });
    try {
      destinationHandle = await fs.open(destination, 'wx');
      destinationCreated = true;
      await pipeline(
        Readable.fromWeb(downloadResponse.body),
        counter,
        destinationHandle.createWriteStream(),
        { signal: operationSignal },
      );
    } catch (cause) {
      await discard(downloadResponse);
      await destinationHandle?.close().catch(() => {});
      if (destinationCreated) await fs.rm(destination, { force: true }).catch(() => {});
      if (cause instanceof GitHubActionsError) throw cause;
      throw new GitHubActionsError('GitHub download failed before completion.', { code: 'download_failed', cause });
    }
    if (declared !== null && size !== declared) {
      await fs.rm(destination, { force: true }).catch(() => {});
      throw new GitHubActionsError('GitHub download ended before its declared Content-Length.', { code: 'download_failed' });
    }
    return { path: destination, size, sha256: hash.digest('hex') };
  }

  async #get(apiPath, { headers = {}, signal, allowNotModified = false } = {}) {
    const endpoint = apiUrl(apiPath);
    let response;
    for (let attempt = 0; attempt <= this.#maxGetRetries; attempt += 1) {
      try {
        response = await this.#fetchOnce(endpoint, {
          method: 'GET',
          headers: { ...this.#apiHeaders(), ...headers },
          redirect: 'manual',
        }, signal);
      } catch (cause) {
        if (attempt === this.#maxGetRetries) {
          throw new GitHubActionsError('GitHub API GET failed after bounded retries.', { code: 'network_error', cause });
        }
        await this.#sleep(Math.min(1000 * (2 ** attempt), this.#maxRetryDelayMs), signal);
        continue;
      }
      if (response.ok || (allowNotModified && response.status === 304)) return response;
      if (!isRetryable(response) || attempt === this.#maxGetRetries) {
        const status = response.status;
        await discard(response);
        throw new GitHubActionsError(`GitHub API GET returned status ${status}.`, { code: 'github_http_error', status });
      }
      const wait = retryDelay(response, attempt, this.#maxRetryDelayMs);
      await discard(response);
      await this.#sleep(wait, signal);
    }
    throw new GitHubActionsError('GitHub API GET exhausted its retry budget.', { code: 'network_error' });
  }

  #apiHeaders({ json = false } = {}) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.#token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': USER_AGENT,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  #fetchOnce(url, init, signal, timeoutMs = this.#requestTimeoutMs) {
    return this.#fetch(url, { ...init, signal: combinedSignal(signal, timeoutMs) });
  }
}

function normalizeDispatch(payload, coordinates) {
  if (!payload || !Number.isSafeInteger(payload.workflow_run_id) || payload.workflow_run_id < 1) {
    throw new Error('workflow_run_id is missing or invalid.');
  }
  const runId = payload.workflow_run_id;
  const runUrl = verifiedGitHubUrl(payload.run_url, 'api.github.com');
  const htmlUrl = verifiedGitHubUrl(payload.html_url, 'github.com');
  const expectedApiPath = `/repos/${coordinates.owner}/${coordinates.repo}/actions/runs/${runId}`.toLowerCase();
  const expectedHtmlPath = `/${coordinates.owner}/${coordinates.repo}/actions/runs/${runId}`.toLowerCase();
  if (runUrl.pathname.toLowerCase() !== expectedApiPath || htmlUrl.pathname.toLowerCase() !== expectedHtmlPath) {
    throw new Error('Dispatch response URLs do not match the allowlisted repository and run.');
  }
  return { runId, runUrl: runUrl.href, htmlUrl: htmlUrl.href };
}

function normalizeRun(payload, expectedId, coordinates) {
  if (!payload || payload.id !== expectedId || typeof payload.status !== 'string' || !RUN_STATUS.has(payload.status)) {
    throw new GitHubActionsError('GitHub returned an invalid workflow run response.', { code: 'invalid_response' });
  }
  const fullName = payload.repository?.full_name;
  if (typeof fullName === 'string' && fullName.toLowerCase() !== `${coordinates.owner}/${coordinates.repo}`.toLowerCase()) {
    throw new GitHubActionsError('Workflow run repository does not match the allowlisted target.', { code: 'invalid_response' });
  }
  const htmlUrlValue = verifiedGitHubUrl(payload.html_url, 'github.com');
  const expectedHtmlPath = `/${coordinates.owner}/${coordinates.repo}/actions/runs/${expectedId}`.toLowerCase();
  if (htmlUrlValue.pathname.toLowerCase() !== expectedHtmlPath) {
    throw new GitHubActionsError('Workflow run URL does not match the allowlisted target.', { code: 'invalid_response' });
  }
  const htmlUrl = htmlUrlValue.href;
  return {
    id: expectedId,
    status: payload.status,
    conclusion: payload.conclusion == null ? null : String(payload.conclusion),
    htmlUrl,
    runAttempt: Number.isSafeInteger(payload.run_attempt) ? payload.run_attempt : 1,
    headBranch: typeof payload.head_branch === 'string' ? payload.head_branch : null,
    headSha: typeof payload.head_sha === 'string' ? payload.head_sha : null,
    workflowId: Number.isSafeInteger(payload.workflow_id) ? payload.workflow_id : null,
    createdAt: typeof payload.created_at === 'string' ? payload.created_at : null,
    updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : null,
  };
}

function normalizeJob(job) {
  if (!job || !Number.isSafeInteger(job.id) || job.id < 1 || typeof job.name !== 'string' || typeof job.status !== 'string') {
    throw new GitHubActionsError('GitHub returned an invalid workflow job.', { code: 'invalid_response' });
  }
  const steps = Array.isArray(job.steps) ? job.steps.slice(0, 200).map(step => ({
    number: Number.isSafeInteger(step.number) ? step.number : 0,
    name: typeof step.name === 'string' ? step.name.slice(0, 200) : 'Unnamed step',
    status: typeof step.status === 'string' ? step.status : 'unknown',
    conclusion: step.conclusion == null ? null : String(step.conclusion),
    startedAt: typeof step.started_at === 'string' ? step.started_at : null,
    completedAt: typeof step.completed_at === 'string' ? step.completed_at : null,
  })) : [];
  return {
    id: job.id,
    name: job.name.slice(0, 200),
    status: job.status,
    conclusion: job.conclusion == null ? null : String(job.conclusion),
    steps,
  };
}

function normalizeArtifact(artifact) {
  if (!artifact || !Number.isSafeInteger(artifact.id) || artifact.id < 1 || typeof artifact.name !== 'string' || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 0) {
    throw new GitHubActionsError('GitHub returned an invalid workflow artifact.', { code: 'invalid_response' });
  }
  return {
    id: artifact.id,
    name: artifact.name,
    size: artifact.size_in_bytes,
    expired: artifact.expired === true,
    digest: typeof artifact.digest === 'string' ? artifact.digest : null,
  };
}

function targetCoordinates(target) {
  if (!target || typeof target !== 'object') throw new Error('An allowlisted action target is required.');
  const coordinates = repositoryCoordinates(target.owner, target.repo);
  if (typeof target.workflow !== 'string' || !WORKFLOW.test(target.workflow)) throw new Error('Allowlisted workflow file is invalid.');
  if (typeof target.ref !== 'string' || !target.ref) throw new Error('Allowlisted Git ref is required.');
  if (!target.inputs || typeof target.inputs !== 'object' || Array.isArray(target.inputs)) throw new Error('Fixed workflow inputs must be an object.');
  return { ...coordinates, workflow: target.workflow, ref: target.ref };
}

function repositoryCoordinates(owner, repo) {
  if (typeof owner !== 'string' || typeof repo !== 'string' || !PART.test(owner) || !PART.test(repo)) {
    throw new Error('GitHub owner and repository must be validated allowlist entries.');
  }
  return { owner, repo };
}

function workflowEndpoint(coordinates, suffix) {
  return apiUrl(`/repos/${segment(coordinates.owner)}/${segment(coordinates.repo)}/actions/workflows/${segment(coordinates.workflow)}/${suffix}`);
}

function apiUrl(apiPath) {
  return new URL(apiPath.replace(/^\/+/, ''), API_BASE).href;
}

function segment(value) {
  return encodeURIComponent(value);
}

function positiveId(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function verifiedGitHubUrl(input, hostname) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== hostname || url.username || url.password || url.port) {
    throw new Error(`GitHub response URL must use https://${hostname}.`);
  }
  return url;
}

function validateTemporaryUrl(location, base) {
  if (typeof location !== 'string' || !location) throw new GitHubActionsError('GitHub download redirect omitted its Location header.', { code: 'download_failed' });
  let url;
  try {
    url = new URL(location, base);
  } catch (cause) {
    throw new GitHubActionsError('GitHub download redirect returned an invalid URL.', { code: 'download_failed', cause });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new GitHubActionsError('GitHub download redirect must be an HTTPS URL without credentials, ports, or fragments.', { code: 'download_failed' });
  }
  return url.href;
}

function contentLength(response) {
  const value = response.headers.get('content-length');
  if (value == null) return null;
  if (!/^\d+$/.test(value)) throw new GitHubActionsError('GitHub download returned an invalid Content-Length.', { code: 'download_failed' });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new GitHubActionsError('GitHub download Content-Length is too large.', { code: 'download_limit' });
  return parsed;
}

function isRetryable(response) {
  return RETRYABLE_STATUS.has(response.status)
    || (response.status === 403 && (response.headers.get('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'));
}

function retryDelay(response, attempt, maximum) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, maximum);
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) return Math.min(Math.max(1000, Number(reset) * 1000 - Date.now()), maximum);
  return Math.min(1000 * (2 ** attempt), maximum);
}

function pollInterval(response) {
  const value = response.headers.get('x-poll-interval');
  if (!value || !/^\d+$/.test(value)) return null;
  return Math.min(Number(value) * 1000, 60_000);
}

async function readJsonLimited(response, maxBytes) {
  const declared = contentLength(response);
  if (declared !== null && declared > maxBytes) throw new GitHubActionsError('GitHub JSON response exceeds the configured limit.', { code: 'response_limit' });
  if (!response.body) throw new GitHubActionsError('GitHub JSON response has no body.', { code: 'invalid_response' });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new GitHubActionsError('GitHub JSON response exceeds the configured limit.', { code: 'response_limit' });
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (cause) {
    throw new GitHubActionsError('GitHub returned invalid JSON.', { code: 'invalid_response', cause });
  }
}

async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {}
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
