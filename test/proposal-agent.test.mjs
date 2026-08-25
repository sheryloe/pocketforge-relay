import test from 'node:test';
import assert from 'node:assert/strict';
import { ProposalAgentManager } from '../src/proposal-agent.mjs';

const sourceId = '11111111-1111-4111-8111-111111111111';
const previewId = '22222222-2222-4222-8222-222222222222';

test('proposal preview discloses the exact bounded server-owned evidence before consent', async () => {
  let resolved;
  let providerCalls = 0;
  const manager = managerWith({
    sourceResolver: input => { resolved = input; return source(); },
    propose: async () => { providerCalls++; return validProposal(); },
  });
  const preview = await manager.createPreview({ sourceType: 'local_job', sourceId, intent: 'repair_plan' });
  assert.deepEqual(resolved, { sourceType: 'local_job', sourceId });
  assert.equal(preview.adapter.mode, 'proposal_only');
  assert.equal(preview.evidence.logs.length, 20);
  assert.equal(preview.evidence.logs.at(-1).message.length, 1_000);
  assert.deepEqual(preview.evidence.artifacts, [{ name: 'report.json', sha256: 'a'.repeat(64) }]);
  assert.equal(providerCalls, 0);
});

test('proposal approval is explicit, single-use, and returns only structured advice', async () => {
  let received;
  const manager = managerWith({ propose: async input => { received = input; return validProposal(); } });
  const preview = await manager.createPreview({ sourceType: 'actions_run', sourceId, intent: 'verification_plan' });
  await assert.rejects(manager.approve({ previewId: preview.id, decision: 'reject' }), error => error.code === 'proposal_decision');
  const result = await manager.approve({ previewId: preview.id, decision: 'approve' });
  assert.equal(received.intent, 'verification_plan');
  assert.equal(result.provider.id, 'fixture-agent');
  assert.deepEqual(result.proposal.steps, [{ kind: 'inspect', description: 'Read the bounded failure evidence.', path: 'src/app.mjs' }]);
  assert.equal(Object.hasOwn(result.proposal, 'command'), false);
  await assert.rejects(manager.approve({ previewId: preview.id, decision: 'approve' }), error => error.code === 'proposal_preview_not_found');
});

test('proposal inputs cannot provide logs, prompts, commands, or filesystem paths', async () => {
  const manager = managerWith();
  await assert.rejects(manager.createPreview({ sourceType: 'local_job', sourceId, intent: 'repair_plan', prompt: 'run this' }), error => error.code === 'proposal_input');
  await assert.rejects(manager.createPreview({ sourceType: 'shell', sourceId, intent: 'repair_plan' }), error => error.code === 'proposal_input');
  await assert.rejects(manager.createPreview({ sourceType: 'local_job', sourceId: '../job', intent: 'repair_plan' }), error => error.code === 'proposal_input');
});

test('provider output rejects executable or escaping fields without reflecting them', async () => {
  const manager = managerWith({ propose: async () => ({ ...validProposal(), command: 'rm -rf /' }) });
  const preview = await manager.createPreview({ sourceType: 'local_job', sourceId, intent: 'repair_plan' });
  await assert.rejects(manager.approve({ previewId: preview.id, decision: 'approve' }), error => error.code === 'proposal_output' && !error.message.includes('rm -rf'));

  const pathManager = managerWith({ propose: async () => ({ ...validProposal(), steps: [{ kind: 'edit', description: 'escape', path: '../secret' }] }) });
  const pathPreview = await pathManager.createPreview({ sourceType: 'local_job', sourceId, intent: 'repair_plan' });
  await assert.rejects(pathManager.approve({ previewId: pathPreview.id, decision: 'approve' }), error => error.code === 'proposal_output');
});

test('expired previews are not sent to a provider', async () => {
  let now = 0;
  let calls = 0;
  const manager = managerWith({ now: () => now, propose: async () => { calls++; return validProposal(); } });
  const preview = await manager.createPreview({ sourceType: 'local_job', sourceId, intent: 'explain_failure' });
  now = 30_001;
  await assert.rejects(manager.approve({ previewId: preview.id, decision: 'approve' }), error => error.code === 'proposal_preview_not_found');
  assert.equal(calls, 0);
});

test('provider calls time out with a fixed error and abort signal', async () => {
  let signal;
  const manager = managerWith({ propose: input => { signal = input.signal; return new Promise(() => {}); } });
  const preview = await manager.createPreview({ sourceType: 'local_job', sourceId, intent: 'explain_failure' });
  await assert.rejects(manager.approve({ previewId: preview.id, decision: 'approve' }), error => error.code === 'proposal_timeout' && error.statusCode === 504);
  assert.equal(signal.aborted, true);
});

function managerWith({ sourceResolver = async () => source(), propose = async () => validProposal(), now = () => 0 } = {}) {
  return new ProposalAgentManager({
    adapter: { id: 'fixture-agent', version: '1.0.0', propose },
    sourceResolver,
    now,
    randomId: () => previewId,
    approvalTtlMs: 30_000,
    timeoutMs: 1_000,
  });
}

function source() {
  return {
    status: 'failed', repository: 'https://github.com/example/project', ref: 'main', error: 'Fixed public error.',
    failure: { code: 'npm_test_failed', title: 'Test failed', summary: 'A bounded summary.' },
    logs: Array.from({ length: 25 }, (_, index) => ({ channel: 'stderr', message: index === 24 ? 'x'.repeat(1_200) : `line ${index}` })),
    artifacts: [{ name: 'report.json', sha256: 'a'.repeat(64), absolutePath: 'D:/secret/report.json' }],
  };
}

function validProposal() {
  return { summary: 'A bounded repair plan.', diagnosis: 'The observed test failed.', steps: [{ kind: 'inspect', description: 'Read the bounded failure evidence.', path: 'src/app.mjs' }], risks: ['The diagnosis may be incomplete.'], verification: ['Run the existing focused test.'] };
}
