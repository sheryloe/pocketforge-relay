import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const read = file => fs.readFile(path.resolve(file), 'utf8');

test('starter tasks point to five live bounded issues', async () => {
  const guide = await read('docs/GOOD_FIRST_ISSUES.md');
  for (const number of [10, 11, 12, 13, 14]) {
    assert.match(guide, new RegExp(`https://github\\.com/sheryloe/pocketforge-relay/issues/${number}\\)`));
  }
  assert.match(guide, /not evidence of external\s+contributors or adoption/);
});

test('proposal forms require scope, verification, and safety boundaries', async () => {
  const [firstIssue, adapter, config] = await Promise.all([
    read('.github/ISSUE_TEMPLATE/good-first-issue.yml'),
    read('.github/ISSUE_TEMPLATE/adapter.yml'),
    read('.github/ISSUE_TEMPLATE/config.yml'),
  ]);
  assert.match(firstIssue, /labels: \[good first issue, help wanted\]/);
  for (const id of ['existing-tools', 'contract', 'verification', 'boundaries']) assert.match(adapter, new RegExp(`id: ${id}`));
  assert.match(adapter, /User text will not become an arbitrary shell command/);
  assert.match(config, /blank_issues_enabled: false/);
  assert.match(config, /security\/policy/);
});
