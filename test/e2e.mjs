import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extension, launch, listen, makeDictionary } from './harness.mjs';

const work = mkdtempSync(join(tmpdir(), 'ml-e2e-'));

const fixture = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, [{ type: 'structured-content', content: { tag: 'ul', content: [{ tag: 'li', content: 'to eat (fixture)' }] } }], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
]);

const ankiRequests = [];
const ankiReplies = {
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
    const request = JSON.parse(body);
    ankiRequests.push(request);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result: ankiReplies[request.action](request.params), error: null }));
  });
});
await listen(anki, 8765);

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><body><p id="line">猫が魚を食べなかった。</p><div id="subs"></div></body>');
});
const sitePort = await listen(site, 0);
const pageUrl = `http://127.0.0.1:${sitePort}/watch`;

const { context, extensionId } = await launch(join(work, 'profile'));
const failures = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  console.log('extension loaded from', extension);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', fixture);
  await options.waitForFunction(() => document.querySelector('#dict-status').textContent.startsWith('Imported'));
  const imported = await options.textContent('#dict-status');
  console.log('options import status:', imported);
  assert.equal(imported, 'Imported Fixture: 3 terms');
  assert.deepEqual(await options.$$eval('#dict-list li', items => items.map(li => li.innerText.split('\n'))), [['Fixture', '3 terms', 'Delete']]);

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
    document.querySelector('#subs').append(line);
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
  assert.equal(await popup.locator('li').first().innerText(), 'to eat (fixture)\nFixture');

  await tab.keyboard.press('3');
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="食べる"].ml-known');
  await other.waitForSelector('#line .ml-word[data-ml-lemma="食べる"].ml-known', { timeout: 5000 });
  assert.equal(await popup.locator('button[aria-pressed="true"]').innerText(), 'Known 3');
  console.log('after key 3: known in this tab and in the second tab');

  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const actions = ankiRequests.map(r => r.action);
  console.log('AnkiConnect actions:', actions);
  assert.deepEqual(actions, ['createDeck', 'modelNames', 'createModel', 'addNote']);
  assert.ok(ankiRequests.every(r => r.version === 6));
  assert.deepEqual(ankiRequests[0].params, { deck: 'Minerr' });
  assert.equal(ankiRequests[2].params.modelName, 'Minerr');
  assert.deepEqual(ankiRequests[2].params.inOrderFields, ['Word', 'Reading', 'Sentence', 'Definition', 'Image']);
  const { note } = ankiRequests[3].params;
  const picture = note.picture[0];
  console.log('addNote fields:', note.fields, 'picture:', picture.filename, picture.fields, `${picture.data.length} base64 chars`);
  assert.equal(note.deckName, 'Minerr');
  assert.equal(note.modelName, 'Minerr');
  assert.deepEqual(note.fields, {
    Word: '食べる',
    Reading: 'たべる',
    Sentence: '猫が魚を<b>食べなかった</b>。',
    Definition: '<ol><li>to eat (fixture)<span class="dict">Fixture</span></li></ol>',
    Image: '',
  });
  assert.deepEqual(picture.fields, ['Image']);
  assert.ok(picture.data.startsWith('/9j/'), 'picture is base64 JPEG');
  writeFileSync(join(work, 'card.jpg'), Buffer.from(picture.data, 'base64'));
  console.log('card screenshot saved to', join(work, 'card.jpg'));

  await tab.hover('#line .ml-word[data-ml-lemma="魚"]');
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await tab.keyboard.press('a');
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="魚"].ml-learning');
  assert.equal(ankiRequests.at(-1).params.note.fields.Sentence, '猫が<b>魚</b>を食べなかった。');
  console.log('hotkey A on unknown 魚: card added, status now learning');

  await tab.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });

  await options.bringToFront();
  await options.click('#known-import');
  await options.waitForFunction(() => document.querySelector('#known-status').textContent.startsWith('Marked'));
  assert.equal(await options.textContent('#known-status'), 'Marked 1 words as known.');
  assert.deepEqual(ankiRequests.find(r => r.action === 'findNotes').params, { query: 'deck:"Minerr" prop:ivl>=21' });
  await other.waitForSelector('.ml-word[data-ml-lemma="猫"].ml-known');
  console.log('import known from Anki: 猫 known in open tab');

  await options.click('#anki-check');
  await options.waitForFunction(() => document.querySelector('#anki-status').textContent.startsWith('Connected'));
  assert.equal(await options.textContent('#anki-status'), 'Connected (AnkiConnect version 6)');
  assert.equal(ankiRequests.at(-1).action, 'version');
  console.log('check connection:', await options.textContent('#anki-status'));

  ankiReplies.modelNames = () => ['Basic', 'Minerr'];
  ankiReplies.updateModelTemplates = () => null;
  ankiReplies.updateModelStyling = () => null;
  const cdp = await context.newCDPSession(tab);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await tab.bringToFront();
  await tab.hover('#line .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('li').first().waitFor();
  const sent = ankiRequests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const restartActions = ankiRequests.slice(sent).map(r => r.action);
  console.log('AnkiConnect actions after a restart with the note type present:', restartActions);
  assert.deepEqual(restartActions, ['createDeck', 'modelNames', 'updateModelTemplates', 'updateModelStyling', 'addNote']);
  const [templates, styling] = ankiRequests.slice(sent + 2, sent + 4).map(r => r.params.model);
  assert.equal(templates.name, 'Minerr');
  const [{ Front, Back }] = ankiRequests[2].params.cardTemplates;
  assert.deepEqual(templates.templates, { Recognition: { Front, Back } });
  assert.equal(styling.name, 'Minerr');
  assert.equal(styling.css, ankiRequests[2].params.css);

  await new Promise(resolve => anki.close(resolve));
  anki.closeAllConnections();
  await tab.bringToFront();
  await tab.hover('.caption .ml-word[data-ml-lemma="好き"]');
  await popup.locator('.lemma', { hasText: '好き' }).waitFor();
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
