import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardFields } from '../src/anki.ts';
import type { Entry } from '../src/meta.ts';

const TABERU: Entry = {
  expression: '食べる',
  reading: 'たべる',
  termTags: [{ name: '⭐', category: 'popular', notes: 'high priority term' }],
  senses: [
    { dict: 'JMdict', tags: [{ name: 'v1', category: 'partOfSpeech', notes: 'Ichidan verb' }], glossary: ['to eat'] },
    { dict: 'JMdict', tags: [], glossary: ['to live on'] },
    { dict: 'Jitendex', tags: [], glossary: ['to eat (Jitendex)'] },
  ],
  frequencies: [
    { dict: 'JPDB', value: 1200, display: '1200', ranked: true },
    { dict: 'Novels', value: 9, display: '3000㋕', ranked: true },
    { dict: 'Occurrences', value: 500, display: '500', ranked: false },
  ],
  pitches: [{ dict: 'NHK', positions: [2] }, { dict: 'Daijirin', positions: [2, 0] }],
};

const CARD: CardFields = {
  word: '食べる',
  reading: 'たべる',
  sentence: '猫が魚を<b>食べなかった</b>。',
  definition: '<ol><li>all definitions</li></ol>',
  entry: TABERU,
  selection: '',
};

test('furiganaPlain puts the reading over the kanji only, as Yomitan {furigana-plain}', async () => {
  const { furiganaPlain } = await import('../src/lapis.ts');
  assert.deepEqual([
    furiganaPlain('食べる', 'たべる'), furiganaPlain('お茶', 'おちゃ'), furiganaPlain('取り扱い', 'とりあつかい'),
    furiganaPlain('猫', 'ねこ'), furiganaPlain('ネコ', 'ねこ'), furiganaPlain('ねこ', 'ねこ'), furiganaPlain('今日', 'きょう'),
    furiganaPlain('行く', 'ゆこう'), furiganaPlain('猫', ''),
  ], ['食[た]べる', 'お 茶[ちゃ]', '取[と]り 扱[あつか]い', '猫[ねこ]', 'ネコ', 'ねこ', '今日[きょう]', '行く[ゆこう]', '猫']);
});

test('harmonicRank is the floor of the harmonic mean of the ranks, one per dictionary, as Yomitan {frequency-harmonic-rank}', async () => {
  const { harmonicRank } = await import('../src/lapis.ts');
  assert.equal(harmonicRank(TABERU.frequencies), 1714, 'the number at the start of a display value wins: 3000, not 9');
  assert.equal(harmonicRank([{ dict: 'A', value: 100, display: '100', ranked: true }, { dict: 'A', value: 5, display: '5', ranked: true }]), 100);
  assert.equal(harmonicRank([{ dict: 'Occurrences', value: 500, display: '500', ranked: false }]), null);
  assert.equal(harmonicRank([]), null);
});

test('pitchCategories names each pattern one time, with kifuku for a verb or an i-adjective', async () => {
  const { pitchCategories, pitchPositions } = await import('../src/lapis.ts');
  assert.equal(pitchPositions(TABERU.pitches), '<ol><li>[2]</li><li>[0]</li></ol>');
  assert.equal(pitchPositions([{ dict: 'NHK', positions: [3] }]), '[3]');
  assert.equal(pitchPositions([]), '');
  assert.equal(pitchCategories(TABERU), 'kifuku,heiban');
  const noun = (reading: string, positions: number[]): Entry => ({ ...TABERU, reading, termTags: [], senses: [{ dict: 'J', tags: [{ name: 'n', category: 'partOfSpeech', notes: '' }], glossary: [] }], pitches: [{ dict: 'NHK', positions }] });
  assert.deepEqual([noun('ねこ', [1]), noun('おとうと', [4]), noun('あなた', [2]), noun('さくら', [0, 0])].map(pitchCategories),
    ['atamadaka', 'odaka', 'nakadaka', 'heiban']);
  const study: Entry = { ...noun('べんきょう', [0]), senses: [{ dict: 'J', tags: ['n', 'vs'].map(name => ({ name, category: 'partOfSpeech', notes: '' })), glossary: [] }] };
  assert.equal(pitchCategories({ ...study, pitches: [{ dict: 'NHK', positions: [2] }] }), 'nakadaka', 'a noun that takes suru is a noun');
});

test('lapisFields fills every field of the Lapis note type in order', async () => {
  const { lapisFields } = await import('../src/anki.ts');
  const fields = lapisFields({ ...CARD, selection: '食べなかった' }, { url: 'https://example.com/?a=1&b=2', title: 'Cats & fish' },
    { image: '<img src="minerr-1.jpg">', audio: '[sound:minerr-1.mp3]' });
  assert.deepEqual(Object.entries(fields), Object.entries({
    Expression: '食べる',
    ExpressionFurigana: '食[た]べる',
    ExpressionReading: 'たべる',
    ExpressionAudio: '',
    SelectionText: '食べなかった',
    MainDefinition: '<div class="tags"><span class="tag tag-popular" title="high priority term">⭐</span></div><ol>'
      + '<li><span class="tag tag-partOfSpeech" title="Ichidan verb">v1</span> to eat</li><li>to live on<span class="dict">JMdict</span></li></ol>',
    DefinitionPicture: '',
    Sentence: '猫が魚を<b>食べなかった</b>。',
    SentenceFurigana: '',
    SentenceAudio: '[sound:minerr-1.mp3]',
    Picture: '<img src="minerr-1.jpg">',
    Glossary: '<ol><li>all definitions</li></ol>',
    Hint: '',
    IsWordAndSentenceCard: '',
    IsClickCard: '',
    IsSentenceCard: '',
    IsAudioCard: '',
    PitchPosition: '<ol><li>[2]</li><li>[0]</li></ol>',
    PitchCategories: 'kifuku,heiban',
    Frequency: '<ul style="text-align: left;"><li>JPDB: 1200</li><li>Novels: 3000㋕</li><li>Occurrences: 500</li></ul>',
    FreqSort: '1714',
    MiscInfo: 'Cats &amp; fish<br><a href="https://example.com/?a=1&amp;b=2">https://example.com/?a=1&amp;b=2</a>',
  }));
  const bare = lapisFields({ ...CARD, word: 'ネコ', reading: 'ネコ', definition: '', entry: null }, { url: '', title: '' }, { image: '', audio: '' });
  assert.deepEqual([bare.Expression, bare.ExpressionFurigana, bare.ExpressionReading, bare.MainDefinition, bare.PitchPosition, bare.Frequency, bare.FreqSort],
    ['ネコ', 'ネコ', 'ねこ', '', '', '', '9999999']);
});

test('parseNoteType: no stored choice is Lapis; a stored choice stays', async () => {
  const { parseNoteType, wordField } = await import('../src/anki.ts');
  assert.deepEqual([undefined, null, 'custom', { kind: 'lapis' }].map(parseNoteType), [{ kind: 'lapis' }, { kind: 'lapis' }, { kind: 'lapis' }, { kind: 'lapis' }]);
  assert.deepEqual(parseNoteType({ kind: 'builtin' }), { kind: 'builtin' });
  assert.equal(wordField({ kind: 'lapis' }), 'Expression');
});

test('installLapis keeps a "Lapis" deck that has notes of the user, and does nothing if Anki has Lapis', async () => {
  const { installLapis } = await import('../src/anki.ts');
  const requests: string[] = [];
  let models = ['Basic'];
  const replies: Record<string, () => unknown> = {
    modelNames: () => models, storeMediaFile: () => '_minerr_lapis.apkg', importPackage: () => { models = ['Basic', 'Lapis']; return true; },
    deleteMediaFile: () => null, deckNames: () => ['Lapis'], findNotes: () => [5, 6],
    notesInfo: () => [{ modelName: 'Lapis', fields: { Expression: { value: '十中八九' } } }, { modelName: 'Lapis', fields: { Expression: { value: '猫' } } }],
  };
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { action } = JSON.parse(String(init?.body));
    requests.push(action);
    return new Response(JSON.stringify({ result: replies[action]?.(), error: null }));
  };
  try {
    assert.equal(await installLapis(), 'Installed Lapis. The "Lapis" deck has other notes, so Minerr kept it.');
    assert.deepEqual(requests, ['modelNames', 'storeMediaFile', 'importPackage', 'deleteMediaFile', 'deckNames', 'findNotes', 'notesInfo']);
    requests.length = 0;
    assert.equal(await installLapis(), 'Lapis is already in Anki.');
    assert.deepEqual(requests, ['modelNames']);
  } finally {
    globalThis.fetch = saved;
  }
});
