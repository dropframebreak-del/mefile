function line(label, value) {
  const text = String(value || '').trim();
  return text ? `**${label}:** ${text}` : '';
}

export function renderMarkdown(meeting) {
  const r = meeting.result || {};
  const out = [];
  const meta = [
    line('Date', r.date),
    line('Time', r.time),
    line('Duration', r.durationMinutes ? `${r.durationMinutes} minutes` : ''),
    line('Location', r.location),
    line('Organiser', r.organizer),
  ].filter(Boolean);

  out.push(`# ${r.title || 'Meeting notes'}`, '');
  if (meta.length) out.push(meta.join('  \n'), '');
  if (r.objective) out.push(`_${r.objective}_`, '');

  if (r.summary?.overview) {
    out.push('## Executive summary', '', r.summary.overview, '');
    if (r.summary.highlights?.length) {
      out.push(...r.summary.highlights.map((h) => `- ${h}`), '');
    }
  }

  if (r.attendees?.length) {
    out.push('## Attendees', '', '| Name | Role |', '| --- | --- |');
    for (const a of r.attendees) out.push(`| ${a.name} | ${a.role || '—'} |`);
    out.push('');
  }

  if (r.agenda?.length) {
    out.push('## Agenda', '', ...r.agenda.map((item) => `- ${item}`), '');
  }

  if (r.topics?.length) {
    out.push('## Discussion', '');
    r.topics.forEach((t) => {
      out.push(`### ${t.title}`, '');
      if (t.summary) out.push(t.summary, '');
      if (t.points?.length) out.push(...t.points.map((p) => `- ${p}`), '');
      if (t.decisions?.length) {
        out.push('**Decisions:**', ...t.decisions.map((d) => `- ${d}`), '');
      }
      if (t.followUps?.length) {
        out.push('**Follow-ups:**', ...t.followUps.map((f) => `- ${f}`), '');
      }
    });
  }

  if (r.decisions?.length) {
    out.push('## Decisions', '');
    r.decisions.forEach((d, i) => {
      out.push(`${i + 1}. **${d.decision}**${d.owner ? ` — ${d.owner}` : ''}`);
      if (d.rationale) out.push(`   _${d.rationale}_`);
    });
    out.push('');
  }

  if (r.actionItems?.length) {
    out.push('## Action items', '', '| Done | Action | Owner | Due | Priority |', '| --- | --- | --- | --- | --- |');
    for (const a of r.actionItems) {
      out.push(
        `| ${a.status === 'done' ? 'x' : ' '} | ${a.task} | ${a.owner || 'Unassigned'} | ${a.dueDate || '—'} | ${a.priority || '—'} |`,
      );
    }
    out.push('');
  }

  if (r.risks?.length) {
    out.push('## Risks and blockers', '');
    for (const risk of r.risks) {
      out.push(`- **${risk.risk}**${risk.impact ? ` — impact: ${risk.impact}` : ''}${risk.mitigation ? `; mitigation: ${risk.mitigation}` : ''}`);
    }
    out.push('');
  }

  if (r.openQuestions?.length) {
    out.push('## Open questions', '', ...r.openQuestions.map((q) => `- ${q}`), '');
  }

  if (r.nextMeeting?.date || r.nextMeeting?.focus) {
    out.push('## Next steps', '');
    if (r.nextMeeting.date) out.push(line('Next meeting', r.nextMeeting.date));
    if (r.nextMeeting.focus) out.push(line('Focus', r.nextMeeting.focus));
    if (r.nextMeeting.prep) out.push(line('Prepare', r.nextMeeting.prep));
    out.push('');
  }

  out.push('---', '', '_Generated locally with AI. Check names, dates and owners before sharing._', '');
  return out.join('\n');
}

export function markdownFilename(result) {
  const base = String(result?.title || 'meeting-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'meeting-report';
  return `${base}.md`;
}
