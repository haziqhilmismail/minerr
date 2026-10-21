// End-to-end test of the subtitle sidebar in the video player: when the list follows the video, and Create N cards.
// Uses port 8765 (mock AnkiConnect) and ffmpeg for a test clip. Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at } from '../src/shared/guards.ts';
import { launch, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-sidebar-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);
const LINES = 40;
const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=10:d=${LINES}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${LINES}`, '-c:v', 'libvpx', '-b:v', '100k', '-c:a', 'libopus', clip]);
const POOL = ['猫が魚を食べた', '今日は雨が降っている', '本を読む', '猫が好きだ'];
const stamp = (seconds: number) => `00:00:${String(seconds).padStart(2, '0')},000`;
const srt = join(work, 'clip.srt');
writeFileSync(srt, Array.from({ length: LINES }, (_, i) => `${i + 1}\n${stamp(i)} --> ${stamp(i + 1)}\n${POOL[i % POOL.length]}\n`).join('\n'));
const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 1, ''],
  ['本', 'ほん', 'n', '', 100, ['book (fixture)'], 2, ''],
]);
const anki = await mockAnki();

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const setStorage = (items: Record<string, unknown>) => worker.evaluate(value => chrome.storage.local.set(value), items);

try {
  await setStorage({ 'w:猫': 'known', 'w:食べる': 'known', 'w:読む': 'known', 'w:好き': 'known', 'w:降る': 'known' });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  await options.close();

  const player = await context.newPage();
  await player.setViewportSize({ width: 1000, height: 720 });
  await player.goto(`chrome-extension://${extensionId}/pages/player.html`);
  await player.setInputFiles('#video-file', clip);
  await player.setInputFiles('#subs-file', srt);
  await player.locator('#status').filter({ hasText: `Subtitles from clip.srt: ${LINES} lines.` }).waitFor();
  const popup = player.locator('minerr-popup .popup');
  const sidebar = player.locator('.minerr-lines');
  const cards = sidebar.locator('li');
  const paused = sidebar.getByText('Scroll paused');
  const seek = (time: number) => player.evaluate(t => new Promise(resolve => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = t;
  }), time);
  const video = (action: 'play' | 'pause') => player.evaluate(name => { document.querySelector('video')?.[name](); }, action);
  const currentCard = (time: string) => player.waitForFunction(t => document.querySelector('.minerr-lines li[aria-current="true"] time')?.textContent === t, time);
  const listTop = () => sidebar.locator('ol').evaluate(list => Math.round(list.scrollTop));
  // The scrollTop that puts the card of the current line in the middle of the list.
  const centered = () => sidebar.locator('ol').evaluate(list => {
    const row = list.querySelector<HTMLElement>('li[aria-current="true"]');
    if (!row) throw new Error('The list has no current line');
    return Math.round(Math.min(list.scrollHeight - list.clientHeight, Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2)));
  });
  const waitCentered = () => player.waitForFunction(() => {
    const list = document.querySelector('.minerr-lines ol');
    const row = list?.querySelector<HTMLElement>('li[aria-current="true"]');
    if (!list || !row) return false;
    const middle = Math.min(list.scrollHeight - list.clientHeight, Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2));
    return Math.abs(list.scrollTop - middle) < 2;
  });
  // The index of the first card that the list shows in full, so the mouse can hover its words without a scroll.
  const visibleCard = () => sidebar.locator('ol').evaluate(list => {
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll('li')].findIndex(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom && row.querySelector('.ml-word.ml-unknown');
    });
  });
  const wheel = async (by: number) => {
    const before = await listTop();
    await sidebar.locator('ol').hover();
    await player.mouse.wheel(0, by);
    await player.waitForFunction(top => Math.round(document.querySelector('.minerr-lines ol')?.scrollTop ?? 0) !== top, before);
    return listTop();
  };
  const hoverWord = async () => {
    const index = await visibleCard();
    assert.ok(index >= 0, 'the list shows a card with an unknown word');
    await cards.nth(index).locator('.ml-word.ml-unknown').first().hover();
    await popup.waitFor();
    return index;
  };

  await seek(20.5);
  await player.keyboard.press('g');
  await sidebar.locator('li .ml-word.ml-unknown[data-ml-lemma="魚"]').first().waitFor();
  await player.mouse.move(0, 0);
  await currentCard('0:20');
  await waitCentered();
  assert.ok(await listTop() > 0, 'the list opens at the current line');
  assert.equal(await paused.isVisible(), false);

  const scrolled = await wheel(-600);
  await paused.waitFor();
  await hoverWord();
  await player.mouse.move(0, 0);
  await player.waitForTimeout(400);
  assert.equal(await listTop(), scrolled, 'the list stays where the user scrolled it when the mouse leaves the sidebar');
  assert.equal(await paused.isVisible(), true, 'the badge shows while the list does not follow the video');
  await player.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  await seek(25.5);
  await currentCard('0:25');
  await player.waitForTimeout(200);
  assert.equal(await listTop(), scrolled, 'a line change of the paused video does not scroll the list after a user scroll');
  console.log('sidebar: after a scroll, the list stays where the user left it, also when the mouse leaves');

  await video('play');
  await waitCentered();
  await paused.waitFor({ state: 'hidden' });
  const playedTop = await listTop();
  await currentCard('0:27');
  await waitCentered();
  assert.notEqual(await listTop(), playedTop, 'the list follows the line changes while the video plays');
  await video('pause');
  console.log('sidebar: play goes back to the current line, and the list follows the video again');

  await video('play');
  const heldTop = await wheel(-500);
  await hoverWord();
  await player.waitForFunction(() => document.querySelector('video')?.paused === true);
  await player.mouse.move(0, 0);
  await player.keyboard.press('Escape');
  await player.waitForFunction(() => document.querySelector('video')?.paused === false);
  await player.waitForTimeout(1500);
  assert.equal(await listTop(), heldTop, 'the end of the popup pause does not scroll the list back');
  await paused.waitFor();
  await video('pause');
  console.log('sidebar: the video plays again after the popup pause, and the list stays where the user scrolled it');

  await setStorage({ pauseOnSidebar: false });
  await video('play');
  await hoverWord();
  await player.waitForTimeout(500);
  assert.equal(await player.evaluate(() => document.querySelector('video')?.paused), false, 'with the switch off, a sidebar popup does not pause');
  await player.mouse.move(0, 0);
  await player.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  await setStorage({ pauseOnSidebar: true });
  await video('pause');
  console.log('sidebar: with "Pause while a word popup in the sidebar is open" off, the video plays on');

  const target = await visibleCard();
  const time = await cards.nth(target).locator('time').innerText();
  await cards.nth(target).locator('time').click();
  await currentCard(time);
  await player.mouse.move(0, 0);
  await waitCentered();
  assert.equal(await listTop(), await centered());
  await paused.waitFor({ state: 'hidden' });
  console.log(`sidebar: a click on the time ${time} goes to the line and the list follows again`);

  const footer = sidebar.locator('.minerr-lines-foot');
  const footerText = footer.getByRole('status');
  const select = (index: number) => cards.nth(index).getByRole('button', { name: 'Select the line' }).click();
  const selectedLines = () => cards.evaluateAll(rows => rows.flatMap((row, index) => (row.querySelector('.check[aria-pressed="true"]') ? [index] : [])));
  assert.equal(await footer.isVisible(), false);
  await select(0);
  await select(1);
  assert.equal(await footerText.innerText(), '2 lines selected');
  await player.keyboard.press('Escape');
  await footer.waitFor({ state: 'hidden' });
  assert.deepEqual(await selectedLines(), [], 'Esc clears the selection');
  for (const index of [0, 1, 2]) await select(index);
  await select(3);
  await select(3);
  assert.deepEqual(await selectedLines(), [0, 1, 2]);
  await sidebar.locator('ol').evaluate(list => { list.scrollTop = 0; });
  await player.mouse.move(0, 0);
  await player.screenshot({ path: join(out, 'sidebar-selection.png') });
  const before = anki.requests.length;
  await footer.getByRole('button', { name: 'Create 3 cards' }).click();
  await footerText.filter({ hasText: 'Adding card 1 of 3…' }).waitFor();
  await footerText.filter({ hasText: /^Added/ }).waitFor({ timeout: 60000 });
  assert.equal(await footerText.innerText(), 'Added 2 cards. 1 line needs a target word: use + on it.');
  const notes = anki.requests.slice(before).filter(request => at(request, 'action') === 'addNote').map(request => at(request, 'params', 'note', 'fields'));
  console.log('Create 3 cards:', notes);
  assert.deepEqual(notes.map(fields => [at(fields, 'Word'), at(fields, 'Sentence')]), [['魚', '猫が<b>魚</b>を食べた'], ['本', '<b>本</b>を読む']],
    'one card for each line with one unknown word, with its line as the sentence');
  for (const fields of notes) {
    assert.match(String(at(fields, 'SentenceAudio')), /^\[sound:minerr-\d+\.webm\]$/, 'each card has the audio of its line');
    assert.match(String(at(fields, 'Image')), /^<img src="minerr-\d+\.jpg">$/, 'each card has a screenshot');
  }
  assert.deepEqual(await selectedLines(), [1], 'the line that needs a target word stays selected');
  await player.mouse.move(0, 0);
  await player.screenshot({ path: join(out, 'sidebar-created.png') });
  await footer.getByRole('button', { name: 'Clear' }).click();
  await footer.waitFor({ state: 'hidden' });
  assert.deepEqual(await selectedLines(), []);
  console.log('Create 3 cards: 2 cards with line, audio, and screenshot; the line with two unknown words stays selected');

  const { addNote } = anki.replies;
  if (!addNote) throw new Error('The mock has no addNote');
  delete anki.replies.addNote;
  await setStorage({ 'w:魚': 'unknown' });
  await cards.nth(4).locator('.ml-word.ml-unknown[data-ml-lemma="魚"]').waitFor();
  await select(0);
  await select(4);
  await footer.getByRole('button', { name: 'Create 2 cards' }).click();
  await footerText.filter({ hasText: 'Stopped.' }).waitFor({ timeout: 30000 });
  assert.equal(await footerText.innerText(), 'Stopped. Added 0 cards. 1 card failed: the popup shows why.');
  await popup.locator('.message', { hasText: 'The mock has no such action' }).waitFor();
  assert.deepEqual(await selectedLines(), [0, 4], 'after an error, the lines without a card stay selected');
  anki.replies.addNote = addNote;
  await player.keyboard.press('Escape');
  await footer.getByRole('button', { name: 'Clear' }).click();
  await footer.waitFor({ state: 'hidden' });
  console.log('Create 2 cards with an Anki error: the run stops, and the popup shows the error');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('SIDEBAR E2E PASS');
} finally {
  await context.close();
  anki.server.close();
}
