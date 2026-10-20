// The Lapis note type, the word audio, and the card form (E), with a mock AnkiConnect on port 8765 and a mock JapanesePod101.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAPIS_FIELDS, LAPIS_PACKAGE_URL } from '../src/lapis.ts';
import { at } from '../src/parse.ts';
import { launch, listen, makeDictionary, mockAnki } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-card-'));
const fixture = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
], [['v1', 'partOfSpeech', -3, 'Ichidan verb', 0], ['n', 'partOfSpeech', -3, 'noun', 0]], [
  ['食べる', 'freq', { reading: 'たべる', frequency: 1200 }],
  ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2 }] }],
]);

const anki = await mockAnki();
const actions = (from: number) => anki.requests.slice(from).map(request => at(request, 'action'));
const params = (from: number, action: string) => anki.requests.slice(from).filter(request => at(request, 'action') === action).map(request => at(request, 'params'));

const site = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><title>猫 &amp; 魚</title><body><p id="line">猫が魚を食べなかった。</p></body>');
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/cats`;

const WORD_AUDIO = Buffer.from('ID3 word audio of the mock');
const wordFile = `minerr-word-${createHash('sha256').update(WORD_AUDIO).digest('hex').slice(0, 16)}.mp3`;
const { context, worker, extensionId } = await launch(join(work, 'profile'), null);
const jpod: string[] = [];
let jpodHasAudio = true;
await context.route('https://assets.languagepod101.com/**', route => {
  jpod.push(route.request().url());
  return jpodHasAudio ? route.fulfill({ contentType: 'audio/mpeg', body: WORD_AUDIO }) : route.fulfill({ status: 404, body: '' });
});
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', fixture);
  await options.locator('#dict-status', { hasText: 'Imported Fixture' }).waitFor();
  await options.locator('#note-type option[value="custom:Basic"]').waitFor({ state: 'attached' });
  assert.equal(await options.inputValue('#note-type'), 'lapis', 'a fresh profile uses Lapis');
  assert.deepEqual(await options.$$eval('#note-type option', items => items.map(item => item.textContent)), ['Lapis', 'Minerr (classic)', 'Basic']);
  assert.equal(await options.inputValue('#known-field'), 'Expression');
  await options.locator('#lapis-install-button').waitFor();
  console.log('fresh profile: the note type is Lapis, and Anki has no Lapis, so Install Lapis shows');

  const tab = await context.newPage();
  await tab.goto(pageUrl);
  const popup = tab.locator('minerr-popup .popup');
  const open = async (lemma: string) => {
    await tab.mouse.move(0, 0);
    await tab.hover(`#line .ml-word[data-ml-lemma="${lemma}"]`);
    await popup.locator('.lemma', { hasText: lemma }).waitFor();
  };
  await open('食べる');
  let from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message.error').waitFor();
  assert.equal(await popup.locator('.message').innerText(), 'Anki has no Lapis note type. Install Lapis in Options, or select another note type.');
  assert.deepEqual(actions(from), ['createDeck', 'modelNames']);
  console.log('add without Lapis in Anki:', await popup.locator('.message').innerText());

  let models = ['Basic'];
  anki.replies.modelNames = () => models;
  anki.replies.importPackage = () => { models = ['Basic', 'Lapis']; return true; };
  anki.replies.deleteMediaFile = () => null;
  anki.replies.deckNames = () => ['Default', 'Lapis'];
  anki.replies.findNotes = () => [5];
  anki.replies.notesInfo = () => [{ noteId: 5, modelName: 'Lapis', fields: { Expression: { value: '十中八九', order: 0 } } }];
  anki.replies.deleteDecks = () => null;
  await options.bringToFront();
  from = anki.requests.length;
  await options.click('#lapis-install-button');
  await options.locator('#note-type-status', { hasText: 'Installed Lapis.' }).waitFor();
  assert.deepEqual(actions(from), ['modelNames', 'storeMediaFile', 'importPackage', 'deleteMediaFile', 'deckNames', 'findNotes', 'notesInfo', 'deleteDecks', 'modelNames']);
  assert.deepEqual(params(from, 'storeMediaFile'), [{ filename: '_minerr_lapis.apkg', url: LAPIS_PACKAGE_URL }]);
  assert.deepEqual(params(from, 'importPackage'), [{ path: '_minerr_lapis.apkg' }]);
  assert.deepEqual(params(from, 'deleteMediaFile'), [{ filename: '_minerr_lapis.apkg' }]);
  assert.deepEqual(params(from, 'findNotes'), [{ query: 'deck:"Lapis"' }]);
  assert.deepEqual(params(from, 'deleteDecks'), [{ decks: ['Lapis'], cardsToo: true }]);
  assert.equal(await options.isVisible('#lapis-install-button'), false);
  console.log('Install Lapis: download through AnkiConnect, import, delete the file and the sample deck');

  await tab.bringToFront();
  await open('食べる');
  jpod.length = 0;
  from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(actions(from), ['createDeck', 'modelNames', 'storeMediaFile', 'storeMediaFile', 'addNote']);
  const [picture, audio] = params(from, 'storeMediaFile');
  assert.match(String(at(picture, 'filename')), /^minerr-\d+\.jpg$/);
  assert.deepEqual(audio, { filename: wordFile, data: WORD_AUDIO.toString('base64') });
  assert.deepEqual(jpod, ['https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=%E9%A3%9F%E3%81%B9%E3%82%8B&kana=%E3%81%9F%E3%81%B9%E3%82%8B']);
  const note = at(params(from, 'addNote')[0], 'note');
  assert.equal(at(note, 'modelName'), 'Lapis');
  assert.equal(at(note, 'deckName'), 'Minerr');
  const fields = at(note, 'fields');
  assert.deepEqual(Object.keys(fields ?? {}), [...LAPIS_FIELDS]);
  const definition = '<ol><li><span class="tag tag-partOfSpeech" title="Ichidan verb">v1</span> to eat (fixture)<span class="dict">Fixture</span></li></ol>';
  assert.deepEqual(fields, {
    Expression: '食べる', ExpressionFurigana: '食[た]べる', ExpressionReading: 'たべる', ExpressionAudio: `[sound:${wordFile}]`, SelectionText: '',
    MainDefinition: definition, DefinitionPicture: '', Sentence: '猫が魚を<b>食べなかった</b>。', SentenceFurigana: '', SentenceAudio: '',
    Picture: `<img src="${String(at(picture, 'filename'))}">`, Glossary: definition, Hint: '', IsWordAndSentenceCard: '', IsClickCard: '',
    IsSentenceCard: '', IsAudioCard: '', PitchPosition: '[2]', PitchCategories: 'kifuku',
    Frequency: '<ul style="text-align: left;"><li>Fixture: 1200</li></ul>', FreqSort: '1200',
    MiscInfo: `猫 &amp; 魚<br><a href="${pageUrl}">${pageUrl}</a>`,
  });
  console.log('Lapis card: addNote with the Lapis fields, the word audio, and no note type change');

  jpodHasAudio = false;
  await open('魚');
  from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(actions(from), ['createDeck', 'modelNames', 'storeMediaFile', 'addNote']);
  assert.equal(at(params(from, 'addNote')[0], 'note', 'fields', 'ExpressionAudio'), '');
  console.log('no word audio from JapanesePod101: ExpressionAudio is empty, and the card is added');
  jpodHasAudio = true;

  await open('猫');
  await tab.keyboard.press('e');
  const form = popup.locator('form.card-form');
  await form.waitFor();
  assert.deepEqual(await form.locator('label').allInnerTexts(), [...LAPIS_FIELDS]);
  const sentence = form.getByLabel('Sentence', { exact: true });
  assert.equal(await sentence.inputValue(), '<b>猫</b>が魚を食べなかった。');
  assert.equal(await form.locator('img').count(), 1, 'the screenshot shows');
  assert.equal(await form.locator('audio').count(), 1, 'the word audio shows');
  assert.equal(await popup.locator('.definitions').isVisible(), false);
  await sentence.press('End');
  await sentence.pressSequentially('3a');
  await form.getByRole('button', { name: 'Send' }).focus();
  await tab.keyboard.press('3');
  await tab.waitForTimeout(300);
  assert.equal(await tab.$eval('#line .ml-word[data-ml-lemma="猫"]', span => span.className), 'ml-word ml-unknown', 'keys in the form do not change the status');
  await sentence.press('Escape');
  await form.waitFor({ state: 'detached' });
  assert.equal(await popup.isVisible(), true, 'Esc closes the form first');
  await tab.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  console.log('E: the form has every field; keys stay in the form; Esc closes the form, then the popup');

  await open('猫');
  await popup.getByRole('button', { name: 'Edit E' }).click();
  await form.waitFor();
  await sentence.fill('<b>猫</b>だ。');
  await form.getByLabel('Hint', { exact: true }).fill('a pet');
  from = anki.requests.length;
  await form.getByRole('button', { name: 'Send' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(actions(from), ['createDeck', 'modelNames', 'storeMediaFile', 'storeMediaFile', 'addNote']);
  const edited = at(params(from, 'addNote')[0], 'note', 'fields');
  assert.deepEqual([at(edited, 'Sentence'), at(edited, 'Hint'), at(edited, 'Expression'), at(edited, 'ExpressionAudio')],
    ['<b>猫</b>だ。', 'a pet', '猫', `[sound:${wordFile}]`]);
  console.log('Edit button, then Send: the note has the edited fields');

  await worker.evaluate(() => chrome.storage.local.set({ noteType: { kind: 'builtin' } }));
  await open('猫');
  await tab.keyboard.press('e');
  await form.waitFor();
  assert.deepEqual(await form.locator('label').allInnerTexts(), ['Word', 'Reading', 'Sentence', 'Definition', 'Image', 'SentenceAudio']);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await form.waitFor({ state: 'detached' });
  console.log('E with the classic note type: the form has its fields');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('CARD E2E PASS');
} finally {
  await context.close();
  site.close();
  anki.server.close();
}
