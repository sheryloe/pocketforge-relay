import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHILD_ENVIRONMENT_NAMES = new Set([
  'ANDROID_HOME', 'ANDROID_NDK_HOME', 'ANDROID_SDK_ROOT', 'APPDATA', 'AR', 'CC',
  'CMAKE_GENERATOR', 'CMAKE_PREFIX_PATH', 'CMAKE_TOOLCHAIN_FILE', 'COMSPEC', 'CXX',
  'DEVELOPER_DIR', 'GRADLE_USER_HOME', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'INCLUDE',
  'JAVA_HOME', 'LANG', 'LANGUAGE', 'LC_ADDRESS', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE',
  'LC_IDENTIFICATION', 'LC_MEASUREMENT', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NAME',
  'LC_NUMERIC', 'LC_PAPER', 'LC_TELEPHONE', 'LC_TIME', 'LD', 'LIB', 'LIBPATH',
  'LOCALAPPDATA', 'LOGNAME',
  'NDK_HOME', 'NODE_EXTRA_CA_CERTS', 'PATH', 'PATHEXT', 'PKG_CONFIG_PATH',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SDKROOT',
  'SSL_CERT_DIR', 'SSL_CERT_FILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'TZ',
  'USER', 'USERNAME', 'USERPROFILE', 'VCPKG_ROOT', 'WINDIR',
]);

export function buildChildEnvironment(source = process.env) {
  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    const normalized = name.toUpperCase();
    if (value !== undefined && CHILD_ENVIRONMENT_NAMES.has(normalized)) {
      environment[name] = value;
    }
  }
  environment.CI = 'true';
  environment.FORCE_COLOR = '0';
  return environment;
}

export function runProcessStep({ step, cwd, timeoutMs, signal, onLog, environment = process.env }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    onLog('system', `$ ${[step.command, ...step.args].map(v => /\s/.test(v) ? JSON.stringify(v) : v).join(' ')}`);
    let settled = false;
    let forceKillTimer;
    const childEnvironment = buildChildEnvironment(environment);
    const invocation = processInvocation(step, cwd, childEnvironment);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: childEnvironment,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    const flushers = [capture(child.stdout, 'stdout', onLog), capture(child.stderr, 'stderr', onLog)];
    const requestTermination = () => { forceKillTimer ??= terminate(child); };
    const timeout = setTimeout(() => { onLog('system', `Step exceeded ${timeoutMs} ms and was terminated.`); requestTermination(); }, timeoutMs);
    const onAbort = () => { onLog('system', 'Cancellation requested. Terminating the active process.'); requestTermination(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(forceKillTimer); signal?.removeEventListener('abort', onAbort); fn(); };
    child.on('error', e => finish(() => reject(new Error(`Unable to start ${step.command}: ${e.message}`))));
    child.on('close', (code, sig) => { flushers.forEach(f => f()); finish(() => signal?.aborted ? reject(abortError()) : code === 0 ? resolve({ code: 0, signal: sig }) : reject(new Error(`${step.name} failed with ${code == null ? `signal ${sig}` : `exit code ${code}`}.`))); });
  });
}

function processInvocation(step, cwd, environment) {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(step.command)) {
    return { command: step.command, args: step.args, windowsVerbatimArguments: false };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:cmd|bat)$/i.test(step.command)) {
    throw new Error('Windows batch commands must use a fixed filename without a path.');
  }
  if (!step.args.every(argument => /^[A-Za-z0-9._/:=+-]+$/.test(argument))) {
    throw new Error('Windows batch command arguments contain unsupported characters.');
  }
  const command = resolveWindowsBatchCommand(step.command, cwd, environment);
  if (/[\u0000\r\n%"!^&|<>]/.test(command)) {
    throw new Error('The resolved Windows batch command path contains unsupported characters.');
  }
  const comspec = environmentValue(environment, 'COMSPEC');
  if (!comspec || !path.win32.isAbsolute(comspec) || path.win32.basename(comspec).toLowerCase() !== 'cmd.exe') {
    throw new Error('COMSPEC must be an absolute path to cmd.exe for Windows batch commands.');
  }
  const quotedCommand = [command, ...step.args].map(value => `"${value}"`).join(' ');
  return {
    command: comspec,
    args: ['/d', '/s', '/v:off', '/c', `"${quotedCommand}"`],
    windowsVerbatimArguments: true,
  };
}

function resolveWindowsBatchCommand(command, cwd, environment) {
  const candidates = [path.resolve(cwd, command)];
  const searchPath = environmentValue(environment, 'PATH') || '';
  for (const entry of searchPath.split(path.delimiter)) {
    const directory = entry.replace(/^"|"$/g, '').trim();
    if (directory) candidates.push(path.resolve(cwd, directory, command));
  }
  const resolved = candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!resolved) throw new Error(`Unable to resolve Windows batch command ${command}.`);
  return resolved;
}

function environmentValue(environment, wantedName) {
  const entry = Object.entries(environment).find(([name]) => name.toUpperCase() === wantedName);
  return entry?.[1];
}

function capture(stream, channel, onLog) {
  if (!stream) return () => {};
  let buffer = ''; stream.setEncoding('utf8');
  stream.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; lines.forEach(line => onLog(channel, line)); });
  return () => { if (buffer) onLog(channel, buffer); buffer = ''; };
}
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return undefined;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 2_000);
  timer.unref();
  return timer;
}
function abortError() { const e = new Error('Job cancelled.'); e.name = 'AbortError'; return e; }
