import { spawn } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildChildEnvironment, terminateProcessTree } from './process-runner.mjs';

const DEFAULT_TEXT_LIMIT = 1024 * 1024;
const DEFAULT_BINARY_LIMIT = 10 * 1024 * 1024;
const DEFAULT_APK_LIMIT = 250 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const APPLICATION_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SAFE_ACTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEVICE_EPOCH = /^\d{10,12}(?:\.\d{1,9})?$/;
const PROCESS_ID = /^\d{1,10}$/;
const UID = /^\d{1,10}$/;
const EVIDENCE_FILE_NAMES = [
  'logcat.txt',
  'crash.txt',
  'screenshot.png',
  'device-evidence.json',
];

export class AndroidDeviceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AndroidDeviceError';
    this.code = code;
  }
}

export async function runBoundedProcess({
  file,
  args = [],
  cwd,
  timeoutMs = 30_000,
  maxStdoutBytes = DEFAULT_TEXT_LIMIT,
  maxStderrBytes = DEFAULT_TEXT_LIMIT,
  binaryStdout = false,
  environment = process.env,
  signal,
}) {
  assertAbsoluteExecutable(file);
  assertArgumentArray(args);
  assertPositiveInteger('timeoutMs', timeoutMs, 1, 3_600_000);
  assertPositiveInteger('maxStdoutBytes', maxStdoutBytes, 1, 64 * 1024 * 1024);
  assertPositiveInteger('maxStderrBytes', maxStderrBytes, 1, 64 * 1024 * 1024);

  const invocation = windowsBatchInvocation(file, args);
  const childEnvironment = buildAndroidChildEnvironment(environment);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AndroidDeviceError('COMMAND_ABORTED', 'Android tool command was cancelled.'));
      return;
    }

    let child;
    try {
    child = spawn(invocation.file, invocation.args, {
      cwd,
      env: childEnvironment,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
      });
    } catch (error) {
      reject(new AndroidDeviceError('COMMAND_START_FAILED', 'Unable to start the Android tool.', { cause: error }));
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError = null;
    let settled = false;
    let forceKillTimer;
    let terminationRequested = false;

    const terminate = error => {
      terminalError ??= error;
      if (terminationRequested) return;
      terminationRequested = true;
      forceKillTimer = terminateProcessTree(child, childEnvironment);
    };

    const collect = (chunks, kind, limit) => chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (kind === 'stdout') stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      const total = kind === 'stdout' ? stdoutBytes : stderrBytes;
      if (total > limit) {
        terminate(new AndroidDeviceError(
          'COMMAND_OUTPUT_LIMIT',
          `Android tool ${kind} exceeded the configured byte limit.`,
        ));
        return;
      }
      chunks.push(buffer);
    };

    child.stdout?.on('data', collect(stdout, 'stdout', maxStdoutBytes));
    child.stderr?.on('data', collect(stderr, 'stderr', maxStderrBytes));

    const timeout = setTimeout(() => {
      terminate(new AndroidDeviceError('COMMAND_TIMEOUT', 'Android tool command exceeded its time limit.'));
    }, timeoutMs);
    timeout.unref();

    const onAbort = () => terminate(new AndroidDeviceError('COMMAND_ABORTED', 'Android tool command was cancelled.'));
    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };

    child.on('error', error => finish(() => reject(new AndroidDeviceError(
      'COMMAND_START_FAILED',
      'Unable to start the Android tool.',
      { cause: error },
    ))));

    child.on('close', (code, childSignal) => finish(() => {
      if (terminalError) {
        reject(terminalError);
        return;
      }
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrText = cleanToolText(Buffer.concat(stderr).toString('utf8'));
      if (code !== 0) {
        const error = new AndroidDeviceError(
          'COMMAND_FAILED',
          `Android tool exited with ${code == null ? `signal ${childSignal}` : `code ${code}`}.`,
        );
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve({
        stdout: binaryStdout ? stdoutBuffer : stdoutBuffer.toString('utf8'),
        stderr: stderrText,
      });
    }));
  });
}

export function buildAndroidChildEnvironment(source = process.env) {
  return buildChildEnvironment(source);
}

export function parseAdbDevices(output) {
  const text = String(output ?? '').replace(/\r\n?/g, '\n');
  const devices = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'List of devices attached' || line.startsWith('* daemon')) continue;
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)(?:\s+(.*))?$/);
    if (!match) continue;
    const attributes = {};
    for (const token of (match[3] || '').split(/\s+/)) {
      const separator = token.indexOf(':');
      if (separator <= 0) continue;
      const key = token.slice(0, separator);
      const value = token.slice(separator + 1);
      if (/^[a-z_]+$/i.test(key)) attributes[key] = safeDisplayValue(value);
    }
    devices.push({
      serial: match[1],
      state: match[2],
      product: attributes.product || '',
      model: attributes.model || '',
      device: attributes.device || '',
      transportId: attributes.transport_id || '',
    });
  }
  return devices;
}

export async function inspectContainedApkFile({
  artifactPath,
  workspaceRoot,
  maxBytes = DEFAULT_APK_LIMIT,
}) {
  if (typeof artifactPath !== 'string' || !path.isAbsolute(artifactPath)) {
    throw new AndroidDeviceError('INVALID_APK_PATH', 'APK path must be absolute.');
  }
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new AndroidDeviceError('INVALID_WORKSPACE_PATH', 'Workspace root must be absolute.');
  }
  assertPositiveInteger('maxBytes', maxBytes, 1, 2 * 1024 * 1024 * 1024);

  const rootPath = path.resolve(workspaceRoot);
  const candidatePath = path.resolve(artifactPath);
  if (!isContainedPath(rootPath, candidatePath)) {
    throw new AndroidDeviceError('APK_OUTSIDE_WORKSPACE', 'APK must be contained by the job workspace.');
  }

  await assertPathComponentsAreNotLinks(rootPath, candidatePath);
  const [realRoot, realArtifact] = await Promise.all([
    fsp.realpath(rootPath),
    fsp.realpath(candidatePath),
  ]);
  if (!isContainedPath(realRoot, realArtifact)) {
    throw new AndroidDeviceError('APK_OUTSIDE_WORKSPACE', 'Canonical APK path escapes the job workspace.');
  }
  if (path.extname(realArtifact).toLowerCase() !== '.apk') {
    throw new AndroidDeviceError('INVALID_APK_EXTENSION', 'Device actions accept one .apk file only.');
  }

  const stat = await fsp.lstat(realArtifact);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AndroidDeviceError('INVALID_APK_FILE', 'APK must be a regular non-symbolic-link file.');
  }
  if (stat.size <= 0 || stat.size > maxBytes) {
    throw new AndroidDeviceError('INVALID_APK_SIZE', `APK size must be between 1 and ${maxBytes} bytes.`);
  }

  const sha256 = await sha256File(realArtifact);
  const afterHash = await fsp.stat(realArtifact);
  if (afterHash.size !== stat.size || afterHash.mtimeMs !== stat.mtimeMs) {
    throw new AndroidDeviceError('APK_CHANGED_DURING_READ', 'APK changed while it was being inspected.');
  }

  return {
    realPath: realArtifact,
    relativePath: path.relative(realRoot, realArtifact).split(path.sep).join('/'),
    size: stat.size,
    sha256,
  };
}

export async function verifyEvidenceBundle({ evidenceDir, evidenceIntegrityKey }) {
  if (typeof evidenceDir !== 'string' || !path.isAbsolute(evidenceDir)) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_PATH', 'Evidence directory must be absolute.');
  }
  const integrityKey = Buffer.isBuffer(evidenceIntegrityKey)
    ? Buffer.from(evidenceIntegrityKey)
    : Buffer.from(evidenceIntegrityKey ?? '');
  if (integrityKey.length < 32) {
    throw new TypeError('evidenceIntegrityKey must contain at least 32 bytes.');
  }
  const manifestPath = path.join(evidenceDir, 'device-evidence.json');
  const manifestStat = await fsp.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > DEFAULT_TEXT_LIMIT) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_MANIFEST', 'Evidence manifest must be one bounded regular file.');
  }
  let evidence;
  try {
    evidence = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_MANIFEST', 'Evidence manifest is not valid JSON.', { cause: error });
  }
  const integrity = evidence?.integrity;
  if (!integrity || integrity.algorithm !== 'HMAC-SHA256'
    || !SHA256.test(integrity.manifestSha256) || !SHA256.test(integrity.manifestHmac)) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_INTEGRITY', 'Evidence integrity metadata is malformed.');
  }
  const unsigned = { ...evidence };
  delete unsigned.integrity;
  const payload = stableStringify(unsigned);
  const expectedSha = createHash('sha256').update(payload).digest('hex');
  const expectedHmac = createHmac('sha256', integrityKey).update(payload).digest('hex');
  if (!constantTimeTextEqual(expectedSha, integrity.manifestSha256)
    || !constantTimeTextEqual(expectedHmac, integrity.manifestHmac)) {
    throw new AndroidDeviceError('EVIDENCE_MANIFEST_INTEGRITY_FAILED', 'Evidence manifest integrity verification failed.');
  }
  const seenNames = new Set();
  for (const entry of Object.values(unsigned.files ?? {})) {
    if (!entry || typeof entry !== 'object'
      || !['logcat.txt', 'crash.txt', 'screenshot.png'].includes(entry.name)
      || seenNames.has(entry.name)
      || !Number.isInteger(entry.size) || entry.size < 0
      || !SHA256.test(entry.sha256)) {
      throw new AndroidDeviceError('INVALID_EVIDENCE_FILE', 'Evidence file metadata is malformed.');
    }
    seenNames.add(entry.name);
    const filePath = path.join(evidenceDir, entry.name);
    const stat = await fsp.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size
      || await sha256File(filePath) !== entry.sha256) {
      throw new AndroidDeviceError('EVIDENCE_FILE_INTEGRITY_FAILED', `Evidence file ${entry.name} failed verification.`);
    }
  }
  const directoryEntries = await fsp.readdir(evidenceDir, { withFileTypes: true });
  const expectedNames = new Set(['device-evidence.json', ...seenNames]);
  if (directoryEntries.length !== expectedNames.size
    || directoryEntries.some(entry => !entry.isFile() || entry.isSymbolicLink() || !expectedNames.has(entry.name))) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_FILE', 'Evidence directory contains an unexpected entry.');
  }
  return evidence;
}

export function validateApkMetadata(metadata) {
  const applicationId = singleLine(metadata?.applicationId, 'application ID', 255);
  if (!APPLICATION_ID.test(applicationId)) {
    throw new AndroidDeviceError('INVALID_APPLICATION_ID', 'APK application ID has an unsupported format.');
  }
  const versionName = singleLine(metadata?.versionName ?? '', 'version name', 200, { allowEmpty: true });
  const versionCodeText = singleLine(metadata?.versionCode, 'version code', 20);
  if (!/^\d+$/.test(versionCodeText)) {
    throw new AndroidDeviceError('INVALID_VERSION_CODE', 'APK version code must be a positive integer.');
  }
  const versionCode = Number(versionCodeText);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
    throw new AndroidDeviceError('INVALID_VERSION_CODE', 'APK version code is outside the supported range.');
  }
  const targetSdkText = singleLine(metadata?.targetSdk, 'target SDK', 4);
  if (!/^\d+$/.test(targetSdkText)) {
    throw new AndroidDeviceError('INVALID_TARGET_SDK', 'APK target SDK must be an integer.');
  }
  const targetSdk = Number(targetSdkText);
  if (!Number.isInteger(targetSdk) || targetSdk < 1 || targetSdk > 999) {
    throw new AndroidDeviceError('INVALID_TARGET_SDK', 'APK target SDK is outside the supported range.');
  }
  const debuggableText = singleLine(metadata?.debuggable, 'debuggable value', 5).toLowerCase();
  if (debuggableText !== 'true' && debuggableText !== 'false') {
    throw new AndroidDeviceError('INVALID_DEBUGGABLE_VALUE', 'APK debuggable value must be true or false.');
  }
  return {
    applicationId,
    versionName,
    versionCode,
    targetSdk,
    debuggable: debuggableText === 'true',
  };
}

export class AndroidDeviceAdapter {
  constructor({
    adbPath,
    apkanalyzerPath,
    apksignerPath,
    runner = runBoundedProcess,
    deviceIdSecret = randomBytes(32),
    evidenceIntegrityKey,
    timeoutMs = 30_000,
    maxTextBytes = DEFAULT_TEXT_LIMIT,
    maxBinaryBytes = DEFAULT_BINARY_LIMIT,
    maxApkBytes = DEFAULT_APK_LIMIT,
    settleMs = 1_000,
    environment = process.env,
  }) {
    assertAbsoluteExecutable(adbPath);
    assertAbsoluteExecutable(apkanalyzerPath);
    assertAbsoluteExecutable(apksignerPath);
    if (typeof runner !== 'function') throw new TypeError('runner must be a function.');
    const secret = Buffer.isBuffer(deviceIdSecret) ? Buffer.from(deviceIdSecret) : Buffer.from(String(deviceIdSecret));
    if (secret.length < 32) throw new TypeError('deviceIdSecret must contain at least 32 bytes.');
    const integrityKey = Buffer.isBuffer(evidenceIntegrityKey)
      ? Buffer.from(evidenceIntegrityKey)
      : Buffer.from(evidenceIntegrityKey ?? '');
    if (integrityKey.length < 32) {
      throw new TypeError('evidenceIntegrityKey must contain at least 32 injected bytes.');
    }
    assertPositiveInteger('timeoutMs', timeoutMs, 1, 3_600_000);
    assertPositiveInteger('maxTextBytes', maxTextBytes, 1, 64 * 1024 * 1024);
    assertPositiveInteger('maxBinaryBytes', maxBinaryBytes, 8, 64 * 1024 * 1024);
    assertPositiveInteger('maxApkBytes', maxApkBytes, 1, 2 * 1024 * 1024 * 1024);
    if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 10_000) {
      throw new TypeError('settleMs must be an integer between 0 and 10000.');
    }
    this.adbPath = adbPath;
    this.apkanalyzerPath = apkanalyzerPath;
    this.apksignerPath = apksignerPath;
    this.runner = runner;
    this.deviceIdSecret = secret;
    this.evidenceIntegrityKey = integrityKey;
    this.timeoutMs = timeoutMs;
    this.maxTextBytes = maxTextBytes;
    this.maxBinaryBytes = maxBinaryBytes;
    this.maxApkBytes = maxApkBytes;
    this.settleMs = settleMs;
    this.environment = buildAndroidChildEnvironment(environment);
  }

  async listDevices() {
    const devices = await this.#enumerateDevices();
    return devices.map(device => this.#publicDevice(device));
  }

  async assertDeviceAvailable(deviceId) {
    const device = await this.#resolveOnlineDevice(deviceId);
    return this.#publicDevice(device);
  }

  async captureDeviceBinding(deviceId) {
    const device = await this.#resolveOnlineDevice(deviceId);
    const [manufacturer, buildFingerprint, androidSdk, hardwareSerial] = await Promise.all([
      this.#adbText(device.serial, ['shell', 'getprop', 'ro.product.manufacturer']),
      this.#adbText(device.serial, ['shell', 'getprop', 'ro.build.fingerprint']),
      this.#adbText(device.serial, ['shell', 'getprop', 'ro.build.version.sdk']),
      this.#adbText(device.serial, ['shell', 'getprop', 'ro.serialno']),
    ]);
    const identity = {
      adbSerial: identityValue(device.serial, 'ADB serial'),
      transportId: identityValue(device.transportId, 'transport ID'),
      product: identityValue(device.product, 'product'),
      model: identityValue(device.model, 'model'),
      device: identityValue(device.device, 'device'),
      manufacturer: identityValue(manufacturer, 'manufacturer'),
      buildFingerprint: identityValue(buildFingerprint, 'build fingerprint'),
      androidSdk: identityValue(androidSdk, 'Android SDK'),
      hardwareSerial: identityValue(hardwareSerial, 'hardware serial'),
    };
    if (!/^\d{1,3}$/.test(identity.androidSdk)) {
      throw new AndroidDeviceError('INVALID_DEVICE_IDENTITY', 'Device SDK identity is malformed.');
    }
    const approvalFingerprint = this.#opaqueFingerprint('approval', identity);
    const physicalIdentity = {
      hardwareSerial: identity.hardwareSerial,
      manufacturer: identity.manufacturer,
      buildFingerprint: identity.buildFingerprint,
    };
    return {
      device: this.#publicDevice(device),
      binding: {
        ...identity,
        deviceId: this.#deviceId(device.serial),
        approvalFingerprint,
        mutexFingerprint: this.#opaqueFingerprint('mutex', physicalIdentity),
      },
    };
  }

  async assertDeviceBinding(expectedBinding) {
    assertDeviceBindingShape(expectedBinding);
    const current = await this.captureDeviceBinding(expectedBinding.deviceId);
    if (!constantTimeTextEqual(current.binding.approvalFingerprint, expectedBinding.approvalFingerprint)
      || !constantTimeTextEqual(current.binding.mutexFingerprint, expectedBinding.mutexFingerprint)) {
      throw new AndroidDeviceError(
        'DEVICE_IDENTITY_CHANGED',
        'The selected Android device identity changed after approval preparation.',
      );
    }
    return current;
  }

  async createApprovedSnapshot({
    artifactPath,
    workspaceRoot,
    actionStoreRoot,
    actionId,
    requireDebuggable = true,
  }) {
    if (typeof actionStoreRoot !== 'string' || !path.isAbsolute(actionStoreRoot)) {
      throw new AndroidDeviceError('INVALID_ACTION_STORE', 'Action store root must be absolute.');
    }
    if (typeof actionId !== 'string' || !SAFE_ACTION_ID.test(actionId)) {
      throw new AndroidDeviceError('INVALID_ACTION_ID', 'Action ID cannot be used as an action-store path component.');
    }
    const source = await inspectContainedApkFile({
      artifactPath,
      workspaceRoot,
      maxBytes: this.maxApkBytes,
    });
    const { storeRoot, actionRoot } = await createActionRoot({
      actionStoreRoot,
      workspaceRoot,
      actionId,
    });
    const snapshotPath = path.join(actionRoot, 'approved.apk');
    try {
      const copied = await copyStableApkSnapshot({
        source,
        workspaceRoot: await fsp.realpath(workspaceRoot),
        snapshotPath,
        maxBytes: this.maxApkBytes,
      });
      const inspected = await this.#inspectApkAt({
        artifactPath: snapshotPath,
        workspaceRoot: actionRoot,
        requireDebuggable,
      });
      if (inspected.sha256 !== copied.sha256 || inspected.size !== copied.size) {
        throw new AndroidDeviceError('SNAPSHOT_CHANGED', 'Approved APK snapshot changed during inspection.');
      }
      await fsp.chmod(snapshotPath, 0o400);
      return {
        ...inspected,
        relativePath: source.relativePath,
        snapshotRelativePath: path.relative(storeRoot, snapshotPath).split(path.sep).join('/'),
        actionRoot,
        storeRoot,
      };
    } catch (error) {
      await removeKnownActionFiles(actionRoot);
      throw error;
    }
  }

  async reinspectApprovedSnapshot(artifact) {
    assertInspectedArtifact(artifact, { requireActionRoot: true });
    const inspected = await this.#inspectApkAt({
      artifactPath: artifact.realPath,
      workspaceRoot: artifact.actionRoot,
      requireDebuggable: true,
    });
    assertArtifactBinding(inspected, artifact);
    return {
      ...inspected,
      relativePath: artifact.relativePath,
      snapshotRelativePath: artifact.snapshotRelativePath,
      actionRoot: artifact.actionRoot,
      storeRoot: artifact.storeRoot,
    };
  }

  async deleteApprovedSnapshot(artifact) {
    assertInspectedArtifact(artifact, { requireActionRoot: true });
    const expected = path.join(artifact.actionRoot, 'approved.apk');
    if (path.resolve(artifact.realPath) !== expected) {
      throw new AndroidDeviceError('INVALID_SNAPSHOT_PATH', 'Approved snapshot path is not action-owned.');
    }
    await fsp.chmod(expected, 0o600).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await fsp.unlink(expected).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await fsp.rmdir(artifact.actionRoot).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
    });
  }

  async inspectApk({ artifactPath, workspaceRoot, requireDebuggable = true }) {
    return this.#inspectApkAt({ artifactPath, workspaceRoot, requireDebuggable });
  }

  async #inspectApkAt({ artifactPath, workspaceRoot, requireDebuggable }) {
    const file = await inspectContainedApkFile({ artifactPath, workspaceRoot, maxBytes: this.maxApkBytes });
    const metadata = validateApkMetadata({
      applicationId: await this.#analyze(['manifest', 'application-id', file.realPath]),
      versionName: await this.#analyze(['manifest', 'version-name', file.realPath]),
      versionCode: await this.#analyze(['manifest', 'version-code', file.realPath]),
      targetSdk: await this.#analyze(['manifest', 'target-sdk', file.realPath]),
      debuggable: await this.#analyze(['manifest', 'debuggable', file.realPath]),
    });
    const manifest = await this.#analyze(['manifest', 'print', file.realPath], { singleLine: false });
    if (/<manifest\b[^>]*\bsplit\s*=/i.test(manifest)) {
      throw new AndroidDeviceError('SPLIT_APK_UNSUPPORTED', 'Split APK installation is not supported by this device action.');
    }
    if (requireDebuggable && !metadata.debuggable) {
      throw new AndroidDeviceError('APK_NOT_DEBUGGABLE', 'The device evidence slice accepts debuggable APKs only.');
    }
    const signerOutput = await this.#runText(
      this.apksignerPath,
      ['verify', '--verbose', '--print-certs', file.realPath],
    );
    const signerSha256 = parseSignerSha256(signerOutput);
    return {
      ...file,
      ...metadata,
      signatureVerified: true,
      signerSha256,
    };
  }

  async installAndCollectEvidence({
    deviceBinding,
    artifact,
    evidenceDir,
    jobId,
    actionId,
    repository = null,
    resolvedCommit = null,
    approvedAt,
    onPhase = () => {},
  }) {
    assertInspectedArtifact(artifact, { requireActionRoot: true });
    const resolved = await this.assertDeviceBinding(deviceBinding);
    const device = resolved.binding;
    const projectedDevice = resolved.device;
    const packageName = artifact.applicationId;
    const existing = cleanToolText(await this.#adbText(device.adbSerial, ['shell', 'pm', 'path', packageName]));
    if (existing) {
      throw new AndroidDeviceError(
        'PACKAGE_ALREADY_INSTALLED',
        'The APK package is already installed; the first device evidence slice refuses replacement.',
      );
    }

    await createContainedDirectory({ workspaceRoot: artifact.actionRoot, targetPath: evidenceDir });
    const startedAt = new Date().toISOString();
    let evidence;
    try {
      const androidVersion = await this.#adbText(
        device.adbSerial,
        ['shell', 'getprop', 'ro.build.version.release'],
      );

      onPhase('installing');
      const installCandidate = await this.reinspectApprovedSnapshot(artifact);
      await this.#adbText(device.adbSerial, ['install', installCandidate.realPath]);
      const installedPackage = await this.#verifyInstalledPackage(device.adbSerial, artifact);

      onPhase('launching');
      const launchEpoch = await this.#deviceEpoch(device.adbSerial);
      await this.#adbText(device.adbSerial, [
        'shell',
        'monkey',
        '-p', packageName,
        '-c', 'android.intent.category.LAUNCHER',
        '1',
      ]);
      if (this.settleMs) await delay(this.settleMs);
      const pidText = cleanToolText(await this.#adbText(device.adbSerial, ['shell', 'pidof', packageName]));
      if (!PROCESS_ID.test(pidText) || Number(pidText) < 1) {
        throw new AndroidDeviceError('APP_PROCESS_NOT_FOUND', 'Launched APK did not expose one validated process ID.');
      }
      const processIdentity = await this.#verifyProcessIdentity(device.adbSerial, pidText, packageName);

      onPhase('collecting_evidence');
      const [logcat, crash] = await Promise.all([
        this.#adbText(device.adbSerial, ['logcat', '-T', launchEpoch, '-d', '-v', 'epoch', `--pid=${pidText}`]),
        this.#adbText(device.adbSerial, ['logcat', '-b', 'crash', '-T', launchEpoch, '-d', '-v', 'epoch', `--pid=${pidText}`]),
      ]);
      const foregroundBefore = await this.#foregroundPackage(device.adbSerial);
      if (foregroundBefore !== packageName) {
        throw new AndroidDeviceError('APP_NOT_FOREGROUND', 'Approved package was not foreground before screenshot capture.');
      }
      const screenshot = await this.#adbBinary(device.adbSerial, ['exec-out', 'screencap', '-p']);
      assertPng(screenshot);
      const foregroundAfter = await this.#foregroundPackage(device.adbSerial);
      if (foregroundAfter !== packageName) {
        throw new AndroidDeviceError('APP_NOT_FOREGROUND', 'Approved package stopped being foreground during screenshot capture.');
      }

      const logcatText = cleanToolText(logcat, { preserveNewlines: true });
      const crashText = cleanToolText(crash, { preserveNewlines: true });
      const crashDetected = crashText
        .split('\n')
        .some(line => line.trim() && !/^-+ beginning of crash\s*$/i.test(line.trim()));
      const finishedAt = new Date().toISOString();
      evidence = {
        schemaVersion: 2,
        actionId: String(actionId),
        jobId: String(jobId),
        status: crashDetected ? 'failed' : 'succeeded',
        source: {
          repository: repository || null,
          resolvedCommit: resolvedCommit || null,
        },
        artifact: publicArtifact(artifact),
        device: {
          ...projectedDevice,
          manufacturer: safeDisplayValue(device.manufacturer),
          androidVersion: safeDisplayValue(androidVersion),
          androidSdk: safeDisplayValue(device.androidSdk),
          identityFingerprint: device.approvalFingerprint,
        },
        approval: { approvedAt: approvedAt || null },
        execution: {
          startedAt,
          finishedAt,
          processId: Number(pidText),
          processUid: Number(processIdentity.uid),
          processName: processIdentity.processName,
          launchEpoch,
          crashDetected,
          installedPackage,
          screenshotProvenance: {
            foregroundBefore,
            foregroundAfter,
          },
        },
        files: {},
      };
      evidence.files = await writeEvidencePayloads(evidenceDir, {
        logcat: withTrailingNewline(logcatText),
        crash: withTrailingNewline(crashText),
        screenshot,
      });
      evidence = await writeEvidenceManifest(evidenceDir, evidence, this.evidenceIntegrityKey);
      if (crashDetected) {
        const error = new AndroidDeviceError('APP_CRASH_DETECTED', 'A crash-buffer entry was captured for the launched process.');
        error.evidence = evidence;
        throw error;
      }
      return {
        evidence,
        evidenceDir,
        files: {
          json: path.join(evidenceDir, 'device-evidence.json'),
          logcat: path.join(evidenceDir, 'logcat.txt'),
          crash: path.join(evidenceDir, 'crash.txt'),
          screenshot: path.join(evidenceDir, 'screenshot.png'),
        },
      };
    } catch (error) {
      if (evidence?.integrity) throw error;
      await removeKnownEvidenceFiles(evidenceDir);
      const failure = {
        schemaVersion: 2,
        actionId: String(actionId),
        jobId: String(jobId),
        status: 'failed',
        source: {
          repository: repository || null,
          resolvedCommit: resolvedCommit || null,
        },
        artifact: publicArtifact(artifact),
        device: projectedDevice,
        approval: { approvedAt: approvedAt || null },
        execution: {
          startedAt,
          finishedAt: new Date().toISOString(),
          error: {
            code: error?.code || 'DEVICE_ACTION_FAILED',
            message: safeErrorMessage(error),
          },
        },
        files: {},
      };
      try {
        evidence = await writeEvidenceManifest(evidenceDir, failure, this.evidenceIntegrityKey);
      } catch {
        // Preserve the primary device-action failure.
      }
      error.evidence ??= evidence || failure;
      throw error;
    }
  }

  async #enumerateDevices() {
    const output = await this.#runText(this.adbPath, ['devices', '-l']);
    return parseAdbDevices(output);
  }

  async #resolveOnlineDevice(deviceId) {
    if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
      throw new AndroidDeviceError('INVALID_DEVICE_ID', 'Device ID has an unsupported format.');
    }
    const devices = await this.#enumerateDevices();
    const device = devices.find(candidate => this.#deviceId(candidate.serial) === deviceId);
    if (!device) throw new AndroidDeviceError('DEVICE_NOT_FOUND', 'Selected device is no longer enumerated.');
    if (device.state !== 'device') {
      throw new AndroidDeviceError('DEVICE_NOT_READY', `Selected device is ${device.state}.`);
    }
    return device;
  }

  #publicDevice(device) {
    return {
      deviceId: this.#deviceId(device.serial),
      model: safeDisplayValue(device.model).replaceAll('_', ' '),
    };
  }

  #deviceId(serial) {
    return createHmac('sha256', this.deviceIdSecret).update(serial).digest('base64url').slice(0, 24);
  }

  #opaqueFingerprint(purpose, value) {
    return createHmac('sha256', this.deviceIdSecret)
      .update(purpose)
      .update('\0')
      .update(stableStringify(value))
      .digest('hex');
  }

  async #deviceEpoch(serial) {
    let output;
    try {
      output = cleanToolText(await this.#adbText(serial, ['shell', 'date', '+%s.%N']));
    } catch {
      output = '';
    }
    if (!DEVICE_EPOCH.test(output)) {
      output = cleanToolText(await this.#adbText(serial, ['shell', 'date', '+%s']));
    }
    if (!DEVICE_EPOCH.test(output)) {
      throw new AndroidDeviceError('INVALID_DEVICE_TIME', 'Android device did not return a validated epoch timestamp.');
    }
    return output.includes('.') ? output : `${output}.000000000`;
  }

  async #verifyProcessIdentity(serial, pid, packageName) {
    const processName = cleanToolText(await this.#adbText(serial, ['shell', 'cat', `/proc/${pid}/cmdline`]))
      .replace(/\u0000+$/g, '');
    if (processName !== packageName && !processName.startsWith(`${packageName}:`)) {
      throw new AndroidDeviceError('PROCESS_PACKAGE_MISMATCH', 'Launched process does not belong to the approved package.');
    }
    const uid = cleanToolText(await this.#adbText(serial, ['shell', 'stat', '-c', '%u', `/proc/${pid}`]));
    if (!UID.test(uid)) {
      throw new AndroidDeviceError('INVALID_PROCESS_UID', 'Launched process UID is malformed.');
    }
    const packageUidOutput = cleanToolText(await this.#adbText(
      serial,
      ['shell', 'cmd', 'package', 'list', 'packages', '-U', packageName],
    ));
    const packageUidMatch = packageUidOutput.match(new RegExp(`^package:${escapeRegExp(packageName)}\\s+uid:(\\d+)$`));
    if (!packageUidMatch || packageUidMatch[1] !== uid) {
      throw new AndroidDeviceError('PROCESS_UID_MISMATCH', 'Launched process UID does not match the approved package.');
    }
    return { processName, uid };
  }

  async #foregroundPackage(serial) {
    const output = await this.#adbText(serial, ['shell', 'dumpsys', 'activity', 'activities']);
    const packageName = parseForegroundPackage(output);
    if (!packageName) {
      throw new AndroidDeviceError('FOREGROUND_UNKNOWN', 'Unable to determine the foreground Android package.');
    }
    return packageName;
  }

  async #verifyInstalledPackage(serial, artifact) {
    const [output, packagePathOutput] = await Promise.all([
      this.#adbText(serial, ['shell', 'dumpsys', 'package', artifact.applicationId]),
      this.#adbText(serial, ['shell', 'pm', 'path', artifact.applicationId]),
    ]);
    const versionCode = output.match(/\bversionCode=(\d+)\b/)?.[1];
    const versionName = output.match(/(?:^|\s)versionName=([^\s\r\n]+)/m)?.[1] ?? '';
    if (Number(versionCode) !== artifact.versionCode || versionName !== artifact.versionName) {
      throw new AndroidDeviceError(
        'INSTALLED_PACKAGE_MISMATCH',
        'Installed package version does not match the approved APK.',
      );
    }
    const installedPath = cleanToolText(packagePathOutput).match(/^package:(\/[A-Za-z0-9_./=+~-]+\/base\.apk)$/)?.[1];
    if (!installedPath || installedPath.includes('/../')) {
      throw new AndroidDeviceError('INVALID_INSTALLED_APK_PATH', 'Installed package did not expose one validated base APK path.');
    }
    const digestOutput = cleanToolText(await this.#adbText(serial, ['shell', 'sha256sum', installedPath]));
    const installedSha256 = digestOutput.match(/^([a-fA-F0-9]{64})\s+\S+$/)?.[1]?.toLowerCase();
    if (installedSha256 !== artifact.sha256) {
      throw new AndroidDeviceError(
        'INSTALLED_APK_DIGEST_MISMATCH',
        'Installed base APK bytes do not match the approved snapshot.',
      );
    }
    return {
      applicationId: artifact.applicationId,
      versionCode: Number(versionCode),
      versionName,
      sha256: installedSha256,
      signerSha256: artifact.signerSha256,
    };
  }

  async #analyze(args, { singleLine: requireSingleLine = true } = {}) {
    const output = await this.#runText(this.apkanalyzerPath, args);
    return requireSingleLine
      ? singleLine(output, 'APK analyzer output', 255, { allowEmpty: true })
      : String(output);
  }

  async #adbText(serial, args) {
    return this.#runText(this.adbPath, ['-s', serial, ...args]);
  }

  async #adbBinary(serial, args) {
    const result = await this.runner({
      file: this.adbPath,
      args: ['-s', serial, ...args],
      timeoutMs: this.timeoutMs,
      maxStdoutBytes: this.maxBinaryBytes,
      maxStderrBytes: this.maxTextBytes,
      binaryStdout: true,
      environment: this.environment,
    });
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
  }

  async #runText(file, args) {
    const result = await this.runner({
      file,
      args,
      timeoutMs: this.timeoutMs,
      maxStdoutBytes: this.maxTextBytes,
      maxStderrBytes: this.maxTextBytes,
      binaryStdout: false,
      environment: this.environment,
    });
    return typeof result.stdout === 'string' ? result.stdout : Buffer.from(result.stdout ?? '').toString('utf8');
  }
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function createActionRoot({ actionStoreRoot, workspaceRoot, actionId }) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new AndroidDeviceError('INVALID_WORKSPACE_PATH', 'Workspace root must be absolute.');
  }
  const [storeRoot, realWorkspace] = await Promise.all([
    fsp.realpath(path.resolve(actionStoreRoot)),
    fsp.realpath(path.resolve(workspaceRoot)),
  ]);
  const storeStat = await fsp.lstat(storeRoot);
  if (!storeStat.isDirectory() || storeStat.isSymbolicLink()) {
    throw new AndroidDeviceError('INVALID_ACTION_STORE', 'Action store root must be a regular directory.');
  }
  if (isContainedPath(realWorkspace, storeRoot) || isContainedPath(storeRoot, realWorkspace)) {
    throw new AndroidDeviceError(
      'ACTION_STORE_OVERLAPS_WORKSPACE',
      'Action store root and job workspace must be separate directory trees.',
    );
  }
  const actionRoot = path.join(storeRoot, actionId);
  try {
    await fsp.mkdir(actionRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new AndroidDeviceError('ACTION_STORE_COLLISION', 'Action store directory already exists.');
    }
    throw error;
  }
  return { storeRoot, actionRoot };
}

async function copyStableApkSnapshot({ source, workspaceRoot, snapshotPath, maxBytes }) {
  const before = await inspectContainedApkFile({
    artifactPath: source.realPath,
    workspaceRoot,
    maxBytes,
  });
  const sourceHandle = await fsp.open(before.realPath, 'r');
  let snapshotHandle;
  try {
    const beforeStat = await sourceHandle.stat();
    assertStableSourceStat(beforeStat, before);
    snapshotHandle = await fsp.open(snapshotPath, 'wx', 0o600);
    const snapshotHash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < beforeStat.size) {
      const length = Math.min(buffer.length, beforeStat.size - position);
      const { bytesRead } = await sourceHandle.read(buffer, 0, length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await snapshotHandle.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten < 1) {
          throw new AndroidDeviceError('SNAPSHOT_WRITE_FAILED', 'Unable to write the approved APK snapshot.');
        }
        written += result.bytesWritten;
      }
      snapshotHash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await snapshotHandle.sync();
    const afterStat = await sourceHandle.stat();
    const after = await inspectContainedApkFile({
      artifactPath: before.realPath,
      workspaceRoot,
      maxBytes,
    });
    const digest = snapshotHash.digest('hex');
    if (position !== beforeStat.size
      || !sameFileStat(beforeStat, afterStat)
      || before.sha256 !== after.sha256
      || before.sha256 !== digest
      || before.size !== after.size) {
      throw new AndroidDeviceError(
        'APK_CHANGED_DURING_SNAPSHOT',
        'APK source changed while the approved snapshot was being created.',
      );
    }
    return { size: position, sha256: digest };
  } finally {
    await snapshotHandle?.close().catch(() => {});
    await sourceHandle.close().catch(() => {});
  }
}

function assertStableSourceStat(stat, inspected) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== inspected.size) {
    throw new AndroidDeviceError('APK_CHANGED_DURING_SNAPSHOT', 'APK source changed before snapshot creation.');
  }
}

function sameFileStat(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

async function removeKnownActionFiles(actionRoot) {
  const files = ['approved.apk', ...EVIDENCE_FILE_NAMES.map(name => path.join('evidence', name))];
  await Promise.all(files.map(relative => fsp.unlink(path.join(actionRoot, relative)).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  })));
  await fsp.rmdir(path.join(actionRoot, 'evidence')).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
  });
  await fsp.rmdir(actionRoot).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
  });
}

async function assertPathComponentsAreNotLinks(rootPath, candidatePath) {
  const rootStat = await fsp.lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new AndroidDeviceError('INVALID_WORKSPACE_PATH', 'Workspace root must be a regular directory, not a symbolic link.');
  }
  const relative = path.relative(rootPath, candidatePath);
  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new AndroidDeviceError('APK_SYMLINK_REJECTED', 'APK path cannot contain symbolic links.');
    }
  }
}

async function createContainedDirectory({ workspaceRoot, targetPath }) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  if (!isContainedPath(root, target) || root === target) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_PATH', 'Evidence directory must be inside the job workspace.');
  }
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new AndroidDeviceError('INVALID_WORKSPACE_PATH', 'Workspace root must be a regular directory.');
  }
  let current = root;
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new AndroidDeviceError('INVALID_EVIDENCE_PATH', 'Evidence path contains a link or non-directory component.');
      }
      if (index === parts.length - 1) {
        throw new AndroidDeviceError('EVIDENCE_ALREADY_EXISTS', 'Evidence directory already exists.');
      }
    } catch (error) {
      if (error instanceof AndroidDeviceError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      await fsp.mkdir(current);
    }
  }
  const [realRoot, realTarget] = await Promise.all([fsp.realpath(root), fsp.realpath(target)]);
  if (!isContainedPath(realRoot, realTarget)) {
    throw new AndroidDeviceError('INVALID_EVIDENCE_PATH', 'Canonical evidence path escapes the job workspace.');
  }
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPng(value) {
  if (!Buffer.isBuffer(value) || value.length < PNG_SIGNATURE.length || !value.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AndroidDeviceError('INVALID_SCREENSHOT', 'ADB screencap did not return a valid PNG signature.');
  }
}

function assertInspectedArtifact(artifact, { requireActionRoot = false } = {}) {
  if (!artifact || typeof artifact !== 'object'
    || typeof artifact.realPath !== 'string' || !path.isAbsolute(artifact.realPath)
    || !SHA256.test(artifact.sha256)
    || !APPLICATION_ID.test(artifact.applicationId)
    || !SHA256.test(artifact.signerSha256)
    || (requireActionRoot && (typeof artifact.actionRoot !== 'string' || !path.isAbsolute(artifact.actionRoot)))) {
    throw new AndroidDeviceError('INVALID_INSPECTED_APK', 'An inspected APK artifact is required.');
  }
}

function assertArtifactBinding(candidate, approved) {
  if (candidate.sha256 !== approved.sha256
    || candidate.size !== approved.size
    || candidate.applicationId !== approved.applicationId
    || candidate.versionCode !== approved.versionCode
    || candidate.versionName !== approved.versionName
    || candidate.targetSdk !== approved.targetSdk
    || candidate.debuggable !== approved.debuggable
    || candidate.signerSha256 !== approved.signerSha256) {
    throw new AndroidDeviceError('APK_BINDING_CHANGED', 'APK no longer matches the approved snapshot binding.');
  }
}

function publicArtifact(artifact) {
  return {
    relativePath: artifact.relativePath,
    size: artifact.size,
    sha256: artifact.sha256,
    applicationId: artifact.applicationId,
    versionName: artifact.versionName,
    versionCode: artifact.versionCode,
    targetSdk: artifact.targetSdk,
    debuggable: artifact.debuggable,
    signatureVerified: artifact.signatureVerified,
    signerSha256: artifact.signerSha256,
  };
}

function singleLine(value, label, maxLength, { allowEmpty = false } = {}) {
  const text = String(value ?? '').trim();
  if ((!allowEmpty && !text) || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AndroidDeviceError('INVALID_APK_METADATA', `APK ${label} is missing or malformed.`);
  }
  return text;
}

function identityValue(value, label, { allowEmpty = false } = {}) {
  const text = cleanToolText(value);
  if ((!allowEmpty && !text) || text.length > 512 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AndroidDeviceError('INVALID_DEVICE_IDENTITY', `Android device ${label} is missing or malformed.`);
  }
  return text;
}

function parseSignerSha256(output) {
  const match = String(output ?? '').match(/Signer #\d+ certificate SHA-256 digest:\s*([A-Fa-f0-9]{64})/i);
  if (!match) {
    throw new AndroidDeviceError('INVALID_APK_SIGNER', 'APK signer SHA-256 digest was not reported.');
  }
  return match[1].toLowerCase();
}

function parseForegroundPackage(output) {
  for (const line of String(output ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!/(?:topResumedActivity|mResumedActivity|ResumedActivity)/.test(line)) continue;
    const match = line.match(/\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\/[A-Za-z0-9_.$/-]+/);
    if (match && APPLICATION_ID.test(match[1])) return match[1];
  }
  return null;
}

function assertDeviceBindingShape(binding) {
  if (!binding || typeof binding !== 'object'
    || typeof binding.deviceId !== 'string' || !DEVICE_ID.test(binding.deviceId)
    || !SHA256.test(binding.approvalFingerprint)
    || !SHA256.test(binding.mutexFingerprint)) {
    throw new AndroidDeviceError('INVALID_DEVICE_BINDING', 'Android device binding is malformed.');
  }
}

function constantTimeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeBufferEqual(leftBuffer, rightBuffer);
}

function timingSafeBufferEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanToolText(value, { preserveNewlines = false } = {}) {
  let text = String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  if (!preserveNewlines) text = text.trim();
  return text;
}

function safeDisplayValue(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 120);
}

function safeErrorMessage(error) {
  if (!(error instanceof AndroidDeviceError)) {
    return 'Android device action failed during a server-managed operation.';
  }
  return String(error?.message || 'Android device action failed.')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 300);
}

function withTrailingNewline(value) {
  return value ? `${value.replace(/\n+$/g, '')}\n` : '';
}

async function writeNewFile(file, value) {
  await fsp.writeFile(file, value, { flag: 'wx', mode: 0o600 });
}

async function writeEvidencePayloads(directory, { logcat, crash, screenshot }) {
  const values = {
    logcat: { name: 'logcat.txt', value: Buffer.from(logcat, 'utf8') },
    crash: { name: 'crash.txt', value: Buffer.from(crash, 'utf8') },
    screenshot: { name: 'screenshot.png', value: screenshot },
  };
  const files = {};
  try {
    for (const [kind, entry] of Object.entries(values)) {
      await writeNewFile(path.join(directory, entry.name), entry.value);
      files[kind] = {
        name: entry.name,
        size: entry.value.length,
        sha256: createHash('sha256').update(entry.value).digest('hex'),
      };
    }
    return files;
  } catch (error) {
    await removeKnownEvidenceFiles(directory);
    throw new AndroidDeviceError(
      'EVIDENCE_WRITE_FAILED',
      'Unable to write the complete Android evidence payload set.',
      { cause: error },
    );
  }
}

async function writeEvidenceManifest(directory, evidence, integrityKey) {
  const payload = stableStringify(evidence);
  const signed = {
    ...evidence,
    integrity: {
      algorithm: 'HMAC-SHA256',
      manifestSha256: createHash('sha256').update(payload).digest('hex'),
      manifestHmac: createHmac('sha256', integrityKey).update(payload).digest('hex'),
    },
  };
  await writeNewFile(
    path.join(directory, 'device-evidence.json'),
    `${JSON.stringify(signed, null, 2)}\n`,
  );
  return signed;
}

async function removeKnownEvidenceFiles(directory) {
  await Promise.all(EVIDENCE_FILE_NAMES.map(name => fsp.unlink(path.join(directory, name)).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  })));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function assertAbsoluteExecutable(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Android tool paths must be absolute and contain no NUL bytes.');
  }
}

function assertArgumentArray(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 32_768)) {
    throw new TypeError('Android tool arguments must be bounded strings without NUL bytes.');
  }
}

function windowsBatchInvocation(file, args) {
  if (process.platform !== 'win32' || !/\.(?:bat|cmd)$/i.test(file)) return { file, args, windowsVerbatimArguments: false };
  const values = [file, ...args];
  if (values.some(value => /["&|<>^%!\r\n]/.test(value))) {
    throw new AndroidDeviceError(
      'UNSAFE_BATCH_ARGUMENT',
      'Windows Android batch tools cannot receive shell metacharacters.',
    );
  }
  const configuredShell = process.env.ComSpec;
  const commandShell = configuredShell
    && path.isAbsolute(configuredShell)
    && path.basename(configuredShell).toLowerCase() === 'cmd.exe'
    ? configuredShell
    : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  assertAbsoluteExecutable(commandShell);
  const [program, ...programArguments] = values;
  const command = `call "${program}"${programArguments.length ? ` ${programArguments.map(value => `"${value}"`).join(' ')}` : ''}`;
  return {
    file: commandShell,
    args: ['/d', '/v:off', '/s', '/c', command],
    windowsVerbatimArguments: true,
  };
}

function assertPositiveInteger(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
