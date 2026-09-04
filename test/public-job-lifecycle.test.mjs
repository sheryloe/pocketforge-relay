import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const publicDir = path.resolve('public');
const [html, script] = await Promise.all([
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(publicDir, 'app.js'), 'utf8'),
]);

test('local job UI discovers durable projections and opens recovered jobs without SSE', () => {
  assert.match(script, /api\('\/api\/job-history'\)/);
  assert.match(script, /mergeJobs\(jobsPayload\.jobs, historyPayload\.jobs\)/);
  assert.match(script, /listed\?\.recovered \? 'projection' : ''/);
  assert.match(script, /!state\.active\.recovered && !LOCAL_TERMINAL\.has/);
});

test('local job deletion requires a visible irreversible confirmation and fixed decision', () => {
  assert.match(html, /id="jobDeleteConfirm"[^>]*aria-labelledby="jobDeleteHeading"[^>]*hidden/);
  assert.match(html, /id="jobDeleteConfirmButton"[^>]*data-i18n="local\.deleteConfirm"/);
  assert.match(script, /method: 'DELETE', body: JSON\.stringify\(\{ decision: 'delete' \}\)/);
  assert.match(script, /state\.jobs = state\.jobs\.filter\(candidate => candidate\.id !== job\.id\)/);
  assert.match(script, /E\.jobDeleteCancel\.onclick = \(\) => \{ E\.jobDeleteConfirm\.hidden = true; E\.jobDelete\.focus\(\{ preventScroll: true \}\); \}/);
});
