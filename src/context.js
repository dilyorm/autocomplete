import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// Ring buffer of recent agent output lines (ANSI-stripped) = the "conversation".
export class Transcript {
  constructor(max = 60) { this.lines = []; this.max = max; this._partial = ''; }
  push(chunk) {
    const text = (this._partial + chunk).replace(ANSI, '').replace(/\r/g, '');
    const parts = text.split('\n');
    this._partial = parts.pop();
    for (const p of parts) this.lines.push(p);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  recent(n = 30) { return this.lines.slice(-n).join('\n'); }
}

// Installed skills = names under ~/.claude/skills (best-effort). ponytail: names only.
export function installedSkills() {
  const out = [];
  for (const base of [join(homedir(), '.claude', 'skills')]) {
    if (!existsSync(base)) continue;
    for (const name of safeDirs(base)) {
      let desc = '';
      const md = join(base, name, 'SKILL.md');
      if (existsSync(md)) {
        const m = readFileSync(md, 'utf8').match(/description:\s*(.+)/i);
        if (m) desc = m[1].trim().slice(0, 80);
      }
      out.push(desc ? `${name}: ${desc}` : name);
    }
  }
  return out;
}

function safeDirs(p) {
  try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return []; }
}

export function buildContext({ buffer, transcript, skills }) {
  return {
    buffer,
    conversation: transcript ? transcript.recent(30) : '',
    skills: (skills || []).slice(0, 40)
  };
}
