import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import kuromoji from 'kuromoji';
import { definitionHtml } from '../src/anki.ts';
import { groupTokens } from '../src/group.ts';
import { iPlusOneSentences, isIPlusOne, type Piece, sentenceAround } from '../src/sentence.ts';
import type { Status } from '../src/status.ts';
import { type DictTerm, flattenGlossaryItem, groupTerms, readYomitan } from '../src/yomitan.ts';
import { unzip } from '../src/zip.ts';

const here = import.meta.dirname;
const JMDICT = join(here, 'fixtures', 'JMdict_english.zip');

const tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) =>
  kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') })
    .build((err, t) => (err ? reject(err) : resolve(t))));
const parse = (text: string) => groupTokens(tokenizer.tokenize(text));

function makeZip(members: string[]) {
  const out = join(mkdtempSync(join(tmpdir(), 'ml-zip-')), 'test.zip');
  execFileSync('python3', ['-I', join(here, 'make-zip.py'), out, ...members]);
  return readFileSync(out);
}

test('verb with auxiliaries is one word with the dictionary form', () => {
  assert.deepEqual(parse('食べなかった'), [{ text: '食べなかった', lemma: '食べる', reading: 'たべなかった' }]);
});

test('particles and copula carry no lemma; text concatenates to the input', () => {
  const input = '猫が好きです';
  const segments = parse(input);
  assert.deepEqual(segments, [
    { text: '猫', lemma: '猫', reading: 'ねこ' },
    { text: 'が' },
    { text: '好き', lemma: '好き', reading: 'すき' },
    { text: 'です' },
  ]);
  assert.equal(segments.map(s => s.text).join(''), input);
});

test('て/ば groups, whitespace and latin text stay plain, concatenation is exact', () => {
  const input = '猫が魚を食べている。\n  行けば寒くない abc 123';
  const segments = parse(input);
  assert.equal(segments.map(s => s.text).join(''), input);
  assert.deepEqual(segments.filter(s => s.lemma), [
    { text: '猫', lemma: '猫', reading: 'ねこ' },
    { text: '魚', lemma: '魚', reading: 'さかな' },
    { text: '食べている', lemma: '食べる', reading: 'たべている' },
    { text: '行けば', lemma: '行く', reading: 'いけば' },
    { text: '寒くない', lemma: '寒い', reading: 'さむくない' },
  ]);
});

test('sentenceAround keeps only the sentence that holds the word', () => {
  assert.deepEqual(
    sentenceAround('昨日は雨だった。「今日は晴れ」と彼は言った！猫が魚を', '食べなかった', '。それから寝た。'),
    { start: '猫が魚を', word: '食べなかった', end: '。' },
  );
  assert.deepEqual(
    sentenceAround('前の行\n　彼は「本当に', '美味しい', '！」と言った。次の文'),
    { start: '彼は「本当に', word: '美味しい', end: '！」' },
  );
  assert.deepEqual(sentenceAround('', '猫', ''), { start: '', word: '猫', end: '' });
});

test('isIPlusOne is true only for exactly one unknown word in two words or more', () => {
  const cases: Status[][] = [
    [], ['known'], ['unknown'], ['known', 'unknown'], ['known', 'unknown', 'learning', 'ignored'], ['unknown', 'unknown'], ['learning', 'ignored'],
  ];
  assert.deepEqual(cases.map(statuses => isIPlusOne(statuses)), [false, false, false, true, true, false, false]);
});

test('iPlusOneSentences finds the sentences with one unknown word, across pieces, without edge white space', () => {
  const pieces: Piece[] = [
    { text: '  ', status: null }, { text: '猫', status: 'known' }, { text: 'が', status: null }, { text: '魚', status: 'unknown' },
    { text: 'を', status: null }, { text: '食べた', status: 'known' }, { text: '。「', status: null }, { text: '雨', status: 'unknown' },
    { text: 'だ！」\n', status: null }, { text: '今日', status: 'unknown' }, { text: 'は', status: null }, { text: '雨', status: 'unknown' },
    { text: '。', status: null }, { text: '本', status: 'learning' }, { text: 'を', status: null }, { text: '読む', status: 'unknown' },
  ];
  const found = iPlusOneSentences(pieces);
  const textOf = ({ start, end }: (typeof found)[number]) => pieces.slice(start.piece, end.piece + 1)
    .map((p, i, run) => p.text.slice(i === 0 ? start.offset : 0, i === run.length - 1 ? end.offset : undefined)).join('');
  assert.deepEqual(found.map(textOf), ['猫が魚を食べた。', '本を読む']);
  assert.deepEqual(found, [
    { start: { piece: 1, offset: 0 }, end: { piece: 6, offset: 1 } },
    { start: { piece: 13, offset: 0 }, end: { piece: 15, offset: 2 } },
  ]);
  assert.deepEqual(iPlusOneSentences([{ text: '猫が好き', status: 'known' }]), []);
  assert.deepEqual(iPlusOneSentences([]), []);
});

test('definitionHtml is a term tag row and one escaped <ol> with tag chips and a label after each dictionary run', () => {
  const noun = { name: 'n', category: 'partOfSpeech', notes: 'noun "common"' };
  assert.equal(definitionHtml({
    expression: '猫',
    reading: 'ねこ',
    termTags: [{ name: '⭐', category: 'popular', notes: 'high priority term' }, { name: 'ichi', category: '', notes: '' }],
    senses: [
      { dict: 'JMdict', tags: [noun, { name: 'uk', category: '', notes: 'kana' }], glossary: ['cat'] },
      { dict: 'JMdict', tags: [], glossary: ['to live on\nto subsist on', 'a <b> & "c"'] },
      { dict: 'Other', tags: [{ name: '<x>', category: 'made-up', notes: '' }], glossary: ['feline'] },
    ],
  }), '<div class="tags"><span class="tag tag-popular" title="high priority term">⭐</span> <span class="tag" title="">ichi</span></div>'
    + '<ol><li><span class="tag tag-partOfSpeech" title="noun &quot;common&quot;">n</span> <span class="tag" title="kana">uk</span> cat</li>'
    + '<li>to live on<br>to subsist on<br>a &lt;b&gt; &amp; &quot;c&quot;<span class="dict">JMdict</span></li>'
    + '<li><span class="tag" title="">&lt;x&gt;</span> feline<span class="dict">Other</span></li></ol>');
  assert.equal(definitionHtml({ expression: '猫', reading: 'ねこ', termTags: [], senses: [{ dict: 'Old', tags: [], glossary: ['cat'] }] }),
    '<ol><li>cat<span class="dict">Old</span></li></ol>');
  assert.equal(definitionHtml(undefined), '');
});

test('structured-content glossary flattens to plain text lines', () => {
  const item = {
    type: 'structured-content',
    content: [
      { tag: 'ul', content: [
        { tag: 'li', content: 'to eat' },
        { tag: 'li', content: ['to live on ', { tag: 'span', content: '(e.g. a salary)' }] },
      ] },
      { tag: 'div', data: { content: 'notes' }, content: ['note', { tag: 'br' }, 'second line'] },
      { tag: 'ruby', content: ['漢字', { tag: 'rt', content: 'かんじ' }] },
    ],
  };
  assert.equal(flattenGlossaryItem(item), 'to eat\nto live on (e.g. a salary)\nnote\nsecond line\n漢字');
  assert.equal(flattenGlossaryItem({ type: 'text', text: ' cat ' }), 'cat');
  assert.equal(flattenGlossaryItem('dog'), 'dog');
  assert.equal(flattenGlossaryItem({ type: 'image', path: 'a.png' }), '');
  const formsTable = { type: 'structured-content', content: { tag: 'table', content: [
    { tag: 'tr', content: [{ tag: 'th', content: '' }, { tag: 'th', content: '行く' }, { tag: 'th', content: '往く' }] },
    { tag: 'tr', content: [{ tag: 'th', content: 'いく' }, { tag: 'td', content: '★' }, { tag: 'td', content: '🅁' }] },
  ] } };
  assert.equal(flattenGlossaryItem(formsTable), '行く 往く\nいく ★ 🅁');
});

const NEKO_TAGS = [
  { dict: 'JMdict', name: '⭐', category: 'popular', notes: 'high priority term' },
  { dict: 'JMdict', name: 'n', category: 'partOfSpeech', notes: 'noun' },
  { dict: 'JMdict', name: 'arch', category: 'archaism', notes: 'archaic' },
  { dict: 'JMdict', name: 'forms', category: '', notes: 'other surface forms and readings' },
  { dict: 'JMdict', name: '1', category: '', notes: 'JMdict Sense #1' },
  { dict: 'Other', name: 'n', category: 'other-pos', notes: 'noun (Other)' },
];

test('groupTerms groups senses by reading, hides sense numbers, and keeps unknown tags', () => {
  const groups = groupTerms([
    { dict: 'JMdict', expression: '猫', reading: 'ねこ', definitionTags: ['1', 'n'], termTags: ['⭐', 'ichi'], glossary: ['cat'], score: 9 },
    { dict: 'Other', expression: '猫', reading: 'ねこ', definitionTags: ['n'], termTags: ['ichi', 'news4k'], glossary: ['cat (Other)'], score: 8 },
    { dict: 'JMdict', expression: '猫', reading: 'ねこ', definitionTags: ['forms'], termTags: ['⭐'], glossary: ['猫（★）', 'ネコ'], score: 7 },
    { dict: 'JMdict', expression: '猫', reading: 'ねこま', definitionTags: ['n', 'arch'], termTags: [], glossary: ['cat (archaic)'], score: -200 },
    { dict: 'Old', expression: '猫', reading: 'ねこ', glossary: ['cat (imported before tags)'], score: -300 },
  ], NEKO_TAGS);
  assert.deepEqual(groups, [
    {
      expression: '猫',
      reading: 'ねこ',
      termTags: [
        { name: '⭐', category: 'popular', notes: 'high priority term' },
        { name: 'ichi', category: '', notes: '' },
        { name: 'news4k', category: '', notes: '' },
      ],
      senses: [
        { dict: 'JMdict', tags: [{ name: 'n', category: 'partOfSpeech', notes: 'noun' }], glossary: ['cat'] },
        { dict: 'JMdict', tags: [{ name: 'forms', category: '', notes: 'other surface forms and readings' }], glossary: ['猫（★）、ネコ'] },
        { dict: 'Other', tags: [{ name: 'n', category: 'other-pos', notes: 'noun (Other)' }], glossary: ['cat (Other)'] },
        { dict: 'Old', tags: [], glossary: ['cat (imported before tags)'] },
      ],
    },
    {
      expression: '猫',
      reading: 'ねこま',
      termTags: [],
      senses: [{
        dict: 'JMdict',
        tags: [{ name: 'n', category: 'partOfSpeech', notes: 'noun' }, { name: 'arch', category: 'archaism', notes: 'archaic' }],
        glossary: ['cat (archaic)'],
      }],
    },
  ]);
});

test('unzip reads stored and deflated members exactly', async () => {
  const long = 'ねこ cat '.repeat(500);
  const members = unzip(makeZip(['a.txt=stored:hello stored', `dir/b.txt=deflated:${long}`]));
  assert.deepEqual([...members.keys()], ['a.txt', 'dir/b.txt']);
  const text = async (name: string) => {
    const read = members.get(name);
    assert.ok(read, `no member ${name}`);
    return new TextDecoder().decode(await read());
  };
  assert.equal(await text('a.txt'), 'hello stored');
  assert.equal(await text('dir/b.txt'), long);
});

test('readYomitan returns index metadata, tags, and flattened terms per bank', async () => {
  const rows = [
    ['猫', 'ねこ', '1 n', '', 10, ['cat', { type: 'text', text: 'feline' }], 1, '⭐ ichi'],
    ['ねこ', '', '', '', 5, [{ type: 'structured-content', content: { tag: 'li', content: 'cat (kana)' } }], 2, ''],
    ['ネコ', '', '', '', 1, ['⟶猫'], -1, ''],
    ['犬', 'いぬ', '', '', 1, ['dog'], 0, ''],
  ];
  const zip = makeZip([
    `index.json=stored:${JSON.stringify({ title: 'Tiny', revision: 'r1', format: 3 })}`,
    `term_bank_1.json=deflated:${JSON.stringify(rows)}`,
    `tag_bank_1.json=deflated:${JSON.stringify([['⭐', 'popular', -10, 'high priority term', 10]])}`,
    `tag_bank_2.json=deflated:${JSON.stringify([['n', 'partOfSpeech', -3, 'noun', 0]])}`,
  ]);
  const dict = await readYomitan(zip);
  assert.equal(dict.title, 'Tiny');
  assert.equal(dict.revision, 'r1');
  assert.deepEqual(dict.tags, [
    { name: '⭐', category: 'popular', notes: 'high priority term' },
    { name: 'n', category: 'partOfSpeech', notes: 'noun' },
  ]);
  const [bank, ...more] = dict.banks;
  assert.ok(bank);
  assert.equal(more.length, 0);
  assert.deepEqual(await bank(), [
    { expression: '猫', reading: 'ねこ', definitionTags: ['1', 'n'], termTags: ['⭐', 'ichi'], glossary: ['cat', 'feline'], score: 10, sequence: 1 },
    { expression: 'ねこ', reading: 'ねこ', definitionTags: [], termTags: [], glossary: ['cat (kana)'], score: 5, sequence: 2 },
    { expression: 'ネコ', reading: 'ネコ', definitionTags: [], termTags: [], glossary: ['⟶猫'], score: 1, sequence: 1 },
    { expression: '犬', reading: 'いぬ', definitionTags: [], termTags: [], glossary: ['dog'], score: 1 },
  ]);
  const untagged = makeZip([`index.json=stored:${JSON.stringify({ title: 'Bare', revision: 'r1', format: 3 })}`]);
  assert.deepEqual((await readYomitan(untagged)).tags, []);
});

test('real JMdict Yomitan zip parses with 食べる -> "to eat"', async () => {
  assert.ok(existsSync(JMDICT), `missing ${JMDICT}; download it as the README says`);
  const dict = await readYomitan(readFileSync(JMDICT));
  let count = 0;
  const rows: DictTerm[] = [];
  for (const load of dict.banks) {
    const terms = await load();
    count += terms.length;
    rows.push(...terms.filter(t => t.expression === '食べる').map(t => ({ ...t, dict: dict.title })));
  }
  const [taberu] = groupTerms(rows.sort((a, b) => b.score - a.score), dict.tags.map(tag => ({ ...tag, dict: dict.title })));
  assert.ok(taberu, 'a group for 食べる');
  const [first] = taberu.senses;
  assert.ok(first, 'a sense for 食べる');
  console.log(`JMdict "${dict.title}": ${dict.banks.length} banks, ${count} terms, ${dict.tags.length} tags,`
    + ` 食べる -> ${JSON.stringify(taberu.termTags.map(t => t.name))} ${JSON.stringify(first)}`);
  assert.ok(count > 100000, `term count ${count}`);
  assert.equal(taberu.reading, 'たべる');
  assert.deepEqual(taberu.termTags.find(t => t.name === '⭐'), { name: '⭐', category: 'popular', notes: 'high priority term' });
  assert.deepEqual(first.tags.map(t => [t.name, t.category]), [['v1', 'partOfSpeech'], ['vt', 'partOfSpeech']]);
  assert.ok(first.glossary.some(g => /\beat\b/.test(g)), JSON.stringify(first.glossary));
});

test('captionText joins the caption lines with line breaks and drops empty lines', async () => {
  const { captionText } = await import('../src/captions.ts');
  assert.equal(captionText([' 猫が好きです ', '', '魚も好き']), '猫が好きです\n魚も好き');
  assert.equal(captionText([]), '');
});

test('segmentAt finds the segment that covers a time, with the end exclusive', async () => {
  const { segmentAt } = await import('../src/captions.ts');
  const segments = [{ start: 0, end: 2, text: 'あ' }, { start: 2, end: 4, text: 'い' }, { start: 6, end: 8, text: 'う' }];
  assert.deepEqual([0, 1.99, 2, 5, 7, 8].map(t => segmentAt(segments, t)?.text ?? null), ['あ', 'あ', 'い', null, 'う', null]);
});

test('resolveTheme follows the system only for the system theme', async () => {
  const { resolveTheme, THEMES } = await import('../src/theme.ts');
  assert.deepEqual(THEMES.flatMap(theme => [false, true].map(systemDark => `${theme}+${systemDark ? 'dark' : 'light'}=${resolveTheme(theme, systemDark)}`)), [
    'system+light=light', 'system+dark=dark', 'light+light=light', 'light+dark=light', 'dark+light=dark', 'dark+dark=dark',
  ]);
});

test('hoverDelay opens on Shift at once, waits for the mouse to stop on plain hover, and never opens during a selection or a drag', async () => {
  const { hoverDelay, HOVER_MODES } = await import('../src/hover.ts');
  const base = { shift: false, unknownWord: false, popupOpen: false, textSelected: false, buttonDown: false };
  const row = (extra: Partial<typeof base>) => HOVER_MODES.map(mode => hoverDelay({ ...base, ...extra, mode }));
  assert.deepEqual(HOVER_MODES, ['hover', 'unknown', 'shift']);
  assert.deepEqual(row({}), [300, null, null]);
  assert.deepEqual(row({ unknownWord: true }), [300, 300, null]);
  assert.deepEqual(row({ unknownWord: true, popupOpen: true }), [50, 50, null]);
  assert.deepEqual(row({ popupOpen: true }), [50, null, null]);
  assert.deepEqual(row({ shift: true }), [0, 0, 0]);
  assert.deepEqual(row({ shift: true, popupOpen: true }), [0, 0, 0]);
  assert.deepEqual(row({ shift: true, unknownWord: true, textSelected: true }), [null, null, null]);
  assert.deepEqual(row({ shift: true, unknownWord: true, buttonDown: true }), [null, null, null]);
  assert.deepEqual(row({ unknownWord: true, textSelected: true }), [null, null, null]);
  assert.deepEqual(row({ unknownWord: true, buttonDown: true }), [null, null, null]);
});

test('renderField fills each marker in one pass and escapes the plain text values one time', async () => {
  const { markerValues, renderField } = await import('../src/anki.ts');
  const card = { word: '食べる', reading: 'たべる', sentence: '猫が魚を<b>食べなかった</b>。', definition: '<ol><li>to eat</li></ol>', entry: null, selection: '' };
  const media = { image: '<img src="minerr-1.jpg">', audio: '', wordaudio: '' };
  const values = markerValues(card, { url: 'https://example.com/?a=1&b=2', title: 'Tom & Jerry <3 {word}' }, media);
  assert.equal(renderField('<div>{word}</div> {furigana} [{reading}]', values), '<div>食べる</div> 食べる[たべる] [たべる]');
  assert.equal(renderField('{sentence}{definition}{image}', values), '猫が魚を<b>食べなかった</b>。<ol><li>to eat</li></ol><img src="minerr-1.jpg">');
  assert.equal(renderField('<a href="{url}">{title}</a>', values), '<a href="https://example.com/?a=1&amp;b=2">Tom &amp; Jerry &lt;3 {word}</a>');
  assert.equal(renderField('&amp; {Word} {nope} {}', values), '&amp; {Word} {nope} {}');
  assert.equal(renderField('', values), '');
  assert.equal(markerValues({ ...card, word: 'ねこ', reading: 'ねこ' }, { url: '', title: '' }, media).furigana, 'ねこ');
  assert.equal(markerValues({ ...card, reading: '' }, { url: '', title: '' }, media).furigana, '食べる');
});

test('unknownMarkers lists each marker that is not known, one time, as written', async () => {
  const { unknownMarkers } = await import('../src/anki.ts');
  assert.deepEqual(unknownMarkers('{word} {Word} {nope} {nope} {} {image}'), ['{Word}', '{nope}', '{}']);
  assert.deepEqual(unknownMarkers('{word}{reading}{furigana}{sentence}{definition}{image}{url}{title} plain text'), []);
});

test('suggestFields maps known field names to one marker and leaves the others empty', async () => {
  const { suggestFields } = await import('../src/anki.ts');
  assert.deepEqual(suggestFields(['Expression', 'ExpressionFurigana', 'ExpressionReading', 'Sentence', 'SentenceFurigana',
    'MainDefinition', 'Picture', 'Word Meaning', 'Glossary', 'Front', 'Back', 'Notes', 'Source URL', 'Title']), {
    Expression: '{word}', ExpressionFurigana: '{furigana}', ExpressionReading: '{reading}', Sentence: '{sentence}', SentenceFurigana: '',
    MainDefinition: '{definition}', Picture: '{image}', 'Word Meaning': '{definition}', Glossary: '{definition}', Front: '{word}',
    Back: '{definition}', Notes: '', 'Source URL': '', Title: '{title}',
  });
});

test('parseNoteType reads a stored note type and falls back to Lapis', async () => {
  const { parseNoteType, wordField } = await import('../src/anki.ts');
  const custom = { kind: 'custom', model: 'Mining', fields: { Front: '{sentence}', Back: '{word} {definition}' } };
  assert.deepEqual(parseNoteType(custom), custom);
  for (const bad of [undefined, null, 'custom', { kind: 'custom', model: 'Mining' }, { ...custom, fields: { Front: 1 } }, { ...custom, fields: [] }]) {
    assert.deepEqual(parseNoteType(bad), { kind: 'lapis' });
  }
  assert.equal(wordField(parseNoteType(custom)), 'Back');
  assert.equal(wordField({ kind: 'custom', model: 'Mining', fields: { Front: '{sentence}' } }), 'Word');
  assert.equal(wordField({ kind: 'builtin' }), 'Word');
});

test('statusFile and parseStatusFile round-trip the words, and a wrong file throws a clear error', async () => {
  const { parseStatusFile, statusFile } = await import('../src/status.ts');
  const words = { 猫: 'known', 魚: 'learning', 田中: 'ignored' } as const;
  const file = statusFile(words, new Date('2026-10-20T03:04:05.000Z'));
  assert.deepEqual(file, { format: 'minerr-statuses', version: 1, exported: '2026-10-20T03:04:05.000Z', words });
  assert.deepEqual(parseStatusFile(JSON.stringify(file)), words);
  assert.deepEqual(parseStatusFile(JSON.stringify({ ...file, words: {} })), {});
  const errorOf = (text: string) => {
    try {
      parseStatusFile(text);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return 'no error';
  };
  const withWords = (value: unknown) => JSON.stringify({ ...file, words: value });
  assert.deepEqual([
    errorOf('{"format": "minerr-statuses",'),
    errorOf('null'),
    errorOf(JSON.stringify({ ...file, format: 'yomitan' })),
    errorOf(JSON.stringify({ ...file, version: 2 })),
    errorOf(JSON.stringify({ ...file, exported: undefined })),
    errorOf(withWords(['猫'])),
    errorOf(withWords({ 猫: 'known', 魚: 'unknown' })),
    errorOf(withWords({ 猫: 'mastered' })),
    errorOf(withWords({ '': 'known' })),
  ], [
    'The file is not JSON.',
    'The file is not a Minerr status file. Its format must be "minerr-statuses".',
    'The file is not a Minerr status file. Its format must be "minerr-statuses".',
    'The file has version 2. Minerr reads version 1.',
    'The file has no export date.',
    'The file has no words object.',
    'The word "魚" has the status "unknown". Use learning, known, or ignored.',
    'The word "猫" has the status "mastered". Use learning, known, or ignored.',
    'The file has a word with no text.',
  ]);
});

test('mergeStatuses lets the imported status win and counts added, changed, and unchanged words', async () => {
  const { mergeStatuses, parseStatusFile } = await import('../src/status.ts');
  const imported = parseStatusFile(JSON.stringify({ format: 'minerr-statuses', version: 1, exported: '2026-10-20T00:00:00.000Z',
    words: { 猫: 'known', 魚: 'ignored', 雨: 'learning', constructor: 'known' } }));
  assert.deepEqual(mergeStatuses({ 猫: 'known', 魚: 'learning', 本: 'known' }, imported), {
    changes: { 魚: 'ignored', 雨: 'learning', constructor: 'known' },
    counts: { added: 2, changed: 1, unchanged: 1 },
  });
  assert.deepEqual(mergeStatuses({ 猫: 'known' }, {}), { changes: {}, counts: { added: 0, changed: 0, unchanged: 0 } });
});

test('statusesByKey gives each key the highest status of its words: known, then ignored, then learning', async () => {
  const { statusesByKey, statusMoves } = await import('../src/status.ts');
  assert.deepEqual(statusesByKey([['ねこ', 'learning'], ['猫', 'known'], ['ネコ', 'ignored'], ['いぬ', 'learning'], ['犬', 'ignored']], ['猫', '猫', '猫', '犬', '犬']),
    new Map([['猫', 'known'], ['犬', 'ignored']]));
  assert.deepEqual(statusMoves({ ねこ: 'known', ネコ: 'learning', 猫: 'learning', 犬: 'ignored', いぬ: 'learning', 紙: 'known' }, ['猫', '猫', '猫', '犬', '犬', '紙']),
    { set: { 猫: 'known' }, remove: ['ねこ', 'ネコ', 'いぬ'] });
  assert.deepEqual(statusMoves({ 猫: 'known' }, ['猫']), { set: {}, remove: [] });
});

test('parseSubtitles reads SRT with a BOM, CRLF, multi-line cues, tags, and position codes', async () => {
  const { parseSubtitles } = await import('../src/captions.ts');
  const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>猫が</i>魚を\r\n食べた\r\n\r\n'
    + '2\r\n00:01:02,000 --> 01:00:00,250\r\n{\\an8}今日は雨\r\n\r\n3\r\n00:00:05,000 --> 00:00:04,000\r\n逆の時間\r\n\r\n'
    + '4\r\n00:00:06,000 --> 00:00:07,000\r\n\r\n';
  assert.deepEqual(parseSubtitles(srt), [
    { start: 1.5, end: 3, text: '猫が魚を\n食べた' },
    { start: 62, end: 3600.25, text: '今日は雨' },
  ]);
});

test('parseSubtitles reads WebVTT with a header, notes, styles, cue ids, cue settings, short times, ruby, and entities', async () => {
  const { parseSubtitles } = await import('../src/captions.ts');
  const vtt = 'WEBVTT - 日本語\nKind: captions\n\nNOTE a comment\nwith two lines\n\nSTYLE\n::cue { color: yellow }\n\n'
    + 'intro\n00:02.000 --> 00:04.500 align:start position:10%\n<v 先生><ruby>漢字<rt>かんじ</rt></ruby>を&lt;読む&gt;\n<c.yellow>二行目</c> &amp; 三&nbsp;四\n\n'
    + '00:00:00.250 --> 00:00:01.000\n最初\n';
  assert.deepEqual(parseSubtitles(vtt), [
    { start: 0.25, end: 1, text: '最初' },
    { start: 2, end: 4.5, text: '漢字を<読む>\n二行目 & 三 四' },
  ]);
});

test('toSrt numbers the cues and writes SRT times that parseSubtitles reads back', async () => {
  const { parseSubtitles, toSrt } = await import('../src/captions.ts');
  const segments = [{ start: 0, end: 2.5, text: '猫が魚を食べた。' }, { start: 3661.0005, end: 3662.9996, text: '一行目\n二行目' }];
  const srt = toSrt(segments);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,500\n猫が魚を食べた。\n\n2\n01:01:01,001 --> 01:01:03,000\n一行目\n二行目\n');
  assert.deepEqual(parseSubtitles(srt), [{ start: 0, end: 2.5, text: '猫が魚を食べた。' }, { start: 3661.001, end: 3663, text: '一行目\n二行目' }]);
});
