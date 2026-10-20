// End-to-end test of the i+1 highlight and the local video player.
// Uses port 8765 (mock AnkiConnect) and 8766 (mock WhisperX server), and ffmpeg for a short test clip.
// Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, PageScreenshotOptions } from 'playwright';
import { at } from '../src/parse.ts';
import { launch, listen, makeDictionary, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-media-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);

const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', clip]);
const srt = join(work, 'clip.srt');
writeFileSync(srt, '1\n00:00:00,000 --> 00:00:03,000\n猫が魚を食べた\n\n2\n00:00:03,000 --> 00:00:06,000\n今日は雨が降っている\n');

const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
]);

const ankiRequests: unknown[] = [];
const ankiReplies: Record<string, (params: unknown) => unknown> = {
  createDeck: () => 1, modelNames: () => ['Basic'], createModel: () => ({}), addNote: () => 1700000000000, storeMediaFile: params => at(params, 'filename'),
};
const anki = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const request: unknown = JSON.parse(body);
    ankiRequests.push(request);
    const action = at(request, 'action');
    const handler = typeof action === 'string' ? ankiReplies[action] : undefined;
    if (!handler) throw new Error(`The mock has no action ${String(action)}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result: handler(at(request, 'params')), error: null }));
  });
});
await listen(anki, 8765);

const SEGMENTS = [{ start: 0, end: 3, text: '猫が魚を食べた。' }, { start: 3, end: 6.5, text: '今日は雨が降っている。' }];
const JOB_STATES = [{ state: 'queued' }, { state: 'transcribing', progress: 40 }, { state: 'transcribing', progress: 40 },
  { state: 'transcribing', progress: 40 }, { state: 'done', progress: 100, segments: SEGMENTS }];
const uploads: { type: string | undefined; filename: string | undefined; sha256: string; size: number }[] = [];
let jobPolls = 0;
const clips: unknown[] = [];
const CLIP = Buffer.from('ID3 fake mp3');
const whisper = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.method === 'POST' && req.url === '/files') {
      const body = Buffer.concat(chunks);
      const sha256 = createHash('sha256').update(body).digest('hex');
      uploads.push({ type: req.headers['content-type'], filename: req.headers['x-filename']?.toString(), sha256, size: body.length });
      return reply(200, { id: 'file1', sha256 });
    }
    if (req.url === '/jobs/file1') return reply(200, JOB_STATES[Math.min(jobPolls++, JOB_STATES.length - 1)]);
    if (req.method === 'POST' && req.url === '/clip') {
      clips.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(CLIP);
    }
    reply(404, { error: 'Not found.' });
  });
});
await listen(whisper, 8766);

// A fake YouTube watch page with the parts of the player DOM that the overlay uses.
const WATCH = `<!doctype html><meta charset="utf-8"><title>Fake YouTube</title>
<style>
  body { margin: 0; padding: 24px; background: #0f0f0f; }
  #movie_player { position: relative; width: 854px; height: 480px; overflow: hidden; background: #000; }
  video { width: 100%; height: 100%; }
</style>
<div id="movie_player">
  <video src="data:video/webm;base64,${readFileSync(clip).toString('base64')}" muted></video>
  <div class="ytp-caption-window-container"><span class="captions-text">
    <span class="caption-visual-line">猫が魚を食べなかった。</span><br><span class="caption-visual-line">今日は雨</span>
  </span></div>
</div>`;

const ARTICLE = `<p id="a">猫が魚を食べた。今日は雨が降っている。</p><p id="b">本を<b>読む</b>。</p>`;
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const dark = req.url === '/dark';
  res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px 32px;font:22px/1.9 sans-serif;
    ${dark ? 'background:#16161a;color:#e8e8ea' : 'background:#fff;color:#222'}">${ARTICLE}</body>`);
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const shot = async (target: Page, name: string, options: PageScreenshotOptions = {}) => {
  await target.screenshot({ path: join(out, name), ...options });
  console.log('saved', join(out, name));
};
const setStorage = (items: Record<string, unknown>) => worker.evaluate(value => chrome.storage.local.set(value), items);
// The text of each range of the i+1 highlight, or null when the page has no such highlight.
const highlighted = (page: Page) => page.evaluate(() => {
  const found = CSS.highlights.get('minerr-i1');
  return found ? [...found].map(range => range.toString()) : null;
});
const waitHighlighted = (page: Page, expected: string[] | null) => page.waitForFunction(json => {
  const found = CSS.highlights.get('minerr-i1');
  return JSON.stringify(found ? [...found].map(range => range.toString()) : null) === json;
}, JSON.stringify(expected), { timeout: 5000 }).catch(async error => {
  throw new Error(`highlight is ${JSON.stringify(await highlighted(page))}, expected ${JSON.stringify(expected)}: ${error}`);
});

try {
  await setStorage({ 'w:猫': 'known', 'w:食べる': 'known' });
  const tab = await context.newPage();
  await tab.setViewportSize({ width: 760, height: 220 });
  await tab.goto(`${pageUrl}/light`);
  await tab.waitForSelector('#b .ml-word[data-ml-lemma="読む"]', { timeout: 20000 });
  await waitHighlighted(tab, ['猫が魚を食べた。']);
  console.log('i+1 highlight:', await highlighted(tab));
  await shot(tab, 'iplusone-light.png');

  await setStorage({ 'w:読む': 'known' });
  await waitHighlighted(tab, ['猫が魚を食べた。', '本を読む。']);
  await setStorage({ 'w:魚': 'known' });
  await waitHighlighted(tab, ['本を読む。']);
  console.log('after 読む and 魚 became known:', await highlighted(tab));

  const action = await context.newPage();
  await action.setViewportSize({ width: 340, height: 200 });
  await action.goto(`chrome-extension://${extensionId}/action.html`);
  const toggle = action.locator('#iplusone');
  assert.equal(await toggle.isChecked(), true);
  await shot(action, 'action-light.png', { fullPage: true });
  await action.emulateMedia({ colorScheme: 'dark' });
  await shot(action, 'action-dark.png', { fullPage: true });
  await toggle.click();
  await waitHighlighted(tab, null);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('iPlusOne')), { iPlusOne: false });
  await toggle.click();
  await waitHighlighted(tab, ['本を読む。']);
  console.log('toolbar toggle off: no highlight; on: highlight back');

  await setStorage({ enabled: false });
  await waitHighlighted(tab, null);
  const power = action.locator('#enabled');
  await action.waitForFunction(() => !(document.querySelector('#enabled') as HTMLInputElement).checked);
  await power.click();
  await waitHighlighted(tab, ['本を読む。']);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('enabled')), { enabled: true });
  console.log('Minerr off: no highlight; the toolbar switch turns it on: highlight back');

  await setStorage({ 'w:魚': 'unknown', 'w:読む': 'unknown' });
  const dark = await context.newPage();
  await dark.setViewportSize({ width: 760, height: 220 });
  await dark.goto(`${pageUrl}/dark`);
  await waitHighlighted(dark, ['猫が魚を食べた。']);
  await shot(dark, 'iplusone-dark.png');

  const youtube = await context.newPage();
  await youtube.setViewportSize({ width: 902, height: 528 });
  await youtube.goto('https://www.youtube.com/watch?v=testvideo');
  await youtube.locator('.minerr-subs-line .ml-word[data-ml-lemma="雨"]').waitFor({ timeout: 20000 });
  await waitHighlighted(youtube, ['猫が魚を食べなかった。']);
  console.log('i+1 highlight in the YouTube overlay:', await highlighted(youtube));
  const youtubeTab = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, youtube.url());
  const youtubeMenu = await context.newPage();
  await youtubeMenu.goto(`chrome-extension://${extensionId}/action.html?tab=${youtubeTab}`);
  await youtubeMenu.locator('#score').waitFor();
  assert.match(await youtubeMenu.innerText('#score-basis'), /^5 words in the 1 subtitle lines that the overlay showed\./);
  await youtubeMenu.close();
  console.log('toolbar menu on mirrored YouTube captions: the score of the lines that showed');
  await shot(youtube, 'iplusone-youtube.png');
  await youtube.close();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const shown = await highlighted(tab);
  assert.ok(shown?.length, 'the tab has an i+1 highlight');
  assert.equal(await options.isChecked('#iplusone'), true);
  await options.uncheck('#iplusone');
  await waitHighlighted(tab, null);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('iPlusOne')), { iPlusOne: false });
  await options.check('#iplusone');
  await waitHighlighted(tab, shown);
  console.log('options i+1 checkbox off: no highlight; on: highlight back');
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  await options.close();

  const player = await context.newPage();
  await player.setViewportSize({ width: 1000, height: 720 });
  await player.goto(`chrome-extension://${extensionId}/player.html`);
  await shot(player, 'player-empty-light.png');
  await player.emulateMedia({ colorScheme: 'dark' });
  await shot(player, 'player-empty-dark.png');
  await player.emulateMedia({ colorScheme: 'light' });

  await player.setInputFiles('#video-file', clip);
  await player.setInputFiles('#subs-file', srt);
  const status = player.locator('#status');
  await status.filter({ hasText: 'Subtitles from clip.srt: 2 lines.' }).waitFor();
  const line = player.locator('.minerr-subs-line');
  const seek = (time: number) => player.evaluate(t => new Promise(resolve => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = t;
  }), time);
  await seek(4);
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), '今日は雨が降っている');
  await seek(1);
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.equal(await line.innerText(), '猫が魚を食べた');
  const words = await line.locator('.ml-word').evaluateAll(spans => spans.map(s => `${s.textContent}=${s.dataset.mlLemma}`));
  console.log('player overlay at 1 s:', await line.innerText(), words);
  assert.deepEqual(words, ['猫=猫', '魚=魚', '食べた=食べる']);
  await waitHighlighted(player, ['猫が魚を食べた']);
  await player.click('#fullscreen');
  assert.equal(await player.evaluate(() => document.fullscreenElement?.id), 'watch');
  await player.evaluate(() => document.exitFullscreen());
  await shot(player, 'player-video-light.png');
  await player.emulateMedia({ colorScheme: 'dark' });
  await shot(player, 'player-video-dark.png');
  await player.emulateMedia({ colorScheme: 'light' });

  await line.locator('.ml-word[data-ml-lemma="魚"]').hover();
  const popup = player.locator('minerr-popup .popup');
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await shot(player, 'player-popup-light.png');
  await player.keyboard.press('3');
  await line.locator('.ml-word[data-ml-lemma="魚"].ml-known').waitFor();
  await player.keyboard.press('1');
  await line.locator('.ml-word[data-ml-lemma="魚"].ml-unknown').waitFor();
  console.log('player popup: key 3 made 魚 known, key 1 made it unknown again');
  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message').filter({ hasText: /./ }).waitFor();
  assert.equal(await popup.locator('.message').innerText(), 'Added to Anki.');
  const note = at(ankiRequests.find(r => at(r, 'action') === 'addNote'), 'params', 'note');
  const storedFile = (extension: string) => at(ankiRequests.find(r => at(r, 'action') === 'storeMediaFile'
    && String(at(r, 'params', 'filename')).endsWith(extension)), 'params');
  const picture = at(storedFile('.jpg'), 'data');
  assert.ok(typeof picture === 'string', 'picture data is a string');
  writeFileSync(join(out, 'player-card.jpg'), Buffer.from(picture, 'base64'));
  console.log('player card sentence:', at(note, 'fields', 'Sentence'), 'picture:', `${picture.length} base64 chars, saved to`, join(out, 'player-card.jpg'));
  assert.equal(at(note, 'fields', 'Sentence'), '猫が<b>魚</b>を食べた');
  assert.ok(picture.startsWith('/9j/'), 'picture is base64 JPEG');
  const recorded = storedFile('.webm');
  console.log('player card audio without the server:', at(recorded, 'filename'), String(at(recorded, 'data')).length, 'base64 chars');
  assert.match(String(at(recorded, 'filename')), /^minerr-\d+\.webm$/);
  assert.ok(String(at(recorded, 'data')).startsWith('GkXf'), 'the recorded line audio is a WebM file');
  assert.equal(at(note, 'fields', 'SentenceAudio'), `[sound:${String(at(recorded, 'filename'))}]`);
  const webm = join(out, 'player-line.webm');
  writeFileSync(webm, Buffer.from(String(at(recorded, 'data')), 'base64'));
  const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', webm, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
  console.log('recorded line audio:', pcm.length / 16000, 's, saved to', webm);
  assert.ok(Math.abs(pcm.length / 16000 - 3.5) < 0.4, 'the recording is the line (0 to 3 s) with 0.5 s after it');
  assert.deepEqual(clips, [], 'the player has no server audio of a file that it did not send');
  assert.equal(await player.evaluate(() => document.querySelector('video')?.currentTime), 1, 'the video goes back after the recording');
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);

  const videoTime = () => player.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  const toast = player.locator('.minerr-subs-toast');

  await player.setInputFiles('#video-file', clip);
  await status.filter({ hasText: 'No subtitles.' }).waitFor();
  assert.equal(await line.isHidden(), true, 'a new video starts without subtitles');
  await player.click('#generate');
  await status.filter({ hasText: 'Transcribing… 40%' }).waitFor({ timeout: 10000 });
  assert.equal(await player.locator('#progress').evaluate((p: HTMLProgressElement) => p.value), 40);
  await shot(player, 'player-progress-light.png');
  await player.emulateMedia({ colorScheme: 'dark' });
  await shot(player, 'player-progress-dark.png');
  await player.emulateMedia({ colorScheme: 'light' });
  await status.filter({ hasText: 'WhisperX subtitles: 2 lines.' }).waitFor({ timeout: 10000 });
  const clipBytes = readFileSync(clip);
  assert.deepEqual(uploads, [{ type: 'application/octet-stream', filename: 'clip.webm', size: clipBytes.length,
    sha256: createHash('sha256').update(clipBytes).digest('hex') }]);
  console.log('upload to the mock WhisperX server:', uploads);
  await seek(4);
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  assert.equal(await line.innerText(), '今日は雨が降っている。');
  console.log('WhisperX overlay at 4 s:', await line.innerText());
  await line.locator('.ml-word[data-ml-lemma="雨"]').hover();
  await popup.locator('.add').waitFor();
  await player.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const clipNote = at(ankiRequests.filter(r => at(r, 'action') === 'addNote').at(-1), 'params', 'note');
  assert.deepEqual(clips, [{ sha256: uploads[0]?.sha256, start: 2.5, end: 7 }], 'the server cuts the line with 0.5 s on each side');
  const stored = at(ankiRequests.filter(r => at(r, 'action') === 'storeMediaFile').at(-1), 'params');
  assert.match(String(at(stored, 'filename')), /^minerr-\d+\.mp3$/);
  assert.equal(at(stored, 'data'), CLIP.toString('base64'));
  assert.equal(at(clipNote, 'fields', 'SentenceAudio'), `[sound:${String(at(stored, 'filename'))}]`);
  console.log('player card audio from the server:', clips);
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);
  await seek(1);
  await player.keyboard.press('j');
  await player.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べた。\n今日は雨が降っている。');
  await line.locator('.ml-word[data-ml-lemma="雨"]').hover();
  await popup.locator('.add').waitFor();
  await player.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const joined = at(ankiRequests.filter(r => at(r, 'action') === 'addNote').at(-1), 'params', 'note');
  assert.equal(at(joined, 'fields', 'Sentence'), '猫が魚を食べた。 今日は<b>雨</b>が降っている。');
  assert.deepEqual(clips.at(-1), { sha256: uploads[0]?.sha256, start: 0, end: 7 }, 'the audio spans both lines');
  console.log('J joined two lines: the card has both lines and their audio');
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);
  await player.keyboard.press('j');
  await player.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べた。');

  await setStorage({ 'w:魚': 'unknown', 'w:雨': 'learning', 'w:今日': 'unknown', 'w:降る': 'unknown' });
  await player.keyboard.press('g');
  const browser = player.locator('.minerr-lines');
  await browser.waitFor();
  const visibleRows = () => browser.locator('li:not([hidden]) .text').allInnerTexts();
  assert.deepEqual(await visibleRows(), ['猫が魚を食べた。', '今日は雨が降っている。']);
  await browser.locator('li .ml-word[data-ml-lemma="雨"].ml-learning').first().waitFor();
  await shot(player, 'sidebar-player-light.png');
  await player.emulateMedia({ colorScheme: 'dark' });
  await shot(player, 'sidebar-player-dark.png');
  await player.emulateMedia({ colorScheme: 'light' });
  await browser.locator('li time').nth(1).click();
  assert.equal(await videoTime(), 3, 'a click on a line goes to it');
  await player.keyboard.press('b');
  await toast.filter({ hasText: 'Bookmarked the line.' }).waitFor();
  await browser.getByRole('button', { name: 'Bookmarks' }).click();
  assert.deepEqual(await visibleRows(), ['今日は雨が降っている。']);
  await browser.locator('li .ml-word[data-ml-lemma="雨"].ml-learning').first().waitFor();
  await browser.getByRole('button', { name: 'Learning' }).click();
  assert.deepEqual(await visibleRows(), ['今日は雨が降っている。']);
  await browser.getByRole('button', { name: '1 unknown word' }).click();
  await player.waitForFunction(() => [...document.querySelectorAll('.minerr-lines li:not([hidden]) .text')].map(n => n.textContent).join() === '猫が魚を食べた。');
  const bookmarkKey = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('bm:')));
  assert.equal(bookmarkKey.length, 1);
  assert.deepEqual(await worker.evaluate(key => chrome.storage.local.get(key), bookmarkKey[0] ?? ''), { [bookmarkKey[0] ?? '']: [3] });
  await browser.locator('li .ml-word[data-ml-lemma="魚"]').hover();
  await popup.locator('li', { hasText: 'fish (fixture)' }).waitFor();
  await player.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.deepEqual(clips.at(-1), { sha256: uploads[0]?.sha256, start: 0, end: 3.5 }, 'a word in the browser gets the audio of its row');
  await shot(player, 'player-browser.png');
  await player.keyboard.press('Escape');
  await player.mouse.move(0, 0);
  await player.keyboard.press('g');
  await browser.waitFor({ state: 'hidden' });
  console.log('subtitle sidebar: click to seek, bookmarks, filters, and a card from a row');

  const [download] = await Promise.all([player.waitForEvent('download'), player.click('#save')]);
  const saved = readFileSync(await download.path(), 'utf8');
  console.log('saved subtitles:', download.suggestedFilename(), JSON.stringify(saved));
  assert.equal(download.suggestedFilename(), 'clip.srt');
  assert.equal(saved, '1\n00:00:00,000 --> 00:00:03,000\n猫が魚を食べた。\n\n2\n00:00:03,000 --> 00:00:06,500\n今日は雨が降っている。\n');

  // The cost of one i+1 pass on a long page: 2,000 sentences in 200 paragraphs, on this page, where the module runs in the page.
  const POOL = ['猫が魚を食べた。', '今日は雨が降っている。', '本を読む。', '彼は駅まで歩いて行った。', '明日は友達と映画を見る予定です。',
    '先生の説明はとても分かりやすかった！', '「静かにしてください」と母が言った。', '新しい仕事に慣れるまで時間がかかる。', 'この料理は少し辛いですか？', '窓を開けると冷たい風が入ってきた。'];
  await setStorage({ 'w:今日': 'known', 'w:降る': 'known', 'w:読む': 'known', 'w:彼': 'known', 'w:歩く': 'known', 'w:行く': 'known' });
  await player.evaluate(pool => {
    const long = document.createElement('div');
    long.id = 'long';
    for (let p = 0; p < 200; p++) {
      const paragraph = document.createElement('p');
      paragraph.textContent = Array.from({ length: 10 }, (_, i) => pool[(p + i * 3) % pool.length]).join('');
      long.append(paragraph);
    }
    document.body.append(long);
  }, POOL);
  await player.waitForSelector('#long p:last-child .ml-word', { timeout: 60000 });
  await player.waitForTimeout(500);
  const cost = await player.evaluate(async () => {
    const module: { refresh?: unknown } = await import(chrome.runtime.getURL('src/iplusone.js'));
    const { refresh } = module;
    if (typeof refresh !== 'function') throw new Error('src/iplusone.js exports no refresh');
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      refresh();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      words: document.querySelectorAll('#long .ml-word').length,
      ranges: CSS.highlights.get('minerr-i1')?.size ?? 0,
      medianMs: Number(times[7]?.toFixed(1)),
      maxMs: Number(times.at(-1)?.toFixed(1)),
    };
  });
  console.log('i+1 pass over 2,000 sentences:', cost);
  assert.ok(cost.ranges > 200, 'the long page has i+1 sentences');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('MEDIA E2E PASS');
} finally {
  await context.close();
  site.close();
  anki.close();
  whisper.close();
}
