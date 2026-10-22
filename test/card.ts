// The Lapis note type, the word audio, the card form (E), and the Anki line of the popup (V), with a mock AnkiConnect on port 8765
// and a mock JapanesePod101.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAPIS_FIELDS, LAPIS_PACKAGE_URL } from '../src/anki/lapis.ts';
import { at } from '../src/shared/guards.ts';
import { launch, listen, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-card-'));
const out = process.env.OUT_DIR ?? work;
useCjkFonts(work);
const fixture = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
  ['可愛い', 'かわいい', 'adj-i', 'adj-i', 100, ['cute (fixture)'], 4, ''],
], [['v1', 'partOfSpeech', -3, 'Ichidan verb', 0], ['n', 'partOfSpeech', -3, 'noun', 0]], [
  ['食べる', 'freq', { reading: 'たべる', frequency: 1200 }],
  ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2 }] }],
]);

const anki = await mockAnki();
// Each popup asks for the number of notes of its word when it opens; actions and params leave these requests out.
const isCount = (request: unknown) => at(request, 'action') === 'findNotes' && String(at(request, 'params', 'query')).startsWith('"Expression:');
const counts = () => anki.requests.filter(isCount).map(request => at(request, 'params', 'query'));
const since = (from: number) => anki.requests.slice(from).filter(request => !isCount(request));
const until = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(check(), what);
};
const actions = (from: number) => since(from).map(request => at(request, 'action'));
const params = (from: number, action: string) => since(from).filter(request => at(request, 'action') === action).map(request => at(request, 'params'));

const site = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><title>猫 &amp; 魚</title><body><p id="line">猫が魚を食べなかった。</p><p id="kana">かわいい。</p></body>');
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
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
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
  await until(() => counts().length === 1, 'the popup asks Anki for the notes of the word');
  assert.deepEqual(counts(), ['"Expression:食べる"']);
  await tab.waitForTimeout(300);
  assert.equal(await popup.locator('.anki').isHidden(), true, 'no Anki line when AnkiConnect gives an error');
  let from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message.error').waitFor();
  assert.equal(await popup.locator('.message').innerText(), 'Anki has no Lapis note type. Install Lapis in Options, or select another note type.');
  assert.deepEqual(actions(from), ['createDeck', 'modelNames']);
  console.log('add without Lapis in Anki:', await popup.locator('.message').innerText());

  let models = ['Basic'];
  anki.replies.modelNames = () => models;
  anki.replies.getMediaDirPath = () => '/anki/collection.media';
  anki.replies.importPackage = () => { models = ['Basic', 'Lapis']; return true; };
  anki.replies.deleteMediaFile = () => null;
  anki.replies.deckNames = () => ['Default', 'Lapis'];
  let inAnki: number[] = [];
  anki.replies.findNotes = search => (at(search, 'query') === 'deck:"Lapis"' ? [5] : inAnki);
  anki.replies.notesInfo = () => [{ noteId: 5, modelName: 'Lapis', fields: { Expression: { value: '十中八九', order: 0 } } }];
  anki.replies.deleteDecks = () => null;
  // The Lapis of the user: no ExpressionKanji field, and the word line of the hand-edited back template.
  const lapisFieldNames = ['Expression', 'MiscInfo'];
  const lapisBack = '<div class="dh-vocab">\n    <div class="vocab">{{Expression}}</div>\n</div>';
  let lapisTemplates = { Mining: { Front: '{{Sentence}}', Back: lapisBack } };
  anki.replies.modelFieldNames = () => lapisFieldNames;
  anki.replies.modelFieldAdd = fieldParams => { lapisFieldNames.push(String(at(fieldParams, 'fieldName'))); return null; };
  anki.replies.modelTemplates = () => lapisTemplates;
  anki.replies.updateModelTemplates = update => {
    lapisTemplates = { Mining: { Front: '{{Sentence}}', Back: String(at(update, 'model', 'templates', 'Mining', 'Back')) } };
    return null;
  };
  await options.bringToFront();
  from = anki.requests.length;
  await options.click('#lapis-install-button');
  await options.locator('#note-type-status', { hasText: 'Installed Lapis.' }).waitFor();
  assert.deepEqual(actions(from), ['modelNames', 'storeMediaFile', 'getMediaDirPath', 'importPackage', 'deleteMediaFile', 'deckNames', 'findNotes', 'notesInfo', 'deleteDecks', 'modelNames']);
  assert.deepEqual(params(from, 'storeMediaFile'), [{ filename: '_minerr_lapis.apkg', url: LAPIS_PACKAGE_URL }]);
  assert.deepEqual(params(from, 'importPackage'), [{ path: '/anki/collection.media/_minerr_lapis.apkg' }]);
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
  // Minerr reads the fields and the templates of Lapis at the same time, so they can arrive in either order.
  const firstAdd = actions(from);
  assert.deepEqual([...firstAdd.slice(0, 2), ...firstAdd.slice(2, 4).sort(), ...firstAdd.slice(4)], [
    'createDeck', 'modelNames', 'modelFieldNames', 'modelTemplates', 'modelFieldAdd', 'updateModelTemplates', 'storeMediaFile', 'storeMediaFile', 'addNote',
  ]);
  assert.deepEqual(params(from, 'modelFieldAdd'), [{ modelName: 'Lapis', fieldName: 'ExpressionKanji', index: 2 }]);
  assert.deepEqual(params(from, 'updateModelTemplates'), [{ model: { name: 'Lapis', templates: { Mining: { Back:
    '<div class="dh-vocab">\n    <div class="vocab">{{Expression}}</div>\n'
    + '    {{#ExpressionKanji}}<div class="info">{{ExpressionKanji}}</div>{{/ExpressionKanji}}\n</div>' } } } }]);
  const [picture, audio] = params(from, 'storeMediaFile');
  assert.match(String(at(picture, 'filename')), /^minerr-\d+\.jpg$/);
  assert.deepEqual(audio, { filename: wordFile, data: WORD_AUDIO.toString('base64') });
  assert.deepEqual(jpod, ['https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=%E9%A3%9F%E3%81%B9%E3%82%8B&kana=%E3%81%9F%E3%81%B9%E3%82%8B']);
  const note = at(params(from, 'addNote')[0], 'note');
  assert.equal(at(note, 'modelName'), 'Lapis');
  assert.equal(at(note, 'deckName'), 'Minerr');
  const fields = at(note, 'fields');
  assert.deepEqual(Object.keys(fields ?? {}), [...LAPIS_FIELDS]);
  const definition = '<div style="text-align: left;" class="yomitan-glossary"><ol><li data-dictionary="Fixture"><i>(v1)</i> to eat (fixture)</li></ol></div>';
  assert.deepEqual(fields, {
    Expression: '食べる', ExpressionFurigana: '食[た]べる', ExpressionReading: 'たべる', ExpressionAudio: `[sound:${wordFile}]`, SelectionText: '',
    MainDefinition: definition, DefinitionPicture: '', Sentence: '猫が魚を<b>食べなかった</b>。', SentenceFurigana: '', SentenceAudio: '',
    Picture: `<img src="${String(at(picture, 'filename'))}">`, Glossary: '', Hint: '', IsWordAndSentenceCard: '', IsClickCard: '',
    IsSentenceCard: 'x', IsAudioCard: '', PitchPosition: '[2]', PitchCategories: 'kifuku',
    Frequency: '<ul style="text-align: left;"><li>Fixture: 1200</li></ul>', FreqSort: '1200',
    MiscInfo: `猫 &amp; 魚<br><a href="${pageUrl}">${pageUrl}</a>`, ExpressionKanji: '',
  });
  console.log('Lapis card: addNote with the Lapis fields and the word audio; the first add gives Lapis the ExpressionKanji field and its line');

  await tab.mouse.move(0, 0);
  const asked = counts().length;
  await tab.hover('#kana .ml-word[data-ml-lemma="かわいい"]');
  await popup.locator('.lemma', { hasText: '可愛い' }).waitFor();
  await popup.locator('.anki', { hasText: 'Not in Anki' }).waitFor();
  assert.deepEqual(counts().slice(asked), ['"Expression:かわいい" OR "Expression:可愛い"'], 'a word in kana: the search has its kanji spelling too');
  inAnki = [9];
  from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(actions(from), ['createDeck', 'storeMediaFile', 'storeMediaFile', 'addNote'], 'the second add does not change Lapis again');
  assert.deepEqual(lapisFieldNames, ['Expression', 'MiscInfo', 'ExpressionKanji']);
  const kana = at(params(from, 'addNote')[0], 'note', 'fields');
  assert.deepEqual([at(kana, 'Expression'), at(kana, 'ExpressionKanji'), at(kana, 'ExpressionReading')], ['かわいい', '可愛い', 'かわいい']);
  console.log('a word in kana: Expression かわいい, ExpressionKanji 可愛い');

  await popup.locator('.anki', { hasText: 'In Anki: 1 note' }).waitFor();
  console.log('Anki line: Not in Anki, then In Anki: 1 note after A');
  await popup.screenshot({ path: join(out, 'popup-in-anki.png') });
  anki.replies.guiBrowse = () => [9];
  const browsed = () => anki.requests.filter(request => at(request, 'action') === 'guiBrowse').map(request => at(request, 'params'));
  await tab.keyboard.press('v');
  await until(() => browsed().length === 1, 'V opens the Anki browser');
  await popup.locator('.anki').click();
  await until(() => browsed().length === 2, 'a click on the Anki line opens the Anki browser');
  assert.deepEqual(browsed(), Array(2).fill({ query: '"Expression:かわいい" OR "Expression:可愛い"' }));
  console.log('V and a click on the Anki line open the Anki browser with the search');

  jpodHasAudio = false;
  await open('魚');
  from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(actions(from), ['createDeck', 'storeMediaFile', 'addNote']);
  assert.equal(at(params(from, 'addNote')[0], 'note', 'fields', 'ExpressionAudio'), '');
  console.log('no word audio from JapanesePod101: ExpressionAudio is empty, and the card is added');
  jpodHasAudio = true;

  await options.bringToFront();
  assert.equal(await options.isChecked('#word-audio'), true, 'the word audio is on by default');
  await options.uncheck('#word-audio');
  await options.waitForFunction(() => chrome.storage.local.get('wordAudio').then(items => items['wordAudio'] === false));
  await tab.bringToFront();
  await open('食べる');
  jpod.length = 0;
  from = anki.requests.length;
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(jpod, [], 'no request to JapanesePod101 with the word audio off');
  assert.deepEqual(actions(from), ['createDeck', 'storeMediaFile', 'addNote']);
  assert.equal(at(params(from, 'addNote')[0], 'note', 'fields', 'ExpressionAudio'), '');
  await options.bringToFront();
  await options.check('#word-audio');
  await options.waitForFunction(() => chrome.storage.local.get('wordAudio').then(items => items['wordAudio'] === true));
  await tab.bringToFront();
  jpod.length = 0;
  console.log('word audio off in Options: no request to JapanesePod101, ExpressionAudio is empty, and the card is added');

  await open('猫');
  await tab.keyboard.press('e');
  const form = popup.locator('form.card-form');
  await form.waitFor();
  assert.deepEqual(await form.locator('label').allInnerTexts(), [...LAPIS_FIELDS]);
  const sentence = form.getByLabel('Sentence', { exact: true });
  assert.equal(await sentence.inputValue(), '<b>猫</b>が魚を食べなかった。');
  assert.equal(await form.locator('img').count(), 1, 'the screenshot shows');
  assert.equal(await form.locator('audio').count(), 1, 'the word audio shows');
  assert.equal(jpod.length, 1, 'one request to JapanesePod101 with the word audio on again');
  assert.equal(await popup.locator('.definitions').isVisible(), false);
  await sentence.press('End');
  await sentence.pressSequentially('3a');
  await form.getByRole('button', { name: 'Send' }).focus();
  await tab.keyboard.press('3');
  await tab.waitForTimeout(300);
  assert.equal(await tab.$eval('#line .ml-word[data-ml-lemma="猫"]', span => span.className), 'ml-word ml-unknown', 'keys in the form do not change the status');
  await tab.mouse.click(5, 5);
  assert.equal(await sentence.inputValue(), '<b>猫</b>が魚を食べなかった。3a', 'a click outside keeps the form and its edits');
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
  assert.deepEqual(actions(from), ['createDeck', 'storeMediaFile', 'storeMediaFile', 'addNote']);
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
