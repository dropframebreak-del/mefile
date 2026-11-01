import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeNotes, estimateTokens, splitChunks, countWords } from '../server/ai/text.js';

test('strips WebVTT timestamps and headers but keeps speakers', () => {
  const raw = fs.readFileSync(path.join(import.meta.dirname, '..', 'samples', 'sample-transcript.vtt'), 'utf8');
  const clean = normalizeNotes(raw);
  assert.ok(!clean.includes('WEBVTT'));
  assert.ok(!clean.includes('-->'));
  assert.ok(!clean.includes('00:00:02.000'));
  assert.ok(clean.includes('Priya (Product Lead):'));
  assert.ok(clean.includes('idempotency keys'));
  assert.ok(clean.length > 500);
});

test('strips SRT indices and cue settings', () => {
  const raw = '1\n00:00:01,000 --> 00:00:03,000\nalign:start\nAlice: hello\n\n2\n00:00:04,000 --> 00:00:06,000\nBob: hi';
  const clean = normalizeNotes(raw);
  assert.equal(clean, 'Alice: hello\nBob: hi');
});

test('removes inline timestamp prefixes', () => {
  assert.equal(normalizeNotes('[00:01:22] We agreed on Friday.'), 'We agreed on Friday.');
  assert.equal(normalizeNotes('(12:04) Next item is budget.'), 'Next item is budget.');
});

test('collapses runaway blank lines and control characters', () => {
  const clean = normalizeNotes('A\n\n\n\n\nB\u0007');
  assert.equal(clean, 'A\n\nB');
});

test('estimates tokens from characters', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('a'.repeat(360)) >= 100);
});

test('splits long text into overlapping chunks within the limit', () => {
  const paragraph = `${'word '.repeat(200)}\n\n`;
  const text = paragraph.repeat(20);
  const chunks = splitChunks(text, 4000, 300);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 4600, `chunk too large: ${chunk.length}`);
  assert.ok(chunks.join('\n').includes('word'));
});

test('keeps short text in one chunk', () => {
  assert.deepEqual(splitChunks('short notes', 4000), ['short notes']);
});

test('counts words', () => {
  assert.equal(countWords('one two  three\nfour'), 4);
});
