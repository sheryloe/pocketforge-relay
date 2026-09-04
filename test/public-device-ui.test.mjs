import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const publicDir = path.resolve('public');
const [html, script, styles, locales] = await Promise.all([
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(publicDir, 'app.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'styles.css'), 'utf8'),
  fs.readFile(path.join(publicDir, 'locales.js'), 'utf8'),
]);

test('device UI makes authorization, immutable review, and evidence privacy explicit', () => {
  assert.match(html, /<form id="deviceForm"/);
  assert.match(html, /class="privacy-warning" role="note"/);
  assert.match(html, /id="deviceApprovalPreview"[^>]+aria-labelledby="deviceApprovalHeading"[^>]+tabindex="-1"/);
  for (const field of ['Repository', 'Resolved commit', 'APK SHA-256', 'Package', 'Version', 'Signature', 'Signer SHA-256', 'Device model']) {
    assert.match(html, new RegExp(`>${field}<`));
  }
  assert.match(html, /id="deviceConsent" type="checkbox"/);
  assert.match(html, /id="deviceApproveButton"[^>]+disabled/);
  assert.match(script, /E\.deviceApprove\.disabled = !hasApproval \|\| !E\.deviceConsent\.checked/);
  assert.match(script, /if \(!approval\?\.actionId \|\| !approval\.approvalToken \|\| !E\.deviceConsent\.checked\) return/);
});

test('device UI covers the authenticated prepare, approve, poll, evidence, discard, and delete contracts', () => {
  for (const route of [
    '/api/devices',
    '/api/device-actions?jobId=',
    '/api/device-actions/prepare',
    '/approve',
    '/evidence/',
  ]) assert.match(script, new RegExp(route.replaceAll('/', '\\/').replace('?', '\\?')));

  assert.match(script, /JSON\.stringify\(\{ jobId: job\.id, artifactId: artifact\.id, deviceId: device\.deviceId \}\)/);
  assert.match(script, /body: JSON\.stringify\(\{ approvalToken: approval\.approvalToken \}\)/);
  assert.match(script, /method: 'DELETE',[\s\S]*?decision: 'discard'/);
  assert.match(script, /method: 'DELETE',[\s\S]*?decision: 'delete'/);
  assert.match(script, /state\.device\.actions = state\.device\.actions\.filter\(candidate => candidate\.id !== action\.id\)/);
  assert.match(script, /if \(state\.device\.active\?\.id === action\.id\) state\.device\.active = null/);
  assert.match(script, /if \(!action\.evidence\)[\s\S]*?E\.deviceDelete\.hidden = false/);
  assert.match(script, /if \(!action \|\| !DEVICE_TERMINAL\.has\(action\.status\)\) return/);
  assert.doesNotMatch(script, /DEVICE_TERMINAL\.has\(action\.status\) \|\| !action\.evidence/);
  for (const phrase of ['record and evidence', '기록과 증거', 'レコードとエビデンス']) {
    assert.match(locales, new RegExp(phrase));
  }
  assert.match(html, /id="deviceDeleteConfirm"[^>]+hidden/);
  assert.match(html, /id="deviceDeleteConfirmButton"/);
  assert.match(html, /id="deviceDeleteButton"[^>]*aria-controls="deviceDeleteConfirm"[^>]*aria-expanded="false"/);
  assert.match(script, /E\.deviceDeleteCancel\.onclick = \(\) => \{ E\.deviceDeleteConfirm\.hidden = true; E\.deviceDelete\.setAttribute\('aria-expanded', 'false'\); E\.deviceDelete\.focus/);
});

test('recovered evidence stays discoverable after in-memory jobs disappear on restart', () => {
  assert.match(script, /shouldLoadActions = state\.device\.enabled/);
  assert.match(script, /const path = job \? `\/api\/device-actions\?jobId=\$\{encodeURIComponent\(job\.id\)\}` : '\/api\/device-actions'/);
  assert.match(script, /E\.deviceActionsRefresh\.disabled = !state\.device\.enabled \|\| state\.device\.refreshing/);
  assert.doesNotMatch(script, /if \(!state\.device\.enabled \|\| !job \|\| state\.device\.refreshing\)/);
  assert.match(script, /const selectable = state\.device\.enabled[\s\S]*?Boolean\(selectedDeviceJob\(\)\)[\s\S]*?Boolean\(selectedDeviceArtifact\(\)\)/);
  assert.match(script, /state\.device\.active = payload\.action[\s\S]*?renderDeviceEvidence\(action\)/);
});

test('one-time device approval remains only in JavaScript memory', () => {
  assert.doesNotMatch(html, /approvalToken/i);
  assert.match(script, /approval: null/);
  assert.match(script, /state\.device\.approval = \{ actionId: payload\.action\.id, approvalToken: payload\.approvalToken \}/);
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\([^\n]*approvalToken/i);
  assert.doesNotMatch(script, /textContent\s*=\s*[^\n]*approvalToken/i);
  assert.doesNotMatch(script, /console\.(?:log|info|warn|error)\([^\n]*approvalToken/i);
  assert.match(script, /async function discardPreparedDeviceApproval\(\)[\s\S]*?decision: 'discard'[\s\S]*?discardDeviceApproval\(\)/);
});

test('structured API errors keep retry and deleted-evidence branches reachable', () => {
  assert.match(script, /const error = new Error\(message\)/);
  assert.match(script, /error\.status = response\.status/);
  assert.match(script, /error\.code = payload\.code/);
  assert.match(script, /throw await responseError\(response\)/);
  assert.match(script, /\['device_busy', 'device_action_capacity'\]/);
  assert.match(script, /'evidence_deleted' \|\| error\.status === 410/);
  assert.match(script, /const actionError = typeof action\.error === 'string' \? action\.error : action\.error\?\.message \|\| ''/);
});

test('locale changes rerender every dynamic device surface and mobile controls stay usable', () => {
  const applyLocale = script.slice(script.indexOf('function applyLocale()'), script.indexOf('\nfunction t('));
  for (const call of ['populateDeviceJobs();', 'populateDevices();', 'renderDeviceActions();', 'renderDeviceAction();']) {
    assert.match(applyLocale, new RegExp(call.replace(/[();]/g, '\\$&')));
  }
  assert.match(styles, /\.device-layout\{display:grid/);
  assert.match(styles, /\.device-panel button\{min-height:44px\}/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.doesNotMatch(`${html}\n${script}`, /쨌|�/);
  assert.match(script, / · /);
});
