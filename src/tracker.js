// Mirrors the user's current prompt buffer from raw keystrokes.
// We own outer stdin, so the buffer is built from what the user types —
// we never parse the agent's redraws. ponytail ceiling: escape sequences
// (arrows/history nav) reset the buffer; refined only if it bites.
export class InputTracker {
  constructor() { this.buffer = ''; }

  // Feed a decoded keystroke chunk. Returns the dominant key type:
  // 'tab' | 'enter' | 'clear' | 'edit'. Tab does NOT mutate the buffer
  // (the relay decides accept-vs-forward based on suggestion presence).
  feed(chunk) {
    let type = 'edit';
    for (const ch of chunk) {
      const c = ch.codePointAt(0);
      if (c === 0x09) return 'tab';
      if (c === 0x0d || c === 0x0a) { this.buffer = ''; type = 'enter'; continue; }
      if (c === 0x7f || c === 0x08) { this.buffer = this.buffer.slice(0, -1); type = 'edit'; continue; }
      if (c === 0x03 || c === 0x15 || c === 0x1b) { this.buffer = ''; type = 'clear'; continue; }
      if (c >= 0x20) { this.buffer += ch; type = 'edit'; }
    }
    return type;
  }

  clear() { this.buffer = ''; }

  // Accepting a suggestion appends it to the mirrored buffer.
  accept(suffix) { this.buffer += suffix; }
}
