import { spawn } from 'node:child_process';
export function runProcessStep({ step, cwd, timeoutMs, signal, onLog }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    onLog('system', `$ ${[step.command, ...step.args].map(v => /\s/.test(v) ? JSON.stringify(v) : v).join(' ')}`);
    let settled = false;
    const child = spawn(step.command, step.args, { cwd, env: { ...process.env, CI: process.env.CI || 'true', FORCE_COLOR: '0' }, shell: false, windowsHide: true });
    const flushers = [capture(child.stdout, 'stdout', onLog), capture(child.stderr, 'stderr', onLog)];
    const timeout = setTimeout(() => { onLog('system', `Step exceeded ${timeoutMs} ms and was terminated.`); terminate(child); }, timeoutMs);
    const onAbort = () => { onLog('system', 'Cancellation requested. Terminating the active process.'); terminate(child); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); fn(); };
    child.on('error', e => finish(() => reject(new Error(`Unable to start ${step.command}: ${e.message}`))));
    child.on('close', (code, sig) => { flushers.forEach(f => f()); finish(() => signal?.aborted ? reject(abortError()) : code === 0 ? resolve({ code: 0, signal: sig }) : reject(new Error(`${step.name} failed with ${code == null ? `signal ${sig}` : `exit code ${code}`}.`))); });
  });
}
function capture(stream, channel, onLog) {
  if (!stream) return () => {};
  let buffer = ''; stream.setEncoding('utf8');
  stream.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; lines.forEach(line => onLog(channel, line)); });
  return () => { if (buffer) onLog(channel, buffer); buffer = ''; };
}
function terminate(child) { if (child.killed) return; child.kill('SIGTERM'); setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2_000).unref(); }
function abortError() { const e = new Error('Job cancelled.'); e.name = 'AbortError'; return e; }
