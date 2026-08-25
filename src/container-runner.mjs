import path from 'node:path';

const ALLOWED_COMMANDS = new Map([
  ['node', 'node'],
  ['node.exe', 'node'],
  ['npm', 'npm'],
  ['npm.cmd', 'npm'],
  ['cmake', 'cmake'],
  ['cmake.exe', 'cmake'],
  ['gradlew', './gradlew'],
  ['gradlew.bat', './gradlew'],
]);

export function containerizeStep({ runtimePath, image, sourceDir, step }) {
  if (!path.isAbsolute(runtimePath)) throw new Error('Container runtime path must be absolute.');
  if (!path.isAbsolute(sourceDir) || /[\0\r\n,]/.test(sourceDir)) throw new Error('Container workspace path must be absolute and mount-safe.');
  if (!/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('Container image must use a canonical sha256 digest.');
  }
  const command = ALLOWED_COMMANDS.get(path.basename(step.command).toLowerCase());
  if (!command || !Array.isArray(step.args) || step.args.some(value => typeof value !== 'string' || /[\0\r\n]/.test(value))) {
    throw new Error('Preset step is not supported by the container boundary.');
  }
  return {
    step: {
      name: step.name,
      command: runtimePath,
      args: [
        'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g',
        '--cpus=1', '--user=65532:65532', '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
        '--mount', `type=bind,source=${sourceDir},target=/workspace`,
        '--workdir=/workspace', image, command, ...step.args,
      ],
    },
    cwd: sourceDir,
  };
}
