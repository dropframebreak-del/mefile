const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  route: 'library',
  meetings: [],
  settings: null,
  models: [],
  providers: [],
  health: null,
  current: null,
  notes: '',
  notesFilename: '',
  draftMeetingId: null,
  reuseDraftId: null,
  search: '',
  dirty: false,
  saving: false,
  rev: 0,
  saveTimer: null,
  settingsTimer: null,
  generating: false,
  abort: null,
  elapsedTimer: null,
  startedAt: 0,
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} h ago`;
  if (diff < 172800000) return 'yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function wordCount(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

function modelLabel(name) {
  if (!name) return 'No model';
  return name.replace(/:latest$/, '');
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (target[key] == null) target[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
}

/* ------------------------------------------------------------------ */
/* api                                                                 */
/* ------------------------------------------------------------------ */

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (HTTP ${res.status}).`);
    error.status = res.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { method: 'POST', body, ...options }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ */
/* toast                                                               */
/* ------------------------------------------------------------------ */

function toast(message, kind = 'info') {
  const icon =
    kind === 'error'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></svg>'
      : kind === 'success'
        ? '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>'
        : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(
    () => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'all .25s';
      setTimeout(() => el.remove(), 260);
    },
    kind === 'error' ? 7000 : 4200,
  );
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindStaticEvents();
  try {
    state.settings = await api.get('/api/settings');
  } catch (err) {
    toast(err.message, 'error');
  }
  hydrateSettingsForm();
  updateTemperatureLabels();

  await Promise.allSettled([loadLibrary(), loadHealth()]);
  window.addEventListener('hashchange', route);
  await route();

  refreshProviders();
  loadModels().catch(() => {});
}

function bindStaticEvents() {
  $$('[data-nav]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const target = el.dataset.nav;
      if (target === 'new') {
        state.notes = '';
        state.notesFilename = '';
        state.draftMeetingId = null;
        state.current = null;
      }
      if (location.hash === `#/${target}`) route();
      else location.hash = `#/${target}`;
    });
  });

  const searchInput = $('#search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderLibrary();
    });
  }

  $('#notes-input').addEventListener('input', (event) => {
    state.notes = event.target.value;
    updateNotesMeta();
  });

  $('#file-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) uploadFile(file);
    event.target.value = '';
  });

  $('#load-sample').addEventListener('click', loadSample);
  $('#empty-sample')?.addEventListener('click', loadSample);
  $('#clear-notes').addEventListener('click', () => setNotes(''));
  $('#analyze').addEventListener('click', analyze);
  const refreshModels = $('#refresh-models');
  if (refreshModels) {
    refreshModels.addEventListener('click', () => {
      loadModels(true).catch((err) => toast(err.message, 'error'));
      refreshProviders().catch(() => {});
    });
  }

  const dropzone = $('#dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('dragover');
      }),
    );
    ['dragleave', 'drop'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragover');
      }),
    );
    dropzone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadFile(file);
    });
  }

  const modelSelect = $('#model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (event) => {
      if (!state.settings) state.settings = {};
      state.settings.model = event.target.value;
      updateAiPill();
      scheduleSettingsSave();
    });
  }
  const tempSelect = $('#temperature');
  if (tempSelect) {
    tempSelect.addEventListener('input', (event) => {
      if (!state.settings) state.settings = {};
      state.settings.temperature = Number(event.target.value);
      updateTemperatureLabels();
      scheduleSettingsSave();
    });
  }
  const thoroughToggle = $('#thorough');
  if (thoroughToggle) {
    thoroughToggle.addEventListener('change', (event) => {
      if (!state.settings) state.settings = {};
      state.settings.thorough = event.target.checked;
      scheduleSettingsSave();
    });
  }

  $('#ai-pill')?.addEventListener('click', () => {
    location.hash = '#/settings';
  });

  $('#save-btn')?.addEventListener('click', () => saveNow(true));
  $('#export-pdf')?.addEventListener('click', () => exportReport('pdf'));
  $('#preview-pdf')?.addEventListener('click', () => exportReport('pdf', true));
  $('#export-md')?.addEventListener('click', () => exportReport('markdown'));
  $('#edit-notes')?.addEventListener('click', editNotes);
  $('#cancel-gen')?.addEventListener('click', cancelGeneration);

  document.addEventListener('input', onReviewInput);
  document.addEventListener('click', onReviewClick);

  const saveSettingsBtn = $('#save-settings');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
  const testConn = $('#test-connection');
  if (testConn) testConn.addEventListener('click', testConnection);
  const detectBtn = $('#detect-servers');
  if (detectBtn) {
    detectBtn.addEventListener('click', async () => {
      const button = detectBtn;
      button.disabled = true;
      try {
        await refreshProviders();
        renderDetectedServers();
        toast(state.providers.length ? `Found ${state.providers.length} local server(s).` : 'No local servers found.', state.providers.length ? 'success' : 'error');
      } finally {
        button.disabled = false;
      }
    });
  }
  const st = $('#settings-temperature');
  if (st) st.addEventListener('input', updateTemperatureLabels);
  const sbu = $('#settings-baseurl');
  if (sbu) sbu.addEventListener('change', () => { loadModels(true).catch((err) => toast(err.message, 'error')); });
  const sp = $('#settings-provider');
  if (sp) sp.addEventListener('change', () => { loadModels(true).catch((err) => toast(err.message, 'error')); });

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 's' && state.route === 'review') {
      event.preventDefault();
      saveNow(true);
    }
    if (event.key === 'Enter' && state.route === 'composer') {
      event.preventDefault();
      analyze();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
  });
}

/* ------------------------------------------------------------------ */
/* settings + AI status                                                */
/* ------------------------------------------------------------------ */

function hydrateSettingsForm() {
  if (!state.settings) return;
  const baseUrl = $('#settings-baseurl');
  if (baseUrl) baseUrl.value = state.settings.baseUrl || '';
  const provider = $('#settings-provider');
  if (provider) {
    const p = state.settings.provider || 'ollama';
    provider.value = ['ollama', 'lmstudio', 'llamacpp', 'jan', 'vllm'].includes(p) ? p : 'custom';
  }
  const st = $('#settings-temperature');
  if (st) st.value = state.settings.temperature ?? 0.2;
  const sth = $('#settings-thorough');
  if (sth) sth.checked = Boolean(state.settings.thorough);
  const t = $('#temperature');
  if (t) t.value = state.settings.temperature ?? 0.2;
  const th = $('#thorough');
  if (th) th.checked = Boolean(state.settings.thorough);
  updateTemperatureLabels();
}

function updateTemperatureLabels() {
  const composerEl = $('#temperature');
  if (composerEl) {
    const composerValue = Number(composerEl.value || 0);
    const cv = $('#temp-value');
    if (cv) cv.textContent = composerValue.toFixed(1);
  }
  const settingsEl = $('#settings-temperature');
  if (settingsEl) {
    const settingsValue = Number(settingsEl.value || 0);
    const sv = $('#settings-temp-value');
    if (sv) sv.textContent = settingsValue.toFixed(1);
  }
}

function scheduleSettingsSave() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(async () => {
    try {
      state.settings = await api.put('/api/settings', state.settings);
    } catch (err) {
      toast(`Could not save settings: ${err.message}`, 'error');
    }
  }, 700);
}

async function saveSettings() {
  const baseUrlEl = $('#settings-baseurl');
  const providerEl = $('#settings-provider');
  const modelEl = $('#settings-model');
  const tempEl = $('#settings-temperature');
  const thrEl = $('#settings-thorough');
  const baseUrl = (baseUrlEl?.value || state.settings?.baseUrl || '').trim();
  const provider = providerEl?.value || state.settings?.provider || 'ollama';
  const model = modelEl?.value || state.settings?.model || '';
  const temperature = tempEl ? Number(tempEl.value) : (state.settings?.temperature ?? 0.2);
  const thorough = thrEl ? thrEl.checked : Boolean(state.settings?.thorough);
  if (baseUrlEl && !baseUrl) return toast('Enter the address of your local AI server.', 'error');

  try {
    state.settings = await api.put('/api/settings', { baseUrl, provider, model, temperature, thorough });
    hydrateSettingsForm();
    if ($('#thorough')) $('#thorough').checked = thorough;
    toast('Settings saved.', 'success');
    await loadModels().catch(() => {});
    await loadHealth().catch(() => {});
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function testConnection() {
  const baseUrlEl = $('#settings-baseurl');
  const providerEl = $('#settings-provider');
  if (!baseUrlEl) return;
  const baseUrl = baseUrlEl.value.trim();
  const provider = providerEl?.value || 'ollama';
  const button = $('#test-connection');
  button.disabled = true;
  try {
    const result = await api.post('/api/ai/test', { baseUrl, provider });
    if (result.models?.length) {
      state.models = result.models;
      populateModelSelects();
      toast(`Connected to ${result.origin}. ${result.models.length} model(s) available.`, 'success');
      updateAiPill(true, result.models[0]?.name);
    } else {
      toast(`Connected to ${result.origin}, but no models are installed.`, 'error');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadHealth() {
  try {
    state.health = await api.get('/api/health');
    updateAiPill(state.health.ai?.online, state.health.ai?.model);
    const dataDirEl = $('#about-data-dir');
    if (state.health.dataDir && dataDirEl) dataDirEl.textContent = state.health.dataDir;
  } catch {
    updateAiPill(false);
  }
}

function updateAiPill(online = state.health?.ai?.online, label = state.settings?.model) {
  const pill = $('#ai-pill');
  const text = $('#ai-pill-text');
  if (!pill) return;
  if (online) {
    pill.classList.add('online');
    pill.classList.remove('offline');
    text.textContent = label ? modelLabel(label) : 'AI ready';
    pill.title = `Local model ready at ${state.settings?.baseUrl || ''}`;
  } else {
    pill.classList.add('offline');
    pill.classList.remove('online');
    text.textContent = 'AI offline';
    pill.title = 'No local AI server is responding. Open Settings.';
  }
}

async function refreshProviders() {
  try {
    const data = await api.get('/api/providers');
    state.providers = data.providers || [];
    if (state.providers.length) {
      const current = state.providers.find((p) => p.origin === state.settings?.baseUrl) || state.providers[0];
      if (!state.health?.ai?.online) updateAiPill(true, current.models?.[0]?.name);
    }
    if (state.route === 'settings') renderDetectedServers();
    updateOfflineCard();
  } catch {
    state.providers = [];
    updateOfflineCard();
  }
}

function updateOfflineCard() {
  const card = $('#offline-card');
  if (!card) return;
  card.hidden = Boolean(state.providers.length) || Boolean(state.health?.ai?.online);
}

async function loadModels(notify = false) {
  const baseUrlEl = $('#settings-baseurl');
  const providerEl = $('#settings-provider');
  const baseUrl = state.route === 'settings' && baseUrlEl ? baseUrlEl.value.trim() : state.settings?.baseUrl;
  const provider = state.route === 'settings' && providerEl ? providerEl.value : state.settings?.provider;
  try {
    const query = new URLSearchParams({ baseUrl: baseUrl || '', provider: provider || 'ollama' });
    const data = await api.get(`/api/models?${query.toString()}`);
    state.models = data.models || [];
    populateModelSelects();
    if (!state.settings.model && state.models.length) {
      state.settings.model = state.models[0].id;
      scheduleSettingsSave();
    }
    updateAiPill(true, state.settings?.model || state.models[0]?.name);
    if (notify) toast(`${state.models.length} model(s) available.`, state.models.length ? 'success' : 'error');
    return state.models;
  } catch (err) {
    if (notify) toast(err.message, 'error');
    return [];
  }
}

function populateModelSelects() {
  const selects = [$('#model-select'), $('#settings-model')].filter(Boolean);
  const current = state.settings?.model || '';
  for (const select of selects) {
    const options = [];
    if (!state.models.length) {
      options.push('<option value="">No models found</option>');
    } else {
      for (const model of state.models) {
        options.push(
          `<option value="${esc(model.id)}"${model.id === current ? ' selected' : ''}>${esc(model.name)}${
            model.parameterSize ? ` · ${esc(model.parameterSize)}` : ''
          }</option>`,
        );
      }
      if (current && !state.models.some((m) => m.id === current)) {
        options.unshift(`<option value="${esc(current)}" selected>${esc(current)} (not installed)</option>`);
      }
    }
    select.innerHTML = options.join('');
  }
  updateOfflineCard();
}

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/library';
  const parts = raw.split('/').filter(Boolean);
  const wasReview = state.route === 'review';

  if (parts[0] === 'meeting' && parts[1]) {
    state.route = 'review';
    await openMeeting(parts[1]);
  } else if (parts[0] === 'new') {
    state.route = 'composer';
    openComposer();
  } else if (parts[0] === 'settings') {
    state.route = 'settings';
    showView('settings');
    hydrateSettingsForm();
    renderDetectedServers();
    loadModels().catch(() => {});
    document.title = 'Settings — mefile';
  } else {
    state.route = 'library';
    if (wasReview) flushSave();
    state.current = null;
    showView('library');
    renderLibrary();
    document.title = 'mefile — local meeting reports';
  }
  updateNav();
}

function updateNav() {
  const map = { library: 'library', composer: 'new', review: 'library', settings: 'settings' };
  const active = map[state.route];
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.nav === active));
}

function showView(name) {
  for (const view of $$('.view')) view.hidden = view.id !== `view-${name}`;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

async function openMeeting(id) {
  flushSave();
  if (state.current?.id === id && state.current.result) {
    showView('review');
    renderReview();
    return;
  }
  try {
    const meeting = await api.get(`/api/meetings/${id}`);
    state.current = meeting;
    if (meeting.result) {
      showView('review');
      renderReview();
      document.title = `${meeting.title} — mefile`;
    } else {
      state.route = 'composer';
      state.notes = meeting.source?.notes || '';
      state.notesFilename = meeting.source?.filename || '';
      state.draftMeetingId = meeting.id;
      showView('composer');
      hydrateComposer();
      updateNav();
      document.title = 'New report — mefile';
    }
  } catch (err) {
    toast(err.message, 'error');
    location.hash = '#/library';
  }
}

function openComposer() {
  if (state.reuseDraftId) {
    state.draftMeetingId = state.reuseDraftId;
    state.reuseDraftId = null;
  }
  showView('composer');
  hydrateComposer();
  document.title = 'New report — mefile';
}

function hydrateComposer() {
  const textarea = $('#notes-input');
  textarea.value = state.notes;
  updateNotesMeta();
  updateTemperatureLabels();
  if (!state.models.length) {
    loadModels().catch(() => {});
  } else {
    populateModelSelects();
  }
  $('#offline-card').hidden = Boolean(state.providers.length) || Boolean(state.health?.ai?.online);
  $('#composer-error').hidden = true;
  $('#analyze').disabled = false;
  updateAiPill();
}

function editNotes() {
  if (!state.current) return;
  state.reuseDraftId = state.current.id;
  state.notes = state.current.source?.notes || '';
  state.notesFilename = state.current.source?.filename || '';
  location.hash = '#/new';
}

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

async function loadLibrary() {
  try {
    const data = await api.get('/api/meetings');
    state.meetings = data.meetings || [];
    if (state.route === 'library') renderLibrary();
  } catch (err) {
    toast(`Could not load meetings: ${err.message}`, 'error');
  }
}

function renderLibrary() {
  const grid = $('#library-grid');
  const empty = $('#library-empty');
  if (!grid || !empty) return;

  if (!state.meetings.length) {
    empty.hidden = false;
    grid.hidden = true;
    $('#library-count').textContent = '';
    return;
  }

  empty.hidden = true;
  grid.hidden = false;

  const filtered = state.meetings.filter((m) => {
    if (!state.search) return true;
    return `${m.title} ${m.result?.summary || ''} ${m.source?.filename || ''}`.toLowerCase().includes(state.search);
  });

  $('#library-count').textContent = `${filtered.length} of ${state.meetings.length} meeting${state.meetings.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h2>No matches</h2><p>Try a different title or keyword.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(cardTemplate).join('');
}

function cardTemplate(meeting) {
  const result = meeting.result;
  const statusChip =
    meeting.status === 'generating'
      ? '<span class="chip warn">Analysing…</span>'
      : meeting.status === 'error'
        ? '<span class="chip warn">Failed</span>'
        : !result
          ? '<span class="chip">Draft</span>'
          : '';
  const summary = result?.summary || (meeting.status === 'error' ? 'The last analysis failed. Open to try again.' : 'Not analysed yet.');
  return `<article class="meeting-card" data-open="${esc(meeting.id)}" role="button" tabindex="0" aria-label="Open ${esc(meeting.title)}">
    <button class="card-delete" data-delete="${esc(meeting.id)}" title="Delete meeting" aria-label="Delete meeting">
      <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>
    </button>
    <h3>${esc(meeting.title || 'Untitled meeting')}</h3>
    <p class="card-summary">${esc(summary)}</p>
    <div class="card-meta">
      ${statusChip}
      <span class="chip">${esc(fmtDate(result?.date || meeting.createdAt))}</span>
      ${result?.actionItems ? `<span class="chip accent">${result.actionItems} action${result.actionItems === 1 ? '' : 's'}</span>` : ''}
      ${result?.attendees ? `<span class="chip">${result.attendees} people</span>` : ''}
    </div>
    <div class="card-foot">
      <span>${esc(relativeTime(meeting.updatedAt))}</span>
      <span>${esc(meeting.model ? modelLabel(meeting.model) : meeting.source?.filename || '')}</span>
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

function setNotes(text) {
  state.notes = text;
  $('#notes-input').value = text;
  updateNotesMeta();
}

function updateNotesMeta() {
  const words = wordCount(state.notes);
  const chars = state.notes.length;
  $('#notes-meta').textContent = `${words.toLocaleString('en-GB')} words · ${chars.toLocaleString('en-GB')} characters`;
}

async function loadSample() {
  try {
    const res = await fetch('/samples/sample-transcript.vtt');
    const text = await res.text();
    setNotes(text);
    state.notesFilename = 'sample-transcript.vtt';
    if (state.route !== 'composer') location.hash = '#/new';
    toast('Sample transcript loaded. Hit Analyse notes.', 'success');
  } catch {
    toast('Could not load the sample.', 'error');
  }
}

async function uploadFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast('That file is larger than 5 MB.', 'error');
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    setNotes(data.text);
    state.notesFilename = data.filename;
    toast(`Loaded ${data.filename}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function analyze() {
  if (state.generating) return;
  const notes = state.notes.trim();
  if (notes.length < 40) {
    return showComposerError('Paste a little more before analysing — at least a few sentences.');
  }
  const model = $('#model-select').value || state.settings?.model;
  if (!model) {
    return showComposerError('No local model is available. Open Settings and connect your AI server.');
  }
  state.settings.model = model;
  scheduleSettingsSave();
  $('#composer-error').hidden = true;

  try {
    let id = state.draftMeetingId;
    if (!id) {
      const meeting = await api.post('/api/meetings', {
        notes,
        filename: state.notesFilename || '',
      });
      id = meeting.id;
      state.draftMeetingId = id;
    }
    const meeting = await runGeneration(id, notes);
    state.current = meeting;
    state.draftMeetingId = null;
    await loadLibrary();
    if (location.hash === `#/meeting/${meeting.id}`) {
      showView('review');
      renderReview();
    } else {
      location.hash = `#/meeting/${meeting.id}`;
    }
    toast('Report ready.', 'success');
  } catch (err) {
    if (err?.name === 'AbortError' || err?.code === 'cancelled') {
      toast('Generation cancelled.', 'info');
      return;
    }
    showComposerError(err.message);
    toast(err.message, 'error');
  }
}

function showComposerError(message) {
  const box = $('#composer-error');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showOverlay() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  state.startedAt = Date.now();
  setPhase({ percent: 5, phase: 'reading', detail: 'Cleaning up timestamps and noise…' });
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    $('#elapsed').textContent = `${elapsed}s elapsed`;
  }, 1000);
}

function hideOverlay() {
  $('#overlay').hidden = true;
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

const PHASE_TITLES = {
  reading: 'Reading your notes',
  condensing: 'Condensing a long transcript',
  analyzing: 'Structuring the report',
  repairing: 'Fixing the model output',
  reviewing: 'Double-checking the details',
  saving: 'Saving your meeting',
};

function setPhase({ phase, detail, percent }) {
  $('#phase-title').textContent = PHASE_TITLES[phase] || 'Working…';
  $('#phase-detail').textContent = detail || '';
  const bar = $('#progress-bar');
  bar.style.width = `${Math.max(4, Math.min(100, percent || 0))}%`;
  $('#phase-percent').textContent = `${percent || 0}%`;
  const progress = $('.progress');
  if (progress) progress.setAttribute('aria-valuenow', String(percent || 0));
}

async function runGeneration(id, notes) {
  state.generating = true;
  state.abort = new AbortController();
  showOverlay();
  $('#analyze').disabled = true;

  try {
    const res = await fetch(`/api/meetings/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes,
        model: state.settings.model,
        temperature: state.settings.temperature,
        thorough: state.settings.thorough,
        baseUrl: state.settings.baseUrl,
        provider: state.settings.provider,
      }),
      signal: state.abort.signal,
    });

    if (!res.ok) {
      let message = `The AI server returned HTTP ${res.status}.`;
      try {
        const data = await res.json();
        if (data.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let meeting = null;
    let failure = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (!data) continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === 'phase') setPhase(payload);
        else if (event === 'done') meeting = payload.meeting;
        else if (event === 'cancelled') {
          const error = new Error('Generation cancelled.');
          error.code = 'cancelled';
          throw error;
        } else if (event === 'error') failure = payload.message || 'The analysis failed.';
      }
    }

    if (failure) throw new Error(failure);
    if (!meeting) throw new Error('The server closed the connection before the report was finished.');
    return meeting;
  } finally {
    state.generating = false;
    state.abort = null;
    $('#analyze').disabled = false;
    hideOverlay();
  }
}

function cancelGeneration() {
  state.abort?.abort();
  if (state.draftMeetingId) {
    api.post(`/api/meetings/${state.draftMeetingId}/cancel`).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* review                                                              */
/* ------------------------------------------------------------------ */

function setSaveState(text, kind = '') {
  const el = $('#save-state');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('saved', kind === 'saved');
}

function markDirty() {
  if (!state.current) return;
  state.dirty = true;
  state.rev += 1;
  setSaveState('Unsaved');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveNow(), 900);
}

async function saveNow(force = false) {
  if (!state.current || (!state.dirty && !force)) return;
  if (state.saving) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveNow(force), 400);
    return;
  }
  clearTimeout(state.saveTimer);
  const rev = state.rev;
  state.saving = true;
  setSaveState('Saving…');
  try {
    const updated = await api.put(`/api/meetings/${state.current.id}`, {
      title: state.current.title,
      result: state.current.result,
    });
    state.current = { ...state.current, ...updated };
    if (state.rev === rev) {
      state.dirty = false;
      setSaveState('Saved', 'saved');
    } else {
      state.saveTimer = setTimeout(() => saveNow(), 600);
    }
    const index = state.meetings.findIndex((m) => m.id === updated.id);
    if (index !== -1) {
      state.meetings[index] = {
        ...state.meetings[index],
        title: updated.title,
        updatedAt: updated.updatedAt,
        status: updated.status,
        result: updated.result
          ? {
              date: updated.result.date,
              attendees: updated.result.attendees?.length || 0,
              actionItems: updated.result.actionItems?.length || 0,
              summary: updated.result.summary?.overview || '',
            }
          : null,
      };
    }
  } catch (err) {
    setSaveState('Save failed');
    toast(`Could not save: ${err.message}`, 'error');
  } finally {
    state.saving = false;
  }
}

function flushSave() {
  if (state.dirty) saveNow();
}

function onReviewInput(event) {
  const target = event.target.closest('[data-path]');
  if (!target || !state.current || state.route !== 'review') return;
  const path = target.dataset.path;
  const format = target.dataset.format;
  let value;

  if (format === 'status') value = target.checked ? 'done' : 'open';
  else if (format === 'lines') value = target.value.split('\n').map((line) => line.trim()).filter(Boolean);
  else if (format === 'tags') value = target.value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean);
  else if (format === 'number') value = target.value === '' ? null : Number(target.value);
  else value = target.value;

  setPath(state.current.result, path, value);
  if (path === 'title') state.current.title = value || 'Meeting notes';
  markDirty();
  if (format === 'status') {
    const row = target.closest('.action-row');
    if (row) row.classList.toggle('done', target.checked);
  }
  updateCounts();
}

function onReviewClick(event) {
  const remove = event.target.closest('[data-remove]');
  if (remove && state.current) {
    const key = remove.dataset.remove;
    const index = Number(remove.dataset.index);
    if (Array.isArray(state.current.result[key])) {
      state.current.result[key].splice(index, 1);
      markDirty();
      renderReview();
    }
    return;
  }

  const add = event.target.closest('[data-add]');
  if (add && state.current) {
    const kind = add.dataset.add;
    const result = state.current.result;
    if (kind === 'attendee') result.attendees.push({ name: '', role: '' });
    if (kind === 'topic') result.topics.push({ title: 'New topic', summary: '', points: [], decisions: [], followUps: [] });
    if (kind === 'decision') result.decisions.push({ decision: '', rationale: '', owner: '' });
    if (kind === 'risk') result.risks.push({ risk: '', impact: '', mitigation: '', owner: '' });
    if (kind === 'action') {
      result.actionItems.push({
        id: `a${Date.now()}`,
        task: '',
        owner: '',
        dueDate: '',
        priority: 'medium',
        status: 'open',
        context: '',
      });
    }
    markDirty();
    renderReview();
    const maps = { attendee: 'attendees', topic: 'topics', decision: 'decisions', risk: 'risks', action: 'actionItems' };
    const list = result[maps[kind]];
    const last = list.length - 1;
    const selector =
      kind === 'attendee'
        ? `[data-path="attendees.${last}.name"]`
        : kind === 'topic'
          ? `[data-path="topics.${last}.title"]`
          : kind === 'decision'
            ? `[data-path="decisions.${last}.decision"]`
            : kind === 'risk'
              ? `[data-path="risks.${last}.risk"]`
              : `[data-path="actionItems.${last}.task"]`;
    $(selector)?.focus();
    return;
  }

  const open = event.target.closest('[data-open]');
  if (open) location.hash = `#/meeting/${open.dataset.open}`;

  const del = event.target.closest('[data-delete]');
  if (del) {
    event.stopPropagation();
    deleteMeeting(del.dataset.delete);
  }
}

async function deleteMeeting(id) {
  const meeting = state.meetings.find((m) => m.id === id);
  const confirmed = await confirmDelete(`Delete “${meeting?.title || 'this meeting'}”? This cannot be undone.`);
  if (!confirmed) return;
  try {
    await api.del(`/api/meetings/${id}`);
    state.meetings = state.meetings.filter((m) => m.id !== id);
    if (state.current?.id === id) state.current = null;
    renderLibrary();
    toast('Meeting deleted.', 'success');
    if (state.route === 'review') location.hash = '#/library';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function updateCounts() {
  if (!state.current) return;
  const result = state.current.result;
  const counts = { attendees: result.attendees.length, decisions: result.decisions.length, actionItems: result.actionItems.length, risks: result.risks.length, topics: result.topics.length };
  $$('[data-count-for]').forEach((el) => {
    const value = counts[el.dataset.countFor];
    if (value != null) el.textContent = String(value);
  });
}

function metaItem(label, path, value, format = '') {
  return `<div class="meta-item">
    <label>${label}</label>
    <input class="r-input" type="text" data-path="${path}"${format ? ` data-format="${format}"` : ''} value="${esc(value ?? '')}" placeholder="—">
  </div>`;
}

function section(num, title, body, count) {
  return `<section class="report-section">
    <div class="section-head">
      <span class="section-num">${num}</span>
      <h2>${title}</h2>
      ${count != null ? `<span class="count-pill" data-count-for="${count}"></span>` : ''}
    </div>
    ${body}
  </section>`;
}

function renderReview() {
  const meeting = state.current;
  if (!meeting?.result) return;
  const r = meeting.result;

  const hero = `<div class="report-hero">
    <div class="hero-topline">Meeting report</div>
    <input class="hero-title" data-path="title" value="${esc(r.title || meeting.title)}" aria-label="Report title" />
    <div class="meta-grid">
      ${metaItem('Date', 'date', r.date)}
      ${metaItem('Time', 'time', r.time)}
      ${metaItem('Duration (min)', 'durationMinutes', r.durationMinutes, 'number')}
      ${metaItem('Location', 'location', r.location)}
      ${metaItem('Organiser', 'organizer', r.organizer)}
      ${metaItem('Objective', 'objective', r.objective)}
    </div>
    <div class="tag-line">
      <span>TAGS</span>
      <input data-path="tags" data-format="tags" value="${esc((r.tags || []).join(', '))}" placeholder="Add tags, comma separated">
    </div>
  </div>`;

  const summary = section(
    1,
    'Executive summary',
    `<textarea class="r-textarea lead" data-path="summary.overview" placeholder="What happened in this meeting?">${esc(r.summary?.overview)}</textarea>
     <span class="field-label">Key takeaways · one per line</span>
     <textarea class="r-textarea lines" data-path="summary.highlights" data-format="lines" placeholder="The decisions that matter…">${esc((r.summary?.highlights || []).join('\n'))}</textarea>`,
  );

  const attendees = section(
    2,
    'Attendees',
    `<div class="person-list">
      ${r.attendees
        .map(
          (person, index) => `<div class="person-row">
            <input class="r-input" data-path="attendees.${index}.name" value="${esc(person.name)}" placeholder="Name" aria-label="Name">
            <input class="r-input" data-path="attendees.${index}.role" value="${esc(person.role)}" placeholder="Role or team" aria-label="Role">
            <button class="remove-btn" data-remove="attendees" data-index="${index}" title="Remove attendee" aria-label="Remove attendee">
              <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
            </button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" data-add="attendee"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add attendee</button>`,
    'attendees',
  );

  const agenda = section(
    3,
    'Agenda',
    `<textarea class="r-textarea lines" data-path="agenda" data-format="lines" placeholder="One agenda item per line…">${esc((r.agenda || []).join('\n'))}</textarea>`,
  );

  const discussion = section(
    4,
    'Discussion',
    `<div class="topic-list">
      ${r.topics
        .map(
          (topic, index) => `<div class="topic-card">
            <div class="topic-head">
              <span class="section-num">${index + 1}</span>
              <input class="r-input" data-path="topics.${index}.title" value="${esc(topic.title)}" placeholder="Topic title">
              <button class="remove-btn" data-remove="topics" data-index="${index}" title="Remove topic" aria-label="Remove topic">
                <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
              </button>
            </div>
            <textarea class="r-textarea" data-path="topics.${index}.summary" placeholder="Short summary of this topic">${esc(topic.summary)}</textarea>
            <span class="field-label">Points · one per line</span>
            <textarea class="r-textarea lines" data-path="topics.${index}.points" data-format="lines" placeholder="What was said…">${esc((topic.points || []).join('\n'))}</textarea>
            <span class="field-label">Decisions in this topic</span>
            <textarea class="r-textarea lines" data-path="topics.${index}.decisions" data-format="lines" placeholder="One decision per line…">${esc((topic.decisions || []).join('\n'))}</textarea>
            <span class="field-label">Follow-ups</span>
            <textarea class="r-textarea lines" data-path="topics.${index}.followUps" data-format="lines" placeholder="One follow-up per line…">${esc((topic.followUps || []).join('\n'))}</textarea>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" data-add="topic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add topic</button>`,
    'topics',
  );

  const decisions = section(
    5,
    'Decisions',
    `<div class="decision-list">
      ${r.decisions
        .map(
          (decision, index) => `<div class="item-row">
            <div class="sub-field">
              <label>Decision</label>
              <textarea class="r-textarea" data-path="decisions.${index}.decision" placeholder="What was decided">${esc(decision.decision)}</textarea>
              <label>Rationale</label>
              <textarea class="r-textarea" data-path="decisions.${index}.rationale" placeholder="Why">${esc(decision.rationale)}</textarea>
            </div>
            <div class="sub-field">
              <label>Owner</label>
              <input class="r-input" data-path="decisions.${index}.owner" value="${esc(decision.owner)}" placeholder="Who decided">
            </div>
            <button class="remove-btn" data-remove="decisions" data-index="${index}" title="Remove decision" aria-label="Remove decision">
              <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
            </button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" data-add="decision"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add decision</button>`,
    'decisions',
  );

  const actions = section(
    6,
    'Action items',
    `<div class="action-table">
      <div class="action-row head">
        <span>Done</span><span>Action</span><span>Owner</span><span>Due</span><span>Priority</span><span></span>
      </div>
      ${r.actionItems
        .map(
          (item, index) => `<div class="action-row${item.status === 'done' ? ' done' : ''}">
            <input class="done-box" type="checkbox" data-path="actionItems.${index}.status" data-format="status" ${item.status === 'done' ? 'checked' : ''} aria-label="Done">
            <span class="action-task">
              <input data-path="actionItems.${index}.task" value="${esc(item.task)}" placeholder="What needs doing">
              <input class="context" data-path="actionItems.${index}.context" value="${esc(item.context)}" placeholder="Context (optional)">
            </span>
            <input data-path="actionItems.${index}.owner" value="${esc(item.owner)}" placeholder="Unassigned" aria-label="Owner">
            <input data-path="actionItems.${index}.dueDate" value="${esc(item.dueDate)}" placeholder="Due" aria-label="Due date">
            <select class="priority-select" data-path="actionItems.${index}.priority" aria-label="Priority">
              <option value=""${!item.priority ? ' selected' : ''}>—</option>
              <option value="high"${item.priority === 'high' ? ' selected' : ''}>High</option>
              <option value="medium"${item.priority === 'medium' ? ' selected' : ''}>Medium</option>
              <option value="low"${item.priority === 'low' ? ' selected' : ''}>Low</option>
            </select>
            <button class="remove-btn" data-remove="actionItems" data-index="${index}" title="Remove action" aria-label="Remove action">
              <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
            </button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" data-add="action"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add action item</button>`,
    'actionItems',
  );

  const risks = section(
    7,
    'Risks and blockers',
    `<div class="risk-list">
      ${r.risks
        .map(
          (risk, index) => `<div class="item-row">
            <div class="sub-field">
              <label>Risk</label>
              <textarea class="r-textarea" data-path="risks.${index}.risk" placeholder="What could go wrong">${esc(risk.risk)}</textarea>
              <label>Mitigation</label>
              <textarea class="r-textarea" data-path="risks.${index}.mitigation" placeholder="How to reduce it">${esc(risk.mitigation)}</textarea>
            </div>
            <div class="sub-field">
              <label>Impact</label>
              <input class="r-input" data-path="risks.${index}.impact" value="${esc(risk.impact)}" placeholder="Severity or consequence">
              <label>Owner</label>
              <input class="r-input" data-path="risks.${index}.owner" value="${esc(risk.owner)}" placeholder="Who owns it">
            </div>
            <button class="remove-btn" data-remove="risks" data-index="${index}" title="Remove risk" aria-label="Remove risk">
              <svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>
            </button>
          </div>`,
        )
        .join('')}
    </div>
    <button class="add-btn" data-add="risk"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add risk</button>`,
    'risks',
  );

  const questions = section(
    8,
    'Open questions',
    `<textarea class="r-textarea lines" data-path="openQuestions" data-format="lines" placeholder="One open question per line…">${esc((r.openQuestions || []).join('\n'))}</textarea>`,
  );

  const next = section(
    9,
    'Next steps',
    `<div class="meta-grid" style="border-top:0;padding-top:0;margin-top:0">
      ${metaItem('Next meeting', 'nextMeeting.date', r.nextMeeting?.date)}
      ${metaItem('Focus', 'nextMeeting.focus', r.nextMeeting?.focus)}
      ${metaItem('Preparation', 'nextMeeting.prep', r.nextMeeting?.prep)}
    </div>`,
  );

  const stats = meeting.stats;
  const statsCard = `<div class="stats-card">
    ${stats ? `<span>Generated in <strong>${formatDuration(stats.elapsedMs)}</strong></span>` : ''}
    <span>Model <strong>${esc(modelLabel(meeting.model || stats?.model))}</strong></span>
    ${stats?.words ? `<span><strong>${stats.words.toLocaleString('en-GB')}</strong> words analysed</span>` : ''}
    ${stats?.chunks > 1 ? `<span>Condensed from <strong>${stats.chunks}</strong> parts</span>` : ''}
    ${
      stats?.warnings?.length
        ? `<ul class="warn-list">${stats.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
        : ''
    }
  </div>`;

  $('#review-body').innerHTML = hero + summary + attendees + agenda + discussion + decisions + actions + risks + questions + next + statsCard;
  updateCounts();
  setSaveState(state.dirty ? 'Unsaved' : 'Saved', state.dirty ? '' : 'saved');
  document.title = `${meeting.title} — mefile`;
}

async function exportReport(kind, preview = false) {
  if (!state.current) return;
  await saveNow(true);
  const id = state.current.id;
  if (kind === 'markdown') {
    const anchor = document.createElement('a');
    anchor.href = `/api/meetings/${id}/markdown`;
    anchor.download = '';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast('Markdown downloaded.', 'success');
    return;
  }
  const url = `/api/meetings/${id}/pdf${preview ? '?inline=1' : ''}`;
  if (preview) {
    window.open(url, '_blank', 'noopener');
  } else {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast('PDF downloaded.', 'success');
  }
}

/* ------------------------------------------------------------------ */
/* confirm modal                                                       */
/* ------------------------------------------------------------------ */

let confirmResolve = null;

function confirmDelete(message) {
  const backdrop = $('#confirm-modal');
  const msg = $('#confirm-message');
  const ok = $('#confirm-ok');
  const cancel = $('#confirm-cancel');
  if (!backdrop) return Promise.resolve(window.confirm(message));
  msg.textContent = message;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const cleanup = (result) => {
      backdrop.hidden = true;
      document.body.style.overflow = '';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      confirmResolve = null;
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === backdrop) cleanup(false);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
  });
}

/* ------------------------------------------------------------------ */
/* settings view                                                       */
/* ------------------------------------------------------------------ */

function renderDetectedServers() {
  const container = $('#detected-servers');
  if (!container) return;
  if (!state.providers.length) {
    container.innerHTML = `<p class="muted small" style="margin:0">No local servers detected. Start Ollama and press “Find servers”.</p>`;
    return;
  }
  container.innerHTML = state.providers
    .map(
      (provider) => `<div class="detected-server">
        <span><strong>${esc(provider.name)}</strong> <span class="muted">${esc(provider.origin)} · ${
          provider.models?.length || 0
        } model${provider.models?.length === 1 ? '' : 's'}</span></span>
        <button class="btn ghost small" data-use-origin="${esc(provider.origin)}" data-use-provider="${esc(provider.id)}">Use</button>
      </div>`,
    )
    .join('');

  $$('[data-use-origin]', container).forEach((button) => {
    button.addEventListener('click', () => {
      $('#settings-baseurl').value = button.dataset.useOrigin;
      $('#settings-provider').value = button.dataset.useProvider;
      loadModels(true).catch((err) => toast(err.message, 'error'));
      toast('Server selected. Save to keep it.', 'success');
    });
  });
}
