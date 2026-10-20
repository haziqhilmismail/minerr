import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, listen, makeDictionary, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-reading-'));
useCjkFonts(work);

const terms = makeDictionary(join(work, 'terms.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
]);
const ranks = makeDictionary(join(work, 'ranks.zip'), 'Ranks', [], [], [
  ['猫', 'freq', 1200],
  ['魚', 'freq', { reading: 'さかな', frequency: { value: 8000, displayValue: '8000' } }],
  ['魚', 'freq', { reading: 'うお', frequency: 90 }],
]);
const pitches = makeDictionary(join(work, 'pitches.zip'), 'Pitches', [], [], [
  ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 1 }] }],
  ['魚', 'pitch', { reading: 'さかな', pitches: [{ position: 0 }] }],
  ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2 }] }],
]);

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><title>reading</title><body><p id="line">猫が魚を食べなかった。</p></body>');
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/page`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
context.on('console', message => { if (message.type() !== 'log') console.log('browser:', message.text()); });

try {
  // A database from the version before frequencies: version 2 with a dictionary that must survive the upgrade.
  await worker.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('minerr', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('dicts', { keyPath: 'title' });
      const store = db.createObjectStore('terms', { keyPath: ['dict', 'id'] });
      store.createIndex('expression', 'expression');
      store.createIndex('reading', 'reading');
      db.createObjectStore('tags', { keyPath: ['dict', 'name'] });
    };
    request.onsuccess = () => {
      const tx = request.result.transaction(['dicts', 'terms'], 'readwrite');
      tx.objectStore('dicts').put({ title: 'Kept', revision: '1', count: 1, tags: true });
      tx.objectStore('terms').put({ dict: 'Kept', id: 0, expression: '雨', reading: 'あめ', definitionTags: [], termTags: [], glossary: ['rain (kept)'], score: 1 });
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }));

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  for (const [file, message] of [[terms, 'Imported Fixture: 3 terms'], [ranks, 'Imported Ranks: 0 terms, 3 frequency and pitch entries'],
    [pitches, 'Imported Pitches: 0 terms, 3 frequency and pitch entries']]) {
    await options.setInputFiles('#dict-file', file ?? '');
    await options.locator('#dict-status', { hasText: message ?? '' }).waitFor();
  }
  assert.deepEqual(await options.$$eval('#dict-list li', (items: HTMLElement[]) => items.map(li => li.innerText.split('\n')[1])), [
    '3 terms', '1 terms', '0 terms, 3 frequency and pitch entries', '0 terms, 3 frequency and pitch entries',
  ]);
  console.log('import: version 2 dictionary kept, frequency and pitch dictionaries counted');

  const tab = await context.newPage();
  await tab.goto(pageUrl);
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="食べる"]', { timeout: 20000 });
  const popup = tab.locator('minerr-popup .popup');
  const metaOf = async (word: string) => {
    await tab.mouse.move(0, 0);
    await tab.hover(`#line .ml-word[data-ml-lemma="${word}"]`);
    await popup.locator('.lemma', { hasText: word }).waitFor();
    return popup.locator('header .meta').evaluate(row => ({
      stars: row.querySelector('.stars')?.textContent ?? null,
      freq: [...row.querySelectorAll('.freq')].map(item => item.textContent),
      pitch: [...row.querySelectorAll('.pitch')].map(pitch => [pitch.querySelector('.pattern')?.textContent,
        [...pitch.querySelectorAll('.mora')].map(mora => `${mora.textContent}${mora.classList.contains('high') ? '¯' : ''}${mora.classList.contains('drop') ? '＼' : ''}`).join('')]),
    }));
  };
  assert.deepEqual(await metaOf('猫'), { stars: '★★★★★', freq: ['Ranks 1200'], pitch: [['Atamadaka [1]', 'ね¯＼こ']] });
  assert.deepEqual(await metaOf('魚'), { stars: '★★★☆☆', freq: ['Ranks 8000'], pitch: [['Heiban [0]', 'さか¯な¯']] });
  assert.deepEqual(await metaOf('食べる'), { stars: null, freq: [], pitch: [['Nakadaka [2]', 'たべ¯＼る']] });
  await metaOf('猫');
  await tab.screenshot({ path: join(work, 'popup-meta.png') });
  console.log('popup: frequency stars and ranks per reading, pitch accent in marked kana; saved', join(work, 'popup-meta.png'));

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('READING E2E PASS');
} finally {
  await context.close();
  site.close();
}
