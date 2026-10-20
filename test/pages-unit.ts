import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprehension, iPlusOneTexts, ratingOf } from '../src/score.ts';

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
