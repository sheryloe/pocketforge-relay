import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const publicDir = path.resolve('public');
const [html, script, styles] = await Promise.all([
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(publicDir, 'app.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'styles.css'), 'utf8'),
]);

test('Actions UI exposes an accessible two-step review without rendering approval ids', () => {
  assert.match(html, /<form id="actionForm"/);
  assert.match(html, /<label for="actionTargetSelect"[^>]*>/);
  assert.match(html, /<label for="actionRefSelect"[^>]*>/);
  assert.match(html, /id="actionMessage"[^>]+aria-live="polite"/);
  assert.match(html, /id="actionApprovalPreview"[^>]+aria-labelledby="actionApprovalHeading"[^>]+tabindex="-1"/);
  assert.match(html, /Step 1 of 2/);
  assert.match(html, /Step 2 of 2/);
  assert.doesNotMatch(html, /approvalId/i);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('Actions UI uses every authenticated API route and requires explicit approval', () => {
  for (const route of [
    '/api/actions/targets',
    '/api/actions/approvals',
    '/api/actions/runs',
    '/cancel',
    '/artifacts/',
  ]) assert.match(script, new RegExp(route.replaceAll('/', '\\/')));

  assert.match(script, /Authorization: `Bearer \$\{state\.token\}`/);
  assert.match(script, /approvalId: approval\.id, decision: 'approve'/);
  assert.match(script, /E\.approvalRepository\.textContent/);
  assert.match(script, /E\.actionUrl\.removeAttribute\('href'\)/);
  assert.match(script, /url\.protocol !== 'https:' \|\| url\.hostname\.toLowerCase\(\) !== 'github\.com'/);
});

test('Actions UI protects external navigation and mobile touch targets', () => {
  assert.match(html, /id="activeActionUrl"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
  assert.match(html, /id="actionRefreshButton"[^>]+aria-label="Refresh GitHub Actions runs"/);
  assert.match(styles, /\.actions-panel button\{min-height:44px\}/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(styles, /\.actions-layout\{display:grid/);
});
