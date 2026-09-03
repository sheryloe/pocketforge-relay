import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runProcessStep, terminateProcessTree } from '../src/process-runner.mjs';

test('child processes receive only the bounded OS and toolchain environment', async () => {
  const logs = [];
  const environment = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    JAVA_HOME: 'C:\\safe-jdk',
    POCKETFORGE_TOKEN: 'relay-secret-123456789012345',
    AWS_SECRET_ACCESS_KEY: 'host-secret-that-must-not-leak',
    LC_SECRET: 'locale-prefix-must-not-bypass-the-allowlist',
  };
  await runProcessStep({
    step: {
      name: 'Inspect environment',
      command: process.execPath,
      args: ['-e', 'console.log(JSON.stringify({path:!!process.env.PATH,java:process.env.JAVA_HOME,ci:process.env.CI,relay:process.env.POCKETFORGE_TOKEN,aws:process.env.AWS_SECRET_ACCESS_KEY,lcSecret:process.env.LC_SECRET}))'],
    },
    cwd: process.cwd(),
    timeoutMs: 10_000,
    environment,
    onLog: (channel, message) => logs.push({ channel, message }),
  });
  const output = JSON.parse(logs.find(entry => entry.channel === 'stdout').message);
  assert.equal(output.path, true);
  assert.equal(output.java, 'C:\\safe-jdk');
  assert.equal(output.ci, 'true');
  assert.equal(output.relay, undefined);
  assert.equal(output.aws, undefined);
  assert.equal(output.lcSecret, undefined);
});

test('Windows runs npm.cmd through an absolute COMSPEC invocation', { skip: process.platform !== 'win32' }, async () => {
  const logs = [];
  await runProcessStep({
    step: { name: 'Inspect npm version', command: 'npm.cmd', args: ['--version'] },
    cwd: process.cwd(),
    timeoutMs: 10_000,
    onLog: (channel, message) => logs.push({ channel, message }),
  });
  assert.match(logs.find(entry => entry.channel === 'stdout')?.message || '', /^\d+\.\d+\.\d+$/);
});

test('Windows runs a Gradle-style batch wrapper but rejects command injection characters', { skip: process.platform !== 'win32' }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-batch-'));
  const logs = [];
  await fs.writeFile(
    path.join(cwd, 'gradlew.bat'),
    '@echo off\r\nif not "%~1"=="assembleDebug" exit /b 7\r\nif not "%~2"=="--no-daemon" exit /b 8\r\necho gradle-wrapper-ok\r\n',
  );
  try {
    await runProcessStep({
      step: { name: 'Inspect Gradle wrapper', command: 'gradlew.bat', args: ['assembleDebug', '--no-daemon'] },
      cwd,
      timeoutMs: 10_000,
      onLog: (channel, message) => logs.push({ channel, message }),
    });
    assert.ok(logs.some(entry => entry.channel === 'stdout' && entry.message === 'gradle-wrapper-ok'));
    await assert.rejects(
      runProcessStep({
        step: { name: 'Reject unsafe argument', command: 'gradlew.bat', args: ['assembleDebug&whoami'] },
        cwd,
        timeoutMs: 10_000,
        onLog: () => {},
      }),
      /arguments contain unsupported characters/,
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('Windows termination requests a fixed taskkill process tree without a shell', () => {
  const calls = [];
  const child = { pid: 42, exitCode: null, signalCode: null, kill: signal => calls.push(['fallback', signal]) };
  const spawnImpl = (file, args, options) => {
    calls.push([file, args, options]);
    const killer = new EventEmitter();
    killer.unref = () => calls.push(['unref']);
    return killer;
  };
  terminateProcessTree(child, { SystemRoot: 'C:\\Windows' }, { platform: 'win32', spawnImpl });
  assert.equal(calls[0][0], 'C:\\Windows\\System32\\taskkill.exe');
  assert.deepEqual(calls[0][1], ['/pid', '42', '/t', '/f']);
  assert.deepEqual(calls[0][2], { shell: false, windowsHide: true, stdio: 'ignore' });
  assert.deepEqual(calls.slice(1), [['unref']]);
});
