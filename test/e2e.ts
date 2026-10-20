import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator } from 'playwright';
import { at } from '../src/parse.ts';
import { messageOf } from '../src/rpc.ts';
import { extension, launch, listen, makeDictionary } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-e2e-'));

const fixture = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', '1 v1 vt', 'v1', 100, [{ type: 'structured-content', content: { tag: 'ul', content: [{ tag: 'li', content: 'to eat (fixture)' }] } }], 1, '⭐ ichi'],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
], [
  ['⭐', 'popular', -10, 'high priority term', 10],
  ['v1', 'partOfSpeech', -3, 'Ichidan verb', 0],
  ['vt', 'partOfSpeech', -3, 'transitive verb', 0],
  ['n', 'partOfSpeech', -3, 'noun', 0],
]);

const ankiRequests: unknown[] = [];
const ankiReplies: Record<string, (params: unknown) => unknown> = {
  createDeck: () => 1,
  modelNames: () => ['Basic'],
  createModel: () => ({}),
  addNote: () => 1700000000000 + ankiRequests.length,
  findNotes: () => [11],
  notesInfo: () => [{ noteId: 11, fields: { Word: { value: '<span>猫</span>&nbsp;', order: 0 } } }],
  version: () => 6,
};
const anki = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const request: unknown = JSON.parse(body);
    ankiRequests.push(request);
    res.setHeader('Content-Type', 'application/json');
    let reply: { result: unknown; error: string | null };
    try {
      const action = at(request, 'action');
      const handler = typeof action === 'string' ? ankiReplies[action] : undefined;
      if (!handler) throw new Error(`The mock has no action ${String(action)}`);
      reply = { result: handler(at(request, 'params')), error: null };
    } catch (error) {
      reply = { result: null, error: messageOf(error) };
    }
    res.end(JSON.stringify(reply));
  });
});
await listen(anki, 8765);

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><body><p id="line">猫が魚を食べなかった。</p><div id="subs"></div></body>');
});
const sitePort = await listen(site, 0);
const pageUrl = `http://127.0.0.1:${sitePort}/watch`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  console.log('extension loaded from', extension);

  // A database from before tags: version 1, no tags store, a term row without tag fields.
  await worker.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('minerr', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('dicts', { keyPath: 'title' });
      const terms = request.result.createObjectStore('terms', { keyPath: ['dict', 'id'] });
      terms.createIndex('expression', 'expression');
      terms.createIndex('reading', 'reading');
    };
    request.onsuccess = () => {
      const tx = request.result.transaction(['dicts', 'terms'], 'readwrite');
      tx.objectStore('dicts').put({ title: 'Old', revision: '1', count: 1 });
      tx.objectStore('terms').put({ dict: 'Old', id: 0, expression: '好き', reading: 'すき', glossary: ['to like (old import)'], score: 1 });
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }));

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', fixture);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  const imported = await options.textContent('#dict-status');
  console.log('options import status:', imported);
  assert.equal(imported, 'Imported Fixture: 3 terms');
  assert.deepEqual(await options.$$eval('#dict-list li', (items: HTMLElement[]) => items.map(li => li.innerText.split('\n'))), [
    ['Fixture', '3 terms', 'Delete'],
    ['Old', '1 terms. Import again to show tags.', 'Delete'],
  ]);

  const tab = await context.newPage();
  await tab.goto(pageUrl);
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="食べる"]', { timeout: 20000 });
  const words = await tab.$$eval('#line .ml-word', spans => spans.map(s => `${s.textContent}=${s.dataset.mlLemma} ${s.className}`));
  console.log('page words:', words);
  assert.deepEqual(words, ['猫=猫 ml-word ml-unknown', '魚=魚 ml-word ml-unknown', '食べなかった=食べる ml-word ml-unknown']);
  assert.equal(await tab.textContent('#line'), '猫が魚を食べなかった。');

  await tab.evaluate(() => {
    const line = document.createElement('div');
    line.className = 'caption';
    line.textContent = '猫が好きです';
    const subs = document.querySelector('#subs');
    if (!subs) throw new Error('The page has no #subs');
    subs.append(line);
  });
  await tab.waitForSelector('.caption .ml-word[data-ml-lemma="猫"]');
  const late = await tab.$$eval('.caption .ml-word', spans => spans.map(s => s.dataset.mlLemma));
  console.log('late subtitle words:', late);
  assert.deepEqual(late, ['猫', '好き']);

  const other = await context.newPage();
  await other.goto(pageUrl);
  await other.waitForSelector('#line .ml-word[data-ml-lemma="食べる"].ml-unknown');

  await tab.bringToFront();
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  const popup = tab.locator('minerr-popup .popup');
  await popup.locator('li').first().waitFor();
  const popupText = await popup.innerText();
  console.log('popup text:', JSON.stringify(popupText));
  assert.match(popupText, /^食べる\s*たべる/);
  assert.equal(await popup.locator('li').first().innerText(), 'v1 vt to eat (fixture)\nFixture');
  const chips = (locator: Locator) => locator.locator('.tag')
    .evaluateAll((tags: HTMLElement[]) => tags.map(tag => [tag.textContent, tag.className, tag.title]));
  assert.deepEqual(await chips(popup.locator('header')), [
    ['⭐', 'tag tag-popular', 'high priority term'],
    ['ichi', 'tag', ''],
  ]);
  assert.deepEqual(await chips(popup.locator('li').first()), [
    ['v1', 'tag tag-partOfSpeech', 'Ichidan verb'],
    ['vt', 'tag tag-partOfSpeech', 'transitive verb'],
  ]);

  await tab.keyboard.press('3');
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="食べる"].ml-known');
  await other.waitForSelector('#line .ml-word[data-ml-lemma="食べる"].ml-known', { timeout: 5000 });
  assert.equal(await popup.locator('button[aria-pressed="true"]').innerText(), 'Known 3');
  console.log('after key 3: known in this tab and in the second tab');

  await popup.locator('button.close').click();
  await popup.waitFor({ state: 'hidden' });
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('button.off').click();
  await popup.waitFor({ state: 'hidden' });
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('enabled')), { enabled: false });
  await other.waitForFunction(() => document.documentElement.hasAttribute('data-minerr-off'));
  const offWord = '#line .ml-word[data-ml-lemma="食べる"]';
  assert.equal(await tab.$eval(offWord, el => getComputedStyle(el).textDecorationLine), 'none');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="猫"]');
  await tab.waitForTimeout(500);
  assert.equal(await popup.isVisible(), false);
  console.log('turned off: no underline, no popup, in both tabs');
  await options.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-minerr-off'));
  assert.equal(await tab.$eval(offWord, el => getComputedStyle(el).textDecorationLine), 'underline');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('li').first().waitFor();
  console.log('turned on again: underline and popup back');

  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const actions = ankiRequests.map(r => at(r, 'action'));
  console.log('AnkiConnect actions:', actions);
  assert.deepEqual(actions, ['createDeck', 'modelNames', 'createModel', 'addNote']);
  assert.ok(ankiRequests.every(r => at(r, 'version') === 6));
  assert.deepEqual(at(ankiRequests[0], 'params'), { deck: 'Minerr' });
  assert.equal(at(ankiRequests[2], 'params', 'modelName'), 'Minerr');
  assert.deepEqual(at(ankiRequests[2], 'params', 'inOrderFields'), ['Word', 'Reading', 'Sentence', 'Definition', 'Image']);
  const note = at(ankiRequests[3], 'params', 'note');
  const picture = at(note, 'picture', 0);
  const data = at(picture, 'data');
  assert.ok(typeof data === 'string', 'picture data is a string');
  console.log('addNote fields:', at(note, 'fields'), 'picture:', at(picture, 'filename'), at(picture, 'fields'), `${data.length} base64 chars`);
  assert.equal(at(note, 'deckName'), 'Minerr');
  assert.equal(at(note, 'modelName'), 'Minerr');
  assert.deepEqual(at(note, 'fields'), {
    Word: '食べる',
    Reading: 'たべる',
    Sentence: '猫が魚を<b>食べなかった</b>。',
    Definition: '<div class="tags"><span class="tag tag-popular" title="high priority term">⭐</span> <span class="tag" title="">ichi</span></div>'
      + '<ol><li><span class="tag tag-partOfSpeech" title="Ichidan verb">v1</span> <span class="tag tag-partOfSpeech" title="transitive verb">vt</span>'
      + ' to eat (fixture)<span class="dict">Fixture</span></li></ol>',
    Image: '',
  });
  assert.deepEqual(at(picture, 'fields'), ['Image']);
  assert.ok(data.startsWith('/9j/'), 'picture is base64 JPEG');
  writeFileSync(join(work, 'card.jpg'), Buffer.from(data, 'base64'));
  console.log('card screenshot saved to', join(work, 'card.jpg'));

  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await tab.keyboard.press('a');
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="魚"].ml-learning');
  assert.equal(at(ankiRequests.at(-1), 'params', 'note', 'fields', 'Sentence'), '猫が<b>魚</b>を食べなかった。');
  console.log('hotkey A on unknown 魚: card added, status now learning');

  await tab.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });

  await options.bringToFront();
  await options.click('#known-import');
  await options.waitForFunction(() => document.querySelector('#known-status')?.textContent?.startsWith('Marked'));
  assert.equal(await options.textContent('#known-status'), 'Marked 1 words as known.');
  assert.deepEqual(at(ankiRequests.find(r => at(r, 'action') === 'findNotes'), 'params'), { query: 'deck:"Minerr" prop:ivl>=21' });
  await other.waitForSelector('.ml-word[data-ml-lemma="猫"].ml-known');
  console.log('import known from Anki: 猫 known in open tab');

  await options.click('#anki-check');
  await options.waitForFunction(() => document.querySelector('#anki-status')?.textContent?.startsWith('Connected'));
  assert.equal(await options.textContent('#anki-status'), 'Connected (AnkiConnect version 6)');
  assert.equal(at(ankiRequests.at(-1), 'action'), 'version');
  console.log('check connection:', await options.textContent('#anki-status'));

  const created = at(ankiRequests[2], 'params');
  const Front = at(created, 'cardTemplates', 0, 'Front');
  const Back = at(created, 'cardTemplates', 0, 'Back');
  let storedTemplates: unknown = { Recognition: { Front: 'old front', Back: 'old back' } };
  let storedCss: unknown = 'old css';
  ankiReplies.modelNames = () => ['Basic', 'Minerr'];
  ankiReplies.modelTemplates = () => storedTemplates;
  ankiReplies.modelStyling = () => ({ css: storedCss });
  ankiReplies.updateModelTemplates = params => { storedTemplates = at(params, 'model', 'templates'); return null; };
  ankiReplies.updateModelStyling = params => { storedCss = at(params, 'model', 'css'); return null; };
  const cdp = await context.newCDPSession(tab);
  await cdp.send('ServiceWorker.enable');
  const addAfterRestart = async () => {
    await cdp.send('ServiceWorker.stopAllWorkers');
    // A restarted worker forgets its capture spacing; Chrome allows two captures per second.
    await tab.waitForTimeout(1100);
    await tab.bringToFront();
    await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
    await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
    await popup.locator('.lemma', { hasText: '食べる' }).waitFor();
    const sent = ankiRequests.length;
    await tab.keyboard.press('a');
    await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
    return ankiRequests.slice(sent);
  };

  const stale = await addAfterRestart();
  const staleActions = stale.map(r => at(r, 'action')).sort();
  console.log('AnkiConnect actions after a restart with an old note type:', staleActions);
  assert.deepEqual(staleActions, ['addNote', 'createDeck', 'modelNames', 'modelStyling', 'modelTemplates', 'updateModelStyling', 'updateModelTemplates']);
  const templates = at(stale.find(r => at(r, 'action') === 'updateModelTemplates'), 'params', 'model');
  const styling = at(stale.find(r => at(r, 'action') === 'updateModelStyling'), 'params', 'model');
  assert.equal(at(templates, 'name'), 'Minerr');
  assert.deepEqual(at(templates, 'templates'), { Recognition: { Front, Back } });
  assert.equal(at(styling, 'name'), 'Minerr');
  assert.equal(at(styling, 'css'), at(created, 'css'));

  const current = (await addAfterRestart()).map(r => at(r, 'action')).sort();
  console.log('AnkiConnect actions after a restart with the current note type:', current);
  assert.deepEqual(current, ['addNote', 'createDeck', 'modelNames', 'modelStyling', 'modelTemplates']);

  ankiReplies.modelStyling = () => ({ css: 'edited in Anki' });
  ankiReplies.updateModelStyling = () => { throw new Error('Close the affected editor before this API write, even if its content is saved.'); };
  await cdp.send('ServiceWorker.stopAllWorkers');
  await tab.waitForTimeout(1100);
  await tab.bringToFront();
  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('.lemma', { hasText: '食べる' }).waitFor();
  await tab.keyboard.press('a');
  const conflict = popup.locator('.message', { hasText: 'Browse, Add, or Edit window' });
  await conflict.waitFor();
  console.log('popup error with an Anki editor open:', await conflict.textContent());
  ankiReplies.modelStyling = () => ({ css: storedCss });

  await new Promise(resolve => anki.close(resolve));
  anki.closeAllConnections();
  await tab.bringToFront();
  await tab.hover('.caption .ml-word[data-ml-lemma="好き"]');
  await popup.locator('.lemma', { hasText: '好き' }).waitFor();
  assert.equal(await popup.locator('.definitions').innerText(), 'to like (old import)\nOld');
  assert.equal(await popup.locator('.tag').count(), 0);
  console.log('word from a dictionary imported before tags: definition without chips');
  await tab.keyboard.press('a');
  const error = popup.locator('.message.error');
  await error.waitFor();
  console.log('popup error with AnkiConnect down:', await error.innerText());
  assert.match(await error.innerText(), /^AnkiConnect is unreachable at http:\/\/127\.0\.0\.1:8765/);

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('E2E PASS');
} finally {
  await context.close();
  site.close();
  anki.close();
}
