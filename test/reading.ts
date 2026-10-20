import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at } from '../src/parse.ts';
import { launch, listen, makeDictionary, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-reading-'));
useCjkFonts(work);

const terms = makeDictionary(join(work, 'terms.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)', '同義: 子猫'], 2, ''],
  ['子猫', 'こねこ', 'n', '', 100, ['小さい猫'], 4, ''],
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
  res.end('<!doctype html><meta charset="utf-8"><title>reading</title><body><p id="line">猫が魚を食べなかった。</p>'
    + '<p id="wrap" style="width: 6em; font-size: 20px; line-height: 1.2">猫が魚を食べた。猫が魚を食べた。猫が魚を食べた。</p></body>');
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/page`;

const ankiNotes: unknown[] = [];
const ankiReplies: Record<string, (params: unknown) => unknown> = {
  createDeck: () => 1,
  modelNames: () => [],
  createModel: () => ({}),
  addNote: params => ankiNotes.push(at(params, 'note')),
};
const anki = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const request: unknown = JSON.parse(body);
    const reply = ankiReplies[String(at(request, 'action'))];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply ? { result: reply(at(request, 'params')), error: null } : { result: null, error: 'unknown action' }));
  });
});
await listen(anki, 8765);

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
  for (const [file, message] of [[terms, 'Imported Fixture: 4 terms'], [ranks, 'Imported Ranks: 0 terms, 3 frequency and pitch entries'],
    [pitches, 'Imported Pitches: 0 terms, 3 frequency and pitch entries']]) {
    await options.setInputFiles('#dict-file', file ?? '');
    await options.locator('#dict-status', { hasText: message ?? '' }).waitFor();
  }
  assert.deepEqual(await options.$$eval('#dict-list li', (items: HTMLElement[]) => items.map(li => li.innerText.split('\n')[1])), [
    '4 terms', '1 terms', '0 terms, 3 frequency and pitch entries', '0 terms, 3 frequency and pitch entries',
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

  await tab.keyboard.press('Escape');
  const other = await context.newPage();
  await other.goto(pageUrl);
  await other.waitForSelector('#line .ml-word[data-ml-lemma="猫"]');
  await tab.bringToFront();
  await tab.keyboard.press('Alt+Shift+D');
  const toast = tab.locator('minerr-popup .toast');
  await toast.filter({ hasText: 'Minerr is off for 127.0.0.1. Press Alt+Shift+D to turn it on.' }).waitFor();
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('disabledSites')), { disabledSites: ['127.0.0.1'] });
  await toast.waitFor({ state: 'hidden', timeout: 4000 });
  await other.waitForFunction(() => document.documentElement.hasAttribute('data-minerr-off'));
  assert.equal(await tab.$eval('#line .ml-word[data-ml-lemma="猫"]', word => getComputedStyle(word).textDecorationLine), 'none');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await tab.waitForTimeout(500);
  assert.equal(await popup.isVisible(), false, 'a site that is off opens no popup');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, pageUrl);
  const action = await context.newPage();
  await action.goto(`chrome-extension://${extensionId}/action.html?tab=${tabId}`);
  assert.equal(await action.innerText('#site-toggle'), 'Minerr on this site\nAlt+Shift+D on 127.0.0.1');
  assert.equal(await action.isChecked('#site'), false);
  await action.click('#site-toggle');
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-minerr-off'));
  assert.equal(await action.isChecked('#site'), true);
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('disabledSites')), { disabledSites: [] });
  const optionsTabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, options.url());
  assert.equal(typeof optionsTabId, 'number');
  await action.goto(`chrome-extension://${extensionId}/action.html?tab=${optionsTabId}`);
  await action.locator('#server').filter({ hasNotText: 'Checking' }).waitFor();
  assert.equal(await action.isVisible('#site-toggle'), false, 'an extension page gets no site switch');
  await action.close();
  console.log('per site: Alt+Shift+D turns this site off in all its tabs; the toolbar switch turns it on');

  const furigana = async (mode: string) => {
    await options.click(`label:has(input[name="furigana"][value="${mode}"])`);
    await tab.waitForFunction(value => (document.documentElement.dataset.mlFurigana ?? 'off') === value, mode);
  };
  const readings = () => tab.$$eval('#line .ml-word', spans => spans.map(span => `${span.textContent}:${getComputedStyle(span, '::before').content}`));
  assert.deepEqual(await readings(), ['猫:none', '魚:none', '食べなかった:none']);
  await furigana('all');
  assert.deepEqual(await readings(), ['猫:"ねこ"', '魚:"さかな"', '食べなかった:"たべなかった"']);
  assert.equal(await tab.textContent('#line'), '猫が魚を食べなかった。');
  const lines = await tab.$$eval('#wrap .ml-word', spans => spans.map(span => {
    const { top, bottom } = span.getBoundingClientRect();
    const style = getComputedStyle(span);
    const reading = parseFloat(getComputedStyle(span, '::before').fontSize) * 1.1;
    return { top, bottom, room: parseFloat(style.paddingTop) - reading };
  }));
  const rows = [...new Set(lines.map(line => Math.round(line.bottom)))].sort((a, b) => a - b);
  assert.ok(rows.length >= 3, `the paragraph wraps: ${rows.length} lines`);
  assert.ok(lines.every(line => line.room >= 0), 'the top padding of each word holds its reading');
  for (const [i, row] of rows.slice(1).entries()) {
    const above = rows[i] ?? 0;
    const tops = lines.filter(line => Math.round(line.bottom) === row).map(line => line.top);
    assert.ok(Math.min(...tops) >= above - 0.5, `line ${i + 2}: the readings start below line ${i + 1}`);
  }
  await tab.screenshot({ path: join(work, 'furigana-all.png') });
  await options.evaluate(() => chrome.storage.local.set({ 'w:猫': 'known' }));
  await tab.waitForSelector('#line .ml-word.ml-known[data-ml-lemma="猫"]');
  await furigana('unknown');
  assert.deepEqual(await readings(), ['猫:none', '魚:"さかな"', '食べなかった:"たべなかった"']);
  await furigana('hover');
  await tab.mouse.move(0, 0);
  assert.deepEqual(await readings(), ['猫:none', '魚:none', '食べなかった:none']);
  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  assert.deepEqual(await readings(), ['猫:none', '魚:"さかな"', '食べなかった:none']);
  await furigana('off');
  assert.deepEqual(await readings(), ['猫:none', '魚:none', '食べなかった:none']);
  await options.evaluate(() => chrome.storage.local.remove('w:猫'));
  await tab.keyboard.press('Escape');
  console.log('furigana: all words, unknown words, on hover, and off; the readings never cover the line above; saved', join(work, 'furigana-all.png'));

  const colors = () => tab.$$eval('#line .ml-word', spans => spans.map(span => `${span.textContent}:${span.dataset.mlPitch}:${getComputedStyle(span).color}`));
  await options.check('#pitch-colors');
  await tab.waitForFunction(() => document.querySelectorAll('#line .ml-word[data-ml-pitch]').length === 3);
  assert.deepEqual(await colors(), ['猫:atamadaka:rgb(229, 72, 77)', '魚:heiban:rgb(74, 134, 232)', '食べなかった:nakadaka:rgb(240, 140, 0)']);
  await tab.evaluate(() => document.body.append(Object.assign(document.createElement('p'), { id: 'late', textContent: '雨が降る。' })));
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('#late .ml-word[data-ml-lemma="雨"]')?.dataset.mlPitch === 'none');
  await options.uncheck('#pitch-colors');
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-ml-pitch-colors'));
  assert.deepEqual(await colors(), ['猫:atamadaka:rgb(0, 0, 0)', '魚:heiban:rgb(0, 0, 0)', '食べなかった:nakadaka:rgb(0, 0, 0)']);
  console.log('pitch colors: words colored by pattern, new words too, and back to the page color when off');

  const sentence = () => tab.evaluate(() => [...(CSS.highlights.get('minerr-sentence') ?? [])].map(range => range.toString()));
  await tab.mouse.move(0, 0);
  await tab.hover('#wrap .ml-word[data-ml-lemma="魚"] >> nth=1');
  assert.deepEqual(await sentence(), ['猫が魚を食べた。']);
  assert.equal(await tab.evaluate(() => {
    const range = [...(CSS.highlights.get('minerr-sentence') ?? [])][0];
    return [...document.querySelectorAll('#wrap .ml-word')].filter(span => range instanceof Range && range.intersectsNode(span)).map(span => span.textContent).join();
  }), '猫,魚,食べた');
  await popup.locator('.lemma', { hasText: '魚' }).waitFor();
  assert.equal(await popup.locator('.surface').innerText(), 'Appears 4 times on this page');
  await tab.screenshot({ path: join(work, 'sentence.png') });
  await tab.hover('minerr-popup .popup .definitions');
  assert.deepEqual(await sentence(), ['猫が魚を食べた。'], 'the sentence of the popup word stays while the mouse is on the popup');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  assert.deepEqual(await sentence(), ['猫が魚を食べなかった。']);
  await popup.locator('.lemma', { hasText: '食べる' }).waitFor();
  assert.equal(await popup.locator('.surface').innerText(), 'On the page: 食べなかった · Appears 4 times on this page');
  await tab.mouse.move(0, 0);
  await tab.hover('#late .ml-word[data-ml-lemma="雨"]');
  await popup.locator('.lemma', { hasText: '雨' }).waitFor();
  assert.equal(await popup.locator('.surface').innerText(), 'Appears 1 time on this page');
  await tab.keyboard.press('Escape');
  await tab.keyboard.press('Alt+Shift+S');
  await toast.filter({ hasText: 'Sentence highlight off.' }).waitFor();
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('sentenceHighlight')), { sentenceHighlight: false });
  assert.equal(await options.isChecked('#sentence-highlight'), false);
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="猫"]');
  assert.deepEqual(await sentence(), []);
  await tab.keyboard.press('Alt+Shift+S');
  await toast.filter({ hasText: 'Sentence highlight on.' }).waitFor();
  await tab.waitForFunction(() => CSS.highlights.get('minerr-sentence')?.size === 1);
  assert.deepEqual(await sentence(), ['猫が魚を食べなかった。']);
  await tab.keyboard.press('Escape');
  console.log('sentence highlight: the sentence of the hovered or popup word; Alt+Shift+S turns it off and on; popup shows the count on the page; saved', join(work, 'sentence.png'));

  await tab.evaluate(() => {
    const big = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'big' }));
    for (let i = 0; i < 4000; i++) big.append('猫が魚を食べた。', document.createElement('br'));
  });
  await tab.waitForFunction(() => document.querySelectorAll('#big .ml-word').length >= 12000, null, { timeout: 60000 });
  const hoverTimes = await tab.evaluate(() => {
    const block = document.querySelector('#big');
    const walker = document.createTreeWalker(block ?? document.body, NodeFilter.SHOW_TEXT);
    let textNodes = 0;
    while (walker.nextNode()) textNodes++;
    const spans = [...document.querySelectorAll<HTMLElement>('#big .ml-word')].slice(-10);
    const times = spans.map(span => {
      const start = performance.now();
      span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return performance.now() - start;
    });
    return { textNodes, times, sentence: [...(CSS.highlights.get('minerr-sentence') ?? [])].map(range => range.toString()) };
  });
  console.log('sentence highlight in a block of', hoverTimes.textNodes, 'text nodes: hover ms', hoverTimes.times.map(t => t.toFixed(2)).join(' '));
  assert.ok(hoverTimes.textNodes >= 20000);
  assert.deepEqual(hoverTimes.sentence, ['猫が魚を食べた。']);
  const median = [...hoverTimes.times].sort((a, b) => a - b)[5] ?? Infinity;
  assert.ok(median < 1, `a hover in a big block walks only its sentence: median ${median} ms`);
  await tab.evaluate(() => document.querySelector('#big')?.remove());
  await tab.mouse.move(0, 0);
  await tab.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="ruby-line"><ruby>猫<rp>（</rp><rt>ねこ。</rt><rp>）</rp></ruby>が魚を食べた。</p>'));
  await tab.hover('#ruby-line .ml-word[data-ml-lemma="魚"]');
  assert.deepEqual(await sentence(), ['猫（ねこ。）が魚を食べた。'], 'the 。 of a reading in <rt> does not end the sentence');
  await tab.mouse.move(0, 0);
  await tab.keyboard.press('Escape');
  await tab.evaluate(() => document.querySelector('#ruby-line')?.remove());
  console.log('sentence highlight: the walk stays in the sentence of a big block, and skips ruby text');

  const select = (from: string, to: string) => tab.evaluate(([start, end]) => {
    const range = new Range();
    range.setStartBefore(document.querySelector(start ?? '') ?? document.body);
    range.setEndAfter(document.querySelector(end ?? '') ?? document.body);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, [from, to]);
  const statuses = () => tab.$$eval('#line .ml-word', spans => spans.map(span => `${span.textContent}:${span.className.replace('ml-word ml-', '')}`));
  await tab.mouse.move(0, 0);
  await select('#line .ml-word[data-ml-lemma="猫"]', '#line .ml-word[data-ml-lemma="魚"]');
  await tab.keyboard.press('3');
  await toast.filter({ hasText: 'Marked 2 words as known.' }).waitFor();
  await tab.waitForSelector('#line .ml-word.ml-known[data-ml-lemma="魚"]');
  assert.deepEqual(await statuses(), ['猫:known', '魚:known', '食べなかった:unknown']);
  assert.equal(await popup.isVisible(), false);
  await tab.keyboard.press('1');
  await toast.filter({ hasText: 'Marked 2 words as unknown.' }).waitFor();
  await tab.waitForSelector('#line .ml-word.ml-unknown[data-ml-lemma="魚"]');
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get(['w:猫', 'w:魚'])), {});
  await select('#line .ml-word[data-ml-lemma="食べる"]', '#line .ml-word[data-ml-lemma="食べる"]');
  await tab.keyboard.press('4');
  await toast.filter({ hasText: 'Marked 1 word as ignored.' }).waitFor();
  await tab.waitForSelector('#line .ml-word.ml-ignored[data-ml-lemma="食べる"]');
  assert.equal(await tab.$$eval('#wrap .ml-word.ml-ignored', spans => spans.length), 3, 'the same lemma elsewhere on the page changes too');
  await options.evaluate(() => chrome.storage.local.remove('w:食べる'));
  await tab.evaluate(() => getSelection()?.removeAllRanges());
  console.log('bulk status: a status key sets every word of the selection, with a short confirmation');

  await tab.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { className: 'minerr-subs-line', textContent: '猫が魚を食べた' })));
  await tab.waitForSelector('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]');
  const lemma = popup.locator('.lemma');
  for (const word of ['猫', '魚', '食べる', '猫']) {
    await tab.keyboard.press('n');
    await lemma.filter({ hasText: word }).waitFor();
    assert.equal(await tab.$eval('.ml-word[data-ml-active]', span => span.closest('.minerr-subs-line') !== null), true);
  }
  console.log('N: the popup cycles through the unknown words of the subtitle line');
  await tab.keyboard.press('Escape');
  await tab.keyboard.press('2');
  await tab.waitForTimeout(200);
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get(['w:猫', 'w:魚', 'w:食べる'])), {},
    'with three unknown words in the line, a status key does nothing');
  await options.evaluate(() => chrome.storage.local.set({ 'w:猫': 'known', 'w:魚': 'known' }));
  await tab.waitForSelector('.minerr-subs-line .ml-word.ml-known[data-ml-lemma="魚"]');
  await tab.keyboard.press('2');
  await toast.filter({ hasText: 'Marked 食べる as learning.' }).waitFor();
  await tab.waitForSelector('.minerr-subs-line .ml-word.ml-learning[data-ml-lemma="食べる"]');
  assert.equal(await popup.isVisible(), false);
  await tab.keyboard.press('n');
  await tab.waitForTimeout(300);
  assert.equal(await popup.isVisible(), false, 'N with no unknown word in the line opens no popup');
  await options.evaluate(() => chrome.storage.local.remove(['w:猫', 'w:魚', 'w:食べる']));
  console.log('subtitle line with one unknown word: a status key sets it with no popup');
  await tab.evaluate(() => {
    const host = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'shadow-field' }));
    host.attachShadow({ mode: 'open' }).append(document.createElement('input'));
  });
  const field = tab.locator('#shadow-field input');
  await field.focus();
  await tab.keyboard.type('n');
  assert.equal(await field.inputValue(), 'n', 'a key in a field in a shadow root goes to the field');
  assert.equal(await popup.isVisible(), false);
  await field.blur();
  console.log('a field in a shadow root: the page keys do not fire there');

  const popups = tab.locator('minerr-popup .popup');
  const lemmas = () => popups.locator('.lemma').allTextContents();
  const shiftHover = async (popupIndex: number, word: string) => {
    const span = popups.nth(popupIndex).locator(`.definitions .ml-word[data-ml-lemma="${word}"]`);
    await span.waitFor();
    await tab.keyboard.down('Shift');
    await span.hover();
    await tab.keyboard.up('Shift');
  };
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="猫"]');
  await popups.locator('.lemma', { hasText: '猫' }).waitFor();
  await popups.locator('.definitions .ml-word[data-ml-lemma="子猫"]').hover();
  await tab.waitForTimeout(500);
  assert.deepEqual(await lemmas(), ['猫'], 'plain hover on a word in a popup opens no popup');
  await shiftHover(0, '子猫');
  await popups.nth(1).locator('.lemma', { hasText: '子猫' }).waitFor();
  await shiftHover(1, '猫');
  await popups.nth(2).locator('.lemma', { hasText: '猫' }).waitFor();
  await shiftHover(2, '子猫');
  await popups.nth(3).locator('.lemma', { hasText: '子猫' }).waitFor();
  assert.deepEqual(await lemmas(), ['猫', '子猫', '猫', '子猫']);
  assert.equal(await popups.nth(3).locator('.ml-word').count(), 0, 'the fourth popup has no words to open a fifth');
  await tab.screenshot({ path: join(work, 'nested.png') });
  await tab.keyboard.press('Escape');
  assert.deepEqual(await lemmas(), ['猫', '子猫', '猫']);
  await tab.keyboard.press('2');
  await popups.nth(2).locator('button[aria-pressed="true"]', { hasText: 'Learning' }).waitFor();
  assert.equal(await popups.nth(1).locator('.definitions .ml-word[data-ml-lemma="猫"]').getAttribute('class'), 'ml-word ml-learning',
    'a status key sets the word of the top popup, and the words in the popups follow');
  await options.evaluate(() => chrome.storage.local.remove('w:猫'));
  await popups.nth(0).locator('.definitions').click();
  assert.deepEqual(await lemmas(), ['猫'], 'a click in a popup closes the popups over it');
  await tab.keyboard.press('Escape');
  assert.deepEqual(await lemmas(), []);
  console.log('nested popups: Shift + hover on a word in a popup opens a popup over it, up to 4; Esc closes the top one; saved', join(work, 'nested.png'));

  const lookUp = async (from: string, offset: number, length: number) => {
    await tab.evaluate(([selector, start, count]) => {
      const text = document.querySelector(String(selector))?.firstChild;
      const range = new Range();
      if (!text) throw new Error(`no text in ${selector}`);
      range.setStart(text, Number(start));
      range.setEnd(text, Number(start) + Number(count));
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }, [from, offset, length]);
    await tab.keyboard.press('Alt+S');
  };
  await lookUp('#line .ml-word[data-ml-lemma="食べる"]', 0, 6);
  await popups.locator('.lemma', { hasText: '食べる' }).waitFor();
  assert.equal(await popups.locator('.surface').innerText(), 'On the page: 食べなかった · Appears 5 times on this page');
  await tab.keyboard.press('Escape');
  await lookUp('#line .ml-word[data-ml-lemma="食べる"]', 0, 4);
  await popups.locator('.surface', { hasText: 'On the page: 食べ ·' }).waitFor();
  assert.deepEqual(await lemmas(), ['食べる'], 'the longest dictionary word at the start of 食べなか is 食べ, the verb 食べる');
  await tab.keyboard.press('Escape');
  await select('#line .ml-word[data-ml-lemma="猫"]', '#line .ml-word[data-ml-lemma="魚"]');
  await tab.keyboard.press('Alt+S');
  await popups.locator('.lemma', { hasText: '猫' }).waitFor();
  assert.equal(await tab.evaluate(() => getSelection()?.toString()), '', 'Alt+S clears the selection when it opens the popup');
  await tab.keyboard.press('3');
  await popups.locator('button[aria-pressed="true"]', { hasText: 'Known' }).waitFor();
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get(['w:猫', 'w:魚'])), { 'w:猫': 'known' },
    'after Alt+S, a status key sets the popup word, not the words of the selection');
  await options.evaluate(() => chrome.storage.local.remove('w:猫'));
  await tab.keyboard.press('Escape');
  await lookUp('#line .ml-word[data-ml-lemma="魚"]', 0, 1);
  await popups.locator('.lemma', { hasText: '魚' }).waitFor();
  await tab.keyboard.press('a');
  await popups.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.equal(at(ankiNotes.at(-1), 'fields', 'Sentence'), '猫が<b>魚</b>を食べなかった。');
  await tab.keyboard.press('Escape');
  await tab.evaluate(() => document.body.append(Object.assign(document.createElement('p'), { id: 'plain', textContent: 'xyz 猫が好き' })));
  await tab.waitForSelector('#plain .ml-word');
  await tab.evaluate(() => {
    const range = new Range();
    const text = document.querySelector('#plain')?.firstChild;
    if (!text) throw new Error('no text');
    range.setStart(text, 0);
    range.setEnd(text, 3);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  await tab.keyboard.press('Alt+S');
  await toast.filter({ hasText: 'No dictionary entry for xyz.' }).waitFor();
  await tab.evaluate(() => getSelection()?.removeAllRanges());
  console.log('Alt+S: the longest dictionary word at the start of the selection, with the card sentence around it');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('READING E2E PASS');
} finally {
  await context.close();
  site.close();
  anki.close();
}
