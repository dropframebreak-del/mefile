import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPdf, pdfFilename } from '../server/pdf/render.js';
import { fixtureMeeting } from './fixtures.js';

test('renders a multi-page PDF from a full report', async () => {
  const buffer = await renderPdf(fixtureMeeting);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 8000, `unexpectedly small PDF: ${buffer.length} bytes`);

  const raw = buffer.toString('latin1');
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pages >= 3, `expected at least 3 pages, got ${pages}`);

  const out = path.join(os.tmpdir(), 'meeting-report-test.pdf');
  fs.writeFileSync(out, buffer);
  assert.ok(fs.statSync(out).size > 8000);
});

test('renders a minimal report without crashing', async () => {
  const minimal = {
    id: 'minimal-0001',
    title: 'Standup',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: {
      title: 'Standup',
      date: '',
      time: '',
      durationMinutes: null,
      location: '',
      organizer: '',
      objective: '',
      attendees: [],
      summary: { overview: 'A short standup.', highlights: [] },
      agenda: [],
      topics: [],
      decisions: [],
      actionItems: [],
      risks: [],
      openQuestions: [],
      nextMeeting: { date: '', focus: '', prep: '' },
      tags: [],
    },
    stats: null,
  };
  const buffer = await renderPdf(minimal);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
});

test('builds a safe filename', () => {
  assert.equal(pdfFilename({ title: 'Q4 Checkout / Reliability — Review!' }), 'q4-checkout-reliability-review.pdf');
  assert.equal(pdfFilename({ title: '' }), 'meeting-report.pdf');
});
