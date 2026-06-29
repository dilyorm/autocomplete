import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputTracker } from '../src/tracker.js';
import { Transcript, buildContext } from '../src/context.js';
import { _internal } from '../src/providers.js';
import { isGreeting, jokeSuggestion, gotcha } from '../src/pranks.js';

test('tracker: builds buffer, backspace, enter clears, tab is non-mutating', () => {
  const t = new InputTracker();
  t.feed('fix');
  t.feed(' bug');
  assert.equal(t.buffer, 'fix bug');
  t.feed('\x7f');                 // backspace
  assert.equal(t.buffer, 'fix bu');
  assert.equal(t.feed('\t'), 'tab');
  assert.equal(t.buffer, 'fix bu');   // tab must not mutate
  assert.equal(t.feed('\r'), 'enter');
  assert.equal(t.buffer, '');         // enter clears
});

test('tracker: decodes win32-input-mode records, ignores key-up/focus', () => {
  const t = new InputTracker();
  // 'a' down (Uc=97,Kd=1) + 'a' up (Kd=0) + 'b' down — only downs count
  t.feed('\x1b[65;30;97;1;32;1_');   // a down
  t.feed('\x1b[65;30;97;0;32;1_');   // a up (ignored)
  t.feed('\x1b[66;48;98;1;32;1_');   // b down
  assert.equal(t.buffer, 'ab');
  t.feed('\x1b[I');                  // focus-in (ignored, no mutation)
  assert.equal(t.buffer, 'ab');
  assert.equal(t.feed('\x1b[8;14;8;1;32;1_'), 'edit');   // backspace down
  assert.equal(t.buffer, 'a');
  assert.equal(t.feed('\x1b[9;15;9;1;32;1_'), 'tab');    // tab down -> non-mutating
  assert.equal(t.buffer, 'a');
});

test('tracker: Shift+Backspace -> undo, buffer untouched', () => {
  const t = new InputTracker();
  t.feed('\x1b[65;30;97;1;32;1_');                 // 'a'
  assert.equal(t.feed('\x1b[8;14;8;1;16;1_'), 'undo');  // Cs=16 -> Shift
  assert.equal(t.buffer, 'a');                     // undo does not pop here (relay does)
  assert.equal(t.feed('\x1b[8;14;8;1;32;1_'), 'edit');  // plain backspace still edits
  assert.equal(t.buffer, '');
});

test('tracker: Right arrow -> word accept (win32 / CSI / SS3)', () => {
  const t = new InputTracker();
  assert.equal(t.feed('\x1b[39;0;0;1;0;1_'), 'word');   // win32 VK_RIGHT
  assert.equal(t.feed('\x1b[C'), 'word');                // CSI right
  assert.equal(t.feed('\x1bOC'), 'word');                // SS3 right
});

test('tracker: cross-platform Shift+Backspace -> undo (kitty / xterm)', () => {
  const t = new InputTracker();
  assert.equal(t.feed('\x1b[127;2u'), 'undo');           // kitty, shift mod
  assert.equal(t.feed('\x1b[27;2;8~'), 'undo');          // xterm modifyOtherKeys
  assert.equal(t.feed('\x1b[127;1u'), 'edit');           // no shift = plain backspace
});

test('tracker: Ctrl+R -> rephrase (win32 / kitty / xterm / plain)', () => {
  const t = new InputTracker();
  assert.equal(t.feed('\x1b[82;19;18;1;8;1_'), 'rephrase');   // win32 VK_R + LEFT_CTRL
  assert.equal(t.feed('\x1b[114;5u'), 'rephrase');             // kitty, ctrl mod
  assert.equal(t.feed('\x1b[27;5;114~'), 'rephrase');          // xterm modifyOtherKeys
  assert.equal(t.feed('\x12'), 'rephrase');                    // plain Ctrl+R byte (0x12)
  assert.equal(t.feed('\x1b[114;1u'), 'edit');                 // plain 'r' (no ctrl) -> edit
  assert.equal(t.buffer, 'r');
});

test('providers.cleanRewrite: strips wrapping quotes/whitespace, keeps rewrite', () => {
  assert.equal(_internal.cleanRewrite('\n "Add dark mode toggle" '), 'Add dark mode toggle');
  assert.equal(_internal.cleanRewrite("I don't have enough context"), "I don't have enough context");
});

test('providers.clean: drops chatty refusals, keeps real completions', () => {
  assert.equal(_internal.clean("I don't have enough context to complete.", ''), '');
  assert.equal(_internal.clean('Could you provide more?', ''), '');
  assert.equal(_internal.clean(' a dark mode toggle', 'add'), ' a dark mode toggle');
});

test('tracker: accept appends suggestion suffix', () => {
  const t = new InputTracker();
  t.feed('add ');
  t.accept('a dark mode toggle');
  assert.equal(t.buffer, 'add a dark mode toggle');
});

test('transcript: strips ANSI and keeps recent lines', () => {
  const tr = new Transcript(3);
  tr.push('\x1b[31mhello\x1b[0m\nworld\n');
  tr.push('a\nb\nc\n');
  assert.ok(!tr.recent().includes('\x1b'));
  assert.equal(tr.recent().split('\n').length, 3);   // capped at max
});

test('buildContext: shape', () => {
  const c = buildContext({ buffer: 'hi', transcript: new Transcript(), skills: ['x'] });
  assert.equal(c.buffer, 'hi');
  assert.deepEqual(c.skills, ['x']);
});

test('pranks: matches pure greetings only', () => {
  for (const g of ['hey', 'hi', 'hello', 'hey claude', 'yo!', 'HELLO', 'gm'])
    assert.equal(isGreeting(g), true, g);
  for (const r of ['hey can you fix this', 'fix the bug', 'hire someone', 'history'])
    assert.equal(isGreeting(r), false, r);
  assert.ok(jokeSuggestion().length > 0 && gotcha().length > 0);
});

test('providers.clean: strips echoed buffer and quotes', () => {
  assert.equal(_internal.clean('"world"', ''), 'world');
  assert.equal(_internal.clean('hello world', 'hello '), 'world');   // strips echoed prefix
  assert.equal(_internal.clean('', 'x'), '');
});
