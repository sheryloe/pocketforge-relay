import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectArtifacts, publicArtifacts, snapshotArtifacts, verifyArtifactManifest, writeArtifactManifest, writeBuildSummary } from '../src/artifacts.mjs';

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

test('writes one deterministic versioned manifest with a digest', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-manifest-'));
  try {
    const artifact = { id: '0', name: 'app.js', relativePath: 'dist/app.js', absolutePath: 'ignored', size: 6, sha256: 'a'.repeat(64), contentType: 'text/javascript' };
    const job = { id: 'job', repository: 'https://github.com/example/repo', ref: 'main', resolvedCommit: 'b'.repeat(40), presetId: 'npm-build' };
    const manifest = await writeArtifactManifest({ job, artifacts: [artifact], snapshotDir: temp });
    assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.integrity.algorithm, 'SHA-256'); assert.match(manifest.integrity.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'manifest.json'), 'utf8')).artifacts[0].sha256, artifact.sha256);
    await assert.rejects(writeArtifactManifest({ job, artifacts: [artifact], snapshotDir: temp }), /EEXIST/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('authenticates a manifest with a dedicated HMAC key', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-manifest-hmac-'));
  const key = Buffer.alloc(32, 7); const wrongKey = Buffer.alloc(32, 8);
  try {
    const job = { id: 'job', repository: null, ref: null, resolvedCommit: null, presetId: 'demo-web' };
    const manifest = await writeArtifactManifest({ job, artifacts: [], snapshotDir: temp, integrityKey: key });
    assert.equal(manifest.integrity.algorithm, 'HMAC-SHA256');
    assert.match(manifest.integrity.manifestHmac, /^[a-f0-9]{64}$/);
    assert.equal((await verifyArtifactManifest({ manifest, snapshotDir: temp, integrityKey: key })).jobId, 'job');
    await assert.rejects(verifyArtifactManifest({ manifest, snapshotDir: temp, integrityKey: wrongKey }), /authentication failed/);
    await assert.rejects(verifyArtifactManifest({ manifest, snapshotDir: temp }), /key is unavailable/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('detects a manifest changed after creation', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-manifest-tamper-'));
  try {
    const job = { id: 'job', repository: null, ref: null, resolvedCommit: null, presetId: 'demo-web' };
    const manifest = await writeArtifactManifest({ job, artifacts: [], snapshotDir: temp });
    assert.equal((await verifyArtifactManifest({ manifest, snapshotDir: temp })).jobId, 'job');
    await fs.appendFile(path.join(temp, 'manifest.json'), ' ');
    await assert.rejects(verifyArtifactManifest({ manifest, snapshotDir: temp }), /changed after creation/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('snapshots keep collected bytes stable after workspace mutation', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-snapshot-'));
  try {
    const source = path.join(temp, 'source'); await fs.mkdir(path.join(source, 'dist'), { recursive: true });
    const file = path.join(source, 'dist', 'app.js'); await fs.writeFile(file, 'stable');
    const artifacts = await collectArtifacts({ sourceDir: source, preset: { artifactMode: 'web' }, maxFiles: 10, maxBytes: 1024 });
    const snapshots = await snapshotArtifacts({ artifacts, snapshotDir: path.join(temp, 'snapshots'), maxBytes: 1024 });
    await assert.rejects(snapshotArtifacts({ artifacts, snapshotDir: path.join(temp, 'snapshots'), maxBytes: 1024 }), /EEXIST/);
    await fs.writeFile(file, 'changed');
    assert.equal(await fs.readFile(snapshots[0].absolutePath, 'utf8'), 'stable');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
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
