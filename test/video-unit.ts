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

test('addNote adds a missing SentenceAudio field to an old Minerr note type and sends the line audio', async () => {
  const { addNote, BUILTIN, NOTE_TYPE, RECOGNITION } = await import('../src/anki.ts');
  const requests: { action: string; params: Record<string, unknown> }[] = [];
  const replies: Record<string, unknown> = {
    createDeck: 1, modelNames: ['Minerr'], modelFieldNames: ['Word', 'Reading', 'Sentence', 'Definition', 'Image'],
    modelTemplates: { Recognition: { Front: RECOGNITION.Front, Back: 'old back' } }, modelStyling: { css: NOTE_TYPE.css },
    modelFieldAdd: null, updateModelTemplates: null, addNote: 42, storeMediaFile: 'minerr-1.mp3',
  };
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    return new Response(JSON.stringify({ result: replies[request.action], error: null }));
  };
  try {
    const card = { word: '猫', reading: 'ねこ', sentence: '<b>猫</b>だ', definition: 'cat' };
    const audio = { filename: 'minerr-1.mp3', data: 'SUQz' };
    const page = { url: 'https://example.com/', title: 'Cats' };
    assert.equal(await addNote({ deck: 'Minerr', noteType: BUILTIN, card, page, jpegDataUrl: 'data:image/jpeg;base64,/9j/', audio }), 42);
    assert.deepEqual(requests.filter(r => r.action === 'modelFieldAdd').map(r => r.params),
      [{ modelName: 'Minerr', fieldName: 'SentenceAudio', index: 5 }]);
    assert.ok(RECOGNITION.Back.includes('{{SentenceAudio}}'));
    assert.equal(requests.filter(r => r.action === 'updateModelTemplates').length, 1);
    const note = requests.find(r => r.action === 'addNote')?.params.note;
    assert.deepEqual((note as { audio: unknown }).audio, [{ filename: 'minerr-1.mp3', data: 'SUQz', fields: ['SentenceAudio'] }]);

    requests.length = 0;
    const custom = { kind: 'custom' as const, model: 'Mine', fields: { Front: '{sentence}', Audio: '{audio}', Back: '{word}' } };
    await addNote({ deck: 'Minerr', noteType: custom, card, page, jpegDataUrl: 'data:image/jpeg;base64,/9j/', audio });
    assert.deepEqual(requests.map(r => r.action), ['createDeck', 'storeMediaFile', 'addNote'], 'no screenshot is stored without {image}');
    assert.deepEqual((requests[2]?.params.note as { fields: unknown }).fields, { Front: '<b>猫</b>だ', Audio: '[sound:minerr-1.mp3]', Back: '猫' });
    requests.length = 0;
    await addNote({ deck: 'Minerr', noteType: custom, card, page, jpegDataUrl: 'data:image/jpeg;base64,/9j/', audio: null });
    assert.deepEqual((requests[1]?.params.note as { fields: unknown }).fields, { Front: '<b>猫</b>だ', Audio: '', Back: '猫' });
  } finally {
    globalThis.fetch = saved;
  }
});
