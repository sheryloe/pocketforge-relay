const KINDS = new Set(['runner', 'actions', 'device', 'agent']);
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;

export const RELAY_PROTOCOL_VERSION = 1;
export const ADAPTER_CONTRACT_VERSION = 1;

export function adapterDescriptor({ id, kind, enabled, capabilities = [] }) {
  if (typeof id !== 'string' || !IDENTIFIER.test(id)) throw new Error('Adapter id is malformed.');
  if (!KINDS.has(kind)) throw new Error('Adapter kind is unsupported.');
  if (typeof enabled !== 'boolean') throw new Error('Adapter enabled must be boolean.');
  if (!Array.isArray(capabilities) || capabilities.length > 32) throw new Error('Adapter capabilities are malformed.');
  if (capabilities.some(value => typeof value !== 'string' || !IDENTIFIER.test(value))
    || new Set(capabilities).size !== capabilities.length) {
    throw new Error('Adapter capabilities must be unique identifiers.');
  }
  return Object.freeze({
    id,
    kind,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    enabled,
    capabilities: Object.freeze([...capabilities].sort()),
  });
}

export function relayCapabilities({ actionsEnabled = false, deviceEnabled = false } = {}) {
  return Object.freeze({
    protocolVersion: RELAY_PROTOCOL_VERSION,
    adapters: Object.freeze([
      adapterDescriptor({ id: 'local-runner', kind: 'runner', enabled: true, capabilities: ['artifacts', 'jobs', 'sse-logs'] }),
      adapterDescriptor({ id: 'github-actions', kind: 'actions', enabled: actionsEnabled, capabilities: ['artifact-zip', 'cancel', 'dispatch', 'status'] }),
      adapterDescriptor({ id: 'android-device', kind: 'device', enabled: deviceEnabled, capabilities: ['install', 'logcat', 'screenshot', 'verify-apk'] }),
      adapterDescriptor({ id: 'ai-agent', kind: 'agent', enabled: false, capabilities: [] }),
    ]),
  });
}
