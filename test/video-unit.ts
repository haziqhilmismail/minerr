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

test('parseCaptions reads YouTube json3: rolling lines end where the next starts, line-break events drop out', async () => {
  const { parseCaptions } = await import('../src/captions.ts');
  const json3 = JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 101600, id: 1 },
    { tStartMs: 80, dDurationMs: 5920, segs: [{ utf8: 'NHK' }, { utf8: '優しい', tOffsetMs: 680 }] },
    { tStartMs: 3470, dDurationMs: 2530, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 3480, dDurationMs: 5320, segs: [{ utf8: 'ニュース' }] },
  ] });
  assert.deepEqual(parseCaptions('json3', json3), [{ start: 0.08, end: 3.48, text: 'NHK優しい' }, { start: 3.48, end: 8.8, text: 'ニュース' }]);
  assert.deepEqual(parseCaptions('srt', '1\n00:00:01,000 --> 00:00:02,000\n猫\n'), [{ start: 1, end: 2, text: '猫' }]);
});
