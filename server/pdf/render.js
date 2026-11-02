import path from 'node:path';
import { createRequire } from 'node:module';
import pdfMake from 'pdfmake';

const require = createRequire(import.meta.url);
const pdfmakeRoot = path.dirname(require.resolve('pdfmake/package.json'));
const fontDir = path.join(pdfmakeRoot, 'fonts', 'Roboto');

const FONTS = {
  Roboto: {
    normal: path.join(fontDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontDir, 'Roboto-MediumItalic.ttf'),
  },
};

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  pdfMake.addFonts(FONTS);
  pdfMake.setUrlAccessPolicy(() => false);
  // Fonts are the only local files the renderer may read.
  const fontsPrefix = `${fontDir}${path.sep}`.toLowerCase();
  pdfMake.setLocalAccessPolicy((filePath) => String(filePath).toLowerCase().startsWith(fontsPrefix));
  fontsReady = true;
}

const C = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  accent: '#4f46e5',
  accentDeep: '#3730a3',
  accentSoft: '#eef2ff',
  border: '#e2e8f0',
  surface: '#f8fafc',
  high: '#b91c1c',
  medium: '#b45309',
  low: '#047857',
};

const PAGE_WIDTH = 595.28;
const MARGIN = 56;
const CONTENT_WIDTH = Math.round(PAGE_WIDTH - MARGIN * 2);

function safe(value, { multiline = false } = {}) {
  let text = String(value ?? '');
  text = text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!multiline) text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function formatDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return safe(raw);
}

function formatDuration(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} hour${hours > 1 ? 's' : ''}`;
}

function priorityColor(priority) {
  return C[priority] || C.muted;
}

function bullets(items, markerColor = C.accent) {
  const clean = items.map((i) => safe(i)).filter(Boolean);
  if (!clean.length) return null;
  return {
    ul: clean.map((text) => ({ text, style: 'body' })),
    markerColor,
    margin: [0, 2, 0, 0],
  };
}

function table(headers, rows, widths, extra = {}) {
  return {
    table: {
      headerRows: 1,
      widths,
      body: [
        headers.map((h) => ({ text: h, style: 'tableHeader' })),
        ...rows,
      ],
    },
    layout: reportLayout,
    margin: [0, 6, 0, 4],
    ...extra,
  };
}

const reportLayout = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.6),
  vLineWidth: () => 0,
  hLineColor: () => C.border,
  paddingLeft: () => 8,
  paddingRight: () => 8,
  paddingTop: () => 7,
  paddingBottom: () => 7,
  fillColor: (rowIndex) => {
    if (rowIndex === 0) return C.accentSoft;
    return rowIndex % 2 === 0 ? C.surface : null;
  },
};

function sectionHeading(title, number) {
  return {
    text: number ? `${number}.  ${title}` : title,
    style: 'sectionTitle',
    tocItem: true,
    tocStyle: { fontSize: 10.5, color: C.body },
    tocMargin: [0, 7, 0, 0],
    margin: [0, 22, 0, 8],
  };
}

function checkboxCell(done) {
  const canvas = [{ type: 'rect', x: 0, y: 1.5, w: 9, h: 9, lineWidth: 0.8, lineColor: done ? C.accent : C.faint }];
  if (done) {
    canvas.push({
      type: 'polyline',
      points: [
        { x: 1.8, y: 6 },
        { x: 3.8, y: 8.6 },
        { x: 8, y: 2.4 },
      ],
      lineWidth: 1.2,
      lineColor: C.accent,
    });
  }
  return { canvas, margin: [2, 2, 0, 0] };
}

function coverBlocks(result) {
  const metaRows = [];
  const addMeta = (label, value) => {
    if (!value) return;
    metaRows.push([
      { text: label.toUpperCase(), style: 'metaLabel' },
      { text: safe(value), style: 'metaValue' },
    ]);
  };
  addMeta('Date', formatDate(result.date));
  addMeta('Time', result.time);
  addMeta('Duration', formatDuration(result.durationMinutes));
  addMeta('Location', result.location);
  addMeta('Organiser', result.organizer);
  if (result.attendees.length) {
    addMeta('Attendees', result.attendees.map((a) => safe(a.name)).join(', '));
  }

  const stats = [
    { value: result.attendees.length, label: 'Attendees' },
    { value: result.decisions.length, label: 'Decisions' },
    { value: result.actionItems.length, label: 'Action items' },
    { value: result.risks.length, label: 'Risks' },
  ].filter((s) => s.value > 0);

  return [
    {
      canvas: [{ type: 'rect', x: 0, y: 0, w: CONTENT_WIDTH, h: 4, color: C.accent }],
      margin: [0, 0, 0, 22],
    },
    { text: 'MEETING REPORT', style: 'coverKicker' },
    { text: safe(result.title || 'Meeting notes'), style: 'coverTitle', margin: [0, 10, 0, 0] },
    ...(result.objective
      ? [{ text: safe(result.objective), style: 'coverObjective', margin: [0, 12, 0, 0] }]
      : []),
    ...(metaRows.length
      ? [
          {
            table: { widths: [78, CONTENT_WIDTH - 78], body: metaRows },
            layout: 'noBorders',
            margin: [0, 26, 0, 0],
          },
        ]
      : []),
    ...(result.tags.length
      ? [
          {
            text: result.tags.map((t) => `#${safe(t)}`).join('   '),
            style: 'coverTags',
            margin: [0, 18, 0, 0],
          },
        ]
      : []),
    ...(stats.length
      ? [
          {
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: C.border }],
            margin: [0, 36, 0, 0],
          },
          {
            columns: stats.map((s) => ({
              width: '*',
              stack: [
                { text: String(s.value), style: 'statValue' },
                { text: s.label, style: 'statLabel' },
              ],
            })),
            margin: [0, 18, 0, 0],
          },
        ]
      : []),
    {
      text: 'Prepared on your machine. Nothing in this document left your computer.',
      style: 'coverFoot',
      absolutePosition: { x: MARGIN, y: 770 },
    },
  ];
}

function summaryBlocks(result) {
  const blocks = [];
  if (result.summary.overview) {
    blocks.push({ text: safe(result.summary.overview, { multiline: true }), style: 'lead' });
  }
  const highlights = bullets(result.summary.highlights);
  if (highlights) blocks.push({ text: 'Key takeaways', style: 'microLabel', margin: [0, 12, 0, 2] }, highlights);
  return blocks;
}

function attendeeBlocks(result) {
  if (!result.attendees.length) return [];
  return [
    table(
      ['Name', 'Role'],
      result.attendees.map((a) => [
        { text: safe(a.name), style: 'cellStrong' },
        { text: safe(a.role) || '—', style: 'cell' },
      ]),
      ['*', '*'],
    ),
  ];
}

function discussionBlocks(result) {
  const blocks = [];
  result.topics.forEach((topic, index) => {
    blocks.push({ text: `${index + 1}.  ${safe(topic.title)}`, style: 'topicTitle', margin: [0, index === 0 ? 2 : 16, 0, 3] });
    if (topic.summary) blocks.push({ text: safe(topic.summary, { multiline: true }), style: 'body' });
    const points = bullets(topic.points, C.faint);
    if (points) blocks.push(points);
    if (topic.decisions.length) {
      blocks.push({
        text: 'Decisions',
        style: 'microLabel',
        margin: [0, 6, 0, 0],
      });
      blocks.push(bullets(topic.decisions, C.accent));
    }
    if (topic.followUps.length) {
      blocks.push({ text: 'Follow-ups', style: 'microLabel', margin: [0, 6, 0, 0] });
      blocks.push(bullets(topic.followUps, C.muted));
    }
  });
  return blocks;
}

function decisionBlocks(result) {
  if (!result.decisions.length) return [];
  const rows = result.decisions.map((d, index) => [
    { text: String(index + 1), style: 'cellMuted', alignment: 'center' },
    {
      stack: [
        { text: safe(d.decision), style: 'cellStrong' },
        ...(d.rationale ? [{ text: safe(d.rationale), style: 'cellReason' }] : []),
      ],
    },
    { text: safe(d.owner) || '—', style: 'cell' },
  ]);
  return [table(['#', 'Decision', 'Owner'], rows, [22, '*', 110])];
}

function actionBlocks(result) {
  if (!result.actionItems.length) return [];
  const open = result.actionItems.filter((a) => a.status !== 'done').length;
  const rows = result.actionItems.map((a) => [
    checkboxCell(a.status === 'done'),
    {
      stack: [
        { text: safe(a.task), style: 'cellStrong' },
        ...(a.context ? [{ text: safe(a.context), style: 'cellReason' }] : []),
      ],
    },
    { text: safe(a.owner) || 'Unassigned', style: 'cell' },
    { text: safe(a.dueDate) || '—', style: 'cell' },
    {
      text: a.priority ? a.priority[0].toUpperCase() + a.priority.slice(1) : '—',
      style: 'cell',
      color: priorityColor(a.priority),
      bold: Boolean(a.priority),
    },
  ]);
  return [
    { text: `${open} open · ${result.actionItems.length - open} done`, style: 'metaLine', margin: [0, 0, 0, 2] },
    table(['', 'Action', 'Owner', 'Due', 'Priority'], rows, [20, '*', 92, 64, 54]),
  ];
}

function riskBlocks(result) {
  if (!result.risks.length) return [];
  const rows = result.risks.map((r) => [
    { text: safe(r.risk), style: 'cellStrong' },
    { text: safe(r.impact) || '—', style: 'cell' },
    { text: safe(r.mitigation) || '—', style: 'cell' },
    { text: safe(r.owner) || '—', style: 'cell' },
  ]);
  return [table(['Risk', 'Impact', 'Mitigation', 'Owner'], rows, ['*', 100, '*', 80])];
}

function nextBlocks(result) {
  const n = result.nextMeeting;
  if (!n.date && !n.focus && !n.prep) return [];
  const rows = [];
  if (n.date) rows.push([{ text: 'DATE', style: 'metaLabel' }, { text: safe(n.date), style: 'body' }]);
  if (n.focus) rows.push([{ text: 'FOCUS', style: 'metaLabel' }, { text: safe(n.focus), style: 'body' }]);
  if (n.prep) rows.push([{ text: 'PREPARE', style: 'metaLabel' }, { text: safe(n.prep), style: 'body' }]);
  return [
    {
      table: { widths: [76, CONTENT_WIDTH - 76], body: rows },
      layout: 'noBorders',
      margin: [0, 4, 0, 0],
    },
  ];
}

function buildDocDefinition(meeting) {
  const result = meeting.result;
  const content = [];

  content.push(...coverBlocks(result));
  content.push({ text: '', pageBreak: 'after' });

  content.push({
    toc: {
      title: { text: 'Contents', style: 'sectionTitle', margin: [0, 0, 0, 10] },
      textStyle: { fontSize: 10.5, color: C.body },
      numberStyle: { fontSize: 10.5, color: C.muted },
    },
  });
  content.push({ text: '', pageBreak: 'after' });

  let number = 0;
  const addSection = (title, blocks) => {
    if (!blocks || (Array.isArray(blocks) && blocks.length === 0)) return;
    number += 1;
    content.push(sectionHeading(title, number));
    content.push(...(Array.isArray(blocks) ? blocks : [blocks]));
  };

  addSection('Executive summary', summaryBlocks(result));
  addSection('Attendees', attendeeBlocks(result));
  addSection('Agenda', result.agenda.length ? [bullets(result.agenda)] : []);
  addSection('Discussion', discussionBlocks(result));
  addSection('Decisions', decisionBlocks(result));
  addSection('Action items', actionBlocks(result));
  addSection('Risks and blockers', riskBlocks(result));
  addSection('Open questions', result.openQuestions.length ? [bullets(result.openQuestions, C.medium)] : []);
  addSection('Next steps', nextBlocks(result));

  const generated = new Date(meeting.updatedAt || Date.now());
  const stats = meeting.stats || {};
  const infoBits = [
    `Generated locally on ${generated.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    stats.model ? `using ${stats.model}` : '',
    stats.words ? `from ${stats.words.toLocaleString('en-GB')} words of notes` : '',
  ].filter(Boolean);

  number += 1;
  content.push({ text: 'About this report', style: 'sectionTitle', tocItem: true, tocStyle: { fontSize: 10.5, color: C.body }, margin: [0, 24, 0, 8] });
  content.push({ text: infoBits.join(' · '), style: 'small' });
  content.push({
    text: 'AI-generated reports can contain mistakes. Check names, dates and owners before sharing.',
    style: 'small',
    margin: [0, 4, 0, 0],
  });

  return {
    info: {
      title: result.title || 'Meeting report',
      author: 'mefile',
      subject: result.objective || 'Meeting report',
      creator: 'mefile (local)',
    },
    pageSize: 'A4',
    pageMargins: [MARGIN, 64, MARGIN, 70],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: C.body, lineHeight: 1.4 },
    styles: {
      coverKicker: { fontSize: 9, bold: true, color: C.accent, characterSpacing: 2.2 },
      coverTitle: { fontSize: 30, bold: true, color: C.ink, lineHeight: 1.08 },
      coverObjective: { fontSize: 11.5, color: C.body, lineHeight: 1.45 },
      coverTags: { fontSize: 9, color: C.accent, characterSpacing: 0.4 },
      coverFoot: { fontSize: 8, color: C.faint, characterSpacing: 0.3 },
      metaLabel: { fontSize: 7.5, bold: true, color: C.faint, characterSpacing: 1.1, margin: [0, 1, 0, 6] },
      metaValue: { fontSize: 10, color: C.ink, margin: [0, 0, 0, 6] },
      metaLine: { fontSize: 8.5, color: C.muted },
      statValue: { fontSize: 20, bold: true, color: C.accentDeep },
      statLabel: { fontSize: 8, color: C.muted, characterSpacing: 0.6 },
      sectionTitle: { fontSize: 17, bold: true, color: C.ink, lineHeight: 1.1 },
      topicTitle: { fontSize: 11.5, bold: true, color: C.ink },
      microLabel: { fontSize: 8, bold: true, color: C.muted, characterSpacing: 1 },
      lead: { fontSize: 11, color: C.body, lineHeight: 1.5 },
      body: { fontSize: 10, color: C.body, lineHeight: 1.45, margin: [0, 2, 0, 0] },
      tableHeader: { fontSize: 8, bold: true, color: C.accentDeep, characterSpacing: 0.7 },
      cell: { fontSize: 9, color: C.body },
      cellStrong: { fontSize: 9.5, color: C.ink },
      cellMuted: { fontSize: 9, color: C.muted },
      cellReason: { fontSize: 8.5, color: C.muted, italics: true, margin: [0, 2, 0, 0] },
      small: { fontSize: 8.5, color: C.muted, lineHeight: 1.4 },
    },
    content,
    footer(currentPage, pageCount) {
      if (currentPage === 1) return { text: '' };
      return {
        margin: [MARGIN, 20, MARGIN, 0],
        stack: [
          {
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.6, lineColor: C.border }],
            margin: [0, 0, 0, 7],
          },
          {
            columns: [
              {
                text: safe(result.title || 'Meeting report'),
                fontSize: 7.5,
                color: C.faint,
                width: '*',
                ellipsis: true,
              },
              {
                text: `Page ${currentPage} of ${pageCount}`,
                fontSize: 7.5,
                color: C.faint,
                alignment: 'right',
                width: 90,
              },
            ],
          },
        ],
      };
    },
  };
}

export async function renderPdf(meeting) {
  if (!meeting?.result) throw new Error('No report data to render.');
  ensureFonts();
  const definition = buildDocDefinition(meeting);
  const pdf = pdfMake.createPdf(definition);
  return pdf.getBuffer();
}

export function pdfFilename(result) {
  const base = safe(result?.title || 'meeting-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'meeting-report';
  return `${base}.pdf`;
}

export { buildDocDefinition };
