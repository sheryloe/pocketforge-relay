import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const READMES = ['README.md', 'README.ko.md', 'README.ja.md'];

test('maintained README translations cross-link and preserve verification boundaries', async () => {
  for (const file of READMES) {
    const text = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, /(?:\*\*English\*\*|\[English\]\(README\.md\))/);
    assert.match(text, /(?:\*\*한국어\*\*|\[한국어\]\(README\.ko\.md\))/);
    assert.match(text, /(?:\*\*日本語\*\*|\[日本語\]\(README\.ja\.md\))/);
    assert.match(text, /NOT RUN/);
    assert.match(text, /Node\.js 22/);
    assert.match(text, /SECURITY\.md/);
    assert.match(text, /LOCALIZATION\.md/);
    assert.doesNotMatch(text, /\]\([^)]*\\[^)]*\)/, `${file} contains a platform-specific Markdown link`);
  }
});
