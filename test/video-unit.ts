// Unit tests of the pure video rules: line jumps, keys, play modes, gaps, text clean-up, card lines, and the server hint.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choices, FILTER_NAMES, type LineState, shownLines, targetWord } from '../src/video/sidebar/sidebar-filter.ts';
import { summary } from '../src/video/sidebar/sidebar-select.ts';
import { autoPause, cleanSegments, cleanText, gapEnd, jumpTarget, lastStarted, onLine } from '../src/video/playback.ts';
import { isStatus } from '../src/status/status.ts';
import { keyLabel, keyName, videoKey } from '../src/video/videokeys.ts';
import { isNoHostError, type Place, serverHint, serverStatus, serverView } from '../src/video/server-status.ts';

const LINES = [{ start: 1, end: 3, text: '一' }, { start: 3, end: 5, text: '二' }, { start: 8, end: 10, text: '三' }];

test('onLine is true from a little before the start of a line to its end', () => {
  const line = { start: 3, end: 5, text: '二' };
  assert.deepEqual([2.9, 2.97, 3, 4.99, 5, 8].map(time => onLine(line, time)), [false, true, true, true, false, false]);
});

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
  const action = (key: string, code: string, shiftKey = false) => videoKey({ key, code, altKey: false, shiftKey })?.action;
  assert.deepEqual([action('a', 'KeyA'), action('s', 'KeyS'), action('d', 'KeyD'), action('ArrowUp', 'ArrowUp'), action('ArrowUp', 'ArrowUp', true)],
    ['previous', 'replay', 'next', 'obscure', 'second'], 'the Migaku keys: A, S, D, and the up arrow');
  assert.equal(videoKey({ key: 'a', code: 'KeyA', altKey: true, shiftKey: false })?.action, 'back5');
});

test('keyLabel writes keys for people', () => {
  assert.deepEqual(['ArrowRight', 'd', 'alt+o', 'alt+=', 'shift+w', '.'].map(keyLabel), ['→', 'D', 'Alt+O', 'Alt+=', 'Shift+W', '.']);
});

test('parseCaptions reads YouTube json3: rolling lines end where the next starts, line-break events drop out', async () => {
  const { parseCaptions } = await import('../src/video/captions.ts');
  const json3 = JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 101600, id: 1 },
    { tStartMs: 80, dDurationMs: 5920, segs: [{ utf8: 'NHK' }, { utf8: '優しい', tOffsetMs: 680 }] },
    { tStartMs: 3470, dDurationMs: 2530, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 3480, dDurationMs: 5320, segs: [{ utf8: 'ニュース' }] },
  ] });
  assert.deepEqual(parseCaptions('json3', json3), [{ start: 0.08, end: 3.48, text: 'NHK優しい' }, { start: 3.48, end: 8.8, text: 'ニュース' }]);
  assert.deepEqual(parseCaptions('srt', '1\n00:00:01,000 --> 00:00:02,000\n猫\n'), [{ start: 1, end: 2, text: '猫' }]);
});

test('trackUrl takes the uploader track, then the automatic one, and never a machine translation into Japanese', async () => {
  const { trackUrl } = await import('../src/video/youtube/youtube-captions.ts');
  const base = 'https://www.youtube.com/api/timedtext?v=v1';
  const track = (languageCode: string, kind: string | null) => ({ languageCode, kind, vssId: `${kind ? 'a' : ''}.${languageCode}`,
    baseUrl: `${base}&lang=${languageCode}${kind ? `&kind=${kind}` : ''}` });
  const urls = (captions: Parameters<typeof trackUrl>[0]) => ['ja', 'en'].map(lang => trackUrl(captions, lang)?.href.replace(base, '') ?? null);
  assert.deepEqual(urls({ tracks: [track('ja', 'asr'), track('ja-JP', null), track('ja', null)], dubbed: [] }), ['&lang=ja', '&lang=ja&tlang=en']);
  assert.deepEqual(urls({ tracks: [track('ja', 'asr')], dubbed: [] }), ['&lang=ja&kind=asr', '&lang=ja&kind=asr&tlang=en']);
  assert.deepEqual(urls({ tracks: [track('en', 'asr'), track('en', null)], dubbed: [] }), [null, '&lang=en']);
  assert.deepEqual(urls({ tracks: [track('en', 'asr'), track('ja', 'asr'), track('ko', 'asr')], dubbed: ['ja', 'ko'] }), [null, '&lang=en&kind=asr']);
});

test('addNote adds a missing SentenceAudio field to an old Minerr note type and sends the line audio', async () => {
  const { addDraft, BUILTIN, noteDraft, NOTE_TYPE, RECOGNITION } = await import('../src/anki/anki.ts');
  const requests: { action: string; params: Record<string, unknown> }[] = [];
  const replies: Record<string, unknown> = {
    createDeck: 1, modelNames: ['Minerr'], modelFieldNames: ['Word', 'Reading', 'Sentence', 'Definition', 'Image'],
    modelTemplates: { Recognition: { Front: RECOGNITION.Front, Back: 'old back' } }, modelStyling: { css: NOTE_TYPE.css },
    modelFieldAdd: null, updateModelTemplates: null, addNote: 42,
  };
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const result = request.action === 'storeMediaFile' ? `stored-${request.params.filename}` : replies[request.action];
    return new Response(JSON.stringify({ result, error: null }));
  };
  try {
    const audio = { filename: 'minerr-1.mp3', data: 'SUQz' };
    const plain = { word: '猫', reading: 'ねこ', sentence: '<b>猫</b>だ', definition: 'cat', entry: null, selection: '' };
    const card = { ...plain, audio };
    const page = { url: 'https://example.com/', title: 'Cats' };
    const add = (noteType: Parameters<typeof noteDraft>[0], fields: Parameters<typeof noteDraft>[1]) =>
      addDraft('Minerr', noteDraft(noteType, { ...fields, image: { filename: 'minerr-1.jpg', data: '/9j/' } }, page));
    assert.equal(await add(BUILTIN, card), 42);
    assert.deepEqual(requests.filter(r => r.action === 'modelFieldAdd').map(r => r.params),
      [{ modelName: 'Minerr', fieldName: 'SentenceAudio', index: 5 }]);
    assert.ok(RECOGNITION.Back.includes('{{SentenceAudio}}'));
    assert.equal(requests.filter(r => r.action === 'updateModelTemplates').length, 1);
    const stored = requests.filter(r => r.action === 'storeMediaFile').map(r => r.params);
    assert.deepEqual(stored[1], audio);
    const fields = (requests.find(r => r.action === 'addNote')?.params.note as { fields: Record<string, string> }).fields;
    assert.equal(fields.SentenceAudio, '[sound:stored-minerr-1.mp3]', 'the field names the file as Anki stored it');
    assert.equal(fields.Image, `<img src="stored-${String(stored[0]?.filename)}">`);

    requests.length = 0;
    const custom = { kind: 'custom' as const, model: 'Mine', fields: { Front: '{sentence}', Audio: '{audio}', Back: '{word}' } };
    await add(custom, card);
    assert.deepEqual(requests.map(r => r.action), ['createDeck', 'storeMediaFile', 'addNote'], 'no screenshot is stored without {image}');
    assert.deepEqual((requests[2]?.params.note as { fields: unknown }).fields, { Front: '<b>猫</b>だ', Audio: '[sound:stored-minerr-1.mp3]', Back: '猫' });
    requests.length = 0;
    await add(custom, plain);
    assert.deepEqual((requests[1]?.params.note as { fields: unknown }).fields, { Front: '<b>猫</b>だ', Audio: '', Back: '猫' });
  } finally {
    globalThis.fetch = saved;
  }
});

test('cleanText removes bracketed text, and cleanSegments drops a line with nothing else', () => {
  assert.equal(cleanText('（笑）そうだね(laughs)\n[音楽]\n【拍手】本当［注］に〔小声〕'), 'そうだね\n本当に');
  assert.deepEqual(cleanSegments([{ start: 0, end: 1, text: '♪～（音楽）' }, { start: 1, end: 2, text: '［拍手］' }]),
    [{ start: 0, end: 1, text: '♪～' }]);
});

test('gapEnd is the next start inside a gap of 1.5 s or more, before its last 0.5 s', () => {
  assert.deepEqual([0.5, 2, 3.5, 4, 5.4, 6, 7.6, 9].map(time => gapEnd(LINES, time)), [null, null, null, null, 8, 8, null, null]);
  assert.equal(gapEnd([{ start: 3, end: 4, text: '一' }], 1), 3, 'the part before the first line is a gap too');
  assert.equal(gapEnd([{ start: 1, end: 2, text: '一' }, { start: 3, end: 4, text: '二' }], 2.2), null, 'a 1 s gap does not count');
});

test('autoPause finds the line edge that a frame step passed, as the play mode says', () => {
  assert.deepEqual([
    autoPause(LINES, 'after', 2.99, 3.01), autoPause(LINES, 'after', 3.01, 3.03), autoPause(LINES, 'before', 7.99, 8.01),
    autoPause(LINES, 'iPlusOne', 9.99, 10.01), autoPause(LINES, 'normal', 2.99, 3.01), autoPause(LINES, 'after', 2, 4.5),
    autoPause(LINES, 'after', 3.5, 2.5),
  ], [0, null, 2, 2, null, null, null]);
});

test('widenSentence puts the popup sentence back into the text of the joined lines', async () => {
  const { widenSentence } = await import('../src/anki/lineaudio.ts');
  assert.equal(widenSentence('猫が魚を食べた。\n今日は<雨>だ', '<b>猫</b>が魚を食べた。'), '<b>猫</b>が魚を食べた。 今日は&lt;雨&gt;だ');
  assert.equal(widenSentence('猫が魚を食べた。\n今日は<雨>だ', '今日は&lt;<b>雨</b>&gt;だ'), '猫が魚を食べた。 今日は&lt;<b>雨</b>&gt;だ');
  assert.equal(widenSentence('別の行', '<b>猫</b>だ'), '<b>猫</b>だ', 'a sentence that is not in the lines stays');
});

test('each sidebar filter shows its lines; Unique 1 unknown word shows the first i+1 line of each unknown word', () => {
  const line = (words: string, marked = false): LineState => ({
    marked,
    words: words.split(' ').filter(Boolean).map(word => {
      const [key = '', status] = word.split('=');
      if (!isStatus(status)) throw new Error(word);
      return { key, status };
    }),
  });
  const lines = [
    line('猫=known 魚=unknown'),
    line('魚=unknown 食べる=known'),
    line('今日=unknown 雨=unknown'),
    line('雨=learning 降る=known'),
    line('本=known 読む=ignored'),
    line(''),
    line('犬=unknown', true),
    line('犬=unknown 走る=known'),
  ];
  const shown = Object.fromEntries(FILTER_NAMES.map(name => [name, shownLines(lines, name).flatMap((on, index) => (on ? [index] : []))]));
  assert.deepEqual(shown, {
    all: [0, 1, 2, 3, 4, 5, 6, 7],
    unknown: [0, 1, 2, 6, 7],
    unknown2: [2],
    iPlusOne: [0, 1, 7],
    unique: [0, 7],
    learning: [3],
    known: [4],
    bookmarks: [6],
  });
  assert.deepEqual(choices(line('猫=known 今日=unknown 猫=known 雨=unknown 今日=unknown 降る=learning').words).map(word => word.key),
    ['今日', '雨', '猫', '降る'], 'the chooser lists the unknown words first, each word once');
  assert.deepEqual(['猫=known 魚=unknown', '今日=unknown 雨=unknown', '雨=learning'].map(words => targetWord(line(words).words)?.key ?? null),
    ['魚', null, null], '+ and Create N cards take the one unknown word of a line');
});

test('summary tells what Create N cards did', () => {
  assert.equal(summary(['added', 'skipped', 'added'], 3), 'Added 2 cards. 1 line needs a target word: use + on it.');
  assert.equal(summary(['skipped', 'skipped'], 2), 'Added 0 cards. 2 lines need a target word: use + on each.');
  assert.equal(summary(['added', 'failed'], 4), 'Stopped. Added 1 card. 1 card failed: the popup shows why.');
});

const UNPACKED_WINDOWS: Place = { windows: true, install: 'unpacked' };
const UNPACKED_LINUX: Place = { windows: false, install: 'unpacked' };
const STORE_WINDOWS: Place = { windows: true, install: 'store' };
const STORE_LINUX: Place = { windows: false, install: 'store' };

test('serverHint tells a Windows user to use the Start button of the popup or the launcher, and other users to run uv', () => {
  assert.deepEqual([UNPACKED_WINDOWS, UNPACKED_LINUX].map(serverHint), [
    'Start the WhisperX server: click the Minerr button in the toolbar, then click Start the server. You can also double-click "Start WhisperX server (Windows).cmd" in the Minerr folder. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.',
    'Start the WhisperX server: uv run server/whisper_server.py',
  ]);
});

test('serverHint sends a store install, which has no Minerr folder, to the folder of the WhisperX add-on', () => {
  assert.deepEqual([STORE_WINDOWS, STORE_LINUX].map(serverHint), [
    'Start the WhisperX server: click the Minerr button in the toolbar, then click Start the server. You can also double-click "Start WhisperX server (Windows).cmd" in the folder of the WhisperX add-on. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.',
    'Start the WhisperX server: in the folder of the WhisperX add-on, run "uv run server/whisper_server.py".',
  ]);
});

test('serverView: the Start button only on Windows, and Show the Minerr folder when Chrome has no host', () => {
  assert.deepEqual(serverView({ state: 'off' }, UNPACKED_WINDOWS), { className: 'error', text: 'The WhisperX server is not running.', buttons: ['start'] });
  assert.deepEqual(serverView({ state: 'off' }, UNPACKED_LINUX), { className: 'error', text: 'Start the WhisperX server: uv run server/whisper_server.py', buttons: [] });
  assert.deepEqual(serverView({ state: 'setup' }, UNPACKED_WINDOWS), {
    className: 'error',
    text: 'To set up the Start button, double-click "Start WhisperX server (Windows).cmd" in the Minerr folder one time. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.',
    buttons: ['folder'],
  });
  assert.deepEqual(serverView({ state: 'failed' }, UNPACKED_WINDOWS),
    { className: 'error', text: 'The WhisperX server did not answer in 90 seconds. Look at the WhisperX window.', buttons: ['start'] });
  assert.deepEqual(serverView({ state: 'running', health: { model: 'large-v3-turbo', device: 'cpu' } }, UNPACKED_WINDOWS),
    { className: 'ok', text: 'WhisperX server is running: large-v3-turbo on the CPU.', buttons: [] });
});

test('serverView: a store install gets the WhisperX add-on from GitHub, in place of the Minerr folder and before a first Start', () => {
  assert.deepEqual(serverView({ state: 'off' }, STORE_WINDOWS), { className: 'error', text: 'The WhisperX server is not running.', buttons: ['start', 'addOn'] });
  assert.deepEqual(serverView({ state: 'off' }, STORE_LINUX),
    { className: 'error', text: 'Start the WhisperX server: in the folder of the WhisperX add-on, run "uv run server/whisper_server.py".', buttons: ['addOn'] });
  assert.deepEqual(serverView({ state: 'setup' }, STORE_WINDOWS), {
    className: 'error',
    text: 'To set up the Start button, get the free WhisperX add-on from GitHub and unzip it. Then double-click "Start WhisperX server (Windows).cmd" in its folder one time. If you use WSL, double-click "Start WhisperX server (WSL).cmd" instead.',
    buttons: ['addOn'],
  });
  assert.deepEqual(serverView({ state: 'failed' }, STORE_WINDOWS),
    { className: 'error', text: 'The WhisperX server did not answer in 90 seconds. Look at the WhisperX window.', buttons: ['start'] });
});

test('serverStatus: a click on Start shows a start until the limit and a failed start after it, also in a popup that opens later', () => {
  const running = { state: 'running', health: { model: 'large-v3-turbo', device: 'cpu' } } as const;
  const off = { state: 'off' } as const;
  assert.deepEqual(serverStatus({ check: undefined, click: null }, 1000), { state: 'checking' });
  assert.deepEqual(serverStatus({ check: off, click: null }, 1000), { state: 'off' });
  assert.deepEqual(serverStatus({ check: running, click: null }, 1000), { state: 'running', health: { model: 'large-v3-turbo', device: 'cpu' } });
  assert.deepEqual(serverStatus({ check: off, click: 1000 }, 90_999), { state: 'starting' });
  assert.deepEqual(serverStatus({ check: off, click: 1000 }, 91_000), { state: 'failed' });
  assert.deepEqual(serverStatus({ check: running, click: 1000 }, 91_000), { state: 'running', health: { model: 'large-v3-turbo', device: 'cpu' } });
  assert.deepEqual(serverStatus({ check: undefined, click: 1000 }, 2000), { state: 'starting' }, 'a popup that opens within the limit');
  assert.deepEqual(serverStatus({ check: undefined, click: 1000 }, 120_000), { state: 'failed' }, 'a popup that opens after the limit, before its first check');
  assert.deepEqual(serverStatus({ check: off, click: 1000 }, 120_000), { state: 'failed' }, 'a popup that opens after the limit, after its first check');
  assert.deepEqual(serverStatus({ check: off, click: 'no host' }, 1000), { state: 'setup' });
  assert.deepEqual(serverStatus({ check: running, click: 'no host' }, 1000), { state: 'running', health: { model: 'large-v3-turbo', device: 'cpu' } });
});

test('serverStatus: a health check that ends in an error shows the error, also during a start', () => {
  const error = { state: 'error', error: 'The WhisperX server answered 404.' } as const;
  assert.deepEqual(serverStatus({ check: error, click: null }, 1000), { state: 'error', error: 'The WhisperX server answered 404.' });
  assert.deepEqual(serverStatus({ check: error, click: 1000 }, 2000), { state: 'error', error: 'The WhisperX server answered 404.' });
});

test('isNoHostError knows the two errors of Chrome for a missing host; a host that exits is not one', () => {
  assert.deepEqual(['Specified native messaging host not found.', 'Access to the specified native messaging host is forbidden.',
    'Native host has exited.', 'Error when communicating with the native messaging host.', ''].map(isNoHostError), [true, true, false, false, false]);
});
