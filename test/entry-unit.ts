import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import kuromoji from 'kuromoji';
import { dictionaryWords, type EntryIndex, type EntryRow, entrySegments } from '../src/text/entry.ts';
import { groupTokens } from '../src/text/group.ts';
import { readYomitan } from '../src/dictionary/yomitan.ts';

const here = import.meta.dirname;
const JMDICT = join(here, 'fixtures', 'JMdict_english.zip');

const tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) =>
  kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') })
    .build((err, t) => (err ? reject(err) : resolve(t))));

function memoryIndex(rows: EntryRow[]): EntryIndex {
  const group = (key: (row: EntryRow) => string) => {
    const map = new Map<string, EntryRow[]>();
    for (const row of rows) {
      const list = map.get(key(row));
      if (list) list.push(row);
      else map.set(key(row), [row]);
    }
    return (text: string) => Promise.resolve(map.get(text) ?? []);
  };
  const bySequence = group(row => `${row.dict}\n${row.sequence}`);
  const byExpression = group(row => row.expression);
  return {
    byExpression,
    byReading: group(row => row.reading),
    bySequence: (dict, sequence) => bySequence(`${dict}\n${sequence}`),
    headwords: async texts => new Set((await Promise.all(texts.map(async text => ((await byExpression(text)).length ? [text] : [])))).flat()),
  };
}

// [expression, reading, score, sequence], in the order and with the values of JMdict_english 2026-10-19.
const JMDICT_ROWS: [string, string, number, number][] = [
  ['開く', 'ひらく', 999800, 1202440], ['ヒラく', 'ヒラく', -10200, 1202440],
  ['紙', 'かみ', 1999800, 1311530],
  ['上手', 'じょうず', 1999800, 1353320], ['上手', 'じょうて', -5010200, 1353320],
  ['食べる', 'たべる', 1999800, 1358280],
  ['食肉', 'しょくにく', 1999800, 1358580],
  ['神', 'かみ', 1999800, 1364440],
  ['生物', 'せいぶつ', 1999800, 1379430],
  ['生物', 'なまもの', -200, 1379440], ['生もの', 'なまもの', -10200, 1379440],
  ['猫', 'ねこ', 1999800, 1467640], ['ネコ', 'ネコ', -10200, 1467640],
  ['髪', 'かみ', 1999800, 1477950],
  ['上手', 'うわて', -200, 1580400], ['上手', 'かみて', -10200, 1580400],
  ['空く', 'すく', 999800, 1586265],
  ['開く', 'あく', 999800, 1586270], ['空く', 'あく', 989800, 1586270],
  ['目', 'め', 999800, 1604890],
  ['ネコ科', 'ネコか', -200, 1651200], ['猫科', 'ねこか', -10200, 1651200],
  ['食肉目', 'しょくにくもく', -200, 1883210],
  ['ネコ属', 'ネコぞく', -200, 1900510], ['猫族', 'ねこぞく', -10200, 1900510],
  ['目', 'もく', -200, 2021500],
  ['猫', 'ねこま', -200, 2698030],
  ['恥ずい', 'はずい', -200, 2092890],
  ['出す', 'だす', 1999800, 1338180], ['接する', 'せっする', 1999800, 1385350], ['面する', 'めんする', 1999800, 1533400],
];
const rows = JMDICT_ROWS.map(([expression, reading, score, sequence]) => ({ dict: 'JMdict', expression, reading, score, sequence }));
const words = dictionaryWords(memoryIndex(rows));
const parse = (text: string, dict = words, joins: string[] = []) => entrySegments(tokenizer.tokenize(text), dict, joins);
const keys = async (text: string, dict = words, joins: string[] = []) => (await parse(text, dict, joins))
  .flatMap(({ text: surface, lemma, entry }) => (lemma ? [`${surface}=${lemma}=${entry?.key ?? lemma}`] : []));

const CAT = { key: '猫', headword: '猫', reading: 'ねこ' };

test('a one-kana piece with no dictionary entry is plain text, not a word: broken captions such as 西ニっポり', async () => {
  const words = (await parse('西ニっポりに猫')).filter(segment => segment.lemma).map(segment => segment.text);
  assert.deepEqual(words, ['西', '猫'], 'ニ, っ, ポ and り have no entry, so they get no underline; a kanji keeps its mark');
  assert.deepEqual((await parse('西ニっポりに猫')).map(segment => segment.text).join(''), '西ニっポりに猫', 'the text stays the same');
});

test('a verb that kuromoji reads as the old 五段 form 接す gets the entry of 接する; a real す verb keeps its own', async () => {
  assert.deepEqual(await keys('国境線で接しており'), ['国境=国境=国境', '線=線=線', '接しており=接する=接する']);
  assert.deepEqual(await keys('海に面して'), ['海=海=海', '面して=面する=面する']);
  assert.deepEqual(await keys('本を出して'), ['本=本=本', '出して=出す=出す']);
});

test('猫, ねこ and ネコ are one JMdict entry, so they share the key 猫', async () => {
  assert.deepEqual(await words.entry('猫', 'ねこ'), CAT);
  assert.deepEqual(await words.entry('ねこ', 'ねこ'), CAT);
  assert.deepEqual(await words.entry('ネコ', 'ねこ'), CAT);
  assert.deepEqual(await parse('猫とねことネコ'), [
    { text: '猫', lemma: '猫', reading: 'ねこ', entry: CAT },
    { text: 'と' },
    { text: 'ねこ', lemma: 'ねこ', entry: CAT },
    { text: 'と' },
    { text: 'ネコ', lemma: 'ネコ', entry: CAT },
  ]);
});

test('猫 read ねこま is a different entry, with the reading in its key', async () => {
  assert.deepEqual(await words.entry('猫', 'ねこま'), { key: '猫【ねこま】', headword: '猫', reading: 'ねこま' });
});

test('kana with more than one entry keeps its own key: かみ is 紙, 神, or 髪', async () => {
  assert.equal(await words.entry('かみ', 'かみ'), null);
  assert.equal(await words.entry('かみ', null), null);
  assert.deepEqual(await words.entry('紙', 'かみ'), { key: '紙', headword: '紙', reading: 'かみ' });
});

test('a kanji spelling with two readings of two entries gets two keys', async () => {
  assert.deepEqual(await words.entry('上手', 'じょうず'), { key: '上手', headword: '上手', reading: 'じょうず' });
  assert.deepEqual(await words.entry('上手', 'うわて'), { key: '上手【うわて】', headword: '上手', reading: 'うわて' });
  assert.deepEqual(await words.entry('上手', 'かみて'), { key: '上手【うわて】', headword: '上手', reading: 'かみて' });
  assert.equal(await words.entry('上手', null), null);
  assert.deepEqual(await words.entry('生物', 'せいぶつ'), { key: '生物', headword: '生物', reading: 'せいぶつ' });
  assert.deepEqual(await words.entry('生物', 'なまもの'), { key: '生物【なまもの】', headword: '生物', reading: 'なまもの' });
  assert.deepEqual(await words.entry('生もの', 'なまもの'), { key: '生物【なまもの】', headword: '生物', reading: 'なまもの' });
});

test('an inflected verb is matched by the reading of its dictionary form', async () => {
  assert.deepEqual(await keys('本を開いた'), ['本=本=本', '開いた=開く=開く']);
  assert.deepEqual((await parse('本を開いた'))[2]?.entry, { key: '開く', headword: '開く', reading: 'ひらく' });
  assert.deepEqual(await words.entry('開く', 'あく'), { key: '開く【あく】', headword: '開く', reading: 'あく' });
});

test('runs of nouns join by the longest dictionary headword', async () => {
  assert.deepEqual(await keys('食肉目ネコ科ネコ属'), ['食肉目=食肉目=食肉目', 'ネコ科=ネコ科=ネコ科', 'ネコ属=ネコ属=ネコ属']);
  assert.deepEqual((await parse('食肉目ネコ科ネコ属')).map(({ reading }) => reading), ['しょくにくもく', 'ねこか', 'ねこぞく']);
  assert.deepEqual(await words.entry('猫科', 'ねこか'), { key: 'ネコ科', headword: 'ネコ科', reading: 'ネコか' });
  const noCompound = dictionaryWords(memoryIndex(rows.filter(row => row.expression !== '食肉目')));
  assert.deepEqual(await keys('食肉目', noCompound), ['食肉=食肉=食肉', '目=目=目']);
});

test('a word override joins the tokens of its text: は|ずい is はずい, the entry 恥ずい; it never cuts a token', async () => {
  const split = ['ちょっと=ちょっと=ちょっと', 'ずい=ずい=ずい'];
  assert.deepEqual(await keys('ちょっとはずいね。'), split);
  assert.deepEqual(await keys('ちょっとはずいね。', words, ['はずい']), ['ちょっと=ちょっと=ちょっと', 'はずい=はずい=恥ずい']);
  assert.deepEqual((await parse('ちょっとはずいね。', words, ['はずい'])).map(({ text }) => text), ['ちょっと', 'はずい', 'ね', '。']);
  assert.deepEqual(await keys('ちょっとはずいね。', words, ['とはず', 'ずいね。x']), split);
  assert.deepEqual((await parse('ここでは猫だ', words, ['はずい'])).map(({ text }) => text), ['ここ', 'で', 'は', '猫', 'だ']);
});

test('a sequence with more rows than one word has is not an entry', async () => {
  const shared = Array.from({ length: 250 }, (_, i) => ({ dict: 'Bad', expression: `語${i}`, reading: 'ご', score: 0, sequence: 1 }));
  const bad = dictionaryWords(memoryIndex([...shared, { dict: 'Bad', expression: '猫', reading: 'ねこ', score: 0, sequence: 1 }, ...rows]));
  assert.equal(await bad.entry('猫', 'ねこ'), null);
});

test('a parse reads each index key one time', async () => {
  const index = memoryIndex(rows);
  const reads: string[] = [];
  const counted: EntryIndex = {
    byExpression: text => (reads.push(`expression ${text}`), index.byExpression(text)),
    byReading: text => (reads.push(`reading ${text}`), index.byReading(text)),
    bySequence: (dict, sequence) => (reads.push(`sequence ${sequence}`), index.bySequence(dict, sequence)),
    headwords: index.headwords,
  };
  const fresh = dictionaryWords(counted);
  await entrySegments(tokenizer.tokenize('猫とねことネコ。ねこが猫を見た。'), fresh, []);
  assert.deepEqual(reads.filter((read, i) => reads.indexOf(read) !== i), []);
});

test('no dictionary: the parse is the kuromoji grouping and no word has an entry', async () => {
  const none = dictionaryWords(memoryIndex([]));
  for (const text of ['猫とねことネコ', '食肉目ネコ科ネコ属', '本を開いた']) {
    assert.deepEqual(await parse(text, none), groupTokens(tokenizer.tokenize(text)));
  }
  assert.equal(await none.entry('猫', 'ねこ'), null);
});

test('a failed dictionary read gives the kuromoji grouping without entries', async () => {
  const fail = () => Promise.reject(new Error('IndexedDB is closed'));
  const broken = dictionaryWords({ byExpression: fail, byReading: fail, bySequence: fail, headwords: fail });
  const text = '食肉目の猫を見た';
  assert.deepEqual(await parse(text, broken), groupTokens(tokenizer.tokenize(text)));
  const half = dictionaryWords({ ...memoryIndex(rows), bySequence: fail });
  assert.deepEqual(await parse(text, half), groupTokens(tokenizer.tokenize(text)));
});

test('real JMdict: 猫/ねこ/ネコ share 猫, and 食肉目ネコ科ネコ属 is three words', async () => {
  assert.ok(existsSync(JMDICT), `missing ${JMDICT}; download it as the README says`);
  const dict = await readYomitan(readFileSync(JMDICT));
  const all: EntryRow[] = [];
  for (const load of dict.banks) {
    for (const term of await load()) {
      if (term.sequence !== undefined) all.push({ dict: dict.title, expression: term.expression, reading: term.reading, score: term.score, sequence: term.sequence });
    }
  }
  const real = dictionaryWords(memoryIndex(all));
  assert.deepEqual(await keys('猫とねことネコ', real), ['猫=猫=猫', 'ねこ=ねこ=猫', 'ネコ=ネコ=猫']);
  assert.deepEqual(await keys('食肉目ネコ科ネコ属', real), ['食肉目=食肉目=食肉目', 'ネコ科=ネコ科=ネコ科', 'ネコ属=ネコ属=ネコ属']);
  assert.equal(await real.entry('かみ', 'かみ'), null);
  assert.deepEqual(await real.entry('上手', 'うわて'), { key: '上手【うわて】', headword: '上手', reading: 'うわて' });
  const rise = { key: '起き上がる', headword: '起き上がる', reading: 'おきあがる' };
  assert.deepEqual(await real.entry('起き上る', 'おきあがる'), rise);
  assert.deepEqual(await real.entry('起上がる', null), rise);
});
