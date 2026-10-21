import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import kuromoji from 'kuromoji';
import { chord } from '../src/popup/chord.ts';
import { groupTokens, lookupCandidates, splitSegments, toHiragana } from '../src/text/group.ts';
import { inflection, stepsText } from '../src/text/inflection.ts';
import { entryStars, highs, morae, pitchPattern, stars, toMeta, withMeta } from '../src/dictionary/meta.ts';
import { at, isStringList } from '../src/shared/guards.ts';
import { sentenceBounds } from '../src/text/sentence.ts';
import { activeOf, toggleSite } from '../src/page-text/site.ts';
import { readYomitan } from '../src/dictionary/yomitan.ts';

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
    { dict: 'Rank', mode: 'freq', expression: '今日', reading: 'きょう', value: 90, display: '90', ranked: true },
    { dict: 'Rank', mode: 'freq', expression: '今日', reading: 'こんにち', value: 30000, display: '30000', ranked: true },
    { dict: 'Count', mode: 'freq', expression: '今日', reading: null, value: 5, display: '5', ranked: false },
    { dict: 'Pitch', mode: 'pitch', expression: '今日', reading: 'きょう', positions: [1] },
    { dict: 'Rank', mode: 'freq', expression: '昨日', reading: null, value: 2, display: '2', ranked: true },
  ]);
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

test('every module that a content script imports matches web_accessible_resources', () => {
  const root = join(here, '..');
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const resources = at(manifest, 'web_accessible_resources', 0, 'resources');
  assert.ok(isStringList(resources), 'the manifest lists the content script modules');
  const patterns = resources.map(glob => new RegExp(`^${glob.replaceAll('.', '\\.').replaceAll('*', '.*')}$`));
  const seen = new Set<string>();
  const blocked = (module: string): string[] => {
    if (seen.has(module)) return [];
    seen.add(module);
    const imports = [...readFileSync(join(root, module.replace(/\.js$/, '.ts')), 'utf8')
      .matchAll(/^(?:import|export) (?!type )(?:[^;]*? from )?'(\.\.?\/[^']+)\.ts';|import\('(\.\.?\/[^']+)\.ts'\)/gms)]
      .map(([, path, dynamic]) => posix.join(posix.dirname(module), `${path ?? dynamic}.js`));
    return [...(patterns.some(pattern => pattern.test(module)) ? [] : [module]), ...imports.flatMap(blocked)];
  };
  const entries = [...readFileSync(join(root, 'content.ts'), 'utf8').matchAll(/'(src\/[^']+\.js)'/g)].flatMap(([, path]) => path ?? []);
  assert.deepEqual(entries.flatMap(blocked), []);
  assert.ok(seen.size > entries.length, 'the walk follows the imports of the content script modules');
});

test('chord names a key with Alt, and a digit, from the physical key, and Shift only with Alt', () => {
  const key = (key: string, code: string, altKey = false, shiftKey = false) => chord({ key, code, altKey, shiftKey });
  assert.deepEqual([key('Î', 'KeyD', true, true), key('ß', 'KeyS', true), key('N', 'KeyN', false, true), key('1', 'Digit1'),
    key('Escape', 'Escape'), key('Shift', 'ShiftLeft', true, true), key('$', 'Digit4', false, true), key('4', 'Numpad4')],
  ['alt+shift+d', 'alt+s', 'n', '1', 'Escape', 'alt+shift+Shift', '4', '4']);
});

test('a site covers its subdomains, and www. drops out, so all of youtube.com is one site', () => {
  assert.deepEqual(toggleSite([], 'www.youtube.com'), ['youtube.com']);
  const web = (hostname: string) => ({ protocol: 'https:', hostname });
  assert.deepEqual(['www.youtube.com', 'm.youtube.com', 'youtube.com', 'notyoutube.com'].map(host => activeOf(true, ['youtube.com'], web(host))),
    ['on', 'on', 'on', 'video']);
  assert.deepEqual(toggleSite(['youtube.com', 'b.org'], 'm.youtube.com'), ['b.org'], 'a subdomain turns its site off');
  assert.deepEqual(toggleSite(['www.youtube.com'], 'www.youtube.com'), [], 'a site saved with www. before this change turns off');
});

test('toggleSite adds a site that is off and removes a site that is on', () => {
  assert.deepEqual(toggleSite(['a.com'], 'b.org'), ['a.com', 'b.org']);
  assert.deepEqual(toggleSite(['a.com', 'b.org'], 'a.com'), ['b.org']);
});

test('activeOf: the page text only on a site that is on and on Minerr pages; the video everywhere while Minerr is on', () => {
  const web = new URL('https://a.com/page');
  const minerr = new URL('chrome-extension://abc/pages/player.html');
  assert.equal(activeOf(true, [], web), 'video');
  assert.equal(activeOf(true, ['b.org'], web), 'video');
  assert.equal(activeOf(true, ['a.com'], web), 'on');
  assert.equal(activeOf(true, [], minerr), 'on');
  assert.equal(activeOf(false, ['a.com'], web), 'off');
  assert.equal(activeOf(false, [], minerr), 'off');
});

test('a word with kanji gets its reading in hiragana; kana words and unknown words get none; Alt+S tries the longest start first', async () => {
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
  const parse = (text: string) => groupTokens(tokenizer.tokenize(text));
  assert.deepEqual(lookupCandidates('食べなかった', parse).slice(0, 3),
    [{ lemma: '食べなかった', length: 6 }, { lemma: '食べる', length: 6 }, { lemma: '食べなかっ', length: 5 }]);
  assert.deepEqual(lookupCandidates('猫が', parse), [{ lemma: '猫が', length: 2 }, { lemma: '猫', length: 1 }]);
  assert.deepEqual(lookupCandidates('接して', parse).slice(0, 2), [{ lemma: '接して', length: 3 }, { lemma: '接す', length: 3 }]);
  assert.deepEqual(lookupCandidates('接して', parse)[2], { lemma: '接する', length: 3 });
  assert.equal(lookupCandidates('あ'.repeat(30), parse)[0]?.length, 20);
});

test('sentenceBounds finds the sentence around an offset, with its closing quote and without edge white space', () => {
  const text = '昨日は雨だった。 「猫が魚を食べた！」と彼は言った\n次の行';
  const around = (word: string) => {
    const [start, end] = sentenceBounds(text, text.indexOf(word));
    return text.slice(start, end);
  };
  assert.deepEqual(['雨', '魚', '彼', '次'].map(around), ['昨日は雨だった。', '「猫が魚を食べた！」', 'と彼は言った', '次の行']);
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

test('inflection: the steps from the dictionary form to an inflected verb or adjective, and none for a dictionary form', async () => {
  const tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) =>
    kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') }).build((err, t) => (err ? reject(err) : resolve(t))));
  const line = (text: string) => stepsText(inflection(tokenizer.tokenize(text)));
  assert.deepEqual(inflection(tokenizer.tokenize('すいてきた')), [
    { text: 'すい', label: '' }, { text: 'て', label: 'て-form' }, { text: 'き', label: '〜てくる: start to / come to' }, { text: 'た', label: 'past' },
  ]);
  assert.deepEqual(Object.fromEntries(['食べなかった', '行きます', '見られる', '読ませる', '書いている', '食べてしまった', '寒くなかった', 'した', '行けば'].map(text => [text, line(text)])), {
    食べなかった: '食べ + なかっ (negative) + た (past)',
    行きます: '行き + ます (polite)',
    見られる: '見 + られる (passive / potential)',
    読ませる: '読ま + せる (causative)',
    書いている: '書い + て (て-form) + いる (〜ている: ongoing / state)',
    食べてしまった: '食べ + て (て-form) + しまっ (〜てしまう: completely / by accident) + た (past)',
    寒くなかった: '寒く + なかっ (negative) + た (past)',
    した: 'し + た (past)',
    行けば: '行け + ば (conditional)',
  });
  assert.deepEqual(Object.fromEntries(['読まされる', '書いてある', '降りそう', '食べたら', '食べず', '行かなきゃ', '寒く', '行け', '食べよう', '食べたがる'].map(text => [text, line(text)])), {
    読まされる: '読ま + さ (causative) + れる (passive / potential)',
    書いてある: '書い + て (て-form) + ある (〜てある: done and left so)',
    降りそう: '降り + そう (looks like)',
    食べたら: '食べ + たら (conditional)',
    食べず: '食べ + ず (negative: without)',
    行かなきゃ: '行か + なきゃ (must / if not)',
    寒く: '寒く (adverb)',
    行け: '行け (imperative)',
    食べよう: '食べよ + う (volitional)',
    食べたがる: '食べ + た (want to) + がる (〜がる: shows signs of)',
  });
  assert.deepEqual(groupTokens(tokenizer.tokenize('書いてある')), [{ text: '書いてある', lemma: '書く', reading: 'かいてある' }]);
  assert.deepEqual(groupTokens(tokenizer.tokenize('降りそう')), [{ text: '降りそう', lemma: '降りる', reading: 'おりそう' }]);
  assert.deepEqual(groupTokens(tokenizer.tokenize('読まされる')), [{ text: '読まされる', lemma: '読む', reading: 'よまされる' }]);
  // On the page 勉強した is two words, 勉強 and した: the popup of した shows the line of する.
  assert.deepEqual(['食べる', '寒い', '猫', '勉強した'].map(line), ['', '', '', '']);
});
