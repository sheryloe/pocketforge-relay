const KINDS = new Set(['runner', 'actions', 'device', 'agent']);
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;

export const RELAY_PROTOCOL_VERSION = 1;
export const ADAPTER_CONTRACT_VERSION = 1;

export function unwrapProtocolRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Protocol request must be a JSON object.');
  if (!Object.hasOwn(body, 'schemaVersion')) return body;
  if (body.schemaVersion !== RELAY_PROTOCOL_VERSION) throw new Error('Protocol request version is unsupported.');
  if (Object.keys(body).some(key => key !== 'schemaVersion' && key !== 'payload')
    || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw new Error('Protocol request envelope is malformed.');
  }
  return body.payload;
}

export function protocolEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Protocol event payload is malformed.');
  return { schemaVersion: RELAY_PROTOCOL_VERSION, ...payload };
}

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
      adapterDescriptor({ id: 'ai-agent', kind: 'agent', enabled: false, capabilities: ['evidence-preview', 'explicit-consent', 'structured-proposal'] }),
    ]),
  });
}
