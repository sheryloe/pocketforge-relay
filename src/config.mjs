import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function intEnv(name, value, fallback, min, max) {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return parsed;
}

function actionsConfig(env) {
  const token = env.POCKETFORGE_GITHUB_TOKEN;
  const targetsFile = env.POCKETFORGE_ACTIONS_TARGETS_FILE;
  const tokenSupplied = token !== undefined && token !== '';
  const targetsFileSupplied = targetsFile !== undefined && targetsFile !== '';
  if (tokenSupplied !== targetsFileSupplied) {
    throw new Error('POCKETFORGE_GITHUB_TOKEN and POCKETFORGE_ACTIONS_TARGETS_FILE must be configured together.');
  }
  if (!tokenSupplied) {
    return Object.freeze({ enabled: false, githubToken: null, targetsFile: null });
  }
  if (typeof token !== 'string' || token !== token.trim() || token.length > 4_096 || /[\r\n]/.test(token)) {
    throw new Error('POCKETFORGE_GITHUB_TOKEN must be non-empty trimmed text without line breaks and at most 4096 characters.');
  }
  if (typeof targetsFile !== 'string' || targetsFile !== targetsFile.trim() || targetsFile.length > 4_096 || /[\0\r\n]/.test(targetsFile)) {
    throw new Error('POCKETFORGE_ACTIONS_TARGETS_FILE must be a non-empty trimmed path without line breaks.');
  }
  return Object.freeze({
    enabled: true,
    githubToken: token,
    targetsFile: path.resolve(targetsFile),
  });
}

function deviceActionsConfig(env) {
  const names = [
    'POCKETFORGE_ADB_PATH',
    'POCKETFORGE_APKANALYZER_PATH',
    'POCKETFORGE_APKSIGNER_PATH',
    'POCKETFORGE_DEVICE_ACTION_STORE_ROOT',
    'POCKETFORGE_DEVICE_ID_SECRET',
    'POCKETFORGE_EVIDENCE_INTEGRITY_KEY',
  ];
  const supplied = names.filter(name => env[name] !== undefined && env[name] !== '');
  if (supplied.length === 0) {
    return Object.freeze({
      enabled: false,
      adbPath: null,
      apkanalyzerPath: null,
      apksignerPath: null,
      actionStoreRoot: null,
      deviceIdSecret: null,
      evidenceIntegrityKey: null,
      maxConcurrentActions: null,
    });
  }
  if (supplied.length !== names.length) {
    throw new Error(`Android device actions require all of: ${names.join(', ')}.`);
  }
  const absolutePath = name => {
    const value = env[name];
    if (typeof value !== 'string' || value !== value.trim() || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
      throw new Error(`${name} must be an absolute trimmed path without line breaks.`);
    }
    return path.resolve(value);
  };
  const secret = (name, minimumBytes) => {
    const value = env[name];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error(`${name} must be canonical base64url text.`);
    }
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value || decoded.length < minimumBytes) {
      throw new Error(`${name} must decode to at least ${minimumBytes} bytes.`);
    }
    return decoded;
  };
  return Object.freeze({
    enabled: true,
    adbPath: absolutePath('POCKETFORGE_ADB_PATH'),
    apkanalyzerPath: absolutePath('POCKETFORGE_APKANALYZER_PATH'),
    apksignerPath: absolutePath('POCKETFORGE_APKSIGNER_PATH'),
    actionStoreRoot: absolutePath('POCKETFORGE_DEVICE_ACTION_STORE_ROOT'),
    deviceIdSecret: secret('POCKETFORGE_DEVICE_ID_SECRET', 32),
    evidenceIntegrityKey: secret('POCKETFORGE_EVIDENCE_INTEGRITY_KEY', 32),
    maxConcurrentActions: intEnv('MAX_CONCURRENT_DEVICE_ACTIONS', env.MAX_CONCURRENT_DEVICE_ACTIONS, 1, 1, 4),
  });
}

export function loadConfig(env = process.env) {
  const suppliedToken = env.POCKETFORGE_TOKEN?.trim();
  if (suppliedToken && suppliedToken.length < 24) throw new Error('POCKETFORGE_TOKEN must contain at least 24 characters.');
  const actions = actionsConfig(env);
  const deviceActions = deviceActionsConfig(env);
  const dataDir = path.resolve(env.POCKETFORGE_DATA_DIR || path.join(ROOT_DIR, '.pocketforge'));
  const publicDir = path.join(ROOT_DIR, 'public');
  if (pathsOverlap(dataDir, publicDir)) {
    throw new Error('POCKETFORGE_DATA_DIR must not overlap the public static directory.');
  }
  return Object.freeze({
    rootDir: ROOT_DIR,
    publicDir,
    examplesDir: path.join(ROOT_DIR, 'examples'),
    dataDir,
    host: env.HOST?.trim() || '127.0.0.1',
    port: intEnv('PORT', env.PORT, 8787, 1, 65_535),
    token: suppliedToken || crypto.randomBytes(24).toString('base64url'),
    generatedToken: !suppliedToken,
    maxConcurrentJobs: intEnv('MAX_CONCURRENT_JOBS', env.MAX_CONCURRENT_JOBS, 1, 1, 4),
    maxQueuedJobs: intEnv('MAX_QUEUED_JOBS', env.MAX_QUEUED_JOBS, 20, 1, 1_000),
    maxRetainedJobs: intEnv('MAX_RETAINED_JOBS', env.MAX_RETAINED_JOBS, 100, 1, 10_000),
    stepTimeoutMs: intEnv('STEP_TIMEOUT_MS', env.STEP_TIMEOUT_MS, 600_000, 1_000, 3_600_000),
    maxLogLines: intEnv('MAX_LOG_LINES', env.MAX_LOG_LINES, 4_000, 100, 20_000),
    maxArtifactFiles: intEnv('MAX_ARTIFACT_FILES', env.MAX_ARTIFACT_FILES, 100, 1, 1_000),
    maxArtifactBytes: intEnv('MAX_ARTIFACT_BYTES', env.MAX_ARTIFACT_BYTES, 25 * 1024 * 1024, 1_024, 250 * 1024 * 1024),
    actions,
    deviceActions,
  });
}

function pathsOverlap(left, right) {
  const a = comparablePath(canonicalPath(left));
  const b = comparablePath(canonicalPath(right));
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

function canonicalPath(value) {
  let current = path.resolve(value);
  const missing = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(value);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function comparablePath(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
