import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AndroidDeviceAdapter,
  buildAndroidChildEnvironment,
  inspectContainedApkFile,
  parseAdbDevices,
  runBoundedProcess,
  validateApkMetadata,
  verifyEvidenceBundle,
} from '../src/android-device-adapter.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const INTEGRITY_KEY = Buffer.alloc(32, 4);

test('parses adb device states and bounded descriptive fields', () => {
  const devices = parseAdbDevices(`
List of devices attached
SERIAL123 device product:panther model:Pixel_7 device:panther transport_id:1
emulator-5554 offline transport_id:2
USB999 unauthorized usb:1-2 transport_id:3
malformed row that must be ignored
`);
  assert.deepEqual(devices, [
    {
      serial: 'SERIAL123',
      state: 'device',
      product: 'panther',
      model: 'Pixel_7',
      device: 'panther',
      transportId: '1',
    },
    {
      serial: 'emulator-5554',
      state: 'offline',
      product: '',
      model: '',
      device: '',
      transportId: '2',
    },
    {
      serial: 'USB999',
      state: 'unauthorized',
      product: '',
      model: '',
      device: '',
      transportId: '3',
    },
  ]);
});

test('requires absolute injected Android tool paths', () => {
  assert.throws(() => new AndroidDeviceAdapter({
    adbPath: 'adb',
    apkanalyzerPath: path.resolve('apkanalyzer'),
    apksignerPath: path.resolve('apksigner'),
  }), /absolute/);
});

test('Android tools receive only the bounded toolchain environment', () => {
  const environment=buildAndroidChildEnvironment({
    PATH:'tools',JAVA_HOME:'jdk',ANDROID_SDK_ROOT:'sdk',SYSTEMROOT:'windows',
    POCKETFORGE_TOKEN:'relay-secret',POCKETFORGE_GITHUB_TOKEN:'github-secret',
    POCKETFORGE_DEVICE_ID_SECRET:'device-secret',POCKETFORGE_EVIDENCE_INTEGRITY_KEY:'evidence-secret',
    AWS_SECRET_ACCESS_KEY:'cloud-secret',
  });
  assert.equal(environment.PATH,'tools');
  assert.equal(environment.JAVA_HOME,'jdk');
  assert.equal(environment.ANDROID_SDK_ROOT,'sdk');
  assert.equal(environment.CI,'true');
  assert.equal(environment.POCKETFORGE_TOKEN,undefined);
  assert.equal(environment.POCKETFORGE_GITHUB_TOKEN,undefined);
  assert.equal(environment.POCKETFORGE_DEVICE_ID_SECRET,undefined);
  assert.equal(environment.POCKETFORGE_EVIDENCE_INTEGRITY_KEY,undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY,undefined);
});

test('bounded Android tool failures never expose raw stderr paths or secrets', async () => {
  const leakedPath=path.resolve('private','approved.apk');
  const leakedToken='relay-secret-that-must-not-leak';
  await assert.rejects(runBoundedProcess({
    file:process.execPath,
    args:['-e',`process.stderr.write(${JSON.stringify(`${leakedPath} ${leakedToken}`)});process.exit(7)`],
    environment:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT},
  }),error=>{
    assert.equal(error.code,'COMMAND_FAILED');
    assert.equal(error.exitCode,7);
    assert.equal(error.message.includes(leakedPath),false);
    assert.equal(error.message.includes(leakedToken),false);
    assert.match(error.message,/exited with code 7/);
    return true;
  });
});

test('projects opaque device IDs and resolves only freshly enumerated online devices', async () => {
  const tools = toolPaths(path.resolve(os.tmpdir(), 'pf-tools'));
  let output = 'List of devices attached\nSERIAL123 device product:panther model:Pixel_7 device:panther transport_id:1\nUSB999 unauthorized\n';
  const adapter = new AndroidDeviceAdapter({
    ...tools,
    evidenceIntegrityKey: INTEGRITY_KEY,
    deviceIdSecret: Buffer.alloc(32, 7),
    runner: async ({ file, args }) => {
      assert.equal(file, tools.adbPath);
      assert.deepEqual(args, ['devices', '-l']);
      return { stdout: output, stderr: '' };
    },
  });
  const projected = await adapter.listDevices();
  assert.equal(projected.length, 2);
  assert.equal('serial' in projected[0], false);
  assert.equal(projected[0].model, 'Pixel 7');
  assert.match(projected[0].deviceId, /^[A-Za-z0-9_-]{24}$/);
  assert.deepEqual(Object.keys(projected[0]).sort(), ['deviceId', 'model']);
  assert.equal((await adapter.assertDeviceAvailable(projected[0].deviceId)).model, 'Pixel 7');
  await assert.rejects(
    adapter.assertDeviceAvailable(projected[1].deviceId),
    error => error.code === 'DEVICE_NOT_READY',
  );
  output = 'List of devices attached\n';
  await assert.rejects(
    adapter.assertDeviceAvailable(projected[0].deviceId),
    error => error.code === 'DEVICE_NOT_FOUND',
  );
});

test('binds approval to the full fresh device identity and detects transport drift', async () => {
  const tools = toolPaths(path.resolve(os.tmpdir(), 'pf-binding-tools'));
  let transportId = '1';
  const runner = async request => {
    if (JSON.stringify(request.args) === JSON.stringify(['devices', '-l'])) {
      return {
        stdout: `List of devices attached\nSERIAL123 device product:panther model:Pixel_7 device:panther transport_id:${transportId}\n`,
        stderr: '',
      };
    }
    const tail = request.args.slice(2);
    if (tail[0] === 'shell' && tail[1] === 'getprop') {
      const values = {
        'ro.product.manufacturer': 'Google',
        'ro.build.fingerprint': 'google/panther/test:userdebug/dev-keys',
        'ro.build.version.sdk': '35',
        'ro.serialno': 'HARDWARE123',
      };
      return { stdout: values[tail[2]], stderr: '' };
    }
    throw new Error(`Unexpected call: ${JSON.stringify(request.args)}`);
  };
  const adapter = new AndroidDeviceAdapter({
    ...tools,
    runner,
    deviceIdSecret: Buffer.alloc(32, 2),
    evidenceIntegrityKey: INTEGRITY_KEY,
  });
  const [device] = await adapter.listDevices();
  const prepared = await adapter.captureDeviceBinding(device.deviceId);
  assert.match(prepared.binding.approvalFingerprint, /^[a-f0-9]{64}$/);
  assert.match(prepared.binding.mutexFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(prepared.device).includes('SERIAL123'), false);
  transportId = '2';
  await assert.rejects(
    adapter.assertDeviceBinding(prepared.binding),
    error => error.code === 'DEVICE_IDENTITY_CHANGED',
  );
});

test('accepts only regular APKs canonically contained by the workspace', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-apk-'));
  const workspace = path.join(temp, 'workspace');
  const apk = path.join(workspace, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const outside = path.join(temp, 'outside.apk');
  try {
    await fs.mkdir(path.dirname(apk), { recursive: true });
    await fs.writeFile(apk, 'signed-debug-apk');
    await fs.writeFile(outside, 'outside');
    const inspected = await inspectContainedApkFile({ artifactPath: apk, workspaceRoot: workspace });
    assert.equal(inspected.relativePath, 'app/build/outputs/apk/debug/app-debug.apk');
    assert.equal(inspected.sha256, createHash('sha256').update('signed-debug-apk').digest('hex'));
    await assert.rejects(
      inspectContainedApkFile({ artifactPath: outside, workspaceRoot: workspace }),
      error => error.code === 'APK_OUTSIDE_WORKSPACE',
    );
    const textFile = path.join(workspace, 'artifact.txt');
    await fs.writeFile(textFile, 'not an apk');
    await assert.rejects(
      inspectContainedApkFile({ artifactPath: textFile, workspaceRoot: workspace }),
      error => error.code === 'INVALID_APK_EXTENSION',
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link APK path when the platform permits test symlinks', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-apk-link-'));
  const workspace = path.join(temp, 'workspace');
  const targetDirectory = path.join(workspace, 'target');
  const linkedDirectory = path.join(workspace, 'linked');
  const target = path.join(targetDirectory, 'target.apk');
  const link = path.join(linkedDirectory, 'target.apk');
  try {
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(target, 'apk');
    try {
      await fs.symlink(
        targetDirectory,
        linkedDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
        t.skip('This Windows account cannot create symbolic links.');
        return;
      }
      throw error;
    }
    await assert.rejects(
      inspectContainedApkFile({ artifactPath: link, workspaceRoot: workspace }),
      error => error.code === 'APK_SYMLINK_REJECTED',
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('validates APK analyzer metadata strictly', () => {
  assert.deepEqual(validateApkMetadata({
    applicationId: 'com.example.pocketforge',
    versionName: '1.0',
    versionCode: '7',
    targetSdk: '35',
    debuggable: 'true',
  }), {
    applicationId: 'com.example.pocketforge',
    versionName: '1.0',
    versionCode: 7,
    targetSdk: 35,
    debuggable: true,
  });
  assert.throws(() => validateApkMetadata({
    applicationId: 'bad;package',
    versionName: '1',
    versionCode: '1',
    targetSdk: '35',
    debuggable: 'true',
  }), error => error.code === 'INVALID_APPLICATION_ID');
  assert.throws(() => validateApkMetadata({
    applicationId: 'com.example.ok',
    versionName: '1',
    versionCode: '1',
    targetSdk: '35',
    debuggable: 'maybe',
  }), error => error.code === 'INVALID_DEBUGGABLE_VALUE');
});

test('inspects APK metadata and verifies its signature with fixed tool arguments', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-apk-inspect-'));
  const workspace = path.join(temp, 'workspace');
  const apk = path.join(workspace, 'app-debug.apk');
  const tools = toolPaths(path.join(temp, 'tools'));
  const calls = [];
  try {
    await fs.mkdir(workspace);
    await fs.writeFile(apk, 'apk bytes');
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      evidenceIntegrityKey: INTEGRITY_KEY,
      runner: async request => {
        calls.push(request);
        if (request.file === tools.apksignerPath) return {
          stdout: `Verified\nSigner #1 certificate SHA-256 digest: ${'f'.repeat(64)}\n`,
          stderr: '',
        };
        const verb = request.args[1];
        const values = {
          'application-id': 'com.example.pocketforge',
          'version-name': '1.0',
          'version-code': '7',
          'target-sdk': '35',
          debuggable: 'true',
          print: '<manifest package="com.example.pocketforge"></manifest>',
        };
        return { stdout: values[verb], stderr: '' };
      },
    });
    const artifact = await adapter.inspectApk({ artifactPath: apk, workspaceRoot: workspace });
    assert.equal(artifact.applicationId, 'com.example.pocketforge');
    assert.equal(artifact.signatureVerified, true);
    assert.equal(artifact.signerSha256, 'f'.repeat(64));
    assert.deepEqual(calls.at(-1).args, ['verify', '--verbose', '--print-certs', artifact.realPath]);
    assert.ok(calls.every(call => path.isAbsolute(call.file)));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('creates an action-owned snapshot that survives source replacement and detects snapshot tamper', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-snapshot-'));
  const workspace = path.join(temp, 'workspace');
  const store = path.join(temp, 'action-store');
  const source = path.join(workspace, 'app-debug.apk');
  const tools = toolPaths(path.join(temp, 'tools'));
  const original = Buffer.from('apk bytes');
  try {
    await fs.mkdir(workspace);
    await fs.mkdir(store);
    await fs.writeFile(source, original);
    const runner = makeDeviceRunner({ tools });
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      runner,
      deviceIdSecret: Buffer.alloc(32, 8),
      evidenceIntegrityKey: INTEGRITY_KEY,
      settleMs: 0,
    });
    const snapshot = await adapter.createApprovedSnapshot({
      artifactPath: source,
      workspaceRoot: workspace,
      actionStoreRoot: store,
      actionId: 'action-safe',
    });
    await fs.writeFile(source, 'replaced!');
    assert.deepEqual(await fs.readFile(snapshot.realPath), original);
    assert.notEqual(snapshot.realPath, source);
    assert.equal((await adapter.reinspectApprovedSnapshot(snapshot)).sha256, snapshot.sha256);
    await fs.chmod(snapshot.realPath, 0o600);
    await fs.writeFile(snapshot.realPath, 'tampered!');
    await assert.rejects(
      adapter.reinspectApprovedSnapshot(snapshot),
      error => error.code === 'APK_BINDING_CHANGED',
    );
    assert.equal(JSON.stringify({ ...snapshot, realPath: undefined, actionRoot: undefined, storeRoot: undefined }).includes(workspace), false);
    await adapter.deleteApprovedSnapshot(snapshot);
    await assert.rejects(fs.stat(snapshot.realPath), error => error.code === 'ENOENT');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('rejects an action-store collision without overwriting existing content', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-snapshot-collision-'));
  const workspace = path.join(temp, 'workspace');
  const store = path.join(temp, 'action-store');
  const collision = path.join(store, 'action-safe');
  const source = path.join(workspace, 'app-debug.apk');
  const marker = path.join(collision, 'marker.txt');
  try {
    await fs.mkdir(workspace);
    await fs.mkdir(collision, { recursive: true });
    await fs.writeFile(source, 'apk bytes');
    await fs.writeFile(marker, 'keep');
    const tools = toolPaths(path.join(temp, 'tools'));
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      runner: makeDeviceRunner({ tools }),
      evidenceIntegrityKey: INTEGRITY_KEY,
    });
    await assert.rejects(adapter.createApprovedSnapshot({
      artifactPath: source,
      workspaceRoot: workspace,
      actionStoreRoot: store,
      actionId: 'action-safe',
    }), error => error.code === 'ACTION_STORE_COLLISION');
    assert.equal(await fs.readFile(marker, 'utf8'), 'keep');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('uses fixed adb argument arrays and writes bounded device evidence', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-device-evidence-'));
  const actionRoot = path.join(temp, 'action-store', 'action-1');
  const apk = path.join(actionRoot, 'approved.apk');
  const evidenceDir = path.join(actionRoot, 'evidence');
  const tools = toolPaths(path.join(temp, 'tools'));
  const calls = [];
  try {
    await fs.mkdir(actionRoot, { recursive: true });
    await fs.writeFile(apk, 'apk bytes');
    const runner = makeDeviceRunner({
      tools,
      calls,
      screenshot: PNG,
      crashOutput: '--------- beginning of crash\n',
    });
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      evidenceIntegrityKey: INTEGRITY_KEY,
      runner,
      deviceIdSecret: Buffer.alloc(32, 9),
      settleMs: 0,
    });
    const [device] = await adapter.listDevices();
    const captured = await adapter.captureDeviceBinding(device.deviceId);
    const artifact = inspectedArtifact(apk, actionRoot);
    const result = await adapter.installAndCollectEvidence({
      deviceBinding: captured.binding,
      artifact,
      evidenceDir,
      jobId: 'job-1',
      actionId: 'action-1',
      repository: 'https://github.com/android/architecture-samples.git',
      resolvedCommit: 'e'.repeat(40),
      approvedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.equal(result.evidence.status, 'succeeded');
    assert.equal(result.evidence.device.deviceId, device.deviceId);
    assert.equal('serial' in result.evidence.device, false);
    const written = JSON.parse(await fs.readFile(path.join(evidenceDir, 'device-evidence.json'), 'utf8'));
    assert.equal(written.artifact.sha256, artifact.sha256);
    assert.deepEqual(await fs.readFile(path.join(evidenceDir, 'screenshot.png')), PNG);
    assert.equal(written.files.screenshot.sha256, createHash('sha256').update(PNG).digest('hex'));
    assert.match(written.integrity.manifestHmac, /^[a-f0-9]{64}$/);
    assert.equal((await verifyEvidenceBundle({
      evidenceDir,
      evidenceIntegrityKey: INTEGRITY_KEY,
    })).status, 'succeeded');
    await fs.writeFile(path.join(evidenceDir, 'screenshot.png'), Buffer.concat([PNG, Buffer.from([0])]));
    await assert.rejects(verifyEvidenceBundle({
      evidenceDir,
      evidenceIntegrityKey: INTEGRITY_KEY,
    }), error => error.code === 'EVIDENCE_FILE_INTEGRITY_FAILED');
    await fs.writeFile(path.join(evidenceDir, 'screenshot.png'), PNG);
    assert.ok(calls.some(call => call.file === tools.adbPath
      && call.args[0] === '-s' && call.args[1] === 'SERIAL123'
      && call.args[2] === 'install' && path.basename(call.args[3]) === 'approved.apk'));
    assert.ok(calls.some(call => JSON.stringify(call.args) === JSON.stringify([
      '-s', 'SERIAL123', 'shell', 'monkey', '-p', 'com.example.pocketforge',
      '-c', 'android.intent.category.LAUNCHER', '1',
    ])));
    assert.ok(calls.every(call => Array.isArray(call.args) && path.isAbsolute(call.file)));
    assert.ok(calls.some(call => call.args.includes('-T') && call.args.includes('1710000000.123456789')));
    const tamperedManifest = { ...written, status: 'failed' };
    await fs.writeFile(
      path.join(evidenceDir, 'device-evidence.json'),
      `${JSON.stringify(tamperedManifest, null, 2)}\n`,
    );
    await assert.rejects(verifyEvidenceBundle({
      evidenceDir,
      evidenceIntegrityKey: INTEGRITY_KEY,
    }), error => error.code === 'EVIDENCE_MANIFEST_INTEGRITY_FAILED');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('fails closed when adb screencap is not a PNG', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-device-bad-png-'));
  const actionRoot = path.join(temp, 'action-store', 'bad-png');
  const apk = path.join(actionRoot, 'approved.apk');
  const evidenceDir = path.join(actionRoot, 'evidence');
  const tools = toolPaths(path.join(temp, 'tools'));
  try {
    await fs.mkdir(actionRoot, { recursive: true });
    await fs.writeFile(apk, 'apk bytes');
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      evidenceIntegrityKey: INTEGRITY_KEY,
      runner: makeDeviceRunner({ tools, screenshot: Buffer.from('not a png') }),
      deviceIdSecret: Buffer.alloc(32, 3),
      settleMs: 0,
    });
    const [device] = await adapter.listDevices();
    const captured = await adapter.captureDeviceBinding(device.deviceId);
    await assert.rejects(adapter.installAndCollectEvidence({
      deviceBinding: captured.binding,
      artifact: inspectedArtifact(apk, actionRoot),
      evidenceDir,
      jobId: 'job-1',
      actionId: 'bad-png',
    }), error => error.code === 'INVALID_SCREENSHOT');
    const failure = JSON.parse(await fs.readFile(path.join(evidenceDir, 'device-evidence.json'), 'utf8'));
    assert.equal(failure.status, 'failed');
    assert.deepEqual(failure.files, {});
    assert.deepEqual((await fs.readdir(evidenceDir)).sort(), ['device-evidence.json']);
    await verifyEvidenceBundle({ evidenceDir, evidenceIntegrityKey: INTEGRITY_KEY });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('refuses screenshot evidence when the approved package is not foreground', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-device-foreground-'));
  const actionRoot = path.join(temp, 'action-store', 'foreground');
  const apk = path.join(actionRoot, 'approved.apk');
  const evidenceDir = path.join(actionRoot, 'evidence');
  const tools = toolPaths(path.join(temp, 'tools'));
  const calls = [];
  try {
    await fs.mkdir(actionRoot, { recursive: true });
    await fs.writeFile(apk, 'apk bytes');
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      runner: makeDeviceRunner({ tools, calls, foregroundPackage: 'com.example.other' }),
      deviceIdSecret: Buffer.alloc(32, 6),
      evidenceIntegrityKey: INTEGRITY_KEY,
      settleMs: 0,
    });
    const [device] = await adapter.listDevices();
    const captured = await adapter.captureDeviceBinding(device.deviceId);
    await assert.rejects(adapter.installAndCollectEvidence({
      deviceBinding: captured.binding,
      artifact: inspectedArtifact(apk, actionRoot),
      evidenceDir,
      jobId: 'job-1',
      actionId: 'foreground',
    }), error => error.code === 'APP_NOT_FOREGROUND');
    assert.equal(calls.some(call => call.args?.includes('screencap')), false);
    const failure = JSON.parse(await fs.readFile(path.join(evidenceDir, 'device-evidence.json'), 'utf8'));
    assert.equal(failure.status, 'failed');
    assert.deepEqual(failure.files, {});
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('cleans partial evidence payloads before signing a failure manifest', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-device-partial-'));
  const actionRoot = path.join(temp, 'action-store', 'partial');
  const apk = path.join(actionRoot, 'approved.apk');
  const evidenceDir = path.join(actionRoot, 'evidence');
  const tools = toolPaths(path.join(temp, 'tools'));
  try {
    await fs.mkdir(actionRoot, { recursive: true });
    await fs.writeFile(apk, 'apk bytes');
    const baseRunner = makeDeviceRunner({ tools });
    const adapter = new AndroidDeviceAdapter({
      ...tools,
      runner: async request => {
        if (request.args?.includes('screencap')) {
          await fs.writeFile(path.join(evidenceDir, 'crash.txt'), 'force wx collision');
        }
        return baseRunner(request);
      },
      deviceIdSecret: Buffer.alloc(32, 11),
      evidenceIntegrityKey: INTEGRITY_KEY,
      settleMs: 0,
    });
    const [device] = await adapter.listDevices();
    const captured = await adapter.captureDeviceBinding(device.deviceId);
    await assert.rejects(adapter.installAndCollectEvidence({
      deviceBinding: captured.binding,
      artifact: inspectedArtifact(apk, actionRoot),
      evidenceDir,
      jobId: 'job-1',
      actionId: 'partial',
    }), error => error.code === 'EVIDENCE_WRITE_FAILED');
    assert.deepEqual((await fs.readdir(evidenceDir)).sort(), ['device-evidence.json']);
    const failure = await verifyEvidenceBundle({ evidenceDir, evidenceIntegrityKey: INTEGRITY_KEY });
    assert.equal(failure.status, 'failed');
    assert.deepEqual(failure.files, {});
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('bounded process execution rejects oversized output without a shell', async () => {
  const ok = await runBoundedProcess({
    file: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    timeoutMs: 5_000,
    maxStdoutBytes: 10,
    maxStderrBytes: 10,
  });
  assert.equal(ok.stdout, 'ok');
  await assert.rejects(runBoundedProcess({
    file: process.execPath,
    args: ['-e', 'process.stdout.write("0123456789")'],
    timeoutMs: 5_000,
    maxStdoutBytes: 5,
    maxStderrBytes: 10,
  }), error => error.code === 'COMMAND_OUTPUT_LIMIT');
});

test('bounded process safely invokes an absolute Windows batch wrapper', {
  skip: process.platform !== 'win32',
}, async () => {
  const temp = await fs.mkdtemp(path.join(path.resolve('.'), '.pf-batch-test-'));
  const batch = path.join(temp, 'echo version.cmd');
  try {
    await fs.writeFile(batch, '@echo off\r\necho 35.0.0\r\n', 'utf8');
    const result = await runBoundedProcess({
      file: batch,
      args: [],
      timeoutMs: 10_000,
      maxStdoutBytes: 1_000,
      maxStderrBytes: 10_000,
    });
    assert.equal(result.stdout.trim(), '35.0.0');
    await assert.rejects(runBoundedProcess({
      file: batch,
      args: ['& whoami'],
    }), error => error.code === 'UNSAFE_BATCH_ARGUMENT');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

function toolPaths(root) {
  return {
    adbPath: path.join(root, process.platform === 'win32' ? 'adb.exe' : 'adb'),
    apkanalyzerPath: path.join(root, process.platform === 'win32' ? 'apkanalyzer.bat' : 'apkanalyzer'),
    apksignerPath: path.join(root, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'),
  };
}

function inspectedArtifact(apk, actionRoot = path.dirname(apk)) {
  return {
    realPath: apk,
    relativePath: 'app-debug.apk',
    snapshotRelativePath: 'action-1/approved.apk',
    actionRoot,
    storeRoot: path.dirname(actionRoot),
    size: 9,
    sha256: createHash('sha256').update('apk bytes').digest('hex'),
    applicationId: 'com.example.pocketforge',
    versionName: '1.0',
    versionCode: 1,
    targetSdk: 35,
    debuggable: true,
    signatureVerified: true,
    signerSha256: 'f'.repeat(64),
  };
}

function makeDeviceRunner({
  tools,
  calls = [],
  screenshot = PNG,
  crashOutput = '',
  foregroundPackage = 'com.example.pocketforge',
}) {
  let installed = false;
  return async request => {
    calls.push(request);
    if (request.file === tools.apksignerPath) return {
      stdout: `Verified\nSigner #1 certificate SHA-256 digest: ${'f'.repeat(64)}\n`,
      stderr: '',
    };
    if (request.file === tools.apkanalyzerPath) {
      const verb = request.args[1];
      const values = {
        'application-id': 'com.example.pocketforge',
        'version-name': '1.0',
        'version-code': '1',
        'target-sdk': '35',
        debuggable: 'true',
        print: '<manifest package="com.example.pocketforge"></manifest>',
      };
      return { stdout: values[verb], stderr: '' };
    }
    assert.equal(request.file, tools.adbPath);
    const args = request.args;
    if (JSON.stringify(args) === JSON.stringify(['devices', '-l'])) {
      return {
        stdout: 'List of devices attached\nSERIAL123 device product:panther model:Pixel_7 device:panther transport_id:1\n',
        stderr: '',
      };
    }
    const tail = args.slice(2);
    if (tail[0] === 'shell' && tail[1] === 'pm' && tail[2] === 'path') {
      return {
        stdout: installed ? 'package:/data/app/~~safe/com.example.pocketforge/base.apk\n' : '',
        stderr: '',
      };
    }
    if (tail[0] === 'shell' && tail[1] === 'getprop') {
      const values = {
        'ro.product.manufacturer': 'Google',
        'ro.build.fingerprint': 'google/panther/panther:15/AP4A/test:userdebug/dev-keys',
        'ro.build.version.release': '15',
        'ro.build.version.sdk': '35',
        'ro.serialno': 'HARDWARE123',
      };
      return { stdout: values[tail[2]], stderr: '' };
    }
    if (tail[0] === 'install') {
      installed = true;
      return { stdout: 'Success', stderr: '' };
    }
    if (tail[0] === 'shell' && tail[1] === 'dumpsys' && tail[2] === 'package') {
      return { stdout: 'versionCode=1 targetSdk=35\nversionName=1.0\n', stderr: '' };
    }
    if (tail[0] === 'shell' && tail[1] === 'date') return { stdout: '1710000000.123456789\n', stderr: '' };
    if (tail[0] === 'shell' && tail[1] === 'sha256sum') {
      return {
        stdout: `${createHash('sha256').update('apk bytes').digest('hex')}  ${tail[2]}\n`,
        stderr: '',
      };
    }
    if (tail[0] === 'shell' && tail[1] === 'monkey') return { stdout: 'Events injected: 1', stderr: '' };
    if (tail[0] === 'shell' && tail[1] === 'pidof') return { stdout: '4242\n', stderr: '' };
    if (tail[0] === 'shell' && tail[1] === 'cat') return { stdout: 'com.example.pocketforge\0', stderr: '' };
    if (tail[0] === 'shell' && tail[1] === 'stat') return { stdout: '10123\n', stderr: '' };
    if (tail[0] === 'shell' && tail[1] === 'cmd') {
      return { stdout: 'package:com.example.pocketforge uid:10123\n', stderr: '' };
    }
    if (tail[0] === 'shell' && tail[1] === 'dumpsys' && tail[2] === 'activity') {
      return { stdout: `topResumedActivity=ActivityRecord{1 u0 ${foregroundPackage}/.MainActivity t1}\n`, stderr: '' };
    }
    if (tail[0] === 'logcat' && tail.includes('crash')) return { stdout: crashOutput, stderr: '' };
    if (tail[0] === 'logcat') return { stdout: '1710000000.000 I/App: ready\n', stderr: '' };
    if (tail[0] === 'exec-out') return { stdout: screenshot, stderr: '' };
    throw new Error(`Unexpected fake adb arguments: ${JSON.stringify(args)}`);
  };
}
