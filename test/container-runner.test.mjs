import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { containerizeStep } from '../src/container-runner.mjs';

const runtimePath = path.resolve('tools/docker.exe');
const sourceDir = path.resolve('workspace/source');
const image = `ghcr.io/example/toolchain@sha256:${'a'.repeat(64)}`;

test('wraps one fixed preset step in a non-root default-deny resource boundary', () => {
  const request = containerizeStep({
    runtimePath, image, sourceDir,
    step: { name: 'Run tests', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] },
  });
  assert.equal(request.cwd, sourceDir);
  assert.equal(request.step.command, runtimePath);
  assert.deepEqual(request.step.args, [
    'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g',
    '--cpus=1', '--user=65532:65532', '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
    '--mount', `type=bind,source=${sourceDir},target=/workspace`,
    '--workdir=/workspace', image, 'npm', 'test',
  ]);
});

test('rejects mutable images, unknown commands, unsafe arguments, and unsafe mounts', () => {
  const base = { runtimePath, image, sourceDir, step: { name: 'Build', command: 'npm', args: ['test'] } };
  assert.throws(() => containerizeStep({ ...base, image: 'node:22' }), /canonical sha256 digest/);
  assert.throws(() => containerizeStep({ ...base, step: { ...base.step, command: 'bash' } }), /not supported/);
  assert.throws(() => containerizeStep({ ...base, step: { ...base.step, args: ['test\nwhoami'] } }), /not supported/);
  assert.throws(() => containerizeStep({ ...base, sourceDir: `${sourceDir},readonly` }), /mount-safe/);
});
