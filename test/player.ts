// End-to-end test of the video keys, the second track, the play modes, and the pauses, in the video player,
// and of the video settings on the options page. Uses port 8765 (mock AnkiConnect) and ffmpeg for a short test clip.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at } from '../src/parse.ts';
import { launch, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-player-'));
useCjkFonts(work);
const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', clip]);
const srt = join(work, 'clip.srt');
writeFileSync(srt, '1\n00:00:00,000 --> 00:00:03,000\n猫が魚を食べた\n\n2\n00:00:03,000 --> 00:00:06,000\n今日は雨が降っている\n');
const englishSrt = join(work, 'clip.en.srt');
writeFileSync(englishSrt, '1\n00:00:00,000 --> 00:00:03,000\nThe cat ate the fish.\n\n2\n00:00:03,000 --> 00:00:06,000\nIt is raining today.\n');
const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
]);
const anki = await mockAnki();

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const setStorage = (items: Record<string, unknown>) => worker.evaluate(value => chrome.storage.local.set(value), items);

try {
  await setStorage({ 'w:猫': 'known', 'w:食べる': 'known' });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  const keyRows = await options.locator('#video-keys tr').evaluateAll(rows => rows.map(row => (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(keyRows[0], '→ or D Go to the next line Needs subtitles with times');
  assert.ok(keyRows.includes('Alt+O Show the subtitles 0.1 seconds later Needs subtitles with times'), 'the options page lists the video keys');
  assert.equal(await options.inputValue('#audio-padding'), '500');
  await options.fill('#audio-padding', '250');
  await options.press('#audio-padding', 'Tab');
  await options.waitForFunction(async () => (await chrome.storage.local.get('audioPadding')).audioPadding === 250);
  await options.fill('#audio-padding', '500');
  await options.press('#audio-padding', 'Tab');
  await options.waitForFunction(async () => (await chrome.storage.local.get('audioPadding')).audioPadding === 500);
  const storedValue = (key: string) => options.evaluate(async name => (await chrome.storage.local.get(name))[name], key);
  await options.click('#clean-subs');
  await options.waitForFunction(async () => (await chrome.storage.local.get('cleanSubs')).cleanSubs === true);
  await options.click('#clean-subs');
  await options.locator('label', { hasText: '4× speed' }).click();
  await options.click('#sub-obscured');
  await options.locator('label', { hasText: 'Hide' }).click();
  await options.waitForFunction(async () => (await chrome.storage.local.get('subEffect')).subEffect === 'hide');
  await options.click('#sub-obscured');
  assert.deepEqual([await storedValue('cleanSubs'), await storedValue('gapMode')], [false, 'x4']);
  await worker.evaluate(() => chrome.storage.local.set({ subObscured: true }));
  await options.locator('#sub-obscured:checked').waitFor();
  await worker.evaluate(() => chrome.storage.local.remove(['subObscured', 'gapMode', 'subEffect']));
  await options.locator('#sub-obscured:not(:checked)').waitFor();
  console.log('options page: the video keys table and the video settings');
  await options.close();

  const player = await context.newPage();
  await player.setViewportSize({ width: 1000, height: 720 });
  await player.goto(`chrome-extension://${extensionId}/player.html`);
  await player.setInputFiles('#video-file', clip);
  await player.setInputFiles('#subs-file', srt);
  const status = player.locator('#status');
  await status.filter({ hasText: 'Subtitles from clip.srt: 2 lines.' }).waitFor();
  const playerTab = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, player.url());
  const menuScore = async () => {
    const menu = await context.newPage();
    await menu.goto(`chrome-extension://${extensionId}/action.html?tab=${playerTab}`);
    await menu.waitForFunction(() => document.querySelector('#sentences-title')?.textContent || document.querySelector('#score-empty')?.textContent !== 'Reading this tab…');
    const shown = await menu.$$eval('#score-percent, #score-basis, #sentences li', nodes => nodes.map(node => node.textContent));
    await menu.close();
    return shown;
  };
  await setStorage({ 'w:今日': 'known', 'w:雨': 'known' });
  assert.deepEqual(await menuScore(), ['66%', '6 words in all 2 subtitle lines of the video. Known and ignored words are understood.',
    '猫が魚を食べた', '今日は雨が降っている'], 'before the lines play, the score covers every line of the track');
  await worker.evaluate(() => chrome.storage.local.remove(['w:今日', 'w:雨']));
  assert.deepEqual(await menuScore(), ['33%', '6 words in all 2 subtitle lines of the video. Known and ignored words are understood.',
    '猫が魚を食べた'], 'the score of the track follows the statuses');
  console.log('toolbar menu on the player tab: the score of every line of the subtitle track');
  const line = player.locator('.minerr-subs-line');
  const popup = player.locator('minerr-popup .popup');
  const seek = (time: number) => player.evaluate(t => new Promise(resolve => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = t;
  }), time);
  await seek(1);
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  const videoTime = () => player.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  const toast = player.locator('.minerr-subs-toast');
  await player.evaluate(() => {
    const copied: string[] = [];
    Object.assign(window, { copied });
    navigator.clipboard.writeText = async text => { copied.push(text); };
  });
  await seek(1);
  await player.keyboard.press('d');
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  assert.equal(await videoTime(), 3, 'D goes to the next line');
  await player.keyboard.press('ArrowLeft');
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.equal(await videoTime(), 0, 'ArrowLeft goes to the previous line');
  await player.keyboard.press('c');
  await toast.filter({ hasText: 'Copied the line.' }).waitFor();
  assert.deepEqual(await player.evaluate(() => Reflect.get(window, 'copied')), ['猫が魚を食べた']);
  await player.keyboard.press('s');
  await player.waitForFunction(() => document.querySelector('video')?.paused === false);
  await player.keyboard.press('.');
  const stepped = await videoTime();
  assert.equal(await player.evaluate(() => document.querySelector('video')?.paused), true, 'a frame step pauses the video');
  await player.keyboard.press('.');
  assert.ok(Math.abs(await videoTime() - stepped - 1 / 30) < 0.001, 'a frame step moves 1/30 s');
  await player.keyboard.press('Alt+o');
  await toast.filter({ hasText: 'Subtitle offset: +0.1 s' }).waitFor();
  await seek(3.05);
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor();
  await player.keyboard.press('Alt+i');
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  console.log('player keys: next, previous, copy, replay, frame step, and offset work');
  const fontSize = () => line.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const before = await fontSize();
  await player.keyboard.press('Alt+=');
  await toast.filter({ hasText: 'Subtitle size: 110%' }).waitFor();
  await player.waitForFunction(size => parseFloat(getComputedStyle(document.querySelector('.minerr-subs-line') ?? document.body).fontSize) > size, before);
  assert.ok(Math.abs(await fontSize() - before * 1.1) < 0.5, 'Alt+= makes the text 10% larger');
  await player.keyboard.press('Alt+-');
  await player.waitForFunction(size => parseFloat(getComputedStyle(document.querySelector('.minerr-subs-line') ?? document.body).fontSize) === size, before);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('subScale')), { subScale: 1 });

  await player.setInputFiles('#second-file', englishSrt);
  await status.filter({ hasText: 'Second subtitles from clip.en.srt.' }).waitFor();
  const secondLine = player.locator('.minerr-subs-second');
  await seek(1);
  await secondLine.filter({ hasText: 'The cat ate the fish.' }).waitFor();
  const stackOrder = await player.evaluate(() => {
    const [first, next] = [...document.querySelectorAll('.minerr-subs-line, .minerr-subs-second')].map(el => el.getBoundingClientRect());
    return Boolean(first && next && next.top >= first.bottom);
  });
  assert.ok(stackOrder, 'the second line is under the Japanese line');
  await player.keyboard.press('Shift+W');
  await secondLine.waitFor({ state: 'hidden' });
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('secondDisplay')), { secondDisplay: 'off' });
  await player.keyboard.press('Shift+W');
  await secondLine.waitFor();
  await setStorage({ secondDisplay: 'hover', pauseOnHover: false });
  await player.evaluate(() => document.querySelector('video')?.play());
  await player.waitForFunction(() => getComputedStyle(document.querySelector('.minerr-subs-second') ?? document.body).visibility === 'hidden');
  await line.hover();
  assert.equal(await secondLine.evaluate(node => getComputedStyle(node).visibility), 'visible', 'hover shows the second line');
  await player.mouse.move(0, 0);
  await player.evaluate(() => document.querySelector('video')?.pause());
  await setStorage({ secondDisplay: 'show', pauseOnHover: true });
  console.log('second subtitle file: shown under the line, Shift+W hides it, hover mode shows it on hover');

  const playFrom = (time: number) => player.evaluate(t => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.currentTime = t;
    return video.play();
  }, time);
  const playback = () => player.evaluate(() => {
    const video = document.querySelector('video');
    return { paused: video?.paused, time: Number(video?.currentTime.toFixed(2)) };
  });
  const waitPaused = (paused: boolean, timeout = 5000) => player.waitForFunction(p => document.querySelector('video')?.paused === p, paused, { timeout });
  await setStorage({ playMode: 'after' });
  await playFrom(1.5);
  await waitPaused(true);
  const afterPause = await playback();
  assert.ok(afterPause.time >= 3 && afterPause.time < 3.15, `after each line: the pause is at the end of the line, ${afterPause.time}`);
  assert.equal(await line.innerText(), '猫が魚を食べた', 'the line that ended stays on the screen');
  await setStorage({ playMode: 'before' });
  await playFrom(2.5);
  await waitPaused(true);
  const beforePause = await playback();
  assert.ok(beforePause.time >= 3 && beforePause.time < 3.15, `before each line: the pause is at the start of the line, ${beforePause.time}`);
  assert.equal(await line.innerText(), '今日は雨が降っている');
  await setStorage({ playMode: 'iPlusOne', 'w:魚': 'unknown' });
  await seek(2);
  await line.locator('.ml-word.ml-unknown[data-ml-lemma="魚"]').waitFor();
  await playFrom(2);
  await waitPaused(true);
  assert.ok((await playback()).time < 3.15, 'i+1 mode pauses after the line with one unknown word');
  await setStorage({ 'w:魚': 'known' });
  await line.locator('.ml-word.ml-known[data-ml-lemma="魚"]').waitFor();
  await playFrom(2);
  await player.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 3.4);
  assert.equal((await playback()).paused, false, 'i+1 mode plays on after a line with no unknown word');
  await setStorage({ 'w:魚': 'unknown', playMode: 'after', autoResume: '3', autoLookup: true });
  await player.evaluate(() => document.querySelector('video')?.pause());
  await seek(1);
  await line.locator('.ml-word.ml-unknown[data-ml-lemma="魚"]').waitFor();
  await playFrom(1.5);
  await waitPaused(true);
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  console.log('auto lookup: the popup of the first unknown word 魚 opened at the pause');
  await player.keyboard.press('Escape');
  const resumedAt = Date.now();
  await waitPaused(false, 6000);
  console.log('auto resume after', (Date.now() - resumedAt) / 1000, 's');
  await player.evaluate(() => document.querySelector('video')?.pause());
  await setStorage({ playMode: 'normal', autoResume: 'off', autoLookup: false });

  await playFrom(0.5);
  await line.hover({ position: { x: 4, y: 4 } });
  await waitPaused(true);
  await player.mouse.move(0, 0);
  await waitPaused(false);
  console.log('pause on hover: paused while the mouse is on the line, played after');
  await line.locator('.ml-word[data-ml-lemma="魚"]').hover();
  await waitPaused(true);
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await popup.hover();
  await player.waitForTimeout(300);
  assert.equal((await playback()).paused, true, 'the video stays paused while the popup of a subtitle word is open');
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);
  await waitPaused(false);
  await player.evaluate(() => document.querySelector('video')?.pause());
  console.log('pause while the popup is open: the video played again when it closed');

  const addAndWait = async () => {
    const before = anki.requests.length;
    await popup.getByRole('button', { name: 'Add to Anki A' }).click();
    const added = () => anki.requests.slice(before).find(r => at(r, 'action') === 'addNote');
    for (const deadline = Date.now() + 15000; !added() && Date.now() < deadline;) await player.waitForTimeout(100);
    return at(added(), 'params', 'note', 'fields', 'SentenceAudio');
  };
  await playFrom(0.5);
  await line.locator('.ml-word[data-ml-lemma="魚"]').hover();
  await waitPaused(true);
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await popup.hover();
  assert.match(String(await addAndWait()), /^\[sound:minerr-\d+\.webm\]$/, 'the tab records the line while the popup holds the video');
  assert.equal((await playback()).paused, true, 'the video stays paused after the recording while the popup is open');
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);
  await waitPaused(false);
  await player.evaluate(() => document.querySelector('video')?.pause());
  console.log('recording under a popup hold: the video played again when the popup closed');

  await player.evaluate(() => {
    const video = document.querySelector('video');
    if (video) Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1, set: () => undefined });
  });
  await line.locator('.ml-word[data-ml-lemma="魚"]').hover();
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await popup.hover();
  const stalledAt = Date.now();
  assert.equal(await addAndWait(), '', 'a seek that never ends gives a card without sentence audio');
  console.log('stalled seek: the recording gave up after', (Date.now() - stalledAt) / 1000, 's');
  assert.equal((await playback()).paused, true, 'the video stays paused after a recording that gave up');
  await player.evaluate(() => { const video = document.querySelector('video'); if (video) Reflect.deleteProperty(video, 'currentTime'); });
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('PLAYER E2E PASS');
} finally {
  await context.close();
  anki.server.close();
}
