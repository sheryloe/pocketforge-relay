import { LOCALES, SUPPORTED_LOCALES } from './locales.js';

const LOCALE_STORAGE_KEY = 'pocketforge.locale';
const LOCAL_TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const ACTION_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention']);
const DEVICE_TERMINAL = new Set(['succeeded', 'failed', 'expired']);
const KNOWN_STATUSES = new Set([
  'neutral',
  'idle',
  'connect_first',
  'ready',
  'disabled',
  'unavailable',
  'queued',
  'dispatching',
  'preparing',
  'requested',
  'waiting',
  'pending',
  'running',
  'in_progress',
  'completed',
  'succeeded',
  'failed',
  'cancelled',
  'needs_attention',
  'awaiting_approval',
  'expired',
  'validating_artifact',
  'installing',
  'launching',
  'collecting_evidence',
  'deleted',
]);

const state = {
  locale: initialLocale(),
  token: sessionStorage.getItem('pocketforge.token') || '',
  sourceType: 'demo',
  presets: [],
  jobs: [],
  active: null,
  controller: null,
  device: {
    available: false,
    enabled: false,
    devices: [],
    actions: [],
    active: null,
    approval: null,
    refreshTimer: null,
    refreshing: false,
    deletedEvidence: new Set(),
  },
  actions: {
    available: false,
    enabled: false,
    targets: [],
    runs: [],
    active: null,
    approval: null,
    refreshTimer: null,
    refreshing: false,
  },
  agent: { available: false, enabled: false, preview: null, result: null, refreshing: false },
};

const messageRegistry = new Map();

const $ = selector => document.querySelector(selector);
const E = {
  language: $('#languageSelect'),
  server: $('#serverStatus'),
  token: $('#tokenInput'),
  connect: $('#connectButton'),
  connection: $('#connectionMessage'),
  segments: [...document.querySelectorAll('.segment')],
  form: $('#jobForm'),
  label: $('#labelInput'),
  github: $('#githubFields'),
  repo: $('#repositoryInput'),
  ref: $('#refInput'),
  preset: $('#presetSelect'),
  presetDescription: $('#presetDescription'),
  launch: $('#launchButton'),
  launchMessage: $('#launchMessage'),
  refresh: $('#refreshButton'),
  empty: $('#jobsEmpty'),
  jobs: $('#jobsList'),
  title: $('#activeJobTitle'),
  status: $('#activeJobStatus'),
  cancel: $('#cancelButton'),
  meta: $('#jobMeta'),
  console: $('#logConsole'),
  count: $('#artifactCount'),
  artifacts: $('#artifactsList'),
  jobDelete: $('#jobDeleteButton'),
  jobDeleteConfirm: $('#jobDeleteConfirm'),
  jobDeleteConfirmButton: $('#jobDeleteConfirmButton'),
  jobDeleteCancel: $('#jobDeleteCancelButton'),
  deviceState: $('#deviceState'),
  deviceForm: $('#deviceForm'),
  deviceJob: $('#deviceJobSelect'),
  deviceArtifact: $('#deviceArtifactSelect'),
  deviceSelect: $('#deviceSelect'),
  deviceRefresh: $('#deviceRefreshButton'),
  devicePrepare: $('#devicePrepareButton'),
  deviceMessage: $('#deviceMessage'),
  deviceApproval: $('#deviceApprovalPreview'),
  deviceReviewRepository: $('#deviceReviewRepository'),
  deviceReviewCommit: $('#deviceReviewCommit'),
  deviceReviewArtifact: $('#deviceReviewArtifact'),
  deviceReviewSha: $('#deviceReviewSha'),
  deviceReviewPackage: $('#deviceReviewPackage'),
  deviceReviewVersion: $('#deviceReviewVersion'),
  deviceReviewSignature: $('#deviceReviewSignature'),
  deviceReviewSigner: $('#deviceReviewSigner'),
  deviceReviewModel: $('#deviceReviewModel'),
  deviceReviewExpires: $('#deviceReviewExpires'),
  deviceConsent: $('#deviceConsent'),
  deviceApprove: $('#deviceApproveButton'),
  deviceDiscard: $('#deviceDiscardButton'),
  deviceActionsRefresh: $('#deviceActionsRefreshButton'),
  deviceActionsEmpty: $('#deviceActionsEmpty'),
  deviceActions: $('#deviceActionsList'),
  deviceActionDetail: $('#deviceActionDetail'),
  deviceActionTitle: $('#activeDeviceActionTitle'),
  deviceActionStatus: $('#activeDeviceActionStatus'),
  deviceActionMeta: $('#deviceActionMeta'),
  deviceActionError: $('#deviceActionError'),
  deviceEvidenceState: $('#deviceEvidenceState'),
  deviceEvidenceList: $('#deviceEvidenceList'),
  deviceDelete: $('#deviceDeleteButton'),
  deviceDeleteConfirm: $('#deviceDeleteConfirm'),
  deviceDeleteConfirmButton: $('#deviceDeleteConfirmButton'),
  deviceDeleteCancel: $('#deviceDeleteCancelButton'),
  actionState: $('#actionsState'),
  actionForm: $('#actionForm'),
  actionTarget: $('#actionTargetSelect'),
  actionRef: $('#actionRefSelect'),
  actionLabel: $('#actionLabelInput'),
  actionReview: $('#actionReviewButton'),
  actionMessage: $('#actionMessage'),
  actionApproval: $('#actionApprovalPreview'),
  approvalTarget: $('#approvalTarget'),
  approvalRepository: $('#approvalRepository'),
  approvalWorkflow: $('#approvalWorkflow'),
  approvalRef: $('#approvalRef'),
  approvalInputs: $('#approvalInputs'),
  approvalArtifacts: $('#approvalArtifacts'),
  approvalExpires: $('#approvalExpires'),
  actionApprove: $('#actionApproveButton'),
  actionDiscard: $('#actionDiscardButton'),
  actionRefresh: $('#actionRefreshButton'),
  actionRunsEmpty: $('#actionRunsEmpty'),
  actionRuns: $('#actionRunsList'),
  actionRunDetail: $('#actionRunDetail'),
  actionTitle: $('#activeActionTitle'),
  actionStatus: $('#activeActionStatus'),
  actionCancel: $('#actionCancelButton'),
  actionUrl: $('#activeActionUrl'),
  actionMeta: $('#actionRunMeta'),
  actionConsole: $('#actionLogConsole'),
  actionCount: $('#actionArtifactCount'),
  actionArtifacts: $('#actionArtifactsList'),
  actionDelete: $('#actionDeleteButton'), actionDeleteConfirm: $('#actionDeleteConfirm'), actionDeleteConfirmButton: $('#actionDeleteConfirmButton'), actionDeleteCancel: $('#actionDeleteCancelButton'),
  agentState: $('#agentState'), agentForm: $('#agentForm'), agentSource: $('#agentSourceSelect'), agentIntent: $('#agentIntentSelect'),
  agentReview: $('#agentReviewButton'), agentMessage: $('#agentMessage'), agentPreview: $('#agentPreview'), agentEvidence: $('#agentEvidence'),
  agentConsent: $('#agentConsent'), agentApprove: $('#agentApproveButton'), agentDiscard: $('#agentDiscardButton'), agentResult: $('#agentResult'),
  agentSummary: $('#agentSummary'), agentDiagnosis: $('#agentDiagnosis'), agentSteps: $('#agentSteps'), agentRisks: $('#agentRisks'), agentVerification: $('#agentVerification'),
};

boot();

async function boot() {
  E.language.value = state.locale;
  E.token.value = state.token;
  bind();
  applyLocale();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('Relay unavailable');
    E.server.dataset.state = 'online';
    E.server.querySelector('span').dataset.i18n = 'server.online';
    E.server.querySelector('span').textContent = t('server.online');
  } catch {
    E.server.dataset.state = 'offline';
    E.server.querySelector('span').dataset.i18n = 'server.offline';
    E.server.querySelector('span').textContent = t('server.offline');
  }

  if (state.token) await connect();
}

function bind() {
  E.language.onchange = () => changeLocale(E.language.value);
  E.connect.onclick = connect;
  E.token.onkeydown = event => {
    if (event.key === 'Enter') connect();
  };
  E.segments.forEach(button => {
    button.onclick = () => source(button.dataset.source);
  });
  E.preset.onchange = describe;
  E.form.onsubmit = launch;
  E.refresh.onclick = refresh;
  E.cancel.onclick = cancel;
  E.jobDelete.onclick = () => {
    E.jobDeleteConfirm.hidden = false;
    E.jobDelete.setAttribute('aria-expanded', 'true');
    E.jobDeleteConfirmButton.focus({ preventScroll: true });
  };
  E.jobDeleteCancel.onclick = () => { E.jobDeleteConfirm.hidden = true; E.jobDelete.setAttribute('aria-expanded', 'false'); E.jobDelete.focus({ preventScroll: true }); };
  E.jobDeleteConfirmButton.onclick = deleteJob;

  E.deviceJob.onchange = () => {
    discardDeviceApproval();
    populateDeviceArtifacts();
    refreshDeviceActions({ selectFirst: true });
  };
  E.deviceArtifact.onchange = () => discardDeviceApproval();
  E.deviceSelect.onchange = () => discardDeviceApproval();
  E.deviceRefresh.onclick = () => loadDevices({ announce: true });
  E.deviceForm.onsubmit = prepareDeviceAction;
  E.deviceConsent.onchange = updateDeviceControls;
  E.deviceApprove.onclick = approveDeviceAction;
  E.deviceDiscard.onclick = discardPreparedDeviceApproval;
  E.deviceActionsRefresh.onclick = () => refreshDeviceActions();
  E.deviceDelete.onclick = () => {
    E.deviceDeleteConfirm.hidden = false;
    E.deviceDelete.setAttribute('aria-expanded', 'true');
    E.deviceDeleteConfirmButton.focus({ preventScroll: true });
  };
  E.deviceDeleteCancel.onclick = () => { E.deviceDeleteConfirm.hidden = true; E.deviceDelete.setAttribute('aria-expanded', 'false'); E.deviceDelete.focus({ preventScroll: true }); };
  E.deviceDeleteConfirmButton.onclick = deleteDeviceEvidence;

  E.actionTarget.onchange = () => {
    invalidateActionApproval('message.actionsSelectionChanged');
    populateActionRefs();
  };
  E.actionRef.onchange = () => invalidateActionApproval('message.actionsSelectionChanged');
  E.actionLabel.oninput = () => invalidateActionApproval('message.actionsLabelChanged');
  E.actionForm.onsubmit = reviewAction;
  E.actionApprove.onclick = approveAction;
  E.actionDiscard.onclick = () => discardActionApproval('message.actionsReviewDiscarded');
  E.actionRefresh.onclick = () => refreshActionRuns();
  E.actionCancel.onclick = cancelActionRun;
  E.actionDelete.onclick = () => { E.actionDeleteConfirm.hidden = false; E.actionDelete.setAttribute('aria-expanded', 'true'); E.actionDeleteConfirmButton.focus({ preventScroll: true }); };
  E.actionDeleteCancel.onclick = () => { E.actionDeleteConfirm.hidden = true; E.actionDelete.setAttribute('aria-expanded', 'false'); E.actionDelete.focus({ preventScroll: true }); };
  E.actionDeleteConfirmButton.onclick = deleteActionRun;
  E.agentSource.onchange = discardAgentPreview;
  E.agentIntent.onchange = discardAgentPreview;
  E.agentForm.onsubmit = reviewAgentEvidence;
  E.agentConsent.onchange = updateAgentControls;
  E.agentApprove.onclick = approveAgentProposal;
  E.agentDiscard.onclick = discardAgentPreview;
}

async function connect() {
  const token = E.token.value.trim();
  if (!token) return msgKey(E.connection, 'message.tokenRequired', 'error');
  state.token = token;
  E.connect.disabled = true;

  try {
    const [presetPayload, jobsPayload, historyPayload] = await Promise.all([api('/api/presets'), api('/api/jobs'), api('/api/job-history')]);
    sessionStorage.setItem('pocketforge.token', token);
    state.presets = presetPayload.presets;
    state.jobs = mergeJobs(jobsPayload.jobs, historyPayload.jobs);
    E.launch.disabled = false;
    options();
    renderJobs();
    msgKey(E.connection, 'message.connected', 'success');
    await Promise.all([loadActions(), loadDevices()]);
    await loadAgent();
    if (state.jobs[0] && !state.active) await select(state.jobs[0].id);
  } catch (error) {
    E.launch.disabled = true;
    sessionStorage.removeItem('pocketforge.token');
    state.token = '';
    resetActions('connect_first', 'message.connectForActions');
    resetDevices('connect_first', 'message.deviceConnect');
    resetAgent('connect_first', 'message.connectForAgent');
    msgRaw(E.connection, error.message, 'error');
  } finally {
    E.connect.disabled = false;
  }
}

function source(type) {
  state.sourceType = type;
  E.segments.forEach(button => button.classList.toggle('active', button.dataset.source === type));
  E.github.hidden = type !== 'github';
  options();
}

function options() {
  const selected = state.presets.filter(preset => preset.sourceTypes.includes(state.sourceType));
  E.preset.replaceChildren(...selected.map(preset => option(preset.id, presetText(preset, 'name'))));
  describe();
}

function describe() {
  E.presetDescription.removeAttribute('data-i18n');
  const preset = state.presets.find(candidate => candidate.id === E.preset.value);
  E.presetDescription.textContent = preset ? presetText(preset, 'description') : t('message.noPreset');
}

async function launch(event) {
  event.preventDefault();
  const body = { sourceType: state.sourceType, presetId: E.preset.value, label: E.label.value };
  if (state.sourceType === 'github') {
    body.repository = E.repo.value;
    body.ref = E.ref.value;
  }
  E.launch.disabled = true;
  msgKey(E.launchMessage, 'message.submittingJob');
  try {
    const payload = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    E.label.value = '';
    msgKey(E.launchMessage, 'message.jobQueued', 'success', { id: short(payload.job.id) });
    await refresh();
    await select(payload.job.id);
  } catch (error) {
    msgRaw(E.launchMessage, error.message, 'error');
  } finally {
    E.launch.disabled = false;
  }
}

async function refresh() {
  if (!state.token) return;
  const [live, history] = await Promise.all([api('/api/jobs'), api('/api/job-history')]);
  state.jobs = mergeJobs(live.jobs, history.jobs);
  renderJobs();
  populateDeviceJobs();
  populateAgentSources();
}

function mergeJobs(liveJobs = [], durableJobs = []) {
  const byId = new Map(durableJobs.map(job => [job.id, job]));
  liveJobs.forEach(job => byId.set(job.id, job));
  return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function renderJobs() {
  E.jobs.replaceChildren();
  E.empty.hidden = state.jobs.length > 0;
  state.jobs.forEach(job => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `job-card${state.active?.id === job.id ? ' active' : ''}`;
    button.onclick = () => select(job.id);

    const top = document.createElement('div');
    top.className = 'job-top';
    const title = document.createElement('strong');
    title.textContent = job.label || presetText({ id: job.presetId, name: job.presetName }, 'name');
    top.append(title, badge(job.status));

    const repository = document.createElement('code');
    repository.textContent = job.repository ? repositoryName(job.repository) : 'bundled://hello-web';
    const bottom = document.createElement('div');
    bottom.className = 'job-bottom';
    const preset = document.createElement('small');
    preset.textContent = job.presetId;
    const created = document.createElement('small');
    created.textContent = displayTime(job.createdAt);
    bottom.append(preset, created);
    button.append(top, repository, bottom);
    E.jobs.append(button);
  });
}

async function select(id) {
  const listed = state.jobs.find(job => job.id === id);
  const endpoint = listed?.recovered ? 'projection' : '';
  state.active = (await api(`/api/jobs/${encodeURIComponent(id)}${endpoint ? `/${endpoint}` : ''}`)).job;
  render();
  renderJobs();
  if (!state.active.recovered && !LOCAL_TERMINAL.has(state.active.status)) stream(id);
}

function render() {
  const job = state.active;
  if (!job) return;
  E.title.removeAttribute('data-i18n');
  E.title.textContent = job.label || `${presetText({ id: job.presetId, name: job.presetName }, 'name')} · ${short(job.id)}`;
  setBadge(E.status, job.status);
  E.cancel.hidden = LOCAL_TERMINAL.has(job.status);
  E.jobDelete.hidden = !LOCAL_TERMINAL.has(job.status);
  E.jobDeleteConfirm.hidden = true;
  E.jobDelete.setAttribute('aria-expanded', 'false');
  renderMeta(E.meta, [
    `job=${short(job.id)}`,
    `source=${job.sourceType}`,
    `preset=${job.presetId}`,
    job.ref ? `ref=${job.ref}` : null,
    job.currentStep ? `step=${job.currentStep}` : null,
  ]);
  renderLogs(E.console, job.logs || [], t('message.jobWaiting'));
  renderArtifacts(E.artifacts, E.count, job.artifacts || [], artifact => download(job.id, artifact), 'message.artifactsAfterRun');
}

function logLine(entry) {
  const row = document.createElement('div');
  row.className = 'log';
  row.dataset.channel = entry.channel || 'system';
  const time = document.createElement('time');
  time.textContent = displayTime(entry.timestamp);
  const channel = document.createElement('b');
  channel.textContent = entry.channel || 'system';
  const text = document.createElement('span');
  text.textContent = entry.message || ' ';
  row.append(time, channel, text);
  return row;
}

function renderLogs(container, items, emptyText) {
  container.replaceChildren();
  if (!items.length) {
    const paragraph = document.createElement('p');
    paragraph.textContent = emptyText;
    container.append(paragraph);
    return;
  }
  items.forEach(entry => container.append(logLine(entry)));
  container.scrollTop = container.scrollHeight;
}

function renderArtifacts(container, count, items, onDownload, emptyKey = 'message.artifactsAfterRun') {
  count.textContent = t(items.length === 1 ? 'files.one' : 'files.many', { count: items.length });
  container.replaceChildren();
  if (!items.length) {
    const paragraph = document.createElement('p');
    paragraph.textContent = t(emptyKey);
    container.append(paragraph);
    return;
  }

  items.forEach(artifact => {
    const row = document.createElement('div');
    row.className = 'artifact';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = artifact.name;
    const summary = document.createElement('small');
    summary.textContent = `${artifact.relativePath || artifact.name} · ${bytes(artifact.size)}`;
    details.append(name, summary);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('common.download');
    button.onclick = () => onDownload(artifact);
    row.append(details, button);
    container.append(row);
  });
}

async function download(id, artifact) {
  try {
    await downloadBlob(`/api/jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact.id)}`, artifact.name);
  } catch (error) {
    msgRaw(E.launchMessage, error.message, 'error');
  }
}

async function cancel() {
  if (!state.active) return;
  E.cancel.disabled = true;
  try {
    state.active = (await api(`/api/jobs/${encodeURIComponent(state.active.id)}/cancel`, { method: 'POST' })).job;
    render();
    await refresh();
  } catch (error) {
    msgRaw(E.launchMessage, error.message, 'error');
  } finally {
    E.cancel.disabled = false;
  }
}

async function deleteJob() {
  const job = state.active;
  if (!job || !LOCAL_TERMINAL.has(job.status)) return;
  E.jobDeleteConfirmButton.disabled = true;
  try {
    await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE', body: JSON.stringify({ decision: 'delete' }) });
    state.controller?.abort();
    state.active = null;
    state.jobs = state.jobs.filter(candidate => candidate.id !== job.id);
    clearSelectedJob();
    renderJobs();
    populateDeviceJobs();
    msgKey(E.launchMessage, 'message.jobDeleted', 'success');
  } catch (error) {
    msgRaw(E.launchMessage, error.message, 'error');
  } finally {
    E.jobDeleteConfirmButton.disabled = false;
  }
}

function clearSelectedJob() {
  E.title.dataset.i18n = 'local.select';
  E.title.textContent = t('local.select');
  setBadge(E.status, 'idle');
  E.cancel.hidden = true;
  E.jobDelete.hidden = true;
  E.jobDeleteConfirm.hidden = true;
  E.jobDelete.setAttribute('aria-expanded', 'false');
  E.meta.replaceChildren();
  renderLogs(E.console, [], t('local.consoleEmpty'));
  renderArtifacts(E.artifacts, E.count, [], () => {}, 'message.artifactsAfterRun');
}

async function stream(id) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/events`, { headers: auth(), signal: controller.signal });
    if (!response.ok || !response.body) throw await responseError(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        handle(id, buffer.slice(0, boundary), controller);
        buffer = buffer.slice(boundary + 2);
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      setTimeout(() => {
        if (state.active?.id === id && !LOCAL_TERMINAL.has(state.active.status)) stream(id);
      }, 1500);
    }
  }
}

function handle(id, block, controller) {
  if (!block || block.startsWith(':')) return;
  let name = 'message';
  const data = [];
  block.split('\n').forEach(line => {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  });
  if (!data.length) return;

  let payload;
  try {
    payload = JSON.parse(data.join('\n'));
  } catch {
    return;
  }

  if (name === 'snapshot') {
    state.active = payload;
    render();
  } else if (name === 'log' && payload.log && state.active?.id === id) {
    state.active.logs.push(payload.log);
    E.console.querySelector('p')?.remove();
    E.console.append(logLine(payload.log));
    E.console.scrollTop = E.console.scrollHeight;
  } else if (name === 'status') {
    if (payload.job) state.active = payload.job;
    render();
    refresh();
  } else if (name === 'step') {
    state.active.currentStep = payload.currentStep;
    render();
  } else if (name === 'artifacts') {
    state.active.artifacts = payload.artifacts || [];
    renderArtifacts(E.artifacts, E.count, state.active.artifacts, artifact => download(id, artifact), 'message.artifactsAfterRun');
  } else if (name === 'complete') {
    state.active = payload.job;
    render();
    refresh();
    controller.abort();
  }
}

async function loadDevices({ announce = false } = {}) {
  if (!state.token || state.device.refreshing) return;
  state.device.refreshing = true;
  updateDeviceControls();
  if (announce) msgKey(E.deviceMessage, 'message.deviceRefreshing');
  let shouldLoadActions = false;
  try {
    const payload = await api('/api/devices');
    state.device.available = true;
    state.device.enabled = Boolean(payload.enabled);
    state.device.devices = Array.isArray(payload.devices) ? payload.devices : [];
    setBadge(E.deviceState, state.device.enabled ? 'ready' : 'disabled');
    populateDeviceJobs();
    populateDevices();
    if (!state.device.enabled) {
      msgKey(E.deviceMessage, 'message.deviceDisabled');
    } else if (!state.device.devices.length) {
      msgKey(E.deviceMessage, 'device.noDevices');
    } else {
      msgKey(E.deviceMessage, 'message.deviceReady');
    }
    shouldLoadActions = state.device.enabled;
  } catch (error) {
    resetDevices('unavailable');
    msgKey(E.deviceMessage, 'message.deviceActionsLoadFailed', 'error', { error: error.message });
  } finally {
    state.device.refreshing = false;
    updateDeviceControls();
  }
  if (shouldLoadActions) await refreshDeviceActions({ selectFirst: true, silent: true });
}

function resetDevices(status, messageKey = '', params = {}) {
  clearTimeout(state.device.refreshTimer);
  state.device.available = false;
  state.device.enabled = false;
  state.device.devices = [];
  state.device.actions = [];
  state.device.active = null;
  state.device.approval = null;
  state.device.refreshTimer = null;
  state.device.refreshing = false;
  E.deviceApproval.hidden = true;
  E.deviceConsent.checked = false;
  setBadge(E.deviceState, status);
  populateDeviceJobs();
  populateDevices();
  renderDeviceActions();
  renderDeviceAction();
  if (messageKey) msgKey(E.deviceMessage, messageKey, '', params);
}

function eligibleDeviceJobs() {
  return state.jobs
    .map(job => ({ ...job, apkArtifacts: (job.artifacts || []).filter(isApkArtifact) }))
    .filter(job => job.status === 'succeeded' && job.apkArtifacts.length > 0);
}

function isApkArtifact(artifact) {
  return artifact?.contentType === 'application/vnd.android.package-archive'
    && /\.apk$/i.test(artifact.name || artifact.relativePath || '');
}

function populateDeviceJobs() {
  const previous = E.deviceJob.value;
  const jobs = eligibleDeviceJobs();
  if (!jobs.length) {
    const message = state.token ? t('device.noEligibleJobs') : t('device.jobConnect');
    E.deviceJob.replaceChildren(option('', message));
    E.deviceJob.disabled = true;
  } else {
    E.deviceJob.replaceChildren(...jobs.map(job => option(job.id, job.label || presetText({ id: job.presetId, name: job.presetName }, 'name') || t('device.jobFallback'))));
    if (jobs.some(job => job.id === previous)) E.deviceJob.value = previous;
    E.deviceJob.disabled = !state.device.enabled;
  }
  populateDeviceArtifacts();
}

function populateDeviceArtifacts() {
  const previous = E.deviceArtifact.value;
  const job = selectedDeviceJob();
  const artifacts = job?.apkArtifacts || [];
  if (!artifacts.length) {
    E.deviceArtifact.replaceChildren(option('', job ? t('device.noApks') : t('device.artifactFirst')));
    E.deviceArtifact.disabled = true;
  } else {
    E.deviceArtifact.replaceChildren(...artifacts.map(artifact => option(artifact.id, `${artifact.name} · ${bytes(artifact.size)}`)));
    if (artifacts.some(artifact => artifact.id === previous)) E.deviceArtifact.value = previous;
    E.deviceArtifact.disabled = !state.device.enabled;
  }
  updateDeviceControls();
}

function populateDevices() {
  const previous = E.deviceSelect.value;
  if (!state.device.enabled || !state.device.devices.length) {
    const message = !state.device.available
      ? t('device.deviceConnect')
      : state.device.enabled ? t('device.noDevices') : t('message.deviceDisabled');
    E.deviceSelect.replaceChildren(option('', message));
    E.deviceSelect.disabled = true;
  } else {
    E.deviceSelect.replaceChildren(...state.device.devices.map(device => option(device.deviceId, device.model || t('device.modelFallback'))));
    if (state.device.devices.some(device => device.deviceId === previous)) E.deviceSelect.value = previous;
    E.deviceSelect.disabled = false;
  }
  updateDeviceControls();
}

function selectedDeviceJob() {
  return eligibleDeviceJobs().find(job => job.id === E.deviceJob.value) || null;
}

function selectedDeviceArtifact() {
  return selectedDeviceJob()?.apkArtifacts.find(artifact => artifact.id === E.deviceArtifact.value) || null;
}

function updateDeviceControls() {
  const hasApproval = Boolean(state.device.approval);
  const selectable = state.device.enabled
    && Boolean(selectedDeviceJob())
    && Boolean(selectedDeviceArtifact())
    && state.device.devices.some(device => device.deviceId === E.deviceSelect.value);
  E.deviceForm.setAttribute('aria-busy', String(state.device.refreshing));
  E.deviceActions.setAttribute('aria-busy', String(state.device.refreshing));
  E.deviceJob.disabled = !state.device.enabled || !eligibleDeviceJobs().length || hasApproval;
  E.deviceArtifact.disabled = !state.device.enabled || !selectedDeviceArtifact() || hasApproval;
  E.deviceSelect.disabled = !state.device.enabled || !state.device.devices.length || hasApproval;
  E.deviceRefresh.disabled = !state.token || state.device.refreshing || hasApproval;
  E.devicePrepare.disabled = !selectable || state.device.refreshing || hasApproval;
  E.deviceApprove.disabled = !hasApproval || !E.deviceConsent.checked || state.device.refreshing;
  E.deviceDiscard.disabled = !hasApproval || state.device.refreshing;
  E.deviceActionsRefresh.disabled = !state.device.enabled || state.device.refreshing;
}

function discardDeviceApproval(messageKey = '') {
  state.device.approval = null;
  E.deviceApproval.hidden = true;
  E.deviceConsent.checked = false;
  updateDeviceControls();
  if (messageKey) msgKey(E.deviceMessage, messageKey);
}

async function discardPreparedDeviceApproval() {
  const approval = state.device.approval;
  if (!approval?.actionId || state.device.refreshing) return;
  state.device.refreshing = true;
  updateDeviceControls();
  msgKey(E.deviceMessage, 'message.deviceDiscarding');
  try {
    const payload = await api(`/api/device-actions/${encodeURIComponent(approval.actionId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ decision: 'discard' }),
    });
    if (payload?.action?.actionId !== approval.actionId || payload.action.discarded !== true) {
      throw new Error(t('common.unknown'));
    }
    state.device.actions = state.device.actions.filter(action => action.id !== approval.actionId);
    if (state.device.active?.id === approval.actionId) state.device.active = null;
    discardDeviceApproval();
    renderDeviceActions();
    renderDeviceAction();
    msgKey(E.deviceMessage, 'message.deviceReviewDiscarded', 'success');
  } catch (error) {
    msgKey(E.deviceMessage, 'message.deviceDiscardFailed', 'error', { error: error.message });
  } finally {
    state.device.refreshing = false;
    updateDeviceControls();
  }
}

async function prepareDeviceAction(event) {
  event.preventDefault();
  const job = selectedDeviceJob();
  const artifact = selectedDeviceArtifact();
  const device = state.device.devices.find(candidate => candidate.deviceId === E.deviceSelect.value);
  if (!job || !artifact || !device) return msgKey(E.deviceMessage, 'message.deviceChoose', 'error');

  state.device.refreshing = true;
  updateDeviceControls();
  msgKey(E.deviceMessage, 'message.devicePreparing');
  try {
    const payload = await api('/api/device-actions/prepare', {
      method: 'POST',
      body: JSON.stringify({ jobId: job.id, artifactId: artifact.id, deviceId: device.deviceId }),
    });
    if (!payload?.action?.id || typeof payload.approvalToken !== 'string') throw new Error(t('message.deviceApprovalFailed', { error: t('common.unknown') }));
    state.device.approval = { actionId: payload.action.id, approvalToken: payload.approvalToken };
    state.device.active = payload.action;
    upsertDeviceAction(payload.action);
    E.deviceConsent.checked = false;
    renderDeviceApproval(payload.action);
    renderDeviceAction();
    renderDeviceActions();
    msgKey(E.deviceMessage, 'message.devicePrepared', 'success');
    E.deviceApproval.focus({ preventScroll: true });
  } catch (error) {
    discardDeviceApproval();
    msgRaw(E.deviceMessage, error.message, 'error');
  } finally {
    state.device.refreshing = false;
    updateDeviceControls();
  }
}

function renderDeviceApproval(action) {
  if (!state.device.approval || state.device.approval.actionId !== action?.id) {
    E.deviceApproval.hidden = true;
    return;
  }
  const artifact = action.artifact || {};
  E.deviceReviewRepository.textContent = action.source?.repository || t('device.notRecorded');
  E.deviceReviewCommit.textContent = action.source?.resolvedCommit || t('device.notRecorded');
  E.deviceReviewArtifact.textContent = `${artifact.relativePath || t('common.unknown')} · ${bytes(artifact.size)}`;
  E.deviceReviewSha.textContent = artifact.sha256 || t('device.notRecorded');
  E.deviceReviewPackage.textContent = artifact.applicationId || t('device.notRecorded');
  E.deviceReviewVersion.textContent = t('device.versionValue', {
    name: artifact.versionName ?? t('device.notRecorded'),
    code: artifact.versionCode ?? t('device.notRecorded'),
  });
  E.deviceReviewSignature.textContent = t(artifact.signatureVerified ? 'device.signatureVerified' : 'device.signatureUnverified');
  E.deviceReviewSigner.textContent = artifact.signerSha256 || t('device.notRecorded');
  E.deviceReviewModel.textContent = action.device?.model || t('device.modelFallback');
  E.deviceReviewExpires.textContent = displayDateTime(action.expiresAt);
  E.deviceApproval.hidden = false;
}

async function approveDeviceAction() {
  const approval = state.device.approval;
  if (!approval?.actionId || !approval.approvalToken || !E.deviceConsent.checked) return;
  state.device.refreshing = true;
  updateDeviceControls();
  msgKey(E.deviceMessage, 'message.deviceApproving');
  try {
    const payload = await api(`/api/device-actions/${encodeURIComponent(approval.actionId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvalToken: approval.approvalToken }),
    });
    discardDeviceApproval();
    state.device.active = payload.action;
    upsertDeviceAction(payload.action);
    renderDeviceAction();
    renderDeviceActions();
    msgKey(E.deviceMessage, 'message.deviceApproved', 'success');
  } catch (error) {
    const retryable = ['device_busy', 'device_action_capacity'].includes(String(error.code || '').toLowerCase()) && Number.isInteger(error.status);
    if (retryable) msgKey(E.deviceMessage, 'message.deviceApprovalRetry', 'error', { error: error.message });
    else {
      discardDeviceApproval();
      msgKey(E.deviceMessage, 'message.deviceApprovalFailed', 'error', { error: error.message });
    }
  } finally {
    state.device.refreshing = false;
    updateDeviceControls();
    scheduleDeviceRefresh();
  }
}

async function refreshDeviceActions({ selectFirst = false, silent = false } = {}) {
  const job = selectedDeviceJob();
  if (!state.device.enabled || state.device.refreshing) return;
  state.device.refreshing = true;
  updateDeviceControls();
  try {
    const path = job ? `/api/device-actions?jobId=${encodeURIComponent(job.id)}` : '/api/device-actions';
    const payload = await api(path);
    state.device.actions = Array.isArray(payload.actions) ? payload.actions : [];
    const activeMatchesScope = state.device.active && (!job || state.device.active.jobId === job.id);
    const activeId = activeMatchesScope && state.device.actions.some(action => action.id === state.device.active.id)
      ? state.device.active.id
      : null;
    if (!activeId) state.device.active = null;
    renderDeviceActions();
    if (activeId) {
      const detail = await api(`/api/device-actions/${encodeURIComponent(activeId)}`);
      state.device.active = detail.action;
      upsertDeviceAction(detail.action);
      renderDeviceAction();
      renderDeviceActions();
    } else if (selectFirst && state.device.actions[0]) {
      await selectDeviceAction(state.device.actions[0].id);
    } else if (!state.device.actions.length) {
      state.device.active = null;
      renderDeviceAction();
    }
  } catch (error) {
    if (!silent) msgKey(E.deviceMessage, 'message.deviceActionsLoadFailed', 'error', { error: error.message });
  } finally {
    state.device.refreshing = false;
    updateDeviceControls();
    scheduleDeviceRefresh();
  }
}

function renderDeviceActions() {
  E.deviceActions.replaceChildren();
  E.deviceActionsEmpty.hidden = state.device.actions.length > 0;
  state.device.actions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `job-card device-action-card${state.device.active?.id === action.id ? ' active' : ''}`;
    if (state.device.active?.id === action.id) button.setAttribute('aria-current', 'true');
    button.onclick = () => selectDeviceAction(action.id);
    const top = document.createElement('div');
    top.className = 'job-top';
    const title = document.createElement('strong');
    title.textContent = action.artifact?.applicationId || action.device?.model || t('device.jobFallback');
    top.append(title, badge(action.status));
    const artifact = document.createElement('code');
    artifact.textContent = action.artifact?.relativePath || t('common.unknown');
    const bottom = document.createElement('div');
    bottom.className = 'job-bottom';
    const model = document.createElement('small');
    model.textContent = action.device?.model || t('device.modelFallback');
    const created = document.createElement('small');
    created.textContent = displayTime(action.createdAt);
    bottom.append(model, created);
    button.append(top, artifact, bottom);
    E.deviceActions.append(button);
  });
}

async function selectDeviceAction(id) {
  try {
    const payload = await api(`/api/device-actions/${encodeURIComponent(id)}`);
    state.device.active = payload.action;
    upsertDeviceAction(payload.action);
    renderDeviceAction();
    renderDeviceActions();
    scheduleDeviceRefresh();
  } catch (error) {
    msgRaw(E.deviceMessage, error.message, 'error');
  }
}

function upsertDeviceAction(action) {
  if (!action?.id) return;
  const index = state.device.actions.findIndex(candidate => candidate.id === action.id);
  if (index >= 0) state.device.actions[index] = action;
  else state.device.actions.unshift(action);
}

function renderDeviceAction() {
  const action = state.device.active;
  E.deviceActionDetail.hidden = !action;
  if (!action) return;
  if (state.device.approval?.actionId === action.id && action.status !== 'awaiting_approval') {
    discardDeviceApproval();
  }
  E.deviceActionTitle.removeAttribute('data-i18n');
  E.deviceActionTitle.textContent = action.artifact?.applicationId || action.device?.model || t('device.jobFallback');
  setBadge(E.deviceActionStatus, action.status);
  renderMeta(E.deviceActionMeta, [
    `job=${short(action.jobId)}`,
    action.device?.model ? `device=${action.device.model}` : null,
    action.artifact?.versionName ? `version=${action.artifact.versionName}` : null,
    action.createdAt ? `created=${displayDateTime(action.createdAt)}` : null,
    action.approvedAt ? `approved=${displayDateTime(action.approvedAt)}` : null,
    action.finishedAt ? `finished=${displayDateTime(action.finishedAt)}` : null,
  ]);
  const actionError = typeof action.error === 'string' ? action.error : action.error?.message || '';
  E.deviceActionError.hidden = !actionError;
  E.deviceActionError.textContent = actionError;
  E.deviceDeleteConfirm.hidden = true;
  E.deviceDelete.setAttribute('aria-expanded', 'false');
  renderDeviceEvidence(action);
  renderDeviceApproval(action);
}

function renderDeviceEvidence(action) {
  E.deviceEvidenceList.replaceChildren();
  const deleted = state.device.deletedEvidence.has(action.id);
  if (deleted) {
    setBadge(E.deviceEvidenceState, 'deleted');
    appendDeviceEvidenceMessage('device.evidenceDeleted');
    E.deviceDelete.hidden = true;
    return;
  }
  if (!DEVICE_TERMINAL.has(action.status)) {
    setBadge(E.deviceEvidenceState, 'pending');
    appendDeviceEvidenceMessage('message.deviceActionWaiting');
    E.deviceDelete.hidden = true;
    return;
  }
  if (!action.evidence) {
    setBadge(E.deviceEvidenceState, 'unavailable');
    appendDeviceEvidenceMessage('device.evidenceUnavailable');
    E.deviceDelete.hidden = false;
    return;
  }

  setBadge(E.deviceEvidenceState, 'ready');
  const fileNames = new Set(Object.values(action.evidence.files || {}).map(file => file?.name).filter(Boolean));
  const downloads = [
    { kind: 'json', name: 'device-evidence.json', key: 'device.downloadJson', available: true },
    { kind: 'logcat', name: 'logcat.txt', key: 'device.downloadLogcat', available: fileNames.has('logcat.txt') },
    { kind: 'crash', name: 'crash.txt', key: 'device.downloadCrash', available: fileNames.has('crash.txt') },
    { kind: 'screenshot', name: 'screenshot.png', key: 'device.downloadScreenshot', available: fileNames.has('screenshot.png') },
  ].filter(item => item.available);
  downloads.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = t(item.key);
    button.onclick = () => downloadDeviceEvidence(action.id, item.kind, item.name);
    E.deviceEvidenceList.append(button);
  });
  E.deviceDelete.hidden = false;
}

function appendDeviceEvidenceMessage(key) {
  const paragraph = document.createElement('p');
  paragraph.textContent = t(key);
  E.deviceEvidenceList.append(paragraph);
}

async function downloadDeviceEvidence(actionId, kind, name) {
  try {
    await downloadBlob(`/api/device-actions/${encodeURIComponent(actionId)}/evidence/${kind}`, name);
  } catch (error) {
    if (String(error.code || '').toLowerCase() === 'evidence_deleted' || error.status === 410) {
      state.device.deletedEvidence.add(actionId);
      renderDeviceAction();
    }
    msgRaw(E.deviceMessage, error.message, 'error');
  }
}

async function deleteDeviceEvidence() {
  const action = state.device.active;
  if (!action || !DEVICE_TERMINAL.has(action.status)) return;
  state.device.refreshing = true;
  E.deviceDeleteConfirmButton.disabled = true;
  updateDeviceControls();
  msgKey(E.deviceMessage, 'message.deviceDeletingEvidence');
  try {
    const payload = await api(`/api/device-actions/${encodeURIComponent(action.id)}/evidence`, {
      method: 'DELETE',
      body: JSON.stringify({ decision: 'delete' }),
    });
    if (!payload?.evidence?.deleted) throw new Error(t('device.evidenceUnavailable'));
    state.device.deletedEvidence.add(action.id);
    state.device.actions = state.device.actions.filter(candidate => candidate.id !== action.id);
    if (state.device.active?.id === action.id) state.device.active = null;
    E.deviceDeleteConfirm.hidden = true;
    E.deviceDelete.setAttribute('aria-expanded', 'false');
    renderDeviceActions();
    renderDeviceAction();
    msgKey(E.deviceMessage, 'message.deviceEvidenceDeleted', 'success');
  } catch (error) {
    msgRaw(E.deviceMessage, error.message, 'error');
  } finally {
    state.device.refreshing = false;
    E.deviceDeleteConfirmButton.disabled = false;
    updateDeviceControls();
  }
}

function scheduleDeviceRefresh() {
  clearTimeout(state.device.refreshTimer);
  state.device.refreshTimer = null;
  if (!state.device.enabled || !state.device.active || DEVICE_TERMINAL.has(state.device.active.status)) return;
  state.device.refreshTimer = setTimeout(() => refreshDeviceActions({ silent: true }), 2000);
}

async function loadActions() {
  clearTimeout(state.actions.refreshTimer);
  state.actions.refreshTimer = null;
  try {
    const payload = await api('/api/actions/targets');
    state.actions.available = true;
    state.actions.enabled = Boolean(payload.enabled);
    state.actions.targets = Array.isArray(payload.targets) ? payload.targets : [];
    state.actions.runs = [];
    state.actions.active = null;
    discardActionApproval();

    if (!state.actions.enabled) {
      setBadge(E.actionState, 'disabled');
      populateActionTargets();
      E.actionRefresh.disabled = true;
      msgKey(E.actionMessage, 'message.actionsDisabled');
      renderActionRuns();
      renderActionRun();
      return;
    }

    setBadge(E.actionState, 'ready');
    populateActionTargets();
    E.actionRefresh.disabled = false;
    msgKey(E.actionMessage, 'message.actionsChoose');
    await refreshActionRuns({ selectFirst: true, silent: true });
  } catch (error) {
    resetActions('unavailable', 'message.actionsUnavailable', { error: error.message });
  }
}

function resetActions(status, messageKey, params = {}) {
  clearTimeout(state.actions.refreshTimer);
  Object.assign(state.actions, {
    available: false,
    enabled: false,
    targets: [],
    runs: [],
    active: null,
    approval: null,
    refreshTimer: null,
    refreshing: false,
  });
  setBadge(E.actionState, status);
  populateActionTargets();
  E.actionRefresh.disabled = true;
  E.actionApproval.hidden = true;
  renderActionRuns();
  renderActionRun();
  msgKey(E.actionMessage, messageKey, '', params);
}

function populateActionTargets() {
  const targets = state.actions.targets;
  if (!state.actions.enabled || targets.length === 0) {
    const text = state.actions.enabled
      ? t('message.actionsNoTargets')
      : state.actions.available ? t('message.actionsDisabled') : t('actions.targetConnect');
    E.actionTarget.replaceChildren(option('', text));
    E.actionTarget.disabled = true;
    E.actionRef.replaceChildren(option('', t('message.actionsSelectTarget')));
    E.actionRef.disabled = true;
    updateActionControls();
    return;
  }

  E.actionTarget.replaceChildren(...targets.map(target => option(target.id, target.name)));
  E.actionTarget.disabled = false;
  populateActionRefs();
}

function populateActionRefs() {
  const target = selectedActionTarget();
  const refs = target?.refs || [];
  E.actionRef.replaceChildren(...(refs.length ? refs.map(ref => option(ref, ref)) : [option('', t('message.actionsChooseError'))]));
  E.actionRef.disabled = !state.actions.enabled || refs.length === 0;
  updateActionControls();
}

function selectedActionTarget() {
  return state.actions.targets.find(target => target.id === E.actionTarget.value) || null;
}

function updateActionControls() {
  const selectable = state.actions.enabled && Boolean(selectedActionTarget()) && Boolean(E.actionRef.value);
  E.actionForm.setAttribute('aria-busy', String(state.actions.refreshing));
  E.actionRuns.setAttribute('aria-busy', String(state.actions.refreshing));
  E.actionReview.disabled = !selectable || state.actions.refreshing;
  E.actionApprove.disabled = !state.actions.approval || state.actions.refreshing;
  E.actionDiscard.disabled = !state.actions.approval || state.actions.refreshing;
}

function invalidateActionApproval(message) {
  if (!state.actions.approval) return;
  discardActionApproval(message);
}

function discardActionApproval(messageKey = '') {
  state.actions.approval = null;
  E.actionApproval.hidden = true;
  updateActionControls();
  if (messageKey) msgKey(E.actionMessage, messageKey);
}

async function reviewAction(event) {
  event.preventDefault();
  const target = selectedActionTarget();
  const ref = E.actionRef.value;
  if (!target || !ref) return msgKey(E.actionMessage, 'message.actionsChooseError', 'error');

  state.actions.refreshing = true;
  updateActionControls();
  msgKey(E.actionMessage, 'message.actionsCreatingReview');
  try {
    const payload = await api('/api/actions/approvals', {
      method: 'POST',
      body: JSON.stringify({ targetId: target.id, ref, label: E.actionLabel.value }),
    });
    state.actions.approval = payload.approval;
    renderActionApproval(payload.approval);
    msgKey(E.actionMessage, 'message.actionsReviewCreated', 'success');
    E.actionApproval.focus({ preventScroll: true });
  } catch (error) {
    discardActionApproval();
    msgRaw(E.actionMessage, error.message, 'error');
  } finally {
    state.actions.refreshing = false;
    updateActionControls();
  }
}

function renderActionApproval(approval) {
  const target = approval?.target || {};
  E.approvalTarget.textContent = target.name || target.id || t('actions.unknownTarget');
  E.approvalRepository.textContent = target.repository || t('actions.unknownRepository');
  E.approvalWorkflow.textContent = target.workflow || t('actions.unknownWorkflow');
  E.approvalRef.textContent = target.ref || t('actions.unknownRef');
  E.approvalInputs.textContent = formatInputs(target.inputs);
  E.approvalArtifacts.textContent = target.artifactNames?.length ? target.artifactNames.join(', ') : t('actions.logsOnly');
  E.approvalExpires.textContent = displayDateTime(approval.expiresAt);
  E.actionApproval.hidden = false;
}

async function approveAction() {
  const approval = state.actions.approval;
  if (!approval?.id) return;

  state.actions.refreshing = true;
  updateActionControls();
  msgKey(E.actionMessage, 'message.actionsDispatching');
  try {
    const payload = await api('/api/actions/runs', {
      method: 'POST',
      body: JSON.stringify({ approvalId: approval.id, decision: 'approve' }),
    });
    discardActionApproval();
    upsertActionRun(payload.run);
    renderActionRuns();
    msgKey(E.actionMessage, 'message.actionsDispatched', 'success');
    await selectActionRun(payload.run.id);
  } catch (error) {
    discardActionApproval();
    msgKey(E.actionMessage, 'message.actionsDispatchFailed', 'error', { error: error.message });
  } finally {
    state.actions.refreshing = false;
    updateActionControls();
    scheduleActionRefresh();
  }
}

async function refreshActionRuns({ selectFirst = false, silent = false } = {}) {
  if (!state.actions.enabled || state.actions.refreshing) return;
  state.actions.refreshing = true;
  E.actionRefresh.disabled = true;
  updateActionControls();
  try {
    const payload = await api('/api/actions/runs');
    state.actions.runs = Array.isArray(payload.runs) ? payload.runs : [];
    populateAgentSources();
    const activeId = state.actions.active?.id;
    renderActionRuns();
    if (activeId) {
      const detail = await api(`/api/actions/runs/${encodeURIComponent(activeId)}`);
      state.actions.active = detail.run;
      upsertActionRun(detail.run);
      renderActionRun();
      renderActionRuns();
    } else if (selectFirst && state.actions.runs[0]) {
      await selectActionRun(state.actions.runs[0].id);
    }
  } catch (error) {
    if (!silent) msgRaw(E.actionMessage, error.message, 'error');
  } finally {
    state.actions.refreshing = false;
    E.actionRefresh.disabled = !state.actions.enabled;
    updateActionControls();
    scheduleActionRefresh();
  }
}

function renderActionRuns() {
  E.actionRuns.replaceChildren();
  E.actionRunsEmpty.hidden = state.actions.runs.length > 0;
  state.actions.runs.forEach(run => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `job-card action-run-card${state.actions.active?.id === run.id ? ' active' : ''}`;
    if (state.actions.active?.id === run.id) button.setAttribute('aria-current', 'true');
    button.onclick = () => selectActionRun(run.id);

    const top = document.createElement('div');
    top.className = 'job-top';
    const title = document.createElement('strong');
    title.textContent = run.label || run.targetId || t('actions.runFallback');
    top.append(title, badge(run.status));

    const repository = document.createElement('code');
    repository.textContent = repositoryName(run.repository || t('actions.repositoryFallback'));
    const bottom = document.createElement('div');
    bottom.className = 'job-bottom';
    const ref = document.createElement('small');
    ref.textContent = run.ref || t('actions.refFallback');
    const created = document.createElement('small');
    created.textContent = displayTime(runTimestamp(run, 'createdAt'));
    bottom.append(ref, created);
    button.append(top, repository, bottom);
    E.actionRuns.append(button);
  });
}

async function selectActionRun(id) {
  try {
    const payload = await api(`/api/actions/runs/${encodeURIComponent(id)}`);
    state.actions.active = payload.run;
    upsertActionRun(payload.run);
    renderActionRun();
    renderActionRuns();
    scheduleActionRefresh();
  } catch (error) {
    msgRaw(E.actionMessage, error.message, 'error');
  }
}

function upsertActionRun(run) {
  if (!run?.id) return;
  const index = state.actions.runs.findIndex(candidate => candidate.id === run.id);
  if (index >= 0) state.actions.runs[index] = run;
  else state.actions.runs.unshift(run);
}

function renderActionRun() {
  const run = state.actions.active;
  E.actionRunDetail.hidden = !run;
  if (!run) return;

  E.actionTitle.removeAttribute('data-i18n');
  E.actionTitle.textContent = run.label || `${run.targetId || 'Workflow'} · ${short(run.id)}`;
  setBadge(E.actionStatus, run.status);
  E.actionCancel.hidden = ACTION_TERMINAL.has(run.status);
  E.actionDelete.hidden = !ACTION_TERMINAL.has(run.status);
  E.actionDeleteConfirm.hidden = true;
  E.actionDelete.setAttribute('aria-expanded', 'false');
  E.actionCancel.disabled = state.actions.refreshing || run.cancelRequested;
  E.actionCancel.textContent = t(run.cancelRequested ? 'common.cancelRequested' : 'common.cancel');
  setExternalRunUrl(run.remoteUrl);

  renderMeta(E.actionMeta, [
    run.targetId ? `target=${run.targetId}` : null,
    run.ref ? `ref=${run.ref}` : null,
    run.workflow ? `workflow=${run.workflow}` : null,
    run.currentStep ? `step=${run.currentStep}` : null,
    run.remoteStatus ? `github=${run.remoteStatus}` : null,
    run.remoteConclusion ? `conclusion=${run.remoteConclusion}` : null,
    run.errorCode ? `error=${run.errorCode}` : null,
    runTimestamp(run, 'startedAt') ? `started=${displayDateTime(runTimestamp(run, 'startedAt'))}` : null,
    runTimestamp(run, 'finishedAt') ? `finished=${displayDateTime(runTimestamp(run, 'finishedAt'))}` : null,
  ]);
  if (run.error) {
    const error = document.createElement('span');
    error.className = 'run-error';
    error.textContent = run.error;
    E.actionMeta.append(error);
  }
  renderLogs(E.actionConsole, run.logs || [], t('message.actionRunWaiting'));
  renderArtifacts(E.actionArtifacts, E.actionCount, run.artifacts || [], artifact => downloadActionArtifact(run.id, artifact), 'actions.evidenceEmpty');
}

function setExternalRunUrl(value) {
  E.actionUrl.hidden = true;
  E.actionUrl.removeAttribute('href');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return;
    E.actionUrl.href = url.href;
    E.actionUrl.hidden = false;
  } catch {
    // The API has not attached a validated GitHub URL yet.
  }
}

async function cancelActionRun() {
  const run = state.actions.active;
  if (!run || ACTION_TERMINAL.has(run.status)) return;
  state.actions.refreshing = true;
  E.actionCancel.disabled = true;
  updateActionControls();
  try {
    const payload = await api(`/api/actions/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
    state.actions.active = payload.run;
    upsertActionRun(payload.run);
    renderActionRun();
    renderActionRuns();
    msgKey(E.actionMessage, 'message.actionsCancelRequested', 'success');
  } catch (error) {
    msgRaw(E.actionMessage, error.message, 'error');
  } finally {
    state.actions.refreshing = false;
    updateActionControls();
    renderActionRun();
    scheduleActionRefresh();
  }
}

async function downloadActionArtifact(id, artifact) {
  try {
    await downloadBlob(`/api/actions/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact.id)}`, artifact.name);
  } catch (error) {
    msgRaw(E.actionMessage, error.message, 'error');
  }
}

async function deleteActionRun() {
  const run = state.actions.active;
  if (!run || !ACTION_TERMINAL.has(run.status)) return;
  state.actions.refreshing = true;
  E.actionDeleteConfirmButton.disabled = true;
  updateActionControls();
  msgKey(E.actionMessage, 'message.actionsDeleting');
  try {
    await api(`/api/actions/runs/${encodeURIComponent(run.id)}`, { method: 'DELETE', body: JSON.stringify({ decision: 'delete' }) });
    state.actions.runs = state.actions.runs.filter(candidate => candidate.id !== run.id);
    state.actions.active = null;
    E.actionDeleteConfirm.hidden = true;
    E.actionDelete.setAttribute('aria-expanded', 'false');
    renderActionRuns(); renderActionRun(); populateAgentSources();
    msgKey(E.actionMessage, 'message.actionsDeleted', 'success');
  } catch (error) { msgRaw(E.actionMessage, error.message, 'error'); }
  finally { state.actions.refreshing = false; E.actionDeleteConfirmButton.disabled = false; updateActionControls(); }
}

async function loadAgent() {
  try {
    const payload = await api('/api/agent');
    state.agent.available = true;
    state.agent.enabled = Boolean(payload.enabled);
    setBadge(E.agentState, state.agent.enabled ? 'ready' : 'disabled');
    populateAgentSources();
    msgKey(E.agentMessage, state.agent.enabled ? 'message.agentChoose' : 'message.agentDisabled');
  } catch (error) {
    resetAgent('unavailable', 'message.agentUnavailable', { error: error.message });
  }
}

function resetAgent(status, messageKey, params = {}) {
  Object.assign(state.agent, { available: false, enabled: false, preview: null, result: null, refreshing: false });
  setBadge(E.agentState, status);
  E.agentPreview.hidden = true;
  E.agentResult.hidden = true;
  populateAgentSources();
  msgKey(E.agentMessage, messageKey, '', params);
}

function agentSources() {
  const jobs = state.jobs.map(job => ({ value: `local_job:${job.id}`, label: `${t('agent.localJob')} · ${job.label || short(job.id)}` }));
  const runs = state.actions.runs.map(run => ({ value: `actions_run:${run.id}`, label: `${t('agent.actionsRun')} · ${run.label || short(run.id)}` }));
  return [...jobs, ...runs];
}

function populateAgentSources() {
  const selected = E.agentSource.value;
  const sources = agentSources();
  if (!state.agent.enabled || !sources.length) {
    E.agentSource.replaceChildren(option('', state.agent.enabled ? t('agent.sourceEmpty') : t('agent.sourceConnect')));
  } else {
    E.agentSource.replaceChildren(...sources.map(source => option(source.value, source.label)));
    if (sources.some(source => source.value === selected)) E.agentSource.value = selected;
  }
  E.agentSource.disabled = !state.agent.enabled || !sources.length;
  E.agentIntent.disabled = !state.agent.enabled;
  updateAgentControls();
}

function updateAgentControls() {
  const hasSource = state.agent.enabled && E.agentSource.value.includes(':');
  E.agentForm.setAttribute('aria-busy', String(state.agent.refreshing));
  E.agentReview.disabled = !hasSource || state.agent.refreshing || Boolean(state.agent.preview);
  E.agentApprove.disabled = !state.agent.preview || !E.agentConsent.checked || state.agent.refreshing;
  E.agentDiscard.disabled = !state.agent.preview || state.agent.refreshing;
}

function discardAgentPreview() {
  state.agent.preview = null;
  E.agentPreview.hidden = true;
  E.agentConsent.checked = false;
  updateAgentControls();
}

async function reviewAgentEvidence(event) {
  event.preventDefault();
  const [sourceType, sourceId] = E.agentSource.value.split(':');
  if (!sourceType || !sourceId) return msgKey(E.agentMessage, 'message.agentSourceRequired', 'error');
  state.agent.refreshing = true;
  updateAgentControls();
  try {
    const payload = await api('/api/agent/previews', { method: 'POST', body: JSON.stringify({ sourceType, sourceId, intent: E.agentIntent.value }) });
    state.agent.preview = payload.preview;
    renderAgentPreview();
    msgKey(E.agentMessage, 'message.agentPreviewReady', 'success');
    E.agentPreview.focus({ preventScroll: true });
  } catch (error) { msgRaw(E.agentMessage, error.message, 'error'); }
  finally { state.agent.refreshing = false; updateAgentControls(); }
}

function renderAgentPreview() {
  if (!state.agent.preview) return;
  E.agentEvidence.textContent = JSON.stringify(state.agent.preview.evidence, null, 2);
  E.agentPreview.hidden = false;
}

async function approveAgentProposal() {
  if (!state.agent.preview || !E.agentConsent.checked) return;
  const previewId = state.agent.preview.id;
  state.agent.refreshing = true;
  updateAgentControls();
  msgKey(E.agentMessage, 'message.agentGenerating');
  try {
    const payload = await api('/api/agent/proposals', { method: 'POST', body: JSON.stringify({ previewId, decision: 'approve' }) });
    state.agent.result = payload.result;
    discardAgentPreview();
    renderAgentResult();
    msgKey(E.agentMessage, 'message.agentGenerated', 'success');
  } catch (error) {
    discardAgentPreview();
    msgRaw(E.agentMessage, error.message, 'error');
  } finally { state.agent.refreshing = false; updateAgentControls(); }
}

function renderAgentResult() {
  const proposal = state.agent.result?.proposal;
  E.agentResult.hidden = !proposal;
  if (!proposal) return;
  E.agentSummary.textContent = proposal.summary;
  E.agentDiagnosis.textContent = proposal.diagnosis;
  E.agentSteps.replaceChildren(...proposal.steps.map(step => listItem(`${step.kind}${step.path ? ` · ${step.path}` : ''}: ${step.description}`)));
  E.agentRisks.replaceChildren(...proposal.risks.map(listItem));
  E.agentVerification.replaceChildren(...proposal.verification.map(listItem));
}

function listItem(text) { const item = document.createElement('li'); item.textContent = text; return item; }

function scheduleActionRefresh() {
  clearTimeout(state.actions.refreshTimer);
  state.actions.refreshTimer = null;
  if (!state.actions.enabled || !state.actions.runs.some(run => !ACTION_TERMINAL.has(run.status))) return;
  state.actions.refreshTimer = setTimeout(() => refreshActionRuns({ silent: true }), 3000);
}

async function downloadBlob(path, fileName) {
  const response = await fetch(path, { headers: auth(), cache: 'no-store' });
  if (!response.ok) throw await responseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderMeta(container, values) {
  container.replaceChildren(...values.filter(Boolean).map(value => {
    const span = document.createElement('span');
    span.textContent = value;
    return span;
  }));
}

function badge(status) {
  const element = document.createElement('em');
  element.className = 'status';
  setBadge(element, status);
  return element;
}

function setBadge(element, status) {
  const text = status || 'unknown';
  const statusClass = KNOWN_STATUSES.has(text) ? text : 'neutral';
  element.dataset.status = text;
  element.className = `status ${statusClass}`;
  element.textContent = t(`status.${text}`) === `status.${text}` ? text.replaceAll('_', ' ') : t(`status.${text}`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...auth(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function auth() {
  return { Authorization: `Bearer ${state.token}` };
}

async function responseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Fall through to a status-only message.
  }
  const message = typeof payload?.error === 'string'
    ? payload.error
    : typeof payload?.error?.message === 'string'
      ? payload.error.message
      : typeof payload?.message === 'string'
        ? payload.message
        : t('message.httpError', { status: response.status });
  const error = new Error(message);
  error.status = response.status;
  if (typeof payload?.code === 'string') error.code = payload.code;
  else if (typeof payload?.error?.code === 'string') error.code = payload.error.code;
  return error;
}

function option(value, text) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}

function msgKey(element, key, type = '', params = {}) {
  messageRegistry.set(element, { key, params: { ...params }, type, raw: null });
  renderMessage(element);
}

function msgRaw(element, text, type = '') {
  messageRegistry.set(element, { key: null, params: {}, type, raw: String(text ?? '') });
  renderMessage(element);
}

function renderMessage(element) {
  const message = messageRegistry.get(element);
  if (!message) return;
  element.textContent = message.key ? t(message.key, message.params) : message.raw;
  const type = message.type;
  element.className = `message${type ? ` ${type}` : ''}`;
}

function formatInputs(inputs) {
  const entries = Object.entries(inputs || {}).sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') : t('actions.noFixedInputs');
}

function repositoryName(value) {
  return value.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}

function presetText(preset, field) {
  const normalizedId = String(preset?.id || '').replaceAll('-', '_');
  const key = `preset.${normalizedId}.${field}`;
  const translated = t(key);
  return translated === key ? preset?.[field] || preset?.name || preset?.id || t('common.unknown') : translated;
}

function runTimestamp(run, key) {
  return run?.[key] || run?.timestamps?.[key] || null;
}

function displayTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('common.timeUnavailable') : date.toLocaleTimeString(dateLocale());
}

function displayDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('common.timeUnavailable') : date.toLocaleString(dateLocale());
}

function short(id) {
  return id?.split('-')[0] || t('common.unknown');
}

function bytes(value) {
  const size = Number.isFinite(value) && value >= 0 ? value : 0;
  if (size < 1024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function initialLocale() {
  let stored = null;
  try {
    stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  if (stored !== null) return normalizeLocale(stored);
  return normalizeLocale(navigator.language);
}

function normalizeLocale(value) {
  const primary = typeof value === 'string' ? value.trim().toLowerCase().split('-')[0] : '';
  return SUPPORTED_LOCALES.includes(primary) ? primary : 'en';
}

function changeLocale(value) {
  state.locale = normalizeLocale(value);
  E.language.value = state.locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
  } catch {
    // The selected language still applies for this page view.
  }
  applyLocale();
}

function applyLocale() {
  document.documentElement.lang = state.locale;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-prefix]').forEach(element => {
    const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = t(element.dataset.i18nPrefix);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-content]').forEach(element => {
    element.setAttribute('content', t(element.dataset.i18nContent));
  });
  document.querySelectorAll('.status[data-status]').forEach(element => setBadge(element, element.dataset.status));
  for (const element of messageRegistry.keys()) renderMessage(element);

  const selectedPreset = E.preset.value;
  if (state.presets.length) {
    options();
    if ([...E.preset.options].some(entry => entry.value === selectedPreset)) E.preset.value = selectedPreset;
    describe();
  }
  const selectedTarget = E.actionTarget.value;
  const selectedRef = E.actionRef.value;
  populateActionTargets();
  if (state.actions.targets.some(target => target.id === selectedTarget)) {
    E.actionTarget.value = selectedTarget;
    populateActionRefs();
    if (selectedActionTarget()?.refs.includes(selectedRef)) E.actionRef.value = selectedRef;
  }
  renderJobs();
  if (state.active) render();
  populateDeviceJobs();
  populateDevices();
  renderDeviceActions();
  renderDeviceAction();
  renderActionRuns();
  if (state.actions.active) renderActionRun();
  if (state.actions.approval) renderActionApproval(state.actions.approval);
  populateAgentSources();
  if (state.agent.preview) renderAgentPreview();
  if (state.agent.result) renderAgentResult();
}

function t(key, params = {}) {
  const template = LOCALES[state.locale]?.[key] ?? LOCALES.en[key] ?? key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

function dateLocale() {
  return { en: 'en-US', ko: 'ko-KR', ja: 'ja-JP' }[state.locale];
}
