import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Debug log to a file (stderr would corrupt the wrapped TUI). Off unless ACOMPLETE_DEBUG set.
const ON = !!process.env.ACOMPLETE_DEBUG;
const FILE = process.env.ACOMPLETE_DEBUG && process.env.ACOMPLETE_DEBUG !== '1'
  ? process.env.ACOMPLETE_DEBUG
  : join(homedir(), '.acomplete', 'debug.log');
if (ON) { try { mkdirSync(dirname(FILE), { recursive: true }); } catch {} }

export function dbg(...args) {
  if (!ON) return;
  try { appendFileSync(FILE, args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n'); }
  catch {}
}
export const debugFile = FILE;
