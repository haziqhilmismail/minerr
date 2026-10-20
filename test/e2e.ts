import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
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

// The definition HTML of 食べる in the fixture.
const DEFINITION = '<div class="tags"><span class="tag tag-popular" title="high priority term">⭐</span> <span class="tag" title="">ichi</span></div>'
  + '<ol><li><span class="tag tag-partOfSpeech" title="Ichidan verb">v1</span> <span class="tag tag-partOfSpeech" title="transitive verb">vt</span>'
  + ' to eat (fixture)<span class="dict">Fixture</span></li></ol>';

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
  res.end('<!doctype html><meta charset="utf-8"><title>猫 &amp; 魚</title><body><p id="line">猫が魚を食べなかった。</p><div id="subs"></div></body>');
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

  assert.deepEqual(ankiRequests.map(r => at(r, 'action')), ['modelNames'], 'the options page lists the note types');
  const firstAdd = ankiRequests.length;
  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const added = ankiRequests.slice(firstAdd);
  const actions = added.map(r => at(r, 'action'));
  console.log('AnkiConnect actions:', actions);
  assert.deepEqual(actions, ['createDeck', 'modelNames', 'createModel', 'addNote']);
  assert.ok(ankiRequests.every(r => at(r, 'version') === 6));
  assert.deepEqual(at(added[0], 'params'), { deck: 'Minerr' });
  assert.equal(at(added[2], 'params', 'modelName'), 'Minerr');
  assert.deepEqual(at(added[2], 'params', 'inOrderFields'), ['Word', 'Reading', 'Sentence', 'Definition', 'Image']);
  const note = at(added[3], 'params', 'note');
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
    Definition: DEFINITION,
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
  assert.ok(ankiRequests.some(r => at(r, 'action') === 'version'));
  console.log('check connection:', await options.textContent('#anki-status'));

  const background = (page: Page, selector: string) => page.$eval(selector, node => getComputedStyle(node).backgroundColor);
  const [LIGHT_PAGE, DARK_PAGE, DARK_POPUP] = ['rgb(244, 245, 248)', 'rgb(21, 22, 27)', 'rgb(31, 32, 39)'];
  const action = await context.newPage();
  for (const page of [options, action, tab]) await page.emulateMedia({ colorScheme: 'light' });
  await action.goto(`chrome-extension://${extensionId}/action.html`);
  assert.equal(await options.isChecked('input[name="theme"][value="system"]'), true);
  assert.deepEqual([await background(options, 'body'), await background(action, 'body')], [LIGHT_PAGE, LIGHT_PAGE]);
  await options.click('label:has(input[name="theme"][value="dark"])');
  assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('theme')), { theme: 'dark' });
  await action.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.deepEqual([await background(options, 'body'), await background(action, 'body')], [DARK_PAGE, DARK_PAGE]);
  await tab.bringToFront();
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="猫"]');
  await popup.locator('.lemma', { hasText: '猫' }).waitFor();
  assert.equal(await background(tab, 'minerr-popup >> .popup'), DARK_POPUP);
  console.log('theme Dark on a light system: options, toolbar menu and word popup are dark');
  await options.click('label:has(input[name="theme"][value="system"])');
  await tab.waitForFunction(() => document.querySelector('minerr-popup')?.shadowRoot?.querySelector<HTMLElement>('.popup')?.dataset.theme === 'light');
  assert.notEqual(await background(tab, 'minerr-popup >> .popup'), DARK_POPUP);
  assert.equal(await background(options, 'body'), LIGHT_PAGE);
  for (const page of [options, action, tab]) await page.emulateMedia({ colorScheme: 'dark' });
  await options.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await action.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await tab.waitForFunction(() => document.querySelector('minerr-popup')?.shadowRoot?.querySelector<HTMLElement>('.popup')?.dataset.theme === 'dark');
  assert.deepEqual([await background(options, 'body'), await background(action, 'body'), await background(tab, 'minerr-popup >> .popup')],
    [DARK_PAGE, DARK_PAGE, DARK_POPUP]);
  for (const page of [options, action, tab]) await page.emulateMedia({ colorScheme: null });
  await action.close();
  await tab.keyboard.press('Escape');
  console.log('theme System: follows the system color scheme live');

  const hoverMode = async (mode: string) => {
    await options.click(`label:has(input[name="hoverMode"][value="${mode}"])`);
    assert.deepEqual(await options.evaluate(() => chrome.storage.local.get('hoverMode')), { hoverMode: mode });
  };
  const noPopupAfterRest = async (message: string) => {
    await tab.waitForTimeout(500);
    assert.equal(await popup.isVisible(), false, message);
  };
  assert.equal(await options.isChecked('input[name="hoverMode"][value="hover"]'), true);
  await tab.mouse.move(0, 0);
  const fish = await tab.locator('#line .ml-word[data-ml-lemma="魚"]').boundingBox();
  assert.ok(fish, 'the word 魚 has a box');
  await tab.mouse.move(fish.x + fish.width / 2, fish.y + fish.height / 2);
  await tab.mouse.move(0, 0);
  await noPopupAfterRest('hover mode: a quick pass over a word opens no popup');
  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await popup.locator('.lemma', { hasText: '魚' }).waitFor();
  console.log('hover mode: a quick pass opens no popup, a rest opens it');

  await tab.keyboard.press('Escape');
  await hoverMode('unknown');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word.ml-known[data-ml-lemma="食べる"]');
  await noPopupAfterRest('unknown mode: a rest on a known word opens no popup');
  await tab.hover('.caption .ml-word.ml-unknown[data-ml-lemma="好き"]');
  await popup.locator('.lemma', { hasText: '好き' }).waitFor();
  console.log('unknown mode: a rest opens the popup on an unknown word only');

  await tab.keyboard.press('Escape');
  await hoverMode('shift');
  await tab.mouse.move(0, 0);
  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await noPopupAfterRest('shift mode: a rest without Shift opens no popup');
  await tab.keyboard.down('Shift');
  await popup.locator('.lemma', { hasText: '魚' }).waitFor();
  await tab.keyboard.press('Escape');
  await tab.keyboard.up('Shift');
  await tab.mouse.move(0, 0);
  await tab.keyboard.down('Shift');
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('.lemma', { hasText: '食べる' }).waitFor();
  await tab.keyboard.up('Shift');
  await tab.keyboard.press('Escape');
  await hoverMode('hover');
  console.log('shift mode: a rest opens no popup; Shift on a word and Shift + hover open it');

  const created = at(added[2], 'params');
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

  ankiReplies.modelNames = () => ['Basic', 'Minerr', 'Mining'];
  ankiReplies.modelFieldNames = params => (at(params, 'modelName') === 'Mining'
    ? ['Expression', 'ExpressionReading', 'Sentence', 'MainDefinition', 'Picture', 'Notes'] : ['Front', 'Back']);
  ankiReplies.storeMediaFile = () => 'minerr-stored.jpg';
  const saved = options.locator('#note-type-status', { hasText: /^Saved$/ });
  const storedNoteType = async () => at(await options.evaluate(() => chrome.storage.local.get('noteType')), 'noteType');
  await options.bringToFront();
  await options.click('#anki-check');
  await options.locator('#note-type option[value="Mining"]').waitFor({ state: 'attached' });
  assert.deepEqual(await options.$$eval('#note-type option', items => items.map(item => item.textContent)), ['Minerr (built-in)', 'Basic', 'Mining']);
  await options.selectOption('#note-type', 'Mining');
  await saved.waitFor();
  assert.deepEqual(await storedNoteType(), { kind: 'custom', model: 'Mining', fields: {
    Expression: '{word}', ExpressionReading: '{reading}', Sentence: '{sentence}', MainDefinition: '{definition}', Picture: '{image}', Notes: '',
  } });
  assert.equal(await options.inputValue('#known-field'), 'Expression');
  const notesField = options.getByLabel('Notes', { exact: true });
  await notesField.fill('{title} {nope}');
  await options.locator('#field-rows .error', { hasText: 'Unknown marker {nope}.' }).waitFor();
  assert.equal(await options.textContent('#note-type-status'), 'Not saved. Correct the unknown markers.');
  assert.equal(at(await storedNoteType(), 'fields', 'Notes'), '');
  await notesField.fill('<a href="{url}">{title}</a> {furigana}');
  await saved.waitFor();
  assert.equal(at(await storedNoteType(), 'fields', 'Notes'), '<a href="{url}">{title}</a> {furigana}');
  const preview = Object.fromEntries(await options.$$eval('#preview-rows tr', rows => rows.map(row => [row.querySelector('th')?.textContent, row.querySelector('td')?.innerHTML])));
  console.log('note type preview:', preview);
  assert.match(preview.Picture, /^<img src="data:image\/svg\+xml,[^"]+" alt="">$/);
  assert.deepEqual({ ...preview, Picture: '' }, {
    Expression: '食べる', ExpressionReading: 'たべる', Sentence: '猫が魚を<b>食べなかった</b>。', Picture: '',
    MainDefinition: '<div class="tags"><span class="tag tag-popular" title="high priority term">⭐</span></div><ol>'
      + '<li><span class="tag tag-partOfSpeech" title="Ichidan verb">v1</span> to eat</li>'
      + '<li>to live on (e.g. a salary)<br>to make a living<span class="dict">JMdict</span></li></ol>',
    Notes: '<a href="https://www.youtube.com/watch?v=sample">Sample video</a> 食べる[たべる]',
  });

  const addTaberu = async () => {
    await tab.bringToFront();
    await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
    await popup.locator('.lemma', { hasText: '魚' }).waitFor();
    await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
    await popup.locator('.lemma', { hasText: '食べる' }).waitFor();
    const sent = ankiRequests.length;
    await tab.keyboard.press('a');
    await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
    return ankiRequests.slice(sent);
  };
  const custom = await addTaberu();
  console.log('AnkiConnect actions with a custom note type:', custom.map(r => at(r, 'action')));
  assert.deepEqual(custom.map(r => at(r, 'action')), ['createDeck', 'storeMediaFile', 'addNote']);
  const media = at(custom[1], 'params');
  assert.match(String(at(media, 'filename')), /^minerr-\d+\.jpg$/);
  assert.ok(String(at(media, 'data')).startsWith('/9j/'), 'stored media is base64 JPEG');
  assert.deepEqual(at(custom[2], 'params', 'note'), {
    deckName: 'Minerr',
    modelName: 'Mining',
    fields: {
      Expression: '食べる',
      ExpressionReading: 'たべる',
      Sentence: '猫が魚を<b>食べなかった</b>。',
      MainDefinition: DEFINITION,
      Picture: '<img src="minerr-stored.jpg">',
      Notes: `<a href="${pageUrl}">猫 &amp; 魚</a> 食べる[たべる]`,
    },
    tags: ['minerr'],
  });
  console.log('custom note type: addNote with the rendered fields, no note type writes');

  ankiReplies.modelFieldNames = () => ['Expression', 'ExpressionReading', 'Sentence', 'MainDefinition', 'Picture', 'Source'];
  await options.reload();
  await options.locator('#note-type-status', { hasText: 'Updated the fields from Anki' }).waitFor();
  assert.deepEqual(at(await storedNoteType(), 'fields'), {
    Expression: '{word}', ExpressionReading: '{reading}', Sentence: '{sentence}', MainDefinition: '{definition}', Picture: '{image}', Source: '{url}',
  });
  console.log('a field renamed in Anki: the options page follows it');

  await options.bringToFront();
  await options.selectOption('#note-type', '');
  await saved.waitFor();
  assert.deepEqual(await storedNoteType(), { kind: 'builtin' });
  assert.equal(await options.inputValue('#known-field'), 'Word');
  assert.equal(await options.isVisible('#note-fields'), false);
  const builtin = await addTaberu();
  assert.deepEqual(builtin.map(r => at(r, 'action')).sort(), ['addNote', 'createDeck', 'modelNames', 'modelStyling', 'modelTemplates']);
  const builtinNote = at(builtin.find(r => at(r, 'action') === 'addNote'), 'params', 'note');
  assert.equal(at(builtinNote, 'modelName'), 'Minerr');
  assert.deepEqual(at(builtinNote, 'fields'), { Word: '食べる', Reading: 'たべる', Sentence: '猫が魚を<b>食べなかった</b>。', Definition: DEFINITION, Image: '' });
  assert.deepEqual(at(builtinNote, 'picture', 0, 'fields'), ['Image']);
  console.log('back to the built-in note type: the Minerr note type and a picture again');

  const counts = () => options.$$eval('#status-counts li', items => items.map(item => item.textContent));
  const storedWords = () => worker.evaluate(async () => Object.fromEntries(Object.entries(await chrome.storage.local.get(null))
    .filter(([key]) => key.startsWith('w:')).map(([key, value]) => [key.slice(2), value])));
  await options.bringToFront();
  assert.deepEqual(await counts(), ['Learning1', 'Known2', 'Ignored0']);
  const [download] = await Promise.all([options.waitForEvent('download'), options.click('#status-export')]);
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('-');
  assert.equal(download.suggestedFilename(), `minerr-statuses-${today}.json`);
  const exported: unknown = JSON.parse(readFileSync(await download.path(), 'utf8'));
  console.log('exported status file:', JSON.stringify(exported));
  assert.match(String(at(exported, 'exported')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(exported, { format: 'minerr-statuses', version: 1, exported: at(exported, 'exported'), words: { 食べる: 'known', 魚: 'learning', 猫: 'known' } });
  assert.deepEqual(at(exported, 'words'), await storedWords());
  assert.equal(await options.textContent('#status-message'), 'Exported 3 words.');

  const crafted = join(work, 'statuses.json');
  writeFileSync(crafted, JSON.stringify({ format: 'minerr-statuses', version: 1, exported: '2026-01-01T00:00:00.000Z',
    words: { 猫: 'ignored', 食べる: 'known', 雨: 'learning' } }));
  await options.setInputFiles('#status-file', crafted);
  await options.locator('#status-message', { hasText: 'Imported 3 words: 1 added, 1 changed, 1 unchanged.' }).waitFor();
  await other.waitForSelector('#line .ml-word[data-ml-lemma="猫"].ml-ignored', { timeout: 5000 });
  await options.waitForFunction(() => document.querySelector('#status-counts')?.textContent === 'Learning2Known1Ignored1');
  assert.deepEqual(await storedWords(), { 食べる: 'known', 魚: 'learning', 猫: 'ignored', 雨: 'learning' });
  console.log('import of a status file: counts reported, 猫 ignored in an open tab');

  const before = await worker.evaluate(() => chrome.storage.local.get(null));
  const malformed = join(work, 'malformed.json');
  writeFileSync(malformed, JSON.stringify({ format: 'minerr-statuses', version: 1, exported: '2026-01-01T00:00:00.000Z',
    words: { 魚: 'ignored', 本: 'mastered' } }));
  await options.setInputFiles('#status-file', malformed);
  await options.locator('#status-message.error').waitFor();
  assert.equal(await options.textContent('#status-message'),
    'Import failed. The word "本" has the status "mastered". Use learning, known, or ignored. No status changed.');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), before);
  console.log('import of a malformed file:', await options.textContent('#status-message'));

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
