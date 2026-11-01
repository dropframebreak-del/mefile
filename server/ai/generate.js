import { normalizeNotes, estimateTokens, splitChunks, countWords } from './text.js';
import {
  buildExtractionSystem,
  buildExtractionUser,
  buildChunkSystem,
  buildChunkUser,
  buildRepairSystem,
  buildRepairUser,
  buildReviewSystem,
  buildReviewUser,
} from './prompts.js';
import { coerceResult, isMeaningful, mergeResult } from './schema.js';
import { extractJson, snippet } from './parse.js';
import { chat, AiError } from './provider.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function runExtraction({ notes, settings, signal }) {
  return chat({
    origin: settings.baseUrl,
    providerId: settings.provider,
    model: settings.model,
    messages: [
      { role: 'system', content: buildExtractionSystem(today()) },
      { role: 'user', content: buildExtractionUser(notes) },
    ],
    temperature: settings.temperature,
    numCtx: settings.numCtx,
    json: true,
    maxTokens: 4096,
    signal,
    timeoutMs: 600000,
  });
}

/**
 * Main pipeline: normalise, optionally condense, extract, repair, review.
 * `onPhase(phase, detail, percent)` powers the live status in the UI.
 */
export async function generateReport({ notes, settings, onPhase = () => {}, signal, meta = {} }) {
  const startedAt = Date.now();
  const warnings = [];
  let usage = null;

  onPhase('reading', 'Reading and cleaning your notes', 5);
  const normalized = normalizeNotes(notes);
  if (!normalized) {
    throw new AiError('There is nothing to analyse yet. Paste some meeting notes first.', 'empty_notes', 400);
  }
  if (normalized.length < 40) {
    warnings.push('The notes are very short, so the report will be brief.');
  }

  const tokenCount = estimateTokens(normalized);
  const maxChars = Math.min(18000, Math.max(6000, settings.numCtx * 3));
  let workingNotes = normalized;
  let chunks = 1;

  if (normalized.length > maxChars) {
    onPhase('condensing', 'Long transcript detected — condensing it in parts', 12);
    const parts = splitChunks(normalized, maxChars);
    chunks = parts.length;
    const summaries = [];
    for (let i = 0; i < parts.length; i += 1) {
      const percent = 12 + Math.round(((i + 1) / parts.length) * 30);
      onPhase('condensing', `Condensing part ${i + 1} of ${parts.length}`, percent);
      const response = await chat({
        origin: settings.baseUrl,
        providerId: settings.provider,
        model: settings.model,
        messages: [
          { role: 'system', content: buildChunkSystem() },
          { role: 'user', content: buildChunkUser(parts[i], i, parts.length) },
        ],
        temperature: 0.1,
        numCtx: settings.numCtx,
        json: false,
        maxTokens: 900,
        signal,
        timeoutMs: 600000,
      });
      summaries.push(`--- Part ${i + 1} ---\n${response.content.trim()}`);
    }
    workingNotes = summaries.join('\n\n');
    warnings.push(`Transcript was condensed from ${chunks} parts before analysis.`);
  }

  onPhase('analyzing', 'Finding decisions, action items and owners', 50);
  const first = await runExtraction({ notes: workingNotes, settings, signal });
  usage = first.usage;

  let parsed = extractJson(first.content);
  let coerced = parsed ? coerceResult(parsed) : { value: null, issues: [], fatal: 'The response was not valid JSON.' };
  let attempts = 0;

  while ((!parsed || coerced.fatal || !isMeaningful(coerced.value)) && attempts < 2) {
    attempts += 1;
    onPhase('repairing', 'The model returned malformed JSON — asking it to fix it', 58 + attempts * 4);
    const error = coerced.fatal || (coerced.issues || []).join(' ') || 'Output did not contain a valid report.';
    const repair = await chat({
      origin: settings.baseUrl,
      providerId: settings.provider,
      model: settings.model,
      messages: [
        { role: 'system', content: buildRepairSystem(today()) },
        { role: 'user', content: buildRepairUser(snippet(first.content, 6000), error, workingNotes) },
      ],
      temperature: 0.1,
      numCtx: settings.numCtx,
      json: true,
      maxTokens: 4096,
      signal,
      timeoutMs: 600000,
    });
    parsed = extractJson(repair.content);
    coerced = parsed ? coerceResult(parsed) : { value: null, issues: [], fatal: 'The repair attempt was not valid JSON.' };
    usage = repair.usage || usage;
  }

  if (!parsed || coerced.fatal || !isMeaningful(coerced.value)) {
    throw new AiError(
      `The model could not produce a usable report. ${coerced.fatal || 'Try a larger model, or shorten the notes.'}`,
      'invalid_output',
      502,
    );
  }

  let result = coerced.value;
  warnings.push(...coerced.issues);

  if (first.doneReason === 'length') {
    warnings.push('The model ran out of output space, so the report may be missing items. Turn on Thorough review or use a shorter note set.');
  } else if (result.actionItems.length === 0 && result.decisions.length === 0) {
    warnings.push('No action items or decisions were found. Check the notes really contain them, or try Thorough review.');
  }

  if (settings.thorough) {
    onPhase('reviewing', 'Checking for missed action items and decisions', 78);
    try {
      const review = await chat({
        origin: settings.baseUrl,
        providerId: settings.provider,
        model: settings.model,
        messages: [
          { role: 'system', content: buildReviewSystem(today()) },
          { role: 'user', content: buildReviewUser(workingNotes, result) },
        ],
        temperature: 0.1,
        numCtx: settings.numCtx,
        json: true,
        maxTokens: 1800,
        signal,
        timeoutMs: 600000,
      });
      const additions = extractJson(review.content);
      if (additions && typeof additions === 'object') {
        const before = result.actionItems.length;
        result = mergeResult(result, additions);
        if (result.actionItems.length > before) {
          warnings.push(`Review pass added ${result.actionItems.length - before} action item(s).`);
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      warnings.push(`Review pass skipped: ${err.message}`);
    }
  }

  onPhase('saving', 'Saving your meeting', 94);
  const stats = {
    elapsedMs: Date.now() - startedAt,
    chars: normalized.length,
    words: countWords(normalized),
    tokensEstimate: tokenCount,
    chunks,
    model: first.model || settings.model,
    usage,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  };

  return { result, stats };
}
