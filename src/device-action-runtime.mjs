import fs from 'node:fs/promises';
import path from 'node:path';
import { AndroidDeviceAdapter, AndroidDeviceError, verifyEvidenceBundle } from './android-device-adapter.mjs';
import { DeviceActionError, DeviceActionManager } from './device-actions.mjs';

const ACTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'expired']);
const EVIDENCE_FILES = Object.freeze({
  json: Object.freeze({ name: 'device-evidence.json', contentType: 'application/json; charset=utf-8' }),
  logcat: Object.freeze({ name: 'logcat.txt', contentType: 'text/plain; charset=utf-8' }),
  crash: Object.freeze({ name: 'crash.txt', contentType: 'text/plain; charset=utf-8' }),
  screenshot: Object.freeze({ name: 'screenshot.png', contentType: 'image/png' }),
});

export class DeviceActionRuntime {
  constructor({ manager, adapter, actionStoreRoot, evidenceIntegrityKey, maxConcurrentActions = 1 }) {
    if (!manager || !adapter || typeof adapter.listDevices !== 'function') throw new TypeError('manager and adapter are required.');
    if (typeof actionStoreRoot !== 'string' || !path.isAbsolute(actionStoreRoot)) throw new TypeError('actionStoreRoot must be absolute.');
    this.manager = manager;
    this.adapter = adapter;
    this.actionStoreRoot = path.resolve(actionStoreRoot);
    this.evidenceIntegrityKey = Buffer.from(evidenceIntegrityKey);
    if (!Number.isInteger(maxConcurrentActions) || maxConcurrentActions < 1 || maxConcurrentActions > 4) throw new TypeError('maxConcurrentActions must be between 1 and 4.');
    this.maxConcurrentActions = maxConcurrentActions;
    this.activeApprovals = 0;
    this.activePreparations = 0;
    this.tasks = new Set();
    this.deletedEvidence = new Set();
    this.recoveredActions = new Map();
    this.stopped = false;
    this.shutdownPromise = null;
  }

  listDevices() {
    this.#assertAccepting();
    return this.#track(this.adapter.listDevices());
  }

  listActions({ jobId } = {}) {
    const live = this.manager.listActions(jobId == null ? {} : { jobId });
    const recovered = [...this.recoveredActions.values()].filter(action => jobId == null || action.jobId === String(jobId));
    return [...live, ...recovered].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }
  getAction(actionId) { return this.manager.getAction(actionId) ?? this.recoveredActions.get(String(actionId)) ?? null; }

  async initialize() {
    const entries = await fs.readdir(this.actionStoreRoot, { withFileTypes: true });
    const retainedLimit = this.manager.maxRetainedActions ?? 100;
    if (entries.length > retainedLimit) throw runtimeError('ACTION_LIMIT_REACHED', 'Action store exceeds the retained action limit.', 500);
    for (const entry of entries) {
      if (!ACTION_ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) throw runtimeError('INVALID_ACTION_STORE_ENTRY', 'Action store contains an unexpected entry.', 500);
      const actionDir = path.join(this.actionStoreRoot, entry.name);
      const actionStat = await fs.lstat(actionDir);
      const realAction = await fs.realpath(actionDir);
      const expectedAction = path.join(await fs.realpath(this.actionStoreRoot), entry.name);
      if (!actionStat.isDirectory() || actionStat.isSymbolicLink() || realAction !== expectedAction || !realAction.startsWith(`${await fs.realpath(this.actionStoreRoot)}${path.sep}`)) throw runtimeError('INVALID_ACTION_STORE_ENTRY', 'Action directory escapes the action store.', 500);
      const children = await fs.readdir(actionDir, { withFileTypes: true });
      if (children.some(child => !['evidence', 'approved.apk'].includes(child.name))) throw runtimeError('INVALID_ACTION_STORE_ENTRY', 'Action directory contains an unexpected entry.', 500);
      const evidenceEntry = children.find(child => child.name === 'evidence');
      const snapshotEntry = children.find(child => child.name === 'approved.apk');
      if (snapshotEntry && (!snapshotEntry.isFile() || snapshotEntry.isSymbolicLink())) throw runtimeError('INVALID_ACTION_STORE_ENTRY', 'Approved snapshot is not a regular file.', 500);
      if (evidenceEntry) {
        if (!evidenceEntry.isDirectory() || evidenceEntry.isSymbolicLink()) throw runtimeError('INVALID_EVIDENCE_PATH', 'Evidence path is not a regular directory.', 500);
        const evidenceDir = await this.#validatedEvidenceDir(entry.name);
        const partialEntries = await fs.readdir(evidenceDir, { withFileTypes: true });
        if (!partialEntries.some(file => file.name === 'device-evidence.json')) {
          const partialNames = new Set(['logcat.txt', 'crash.txt', 'screenshot.png']);
          if (partialEntries.some(file => !file.isFile() || file.isSymbolicLink() || !partialNames.has(file.name))) throw runtimeError('INVALID_EVIDENCE_PATH', 'Incomplete evidence contains an unexpected entry.', 500);
          for (const file of partialEntries) await fs.unlink(path.join(evidenceDir,file.name));
          await fs.rmdir(evidenceDir);
          if (snapshotEntry) {
            const snapshotPath=path.join(actionDir,'approved.apk');
            await fs.chmod(snapshotPath,0o600);
            await fs.unlink(snapshotPath);
          }
          await fs.rmdir(actionDir);
          continue;
        }
        const evidence = await verifyEvidenceBundle({ evidenceDir, evidenceIntegrityKey: this.evidenceIntegrityKey });
        if (evidence.actionId !== entry.name || !ACTION_ID.test(String(evidence.jobId)) || !['succeeded', 'failed'].includes(evidence.status)) throw runtimeError('INVALID_EVIDENCE_MANIFEST', 'Recovered evidence identity is invalid.', 500);
        const evidenceFiles = await fs.readdir(evidenceDir, { withFileTypes: true });
        const expectedFiles = new Set(['device-evidence.json', ...Object.values(evidence.files ?? {}).map(file => file.name)]);
        if (evidenceFiles.length !== expectedFiles.size || evidenceFiles.some(file => !file.isFile() || file.isSymbolicLink() || !expectedFiles.has(file.name))) throw runtimeError('INVALID_EVIDENCE_PATH', 'Evidence directory contains an unexpected entry.', 500);
        if (snapshotEntry) {
          const snapshotPath = path.join(actionDir, 'approved.apk');
          await fs.chmod(snapshotPath, 0o600);
          await fs.unlink(snapshotPath);
        }
        this.recoveredActions.set(entry.name, recoveredAction(evidence));
      } else {
        if (snapshotEntry) {
          const snapshotPath = path.join(actionDir, 'approved.apk');
          await fs.chmod(snapshotPath, 0o600);
          await fs.unlink(snapshotPath);
        }
        await fs.rmdir(actionDir);
      }
    }
    return this;
  }

  async prepare(input) {
    this.#assertAccepting();
    const liveActions = this.manager.listActions();
    const pending = liveActions.filter(action => action.status === 'awaiting_approval').length;
    if (this.activePreparations + pending >= this.maxConcurrentActions) throw runtimeError('DEVICE_PREPARE_CAPACITY', 'Device action preparation capacity is full.', 429);
    const retainedLimit = this.manager.maxRetainedActions ?? 100;
    if (this.recoveredActions.size + liveActions.length + this.activePreparations >= retainedLimit) throw runtimeError('ACTION_LIMIT_REACHED', 'Too many device actions are retained.', 429);
    this.activePreparations++;
    try { return await this.#track(this.manager.prepare(input)); }
    finally { this.activePreparations--; }
  }

  async approve(input) {
    this.#assertAccepting();
    if (this.activeApprovals >= this.maxConcurrentActions) throw runtimeError('DEVICE_ACTION_CAPACITY', 'Device action capacity is full.', 429);
    this.activeApprovals++;
    let task;
    try { task = this.manager.approve(input); }
    catch (error) { this.activeApprovals--; throw error; }
    Promise.resolve(task).finally(() => { this.activeApprovals--; }).catch(() => {});
    this.#track(task);
    const firstTurn = await Promise.race([
      task.then(action => ({ action }), error => ({ error })),
      new Promise(resolve => setImmediate(() => resolve(null))),
    ]);
    if (firstTurn?.error) throw firstTurn.error;
    return firstTurn?.action ?? this.manager.getAction(input.actionId);
  }

  async getEvidenceFile(actionId, kind) {
    const action = this.#terminalAction(actionId);
    if (this.deletedEvidence.has(action.id)) throw runtimeError('EVIDENCE_DELETED', 'Device evidence was deleted.', 410);
    const descriptor = EVIDENCE_FILES[kind];
    if (!descriptor) throw runtimeError('EVIDENCE_KIND_NOT_FOUND', 'Device evidence file was not found.', 404);
    const evidenceDir = await this.#validatedEvidenceDir(action.id);
    const evidence = await verifyEvidenceBundle({ evidenceDir, evidenceIntegrityKey: this.evidenceIntegrityKey });
    if (kind !== 'json' && !Object.values(evidence.files ?? {}).some(file => file?.name === descriptor.name)) {
      throw runtimeError('EVIDENCE_FILE_NOT_FOUND', 'Device evidence file was not found.', 404);
    }
    const absolutePath = path.join(evidenceDir, descriptor.name);
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw runtimeError('EVIDENCE_FILE_NOT_FOUND', 'Device evidence file was not found.', 404);
    return { absolutePath, name: descriptor.name, contentType: descriptor.contentType, size: stat.size };
  }

  async deleteEvidence(actionId) {
    if (this.deletedEvidence.has(String(actionId))) return this.#publicDeletion(String(actionId));
    const action = this.#terminalAction(actionId);
    let evidenceDir;
    try {
      evidenceDir = await this.#validatedEvidenceDir(action.id);
    } catch (error) {
      if (await this.#forgetTerminalWithoutEvidence(action)) return this.#publicDeletion(action.id);
      throw error;
    }
    let entries;
    try { entries = await fs.readdir(evidenceDir, { withFileTypes: true }); }
    catch (error) {
      if (error?.code === 'ENOENT') {
        this.deletedEvidence.add(action.id);
        this.manager.forgetTerminalAction?.(action.id);
        this.recoveredActions.delete(action.id);
        return this.#publicDeletion(action.id);
      }
      throw error;
    }
    const allowed = new Set(Object.values(EVIDENCE_FILES).map(file => file.name));
    if (entries.some(entry => !allowed.has(entry.name) || entry.isDirectory())) {
      throw runtimeError('UNEXPECTED_EVIDENCE_ENTRY', 'Evidence directory contains an unexpected entry.', 409);
    }
    for (const entry of entries) await fs.unlink(path.join(evidenceDir, entry.name));
    await fs.rmdir(evidenceDir);
    this.deletedEvidence.add(action.id);
    this.manager.forgetTerminalAction?.(action.id);
    this.recoveredActions.delete(action.id);
    await fs.rmdir(path.join(this.actionStoreRoot, action.id)).catch(error => {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    });
    return this.#publicDeletion(action.id);
  }

  async discard(actionId) {
    this.#assertAccepting();
    return this.#track(this.manager.discard(actionId));
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    this.shutdownPromise = Promise.allSettled([...this.tasks])
      .then(() => this.manager.shutdown?.())
      .then(() => {});
    return this.shutdownPromise;
  }

  #track(promise) {
    const task = Promise.resolve(promise);
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task)).catch(() => {});
    return task;
  }

  #assertAccepting() {
    if (this.stopped) throw runtimeError('DEVICE_ACTIONS_STOPPED', 'Device actions are shutting down.', 503);
  }

  #terminalAction(actionId) {
    if (!ACTION_ID.test(String(actionId))) throw runtimeError('ACTION_NOT_FOUND', 'Device action was not found.', 404);
    if (this.deletedEvidence.has(String(actionId))) throw runtimeError('EVIDENCE_DELETED', 'Device evidence was deleted.', 410);
    const action = this.getAction(actionId);
    if (!action) throw runtimeError('ACTION_NOT_FOUND', 'Device action was not found.', 404);
    if (!TERMINAL.has(action.status)) throw runtimeError('ACTION_NOT_TERMINAL', 'Device evidence is available only after the action finishes.', 409);
    return action;
  }

  #evidenceDir(actionId) {
    const directory = path.resolve(this.actionStoreRoot, actionId, 'evidence');
    const relative = path.relative(this.actionStoreRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw runtimeError('INVALID_EVIDENCE_PATH', 'Device evidence path is invalid.', 500);
    return directory;
  }

  async #validatedEvidenceDir(actionId) {
    const actionDir = path.resolve(this.actionStoreRoot, actionId);
    const evidenceDir = this.#evidenceDir(actionId);
    for (const directory of [this.actionStoreRoot, actionDir, evidenceDir]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw runtimeError('INVALID_EVIDENCE_PATH', 'Device evidence path is not a regular directory.', 409);
    }
    const [realStore, realAction, realEvidence] = await Promise.all([
      fs.realpath(this.actionStoreRoot), fs.realpath(actionDir), fs.realpath(evidenceDir),
    ]);
    const expectedAction = path.join(realStore, actionId);
    const expectedEvidence = path.join(expectedAction, 'evidence');
    if (realAction !== expectedAction
      || realEvidence !== expectedEvidence
      || !realAction.startsWith(`${realStore}${path.sep}`)
      || !realEvidence.startsWith(`${realAction}${path.sep}`)) {
      throw runtimeError('INVALID_EVIDENCE_PATH', 'Device evidence path escapes the action store.', 409);
    }
    return realEvidence;
  }

  #publicDeletion(actionId) { return { actionId, deleted: true }; }

  async #forgetTerminalWithoutEvidence(action) {
    const actionDir = path.join(this.actionStoreRoot, action.id);
    let stat;
    try { stat = await fs.lstat(actionDir); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.manager.forgetTerminalAction?.(action.id);
      this.recoveredActions.delete(action.id);
      this.deletedEvidence.add(action.id);
      return true;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const realAction = await fs.realpath(actionDir);
    const realStore = await fs.realpath(this.actionStoreRoot);
    if (realAction !== path.join(realStore, action.id)) return false;
    const entries = await fs.readdir(realAction, { withFileTypes: true });
    if (entries.length !== 0) return false;
    await fs.rmdir(realAction);
    this.manager.forgetTerminalAction?.(action.id);
    this.recoveredActions.delete(action.id);
    this.deletedEvidence.add(action.id);
    return true;
  }
}

export async function createDeviceActionRuntime(config) {
  if (!config?.deviceActions?.enabled) return null;
  const options = config.deviceActions;
  await fs.mkdir(options.actionStoreRoot, { recursive: true });
  const storeStat = await fs.lstat(options.actionStoreRoot);
  if (!storeStat.isDirectory() || storeStat.isSymbolicLink()) throw new Error('POCKETFORGE_DEVICE_ACTION_STORE_ROOT must be a regular directory, not a symbolic link.');
  const actionStoreRoot = await fs.realpath(options.actionStoreRoot);
  const jobsRoot = path.resolve(config.dataDir, 'jobs');
  const overlap = actionStoreRoot === jobsRoot
    || actionStoreRoot.startsWith(`${jobsRoot}${path.sep}`)
    || jobsRoot.startsWith(`${actionStoreRoot}${path.sep}`);
  if (overlap) throw new Error('POCKETFORGE_DEVICE_ACTION_STORE_ROOT must not overlap the build jobs directory.');
  const publicRoot = await fs.realpath(config.publicDir);
  if (actionStoreRoot === publicRoot
    || actionStoreRoot.startsWith(`${publicRoot}${path.sep}`)
    || publicRoot.startsWith(`${actionStoreRoot}${path.sep}`)) {
    throw new Error('POCKETFORGE_DEVICE_ACTION_STORE_ROOT must not overlap the public static directory.');
  }
  const adapter = new AndroidDeviceAdapter({
    adbPath: options.adbPath,
    apkanalyzerPath: options.apkanalyzerPath,
    apksignerPath: options.apksignerPath,
    deviceIdSecret: options.deviceIdSecret,
    evidenceIntegrityKey: options.evidenceIntegrityKey,
  });
  const manager = new DeviceActionManager({ adapter, actionStoreRoot });
  const runtime = new DeviceActionRuntime({ manager, adapter, actionStoreRoot, evidenceIntegrityKey: options.evidenceIntegrityKey, maxConcurrentActions: options.maxConcurrentActions });
  return runtime.initialize();
}

export function mapDeviceActionError(error) {
  if (error?.statusCode) return { status: error.statusCode, code: error.code || 'device_action_request', message: error.message };
  if (error instanceof DeviceActionError || error instanceof AndroidDeviceError) {
    const statuses = {
      ACTION_NOT_FOUND: 404,
      JOB_NOT_SUCCEEDED: 409,
      APPROVAL_EXPIRED: 410,
      APPROVAL_ALREADY_USED: 409,
      DEVICE_BUSY: 409,
      ACTION_LIMIT_REACHED: 429,
    };
    return { status: statuses[error.code] || 400, code: String(error.code || 'device_action_failed').toLowerCase(), message: error.message };
  }
  return null;
}

function runtimeError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function recoveredAction(evidence) {
  return Object.freeze({
    id: evidence.actionId,
    jobId: evidence.jobId,
    artifactId: null,
    deviceId: evidence.device?.deviceId ?? null,
    status: evidence.status,
    createdAt: evidence.execution?.startedAt ?? evidence.approval?.approvedAt ?? null,
    expiresAt: null,
    approvedAt: evidence.approval?.approvedAt ?? null,
    finishedAt: evidence.execution?.finishedAt ?? null,
    source: evidence.source ?? { repository: null, resolvedCommit: null },
    artifact: evidence.artifact ?? null,
    device: { deviceId: evidence.device?.deviceId ?? null, model: evidence.device?.model ?? null },
    evidence,
    evidenceDeletedAt: null,
    error: evidence.execution?.error ?? null,
    recovered: true,
  });
}
