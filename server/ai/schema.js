/**
 * Turns whatever the model returned into a predictable report shape.
 * Models are good at content and bad at contracts, so everything is coerced,
 * bounded and deduplicated before it reaches the UI or the PDF renderer.
 */

const LIMITS = {
  title: 180,
  short: 200,
  line: 400,
  paragraph: 1800,
  attendees: 60,
  topics: 20,
  points: 18,
  actionItems: 60,
  decisions: 30,
  risks: 20,
  questions: 20,
  tags: 12,
};

const PRIORITY = new Map([
  ['high', 'high'],
  ['urgent', 'high'],
  ['critical', 'high'],
  ['p1', 'high'],
  ['medium', 'medium'],
  ['med', 'medium'],
  ['normal', 'medium'],
  ['p2', 'medium'],
  ['low', 'low'],
  ['minor', 'low'],
  ['p3', 'low'],
  ['nice to have', 'low'],
]);

function text(value, max = LIMITS.line) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((v) => text(v, max)).filter(Boolean).join('; ').slice(0, max);
  }
  if (typeof value === 'object') {
    return text(value.text ?? value.name ?? value.title ?? value.value ?? '', max);
  }
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function longText(value, max = LIMITS.paragraph) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((v) => longText(v, max)).filter(Boolean).join('\n\n').slice(0, max);
  }
  if (typeof value === 'object') {
    return longText(value.text ?? value.summary ?? value.description ?? '', max);
  }
  return String(value).trim().slice(0, max);
}

function list(value, mapper, maxItems) {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n+/) : [value];
  return raw
    .map((item) => mapper(item))
    .filter((item) => (typeof item === 'string' ? item.length > 0 : item && Object.values(item).some((v) => text(v))));
  // Note: slice happens by caller where needed.
}

function strings(value, maxItems = LIMITS.points, maxLen = LIMITS.line) {
  return list(value, (item) => text(item, maxLen), maxItems).slice(0, maxItems);
}

/** Highlights often come back as "Decision: ship on the 8th". Drop the label. */
function cleanLabel(value) {
  const cleaned = text(value, LIMITS.line)
    .replace(/^[-*•]\s*/, '')
    .replace(/^(decision|action item|action|risk|key takeaway|takeaway|next step|follow-?up)\s*:\s*/i, '')
    .trim();
  return sentence(cleaned);
}

function normalizePriority(value) {
  const key = text(value).toLowerCase().replace(/[.!]+$/, '');
  return PRIORITY.get(key) || '';
}

/** "own the idempotency work" reads like a fragment; reports should not. */
function sentence(value) {
  const raw = text(value, LIMITS.line);
  if (!raw) return '';
  return raw[0].toUpperCase() + raw.slice(1);
}

/** Notes often label roles ("Arjun (Engineering Manager)"). Owners should be names. */
function ownerName(value, attendees) {
  const raw = text(value, 80);
  if (!raw || !attendees.length) return raw;
  const key = raw.toLowerCase();
  const byName = attendees.find((a) => a.name.toLowerCase() === key);
  if (byName) return byName.name;
  const byRole = attendees.find((a) => {
    const role = a.role.toLowerCase();
    return role && (key === role || key.startsWith(`${role} `) || key.startsWith(`${role},`));
  });
  return byRole ? byRole.name : raw;
}

/** Comparable form used to detect the same idea written twice. */
function fingerprint(value) {
  return text(value, LIMITS.line)
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

function dedupeBy(items, keyFn) {
  const seen = new Map();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const existing = seen.get(key);
    if (existing) {
      // The first copy wins, but later copies can fill fields it left blank.
      if (existing && typeof existing === 'object' && item && typeof item === 'object') {
        for (const field of Object.keys(item)) {
          if (!text(existing[field]) && text(item[field])) existing[field] = item[field];
        }
      }
      continue;
    }
    seen.set(key, item);
    out.push(item);
  }
  return out;
}

/** "Send specs by Friday." and "send specs by friday" are the same decision. */
function sameIdea(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 20 && long.includes(short);
}

function normalizeAttendees(value) {
  return list(value, (item) => {
    if (typeof item === 'string') {
      const cleaned = text(item, LIMITS.short);
      if (!cleaned) return null;
      const match = cleaned.match(/^(.{2,80}?)\s*[\(\[,–-]\s*(.{2,80}?)[\)\]]?$/);
      if (match) return { name: text(match[1], 80), role: text(match[2], 80) };
      return { name: cleaned, role: '' };
    }
    if (item && typeof item === 'object') {
      const name = text(item.name ?? item.person ?? item.attendee, 80);
      const role = text(item.role ?? item.title ?? item.position, 80);
      return name ? { name, role } : null;
    }
    return null;
  }, LIMITS.attendees).slice(0, LIMITS.attendees);
}

function normalizeActionItems(value) {
  const items = list(value, (item) => {
    if (typeof item === 'string') {
      const task = cleanLabel(item);
      return task ? { task, owner: '', dueDate: '', priority: '', status: 'open', context: '' } : null;
    }
    if (item && typeof item === 'object') {
      const task = cleanLabel(item.task ?? item.action ?? item.item ?? item.description);
      if (!task) return null;
      return {
        task,
        owner: text(item.owner ?? item.assignee ?? item.who, 80),
        dueDate: text(item.dueDate ?? item.due ?? item.deadline ?? item.due_date, 80),
        priority: normalizePriority(item.priority ?? item.importance),
        status: text(item.status).toLowerCase() === 'done' || item.done === true ? 'done' : 'open',
        context: text(item.context ?? item.notes ?? item.detail, LIMITS.line),
      };
    }
    return null;
  }, LIMITS.actionItems);

  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.task.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= LIMITS.actionItems) break;
  }
  return unique.map((item, index) => ({ id: `a${index + 1}`, ...item }));
}

function normalizeDecisions(value) {
  const items = list(value, (item) => {
    if (typeof item === 'string') {
      const decision = cleanLabel(item);
      return decision ? { decision, rationale: '', owner: '' } : null;
    }
    if (item && typeof item === 'object') {
      const decision = cleanLabel(item.decision ?? item.description ?? item.title ?? item.text);
      if (!decision) return null;
      return {
        decision,
        rationale: text(item.rationale ?? item.reason ?? item.why, LIMITS.line),
        owner: text(item.owner ?? item.madeBy ?? item.decidedBy, 80),
      };
    }
    return null;
  }, LIMITS.decisions);
  return dedupeBy(items, (item) => fingerprint(item.decision)).slice(0, LIMITS.decisions);
}

function normalizeTopics(value) {
  return list(value, (item) => {
    if (typeof item === 'string') {
      const title = text(item, LIMITS.line);
      return title ? { title, summary: '', points: [], decisions: [], followUps: [] } : null;
    }
    if (item && typeof item === 'object') {
      const title = text(item.title ?? item.topic ?? item.name, LIMITS.line);
      const summary = longText(item.summary ?? item.overview ?? item.description, LIMITS.paragraph);
      const points = strings(item.points ?? item.notes ?? item.discussion ?? item.details, LIMITS.points);
      if (!title && !summary && points.length === 0) return null;
      return {
        title: title || 'Discussion',
        summary,
        points,
        decisions: strings(item.decisions, 8, LIMITS.line),
        followUps: strings(item.followUps ?? item.follow_ups ?? item.nextSteps ?? item.actions, 8, LIMITS.line),
      };
    }
    return null;
  }, LIMITS.topics).slice(0, LIMITS.topics);
}

function normalizeRisks(value) {
  const items = list(value, (item) => {
    if (typeof item === 'string') {
      const risk = text(item, LIMITS.line);
      return risk ? { risk, impact: '', mitigation: '', owner: '' } : null;
    }
    if (item && typeof item === 'object') {
      const risk = text(item.risk ?? item.issue ?? item.blocker ?? item.description, LIMITS.line);
      if (!risk) return null;
      return {
        risk,
        impact: text(item.impact ?? item.severity ?? item.consequence, LIMITS.line),
        mitigation: text(item.mitigation ?? item.mitigationPlan ?? item.action, LIMITS.line),
        owner: text(item.owner, 80),
      };
    }
    return null;
  }, LIMITS.risks);
  return dedupeBy(items, (item) => fingerprint(item.risk)).slice(0, LIMITS.risks);
}

function normalizeSummary(value) {
  if (value == null) return { overview: '', highlights: [] };
  if (typeof value === 'string') return { overview: longText(value), highlights: [] };
  if (Array.isArray(value)) return { overview: longText(value.slice(0, 3)), highlights: strings(value, 8) };
  if (typeof value === 'object') {
    const overview = longText(
      value.overview ?? value.summary ?? value.paragraph ?? value.text ?? value.description,
      LIMITS.paragraph,
    );
    const highlights = strings(
      value.highlights ?? value.keyPoints ?? value.key_points ?? value.bullets ?? value.points,
      8,
      LIMITS.line,
    )
      .map(cleanLabel)
      .filter(Boolean);
    return { overview, highlights };
  }
  return { overview: '', highlights: [] };
}

function normalizeNextMeeting(value) {
  if (value == null) return { date: '', focus: '', prep: '' };
  if (typeof value === 'string') return { date: text(value, 80), focus: '', prep: '' };
  if (typeof value === 'object') {
    return {
      date: text(value.date ?? value.when, 80),
      focus: text(value.focus ?? value.agenda ?? value.topic, LIMITS.line),
      prep: text(value.prep ?? value.preparation ?? value.notes, LIMITS.line),
    };
  }
  return { date: '', focus: '', prep: '' };
}

export function emptyResult() {
  return {
    title: '',
    date: '',
    time: '',
    durationMinutes: null,
    location: '',
    organizer: '',
    objective: '',
    attendees: [],
    summary: { overview: '', highlights: [] },
    agenda: [],
    topics: [],
    decisions: [],
    actionItems: [],
    risks: [],
    openQuestions: [],
    nextMeeting: { date: '', focus: '', prep: '' },
    tags: [],
  };
}

export function isMeaningful(result) {
  if (!result) return false;
  const hasSummary = Boolean(result.summary?.overview || result.summary?.highlights?.length);
  return Boolean(
    (result.title && result.title !== 'Meeting notes') ||
      hasSummary ||
      result.topics.length ||
      result.decisions.length ||
      result.actionItems.length,
  );
}

/**
 * @returns {{ value: object, issues: string[], fatal: string | null }}
 */
export function coerceResult(raw) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: emptyResult(), issues: ['The model did not return a JSON object.'], fatal: 'No JSON object returned.' };
  }

  // Some models wrap the payload: { meeting: {...} } or { report: {...} }
  const source = raw.meeting ?? raw.report ?? raw.result ?? raw.data ?? raw;

  const duration = Number(source.durationMinutes ?? source.duration ?? source.duration_minutes);
  const result = {
    title: text(source.title ?? source.meetingTitle ?? source.subject, LIMITS.title),
    date: text(source.date ?? source.meetingDate, 80),
    time: text(source.time ?? source.startTime, 80),
    durationMinutes: Number.isFinite(duration) && duration > 0 && duration < 1440 ? Math.round(duration) : null,
    location: text(source.location ?? source.place ?? source.venue, LIMITS.short),
    organizer: text(source.organizer ?? source.chair ?? source.host, 80),
    objective: longText(source.objective ?? source.purpose ?? source.goal, LIMITS.line),
    attendees: normalizeAttendees(source.attendees ?? source.participants),
    summary: normalizeSummary(source.summary ?? source.executiveSummary ?? source.overview),
    agenda: strings(source.agenda ?? source.topicsCovered, 15),
    topics: normalizeTopics(source.topics ?? source.discussion ?? source.sections),
    decisions: normalizeDecisions(source.decisions ?? source.keyDecisions),
    actionItems: normalizeActionItems(source.actionItems ?? source.actions ?? source.tasks ?? source.nextSteps),
    risks: normalizeRisks(source.risks ?? source.blockers ?? source.issues),
    openQuestions: strings(source.openQuestions ?? source.questions, LIMITS.questions),
    nextMeeting: normalizeNextMeeting(source.nextMeeting ?? source.next),
    tags: strings(source.tags, LIMITS.tags, 40).map((t) => t.replace(/^#/, '')),
  };

  // Owners copied from role labels ("Finance") should point at a person ("Ravi").
  if (result.attendees.length) {
    for (const item of result.actionItems) item.owner = ownerName(item.owner, result.attendees);
    for (const item of result.decisions) item.owner = ownerName(item.owner, result.attendees);
    for (const item of result.risks) item.owner = ownerName(item.owner, result.attendees);
  }

  // "If we don't have keys by Wednesday, we should consider a canary" is a
  // conditional idea, not a decision that was settled.
  const tentative = /^if\b.*\b(consider|should|could|might|maybe|possibly)\b/i;
  if (result.decisions.length) {
    const kept = [];
    for (const item of result.decisions) {
      if (tentative.test(item.decision)) result.openQuestions.push(item.decision);
      else kept.push(item);
    }
    result.decisions = kept;
    result.openQuestions = Array.from(new Set(result.openQuestions)).slice(0, LIMITS.questions);
  }

  // Models often restate a to-do as a "decision". Keep the action, drop the echo.
  const actionPrints = result.actionItems.map((item) => fingerprint(item.task)).filter(Boolean);
  if (actionPrints.length && result.decisions.length) {
    result.decisions = result.decisions.filter(
      (item) => !actionPrints.some((printed) => sameIdea(printed, fingerprint(item.decision))),
    );
  }
  result.tags = Array.from(new Set(result.tags));

  if (!result.title) {
    result.title = 'Meeting notes';
    issues.push('No meeting title was found.');
  }
  if (!isMeaningful({ ...result, title: '' })) {
    return {
      value: result,
      issues,
      fatal: 'The response contained no usable meeting content.',
    };
  }

  return { value: result, issues, fatal: null };
}

export function mergeResult(base, additions) {
  if (!additions || typeof additions !== 'object') return base;
  const merged = { ...base };
  const add = coerceResult({ ...additions, title: additions.title || base.title }).value;
  merged.actionItems = normalizeActionItems([...(base.actionItems || []), ...(add.actionItems || [])]);
  merged.decisions = normalizeDecisions([...(base.decisions || []), ...(add.decisions || [])]);
  merged.risks = normalizeRisks([...(base.risks || []), ...(add.risks || [])]);
  merged.openQuestions = Array.from(
    new Set([...(base.openQuestions || []), ...(add.openQuestions || [])].map((q) => q.trim()).filter(Boolean)),
  ).slice(0, LIMITS.questions);
  if (add.summary?.highlights?.length) {
    merged.summary = {
      ...base.summary,
      highlights: Array.from(new Set([...(base.summary?.highlights || []), ...add.summary.highlights])).slice(0, 10),
    };
  }
  return merged;
}
