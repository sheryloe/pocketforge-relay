import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GITHUB_API_VERSION, GitHubActionsClient, GitHubActionsError } from '../src/github-actions-client.mjs';

const token = 'github_pat_test_secret_that_must_not_leak';
const target = {
  owner: 'example',
  repo: 'mobile-app',
  workflow: 'pocketforge-android.yml',
  ref: 'main',
  inputs: { variant: 'debug' },
};

test('dispatches one allowlisted workflow with the pinned 2026 API contract', async () => {
  const calls = [];
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        workflow_run_id: 123,
        run_url: 'https://api.github.com/repos/example/mobile-app/actions/runs/123',
        html_url: 'https://github.com/example/mobile-app/actions/runs/123',
      });
    },
  });
  const result = await client.dispatchWorkflow({ target, requestId: 'job-123' });
  assert.equal(result.runId, 123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/example/mobile-app/actions/workflows/pocketforge-android.yml/dispatches');
  assert.equal(calls[0].init.method, 'POST');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
  assert.equal(headers.get('x-github-api-version'), GITHUB_API_VERSION);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ref: 'main',
    inputs: { variant: 'debug', pocketforge_request_id: 'job-123' },
  });
  assert.equal(JSON.stringify(client), '{}');
});

test('never retries an ambiguous dispatch and does not leak its token', async () => {
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async () => {
      calls += 1;
      throw new Error(`transport failed ${token}`);
    },
  });
  await assert.rejects(
    client.dispatchWorkflow({ target, requestId: 'job-unknown' }),
    error => {
      assert.ok(error instanceof GitHubActionsError);
      assert.equal(error.code, 'dispatch_unknown');
      assert.equal(error.message.includes(token), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('retries only bounded GET failures and normalizes a workflow run', async () => {
  let calls = 0;
  const waits = [];
  const client = new GitHubActionsClient({
    token,
    sleep: async milliseconds => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 503 });
      return jsonResponse({
        id: 123,
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://github.com/example/mobile-app/actions/runs/123',
        run_attempt: 1,
        head_branch: 'main',
        head_sha: 'a'.repeat(40),
        workflow_id: 456,
        repository: { full_name: 'example/mobile-app' },
      }, { ETag: '"run-1"', 'X-Poll-Interval': '7' });
    },
  });
  const result = await client.getWorkflowRun({ owner: 'example', repo: 'mobile-app', runId: 123 });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.run.status, 'in_progress');
  assert.equal(result.etag, '"run-1"');
  assert.equal(result.pollIntervalMs, 7000);
});

test('strips authorization from temporary download URLs and writes a bounded ZIP', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-download-'));
  const destination = path.join(directory, 'artifact.zip');
  const body = Buffer.from('bounded zip body');
  const calls = [];
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: new Headers(init.headers) });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { Location: 'https://objects.example.test/signed-download' } });
      }
      return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } });
    },
  });
  try {
    const result = await client.downloadArtifact({ owner: 'example', repo: 'mobile-app', artifactId: 44, destination, maxBytes: 1024 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.get('authorization'), `Bearer ${token}`);
    assert.equal(calls[1].headers.get('authorization'), null);
    assert.equal(calls[1].headers.get('x-github-api-version'), null);
    assert.equal(result.size, body.length);
    assert.equal(result.sha256, crypto.createHash('sha256').update(body).digest('hex'));
    assert.deepEqual(await fs.readFile(destination), body);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('does not expose a signed temporary URL when its download transport fails', async () => {
  const signedUrl = 'https://objects.example.test/download?signature=temporary-secret';
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async url => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { Location: signedUrl } });
      throw new Error(`transport failed for ${url}`);
    },
  });
  await assert.rejects(
    client.downloadArtifact({ owner: 'example', repo: 'mobile-app', artifactId: 44, destination: path.resolve(os.tmpdir(), 'unused-artifact.zip'), maxBytes: 1024 }),
    error => {
      assert.ok(error instanceof GitHubActionsError);
      assert.equal(error.code, 'download_failed');
      assert.equal(error.message.includes('temporary-secret'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('preserves an existing destination when exclusive download creation fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-existing-'));
  const destination = path.join(directory, 'artifact.zip');
  const existing = Buffer.from('existing evidence');
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { Location: 'https://objects.example.test/existing' } });
      return new Response(Buffer.from('replacement'), { status: 200 });
    },
  });
  try {
    await fs.writeFile(destination, existing);
    await assert.rejects(
      client.downloadArtifact({ owner: 'example', repo: 'mobile-app', artifactId: 44, destination, maxBytes: 1024 }),
      error => error instanceof GitHubActionsError && error.code === 'download_failed',
    );
    assert.deepEqual(await fs.readFile(destination), existing);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('deletes a partial file when streamed download bytes exceed the limit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-limit-'));
  const destination = path.join(directory, 'too-large.zip');
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { Location: 'https://objects.example.test/large' } });
      return new Response(Buffer.alloc(2048), { status: 200 });
    },
  });
  try {
    await assert.rejects(
      client.downloadRunLogs({ owner: 'example', repo: 'mobile-app', runId: 123, destination, maxBytes: 1024 }),
      error => error instanceof GitHubActionsError && error.code === 'download_limit',
    );
    await assert.rejects(fs.stat(destination), error => error.code === 'ENOENT');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('deletes a truncated file when the stream is shorter than Content-Length', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-actions-truncated-'));
  const destination = path.join(directory, 'truncated.zip');
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { Location: 'https://objects.example.test/truncated' } });
      return new Response(Buffer.from('short'), { status: 200, headers: { 'Content-Length': '10' } });
    },
  });
  try {
    await assert.rejects(
      client.downloadArtifact({ owner: 'example', repo: 'mobile-app', artifactId: 44, destination, maxBytes: 1024 }),
      error => error instanceof GitHubActionsError && error.code === 'download_failed',
    );
    await assert.rejects(fs.stat(destination), error => error.code === 'ENOENT');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('does not retry an ambiguous cancellation', async () => {
  let calls = 0;
  const client = new GitHubActionsClient({
    token,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('connection lost');
    },
  });
  await assert.rejects(
    client.cancelWorkflowRun({ owner: 'example', repo: 'mobile-app', runId: 123 }),
    error => error instanceof GitHubActionsError && error.code === 'cancel_unknown',
  );
  assert.equal(calls, 1);
});

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
