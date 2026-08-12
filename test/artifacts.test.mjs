import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectArtifacts } from '../src/artifacts.mjs';

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
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
