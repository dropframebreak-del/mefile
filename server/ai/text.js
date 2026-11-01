/**
 * Text preparation for meeting notes and transcripts.
 * Keeps meaning, drops timestamp noise, and makes long input fit a local model.
 */

const TIMESTAMP_LINE = /^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3}).*$/;
const TIMESTAMP_PREFIX = /^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?\s*[-–—]?\s*/;
const CUE_NUMBER = /^\s*\d{1,5}\s*$/;

export function normalizeNotes(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // WebVTT header and metadata blocks
  text = text.replace(/^WEBVTT[^\n]*\n/i, '');
  text = text.replace(/^NOTE\b[\s\S]*?(?=\n\s*\n|$)/gim, '');

  const isCueFormat = /-->/.test(text);
  const lines = text.split('\n');
  const kept = [];
  let afterCue = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (TIMESTAMP_LINE.test(line)) {
      afterCue = true;
      continue;
    }
    if (afterCue) {
      if (!line.trim()) continue;
      // WebVTT cue settings occasionally land on their own line.
      if (/^\s*(align|position|line|size|vertical|region):/i.test(line)) continue;
      afterCue = false;
    }
    if (CUE_NUMBER.test(line) && TIMESTAMP_LINE.test(lines[i + 1] || '')) continue;
    if (/^\s*(Kind|Language):\s*/i.test(line)) continue;
    kept.push(line.replace(TIMESTAMP_PREFIX, ''));
  }

  text = kept.join('\n');
  if (isCueFormat) text = text.replace(/\n{2,}/g, '\n');
  // Collapse 3+ blank lines, strip trailing spaces, remove control chars except newline/tab.
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');

  return text.trim();
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}

function splitSentences(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) || [paragraph];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Split text into chunks that comfortably fit the model context.
 * Chunks break on paragraph boundaries when possible and overlap slightly
 * so a decision split across a boundary is not lost.
 */
export function splitChunks(text, maxChars = 15000, overlapChars = 600) {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/).flatMap((p) => splitSentences(p, maxChars));
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      chunks.push(current.trim());
      const tail = current.slice(-overlapChars);
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';
  return `${text.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n\n[...truncated...]`;
}

/** Rough readable word count for the UI. */
export function countWords(text) {
  if (!text) return 0;
  return (text.match(/\S+/g) || []).length;
}
