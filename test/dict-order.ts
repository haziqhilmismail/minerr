import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, listen, makeDictionary, runCommand } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-dict-order-'));

// Alpha has the higher scores, so a test of the rank order cannot pass on the score order. Zeta goes first by import, not by title.
const zeta = makeDictionary(join(work, 'zeta.zip'), 'Zeta', [
  ['猫', 'ねこ', '', '', 1, ['cat (Zeta)'], 1, ''],
  ['鳥', 'とり', '', '', 1, ['bird (Zeta)'], 2, ''],
  ['猫犬', 'ねこいぬ', '', '', 1, ['catdog (Zeta)'], 3, ''],
  ['ねこ', 'ねこ', '', '', 1, ['kana cat (Zeta)'], 4, ''],
  ['上手', 'うわて', '', '', 1, ['upper hand (Zeta)'], 5, ''],
  ['上手', 'じょうず', '', '', 1, ['skilled (Zeta)'], 6, ''],
], [], [
  ['猫', 'freq', 100],
  ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 1 }] }],
]);
const alpha = makeDictionary(join(work, 'alpha.zip'), 'Alpha', [
  ['猫', 'ねこ', '', '', 100, ['cat (Alpha)'], 1, ''],
  ['犬', 'いぬ', '', '', 100, ['dog (Alpha)'], 2, ''],
  ['上手', 'じょうず', '', '', 100, ['skilled (Alpha)'], 3, ''],
  ['上手', 'うわて', '', '', 50, ['upper hand (Alpha)'], 4, ''],
], [], [
  ['猫', 'freq', 200],
  ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 0 }] }],
]);
const gamma = makeDictionary(join(work, 'gamma.zip'), 'Gamma', [['魚', 'さかな', '', '', 1, ['fish (Gamma)'], 1, '']]);
const big = makeDictionary(join(work, 'big.zip'), 'Big', Array.from({ length: 41 }, (_, i) => ['魚', 'さかな', '', '', 100, [`fish ${i} (Big)`], 1, '']));
const last = makeDictionary(join(work, 'last.zip'), 'Last', [['空', 'そら', '', '', 1, ['sky (Last)'], 1, '']]);

const site = createServer((_, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><body><p id="line">猫と鳥を見た。</p><p id="join">猫犬</p><p id="kana">ねこ</p><p id="homograph">上手</p><p id="fish">魚</p></body>');
});
const port = await listen(site, 0);

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
  const importZip = async (path: string, title: string) => {
    await options.evaluate(() => { const status = document.querySelector('#dict-status'); if (status) status.textContent = ''; });
    await options.setInputFiles('#dict-file', path);
    await options.locator('#dict-status', { hasText: `Imported ${title}` }).waitFor();
    await options.locator('#dict-list li', { hasText: title }).waitFor();
  };
  const rows = () => options.$$eval('#dict-list li', (items: HTMLElement[]) => items.map(li => li.innerText.split('\n')));
  const row = (title: string) => options.locator('#dict-list li', { hasText: title });
  const button = (name: string) => options.getByRole('button', { name, exact: true });
  const use = (title: string) => options.getByRole('switch', { name: `Use ${title}` });
  const focused = () => options.evaluate(() => document.activeElement?.getAttribute('aria-label'));

  await importZip(zeta, 'Zeta');
  await importZip(alpha, 'Alpha');
  await importZip(gamma, 'Gamma');
  assert.deepEqual(await rows(), [
    ['Zeta', '6 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Alpha', '4 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Gamma', '1 terms', '↑', '↓', 'Delete'],
  ], 'the default order is the import order, not the title order, and the rank number is not text');
  assert.equal(await button('Move Zeta up').isDisabled(), true);
  assert.equal(await button('Move Zeta down').isDisabled(), false);
  assert.equal(await button('Move Gamma down').isDisabled(), true);
  assert.equal(await options.$eval('#dict-list', list => list.tagName), 'OL');

  await options.locator('label:has(#pitch-colors)').click();
  const tab = await context.newPage();
  const url = `http://127.0.0.1:${port}/`;
  const load = async () => {
    await tab.goto(url);
    await tab.waitForSelector('#line .ml-word[data-ml-lemma="鳥"]', { timeout: 20000 });
    await tab.waitForSelector('#line .ml-word[data-ml-lemma="猫"][data-ml-pitch]');
  };
  const popup = tab.locator('minerr-popup .popup');
  const hover = async (selector: string) => {
    await tab.bringToFront();
    await tab.keyboard.press('Escape');
    await tab.mouse.move(0, 0);
    await popup.waitFor({ state: 'detached' });
    await tab.hover(selector);
    await popup.waitFor();
  };
  const cat = async () => {
    await hover('#line .ml-word[data-ml-lemma="猫"]');
    await popup.locator('li').first().waitFor();
    return {
      senses: await popup.locator('li').allInnerTexts(),
      freq: await popup.locator('header .meta .freq').allInnerTexts(),
      pitch: await popup.locator('header .meta .pitch .pattern').allInnerTexts(),
    };
  };
  const pagePitch = () => tab.$eval('#line .ml-word[data-ml-lemma="猫"]', span => span.dataset.mlPitch);
  const joined = () => tab.$$eval('#join .ml-word', spans => spans.map(span => span.dataset.mlLemma));

  await load();
  assert.deepEqual(await cat(), {
    senses: ['cat (Zeta)\nZeta', 'cat (Alpha)\nAlpha'],
    freq: ['Zeta 100', 'Alpha 200'],
    pitch: ['Atamadaka [1]', 'Heiban [0]'],
  }, 'the first import comes first, although the score of Alpha is higher');
  assert.equal(await pagePitch(), 'atamadaka');
  assert.deepEqual(await joined(), ['猫犬']);

  await hover('#homograph .ml-word');
  await popup.locator('li').first().waitFor();
  assert.deepEqual(await popup.locator('li').allInnerTexts(), [
    'skilled (Zeta)\nZeta', 'skilled (Alpha)\nAlpha', 'upper hand (Zeta)\nZeta', 'upper hand (Alpha)\nAlpha',
  ], 'the scores keep じょうず first, although the first dictionary lists うわて first; the rank orders the senses of each reading');

  await hover('#line .ml-word[data-ml-lemma="鳥"]');
  await tab.keyboard.press('3');
  await tab.waitForSelector('#line .ml-word[data-ml-lemma="鳥"].ml-known');
  assert.equal(await tab.$eval('#line .ml-word[data-ml-lemma="鳥"]', span => span.className), 'ml-word ml-known');

  await options.bringToFront();
  await button('Move Zeta down').focus();
  await options.keyboard.press('Enter');
  await options.waitForFunction(() => document.querySelector('#dict-list li .name')?.textContent === 'Alpha');
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Zeta', 'Gamma']);
  assert.equal(await focused(), 'Move Zeta down', 'focus stays on the same button of the moved row');
  await options.keyboard.press('Enter');
  await options.waitForFunction(() => document.querySelector('#dict-list li:last-child .name')?.textContent === 'Zeta');
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Gamma', 'Zeta']);
  assert.equal(await focused(), 'Move Zeta down', 'on the last row the down button keeps the focus');
  await options.keyboard.press('Enter');
  await options.evaluate(() => new Promise(done => setTimeout(done, 200)));
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Gamma', 'Zeta'], 'another press on the edge does not undo the move');
  assert.equal(await focused(), 'Move Zeta down');
  await button('Move Zeta up').focus();
  await options.keyboard.press('Enter');
  await options.waitForFunction(() => document.querySelector('#dict-list li:last-child .name')?.textContent === 'Gamma');
  assert.equal(await focused(), 'Move Zeta up');
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Zeta', 'Gamma']);

  assert.deepEqual(await cat(), {
    senses: ['cat (Alpha)\nAlpha', 'cat (Zeta)\nZeta'],
    freq: ['Alpha 200', 'Zeta 100'],
    pitch: ['Heiban [0]', 'Atamadaka [1]'],
  }, 'an open page shows the new order at the next popup');
  assert.equal(await pagePitch(), 'atamadaka', 'an open page keeps its pitch color until a reload');
  await load();
  assert.equal(await pagePitch(), 'heiban', 'the pitch color follows the rank after a reload');

  await options.bringToFront();
  await use('Zeta').focus();
  await options.keyboard.press('Space');
  await row('Zeta').locator('.meta', { hasText: 'Off. 6 terms, 2 frequency and pitch entries' }).waitFor();
  assert.equal(await focused(), 'Use Zeta', 'the switch keeps the focus');
  assert.equal(await use('Zeta').isChecked(), false);
  assert.equal(await row('Zeta').locator('.name').evaluate(name => getComputedStyle(name).fontWeight), '400');
  assert.deepEqual(await rows(), [
    ['Alpha', '4 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Zeta', 'Off. 6 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Gamma', '1 terms', '↑', '↓', 'Delete'],
  ]);

  assert.deepEqual(await cat(), { senses: ['cat (Alpha)\nAlpha'], freq: ['Alpha 200'], pitch: ['Heiban [0]'] },
    'a dictionary that is off gives no sense, frequency, or pitch');

  await hover('#line .ml-word[data-ml-lemma="鳥"]');
  assert.equal(await popup.locator('.empty').innerText(), 'No dictionary entry. Import or turn on a dictionary in the options page.');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  await popup.waitFor({ state: 'detached' });
  const selectBird = () => tab.evaluate(() => {
    const span = document.querySelector('#line .ml-word[data-ml-lemma="鳥"]');
    if (!span) throw new Error('no word');
    const range = new Range();
    range.selectNodeContents(span);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  await selectBird();
  await runCommand(worker, tab, 'lookup-selection');
  await tab.locator('minerr-popup .toast', { hasText: 'No dictionary entry for 鳥.' }).waitFor();
  await tab.evaluate(() => getSelection()?.removeAllRanges());

  await hover('#kana .ml-word');
  await popup.locator('li').first().waitFor();
  assert.deepEqual(await popup.locator('li').allInnerTexts(), ['cat (Alpha)\nAlpha'],
    'an expression of a dictionary that is off falls back to a reading of one that is on');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  await load();
  assert.deepEqual(await joined(), ['猫', '犬'], 'a compound of a dictionary that is off does not join after a reload');
  assert.equal(await tab.$eval('#line .ml-word[data-ml-lemma="鳥"]', span => span.className), 'ml-word ml-known',
    'the status of a word set before the dictionary went off still shows');
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('w:鳥'))['w:鳥']), 'known');

  await options.reload();
  await row('Zeta').waitFor();
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Zeta', 'Gamma'], 'the order survives a page reload');
  assert.equal(await use('Zeta').isChecked(), false, 'the off state survives a page reload');

  await importZip(zeta, 'Zeta');
  assert.deepEqual(await rows(), [
    ['Alpha', '4 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Zeta', 'Off. 6 terms, 2 frequency and pitch entries', '↑', '↓', 'Delete'],
    ['Gamma', '1 terms', '↑', '↓', 'Delete'],
  ], 'a re-import keeps the rank and the off state');
  assert.deepEqual((await cat()).senses, ['cat (Alpha)\nAlpha'], 'the re-imported dictionary stays off');

  await options.bringToFront();
  await use('Zeta').click();
  await row('Zeta').locator('.meta', { hasText: /^6 terms/ }).waitFor();
  await load();
  assert.deepEqual((await cat()).senses, ['cat (Alpha)\nAlpha', 'cat (Zeta)\nZeta'], 'turned on again, its senses come back in rank order');
  assert.deepEqual(await joined(), ['猫犬']);
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  await popup.waitFor({ state: 'detached' });
  await selectBird();
  await runCommand(worker, tab, 'lookup-selection');
  await popup.locator('li', { hasText: 'bird (Zeta)' }).waitFor();
  await tab.keyboard.press('Escape');

  await options.bringToFront();
  options.once('dialog', dialog => dialog.accept());
  await row('Alpha').getByRole('button', { name: 'Delete' }).click();
  await row('Alpha').waitFor({ state: 'detached' });
  assert.deepEqual((await rows()).map(([title]) => title), ['Zeta', 'Gamma']);
  assert.equal(await button('Move Zeta up').isDisabled(), true, 'the new first row cannot move up');
  await importZip(alpha, 'Alpha');
  assert.deepEqual((await rows()).map(([title]) => title), ['Zeta', 'Gamma', 'Alpha'], 'a new import goes last');

  await importZip(big, 'Big');
  await load();
  await hover('#fish .ml-word');
  await popup.locator('li').first().waitFor();
  const fish = await popup.locator('li').allInnerTexts();
  assert.equal(fish.length, 41, '40 rows of Big and the row of Gamma');
  assert.equal(fish[0], 'fish (Gamma)\nGamma', 'the 40 rows of a big dictionary do not hide a dictionary with a higher rank or a lower score');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  await options.bringToFront();
  await options.evaluate(() => new Promise<void>((done, fail) => {
    const open = indexedDB.open('minerr');
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('dicts', 'readwrite');
      const dicts = tx.objectStore('dicts');
      const all = dicts.getAll();
      all.onsuccess = () => {
        for (const { rank: _, disabled: __, ...row } of all.result) dicts.put(row);
      };
      tx.oncomplete = () => { open.result.close(); done(); };
    };
  }));
  await options.reload();
  await row('Zeta').waitFor();
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Big', 'Gamma', 'Zeta'], 'rows from before ranks keep the title order');
  await button('Move Zeta up').click();
  await options.waitForFunction(() => document.querySelector('#dict-list li:last-child .name')?.textContent === 'Gamma');
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Big', 'Zeta', 'Gamma'], 'the first move from rows without ranks');
  await importZip(last, 'Last');
  assert.deepEqual((await rows()).map(([title]) => title), ['Alpha', 'Big', 'Zeta', 'Gamma', 'Last'], 'a new import after an upgrade goes last');

  assert.deepEqual(failures, []);
  console.log('dict-order: rank and on/off drive the popup, Alt+S, joins, and pitch; statuses stay; the options list keeps focus');
} finally {
  await context.close();
  site.close();
}
