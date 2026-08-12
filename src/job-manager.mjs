import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collectArtifacts, publicArtifacts, writeBuildSummary } from './artifacts.mjs';
import { runProcessStep } from './process-runner.mjs';
import { assertPresetSupportsSource, getPreset, resolvePresetSteps } from './presets.mjs';
import { normalizeGitHubRepository, validateGitRef, validateLabel } from './security.mjs';
const FINAL = new Set(['succeeded','failed','cancelled']);
export class JobManager {
  constructor(config) { this.config = config; this.jobs = new Map(); this.queue = []; this.activeCount = 0; this.stopped = false; }
  createJob(input = {}) {
    if (this.stopped) throw new Error('Runner is shutting down.');
    const sourceType = input.sourceType === 'github' ? 'github' : input.sourceType === 'demo' ? 'demo' : null;
    if (!sourceType) throw new Error('sourceType must be either demo or github.');
    const preset = getPreset(String(input.presetId || '')); assertPresetSupportsSource(preset, sourceType);
    const job = { id: crypto.randomUUID(), label: validateLabel(input.label), sourceType, repository: sourceType === 'github' ? normalizeGitHubRepository(input.repository) : null, ref: sourceType === 'github' ? validateGitRef(input.ref) : null, presetId: preset.id, presetName: preset.name, status: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, exitCode: null, error: null, currentStep: null, workspace: null, sourceDir: null, logs: [], artifacts: [], eventSequence: 0, events: new EventEmitter(), controller: new AbortController() };
    this.jobs.set(job.id, job); this.queue.push(job.id); this.emit(job, { type: 'status', status: 'queued' }); this.pump(); return this.publicJob(job);
  }
  listJobs() { return [...this.jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(j => this.publicJob(j)); }
  getJob(id) { const j = this.jobs.get(id); return j ? this.publicJob(j) : null; }
  getArtifact(id, artifactId) { return this.jobs.get(id)?.artifacts.find(a => a.id === String(artifactId)) || null; }
  subscribe(id, listener) { const j = this.jobs.get(id); if (!j) return null; j.events.on('event', listener); return () => j.events.off('event', listener); }
  cancelJob(id) { const j = this.jobs.get(id); if (!j) return null; if (FINAL.has(j.status)) return this.publicJob(j); j.controller.abort(); if (j.status === 'queued') { j.error = 'Cancelled before execution.'; j.finishedAt = new Date().toISOString(); this.setStatus(j, 'cancelled'); } return this.publicJob(j); }
  shutdown() { this.stopped = true; for (const j of this.jobs.values()) if (!FINAL.has(j.status)) j.controller.abort(); }
  async pump() {
    if (this.stopped) return;
    while (this.activeCount < this.config.maxConcurrentJobs && this.queue.length) {
      const id = this.queue.shift(); const j = this.jobs.get(id); if (!j || j.status !== 'queued') continue;
      this.activeCount++; this.runJob(j).catch(e => this.addLog(j, 'system', `Internal runner error: ${e.stack || e.message}`)).finally(() => { this.activeCount--; this.pump(); });
    }
  }
  async runJob(job) {
    const preset = getPreset(job.presetId); const workspace = path.join(this.config.dataDir, 'jobs', job.id); const sourceDir = path.join(workspace, 'source');
    job.workspace = workspace; job.sourceDir = sourceDir; job.startedAt = new Date().toISOString(); this.setStatus(job, 'preparing');
    let finalStatus = 'failed';
    try {
      await fs.mkdir(workspace, { recursive: true });
      if (job.sourceType === 'demo') { this.addLog(job, 'system', 'Copying the bundled hello-web project into an isolated job workspace.'); await fs.cp(path.join(this.config.examplesDir, 'hello-web'), sourceDir, { recursive: true }); }
      else await runProcessStep({ step: { name: 'Clone repository', command: 'git', args: ['clone','--depth','1','--single-branch','--branch',job.ref,job.repository,sourceDir] }, cwd: workspace, timeoutMs: this.config.stepTimeoutMs, signal: job.controller.signal, onLog: (c,m) => this.addLog(job,c,m) });
      if (job.controller.signal.aborted) throw abortError();
      this.setStatus(job, 'running');
      for (const step of resolvePresetSteps(preset, sourceDir)) { job.currentStep = step.name; this.emit(job, { type: 'step', currentStep: step.name }); this.addLog(job, 'system', `Starting: ${step.name}`); await runProcessStep({ step, cwd: sourceDir, timeoutMs: this.config.stepTimeoutMs, signal: job.controller.signal, onLog: (c,m) => this.addLog(job,c,m) }); this.addLog(job, 'system', `Completed: ${step.name}`); }
      job.exitCode = 0; finalStatus = 'succeeded';
    } catch (e) {
      if (e?.name === 'AbortError' || job.controller.signal.aborted) { job.error = 'Job cancelled.'; this.addLog(job, 'system', job.error); finalStatus = 'cancelled'; }
      else { job.exitCode = 1; job.error = e?.message || String(e); this.addLog(job, 'stderr', job.error); finalStatus = 'failed'; }
    }
    job.currentStep = null; job.finishedAt = new Date().toISOString();
    try { await writeBuildSummary(job, sourceDir, finalStatus); job.artifacts = await collectArtifacts({ sourceDir, preset, maxFiles: this.config.maxArtifactFiles, maxBytes: this.config.maxArtifactBytes }); this.emit(job, { type: 'artifacts', artifacts: publicArtifacts(job.artifacts) }); } catch (e) { this.addLog(job, 'stderr', `Artifact collection failed: ${e.message}`); }
    this.setStatus(job, finalStatus); this.emit(job, { type: 'complete', job: this.publicJob(job) });
  }
  addLog(job, channel, message) { const entry = { sequence: ++job.eventSequence, timestamp: new Date().toISOString(), channel, message: String(message ?? '').replace(/\u0000/g,'') }; if (!entry.message && channel !== 'system') return; job.logs.push(entry); if (job.logs.length > this.config.maxLogLines) job.logs.splice(0, job.logs.length - this.config.maxLogLines); this.emit(job, { type: 'log', log: entry }); }
  setStatus(job, status) { job.status = status; this.emit(job, { type: 'status', status, job: this.publicJob(job) }); }
  emit(job, event) { job.events.emit('event', event); }
  publicJob(j) { return { id:j.id,label:j.label,sourceType:j.sourceType,repository:j.repository,ref:j.ref,presetId:j.presetId,presetName:j.presetName,status:j.status,createdAt:j.createdAt,startedAt:j.startedAt,finishedAt:j.finishedAt,exitCode:j.exitCode,error:j.error,currentStep:j.currentStep,logs:[...j.logs],artifacts:publicArtifacts(j.artifacts) }; }
}
function abortError() { const e = new Error('Job cancelled.'); e.name = 'AbortError'; return e; }
