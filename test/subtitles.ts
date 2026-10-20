// End-to-end test of the YouTube subtitle overlay and the WhisperX popup, on a fake YouTube watch page.
// Uses port 8765 (mock AnkiConnect) and 8766 (mock WhisperX server), and ffmpeg for a short test clip.
// Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, PageScreenshotOptions } from 'playwright';
import { at } from '../src/parse.ts';
import { launch, listen, makeDictionary, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-subs-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);

const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=12',
  '-c:v', 'libvpx', '-b:v', '200k', clip]);

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

const SEGMENTS = [
  { start: 0, end: 3, text: '猫が魚を食べなかった。' },
  { start: 3, end: 6, text: '今日は雨が降っています。' },
];
const JOB_STATES = [{ state: 'queued' }, { state: 'downloading' }, { state: 'transcribing', progress: 50 },
  { state: 'transcribing', progress: 50 }, { state: 'done', segments: SEGMENTS }];
// The json3 format of YouTube: a window event, two caption events, and an appended line break.
const JSON3 = JSON.stringify({ events: [
  { tStartMs: 0, dDurationMs: 9000, id: 1 },
  { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: '猫が' }, { utf8: '魚を', tOffsetMs: 400 }, { utf8: '食べた' }] },
  { tStartMs: 1900, dDurationMs: 600, aAppend: 1, segs: [{ utf8: '\n' }] },
  { tStartMs: 2000, dDurationMs: 4000, segs: [{ utf8: '今日は雨' }] },
  { tStartMs: 6000, dDurationMs: 1000, segs: [{ utf8: '［音楽］' }] },
  { tStartMs: 10000, dDurationMs: 1000, segs: [{ utf8: '雨が降る' }] },
] });
const whisperRequests: string[] = [];
let cached = false;
let jobPolls = 0;
const whisper = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    whisperRequests.push(`${req.method} ${req.url}${body ? ` ${body}` : ''}`);
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/health') return reply(200, { ok: true, model: 'large-v3-turbo', device: 'cpu', compute_type: 'int8' });
    if (req.method === 'POST' && req.url === '/jobs') return reply(200, { id: 'job1' });
    if (req.url === '/jobs/job1') return reply(200, JOB_STATES[Math.min(jobPolls++, JOB_STATES.length - 1)]);
    if (req.url === '/subs/testvideo' && cached) return reply(200, SEGMENTS);
    if (req.method === 'POST' && req.url === '/clip') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end('ID3 clip');
    }
    if (req.method === 'POST' && req.url === '/captions' && body.includes('timedvideo') && body.includes('"ja"')) return reply(200, { ext: 'json3', text: JSON3 });
    if (req.method === 'POST' && req.url === '/captions' && body.includes('timedvideo') && body.includes('"en"')) {
      return reply(200, { ext: 'vtt', text: 'WEBVTT\n\n00:00.000 --> 00:02.000\nThe cat ate the fish.\n' });
    }
    reply(404, { error: 'Not found.' });
  });
});
await listen(whisper, 8766);

// A fake watch page with the parts of YouTube's player DOM that the overlay uses. The data URL keeps the clip seekable.
const WATCH = `<!doctype html><meta charset="utf-8"><title>Fake YouTube</title>
<style>
  body { margin: 0; padding: 24px; background: #0f0f0f; color: #f1f1f1; font: 14px sans-serif; }
  #movie_player { position: relative; width: 854px; height: 480px; overflow: hidden; background: #000; }
  .full body { padding: 0; } .full #movie_player { position: fixed; inset: 0; width: auto; height: auto; }
  video { width: 100%; height: 100%; }
  .ytp-chrome-bottom { position: absolute; left: 12px; right: 12px; bottom: 0; z-index: 59; height: 48px;
    border-top: 3px solid #f00; background: rgba(0, 0, 0, .35); }
  .caption-window { position: absolute; left: 50%; bottom: 2%; transform: translateX(-50%); text-align: center; }
  .ytp-caption-segment { font-size: 20px; color: #fff; background: rgba(8, 8, 8, .75); }
</style>
<h1 id="title">猫の動画</h1>
<div id="movie_player">
  <video src="data:video/webm;base64,${readFileSync(clip).toString('base64')}" muted></video>
  <div class="ytp-caption-window-container"><div class="caption-window"><span class="captions-text">
    <span class="caption-visual-line"><span class="ytp-caption-segment">猫が魚を食べなかった</span></span><br>
    <span class="caption-visual-line"><span class="ytp-caption-segment">今日は雨</span></span>
  </span></div></div>
  <div class="ytp-chrome-bottom"></div>
</div>`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const shot = async (target: Page, name: string, options: PageScreenshotOptions = {}) => {
  await target.screenshot({ path: join(out, name), ...options });
  console.log('saved', join(out, name));
};

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 902, height: 528 });
  await tab.goto('https://www.youtube.com/watch?v=testvideo');
  const line = tab.locator('#movie_player .minerr-subs-line');
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), '猫が魚を食べなかった今日は雨');

  const layout = await tab.evaluate(() => {
    const playerElement = document.querySelector('#movie_player');
    const overlayLine = document.querySelector('.minerr-subs-line');
    const native = document.querySelector('.ytp-caption-window-container');
    const segment = document.querySelector('.ytp-caption-segment');
    if (!playerElement || !overlayLine || !native || !segment) throw new Error('The page has no player, overlay, or captions');
    const player = playerElement.getBoundingClientRect();
    const box = overlayLine.getBoundingClientRect();
    return {
      centerOffset: Math.abs((box.left + box.right) / 2 - (player.left + player.right) / 2),
      aboveControls: player.bottom - box.bottom,
      fontSize: parseFloat(getComputedStyle(overlayLine).fontSize),
      nativeFontSize: parseFloat(getComputedStyle(segment).fontSize),
      native: { connected: native.isConnected, opacity: getComputedStyle(native).opacity, pointerEvents: getComputedStyle(native).pointerEvents },
      nativeParsed: native.querySelectorAll('.ml-word').length,
    };
  });
  console.log('overlay layout:', layout);
  assert.ok(layout.centerOffset < 1, 'overlay is centered in the player');
  assert.ok(layout.aboveControls >= 48, 'overlay is above the control bar');
  assert.ok(layout.fontSize > layout.nativeFontSize * 1.2, 'overlay text is larger than the YouTube caption text');
  assert.deepEqual(layout.native, { connected: true, opacity: '0', pointerEvents: 'none' });
  assert.equal(layout.nativeParsed, 0, 'the hidden YouTube captions are not parsed');
  assert.equal(await tab.locator('#title .ml-word').count(), 0, 'the page text of YouTube is off; the overlay is on');
  await shot(tab, 'overlay-player.png');

  const words = await line.locator('.ml-word').evaluateAll(spans => spans.map(s => `${s.textContent}=${s.dataset.mlLemma}`));
  console.log('overlay words:', words);
  assert.deepEqual(words, ['猫=猫', '魚=魚', '食べなかった=食べる', '今日=今日', '雨=雨']);

  await tab.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    document.addEventListener('keydown', event => seen.push(event.key));
  });
  await tab.keyboard.press('d');
  await tab.locator('.minerr-subs-toast', { hasText: 'This key needs subtitles with times.' }).waitFor();
  assert.deepEqual(await tab.evaluate(() => Reflect.get(window, 'seen')), ['d'], 'on mirrored captions YouTube gets the key');

  await tab.evaluate(() => {
    const segment = document.querySelectorAll('.ytp-caption-segment')[1];
    if (!segment) throw new Error('The page has no second caption line');
    segment.textContent = '魚が好き';
  });
  await line.locator('.ml-word[data-ml-lemma="好き"]').waitFor();
  assert.equal(await line.innerText(), '猫が魚を食べなかった魚が好き');
  console.log('overlay after the caption changed:', JSON.stringify(await line.innerText()));

  const offState = () => tab.evaluate(() => {
    const overlay = document.querySelector('.minerr-subs');
    const native = document.querySelector('.ytp-caption-window-container');
    if (!overlay || !native) throw new Error('The page has no overlay or captions');
    return { overlay: getComputedStyle(overlay).display, native: getComputedStyle(native).opacity };
  });
  await options.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await tab.waitForFunction(() => document.documentElement.hasAttribute('data-minerr-off'));
  assert.deepEqual(await offState(), { overlay: 'none', native: '1' });
  await options.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-minerr-off'));
  assert.deepEqual(await offState(), { overlay: 'block', native: '0' });
  console.log('Minerr off: YouTube captions back, overlay hidden; on: overlay back');

  await tab.hover('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]');
  const popup = tab.locator('minerr-popup .popup');
  await popup.locator('li', { hasText: 'to eat (fixture)' }).waitFor();
  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  const sentence = at(ankiRequests.find(r => at(r, 'action') === 'addNote'), 'params', 'note', 'fields', 'Sentence');
  console.log('card sentence from the overlay:', sentence);
  assert.equal(sentence, '猫が魚を<b>食べなかった</b>魚が好き', 'the rows of mirrored captions are one sentence');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  await tab.evaluate(() => document.documentElement.classList.add('full'));
  await tab.setViewportSize({ width: 1920, height: 1080 });
  const fullSize = await line.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  console.log('overlay font size: player 854x480', layout.fontSize, 'px, player 1920x1080', fullSize, 'px');
  assert.ok(fullSize > layout.fontSize * 1.8, 'the overlay grows with the player');
  await shot(tab, 'overlay-fullscreen.png');
  await tab.evaluate(() => document.documentElement.classList.remove('full'));
  await tab.setViewportSize({ width: 902, height: 528 });

  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0]?.id);
  assert.equal(typeof tabId, 'number');
  const action = await context.newPage();
  await action.setViewportSize({ width: 340, height: 200 });
  await action.goto(`chrome-extension://${extensionId}/action.html?tab=${tabId}`);
  await action.locator('#server.ok').waitFor();
  assert.equal(await action.textContent('#server'), 'WhisperX server is running: large-v3-turbo on the CPU.');
  assert.equal(await action.textContent('[aria-pressed="true"]'), 'YouTube captions');
  assert.ok(await action.locator('[data-source="whisperx"]').isDisabled());
  await shot(action, 'action-youtube-light.png', { fullPage: true });

  await action.click('#generate');
  await action.locator('#job', { hasText: 'Transcribing… 50%' }).waitFor({ timeout: 10000 });
  assert.equal(await action.locator('#progress').evaluate((p: HTMLProgressElement) => p.value), 50);
  console.log('popup while the job runs:', await action.textContent('#job'));
  await shot(action, 'action-progress-light.png', { fullPage: true });
  await action.emulateMedia({ colorScheme: 'dark' });
  await shot(action, 'action-progress-dark.png', { fullPage: true });
  await action.locator('#job', { hasText: 'The WhisperX subtitles are ready.' }).waitFor({ timeout: 10000 });
  assert.equal(await action.textContent('[aria-pressed="true"]'), 'WhisperX');
  assert.ok(await action.locator('#generate').isHidden());
  await shot(action, 'action-done-dark.png', { fullPage: true });
  console.log('WhisperX requests:', whisperRequests.filter(r => !r.endsWith('/health')));
  assert.ok(whisperRequests.includes('POST /jobs {"url":"https://www.youtube.com/watch?v=testvideo"}'));

  await tab.bringToFront();
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.equal(await line.innerText(), '猫が魚を食べなかった。');
  await tab.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.currentTime = 4;
  });
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  assert.equal(await line.innerText(), '今日は雨が降っています。');
  console.log('WhisperX overlay after a seek to 4 s:', await line.innerText());
  await tab.keyboard.press('ArrowLeft');
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 0);
  assert.deepEqual(await tab.evaluate(() => Reflect.get(window, 'seen')), ['d'], 'with timed lines Minerr takes the key, not YouTube');

  await action.click('[data-source="youtube"]');
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べなかった魚が好き');
  console.log('switched back to the YouTube captions');

  cached = true;
  await tab.reload();
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べなかった。');
  console.log('after a reload: cached WhisperX subtitles shown without a new job');
  await tab.evaluate(() => {
    history.pushState({}, '', '/watch?v=othervideo');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べなかった今日は雨');
  for (let i = 0; i < 50 && !whisperRequests.includes('GET /subs/othervideo'); i++) await tab.waitForTimeout(100);
  assert.ok(whisperRequests.includes('GET /subs/othervideo'));
  console.log('after navigation to a video with no WhisperX subtitles: YouTube captions again');

  await tab.evaluate(() => {
    history.pushState({}, '', '/watch?v=timedvideo');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べた');
  assert.ok(whisperRequests.includes('POST /captions {"url":"https://www.youtube.com/watch?v=timedvideo","lang":"ja"}'));
  await tab.locator('.minerr-subs-second', { hasText: 'The cat ate the fish.' }).waitFor();
  console.log('YouTube second track: the English subtitles show under the Japanese line');
  await tab.keyboard.press('ArrowRight');
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '今日は雨');
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 2);
  console.log('YouTube subtitles with times from the server: the overlay follows them, and ArrowRight goes to the next line');
  await tab.evaluate(() => {
    const keys: string[] = [];
    Object.assign(window, { pageKeys: keys });
    document.addEventListener('keydown', event => keys.push(event.key));
  });
  const pageKeys = () => tab.evaluate(() => Reflect.get(window, 'pageKeys'));
  await tab.evaluate(() => document.querySelector('#movie_player')?.classList.add('ad-showing'));
  await tab.keyboard.press('ArrowRight');
  assert.deepEqual(await pageKeys(), ['ArrowRight'], 'during an ad, YouTube gets the line keys');
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 2);
  await tab.evaluate(() => document.querySelector('#movie_player')?.classList.remove('ad-showing'));
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  await tab.keyboard.press('Shift+N');
  assert.deepEqual(await pageKeys(), ['ArrowRight', 'Shift', 'N'], 'YouTube gets Shift+N (next video) while no popup is open');
  assert.equal(await popup.isVisible(), false);
  console.log('YouTube keys: the line keys go to YouTube during an ad, and Shift+N always goes to YouTube without a popup');
  await tab.hover('.minerr-subs-line .ml-word[data-ml-lemma="雨"]');
  await popup.locator('.add').waitFor();
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.ok(whisperRequests.includes('POST /clip {"url":"https://www.youtube.com/watch?v=timedvideo","start":1.5,"end":6.5}'));
  const lastNote = at(ankiRequests.filter(r => at(r, 'action') === 'addNote').at(-1), 'params', 'note');
  const stored = ankiRequests.filter(r => at(r, 'action') === 'storeMediaFile' && !String(at(r, 'params', 'filename')).endsWith('.jpg'));
  assert.equal(stored.length, 1, 'only the card from the timed line stores audio');
  assert.equal(at(stored[0], 'params', 'data'), Buffer.from('ID3 clip').toString('base64'));
  assert.equal(at(lastNote, 'fields', 'SentenceAudio'), `[sound:${String(at(stored[0], 'params', 'filename'))}]`);
  const firstNote = at(ankiRequests.find(r => at(r, 'action') === 'addNote'), 'params', 'note');
  assert.equal(at(firstNote, 'fields', 'SentenceAudio'), '', 'a card from mirrored captions has no line audio');
  console.log('YouTube card: the server cut the line audio from the video');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  const setStorage = (items: Record<string, unknown>) => worker.evaluate(value => chrome.storage.local.set(value), items);
  const lineStyle = () => line.evaluate(node => ({ filter: getComputedStyle(node).filter, color: getComputedStyle(node).color }));
  const playVideo = (time: number) => tab.evaluate(t => {
    const video = document.querySelector('video');
    if (!video) throw new Error('The page has no video');
    video.currentTime = t;
    return video.play();
  }, time);
  const pauseVideo = () => tab.evaluate(() => document.querySelector('video')?.pause());
  await setStorage({ subObscured: true, pauseOnHover: false });
  await tab.locator('.minerr-subs[data-obscure="blur"][data-paused]').waitFor();
  assert.equal((await lineStyle()).filter, 'none', 'a paused video shows the text');
  await playVideo(2.2);
  await tab.locator('.minerr-subs[data-obscure="blur"]:not([data-paused])').waitFor();
  assert.match((await lineStyle()).filter, /^blur/);
  await line.hover();
  assert.equal((await lineStyle()).filter, 'none', 'hover shows the text');
  await tab.mouse.move(0, 0);
  await setStorage({ subEffect: 'hide' });
  await tab.locator('.minerr-subs[data-obscure="hide"]').waitFor();
  assert.deepEqual(await lineStyle(), { filter: 'none', color: 'rgba(0, 0, 0, 0)' });
  await tab.keyboard.press('w');
  await tab.locator('.minerr-subs:not([data-obscure])').waitFor();
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('subObscured')), { subObscured: false });
  await pauseVideo();
  console.log('obscured subtitles: blurred or hidden while the video plays, shown on hover and pause; W turns it off');

  await tab.evaluate(() => { const video = document.querySelector('video'); if (video) video.currentTime = 6.5; });
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '［音楽］');
  await setStorage({ cleanSubs: true });
  await line.waitFor({ state: 'hidden' });
  console.log('bracketed text removed: the line ［音楽］ does not show');

  const crossGap = async () => {
    const started = Date.now();
    await playVideo(6.5);
    await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '雨が降る', null, { timeout: 8000 });
    const rate = await tab.evaluate(() => document.querySelector('video')?.playbackRate);
    await pauseVideo();
    return { seconds: (Date.now() - started) / 1000, rate };
  };
  await setStorage({ gapMode: 'skip' });
  const skipped = await crossGap();
  await setStorage({ gapMode: 'x4' });
  await tab.evaluate(() => { const video = document.querySelector('video'); if (video) video.currentTime = 6.5; });
  await playVideo(6.5);
  await tab.waitForFunction(() => document.querySelector('video')?.playbackRate === 4);
  await pauseVideo();
  const fast = await crossGap();
  await setStorage({ gapMode: 'off' });
  const normal = await crossGap();
  console.log('a 4 s gap with no line: skip', skipped, 'x4', fast, 'normal', normal);
  assert.ok(skipped.seconds < 1.5, 'skip jumps to 0.5 s before the next line');
  assert.ok(fast.seconds < 2.5 && fast.rate === 1, 'x4 crosses the gap faster and plays the line at the normal speed');
  assert.ok(normal.seconds > 3.2, 'without a gap mode the gap plays at the normal speed');
  await setStorage({ cleanSubs: false });

  await new Promise(resolve => whisper.close(resolve));
  whisper.closeAllConnections();
  await action.emulateMedia({ colorScheme: 'light' });
  await action.locator('#server.error').waitFor({ timeout: 5000 });
  assert.equal(await action.textContent('#server'), 'Start the WhisperX server: uv run server/whisper_server.py');
  await shot(action, 'action-server-down-light.png', { fullPage: true });

  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Not YouTube</p>' }));
  await (await context.newPage()).goto('https://example.com/');
  const otherTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://example.com/*' }))[0]?.id);
  assert.equal(typeof otherTabId, 'number');
  const elsewhere = await context.newPage();
  await elsewhere.goto(`chrome-extension://${extensionId}/action.html?tab=${otherTabId}`);
  await elsewhere.locator('#elsewhere:not([hidden])').waitFor();
  assert.ok(await elsewhere.locator('#controls').isHidden());

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('SUBTITLES E2E PASS');
} finally {
  await context.close();
  anki.close();
  whisper.close();
}
