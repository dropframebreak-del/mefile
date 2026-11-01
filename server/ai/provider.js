const PROBES = [
  { id: 'ollama', name: 'Ollama', origin: 'http://127.0.0.1:11434', kind: 'ollama' },
  { id: 'lmstudio', name: 'LM Studio', origin: 'http://127.0.0.1:1234', kind: 'openai' },
  { id: 'llamacpp', name: 'llama.cpp', origin: 'http://127.0.0.1:8080', kind: 'openai' },
  { id: 'jan', name: 'Jan', origin: 'http://127.0.0.1:1337', kind: 'openai' },
  { id: 'vllm', name: 'vLLM', origin: 'http://127.0.0.1:8000', kind: 'openai' },
];

export class AiError extends Error {
  constructor(message, code = 'ai_error', status = 502) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeOrigin(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, '');
  value = value.replace(/\/v1$/i, '');
  value = value.replace(/\/api\/?$/i, '');
  return value;
}

export function inferKind(origin, providerId = '') {
  if (providerId === 'ollama') return 'ollama';
  if (providerId && providerId !== 'custom') {
    const known = PROBES.find((p) => p.id === providerId);
    if (known) return known.kind;
  }
  try {
    const url = new URL(origin);
    if (url.port === '11434') return 'ollama';
  } catch {
    /* ignore */
  }
  return 'openai';
}

async function getJson(url, timeoutMs = 2000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function listModels(origin, kind = 'ollama') {
  const base = normalizeOrigin(origin);
  if (!base) throw new AiError('No server address configured.', 'no_base', 400);

  if (kind === 'ollama') {
    const data = await getJson(`${base}/api/tags`, 4000).catch(async (err) => {
      // Some proxies expose only the OpenAI surface.
      if (err?.name === 'TimeoutError') throw new AiError('The AI server did not respond in time.', 'timeout', 504);
      return getJson(`${base}/v1/models`, 4000);
    });
    const models = Array.isArray(data.models)
      ? data.models.map((m) => ({
          id: m.name || m.model,
          name: m.name || m.model,
          size: m.size || 0,
          parameterSize: m.details?.parameter_size || '',
          family: m.details?.family || '',
        }))
      : Array.isArray(data.data)
        ? data.data.map((m) => ({ id: m.id, name: m.id, size: 0, parameterSize: '', family: '' }))
        : [];
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }

  const data = await getJson(`${base}/v1/models`, 4000);
  const models = Array.isArray(data.data)
    ? data.data.map((m) => ({ id: m.id, name: m.id, size: 0, parameterSize: '', family: '' }))
    : Array.isArray(data.models)
      ? data.models.map((m) => ({ id: m.name || m.model, name: m.name || m.model, size: 0, parameterSize: '', family: '' }))
      : [];
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function detectProviders() {
  const checks = PROBES.map(async (probe) => {
    try {
      const models = await listModels(probe.origin, probe.kind);
      return { ...probe, online: true, models };
    } catch {
      return { ...probe, online: false, models: [] };
    }
  });
  const providers = await Promise.all(checks);
  return providers.filter((p) => p.online);
}

export async function probeServer(origin, providerId = 'custom') {
  const kind = inferKind(origin, providerId);
  const models = await listModels(origin, kind);
  return { origin: normalizeOrigin(origin), kind, models };
}

function friendlyNetworkError(err, origin) {
  if (err?.name === 'TimeoutError' || err?.code === 'AI_TIMEOUT') {
    return new AiError(
      `The AI server at ${origin} did not respond in time. A long meeting can take a few minutes on a laptop GPU.`,
      'timeout',
      504,
    );
  }
  if (err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED') {
    return new AiError(
      `Cannot reach the AI server at ${origin}. Start it (for example run "ollama serve") and try again.`,
      'unreachable',
      503,
    );
  }
  if (err instanceof AiError) return err;
  return new AiError(`AI request failed: ${err?.message || err}`, 'network', 502);
}

/**
 * Chat completion across Ollama's native API and any OpenAI-compatible server.
 */
export async function chat({ origin, model, messages, temperature = 0.2, numCtx = 8192, json = true, maxTokens = 3000, signal, timeoutMs = 600000, providerId = '' }) {
  const base = normalizeOrigin(origin);
  if (!base) throw new AiError('No AI server configured. Open Settings and add one.', 'no_base', 400);
  if (!model) throw new AiError('No model selected. Open Settings and pick a model.', 'no_model', 400);

  const kind = inferKind(base, providerId);
  const url = kind === 'ollama' ? `${base}/api/chat` : `${base}/v1/chat/completions`;

  const body =
    kind === 'ollama'
      ? {
          model,
          messages,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          options: {
            temperature,
            num_ctx: numCtx,
            num_predict: maxTokens,
          },
        }
      : {
          model,
          messages,
          stream: false,
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        };

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw new AiError('Generation cancelled.', 'cancelled', 499);
    throw friendlyNetworkError(err, base);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let hint = '';
    if (res.status === 404 && /model/i.test(detail)) hint = ' The selected model may have been removed. Pull it again or pick another.';
    if (res.status === 400 && /context/i.test(detail)) hint = ' The notes may be too long for this model context window.';
    throw new AiError(
      `The AI server returned HTTP ${res.status}.${hint} ${detail.slice(0, 400)}`.trim(),
      'http_error',
      502,
    );
  }

  const data = await res.json();
  const content =
    kind === 'ollama'
      ? data?.message?.content ?? data?.response ?? ''
      : data?.choices?.[0]?.message?.content ?? '';

  if (!content || !String(content).trim()) {
    throw new AiError('The model returned an empty response. Try again, or pick a different model.', 'empty', 502);
  }

  return {
    content: String(content),
    model: data.model || model,
    usage: data.usage || null,
    evalCount: data.eval_count || null,
    promptCount: data.prompt_eval_count || null,
    doneReason:
      kind === 'ollama'
        ? data.done_reason || null
        : data?.choices?.[0]?.finish_reason || null,
  };
}
