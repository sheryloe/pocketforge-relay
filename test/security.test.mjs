import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogRedactor, normalizeGitHubRepository, tokenMatches, validateGitRef } from '../src/security.mjs';

test('normalizes public GitHub URLs', () => {
  assert.equal(normalizeGitHubRepository('https://github.com/openai/openai-node'), 'https://github.com/openai/openai-node.git');
  assert.equal(normalizeGitHubRepository('https://github.com/openai/openai-node.git/'), 'https://github.com/openai/openai-node.git');
});

test('rejects unsafe repository URLs', () => {
  assert.throws(() => normalizeGitHubRepository('http://github.com/owner/repo'), /https:\/\/github\.com/);
  assert.throws(() => normalizeGitHubRepository('https://example.com/owner/repo'), /github\.com/);
  assert.throws(() => normalizeGitHubRepository('https://token@github.com/owner/repo'), /credentials/);
  assert.throws(() => normalizeGitHubRepository('https://github.com/owner/repo/issues'), /form/);
});

test('validates refs', () => {
  assert.equal(validateGitRef('feature/mobile-loop'), 'feature/mobile-loop');
  assert.throws(() => validateGitRef('--upload-pack=evil'), /unsafe/);
  assert.throws(() => validateGitRef('../main'), /unsafe/);
  assert.throws(() => validateGitRef('main@{1}'), /unsafe/);
});

test('compares bearer tokens', () => {
  assert.equal(tokenMatches('secret-token', 'Bearer secret-token'), true);
  assert.equal(tokenMatches('secret-token', 'Bearer wrong-token'), false);
  assert.equal(tokenMatches('secret-token', undefined), false);
});

test('redacts exact and recognizable secrets without changing ordinary logs', () => {
  const relayToken = 'relay-token-12345678901234567890';
  const redact = createLogRedactor([relayToken]);
  const source = `ordinary build output; exact=${relayToken}; POCKETFORGE_TOKEN="another-secret-value"; Authorization: Bearer bearer-secret-value; github_pat_abcdefghijklmnopqrstuvwxyz123456`;
  const output = redact(source);
  assert.match(output, /ordinary build output/);
  assert.match(output, /exact=\[REDACTED\]/);
  assert.match(output, /POCKETFORGE_TOKEN=\[REDACTED\]/);
  assert.match(output, /Authorization: Bearer \[REDACTED\]/);
  assert.doesNotMatch(output, /relay-token|another-secret|bearer-secret|github_pat_/);
  assert.equal(redact('tokenizer=enabled; build completed'), 'tokenizer=enabled; build completed');
});

test('redacts quoted and JSON authorization values while preserving their structure', () => {
  const redact = createLogRedactor([]);
  const json = redact('{"Authorization":"Bearer json-secret-value"}');
  const quoted = redact('Authorization: Bearer "quoted-secret-value"');
  const quotedScheme = redact('proxy-authorization = "Basic encoded-secret-value"');
  assert.equal(json, '{"Authorization":"Bearer [REDACTED]"}');
  assert.equal(quoted, 'Authorization: Bearer [REDACTED]');
  assert.equal(quotedScheme, 'proxy-authorization = "Basic [REDACTED]"');
  assert.doesNotMatch(`${json} ${quoted} ${quotedScheme}`, /json-secret|quoted-secret|encoded-secret/);
});
