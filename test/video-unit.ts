// Unit tests of the pure video rules: line jumps, keys, play modes, gaps, text clean-up, and card lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jumpTarget, lastStarted } from '../src/playback.ts';
import { keyLabel, keyName, videoKey } from '../src/videokeys.ts';

const LINES = [{ start: 1, end: 3, text: '一' }, { start: 3, end: 5, text: '二' }, { start: 8, end: 10, text: '三' }];

test('lastStarted is the last line that started, also in a gap and a little before a start', () => {
  assert.deepEqual([0, 1, 2.9, 2.97, 6, 9, 12].map(time => lastStarted(LINES, time)), [-1, 0, 0, 1, 1, 2, 2]);
});

test('jumpTarget goes to the next, previous, and current line start, or null past the ends', () => {
  const at = (time: number) => (['next', 'previous', 'replay'] as const).map(jump => jumpTarget(LINES, time, jump));
  assert.deepEqual(at(0), [1, null, null]);
  assert.deepEqual(at(2), [3, null, 1]);
  assert.deepEqual(at(3), [8, 1, 3]);
  assert.deepEqual(at(6), [8, 1, 3]);
  assert.deepEqual(at(9), [null, 3, 8]);
});

test('keyName names keys as the key table writes them, with Alt from the code', () => {
  const press = (key: string, code: string, altKey = false, shiftKey = false) => keyName({ key, code, altKey, shiftKey });
  assert.deepEqual([
    press('d', 'KeyD'), press('D', 'KeyD', false, true), press('ArrowLeft', 'ArrowLeft'), press('ø', 'KeyO', true),
    press('=', 'Equal', true), press('–', 'Minus', true), press('.', 'Period'), press('>', 'Period', false, true), press('W', 'KeyW', false, true),
  ], ['d', 'shift+d', 'ArrowLeft', 'alt+o', 'alt+=', 'alt+-', '.', '>', 'shift+w']);
  assert.equal(videoKey({ key: 'ArrowRight', code: 'ArrowRight', altKey: false, shiftKey: false })?.action, 'next');
  assert.equal(videoKey({ key: 'a', code: 'KeyA', altKey: false, shiftKey: false }), null, 'A stays the add key of the popup');
  assert.equal(videoKey({ key: 'a', code: 'KeyA', altKey: true, shiftKey: false })?.action, 'back5');
});

test('keyLabel writes keys for people', () => {
  assert.deepEqual(['ArrowRight', 'd', 'alt+o', 'alt+=', 'shift+w', '.'].map(keyLabel), ['→', 'D', 'Alt+O', 'Alt+=', 'Shift+W', '.']);
});
