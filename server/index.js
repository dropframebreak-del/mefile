import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { PUBLIC_DIR, PORT, HOST, DATA_DIR, ROOT } from './config.js';
import {
  listMeetings,
  getMeeting,
  saveMeeting,
  deleteMeeting,
  makeId,
  getSettings,
  saveSettings,
  isValidId,
} from './store.js';
import { detectProviders, probeServer, listModels, normalizeOrigin, AiError } from './ai/provider.js';
import { generateReport } from './ai/generate.js';
import { coerceResult } from './ai/schema.js';
import { renderPdf, pdfFilename } from './pdf/render.js';
import { renderMarkdown, markdownFilename } from './markdown.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const activeRuns = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

function apiError(res, status, message, code = 'error') {
  return res.status(status).json({ error: message, code });
}

function requireMeeting(req, res) {
  if (!isValidId(req.params.id)) {
    apiError(res, 400, 'Invalid meeting id.', 'bad_id');
    return null;
  }
  const meeting = getMeeting(req.params.id);
  if (!meeting) {
    apiError(res, 404, 'Meeting not found.', 'not_found');
    return null;
  }
  return meeting;
}

function pickSettings(body = {}) {
  const current = getSettings();
  const next = { ...current };
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) next.baseUrl = normalizeOrigin(body.baseUrl);
  if (typeof body.provider === 'string') next.provider = body.provider;
  if (typeof body.model === 'string') next.model = body.model.trim();
  if (body.temperature != null && Number.isFinite(Number(body.temperature))) {
    next.temperature = Math.min(1, Math.max(0, Number(body.temperature)));
  }
  if (typeof body.thorough === 'boolean') next.thorough = body.thorough;
  if (body.numCtx != null && Number(body.numCtx) >= 2048) next.numCtx = Number(body.numCtx);
  return next;
}

async function ensureModel(settings) {
  if (settings.model) return settings;
  try {
    const models = await listModels(settings.baseUrl, settings.provider === 'ollama' ? 'ollama' : 'openai');
    if (models.length) {
      const preferred = models.find((m) => /qwen2\.5.*7b|llama3\.1.*8b|mistral.*7b/i.test(m.name)) || models[0];
      settings.model = preferred.id;
      saveSettings({ model: settings.model });
    }
  } catch {
    /* surfaced by generation call */
  }
  return settings;
}

app.get('/api/health', async (req, res) => {
  const settings = getSettings();
  let online = false;
  try {
    const models = await Promise.race([
      listModels(settings.baseUrl, settings.provider === 'ollama' ? 'ollama' : 'openai'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1800)),
    ]);
    online = Array.isArray(models);
  } catch {
    online = false;
  }
  res.json({
    ok: true,
    ai: { online, provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl },
    dataDir: DATA_DIR,
  });
});

app.get('/api/providers', async (req, res, next) => {
  try {
    const providers = await detectProviders();
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});

app.get('/api/models', async (req, res, next) => {
  try {
    const settings = getSettings();
    const origin = req.query.baseUrl || settings.baseUrl;
    const kind = req.query.provider === 'ollama' || settings.provider === 'ollama' ? 'ollama' : 'openai';
    const models = await listModels(origin, kind);
    res.json({ models, baseUrl: normalizeOrigin(origin) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/ai/test', async (req, res, next) => {
  try {
    const settings = pickSettings(req.body);
    const probe = await probeServer(settings.baseUrl, settings.provider);
    res.json({ ok: true, ...probe });
  } catch (err) {
    next(err);
  }
});

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  res.json(saveSettings(pickSettings(req.body)));
});

app.get('/api/meetings', (req, res) => {
  res.json({ meetings: listMeetings() });
});

app.post('/api/meetings', (req, res) => {
  const { notes = '', filename = '', title = '' } = req.body || {};
  if (typeof notes !== 'string' || !notes.trim()) {
    return apiError(res, 400, 'Paste some meeting notes to get started.', 'empty_notes');
  }
  if (notes.length > 400000) {
    return apiError(res, 413, 'These notes are too long. Split the meeting into smaller parts.', 'too_long');
  }
  const now = new Date().toISOString();
  const meeting = {
    id: makeId(title || filename),
    title: title || filename || 'Untitled meeting',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    model: '',
    source: { notes, filename, chars: notes.length },
    result: null,
    stats: null,
    error: null,
  };
  saveMeeting(meeting);
  res.status(201).json(meeting);
});

app.get('/api/meetings/:id', (req, res) => {
  const meeting = requireMeeting(req, res);
  if (!meeting) return;
  res.json(meeting);
});

app.put('/api/meetings/:id', (req, res) => {
  const meeting = requireMeeting(req, res);
  if (!meeting) return;
  const body = req.body || {};
  if (typeof body.title === 'string' && body.title.trim()) meeting.title = body.title.trim().slice(0, 180);
  if (typeof body.notes === 'string' && body.notes.trim()) {
    meeting.source = { ...meeting.source, notes: body.notes, chars: body.notes.length };
  }
  if (body.result && typeof body.result === 'object') {
    const { value, fatal } = coerceResult(body.result);
    if (fatal) return apiError(res, 400, fatal, 'invalid_result');
    meeting.result = value;
    meeting.title = value.title || meeting.title;
  }
  if (body.status === 'done' || body.status === 'draft') meeting.status = body.status;
  saveMeeting(meeting);
  res.json(meeting);
});

app.delete('/api/meetings/:id', (req, res) => {
  const meeting = requireMeeting(req, res);
  if (!meeting) return;
  activeRuns.get(meeting.id)?.abort();
  activeRuns.delete(meeting.id);
  deleteMeeting(meeting.id);
  res.json({ ok: true });
});

app.post('/api/meetings/:id/cancel', (req, res) => {
  const controller = activeRuns.get(req.params.id);
  if (controller) {
    controller.abort();
    return res.json({ ok: true, cancelled: true });
  }
  res.json({ ok: true, cancelled: false });
});

app.post('/api/meetings/:id/generate', async (req, res) => {
  const meeting = requireMeeting(req, res);
  if (!meeting) return;
  if (activeRuns.has(meeting.id)) {
    return apiError(res, 409, 'This meeting is already being analysed.', 'busy');
  }

  const body = req.body || {};
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes : meeting.source?.notes;
  if (!notes || !notes.trim()) {
    return apiError(res, 400, 'There are no notes to analyse.', 'empty_notes');
  }

  let settings = pickSettings(body);
  settings = await ensureModel(settings);
  if (!settings.model) {
    return apiError(
      res,
      400,
      'No AI model is available. Start Ollama and pull a model, or open Settings to connect a server.',
      'no_model',
    );
  }
  // Remember the choices made in the composer so the next run matches.
  saveSettings(settings);

  meeting.source = { ...(meeting.source || {}), notes, chars: notes.length };
  meeting.status = 'generating';
  meeting.error = null;
  meeting.model = settings.model;
  saveMeeting(meeting);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  activeRuns.set(meeting.id, controller);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 15000);

  let closed = false;
  req.on('close', () => {
    closed = true;
    if (!res.writableEnded) controller.abort();
  });

  try {
    const { result, stats } = await generateReport({
      notes,
      settings,
      signal: controller.signal,
      onPhase: (phase, detail, percent) => send('phase', { phase, detail, percent }),
      meta: { filename: meeting.source?.filename, generatedAt: meeting.createdAt },
    });

    meeting.result = result;
    meeting.stats = stats;
    meeting.status = 'ready';
    meeting.error = null;
    meeting.title = result.title || meeting.title;
    saveMeeting(meeting);
    send('done', { meeting });
  } catch (err) {
    const cancelled = err?.code === 'cancelled' || err?.name === 'AbortError' || controller.signal.aborted;
    if (cancelled) {
      meeting.status = 'draft';
      meeting.error = null;
      saveMeeting(meeting);
      send('cancelled', { message: 'Generation cancelled.' });
    } else {
      const message = err instanceof AiError ? err.message : `Unexpected error: ${err?.message || err}`;
      meeting.status = 'error';
      meeting.error = message;
      saveMeeting(meeting);
      send('error', { message, code: err?.code || 'error' });
    }
  } finally {
    clearInterval(heartbeat);
    activeRuns.delete(meeting.id);
    if (!res.writableEnded) res.end();
    if (closed) {
      /* client went away */
    }
  }
});

app.get('/api/meetings/:id/pdf', async (req, res, next) => {
  try {
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    if (!meeting.result) return apiError(res, 400, 'Analyse the meeting before exporting a PDF.', 'no_report');
    const buffer = await renderPdf(meeting);
    const name = pdfFilename(meeting.result);
    const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    next(err);
  }
});

app.get('/api/meetings/:id/markdown', (req, res) => {
  const meeting = requireMeeting(req, res);
  if (!meeting) return;
  if (!meeting.result) return apiError(res, 400, 'Analyse the meeting before exporting.', 'no_report');
  const name = markdownFilename(meeting.result);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(renderMarkdown(meeting));
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return apiError(res, 400, 'No file received.', 'no_file');
  const filename = req.file.originalname || 'notes.txt';
  const ext = path.extname(filename).toLowerCase();
  const allowed = new Set(['.txt', '.md', '.markdown', '.vtt', '.srt', '.json', '.log']);
  if (!allowed.has(ext)) {
    return apiError(res, 415, 'Use a text file (.txt, .md, .vtt, .srt or .json). Word and PDF files are not supported yet.', 'bad_type');
  }
  let text;
  try {
    text = req.file.buffer.toString('utf8');
    if (ext === '.json') {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          text = parsed
            .map((entry) => {
              if (typeof entry === 'string') return entry;
              if (entry && typeof entry === 'object') {
                const speaker = entry.speaker || entry.name || entry.user || '';
                const words = entry.text || entry.content || entry.message || '';
                return `${speaker ? `${speaker}: ` : ''}${words}`;
              }
              return '';
            })
            .filter(Boolean)
            .join('\n\n');
        }
      } catch {
        /* keep raw text */
      }
    }
  } catch {
    return apiError(res, 400, 'Could not read that file as text.', 'decode_failed');
  }
  if (!text.trim()) return apiError(res, 400, 'That file is empty.', 'empty_file');
  res.json({ filename, text, chars: text.length });
});

app.use('/samples', express.static(path.join(ROOT, 'samples'), { maxAge: 0 }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', etag: true, maxAge: 0 }));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const status = err instanceof AiError ? err.status : err.status || 500;
  const message = err?.message || 'Something went wrong.';
  if (status >= 500 && !(err instanceof AiError)) console.error('[error]', err);
  res.status(status).json({ error: message, code: err?.code || 'error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Meeting Notes → PDF');
  console.log(`  Running at  http://${HOST}:${PORT}`);
  console.log(`  Data       ${DATA_DIR}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

function shutdown() {
  for (const controller of activeRuns.values()) controller.abort();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
