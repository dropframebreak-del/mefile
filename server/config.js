import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = process.env.MEETING_DATA_DIR
  ? path.resolve(process.env.MEETING_DATA_DIR)
  : path.join(ROOT, 'data');
export const MEETINGS_DIR = path.join(DATA_DIR, 'meetings');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 4317);

export const DEFAULT_SETTINGS = {
  baseUrl: 'http://127.0.0.1:11434',
  provider: 'ollama',
  model: '',
  temperature: 0.2,
  thorough: false,
  numCtx: 8192,
};

export function ensureDirs() {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}

ensureDirs();
