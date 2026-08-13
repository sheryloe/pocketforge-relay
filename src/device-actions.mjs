import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import path from 'node:path';

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export class DeviceActionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DeviceActionError';
    this.code = code;
  }
}

export class DeviceActionManager {
  constructor({
    adapter,
    actionStoreRoot,
    approvalTtlMs = DEFAULT_APPROVAL_TTL_MS,
    maxRetainedActions = 100,
    clock = () => Date.now(),
    randomBytesFn = randomBytes,
    idFactory = randomUUID,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    if (!adapter
      || typeof adapter.createApprovedSnapshot !== 'function'
      || typeof adapter.reinspectApprovedSnapshot !== 'function'
      || typeof adapter.deleteApprovedSnapshot !== 'function'
      || typeof adapter.captureDeviceBinding !== 'function'
      || typeof adapter.assertDeviceBinding !== 'function'
      || typeof adapter.installAndCollectEvidence !== 'function') {
      throw new TypeError('adapter must implement the Android device adapter contract.');
    }
    if (typeof actionStoreRoot !== 'string' || !path.isAbsolute(actionStoreRoot)) {
      throw new TypeError('actionStoreRoot must be an injected absolute path.');
    }
    assertInteger('approvalTtlMs', approvalTtlMs, 1, DEFAULT_APPROVAL_TTL_MS);
    assertInteger('maxRetainedActions', maxRetainedActions, 1, 10_000);
    if (typeof clock !== 'function' || typeof randomBytesFn !== 'function' || typeof idFactory !== 'function') {
      throw new TypeError('clock, randomBytesFn, and idFactory must be functions.');
    }
    this.adapter = adapter;
    this.actionStoreRoot = path.resolve(actionStoreRoot);
    this.approvalTtlMs = approvalTtlMs;
    this.maxRetainedActions = maxRetainedActions;
    this.clock = clock;
    this.randomBytesFn = randomBytesFn;
    this.idFactory = idFactory;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.actions = new Map();
    this.lockedDevices = new Set();
    this.cleanupTasks = new Set();
  }

  async prepare({
    jobId,
    jobStatus,
    repository = null,
    resolvedCommit = null,
    artifactId,
    artifactPath,
    workspaceRoot,
    deviceId,
  }) {
    if (jobStatus !== 'succeeded') {
      throw new DeviceActionError('JOB_NOT_SUCCEEDED', 'Device evidence requires a succeeded build job.');
    }
    const normalizedJobId = boundedIdentifier(jobId, 'jobId');
    const normalizedArtifactId = boundedIdentifier(artifactId, 'artifactId');
    const normalizedDeviceId = boundedIdentifier(deviceId, 'deviceId');
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
      throw new DeviceActionError('INVALID_WORKSPACE', 'workspaceRoot must be an absolute path.');
    }
    if (resolvedCommit != null && !/^[a-f0-9]{40}$/i.test(String(resolvedCommit))) {
      throw new DeviceActionError('INVALID_RESOLVED_COMMIT', 'resolvedCommit must be a 40-character Git object ID.');
    }

    this.#expirePendingActions();
    this.#pruneActions();
    if (this.actions.size >= this.maxRetainedActions) {
      throw new DeviceActionError('ACTION_LIMIT_REACHED', 'Too many device actions are retained.');
    }

    const now = this.clock();
    const actionId = actionPathIdentifier(this.idFactory());
    if (this.actions.has(actionId)) throw new DeviceActionError('DUPLICATE_ACTION_ID', 'Device action ID already exists.');
    const deviceResult = await this.adapter.captureDeviceBinding(normalizedDeviceId);
    if (!deviceResult?.device || deviceResult.device.deviceId !== normalizedDeviceId
      || !validDeviceBinding(deviceResult.binding, normalizedDeviceId)) {
      throw new DeviceActionError('INVALID_DEVICE_PROJECTION', 'Adapter returned an invalid device binding.');
    }
    let artifact;
    try {
      artifact = await this.adapter.createApprovedSnapshot({
        artifactPath,
        workspaceRoot,
        actionStoreRoot: this.actionStoreRoot,
        actionId,
        requireDebuggable: true,
      });
    } catch (error) {
      throw wrapAdapterError(error);
    }
    if (!artifact || !SHA256.test(artifact.sha256)) {
      await this.adapter.deleteApprovedSnapshot(artifact).catch(() => {});
      throw new DeviceActionError('INVALID_ARTIFACT_INSPECTION', 'Adapter returned an invalid APK digest.');
    }
    const approvalTokenBytes = this.randomBytesFn(32);
    if (!Buffer.isBuffer(approvalTokenBytes) || approvalTokenBytes.length !== 32) {
      throw new TypeError('randomBytesFn must return exactly 32 bytes.');
    }
    const approvalToken = approvalTokenBytes.toString('base64url');
    const action = {
      id: actionId,
      jobId: normalizedJobId,
      artifactId: normalizedArtifactId,
      deviceId: normalizedDeviceId,
      status: 'awaiting_approval',
      createdAtMs: now,
      expiresAtMs: now + this.approvalTtlMs,
      approvedAtMs: null,
      finishedAtMs: null,
      repository: boundedOptionalText(repository, 500),
      resolvedCommit: resolvedCommit == null ? null : String(resolvedCommit).toLowerCase(),
      artifact,
      device: deviceResult.device,
      deviceBinding: deviceResult.binding,
      tokenHash: null,
      evidence: null,
      evidenceDir: null,
      error: null,
      snapshotDeletedAtMs: null,
    };
    action.tokenHash = hashApprovalToken(approvalToken, action);
    this.actions.set(action.id, action);
    action.expiryTimer = this.setTimeoutFn(() => this.#expireAction(action, true), this.approvalTtlMs);
    action.expiryTimer?.unref?.();
    return {
      action: publicAction(action),
      approvalToken,
    };
  }

  getAction(actionId) {
    const action = this.actions.get(String(actionId));
    if (!action) return null;
    this.#expireAction(action);
    return publicAction(action);
  }

  listActions({ jobId } = {}) {
    this.#expirePendingActions();
    const filterJobId = jobId == null ? null : String(jobId);
    return [...this.actions.values()]
      .filter(action => filterJobId == null || action.jobId === filterJobId)
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .map(publicAction);
  }

  async approve({ actionId, approvalToken }) {
    const action = this.actions.get(String(actionId));
    if (!action) throw new DeviceActionError('ACTION_NOT_FOUND', 'Device action was not found.');
    this.#expireAction(action);
    if (action.status === 'expired') {
      throw new DeviceActionError('APPROVAL_EXPIRED', 'Device action approval expired.');
    }
    if (action.status !== 'awaiting_approval' || !action.tokenHash) {
      throw new DeviceActionError('APPROVAL_ALREADY_USED', 'Device action approval was already used.');
    }
    if (typeof approvalToken !== 'string' || !APPROVAL_TOKEN.test(approvalToken)) {
      throw new DeviceActionError('INVALID_APPROVAL', 'Device action approval is invalid.');
    }
    const candidateHash = hashApprovalToken(approvalToken, action);
    if (candidateHash.length !== action.tokenHash.length || !timingSafeEqual(candidateHash, action.tokenHash)) {
      throw new DeviceActionError('INVALID_APPROVAL', 'Device action approval is invalid.');
    }
    if (this.lockedDevices.has(action.deviceBinding.mutexFingerprint)) {
      throw new DeviceActionError('DEVICE_BUSY', 'Another approved action is using this device.');
    }

    const lockKey = action.deviceBinding.mutexFingerprint;
    this.clearTimeoutFn(action.expiryTimer);
    action.expiryTimer = null;
    this.lockedDevices.add(lockKey);
    action.tokenHash = null;
    action.approvedAtMs = this.clock();
    action.status = 'validating_artifact';
    try {
      await this.adapter.assertDeviceBinding(action.deviceBinding);
      const artifact = await this.adapter.reinspectApprovedSnapshot(action.artifact);
      if (!sameArtifactBinding(artifact, action.artifact)) {
        throw new DeviceActionError('ARTIFACT_BINDING_CHANGED', 'APK no longer matches the approved artifact binding.');
      }

      const evidenceDir = path.join(action.artifact.actionRoot, 'evidence');
      action.evidenceDir = evidenceDir;
      const result = await this.adapter.installAndCollectEvidence({
        deviceBinding: action.deviceBinding,
        artifact,
        evidenceDir,
        jobId: action.jobId,
        actionId: action.id,
        repository: action.repository,
        resolvedCommit: action.resolvedCommit,
        approvedAt: iso(action.approvedAtMs),
        onPhase: phase => {
          if (['installing', 'launching', 'collecting_evidence'].includes(phase)) action.status = phase;
        },
      });
      action.evidence = result.evidence;
      action.status = 'succeeded';
      action.finishedAtMs = this.clock();
    } catch (error) {
      action.evidence = error?.evidence || null;
      action.status = 'failed';
      action.finishedAtMs = this.clock();
      action.error = {
        code: boundedOptionalText(error?.code, 80) || 'DEVICE_ACTION_FAILED',
        message: safeErrorMessage(error),
      };
      const wrapped = error instanceof DeviceActionError
        ? error
        : new DeviceActionError(action.error.code, action.error.message, { cause: error });
      wrapped.action = publicAction(action);
      throw wrapped;
    } finally {
      try {
        await this.adapter.deleteApprovedSnapshot(action.artifact);
        action.snapshotDeletedAtMs = this.clock();
      } catch (cleanupError) {
        if (!action.error) {
          action.status = 'failed';
          action.finishedAtMs = this.clock();
          action.error = {
            code: 'SNAPSHOT_CLEANUP_FAILED',
            message: safeErrorMessage(cleanupError),
          };
        }
      }
      this.lockedDevices.delete(lockKey);
    }
    if (action.error?.code === 'SNAPSHOT_CLEANUP_FAILED') {
      const cleanupFailure = new DeviceActionError(action.error.code, action.error.message);
      cleanupFailure.action = publicAction(action);
      throw cleanupFailure;
    }
    return publicAction(action);
  }

  async discard(actionId) {
    const action = this.actions.get(String(actionId));
    if (!action) throw new DeviceActionError('ACTION_NOT_FOUND', 'Device action was not found.');
    this.#expireAction(action);
    if (!['awaiting_approval', 'expired'].includes(action.status)) {
      throw new DeviceActionError('ACTION_NOT_DISCARDABLE', 'Only an unapproved or expired action can be discarded.');
    }
    this.clearTimeoutFn(action.expiryTimer);
    action.expiryTimer = null;
    action.tokenHash = null;
    await (action.cleanupTask || this.#deleteExpiredSnapshot(action));
    if (action.snapshotDeletedAtMs == null) {
      throw new DeviceActionError('SNAPSHOT_CLEANUP_FAILED', 'Unable to delete the unapproved APK snapshot.');
    }
    this.actions.delete(action.id);
    return { actionId: action.id, discarded: true };
  }

  forgetTerminalAction(actionId) {
    const action = this.actions.get(String(actionId));
    if (!action || !['succeeded', 'failed', 'expired'].includes(action.status)) return false;
    this.actions.delete(action.id);
    return true;
  }

  async shutdown() {
    for (const action of this.actions.values()) {
      this.clearTimeoutFn(action.expiryTimer);
      action.expiryTimer = null;
      if (action.status === 'awaiting_approval') this.#expireAction(action, true);
    }
    await Promise.allSettled([...this.cleanupTasks]);
  }

  #expirePendingActions() {
    for (const action of this.actions.values()) this.#expireAction(action);
  }

  #expireAction(action, forced = false) {
    if (action.status === 'awaiting_approval' && (forced || this.clock() >= action.expiresAtMs)) {
      action.status = 'expired';
      action.tokenHash = null;
      action.finishedAtMs = this.clock();
      this.clearTimeoutFn(action.expiryTimer);
      action.expiryTimer = null;
      action.cleanupTask = this.#trackCleanup(this.#deleteExpiredSnapshot(action));
    }
  }

  #trackCleanup(promise) {
    const task = Promise.resolve(promise);
    this.cleanupTasks.add(task);
    task.finally(() => this.cleanupTasks.delete(task)).catch(() => {});
    return task;
  }

  async #deleteExpiredSnapshot(action) {
    if (action.snapshotDeletedAtMs != null) return;
    try {
      await this.adapter.deleteApprovedSnapshot(action.artifact);
      action.snapshotDeletedAtMs = this.clock();
      if (action.status === 'expired') this.actions.delete(action.id);
    } catch (error) {
      action.error ??= {
        code: 'SNAPSHOT_CLEANUP_FAILED',
        message: safeErrorMessage(error),
      };
      throw new DeviceActionError('SNAPSHOT_CLEANUP_FAILED', 'Unable to delete the unapproved APK snapshot.', { cause: error });
    }
  }

  #pruneActions() {
    // Records carrying retained evidence are never evicted implicitly. The
    // authenticated evidence deletion path explicitly forgets its record.
  }
}

function hashApprovalToken(token, action) {
  return createHash('sha256')
    .update(token)
    .update('\0')
    .update(action.id)
    .update('\0')
    .update(action.jobId)
    .update('\0')
    .update(action.artifact.sha256)
    .update('\0')
    .update(action.deviceBinding.approvalFingerprint)
    .digest();
}

function publicAction(action) {
  return {
    id: action.id,
    jobId: action.jobId,
    artifactId: action.artifactId,
    deviceId: action.deviceId,
    status: action.status,
    createdAt: iso(action.createdAtMs),
    expiresAt: iso(action.expiresAtMs),
    approvedAt: iso(action.approvedAtMs),
    finishedAt: iso(action.finishedAtMs),
    source: {
      repository: action.repository,
      resolvedCommit: action.resolvedCommit,
    },
    artifact: {
      relativePath: action.artifact.relativePath,
      size: action.artifact.size,
      sha256: action.artifact.sha256,
      applicationId: action.artifact.applicationId,
      versionName: action.artifact.versionName,
      versionCode: action.artifact.versionCode,
      targetSdk: action.artifact.targetSdk,
      debuggable: action.artifact.debuggable,
      signatureVerified: action.artifact.signatureVerified,
      signerSha256: action.artifact.signerSha256,
    },
    device: { ...action.device },
    evidence: action.evidence,
    error: action.error,
  };
}

function boundedIdentifier(value, name) {
  const text = String(value ?? '');
  if (!text || text.length > 128 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new DeviceActionError('INVALID_IDENTIFIER', `${name} is missing or malformed.`);
  }
  return text;
}

function actionPathIdentifier(value) {
  const text = boundedIdentifier(value, 'actionId');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new DeviceActionError('INVALID_IDENTIFIER', 'actionId must be a path-safe identifier.');
  }
  return text;
}

function validDeviceBinding(binding, deviceId) {
  return binding && binding.deviceId === deviceId
    && SHA256.test(binding.approvalFingerprint)
    && SHA256.test(binding.mutexFingerprint);
}

function sameArtifactBinding(left, right) {
  return left.sha256 === right.sha256
    && left.size === right.size
    && left.applicationId === right.applicationId
    && left.versionName === right.versionName
    && left.versionCode === right.versionCode
    && left.targetSdk === right.targetSdk
    && left.debuggable === right.debuggable
    && left.signerSha256 === right.signerSha256;
}

function wrapAdapterError(error) {
  if (error instanceof DeviceActionError) return error;
  return new DeviceActionError(
    boundedOptionalText(error?.code, 80) || 'DEVICE_ACTION_PREPARE_FAILED',
    safeErrorMessage(error),
    { cause: error },
  );
}

function boundedOptionalText(value, maxLength) {
  if (value == null || value === '') return null;
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, maxLength);
}

function safeErrorMessage(error) {
  if (!(error instanceof DeviceActionError) && error?.name !== 'AndroidDeviceError') {
    return 'Device action failed during a server-managed operation.';
  }
  return String(error?.message || 'Device action failed.')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 300);
}

function iso(milliseconds) {
  return milliseconds == null ? null : new Date(milliseconds).toISOString();
}

function assertInteger(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}
