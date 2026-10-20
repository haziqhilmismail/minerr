import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import kuromoji from 'kuromoji';
import { definitionHtml } from '../src/anki.js';
import { groupTokens } from '../src/group.js';
import { sentenceAround } from '../src/sentence.js';
import { flattenGlossaryItem, readYomitan } from '../src/yomitan.js';
import { unzip } from '../src/zip.js';

const here = import.meta.dirname;
const JMDICT = join(here, 'fixtures', 'JMdict_english.zip');

const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: join(here, '..', 'node_modules', 'kuromoji', 'dict') })
    .build((err, t) => (err ? reject(err) : resolve(t))));
const parse = text => groupTokens(tokenizer.tokenize(text));

function makeZip(members) {
  const out = join(mkdtempSync(join(tmpdir(), 'ml-zip-')), 'test.zip');
  execFileSync('python3', ['-I', join(here, 'make-zip.py'), out, ...members]);
  return readFileSync(out);
}

test('verb with auxiliaries is one word with the dictionary form', () => {
  assert.deepEqual(parse('食べなかった'), [{ text: '食べなかった', lemma: '食べる' }]);
});

test('particles and copula carry no lemma; text concatenates to the input', () => {
  const input = '猫が好きです';
  const segments = parse(input);
  assert.deepEqual(segments, [
    { text: '猫', lemma: '猫' },
    { text: 'が' },
    { text: '好き', lemma: '好き' },
    { text: 'です' },
  ]);
  assert.equal(segments.map(s => s.text).join(''), input);
});

test('て/ば groups, whitespace and latin text stay plain, concatenation is exact', () => {
  const input = '猫が魚を食べている。\n  行けば寒くない abc 123';
  const segments = parse(input);
  assert.equal(segments.map(s => s.text).join(''), input);
  assert.deepEqual(segments.filter(s => s.lemma), [
    { text: '猫', lemma: '猫' },
    { text: '魚', lemma: '魚' },
    { text: '食べている', lemma: '食べる' },
    { text: '行けば', lemma: '行く' },
    { text: '寒くない', lemma: '寒い' },
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

test('definitionHtml is one escaped <ol> with a dictionary label after each run of the same dictionary', () => {
  assert.equal(definitionHtml([
    { dict: 'JMdict', glossary: ['to eat'] },
    { dict: 'JMdict', glossary: ['to live on\nto subsist on', 'a <b> & "c"'] },
    { dict: 'Other', glossary: ['to consume'] },
  ]), '<ol><li>to eat</li>'
    + '<li>to live on<br>to subsist on<br>a &lt;b&gt; &amp; &quot;c&quot;<span class="dict">JMdict</span></li>'
    + '<li>to consume<span class="dict">Other</span></li></ol>');
  assert.equal(definitionHtml([]), '');
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
});

test('unzip reads stored and deflated members exactly', async () => {
  const long = 'ねこ cat '.repeat(500);
  const members = unzip(makeZip(['a.txt=stored:hello stored', `dir/b.txt=deflated:${long}`]));
  assert.deepEqual([...members.keys()], ['a.txt', 'dir/b.txt']);
  const text = async name => new TextDecoder().decode(await members.get(name)());
  assert.equal(await text('a.txt'), 'hello stored');
  assert.equal(await text('dir/b.txt'), long);
});

test('readYomitan returns index metadata and flattened terms per bank', async () => {
  const rows = [
    ['猫', 'ねこ', 'n', '', 10, ['cat', { type: 'text', text: 'feline' }], 1, ''],
    ['ねこ', '', 'n', '', 5, [{ type: 'structured-content', content: { tag: 'li', content: 'cat (kana)' } }], 2, ''],
  ];
  const zip = makeZip([
    `index.json=stored:${JSON.stringify({ title: 'Tiny', revision: 'r1', format: 3 })}`,
    `term_bank_1.json=deflated:${JSON.stringify(rows)}`,
    'tag_bank_1.json=deflated:[]',
  ]);
  const dict = await readYomitan(zip);
  assert.equal(dict.title, 'Tiny');
  assert.equal(dict.revision, 'r1');
  assert.equal(dict.banks.length, 1);
  assert.deepEqual(await dict.banks[0](), [
    { expression: '猫', reading: 'ねこ', glossary: ['cat', 'feline'], score: 10 },
    { expression: 'ねこ', reading: 'ねこ', glossary: ['cat (kana)'], score: 5 },
  ]);
});

test('real JMdict Yomitan zip parses with 食べる -> "to eat"', async () => {
  assert.ok(existsSync(JMDICT), `missing ${JMDICT}; download it as the README says`);
  const dict = await readYomitan(readFileSync(JMDICT));
  let count = 0;
  let taberu;
  for (const load of dict.banks) {
    const terms = await load();
    count += terms.length;
    taberu ??= terms.find(t => t.expression === '食べる' && t.score > 0);
  }
  console.log(`JMdict "${dict.title}": ${dict.banks.length} banks, ${count} terms, 食べる -> ${JSON.stringify(taberu.glossary)}`);
  assert.ok(count > 100000, `term count ${count}`);
  assert.equal(taberu.reading, 'たべる');
  assert.ok(taberu.glossary.some(g => /\beat\b/.test(g)), JSON.stringify(taberu.glossary));
});
