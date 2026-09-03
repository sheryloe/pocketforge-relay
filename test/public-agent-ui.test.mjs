import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [html, script] = await Promise.all([
  fs.readFile(path.join(root, 'public', 'index.html'), 'utf8'),
  fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'),
]);

test('proposal UI exposes an accessible two-step evidence consent flow', () => {
  assert.match(html, /id="agentSection"[^>]+aria-labelledby="agentHeading"/);
  assert.match(html, /id="agentPreview"[^>]+tabindex="-1"[^>]+hidden/);
  assert.match(html, /id="agentConsent" type="checkbox"/);
  assert.match(html, /id="agentApproveButton"[^>]+disabled/);
  assert.match(script, /E\.agentApprove\.disabled = !state\.agent\.preview \|\| !E\.agentConsent\.checked/);
});

test('proposal UI sends only source identifiers and fixed intent before exact approval', () => {
  assert.match(script, /api\('\/api\/agent\/previews'.*JSON\.stringify\(\{ sourceType, sourceId, intent: E\.agentIntent\.value \}\)/s);
  assert.match(script, /api\('\/api\/agent\/proposals'.*JSON\.stringify\(\{ previewId, decision: 'approve' \}\)/s);
  assert.doesNotMatch(script, /contentEditable|innerHTML|eval\(|new Function/);
});

test('proposal output is rendered as text-only structured advice', () => {
  assert.match(script, /E\.agentSummary\.textContent = proposal\.summary/);
  assert.match(script, /E\.agentDiagnosis\.textContent = proposal\.diagnosis/);
  assert.match(script, /function listItem\(text\).*item\.textContent = text/s);
});
