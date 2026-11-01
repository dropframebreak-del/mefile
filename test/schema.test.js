import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceResult, mergeResult, isMeaningful } from '../server/ai/schema.js';
import { extractJson } from '../server/ai/parse.js';

test('normalises a messy model payload', () => {
  const { value, fatal } = coerceResult({
    title: 'Design sync',
    attendees: ['Alice (PM)', { name: 'Bob' }, null],
    summary: ['We agreed on the layout.', 'Bob will build it.'],
    actionItems: [
      'Build the new layout',
      { action: 'Send specs', assignee: 'Alice', due: 'Friday', importance: 'URGENT' },
      { task: 'Build the new layout' },
    ],
    decisions: [{ description: 'Use the two-column layout', reason: 'Better scanability' }],
    risks: ['Timeline is tight'],
    nextMeeting: 'Next Tuesday',
  });

  assert.equal(fatal, null);
  assert.equal(value.title, 'Design sync');
  assert.equal(value.attendees.length, 2);
  assert.equal(value.attendees[0].name, 'Alice');
  assert.equal(value.attendees[0].role, 'PM');
  assert.equal(value.attendees[1].role, '');
  assert.equal(value.summary.overview, 'We agreed on the layout.\n\nBob will build it.');
  assert.equal(value.actionItems.length, 2, 'duplicate action should be removed');
  assert.equal(value.actionItems[1].owner, 'Alice');
  assert.equal(value.actionItems[1].priority, 'high');
  assert.equal(value.decisions[0].rationale, 'Better scanability');
  assert.equal(value.risks[0].risk, 'Timeline is tight');
  assert.equal(value.nextMeeting.date, 'Next Tuesday');
});

test('unwraps nested meeting objects', () => {
  const { value } = coerceResult({ meeting: { title: 'Nested', summary: { overview: 'ok' } } });
  assert.equal(value.title, 'Nested');
  assert.equal(value.summary.overview, 'ok');
});

test('rejects a completely empty payload', () => {
  const { fatal } = coerceResult({ title: '', attendees: [], summary: {}, actionItems: [] });
  assert.ok(fatal);
  assert.equal(isMeaningful(coerceResult({}).value), false);
});

test('survives non-object payloads', () => {
  assert.ok(coerceResult('hello').fatal);
  assert.ok(coerceResult(null).fatal);
  assert.ok(coerceResult([]).fatal);
});

test('merges review additions without duplicates', () => {
  const base = coerceResult({
    title: 'Sync',
    summary: { overview: 'ok', highlights: ['A'] },
    actionItems: [{ task: 'Send recap', owner: 'Sam' }],
    openQuestions: ['Budget?'],
  }).value;

  const merged = mergeResult(base, {
    title: 'ignored',
    actionItems: [
      { task: 'Send recap', owner: 'Sam' },
      { task: 'Book the room', owner: 'Lee' },
    ],
    openQuestions: ['Budget?', 'Who signs off?'],
    summary: { highlights: ['B'] },
  });

  assert.equal(merged.actionItems.length, 2);
  assert.deepEqual(merged.openQuestions, ['Budget?', 'Who signs off?']);
  assert.deepEqual(merged.summary.highlights, ['A', 'B']);
});

test('removes repeated risks and decisions', () => {
  const { value } = coerceResult({
    title: 'Rollout review',
    summary: { overview: 'ok' },
    risks: [
      'Double-charges during the canary rollout.',
      'Double-charges during the canary rollout.',
      'double-charges during the canary rollout',
      { risk: 'Staging keys arrive late', impact: 'High' },
      { risk: 'Staging keys arrive late' },
    ],
    decisions: [
      'Ship behind a feature flag on the 8th.',
      'ship behind a feature flag on the 8th',
      { decision: 'Ship behind a feature flag on the 8th.', owner: 'Arjun' },
      'Canary at 5% for 48 hours.',
    ],
  });

  assert.equal(value.risks.length, 2);
  assert.equal(value.risks[1].impact, 'High', 'first occurrence keeps its detail');
  assert.equal(value.decisions.length, 2);
  assert.equal(value.decisions[0].owner, 'Arjun', 'merged duplicate keeps richer fields');
});

test('does not repeat an action item as a decision', () => {
  const { value } = coerceResult({
    title: 'Planning',
    summary: { overview: 'ok' },
    actionItems: [
      { task: 'Escalate to the account manager for staging keys', owner: 'Ravi' },
      { task: 'Define the success metric and baseline', owner: 'Arjun' },
    ],
    decisions: [
      'Escalate to the account manager for staging keys.',
      'Use exponential backoff for payment retries',
    ],
  });

  assert.equal(value.decisions.length, 1);
  assert.equal(value.decisions[0].decision, 'Use exponential backoff for payment retries');
});

test('keeps a short decision that merely shares words with an action', () => {
  const { value } = coerceResult({
    title: 'Sync',
    summary: { overview: 'ok' },
    actionItems: [{ task: 'Ship the fix', owner: 'Sam' }],
    decisions: ['Ship the fix behind a flag on the 8th'],
  });

  assert.equal(value.decisions.length, 1, 'different idea, not an echo');
});

test('tidies owners, casing and highlight labels', () => {
  const { value } = coerceResult({
    title: 'Checkout review',
    summary: {
      overview: 'ok',
      highlights: ['Decision: ship behind a flag', '- Support tickets up 62%'],
    },
    attendees: [
      { name: 'Arjun', role: 'Engineering Manager' },
      { name: 'Ravi', role: 'Finance' },
    ],
    actionItems: ['build the retry queue', { task: 'escalate to the vendor', owner: 'Finance' }],
    decisions: [{ decision: 'Decision: ship on the 8th', owner: 'Engineering Manager' }],
  });

  assert.deepEqual(value.summary.highlights, ['Ship behind a flag', 'Support tickets up 62%']);
  assert.equal(value.actionItems[0].task, 'Build the retry queue');
  assert.equal(value.actionItems[1].task, 'Escalate to the vendor');
  assert.equal(value.actionItems[1].owner, 'Ravi');
  assert.equal(value.decisions[0].decision, 'Ship on the 8th');
  assert.equal(value.decisions[0].owner, 'Arjun');
});

test('extracts JSON from fences and prose', () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here is the result: {"a": {"b": 2}} Hope that helps.'), { a: { b: 2 } });
  assert.deepEqual(extractJson('text before {"a": 1,} text after'), { a: 1 });
  assert.equal(extractJson('no json here'), null);
  assert.deepEqual(extractJson('{"text": "brace } inside"}'), { text: 'brace } inside' });
});
