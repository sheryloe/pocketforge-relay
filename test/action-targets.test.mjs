import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadActionTargets, parseActionTargets, publicActionTargets, resolveActionTarget } from '../src/action-targets.mjs';

function validConfig() {
  return {
    schemaVersion: 1,
    targets: [{
      id: 'android-debug',
      name: 'Android debug APK',
      repository: 'https://github.com/example/mobile-app.git',
      workflow: 'pocketforge-android.yml',
      refs: ['main', 'release-1'],
      inputs: { variant: 'debug', smoke: true },
      artifactNames: ['app-debug-apk', 'device evidence'],
    }],
  };
}

test('parses, freezes, and resolves an exact GitHub Actions allowlist target', () => {
  const catalog = parseActionTargets(validConfig());
  const listed = publicActionTargets(catalog);
  assert.equal(listed[0].repository, 'https://github.com/example/mobile-app');
  assert.deepEqual(listed[0].refs, ['main', 'release-1']);
  const target = resolveActionTarget(catalog, 'android-debug', 'main');
  assert.equal(target.owner, 'example');
  assert.equal(target.repo, 'mobile-app');
  assert.equal(target.workflow, 'pocketforge-android.yml');
  assert.equal(target.ref, 'main');
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(target.inputs));
  assert.throws(() => resolveActionTarget(catalog, 'android-debug', 'feature/untrusted'), /not allowlisted/);
});

test('rejects repositories, workflows, refs, inputs, and duplicate ids outside the allowlist contract', () => {
  const repository = validConfig();
  repository.targets[0].repository = 'https://token@github.com/example/mobile-app';
  assert.throws(() => parseActionTargets(repository), /credentials/);

  const workflow = validConfig();
  workflow.targets[0].workflow = '../danger.yml';
  assert.throws(() => parseActionTargets(workflow), /without a path/);

  const ref = validConfig();
  ref.targets[0].refs = ['../main'];
  assert.throws(() => parseActionTargets(ref), /unsafe Git ref/);

  const reserved = validConfig();
  reserved.targets[0].inputs.pocketforge_request_id = 'controlled-by-client';
  assert.throws(() => parseActionTargets(reserved), /reserved/);

  const nested = validConfig();
  nested.targets[0].inputs.variant = { command: 'arbitrary' };
  assert.throws(() => parseActionTargets(nested), /string, boolean, or finite number/);

  const duplicate = validConfig();
  duplicate.targets.push(structuredClone(duplicate.targets[0]));
  assert.throws(() => parseActionTargets(duplicate), /Duplicate action target id/);
});

test('loads a bounded regular JSON file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-action-targets-'));
  const file = path.join(directory, 'targets.json');
  try {
    await fs.writeFile(file, JSON.stringify(validConfig()), 'utf8');
    const catalog = await loadActionTargets(file);
    assert.equal(catalog.targets.length, 1);
    await fs.writeFile(file, '{invalid', 'utf8');
    await assert.rejects(loadActionTargets(file), /valid JSON/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
