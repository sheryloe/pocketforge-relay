import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPocketForgeServer } from '../src/http-app.mjs';
import { ProposalAgentManager } from '../src/proposal-agent.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceId = '11111111-1111-4111-8111-111111111111';
const previewId = '22222222-2222-4222-8222-222222222222';

test('proposal agent HTTP flow authenticates, previews before consent, and consumes approval once', async () => {
  let providerCalls = 0;
  const proposalAgentManager = new ProposalAgentManager({
    adapter: {
      id: 'fixture-agent',
      version: '1.0.0',
      async propose() {
        providerCalls++;
        return {
          summary: 'A bounded repair plan.',
          diagnosis: 'The observed test failed.',
          steps: [{ kind: 'inspect', description: 'Inspect the failing test.', path: 'test/example.test.mjs' }],
          risks: ['The evidence may be incomplete.'],
          verification: ['Run the focused test.'],
        };
      },
    },
    sourceResolver: async () => ({ status: 'failed', logs: [{ channel: 'stderr', message: 'redacted failure' }], artifacts: [] }),
    randomId: () => previewId,
  });
  const { server, base } = await startServer(proposalAgentManager);
  try {
    assert.equal((await fetch(`${base}/api/agent`)).status, 401);
    const status = await api(base, '/api/agent');
    assert.equal(status.enabled, true);
    assert.equal(status.adapter.mode, 'proposal_only');
    const capabilities = await api(base, '/api/capabilities');
    assert.equal(capabilities.adapters.find(adapter => adapter.id === 'ai-agent').enabled, true);

    const previewResponse = await apiResponse(base, '/api/agent/previews', {
      method: 'POST',
      body: JSON.stringify({ sourceType: 'local_job', sourceId, intent: 'repair_plan' }),
    });
    assert.equal(previewResponse.status, 201);
    const { preview } = await previewResponse.json();
    assert.equal(preview.id, previewId);
    assert.equal(providerCalls, 0);

    const proposalResponse = await apiResponse(base, '/api/agent/proposals', {
      method: 'POST',
      body: JSON.stringify({ previewId, decision: 'approve' }),
    });
    assert.equal(proposalResponse.status, 200);
    const { result } = await proposalResponse.json();
    assert.equal(result.proposal.steps[0].kind, 'inspect');
    assert.equal(providerCalls, 1);

    const replay = await apiResponse(base, '/api/agent/proposals', {
      method: 'POST',
      body: JSON.stringify({ previewId, decision: 'approve' }),
    });
    assert.equal(replay.status, 404);
    assert.equal((await replay.json()).code, 'proposal_preview_not_found');
  } finally { await stopServer(server); }
});

test('proposal agent HTTP routes fail closed while disabled', async () => {
  const { server, base } = await startServer();
  try {
    assert.deepEqual(await api(base, '/api/agent'), { enabled: false, adapter: null });
    const response = await apiResponse(base, '/api/agent/previews', { method: 'POST', body: '{}' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'proposal_agent_disabled');
    const capabilities = await api(base, '/api/capabilities');
    assert.equal(capabilities.adapters.find(adapter => adapter.id === 'ai-agent').enabled, false);
  } finally { await stopServer(server); }
});

async function startServer(proposalAgentManager = null) {
  const config = { token: 'test-token', publicDir: path.join(root, 'public') };
  const server = createPocketForgeServer({ config, manager: {}, proposalAgentManager });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function api(base, route) { return apiResponse(base, route).then(response => response.json()); }
function apiResponse(base, route, options = {}) {
  return fetch(`${base}${route}`, { ...options, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...options.headers } });
}
async function stopServer(server) { await new Promise(resolve => server.close(resolve)); }
