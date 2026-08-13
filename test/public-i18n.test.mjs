import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { LOCALES, SUPPORTED_LOCALES } from '../public/locales.js';

const publicDir = path.resolve('public');
const [html, script, serviceWorker] = await Promise.all([
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(publicDir, 'app.js'), 'utf8'),
  fs.readFile(path.join(publicDir, 'sw.js'), 'utf8'),
]);
const englishKeys = Object.keys(LOCALES.en).sort();

test('EN, KO, and JA catalogs have identical non-empty keys', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'ko', 'ja']);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(LOCALES[locale]).sort(), englishKeys, `${locale} catalog keys must match English`);
    for (const [key, value] of Object.entries(LOCALES[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be text`);
      assert.ok(value.trim(), `${locale}.${key} must not be empty`);
    }
  }
});

test('every static and dynamic translation key resolves in every catalog', () => {
  const htmlKeys = [...html.matchAll(/data-i18n(?:-prefix|-placeholder|-aria-label|-content)?="([^"]+)"/g)].map(match => match[1]);
  const prefixes = '(?:language|meta|brand|server|hero|loop|connect|launch|preset|jobs|local|device|actions|boundary|footer|common|files|status|message)';
  const scriptKeys = [...script.matchAll(new RegExp(`[\"'](${prefixes}\\.[A-Za-z0-9_.]+)[\"']`, 'g'))].map(match => match[1]);
  const referenced = new Set([...htmlKeys, ...scriptKeys]);
  assert.ok(referenced.size > 100, 'the main visible UI should be covered by translation keys');
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of referenced) assert.ok(Object.hasOwn(LOCALES[locale], key), `missing ${locale}.${key}`);
  }
});

test('locale persistence is isolated from the tab-only bearer token', () => {
  assert.match(script, /sessionStorage\.getItem\('pocketforge\.token'\)/);
  assert.match(script, /sessionStorage\.setItem\('pocketforge\.token', token\)/);
  assert.match(script, /localStorage\.setItem\(LOCALE_STORAGE_KEY, state\.locale\)/);
  assert.doesNotMatch(script, /localStorage\.(?:getItem|setItem)\([^\n]*(?:token|approval)/i);
  assert.match(script, /return SUPPORTED_LOCALES\.includes\(primary\) \? primary : 'en'/);
  assert.match(script, /document\.documentElement\.lang = state\.locale/);
});

test('translations remain CSP-safe and available to the offline shell', () => {
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(script, /\.textContent = t\(/);
  assert.match(script, /setAttribute\('aria-label', t\(/);
  assert.match(serviceWorker, /'\/locales\.js'/);
});
