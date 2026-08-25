import crypto from 'node:crypto';

const SOURCE_TYPES = new Set(['local_job', 'actions_run']);
const INTENTS = new Set(['explain_failure', 'repair_plan', 'verification_plan']);
const STEP_KINDS = new Set(['inspect', 'edit', 'test']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PATH = /^(?!\/|[A-Za-z]:|.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,300}$/;

export class ProposalAgentManager {
  constructor({ adapter, sourceResolver, now = Date.now, randomId = crypto.randomUUID, approvalTtlMs = 5 * 60_000, timeoutMs = 30_000, maxActive = 2 } = {}) {
    if (!adapter || !validIdentifier(adapter.id) || !validVersion(adapter.version) || typeof adapter.propose !== 'function') throw new Error('A versioned proposal-only agent adapter is required.');
    if (typeof sourceResolver !== 'function') throw new Error('A server-owned proposal evidence resolver is required.');
    if (typeof now !== 'function' || typeof randomId !== 'function') throw new Error('Proposal clock and id generator must be functions.');
    if (!Number.isSafeInteger(approvalTtlMs) || approvalTtlMs < 30_000 || approvalTtlMs > 10 * 60_000) throw new Error('Proposal approval TTL must be between 30 seconds and 10 minutes.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error('Proposal timeout must be between 1 and 60 seconds.');
    if (!Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > 4) throw new Error('Active proposal limit must be between 1 and 4.');
    this.adapter = adapter;
    this.sourceResolver = sourceResolver;
    this.now = now;
    this.randomId = randomId;
    this.approvalTtlMs = approvalTtlMs;
    this.timeoutMs = timeoutMs;
    this.maxActive = maxActive;
    this.previews = new Map();
    this.active = 0;
  }

  descriptor() {
    return Object.freeze({ id: this.adapter.id, version: this.adapter.version, mode: 'proposal_only', capabilities: Object.freeze(['evidence-preview', 'explicit-consent', 'structured-proposal']) });
  }

  async createPreview(input) {
    exactKeys(input, ['sourceType', 'sourceId', 'intent']);
    if (!SOURCE_TYPES.has(input.sourceType) || !UUID.test(String(input.sourceId || '')) || !INTENTS.has(input.intent)) throw proposalError('Proposal request is malformed.', 400, 'proposal_input');
    this.prune();
    const source = await this.sourceResolver({ sourceType: input.sourceType, sourceId: input.sourceId });
    if (!source) throw proposalError('Proposal evidence source was not found.', 404, 'proposal_source_not_found');
    const id = this.randomId();
    if (typeof id !== 'string' || !UUID.test(id) || this.previews.has(id)) throw new Error('Proposal preview id generator returned an invalid or duplicate id.');
    const createdAtMs = this.now();
    const record = { id, createdAt: new Date(createdAtMs).toISOString(), expiresAt: new Date(createdAtMs + this.approvalTtlMs).toISOString(), intent: input.intent, evidence: projectEvidence(input.sourceType, input.sourceId, source) };
    this.previews.set(id, record);
    return Object.freeze({ ...record, adapter: this.descriptor() });
  }

  async approve(input) {
    exactKeys(input, ['previewId', 'decision']);
    this.prune();
    if (input?.decision !== 'approve') throw proposalError('Explicit decision "approve" is required.', 400, 'proposal_decision');
    const record = this.previews.get(input.previewId);
    if (!record) throw proposalError('Proposal preview was not found, expired, or already consumed.', 404, 'proposal_preview_not_found');
    if (this.active >= this.maxActive) throw proposalError('The active proposal limit has been reached.', 429, 'proposal_capacity');
    this.previews.delete(input.previewId);
    this.active++;
    try {
      const result = await withTimeout(signal => this.adapter.propose({ intent: record.intent, evidence: structuredClone(record.evidence), signal }), this.timeoutMs);
      return Object.freeze({ previewId: record.id, generatedAt: new Date(this.now()).toISOString(), provider: Object.freeze({ id: this.adapter.id, version: this.adapter.version }), proposal: validateProposal(result) });
    } catch (error) {
      if (error?.code === 'proposal_timeout' || error?.code === 'proposal_output') throw error;
      throw proposalError('Proposal provider failed without an executable result.', 502, 'proposal_provider');
    } finally { this.active--; }
  }

  prune() {
    const now = this.now();
    for (const [id, preview] of this.previews) if (Date.parse(preview.expiresAt) <= now) this.previews.delete(id);
  }
}

function projectEvidence(sourceType, sourceId, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw proposalError('Proposal evidence source is malformed.', 500, 'proposal_source');
  const logs = Array.isArray(source.logs) ? source.logs.slice(-20).map(log => Object.freeze({ channel: ['stdout', 'stderr', 'system'].includes(log?.channel) ? log.channel : 'system', message: boundedText(log?.message, 1_000) })) : [];
  const artifacts = Array.isArray(source.artifacts) ? source.artifacts.slice(0, 20).map(artifact => Object.freeze({ name: boundedText(artifact?.name, 200), sha256: typeof artifact?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(artifact.sha256) ? artifact.sha256 : null })) : [];
  return Object.freeze({
    sourceType, sourceId, status: boundedText(source.status, 100), repository: nullableText(source.repository, 500), ref: nullableText(source.ref, 300), error: nullableText(source.error, 2_000),
    failure: source.failure && typeof source.failure === 'object' ? Object.freeze({ code: nullableText(source.failure.code, 100), title: nullableText(source.failure.title, 300), summary: nullableText(source.failure.summary, 1_000) }) : null,
    logs: Object.freeze(logs), artifacts: Object.freeze(artifacts),
  });
}

function validateProposal(value) {
  exactKeys(value, ['summary', 'diagnosis', 'steps', 'risks', 'verification'], 'proposal_output');
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 12 || !Array.isArray(value.risks) || value.risks.length > 8 || !Array.isArray(value.verification) || value.verification.length < 1 || value.verification.length > 8) throw proposalError('Proposal provider returned an invalid proposal.', 502, 'proposal_output');
  const steps = value.steps.map(step => {
    exactKeys(step, ['kind', 'description', 'path'], 'proposal_output');
    if (!STEP_KINDS.has(step.kind) || !nonEmptyText(step.description, 1_000) || (step.path !== undefined && (typeof step.path !== 'string' || !SAFE_PATH.test(step.path)))) throw proposalError('Proposal provider returned an invalid proposal.', 502, 'proposal_output');
    return Object.freeze({ kind: step.kind, description: step.description, ...(step.path === undefined ? {} : { path: step.path }) });
  });
  if (!nonEmptyText(value.summary, 4_000) || !nonEmptyText(value.diagnosis, 4_000) || value.risks.some(item => !nonEmptyText(item, 1_000)) || value.verification.some(item => !nonEmptyText(item, 1_000))) throw proposalError('Proposal provider returned an invalid proposal.', 502, 'proposal_output');
  return Object.freeze({ summary: value.summary, diagnosis: value.diagnosis, steps: Object.freeze(steps), risks: Object.freeze([...value.risks]), verification: Object.freeze([...value.verification]) });
}

function exactKeys(value, allowed, code = 'proposal_input') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key))) throw proposalError(code === 'proposal_output' ? 'Proposal provider returned an invalid proposal.' : 'Proposal request is malformed.', code === 'proposal_output' ? 502 : 400, code);
}

async function withTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(proposalError('Proposal provider timed out.', 504, 'proposal_timeout')); }, timeoutMs); });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]); }
  finally { clearTimeout(timer); }
}

function boundedText(value, max) { return String(value ?? '').replace(/\u0000/g, '').slice(0, max); }
function nullableText(value, max) { return value == null ? null : boundedText(value, max); }
function nonEmptyText(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\u0000'); }
function validIdentifier(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function validVersion(value) { return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value); }
function proposalError(message, statusCode, code) { const error = new Error(message); error.statusCode = statusCode; error.code = code; return error; }
