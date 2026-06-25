import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.acomplete');
const FILE = join(DIR, 'config.json');

const DEFAULTS = {
  mode: 'auto',            // auto | free | byo
  provider: 'anthropic',   // anthropic | deepseek | openai | gemini  (used when mode=byo)
  apiKey: '',
  model: '',               // empty -> per-provider fast default
  proxyUrl: '',            // free-tier proxy (step 2)
  debounceMs: 400
};

export function load() {
  if (!existsSync(FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(cfg) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  return FILE;
}

// `acomplete config key=value ...` — minimal editor, YAGNI on a TUI.
export function configCli(args) {
  const cfg = load();
  if (args.length === 0) {
    const shown = { ...cfg, apiKey: cfg.apiKey ? '***set***' : '' };
    console.log(JSON.stringify(shown, null, 2));
    console.log(`\nedit: acomplete config mode=byo provider=deepseek apiKey=sk-... model=deepseek-chat`);
    return;
  }
  for (const a of args) {
    const i = a.indexOf('=');
    if (i < 0) continue;
    const k = a.slice(0, i), v = a.slice(i + 1);
    if (k in DEFAULTS) cfg[k] = k === 'debounceMs' ? Number(v) : v;
  }
  const path = save(cfg);
  console.log(`saved ${path}`);
}
