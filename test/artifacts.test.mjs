import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectArtifacts, publicArtifacts, writeBuildSummary } from '../src/artifacts.mjs';

test('artifact paths are relative to the canonical source directory', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-artifacts-'));
  const source = path.join(temp, 'source');
  try {
    await fs.mkdir(path.join(source, 'dist'), { recursive: true });
    await fs.writeFile(path.join(source, 'dist', 'index.html'), '<h1>ok</h1>');
    const artifacts = await collectArtifacts({
      sourceDir: source,
      preset: { artifactMode: 'web' },
      maxFiles: 10,
      maxBytes: 1024,
    });
    assert.deepEqual(artifacts.map((artifact) => artifact.relativePath), ['dist/index.html']);
    assert.equal(artifacts[0].sha256, 'cdcfcebbd2e25ba02c5cdf5d8aabc828df5b138149f8f3638b7e97fe97cc2d36');
    assert.deepEqual(publicArtifacts(artifacts)[0], {
      id: '0',
      name: 'index.html',
      relativePath: 'dist/index.html',
      size: 11,
      sha256: 'cdcfcebbd2e25ba02c5cdf5d8aabc828df5b138149f8f3638b7e97fe97cc2d36',
      contentType: 'text/html; charset=utf-8',
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('build summary preserves the fixed failure classification', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-summary-'));
  try {
    const failure = { tool: 'npm', category: 'dependency', code: 'npm-dependency', summary: 'npm could not resolve or download a dependency.' };
    await writeBuildSummary({ id: 'job', presetId: 'npm-build', status: 'failed', failure }, temp, 'failed');
    const summary = JSON.parse(await fs.readFile(path.join(temp, '.pocketforge-result', 'build-summary.json'), 'utf8'));
    assert.deepEqual(summary.failure, failure);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
