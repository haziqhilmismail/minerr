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
import { flattenGlossaryItem, groupTerms, readYomitan } from '../src/yomitan.js';
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
  const text = async name => new TextDecoder().decode(await members.get(name)());
  assert.equal(await text('a.txt'), 'hello stored');
  assert.equal(await text('dir/b.txt'), long);
});

test('readYomitan returns index metadata, tags, and flattened terms per bank', async () => {
  const rows = [
    ['猫', 'ねこ', '1 n', '', 10, ['cat', { type: 'text', text: 'feline' }], 1, '⭐ ichi'],
    ['ねこ', '', '', '', 5, [{ type: 'structured-content', content: { tag: 'li', content: 'cat (kana)' } }], 2, ''],
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
  assert.equal(dict.banks.length, 1);
  assert.deepEqual(await dict.banks[0](), [
    { expression: '猫', reading: 'ねこ', definitionTags: ['1', 'n'], termTags: ['⭐', 'ichi'], glossary: ['cat', 'feline'], score: 10 },
    { expression: 'ねこ', reading: 'ねこ', definitionTags: [], termTags: [], glossary: ['cat (kana)'], score: 5 },
  ]);
  const untagged = makeZip([`index.json=stored:${JSON.stringify({ title: 'Bare', revision: 'r1', format: 3 })}`]);
  assert.deepEqual((await readYomitan(untagged)).tags, []);
});

test('real JMdict Yomitan zip parses with 食べる -> "to eat"', async () => {
  assert.ok(existsSync(JMDICT), `missing ${JMDICT}; download it as the README says`);
  const dict = await readYomitan(readFileSync(JMDICT));
  let count = 0;
  const rows = [];
  for (const load of dict.banks) {
    const terms = await load();
    count += terms.length;
    rows.push(...terms.filter(t => t.expression === '食べる').map(t => ({ ...t, dict: dict.title })));
  }
  const [taberu] = groupTerms(rows.sort((a, b) => b.score - a.score), dict.tags.map(tag => ({ ...tag, dict: dict.title })));
  const [first] = taberu.senses;
  console.log(`JMdict "${dict.title}": ${dict.banks.length} banks, ${count} terms, ${dict.tags.length} tags,`
    + ` 食べる -> ${JSON.stringify(taberu.termTags.map(t => t.name))} ${JSON.stringify(first)}`);
  assert.ok(count > 100000, `term count ${count}`);
  assert.equal(taberu.reading, 'たべる');
  assert.deepEqual(taberu.termTags.find(t => t.name === '⭐'), { name: '⭐', category: 'popular', notes: 'high priority term' });
  assert.deepEqual(first.tags.map(t => [t.name, t.category]), [['v1', 'partOfSpeech'], ['vt', 'partOfSpeech']]);
  assert.ok(first.glossary.some(g => /\beat\b/.test(g)), JSON.stringify(first.glossary));
});

test('captionText joins the caption lines with line breaks and drops empty lines', async () => {
  const { captionText } = await import('../src/captions.js');
  assert.equal(captionText([' 猫が好きです ', '', '魚も好き']), '猫が好きです\n魚も好き');
  assert.equal(captionText([]), '');
});

test('segmentAt finds the segment that covers a time, with the end exclusive', async () => {
  const { segmentAt } = await import('../src/captions.js');
  const segments = [{ start: 0, end: 2, text: 'あ' }, { start: 2, end: 4, text: 'い' }, { start: 6, end: 8, text: 'う' }];
  assert.deepEqual([0, 1.99, 2, 5, 7, 8].map(t => segmentAt(segments, t)?.text ?? null), ['あ', 'あ', 'い', null, 'う', null]);
});
