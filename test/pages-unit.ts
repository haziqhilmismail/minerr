import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprehension, iPlusOneTexts, ratingOf } from '../src/score.ts';
import { lemmasOf, listWords, wordsOfLines } from '../src/wordlist.ts';

test('ratingOf gives the Migaku label for each score band', () => {
  assert.deepEqual([0, 59, 60, 69, 70, 79, 80, 89, 90, 94, 95, 98, 99, 100].map(percent => ratingOf(percent).label), [
    'Ambitious', 'Ambitious', 'Challenging', 'Challenging', 'Approachable', 'Approachable', 'Good', 'Good',
    'Great', 'Great', 'Excellent', 'Excellent', 'Exceptional', 'Exceptional',
  ]);
});

test('comprehension counts known and ignored words as understood, rounds down, and counts each lemma once', () => {
  const score = comprehension([
    { lemma: '猫', status: 'known' }, { lemma: '猫', status: 'known' }, { lemma: '田中', status: 'ignored' },
    { lemma: '魚', status: 'learning' }, { lemma: '食べる', status: 'known' }, { lemma: '雨', status: 'unknown' },
  ]);
  assert.deepEqual(score && { ...score, rating: score.rating.label }, {
    percent: 66, rating: 'Challenging', words: 6, unique: { unknown: 1, learning: 1, known: 2, ignored: 1 },
  });
  assert.equal(comprehension([]), null);
});

test('iPlusOneTexts returns the text of each sentence with one unknown word', () => {
  assert.deepEqual(iPlusOneTexts([
    { text: '猫', status: 'known' }, { text: 'が', status: null }, { text: '魚', status: 'unknown' }, { text: 'を', status: null },
    { text: '食べた', status: 'known' }, { text: '。\n', status: null }, { text: '雨', status: 'unknown' }, { text: 'と', status: null },
    { text: '風', status: 'unknown' }, { text: '。', status: null }, { text: '本', status: 'known' }, { text: 'を', status: null },
    { text: '読む', status: 'unknown' },
  ]), ['猫が魚を食べた。', '本を読む']);
});

test('listWords filters by status and text, and sorts by word or by status then word', () => {
  const words = new Map([['猫', 'known'], ['魚', 'learning'], ['あめ', 'ignored'], ['猫舌', 'learning'], ['いぬ', 'known']] as const);
  assert.deepEqual(listWords(words, { search: '', filter: 'all', sort: 'word' }), ['あめ', 'いぬ', '魚', '猫', '猫舌']);
  assert.deepEqual(listWords(words, { search: '', filter: 'all', sort: 'status' }), ['魚', '猫舌', 'いぬ', '猫', 'あめ']);
  assert.deepEqual(listWords(words, { search: ' 猫 ', filter: 'all', sort: 'word' }), ['猫', '猫舌']);
  assert.deepEqual(listWords(words, { search: '猫', filter: 'learning', sort: 'word' }), ['猫舌']);
});

test('wordsOfLines and lemmasOf give each word one time', () => {
  assert.deepEqual(wordsOfLines(' 猫\n\n魚\r\n猫\n　犬　\n'), ['猫', '魚', '犬']);
  assert.deepEqual(lemmasOf([[{ text: '猫', lemma: '猫' }, { text: 'が' }], [{ text: '食べた', lemma: '食べる' }, { text: '猫', lemma: '猫' }]]), ['猫', '食べる']);
});
