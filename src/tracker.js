// Mirrors the user's current prompt buffer from raw keystrokes and classifies
// the special keys the relay acts on. We own outer stdin, so the buffer is
// built from what the user types — we never parse the agent's redraws.
//
// Keys arrive in several encodings depending on terminal/OS:
//   - Windows ConPTY win32-input-mode:  ESC [ Vk;Sc;Uc;Kd;Cs;Rc _
//   - xterm modifyOtherKeys:            ESC [ 27;mods;code ~
//   - kitty keyboard protocol:          ESC [ code;mods u
//   - legacy arrows / SS3:              ESC [ C  /  ESC O C  (etc.)
//   - plain bytes on simple terminals
// We decode the typed character and detect Tab, Shift+Backspace (undo) and
// Right-arrow (word accept) in all of them. Focus events, key-up, and other
// arrows are ignored so they never corrupt the buffer.
// ponytail ceiling: bracketed-paste and Ctrl-modified chars are best-effort.
export class InputTracker {
  constructor() { this.buffer = ''; }

  // Returns: 'tab' | 'undo' | 'word' | 'enter' | 'clear' | 'edit' | 'none'.
  feed(chunk) {
    let type = 'none';
    const n = chunk.length;
    let i = 0;
    while (i < n) {
      if (chunk[i] === '\x1b' && (chunk[i + 1] === '[' || chunk[i + 1] === 'O')) {
        const ss3 = chunk[i + 1] === 'O';
        let j = i + 2;
        while (j < n) { const c = chunk.charCodeAt(j); if (c >= 0x40 && c <= 0x7e) break; j++; }
        if (j < n) {
          const t = ss3 ? this._ss3(chunk[j]) : this._csi(chunk[j], chunk.slice(i + 2, j));
          if (t === 'tab' || t === 'undo' || t === 'word' || t === 'rephrase') return t;
          if (t) type = t;
          i = j + 1;
          continue;
        }
      }
      if (chunk[i] === '\x1b') { i++; continue; }   // lone ESC / unknown
      const t = this._char(chunk.charCodeAt(i), chunk[i]);
      if (t === 'tab' || t === 'rephrase') return t;
      if (t) type = t;
      i++;
    }
    return type;
  }

  _ss3(final) {            // ESC O <final> — application-mode arrows
    if (final === 'C') return 'word';   // Right arrow
    return null;
  }

  _csi(final, params) {
    const p = params.split(';').map(s => s.split(':')[0]);   // kitty sub-params use ':'
    if (final === '_') {                 // win32-input-mode record
      const vk = Number(p[0] || 0), uc = Number(p[2] || 0), cs = Number(p[4] || 0);
      if (p[3] !== '1') return null;      // ignore key-up
      if (vk === 8 && (cs & 0x10)) return 'undo';   // Shift+Backspace
      if (vk === 82 && (cs & 0x0c)) return 'rephrase';   // Ctrl+R (L/R ctrl)
      if (vk === 39) return 'word';                  // Right arrow
      if (!uc) return null;
      return this._char(uc);
    }
    if (final === 'C') return 'word';     // CSI Right arrow
    if (final === 'D' || final === 'A' || final === 'B') return null;  // other arrows: ignore
    if (final === 'u') {                  // kitty keyboard: code;mods
      const code = Number(p[0] || 0), mods = Number(p[1] || 1);
      if ((code === 8 || code === 127) && shift(mods)) return 'undo';
      if (code === 114 && ctrl(mods)) return 'rephrase';   // Ctrl+R
      if (mods <= 1) return this._char(code);
      return null;
    }
    if (final === '~') {                  // xterm modifyOtherKeys: 27;mods;code
      if (p[0] === '27') {
        const mods = Number(p[1] || 1), code = Number(p[2] || 0);
        if ((code === 8 || code === 127) && shift(mods)) return 'undo';
        if (code === 114 && ctrl(mods)) return 'rephrase';   // Ctrl+R
      }
      return null;                        // focus (I/O handled as null), nav keys
    }
    return null;                          // focus in/out, cursor reports, etc.
  }

  _char(code, ch) {
    if (code === 9) return 'tab';
    if (code === 18) return 'rephrase';   // Ctrl+R on plain terminals (0x12)
    if (code === 13 || code === 10) { this.buffer = ''; return 'enter'; }
    if (code === 8 || code === 127) { this.buffer = this.buffer.slice(0, -1); return 'edit'; }
    if (code === 27 || code === 3 || code === 21) { this.buffer = ''; return 'clear'; }
    if (code >= 32) { this.buffer += ch !== undefined ? ch : String.fromCodePoint(code); return 'edit'; }
    return null;
  }

  clear() { this.buffer = ''; }
  accept(suffix) { this.buffer += suffix; }
}

// kitty/xterm modifier code: 1=none, 2=shift, 3=alt, ... (1 + bitmask). Shift = bit 0.
function shift(mods) { return ((Number(mods) - 1) & 1) === 1; }
// Ctrl = bit 2 (value 4) in the kitty/xterm modifier bitmask.
function ctrl(mods) { return ((Number(mods) - 1) & 4) === 4; }
