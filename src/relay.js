import pty from 'node-pty';
import { InputTracker } from './tracker.js';
import { Transcript, installedSkills, buildContext } from './context.js';
import { complete, rephrase } from './providers.js';
import { isGreeting, jokeSuggestion, gotcha } from './pranks.js';
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

  let suggestion = '';   // full suggestion (what Tab injects)
  let shown = '';        // truncated text currently drawn on screen
  let prank = false;     // current suggestion is a greeting joke (Tab -> gotcha)
  let undoState = null;  // {backspaces, insert, resultBuffer} — Shift+Backspace target
                         // (undoes the last Tab/→ accept OR a Ctrl+R rephrase)
  let timer = null;
  let renderTimer = null;
  let reqId = 0;

  const out = s => process.stdout.write(s);

  // Estimate the cursor's column on its current visual row, accounting for
  // line wrap and multi-line (Shift+Enter) prompts. "❯ " (2 cols) prefixes
  // only the first line. ponytail ceiling: assumes 1-col-per-char width.
  function cursorCol() {
    const width = process.stdout.columns || cols;
    const buf = tracker.buffer;
    const nl = buf.lastIndexOf('\n');
    const lineLen = nl >= 0 ? buf.length - nl - 1 : 2 + buf.length;
    return lineLen % width;
  }

  // Inline ghost text: draw dim text AT the cursor (input end), then restore
  // the cursor so it stays put and the suggestion appears to the right. The
  // ghost is truncated to fit the rest of the current row, so it never wraps
  // (which keeps the single-line clear-to-EOL erase correct even mid-wrap).
  function renderSuggestion() {
    if (!suggestion) return;
    const width = process.stdout.columns || cols;
    const avail = width - cursorCol() - 1;
    if (avail < 4) return;
    shown = suggestion.replace(/\r?\n/g, ' ').slice(0, avail);
    out(`\x1b7${DIM}${shown}${RESET}\x1b8`);     // save cursor, dim text, restore
  }

  function clearSuggestion() {
    suggestion = '';
    prank = false;
    if (!shown) return;
    shown = '';
    out(`\x1b7\x1b[0K\x1b8`);                     // erase from cursor to end of line
  }

  function scheduleSuggest() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const buffer = tracker.buffer;
      if (!buffer.trim()) return;
      if (isGreeting(buffer)) {              // easter egg: joke instead of a real call
        suggestion = jokeSuggestion();
        prank = true;
        renderSuggestion();
        return;
      }
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

  // Ctrl+R: ask the model to rewrite the whole prompt, then replace it in the
  // agent's input box (backspace the old text, type the new). Shift+Backspace
  // restores the original via undoState. ponytail ceiling: the backspaces assume
  // a single-line prompt; a multi-line (Shift+Enter) prompt may not erase cleanly.
  async function rephrasePrompt(original) {
    if (!original.trim()) return;
    const myId = ++reqId;     // also invalidates any in-flight suggestion
    const ctx = buildContext({ buffer: original, transcript, skills });
    dbg('REPHRASE-REQ', myId, original);
    const text = await rephrase(cfg, ctx);
    dbg('REPHRASE-RESP', myId, text);
    if (!text || text === original) return;
    if (myId !== reqId || tracker.buffer !== original) return;   // user moved on
    child.write('\x7f'.repeat(original.length));   // erase the old prompt
    child.write(text);                              // type the rewritten one
    tracker.buffer = text;
    undoState = { backspaces: text.length, insert: original, resultBuffer: original };
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
    if (type === 'tab' && suggestion && prank) {   // gotcha! never injects
      if (shown) { out(`\x1b7\x1b[0K\x1b8`); shown = ''; }
      const g = gotcha();
      suggestion = ''; prank = false;
      const width = process.stdout.columns || cols;
      const text = g.slice(0, Math.max(0, width - cursorCol() - 1));
      out(`\x1b7${DIM}${text}${RESET}\x1b8`);
      shown = text;          // persists until the next keystroke clears it (no auto-erase)
      return;                // swallow the Tab
    }
    if (type === 'tab' && suggestion) {
      const s = suggestion;
      clearSuggestion();
      const before = tracker.buffer;
      tracker.accept(s);
      undoState = { backspaces: s.length, insert: '', resultBuffer: before };
      child.write(s);        // inject accepted text into the agent
      return;                // swallow the Tab
    }
    if (type === 'word' && suggestion && !prank) {   // Right arrow — accept one word
      const m = suggestion.match(/^\s*\S+/);
      if (m) {
        const word = m[0];
        if (shown) { out(`\x1b7\x1b[0K\x1b8`); shown = ''; }   // erase current ghost
        suggestion = suggestion.slice(word.length);
        const before = tracker.buffer;
        tracker.accept(word);
        undoState = { backspaces: word.length, insert: '', resultBuffer: before };
        child.write(word);
        // Re-draw the remaining ghost after the agent advances the cursor.
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(renderSuggestion, 60);
      }
      return;                // swallow the arrow
    }
    if (type === 'rephrase') {   // Ctrl+R — rewrite the whole prompt in place
      clearSuggestion();
      rephrasePrompt(tracker.buffer);
      return;                // swallow Ctrl+R
    }
    if (type === 'undo') {    // Shift+Backspace — restore pre-accept / pre-rephrase text
      clearSuggestion();
      if (undoState) {
        child.write('\x7f'.repeat(undoState.backspaces));    // erase current text
        if (undoState.insert) child.write(undoState.insert); // put the original back
        tracker.buffer = undoState.resultBuffer;
        undoState = null;
      }
      return;                 // swallow Shift+Backspace
    }
    clearSuggestion();
    child.write(chunk);
    if (type === 'edit') { undoState = null; scheduleSuggest(); }
    else if (type === 'enter' || type === 'clear') undoState = null;
  });

  process.stdout.on('resize', () => {
    try { child.resize(process.stdout.columns || cols, process.stdout.rows || rows); } catch {}
  });
}
