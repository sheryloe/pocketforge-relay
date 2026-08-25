import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadActionTargets } from '../src/action-targets.mjs';

test('hosted evidence target fixes the repository, workflow, ref, and artifact', async () => {
  const catalog = await loadActionTargets(path.resolve('config/actions-targets.pocketforge.json'));
  assert.equal(catalog.targets.length, 1);
  assert.deepEqual(catalog.targets[0], {
    id: 'pocketforge-evidence',
    name: 'PocketForge hosted evidence',
    repository: 'https://github.com/sheryloe/pocketforge-relay',
    owner: 'sheryloe',
    repo: 'pocketforge-relay',
    workflow: 'pocketforge-evidence.yml',
    refs: ['main'],
    inputs: {},
    artifactNames: ['relay-evidence'],
  });
});

test('hosted evidence workflow accepts only the audit id and pins artifact upload', async () => {
  const workflow = await fs.readFile(path.resolve('.github/workflows/pocketforge-evidence.yml'), 'utf8');
  assert.match(workflow, /pocketforge_request_id:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /actions\/checkout|pull_request_target|contents: write/);
});
