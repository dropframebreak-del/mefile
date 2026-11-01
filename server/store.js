import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEETINGS_DIR, SETTINGS_FILE, DEFAULT_SETTINGS, ensureDirs } from './config.js';

const ID_PATTERN = /^[a-z0-9-]{4,80}$/;

function writeJsonAtomic(file, value) {
  ensureDirs();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function makeId(title = '') {
  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'meeting';
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + '-' + [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('');
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${slug}-${stamp}-${suffix}`;
}

function meetingFile(id) {
  return path.join(MEETINGS_DIR, `${id}.json`);
}

export function listMeetings() {
  ensureDirs();
  const files = fs.readdirSync(MEETINGS_DIR).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const file of files) {
    const id = file.slice(0, -5);
    if (!isValidId(id)) continue;
    const m = readJson(path.join(MEETINGS_DIR, file), null);
    if (!m) continue;
    items.push({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      status: m.status,
      model: m.model,
      result: m.result
        ? {
            date: m.result.date,
            attendees: m.result.attendees?.length || 0,
            actionItems: m.result.actionItems?.length || 0,
            summary: m.result.summary?.overview || '',
          }
        : null,
      source: m.source ? { filename: m.source.filename, chars: m.source.chars } : null,
    });
  }
  return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getMeeting(id) {
  if (!isValidId(id)) return null;
  return readJson(meetingFile(id), null);
}

export function saveMeeting(meeting) {
  if (!isValidId(meeting.id)) throw new Error('Invalid meeting id');
  meeting.updatedAt = new Date().toISOString();
  writeJsonAtomic(meetingFile(meeting.id), meeting);
  return meeting;
}

export function deleteMeeting(id) {
  if (!isValidId(id)) return false;
  const file = meetingFile(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function getSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  next.temperature = Number.isFinite(Number(next.temperature))
    ? Math.min(1, Math.max(0, Number(next.temperature)))
    : DEFAULT_SETTINGS.temperature;
  next.numCtx = Number(next.numCtx) >= 2048 ? Number(next.numCtx) : DEFAULT_SETTINGS.numCtx;
  writeJsonAtomic(SETTINGS_FILE, next);
  return next;
}
