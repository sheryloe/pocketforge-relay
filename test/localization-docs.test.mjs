import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const READMES = ['README.md', 'README.ko.md', 'README.ja.md'];
const DIRECTION_MARKERS = [
  ['README.md', /evidence-first AI development loop/, /provider-neutral proposal\s+manager/, /no production AI provider adapter/, /cannot execute commands or\s+write patches/, /explicit operator opt-in/],
  ['README.ko.md', /증거 중심 AI 개발 루프/, /공급자 중립 제안 관리자/, /운영용 AI 공급자\s+어댑터는 없습니다/, /명령을 실행하거나 패치를 쓸 수도 없습니다/, /운영자의 명시적 동의/],
  ['README.ja.md', /エビデンス中心の AI 開発ループ/, /プロバイダー非依存の提案マネージャー/, /本番用 AI プロバイダーアダプターはありません/, /コマンド実行や\s+パッチ書き込みもできません/, /明示的なオプトイン/],
];
const CAPABILITY_MARKERS = [
  [
    'README.md',
    /disabled-by-default GitHub Actions adapter/,
    /exact target and\s+ref allowlists/,
    /expiring approval/,
    /status\/cancel APIs/,
    /bounded ZIP/,
    /restart\s+recovery/,
    /explicit evidence deletion/,
    /digest-pinned, non-root, no-network container boundary/,
    /contract-tested; real daemon execution remains `NOT RUN` here/,
    /One allowlisted public-repository workflow was dispatched and observed live/,
    /log\/evidence ZIPs were downloaded and digest-checked through the relay\.\s+Live cancellation remains `NOT RUN`/,
  ],
  [
    'README.ko.md',
    /Actions와 Android 연동은 기본적으로 비활성화/,
    /정확한 대상·ref 허용 목록/,
    /만료 승인/,
    /상태·취소 API/,
    /제한된 ZIP/,
    /재시작 복구/,
    /명시적 증거 삭제/,
    /digest 고정·비루트·네트워크 차단 컨테이너\s+경계/,
    /계약 테스트 완료, 실제 데몬 실행은 이 환경에서 `NOT RUN`/,
    /허용 목록의 공개 저장소 워크플로 하나는 실제로 실행·추적했고 로그·증거 ZIP을\s+릴레이를 통해 내려받아 digest를 확인했습니다/,
    /실제 취소는 `NOT RUN`입니다/,
  ],
  [
    'README.ja.md',
    /Actions と Android 連携はデフォルトで無効/,
    /正確なターゲット・ref 許可リスト/,
    /有効期限付き承認/,
    /状態・キャンセル\s+API/,
    /制限付き ZIP/,
    /再起動時の復元/,
    /明示的削除/,
    /ダイジェスト固定・非root・ネットワーク遮断\s+コンテナ境界/,
    /契約テスト済み、実デーモン実行はこの環境で `NOT RUN`/,
    /許可リストの公開リポジトリワークフロー\s+1件は実際に起動・監視し、ログ・エビデンス ZIP をリレー経由で取得して\s+ダイジェストを検証しました/,
    /実際のキャンセルと Android SDK・デバイス検査は\s+`NOT RUN` です/,
  ],
];

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

test('maintained README translations state the AI direction and evidence-driven plan', async () => {
  for (const [file, direction, proposalBoundary, providerBoundary, executionBoundary, dataConsent] of DIRECTION_MARKERS) {
    const text = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, direction);
    assert.match(text, proposalBoundary);
    assert.match(text, providerBoundary);
    assert.match(text, executionBoundary);
    assert.match(text, dataConsent);
    assert.match(text, /ROADMAP\.md/);
    assert.match(text, /OPEN_SOURCE_APPLICATION\.md/);
    assert.match(text, /PASS/);
    assert.match(text, /FAIL/);
    assert.match(text, /NOT RUN/);
  }
});

test('maintained README translations preserve core Actions and Android claims', async () => {
  for (const [file, ...markers] of CAPABILITY_MARKERS) {
    const text = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const marker of markers) assert.match(text, marker, `${file} is missing ${marker}`);
  }
});
