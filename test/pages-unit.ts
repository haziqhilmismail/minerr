import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPosition, pageMove, positionKey, textChapters, textParagraphs, turn, zipPath } from '../src/book.ts';
import { comprehension, iPlusOneTexts, ratingOf } from '../src/score.ts';
import { keysOf, listWords, wordsOfLines } from '../src/wordlist.ts';

test('ratingOf gives the Migaku label for each score band', () => {
  assert.deepEqual([0, 59, 60, 69, 70, 79, 80, 89, 90, 94, 95, 98, 99, 100].map(percent => ratingOf(percent).label), [
    'Ambitious', 'Ambitious', 'Challenging', 'Challenging', 'Approachable', 'Approachable', 'Good', 'Good',
    'Great', 'Great', 'Excellent', 'Excellent', 'Exceptional', 'Exceptional',
  ]);
});

test('comprehension counts known and ignored words as understood, rounds down, and counts each lemma once', () => {
  const score = comprehension([
    { key: '猫', status: 'known' }, { key: '猫', status: 'known' }, { key: '田中', status: 'ignored' },
    { key: '魚', status: 'learning' }, { key: '食べる', status: 'known' }, { key: '雨', status: 'unknown' },
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

test('wordsOfLines and keysOf give each word one time, keysOf by the status key', () => {
  assert.deepEqual(wordsOfLines(' 猫\n\n魚\r\n猫\n　犬　\n'), ['猫', '魚', '犬']);
  assert.deepEqual(keysOf([[{ text: '猫', lemma: '猫' }, { text: 'が' }], [{ text: '食べた', lemma: '食べる' }, { text: '猫', lemma: '猫' }]]), ['猫', '食べる']);
  const cat = { key: '猫', headword: '猫', reading: 'ねこ' };
  assert.deepEqual(keysOf([[{ text: 'ねこ', lemma: 'ねこ', entry: cat }, { text: 'ネコ', lemma: 'ネコ', entry: cat }]]), ['猫']);
});

test('textParagraphs drops the byte order mark and empty lines; textChapters splits long text at paragraph ends', () => {
  assert.deepEqual(textParagraphs('﻿一行目\r\n\r\n　二行目\n  \n三行目'), ['一行目', '　二行目', '三行目']);
  assert.deepEqual(textChapters('a.txt', ['一', '二']), [{ title: 'a.txt', paragraphs: ['一', '二'] }]);
  assert.deepEqual(textChapters('a.txt', ['あい', 'う', 'えお', 'か'], 3), [
    { title: 'Part 1', paragraphs: ['あい', 'う'] }, { title: 'Part 2', paragraphs: ['えお', 'か'] },
  ]);
});

test('pageMove maps the page keys; the arrows follow the text direction', () => {
  const keys = ['PageDown', 'PageUp', ' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'a', 'Enter'];
  assert.deepEqual(keys.map(key => pageMove(key, false, false)), ['next', 'previous', 'next', 'next', 'previous', 'previous', 'next', null, null]);
  assert.deepEqual(keys.map(key => pageMove(key, false, true)), ['next', 'previous', 'next', 'next', 'previous', 'next', 'previous', null, null]);
  assert.equal(pageMove(' ', true, false), 'previous');
});

test('turn scrolls 90% of the view and opens the next or previous chapter at the ends', () => {
  assert.deepEqual(turn('next', { offset: 0, size: 500, total: 2000 }), { kind: 'scroll', to: 450 });
  assert.deepEqual(turn('next', { offset: 1300, size: 500, total: 2000 }), { kind: 'scroll', to: 1500 });
  assert.deepEqual(turn('next', { offset: 1500, size: 500, total: 2000 }), { kind: 'chapter', step: 1 });
  assert.deepEqual(turn('next', { offset: 0, size: 500, total: 300 }), { kind: 'chapter', step: 1 });
  assert.deepEqual(turn('previous', { offset: 300, size: 500, total: 2000 }), { kind: 'scroll', to: 0 });
  assert.deepEqual(turn('previous', { offset: 0, size: 500, total: 2000 }), { kind: 'chapter', step: -1 });
});

test('zipPath resolves a link against the file that holds it; isPosition and positionKey read the saved place', () => {
  assert.equal(zipPath('OEBPS/content.opf', 'Text/ch%201.xhtml#part'), 'OEBPS/Text/ch 1.xhtml');
  assert.equal(zipPath('OEBPS/Text/ch1.xhtml', '../Images/a.png'), 'OEBPS/Images/a.png');
  assert.equal(zipPath('content.opf', 'ch1.xhtml'), 'ch1.xhtml');
  assert.deepEqual([{ chapter: 2, progress: 0.5 }, { chapter: 1.5, progress: 0 }, { chapter: -1, progress: 0 }, { chapter: 0, progress: 2 }, { chapter: 1 }, null, 'x']
    .map(isPosition), [true, false, false, false, false, false, false]);
  assert.equal(positionKey('本.epub', 1234), 'reader:1234:本.epub');
});
