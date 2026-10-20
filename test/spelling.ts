import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TermRow } from '../src/yomitan.ts';
import { launch, listen, makeDictionary, mockAnki } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-spelling-'));

// Rows as JMdict_english 2026-10-19 has them: [expression, reading, definitionTags, rules, score, glossary, sequence, termTags].
const term = (expression: string, reading: string, score: number, sequence: number, gloss: string): TermRow =>
  [expression, reading, 'n', '', score, [gloss], sequence, ''];
const fixture = makeDictionary(join(work, 'jmdict.zip'), 'JMdict', [
  term('紙', 'かみ', 1999800, 1311530, 'paper'),
  term('食肉', 'しょくにく', 1999800, 1358580, 'meat'),
  term('神', 'かみ', 1999800, 1364440, 'god'),
  term('猫', 'ねこ', 1999800, 1467640, 'cat'),
  term('ネコ', 'ネコ', -10200, 1467640, 'cat'),
  term('髪', 'かみ', 1999800, 1477950, 'hair'),
  term('目', 'め', 999800, 1604890, 'eye'),
  term('ネコ科', 'ネコか', -200, 1651200, 'Felidae'),
  term('猫科', 'ねこか', -10200, 1651200, 'Felidae'),
  term('食肉目', 'しょくにくもく', -200, 1883210, 'Carnivora'),
  term('ネコ属', 'ネコぞく', -200, 1900510, 'Felis'),
  term('猫', 'ねこま', -200, 2698030, 'cat (archaic)'),
]);
// A term dictionary without entries: every row has sequence 0.
const flat = makeDictionary(join(work, 'flat.zip'), 'Flat', [
  ['紙', 'かみ', 'n', '', 100, ['paper'], 0, ''],
  ['猫', 'ねこ', 'n', '', 0, ['cat'], 0, ''],
]);

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><body><p id="cats">猫とねことネコ。かみと紙。</p><p id="taxon">食肉目ネコ科ネコ属</p></body>');
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/`;
const anki = await mockAnki();
anki.replies.findNotes = () => [1];
anki.replies.notesInfo = () => [{ noteId: 1, fields: { Word: { value: '猫科', order: 0 } } }];

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  const storedWords = () => worker.evaluate(async () => Object.fromEntries(Object.entries(await chrome.storage.local.get(null))
    .filter(([key]) => key.startsWith('w:')).map(([key, value]) => [key.slice(2), value])));
  await worker.evaluate(() => chrome.storage.local.set({ 'w:ねこ': 'known', 'w:ネコ': 'learning', 'w:かみ': 'ignored' }));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', fixture);
  await options.locator('#dict-status', { hasText: 'Imported JMdict' }).waitFor();
  assert.deepEqual(await storedWords(), { 猫: 'known', かみ: 'ignored' });
  console.log('the JMdict import moves w:ねこ=known and w:ネコ=learning to w:猫=known; かみ has more than one entry and stays');
  await worker.evaluate(() => chrome.storage.local.remove('w:かみ'));
  await options.setInputFiles('#dict-file', flat);
  await options.locator('#dict-status', { hasText: 'Imported Flat' }).waitFor();

  const tab = await context.newPage();
  await tab.goto(pageUrl);
  await tab.waitForSelector('#taxon .ml-word');
  await tab.waitForSelector('#cats .ml-word');
  const lemmas = (selector: string) => tab.$$eval(`${selector} .ml-word`, spans => spans.map(span => `${span.textContent}=${span.dataset.mlLemma}`));
  const readings = (selector: string) => tab.$$eval(`${selector} .ml-word`, spans => spans.map(span => span.dataset.mlReading));
  const statuses = () => tab.$$eval('#cats .ml-word', spans => spans.map(span => `${span.textContent} ${span.className.replace('ml-word ml-', '')}`));

  assert.deepEqual({ taxon: await lemmas('#taxon'), furigana: await readings('#taxon'), cats: await statuses() }, {
    taxon: ['食肉目=食肉目', 'ネコ科=ネコ科', 'ネコ属=ネコ属'],
    furigana: ['しょくにくもく', 'ねこか', 'ねこぞく'],
    cats: ['猫 known', 'ねこ known', 'ネコ known', 'かみ unknown', '紙 unknown'],
  });
  console.log('食肉目ネコ科ネコ属 is three words with the JMdict readings; 猫, ねこ, and ネコ show the status of w:猫');

  const popup = tab.locator('minerr-popup .popup');
  const word = (text: string) => tab.locator('#cats .ml-word', { hasText: text });
  await word('猫').hover();
  await popup.locator('.lemma', { hasText: '猫' }).waitFor();
  await tab.keyboard.press('1');
  await tab.locator('#cats .ml-word.ml-unknown', { hasText: 'ネコ' }).waitFor();
  await tab.reload();
  await tab.waitForSelector('#cats .ml-word');
  assert.deepEqual(await statuses(), ['猫 unknown', 'ねこ unknown', 'ネコ unknown', 'かみ unknown', '紙 unknown']);
  assert.deepEqual(await storedWords(), {});
  console.log('key 1 on 猫, then a reload: ねこ and ネコ stay unknown');

  await word('猫').hover();
  await popup.locator('.lemma', { hasText: '猫' }).waitFor();
  await tab.keyboard.press('3');
  await tab.locator('#cats .ml-word.ml-known', { hasText: '猫' }).waitFor();
  assert.deepEqual(await statuses(), ['猫 known', 'ねこ known', 'ネコ known', 'かみ unknown', '紙 unknown']);
  console.log('key 3 on 猫: ねこ and ネコ are known too; かみ is not, and neither is 紙, which shares sequence 0 with 猫 in Flat');

  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  await word('ネコ').hover();
  await popup.locator('.surface', { hasText: 'ネコ' }).waitFor();
  assert.deepEqual(await popup.locator('header .title').evaluate(title => [...title.children].map(child => child.textContent)), ['猫', 'ねこ']);
  assert.equal(await popup.locator('.surface').innerText(), 'On the page: ネコ · Appears 3 times on this page');
  console.log('popup of ネコ: header 猫 ねこ, the page surface ネコ, 3 times on the page');

  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  await word('ねこ').hover();
  await popup.locator('.surface', { hasText: 'ねこ' }).waitFor();
  await tab.keyboard.press('2');
  await tab.locator('#cats .ml-word.ml-learning', { hasText: 'ネコ' }).waitFor();
  assert.deepEqual(await storedWords(), { 猫: 'learning' });
  console.log('key 2 on ねこ: the status goes to w:猫');

  await tab.keyboard.press('Escape');
  await options.bringToFront();
  await options.click('#known-import');
  await options.locator('#known-status', { hasText: 'Marked 1 words as known.' }).waitFor();
  await tab.locator('#taxon .ml-word.ml-known', { hasText: 'ネコ科' }).waitFor();
  assert.deepEqual(await storedWords(), { 猫: 'learning', ネコ科: 'known' });
  console.log('import known words from Anki: 猫科 is stored as ネコ科');

  const file = join(work, 'statuses.json');
  writeFileSync(file, JSON.stringify({ format: 'minerr-statuses', version: 1, exported: '2026-10-20T00:00:00.000Z', words: { 猫: 'known', ねこ: 'learning' } }));
  await options.setInputFiles('#status-file', file);
  await options.locator('#status-message', { hasText: 'Imported 1 words: 0 added, 1 changed, 0 unchanged.' }).waitFor();
  assert.deepEqual(await storedWords(), { 猫: 'known', ネコ科: 'known' });
  console.log('import of a status file with 猫: known and ねこ: learning: one word, 猫 known');

  await tab.bringToFront();
  await tab.locator('#cats .ml-word.ml-known', { hasText: 'ネコ' }).waitFor();
  await tab.evaluate(() => getSelection()?.selectAllChildren(document.querySelector('#cats') ?? document.body));
  await tab.keyboard.press('1');
  await tab.locator('minerr-popup .toast', { hasText: 'Marked 3 words as unknown.' }).waitFor();
  assert.deepEqual(await storedWords(), { ネコ科: 'known' });
  assert.deepEqual(await statuses(), ['猫 unknown', 'ねこ unknown', 'ネコ unknown', 'かみ unknown', '紙 unknown']);
  console.log('bulk status on 猫 ねこ ネコ かみ 紙: 3 words (猫, かむ, 紙)');

  assert.deepEqual(failures, [], 'no uncaught page errors');

  await options.evaluate(async () => {
    await chrome.storage.local.set({ 'w:ネコ': 'learning', 'w:ねこ': 'known' });
    await chrome.storage.local.remove('statusKeysOf');
  });
  const cdp = await context.newCDPSession(options);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'wordKeys', words: [] }));
  await options.evaluate(() => new Promise<void>((resolve, reject) => {
    const check = async (tries: number) => {
      if ((await chrome.storage.local.get('statusKeysOf')).statusKeysOf) resolve();
      else if (tries) setTimeout(() => check(tries - 1), 100);
      else reject(new Error('the service worker start did not move the statuses'));
    };
    check(100);
  }));
  assert.deepEqual(await options.evaluate(async () => Object.fromEntries(Object.entries(await chrome.storage.local.get(null))
    .filter(([key]) => key.startsWith('w:')))), { 'w:猫': 'known', 'w:ネコ科': 'known' });
  console.log('a service worker start with no marker moves w:ネコ and w:ねこ to w:猫');
  console.log('SPELLING PASS');
} finally {
  await context.close();
  site.close();
  anki.server.close();
}
