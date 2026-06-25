import pty from 'node-pty';
import { InputTracker } from './tracker.js';
import { Transcript, installedSkills, buildContext } from './context.js';
import { complete } from './providers.js';
import { dbg } from './log.js';

const DIM = '\x1b[90m', RESET = '\x1b[0m';

export function startRelay(agentArgv, cfg) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const isWin = process.platform === 'win32';
  const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const shellArgs = isWin ? ['/c', agentArgv.join(' ')] : ['-c', agentArgv.join(' ')];

  const child = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color', cols, rows, cwd: process.cwd(), env: process.env
  });

  const tracker = new InputTracker();
  const transcript = new Transcript();
  const skills = installedSkills();

  let suggestion = '';
  let timer = null;
  let reqId = 0;

  const out = s => process.stdout.write(s);

  function renderSuggestion() {
    if (!suggestion) return;
    const row = process.stdout.rows || rows;
    const width = (process.stdout.columns || cols) - 3;
    const text = suggestion.replace(/\s+/g, ' ').slice(0, Math.max(0, width));
    out(`\x1b7\x1b[${row};1H\x1b[2K${DIM}↹ ${text}${RESET}\x1b8`);
  }

  function clearSuggestion() {
    if (!suggestion) return;
    suggestion = '';
    const row = process.stdout.rows || rows;
    out(`\x1b7\x1b[${row};1H\x1b[2K\x1b8`);
  }

  function scheduleSuggest() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const buffer = tracker.buffer;
      if (!buffer.trim()) return;
      const myId = ++reqId;
      const ctx = buildContext({ buffer, transcript, skills });
      dbg('REQ', myId, 'buffer=', buffer);
      const text = await complete(cfg, ctx);
      dbg('RESP', myId, 'text=', text, 'stale=', myId !== reqId || tracker.buffer !== buffer);
      // Drop if the buffer moved on or a newer request started.
      if (myId !== reqId || tracker.buffer !== buffer || !text) return;
      suggestion = text;
      renderSuggestion();
      dbg('RENDER', suggestion);
    }, cfg.debounceMs);
  }

  child.onData(data => {
    out(data);
    transcript.push(data);
  });

  child.onExit(({ exitCode }) => {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
    out(`\x1b[0m\n`);
    process.exit(exitCode || 0);
  });

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    const type = tracker.feed(chunk);
    dbg('KEY type=', type, 'buf=', tracker.buffer);
    if (type === 'tab' && suggestion) {
      const s = suggestion;
      clearSuggestion();
      tracker.accept(s);
      child.write(s);        // inject accepted text into the agent
      return;                // swallow the Tab
    }
    clearSuggestion();
    child.write(chunk);
    if (type === 'edit') scheduleSuggest();
  });

  process.stdout.on('resize', () => {
    try { child.resize(process.stdout.columns || cols, process.stdout.rows || rows); } catch {}
  });
}
