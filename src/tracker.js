// Mirrors the user's current prompt buffer from raw keystrokes.
// We own outer stdin, so the buffer is built from what the user types — we
// never parse the agent's redraws.
//
// On Windows, ConPTY puts the terminal in win32-input-mode (CSI ?9001h), so
// keys arrive as records `ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` (Uc = unicode
// char, Kd = 1 down / 0 up). We decode those; on other platforms keys arrive
// as plain bytes. Focus events (CSI I/O), arrows, and key-up are ignored so
// they don't corrupt the buffer.
// ponytail ceiling: bracketed-paste and Ctrl-modified chars are best-effort.
export class InputTracker {
  constructor() { this.buffer = ''; }

  // Returns the dominant key type: 'tab' | 'enter' | 'clear' | 'edit' | 'none'.
  // Tab never mutates the buffer (the relay decides accept-vs-forward).
  feed(chunk) {
    let type = 'none';
    const n = chunk.length;
    let i = 0;
    while (i < n) {
      if (chunk[i] === '\x1b' && chunk[i + 1] === '[') {
        let j = i + 2;
        while (j < n) { const c = chunk.charCodeAt(j); if (c >= 0x40 && c <= 0x7e) break; j++; }
        if (j < n) {
          const t = this._csi(chunk[j], chunk.slice(i + 2, j));
          if (t === 'tab') return 'tab';
          if (t) type = t;
          i = j + 1;
          continue;
        }
      }
      if (chunk[i] === '\x1b') { i++; continue; }   // lone ESC / unknown
      const t = this._char(chunk.charCodeAt(i), chunk[i]);
      if (t === 'tab') return 'tab';
      if (t) type = t;
      i++;
    }
    return type;
  }

  _csi(final, params) {
    if (final !== '_') return null;            // not a win32 record (focus/arrow/etc) -> ignore
    const p = params.split(';');
    const vk = Number(p[0] || 0);
    const uc = Number(p[2] || 0);
    const cs = Number(p[4] || 0);              // control-key state
    if (p[3] !== '1') return null;             // ignore key-up
    if (vk === 8 && (cs & 0x10)) return 'undo'; // Shift+Backspace (win32 only)
    if (!uc) return null;                      // non-character key (arrows, F-keys)
    return this._char(uc);
  }

  _char(code, ch) {
    if (code === 9) return 'tab';
    if (code === 13 || code === 10) { this.buffer = ''; return 'enter'; }
    if (code === 8 || code === 127) { this.buffer = this.buffer.slice(0, -1); return 'edit'; }
    if (code === 27 || code === 3 || code === 21) { this.buffer = ''; return 'clear'; }
    if (code >= 32) { this.buffer += ch !== undefined ? ch : String.fromCodePoint(code); return 'edit'; }
    return null;
  }

  clear() { this.buffer = ''; }
  accept(suffix) { this.buffer += suffix; }
}
