const SCHEMA = `{
  "title": "string - short, specific meeting title",
  "date": "string - ISO date YYYY-MM-DD if known, otherwise as written",
  "time": "string - start time if known, e.g. 14:30, otherwise empty",
  "durationMinutes": 0,
  "location": "string - room, video link name, or empty",
  "organizer": "string - name of the person who ran the meeting, or empty",
  "objective": "string - one sentence on why the meeting happened",
  "attendees": [{ "name": "string", "role": "string - job title or team, or empty" }],
  "summary": {
    "overview": "string - 2 to 4 sentence factual summary",
    "highlights": ["string - 3 to 6 most important takeaways"]
  },
  "agenda": ["string"],
  "topics": [{
    "title": "string",
    "summary": "string - 1 to 3 sentences",
    "points": ["string - specific detail, number or argument raised"],
    "decisions": ["string"],
    "followUps": ["string"]
  }],
  "decisions": [{ "decision": "string", "rationale": "string", "owner": "string" }],
  "actionItems": [{
    "task": "string - starts with a verb, one concrete action",
    "owner": "string - a person named in the notes, or empty",
    "dueDate": "string - ISO date if resolvable, otherwise as written, or empty",
    "priority": "high | medium | low",
    "context": "string - why it matters or any detail, or empty"
  }],
  "risks": [{ "risk": "string", "impact": "string", "mitigation": "string", "owner": "string" }],
  "openQuestions": ["string"],
  "nextMeeting": { "date": "string", "focus": "string", "prep": "string" },
  "tags": ["string - 1 to 4 short labels"]
}`;

export function buildExtractionSystem(today) {
  return `You are a meticulous meeting analyst. You convert raw meeting notes and transcripts into a structured report.

Return ONLY a single valid JSON object. No markdown code fences. No commentary before or after. No trailing commas. All strings must be on one line (escape newlines as \\n).

Required JSON shape:
${SCHEMA}

Rules:
1. Use only facts present in the notes. Never invent attendees, owners, dates, numbers or decisions. If a field is unknown, use "" or [] or null as appropriate.
2. Today's date is ${today}. Resolve relative dates ("next Tuesday", "end of month", "by Friday") against the meeting date when it is known, otherwise against today. A weekday means the next time that weekday occurs after today; do not pick a date in the past. Count the days carefully. Keep the resolved value in dueDate and in date.
3. Decisions are outcomes that were settled. If a sentence can be written as "X will do Y", it is an action item, even when it was said out loud. A real decision settles the question and reads like a rule: "Ship the backoff change behind a flag on the 8th." Do not duplicate the same content in both lists.
4. If the notes explicitly defer a topic ("let's not decide today", "take it to leadership", "we need more data"), put it in "openQuestions". Do not record a deferral as a decision.
5. Be exhaustive about action items. Every commitment counts: "I'll…", "can you…", "let's ship on the 8th", "write up…", "by Friday". A meeting this long usually yields 6 to 12 action items. Missing one is worse than phrasing it plainly. One request is one item: if the notes repeat or restate it, merge into the single most specific wording.
6. Every action item must be concrete and start with an imperative verb. Keep the object of the task: "Write up the fields for the read-only payment timeline", not "Write up the fields". Use the owner's actual name from the notes. If the owner is not stated, use "".
7. An owner is always a person's name, never a job title or a team. "Arjun (Engineering Manager)" means the owner is "Arjun", not "Engineering Manager".
8. Capture numbers, metrics, deadlines and product names exactly as written. Do not round or paraphrase dates such as "the 8th".
9. Record every risk, concern or blocker that is named, with its mitigation when stated. Cues include "that's a risk", "if we don't…", "compliance issue", "asking for trouble", "unstable", "we can't test". Each cue is a separate risk entry. Aim for 2 to 5 risks on a substantial meeting.
10. Group the discussion into 3 to 8 topics. Each topic needs 2 to 6 specific points, not generic statements.
11. If the notes are fragmentary, summarise what is there and leave the rest empty. An honest empty field is better than a guess.
12. "summary.overview" is 2 to 4 sentences of factual prose. Open with the subject and the outcome in the first clause, following this pattern: "<specific subject> caused/needed <number or fact>; the team decided <outcome> on <date>." For example: "Checkout retries produced 12 double-charges in October, so the team will ship exponential backoff behind a feature flag on the 8th." Name the most important number or date in the first sentence. Never begin with "The meeting", "The team", "This meeting" or any framing about the discussion.
13. "summary.highlights" must be short standalone sentences, each carrying a fact, number or name. Do not prefix them with labels such as "Decision:" or "Action:".
14. Never put the same item in two lists. Each risk appears once, each decision once. Before returning, re-read your decisions and risks and delete any line that repeats another.
15. Output must parse with JSON.parse. Do not wrap the object in another key such as "meeting" or "data".`;
}

export function buildExtractionUser(notes, meta = {}) {
  const lines = [
    meta.filename ? `Source file: ${meta.filename}` : '',
    meta.generatedAt ? `Notes captured: ${meta.generatedAt}` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}${lines.length ? '\n\n' : ''}Meeting notes:
<notes>
${notes}
</notes>

Return the JSON report now.`;
}

export function buildChunkSystem() {
  return `You condense part of a long meeting transcript so the rest of the report can be built from it.

Preserve:
- every decision and who made it
- every action item, owner and deadline
- names, numbers, product names and dates exactly
- disagreements, risks and unresolved questions

Drop greetings, filler and repetition. Write compact factual prose or bullets. Do not add opinions. Do not mention that this is a summary. Maximum 350 words.`;
}

export function buildChunkUser(chunk, index, total) {
  return `Part ${index + 1} of ${total} of a meeting transcript:

<part>
${chunk}
</part>

Condense this part.`;
}

export function buildRepairSystem(today) {
  return `You fix malformed JSON. You will receive a model output that failed validation, plus the error.
Return ONLY a corrected, complete, valid JSON object matching the required schema. No markdown fences, no explanation.

Required JSON shape:
${SCHEMA}

Today's date is ${today}. Keep all valid content from the broken output and fill gaps from the notes.`;
}

export function buildRepairUser(previous, error, notes) {
  return `Validation error: ${error}

Previous output:
<previous>
${previous}
</previous>

Original notes:
<notes>
${notes}
</notes>

Return the corrected JSON object.`;
}

export function buildReviewSystem(today) {
  return `You are reviewing a generated meeting report for omissions. Today's date is ${today}.
You will receive the original notes and the current JSON report.

Find only what is MISSING or WRONG in the report:
- action items present in the notes but absent from the report
- decisions mentioned but not recorded
- risks, blockers or open questions that were missed
- owner or due-date details that the report left empty but the notes state

Do NOT repeat items that already exist. A to-do is an action item, never a decision. If an existing action already covers the same piece of work in different words, do not add it again. Do NOT rewrite the whole report. Do not invent anything.

Return ONLY valid JSON in this shape:
{
  "actionItems": [{ "task": "string", "owner": "string", "dueDate": "string", "priority": "high | medium | low", "context": "string" }],
  "decisions": [{ "decision": "string", "rationale": "string", "owner": "string" }],
  "risks": [{ "risk": "string", "impact": "string", "mitigation": "string", "owner": "string" }],
  "openQuestions": ["string"],
  "summary": { "highlights": ["string"] }
}
If nothing is missing, return empty arrays and an empty highlights array.`;
}

export function buildReviewUser(notes, result) {
  return `Current report JSON:
<report>
${JSON.stringify(result, null, 2)}
</report>

Original notes:
<notes>
${notes}
</notes>

Return only the missing items as JSON.`;
}
