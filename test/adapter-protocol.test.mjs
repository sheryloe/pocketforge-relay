import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterDescriptor, relayCapabilities } from '../src/adapter-protocol.mjs';

test('advertises one versioned, deterministic descriptor per bounded adapter', () => {
  const result = relayCapabilities({ actionsEnabled: true, deviceEnabled: false });
  assert.equal(result.protocolVersion, 1);
  assert.deepEqual(result.adapters.map(({ id, kind, contractVersion, enabled }) => ({ id, kind, contractVersion, enabled })), [
    { id: 'local-runner', kind: 'runner', contractVersion: 1, enabled: true },
    { id: 'github-actions', kind: 'actions', contractVersion: 1, enabled: true },
    { id: 'android-device', kind: 'device', contractVersion: 1, enabled: false },
    { id: 'ai-agent', kind: 'agent', contractVersion: 1, enabled: false },
  ]);
  assert.deepEqual(result.adapters[1].capabilities, ['artifact-zip', 'cancel', 'dispatch', 'status']);
});

test('rejects malformed descriptors and duplicate capabilities', () => {
  assert.throws(() => adapterDescriptor({ id: '../shell', kind: 'runner', enabled: true }), /id is malformed/);
  assert.throws(() => adapterDescriptor({ id: 123, kind: 'runner', enabled: true }), /id is malformed/);
  assert.throws(() => adapterDescriptor({ id: 'local', kind: 'shell', enabled: true }), /kind is unsupported/);
  assert.throws(() => adapterDescriptor({ id: 'local', kind: 'runner', enabled: 'yes' }), /must be boolean/);
  assert.throws(() => adapterDescriptor({ id: 'local', kind: 'runner', enabled: true, capabilities: ['jobs', 'jobs'] }), /unique identifiers/);
  assert.throws(() => adapterDescriptor({ id: 'local', kind: 'runner', enabled: true, capabilities: [123] }), /unique identifiers/);
});
