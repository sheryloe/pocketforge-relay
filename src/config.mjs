import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function intEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function loadConfig(env = process.env) {
  const suppliedToken = env.POCKETFORGE_TOKEN?.trim();
  return Object.freeze({
    rootDir: ROOT_DIR,
    publicDir: path.join(ROOT_DIR, 'public'),
    examplesDir: path.join(ROOT_DIR, 'examples'),
    dataDir: path.resolve(env.POCKETFORGE_DATA_DIR || path.join(ROOT_DIR, '.pocketforge')),
    host: env.HOST?.trim() || '127.0.0.1',
    port: intEnv(env.PORT, 8787, 1, 65_535),
    token: suppliedToken || crypto.randomBytes(24).toString('base64url'),
    generatedToken: !suppliedToken,
    maxConcurrentJobs: intEnv(env.MAX_CONCURRENT_JOBS, 1, 1, 4),
    stepTimeoutMs: intEnv(env.STEP_TIMEOUT_MS, 600_000, 1_000, 3_600_000),
    maxLogLines: intEnv(env.MAX_LOG_LINES, 4_000, 100, 20_000),
    maxArtifactFiles: intEnv(env.MAX_ARTIFACT_FILES, 100, 1, 1_000),
    maxArtifactBytes: intEnv(env.MAX_ARTIFACT_BYTES, 25 * 1024 * 1024, 1_024, 250 * 1024 * 1024),
  });
}
