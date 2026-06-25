import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputTracker } from '../src/tracker.js';
import { Transcript, buildContext } from '../src/context.js';
import { _internal } from '../src/providers.js';

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

test('providers.clean: strips echoed buffer and quotes', () => {
  assert.equal(_internal.clean('"world"', ''), 'world');
  assert.equal(_internal.clean('hello world', 'hello '), 'world');   // strips echoed prefix
  assert.equal(_internal.clean('', 'x'), '');
});
