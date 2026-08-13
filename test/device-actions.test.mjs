import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DeviceActionManager } from '../src/device-actions.mjs';

test('prepares a five-minute hashed approval and consumes it exactly once', async () => {
  let now = Date.parse('2026-08-13T00:00:00.000Z');
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter, clock: () => now });
  const prepared = await manager.prepare(prepareInput());

  assert.equal(prepared.action.status, 'awaiting_approval');
  assert.equal(prepared.action.expiresAt, '2026-08-13T00:05:00.000Z');
  assert.match(prepared.approvalToken, /^[A-Za-z0-9_-]{43}$/);
  const serialized = JSON.stringify(manager.getAction(prepared.action.id));
  assert.doesNotMatch(
    serialized,
    /approvalToken|tokenHash|realPath|workspaceRoot|actionRoot|storeRoot|snapshotRelativePath|approvalFingerprint|mutexFingerprint|adbSerial/,
  );

  now += 1_000;
  const completed = await manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  });
  assert.equal(completed.status, 'succeeded');
  assert.equal(adapter.installCalls.length, 1);
  assert.equal(adapter.installCalls[0].deviceBinding.deviceId, 'device-safe-id-1234');
  assert.equal(adapter.installCalls[0].artifact.sha256, 'a'.repeat(64));
  await assert.rejects(manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  }), error => error.code === 'APPROVAL_ALREADY_USED');
});

test('rejects non-succeeded jobs before inspecting an APK', async () => {
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter });
  await assert.rejects(manager.prepare({
    ...prepareInput(),
    jobStatus: 'failed',
  }), error => error.code === 'JOB_NOT_SUCCEEDED');
  assert.equal(adapter.inspectCalls.length, 0);
});

test('prepare failures never expose raw filesystem paths or secrets', async () => {
  const privatePath=path.resolve('private','approved.apk');
  const manager=makeManager({
    adapter:{
      ...fakeAdapter(),
      createApprovedSnapshot:async()=>{const error=new Error(`ENOENT ${privatePath} relay-secret`);error.code='ENOENT';throw error;},
    },
  });
  await assert.rejects(manager.prepare(prepareInput()),error=>{
    assert.equal(error.message.includes(privatePath),false);
    assert.equal(error.message.includes('relay-secret'),false);
    assert.match(error.message,/server-managed operation/);
    return true;
  });
});

test('discard retains the action when snapshot cleanup fails', async () => {
  const adapter=fakeAdapter();
  adapter.deleteApprovedSnapshot=async()=>{throw new Error(`EPERM ${path.resolve('private','approved.apk')} token-secret`);};
  const manager=makeManager({adapter});
  const prepared=await manager.prepare(prepareInput());
  await assert.rejects(manager.discard(prepared.action.id),error=>{
    assert.equal(error.code,'SNAPSHOT_CLEANUP_FAILED');
    assert.equal(error.message.includes('private'),false);
    return true;
  });
  assert.equal(manager.getAction(prepared.action.id).status,'awaiting_approval');
});

test('expires approval after its bounded lifetime and erases usability', async () => {
  let now = 1_000;
  const manager = makeManager({
    adapter: fakeAdapter(),
    clock: () => now,
    approvalTtlMs: 1_000,
  });
  const prepared = await manager.prepare(prepareInput());
  now = 2_000;
  assert.equal(manager.getAction(prepared.action.id).status, 'expired');
  await assert.rejects(manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  }), error => error.code === 'APPROVAL_EXPIRED');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.getAction(prepared.action.id),null);
});

test('invalid approval is not consumed and cannot authorize another action', async () => {
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter });
  const first = await manager.prepare(prepareInput({ jobId: 'job-1' }));
  const second = await manager.prepare(prepareInput({ jobId: 'job-2', artifactId: 'artifact-2' }));

  await assert.rejects(manager.approve({
    actionId: second.action.id,
    approvalToken: first.approvalToken,
  }), error => error.code === 'INVALID_APPROVAL');
  assert.equal(manager.getAction(second.action.id).status, 'awaiting_approval');
  assert.equal((await manager.approve({
    actionId: second.action.id,
    approvalToken: second.approvalToken,
  })).status, 'succeeded');
});

test('re-inspects and rejects an APK whose approved digest changed', async () => {
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter });
  const prepared = await manager.prepare(prepareInput());
  adapter.artifact = { ...adapter.artifact, sha256: 'b'.repeat(64) };

  await assert.rejects(manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  }), error => {
    assert.equal(error.code, 'ARTIFACT_BINDING_CHANGED');
    assert.equal(error.action.status, 'failed');
    return true;
  });
  assert.equal(adapter.installCalls.length, 0);
  assert.equal(manager.getAction(prepared.action.id).error.code, 'ARTIFACT_BINDING_CHANGED');
});

test('serializes destructive work with a per-device mutex without consuming a busy approval', async () => {
  let releaseFirst;
  let announceFirst;
  const firstStarted = new Promise(resolve => { announceFirst = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  const adapter = fakeAdapter({
    installImpl: async request => {
      request.onPhase('installing');
      if (request.jobId === 'job-1') {
        announceFirst();
        await firstRelease;
      }
      return evidenceResult(request);
    },
  });
  const manager = makeManager({ adapter });
  const first = await manager.prepare(prepareInput({ jobId: 'job-1', artifactId: 'artifact-1' }));
  const second = await manager.prepare(prepareInput({ jobId: 'job-2', artifactId: 'artifact-2' }));

  const firstApproval = manager.approve({
    actionId: first.action.id,
    approvalToken: first.approvalToken,
  });
  await firstStarted;
  await assert.rejects(manager.approve({
    actionId: second.action.id,
    approvalToken: second.approvalToken,
  }), error => error.code === 'DEVICE_BUSY');
  assert.equal(manager.getAction(second.action.id).status, 'awaiting_approval');

  releaseFirst();
  assert.equal((await firstApproval).status, 'succeeded');
  assert.equal((await manager.approve({
    actionId: second.action.id,
    approvalToken: second.approvalToken,
  })).status, 'succeeded');
});

test('serializes two ADB aliases that resolve to one physical-device mutex', async () => {
  let release;
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const adapter = fakeAdapter({
    installImpl: async request => {
      request.onPhase('installing');
      if (request.jobId === 'job-1') {
        announce();
        await blocked;
      }
      return evidenceResult(request);
    },
  });
  adapter.captureDeviceBinding = async deviceId => ({
    device: { deviceId, model: 'Pixel 7' },
    binding: {
      deviceId,
      approvalFingerprint: createFingerprint(deviceId),
      mutexFingerprint: 'd'.repeat(64),
    },
  });
  adapter.assertDeviceBinding = async binding => ({
    device: { deviceId: binding.deviceId, model: 'Pixel 7' },
    binding,
  });
  const manager = makeManager({ adapter });
  const first = await manager.prepare(prepareInput({ jobId: 'job-1', deviceId: 'device-usb-alias-1' }));
  const second = await manager.prepare(prepareInput({
    jobId: 'job-2', artifactId: 'artifact-2', deviceId: 'device-tcp-alias-2',
  }));
  const firstApproval = manager.approve({ actionId: first.action.id, approvalToken: first.approvalToken });
  await started;
  await assert.rejects(manager.approve({
    actionId: second.action.id,
    approvalToken: second.approvalToken,
  }), error => error.code === 'DEVICE_BUSY');
  release();
  await firstApproval;
  assert.equal((await manager.approve({
    actionId: second.action.id,
    approvalToken: second.approvalToken,
  })).status, 'succeeded');
});

test('binds evidence output to the relay-managed action directory', async () => {
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter });
  const prepared = await manager.prepare(prepareInput({ jobId: 'job-fixed' }));
  await manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  });
  const call = adapter.installCalls[0];
  assert.equal(call.evidenceDir, path.join(
    path.resolve('test-action-store'),
    prepared.action.id,
    'evidence',
  ));
});

test('rejects path-unsafe action IDs before allocating a snapshot', async () => {
  const adapter = fakeAdapter();
  const manager = new DeviceActionManager({
    adapter,
    actionStoreRoot: path.resolve('test-action-store'),
    idFactory: () => '../escape',
  });
  await assert.rejects(manager.prepare(prepareInput()), error => error.code === 'INVALID_IDENTIFIER');
  assert.equal(adapter.inspectCalls.length, 0);
});

test('binds approval to exact device identity and rejects fresh drift before install', async () => {
  const adapter = fakeAdapter();
  const manager = makeManager({ adapter });
  const prepared = await manager.prepare(prepareInput());
  adapter.assertDeviceBinding = async () => {
    const error = new Error('device identity changed');
    error.code = 'DEVICE_IDENTITY_CHANGED';
    throw error;
  };
  await assert.rejects(manager.approve({
    actionId: prepared.action.id,
    approvalToken: prepared.approvalToken,
  }), error => error.code === 'DEVICE_IDENTITY_CHANGED');
  assert.equal(adapter.installCalls.length, 0);
  assert.equal(manager.getAction(prepared.action.id).status, 'failed');
});

function makeManager({
  adapter,
  clock = () => Date.parse('2026-08-13T00:00:00.000Z'),
  approvalTtlMs = 5 * 60 * 1000,
} = {}) {
  let id = 0;
  let tokenByte = 0;
  return new DeviceActionManager({
    adapter,
    actionStoreRoot: path.resolve('test-action-store'),
    clock,
    approvalTtlMs,
    idFactory: () => `action-${++id}`,
    randomBytesFn: () => Buffer.alloc(32, ++tokenByte),
  });
}

function prepareInput(overrides = {}) {
  return {
    jobId: 'job-1',
    jobStatus: 'succeeded',
    repository: 'https://github.com/android/architecture-samples.git',
    resolvedCommit: 'e'.repeat(40),
    artifactId: 'artifact-1',
    artifactPath: path.resolve('test-workspace', 'app-debug.apk'),
    workspaceRoot: path.resolve('test-workspace'),
    deviceId: 'device-safe-id-1234',
    ...overrides,
  };
}

function fakeAdapter({ installImpl } = {}) {
  const adapter = {
    artifact: {
      realPath: path.resolve('test-workspace', 'app-debug.apk'),
      relativePath: 'app-debug.apk',
      snapshotRelativePath: 'action-1/approved.apk',
      actionRoot: path.resolve('test-action-store', 'action-1'),
      storeRoot: path.resolve('test-action-store'),
      size: 1234,
      sha256: 'a'.repeat(64),
      applicationId: 'com.example.pocketforge',
      versionName: '1.0',
      versionCode: 1,
      targetSdk: 35,
      debuggable: true,
      signatureVerified: true,
      signerSha256: 'f'.repeat(64),
    },
    device: {
      deviceId: 'device-safe-id-1234',
      model: 'Pixel 7',
    },
    binding: {
      deviceId: 'device-safe-id-1234',
      approvalFingerprint: 'c'.repeat(64),
      mutexFingerprint: 'd'.repeat(64),
    },
    inspectCalls: [],
    installCalls: [],
    deleteCalls: [],
    async createApprovedSnapshot(request) {
      this.inspectCalls.push(request);
      return {
        ...this.artifact,
        actionRoot: path.join(request.actionStoreRoot, request.actionId),
        realPath: path.join(request.actionStoreRoot, request.actionId, 'approved.apk'),
        snapshotRelativePath: `${request.actionId}/approved.apk`,
      };
    },
    async reinspectApprovedSnapshot(approvedArtifact) {
      return {
        ...approvedArtifact,
        sha256: this.artifact.sha256,
        size: this.artifact.size,
        applicationId: this.artifact.applicationId,
        versionName: this.artifact.versionName,
        versionCode: this.artifact.versionCode,
        targetSdk: this.artifact.targetSdk,
        debuggable: this.artifact.debuggable,
        signerSha256: this.artifact.signerSha256,
      };
    },
    async deleteApprovedSnapshot(artifact) {
      this.deleteCalls.push(artifact.realPath);
    },
    async captureDeviceBinding(deviceId) {
      assert.equal(deviceId, this.device.deviceId);
      return { device: { ...this.device }, binding: { ...this.binding } };
    },
    async assertDeviceBinding(binding) {
      assert.deepEqual(binding, this.binding);
      return { device: { ...this.device }, binding: { ...this.binding } };
    },
    async installAndCollectEvidence(request) {
      this.installCalls.push(request);
      if (installImpl) return installImpl(request);
      request.onPhase('installing');
      request.onPhase('launching');
      request.onPhase('collecting_evidence');
      return evidenceResult(request);
    },
  };
  return adapter;
}

function evidenceResult(request) {
  return {
    evidence: {
      schemaVersion: 1,
      actionId: request.actionId,
      jobId: request.jobId,
      status: 'succeeded',
    },
  };
}

function createFingerprint(value) {
  return `${Buffer.from(value).toString('hex')}${'0'.repeat(64)}`.slice(0, 64);
}
