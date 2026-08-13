import crypto from 'node:crypto';
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
export function loadConfig(env = process.env) {
  const suppliedToken = env.POCKETFORGE_TOKEN?.trim();
  if (suppliedToken && suppliedToken.length < 24) throw new Error('POCKETFORGE_TOKEN must contain at least 24 characters.');
  return Object.freeze({
    rootDir: ROOT_DIR,
    publicDir: path.join(ROOT_DIR, 'public'),
    examplesDir: path.join(ROOT_DIR, 'examples'),
    dataDir: path.resolve(env.POCKETFORGE_DATA_DIR || path.join(ROOT_DIR, '.pocketforge')),
    host: env.HOST?.trim() || '127.0.0.1',
    port: intEnv('PORT', env.PORT, 8787, 1, 65_535),
    token: suppliedToken || crypto.randomBytes(24).toString('base64url'),
    generatedToken: !suppliedToken,
    maxConcurrentJobs: intEnv('MAX_CONCURRENT_JOBS', env.MAX_CONCURRENT_JOBS, 1, 1, 4),
    stepTimeoutMs: intEnv('STEP_TIMEOUT_MS', env.STEP_TIMEOUT_MS, 600_000, 1_000, 3_600_000),
    maxLogLines: intEnv('MAX_LOG_LINES', env.MAX_LOG_LINES, 4_000, 100, 20_000),
    maxArtifactFiles: intEnv('MAX_ARTIFACT_FILES', env.MAX_ARTIFACT_FILES, 100, 1, 1_000),
    maxArtifactBytes: intEnv('MAX_ARTIFACT_BYTES', env.MAX_ARTIFACT_BYTES, 25 * 1024 * 1024, 1_024, 250 * 1024 * 1024),
  });
}
