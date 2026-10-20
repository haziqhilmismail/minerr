import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import kuromoji from 'kuromoji';
import { chord, statusTarget } from '../src/chord.ts';
import { groupTokens, splitSegments, toHiragana } from '../src/group.ts';
import { entryStars, highs, morae, pitchPattern, stars, toMeta, withMeta } from '../src/meta.ts';
import { at, isStringList } from '../src/parse.ts';
import { sentenceBounds } from '../src/sentence.ts';
import { toggleSite } from '../src/site.ts';
import { readYomitan } from '../src/yomitan.ts';

const here = import.meta.dirname;

function makeZip(members: string[]) {
  const out = join(mkdtempSync(join(tmpdir(), 'ml-zip-')), 'test.zip');
  execFileSync('python3', ['-I', join(here, 'make-zip.py'), out, ...members]);
  return readFileSync(out);
}

test('toMeta reads every Yomitan freq shape and the pitch positions, and drops other modes', () => {
  assert.deepEqual(toMeta(['猫', 'freq', 1200]), { mode: 'freq', expression: '猫', reading: null, value: 1200, display: '1200' });
  assert.deepEqual(toMeta(['猫', 'freq', '1200㋕']), { mode: 'freq', expression: '猫', reading: null, value: 1200, display: '1200㋕' });
  assert.deepEqual(toMeta(['猫', 'freq', { value: 7, displayValue: '7 (top)' }]), { mode: 'freq', expression: '猫', reading: null, value: 7, display: '7 (top)' });
  assert.deepEqual(toMeta(['今日', 'freq', { reading: 'きょう', frequency: { value: 90 } }]), { mode: 'freq', expression: '今日', reading: 'きょう', value: 90, display: '90' });
  assert.deepEqual(toMeta(['今日', 'freq', { reading: 'こんにち', frequency: 30000 }]), { mode: 'freq', expression: '今日', reading: 'こんにち', value: 30000, display: '30000' });
  assert.equal(toMeta(['猫', 'freq', 'often']), null);
  assert.deepEqual(toMeta(['箸', 'pitch', { reading: 'はし', pitches: [{ position: 1 }, { position: 'HL' }, { position: 2, tags: ['x'] }] }]),
    { mode: 'pitch', expression: '箸', reading: 'はし', positions: [1, 2] });
  assert.equal(toMeta(['箸', 'ipa', { reading: 'はし', transcriptions: [] }]), null);
});

test('stars: 5 up to rank 1,500, 4 to 5,000, 3 to 15,000, 2 to 30,000, then 1', () => {
  assert.deepEqual([1, 1500, 1501, 5000, 5001, 15000, 15001, 30000, 30001, 900000].map(stars), [5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  assert.equal(entryStars([{ dict: 'A', value: 20000, display: '', ranked: true }, { dict: 'B', value: 3000, display: '', ranked: true }]), 4);
  assert.equal(entryStars([{ dict: 'Counts', value: 3, display: '3', ranked: false }]), null);
});

test('morae join small kana; the pitch patterns and the high morae follow the downstep position', () => {
  assert.deepEqual(morae('きょうしゃ'), ['きょ', 'う', 'しゃ']);
  assert.deepEqual(morae('がっこう'), ['が', 'っ', 'こ', 'う']);
  assert.deepEqual([[0, 3], [1, 3], [2, 3], [3, 3], [2, 4]].map(([p, n]) => pitchPattern(p ?? 0, n ?? 0)),
    ['heiban', 'atamadaka', 'nakadaka', 'odaka', 'nakadaka']);
  assert.deepEqual(highs(0, 3), [false, true, true]);
  assert.deepEqual(highs(1, 3), [true, false, false]);
  assert.deepEqual(highs(2, 4), [false, true, false, false]);
  assert.deepEqual(highs(3, 3), [false, true, true]);
});

test('withMeta gives each group the frequencies of its reading or of all readings, and the pitch of its reading', () => {
  const group = (reading: string) => ({ expression: '今日', reading, termTags: [], senses: [] });
  const [kyou, konnichi] = withMeta([group('きょう'), group('こんにち')], [
    { dict: 'Rank', mode: 'freq', expression: '今日', reading: 'きょう', value: 90, display: '90' },
    { dict: 'Rank', mode: 'freq', expression: '今日', reading: 'こんにち', value: 30000, display: '30000' },
    { dict: 'Count', mode: 'freq', expression: '今日', reading: null, value: 5, display: '5' },
    { dict: 'Pitch', mode: 'pitch', expression: '今日', reading: 'きょう', positions: [1] },
    { dict: 'Rank', mode: 'freq', expression: '昨日', reading: null, value: 2, display: '2' },
  ], new Set(['Rank']));
  assert.deepEqual(kyou?.frequencies, [{ dict: 'Rank', value: 90, display: '90', ranked: true }, { dict: 'Count', value: 5, display: '5', ranked: false }]);
  assert.deepEqual(kyou?.pitches, [{ dict: 'Pitch', positions: [1] }]);
  assert.deepEqual(konnichi?.frequencies, [{ dict: 'Rank', value: 30000, display: '30000', ranked: true }, { dict: 'Count', value: 5, display: '5', ranked: false }]);
  assert.deepEqual(konnichi?.pitches, []);
});

test('readYomitan reads the term meta banks and the frequency mode', async () => {
  const dict = await readYomitan(makeZip([
    `index.json=stored:${JSON.stringify({ title: 'Freq', revision: '1', format: 3, frequencyMode: 'occurrence-based' })}`,
    `term_meta_bank_1.json=deflated:${JSON.stringify([['猫', 'freq', 12], ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 1 }] }], ['猫', 'ipa', {}]])}`,
  ]));
  assert.equal(dict.frequencyMode, 'occurrence-based');
  assert.equal(dict.banks.length, 0);
  assert.deepEqual(await Promise.all(dict.metaBanks.map(load => load())), [[
    { mode: 'freq', expression: '猫', reading: null, value: 12, display: '12' },
    { mode: 'pitch', expression: '猫', reading: 'ねこ', positions: [1] },
  ]]);
});

test('every module that a content script module imports is in web_accessible_resources', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(here, '..', 'manifest.json'), 'utf8'));
  const resources = at(manifest, 'web_accessible_resources', 0, 'resources');
  assert.ok(isStringList(resources), 'the manifest lists the content script modules');
  const listed = new Set(resources);
  const missing = [...listed].flatMap(module => [...readFileSync(join(here, '..', module.replace(/\.js$/, '.ts')), 'utf8')
    .matchAll(/^import (?!type )[^;]*?from '\.\/([\w-]+)\.ts';/gms)]
    .map(([, name]) => `src/${name}.js`).filter(name => !listed.has(name)).map(name => `${module} imports ${name}`));
  assert.deepEqual(missing, []);
});

test('chord names a key with Alt from the physical key, and Shift only with Alt', () => {
  const key = (key: string, code: string, altKey = false, shiftKey = false) => chord({ key, code, altKey, shiftKey });
  assert.deepEqual([key('Î', 'KeyD', true, true), key('ß', 'KeyS', true), key('N', 'KeyN', false, true), key('1', 'Digit1'),
    key('Escape', 'Escape'), key('Shift', 'ShiftLeft', true, true)], ['alt+shift+d', 'alt+s', 'n', '1', 'Escape', 'alt+shift+Shift']);
});

test('toggleSite adds a site that is on and removes a site that is off', () => {
  assert.deepEqual(toggleSite(['a.com'], 'b.org'), ['a.com', 'b.org']);
  assert.deepEqual(toggleSite(['a.com', 'b.org'], 'a.com'), ['b.org']);
});

test('a word with kanji gets its reading in hiragana; kana words and words that kuromoji does not know get none', async () => {
  const tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) =>
    kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') }).build((err, t) => (err ? reject(err) : resolve(t))));
  assert.deepEqual(groupTokens(tokenizer.tokenize('テレビ局でゲームをプレイした')), [
    { text: 'テレビ局', lemma: 'テレビ局', reading: 'てれびきょく' },
    { text: 'で' },
    { text: 'ゲーム', lemma: 'ゲーム' },
    { text: 'を' },
    { text: 'プレイ', lemma: 'プレイ' },
    { text: 'した', lemma: 'する' },
  ]);
  assert.equal(toHiragana('キョウ、ヴァーチャル'), 'きょう、ゔぁーちゃる');
});

test('sentenceBounds finds the sentence around an offset, with its closing quote and without edge white space', () => {
  const text = '昨日は雨だった。 「猫が魚を食べた！」と彼は言った\n次の行';
  const around = (word: string) => {
    const [start, end] = sentenceBounds(text, text.indexOf(word));
    return text.slice(start, end);
  };
  assert.deepEqual(['雨', '魚', '彼', '次'].map(around), ['昨日は雨だった。', '「猫が魚を食べた！」', 'と彼は言った', '次の行']);
});

test('statusTarget: a selection wins over the popup, and the subtitle line counts only with one unknown word', () => {
  const target = (selectedWords: number, popupOpen: boolean, lineUnknowns: number) => statusTarget({ selectedWords, popupOpen, lineUnknowns });
  assert.deepEqual([target(2, true, 1), target(0, true, 1), target(0, false, 1), target(0, false, 2), target(0, false, 0)],
    ['selection', 'popup', 'line', null, null]);
});

test('splitSegments cuts the segments of a run at its text nodes and marks the parts of a split word', async () => {
  const tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) =>
    kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') }).build((err, t) => (err ? reject(err) : resolve(t))));
  const parse = (text: string) => groupTokens(tokenizer.tokenize(text));
  assert.deepEqual(splitSegments(parse('低いところ'), [1, 4]), [
    [{ text: '低', lemma: '低い', part: 'first' }],
    [{ text: 'い', lemma: '低い', part: 'rest' }, { text: 'ところ', lemma: 'ところ' }],
  ]);
  assert.deepEqual(splitSegments(parse('に暖かくて湿った'), [2, 6]), [
    [{ text: 'に' }, { text: '暖', lemma: '暖かい', part: 'first' }],
    [{ text: 'かくて', lemma: '暖かい', part: 'rest' }, { text: '湿った', lemma: '湿る', reading: 'しめった' }],
  ]);
  assert.deepEqual(splitSegments([{ text: 'あいう' }], [1, 1, 1]), [[{ text: 'あ' }], [{ text: 'い' }], [{ text: 'う' }]]);
});
