// End-to-end test of the YouTube subtitle overlay and the WhisperX popup, on a fake YouTube watch page.
// Uses port 8765 (mock AnkiConnect) and 8766 (mock WhisperX server), and ffmpeg for a short test clip.
// Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, PageScreenshotOptions } from 'playwright';
import { at } from '../src/shared/guards.ts';
import { CLICK_KEY, START_LIMIT_MS } from '../src/video/server-status.ts';
import { launch, listen, makeDictionary, openSidebar, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-subs-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);

const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=12',
  '-f', 'lavfi', '-i', 'sine=frequency=300:duration=12', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', clip]);

const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
]);

const ankiRequests: unknown[] = [];
const ankiReplies: Record<string, (params: unknown) => unknown> = {
  createDeck: () => 1, modelNames: () => ['Basic'], createModel: () => ({}), addNote: () => 1700000000000, storeMediaFile: params => at(params, 'filename'),
  // The popup asks for the number of notes of its word.
  findNotes: () => [],
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
let otherProgram = false;
const whisper = createServer((req, res) => {
  if (otherProgram) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<p>Not found</p>');
  }
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
const WATCH = `<!doctype html><html dark><meta charset="utf-8"><title>Fake YouTube</title>
<style>
  body { margin: 0; background: #0f0f0f; color: #f1f1f1; font: 14px sans-serif; }
  html:not([dark]) body { background: #fff; color: #0f0f0f; }
  /* As on YouTube: the app is absolute, so a margin of the root does not make it narrower, and the masthead is fixed.
     In the two-column view, the columns are as wide as the smallest player and the recommended videos together. */
  ytd-app { position: absolute; top: 0; left: 0; display: block; box-sizing: border-box; width: 100%; padding: 24px; }
  #columns { display: flex; flex-wrap: wrap; gap: 24px; }
  @media (min-width: 1000px) { #columns { min-width: 1221px; } }
  #secondary { width: 402px; }
  #masthead-container { position: fixed; top: 0; width: 100%; height: 24px; display: flex; justify-content: space-between; background: #212121; }
  ytd-watch-flexy[theater] #full-bleed-container { margin: 0 -24px 24px; height: 56.25vw; max-height: calc(100vh - 169px); }
  ytd-watch-flexy[theater] #movie_player { width: 100%; height: 100%; }
  #movie_player { position: relative; width: 854px; height: 480px; overflow: hidden; background: #000; user-select: none; }
  .full ytd-app { padding: 0; } .full #movie_player { position: fixed; inset: 0; width: auto; height: auto; }
  video { width: 100%; height: 100%; }
  .ytp-chrome-bottom { position: absolute; left: 12px; right: 12px; bottom: 0; z-index: 59; height: 48px;
    border-top: 3px solid #f00; background: rgba(0, 0, 0, .35); }
  .caption-window { position: absolute; left: 50%; bottom: 2%; transform: translateX(-50%); text-align: center; }
  .ytp-caption-segment { font-size: 20px; color: #fff; background: rgba(8, 8, 8, .75); }
</style>
<ytd-app><div id="masthead-container"><span>YouTube</span><span id="avatar">Avatar</span></div>
<h1 id="title">猫の動画</h1>
<ytd-watch-flexy><div id="full-bleed-container"></div><div id="columns"><div id="primary">
<div id="movie_player">
  <video src="data:video/webm;base64,${readFileSync(clip).toString('base64')}" muted></video>
  <div class="ytp-caption-window-container"><div class="caption-window"><span class="captions-text">
    <span class="caption-visual-line"><span class="ytp-caption-segment">猫が魚を食べなかった</span></span><br>
    <span class="caption-visual-line"><span class="ytp-caption-segment">今日は雨</span></span>
  </span></div></div>
  <div class="ytp-chrome-bottom"></div>
</div>
</div><div id="secondary"><div id="related">Recommended videos</div></div></div></ytd-watch-flexy></ytd-app>
<script>
  // As the player of YouTube: the caption tracks of the video, and a caption request when the captions module shows a track.
  // Its first request has no token yet, and it asks for a shown track again only after a reload of the module.
  const TRACKS = { tabvideo: [['ja', 'asr'], ['ja', null]], englishvideo: [['en', 'asr']] };
  const player = document.getElementById('movie_player');
  const videoId = () => new URLSearchParams(location.search).get('v');
  const tracks = () => (TRACKS[videoId()] || []).map(([languageCode, kind]) => ({ languageCode, kind, vssId: (kind ? 'a.' : '.') + languageCode,
    baseUrl: 'https://www.youtube.com/api/timedtext?v=' + videoId() + '&lang=' + languageCode + (kind ? '&kind=' + kind : '') }));
  window.asked = {};
  let shown = null;
  let requests = 0;
  player.getPlayerResponse = () => {
    window.asked[videoId()] = (window.asked[videoId()] || 0) + 1;
    return { videoDetails: { videoId: videoId() }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks() } } };
  };
  player.loadModule = () => undefined;
  player.unloadModule = () => { shown = null; };
  player.setOption = (module, option, value) => {
    const track = tracks().find(t => t.vssId === value.vss_id);
    if (!track || shown === track.vssId) return;
    shown = track.vssId;
    // As YouTube: the shown track becomes the caption language of later videos.
    localStorage.setItem('yt-player-caption-sticky-language', JSON.stringify({ data: track.languageCode }));
    const request = new XMLHttpRequest();
    request.open('GET', track.baseUrl + '&fmt=json3' + (requests++ ? '&pot=token-' + videoId() : ''));
    request.send();
  };
</script>`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
// As YouTube: a caption track only for a request with the token of the player, else an empty reply.
const json3 = (...lines: [number, number, string][]) => JSON.stringify({ events: lines.map(([tStartMs, dDurationMs, utf8]) => ({ tStartMs, dDurationMs, segs: [{ utf8 }] })) });
const TAB_CAPTIONS: Record<string, string> = {
  'tabvideo ja asr': json3([0, 3000, 'じどうのじまく']),
  'tabvideo ja own': json3([0, 3000, '猫を見た'], [3000, 3000, '魚を食べた']),
  'tabvideo ja own en': json3([0, 3000, 'I saw a cat.']),
  'englishvideo en asr': json3([0, 3000, 'Hello']),
};
const timedtext: string[] = [];
await context.route('https://www.youtube.com/api/timedtext?**', route => {
  const query = new URL(route.request().url()).searchParams;
  const track = [query.get('v'), query.get('lang'), query.get('kind') ?? 'own', query.get('tlang')].filter(Boolean).join(' ');
  const pot = query.get('pot');
  timedtext.push(`${track}${pot ? ` pot=${pot}` : ''}`);
  return route.fulfill({ contentType: 'application/json', body: pot === `token-${query.get('v')}` ? TAB_CAPTIONS[track] ?? '' : '' });
});
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const shot = async (target: Page, name: string, options: PageScreenshotOptions = {}) => {
  await target.screenshot({ path: join(out, name), ...options });
  console.log('saved', join(out, name));
};

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 902, height: 528 });
  await tab.goto('https://www.youtube.com/watch?v=testvideo');
  const line = tab.locator('#movie_player .minerr-subs-line');
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), '猫が魚を食べなかった今日は雨');
  const lineBox = await line.boundingBox();
  assert.ok(lineBox, 'the overlay line has a box');
  await tab.mouse.move(lineBox.x + 4, lineBox.y + lineBox.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(lineBox.x + lineBox.width - 4, lineBox.y + lineBox.height / 2, { steps: 8 });
  await tab.mouse.up();
  assert.equal(await tab.evaluate(() => getSelection()?.toString()), '猫が魚を食べなかった今日は雨', 'the subtitle text is selectable in the YouTube player');
  await tab.evaluate(() => getSelection()?.removeAllRanges());
  await tab.mouse.move(0, 0);
  console.log('the overlay text can be selected, also in a player with user-select: none');

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
  const panel = await openSidebar(context, worker, extensionId, tab);
  const panelPopup = panel.locator('minerr-popup .popup');
  const sidebar = panel.locator('.minerr-lines');
  await sidebar.locator('.minerr-lines-empty', { hasText: 'The subtitle sidebar needs subtitles with times.' }).waitFor();
  assert.equal(await sidebar.locator('.minerr-lines-empty').innerText(),
    'The subtitle sidebar needs subtitles with times. Generate them with WhisperX, or start the Minerr server for the YouTube subtitles.');
  assert.equal(await sidebar.locator('li').count(), 0);
  console.log('sidebar on mirrored captions: a message');

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
  const off = panel.locator('#off');
  await options.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await tab.waitForFunction(() => document.documentElement.hasAttribute('data-minerr-off'));
  assert.deepEqual(await offState(), { overlay: 'none', native: '1' }, 'Minerr off hides the overlay');
  await off.waitFor();
  assert.equal(await sidebar.isVisible(), false, 'Minerr off hides the lines of the sidebar');
  await options.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-minerr-off'));
  assert.deepEqual(await offState(), { overlay: 'block', native: '0' });
  await off.waitFor({ state: 'hidden' });
  console.log('Minerr off: YouTube captions back, overlay hidden, the sidebar says that Minerr is off; on: both back');

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
  await action.goto(`chrome-extension://${extensionId}/pages/action.html?tab=${tabId}`);
  await action.locator('#server.ok').waitFor();
  assert.equal(await action.textContent('#server'), 'WhisperX server is running: large-v3-turbo on the CPU.');
  assert.equal(await action.textContent('[aria-pressed="true"]'), 'YouTube captions');
  assert.ok(await action.locator('[data-source="whisperx"]').isDisabled());
  await shot(action, 'action-youtube-light.png', { fullPage: true });
  assert.equal(await action.innerText('#site-name'), 'youtube.com');
  assert.equal(await action.innerText('#video-hint'), 'Always on.');
  assert.equal(await action.innerText('#video-state'), 'ON');
  // No transitions, so the shot does not catch the buttons between the two themes.
  await action.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot(action, 'action-youtube-dark.png', { fullPage: true });
  await action.emulateMedia({ colorScheme: 'light', reducedMotion: null });

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
  assert.ok(!whisperRequests.some(request => request.includes('"lang":"en"')), 'the second track is off by default, so the tab does not ask for it');
  await tab.keyboard.press('Shift+W');
  await tab.locator('.minerr-subs-second', { hasText: 'The cat ate the fish.' }).waitFor();
  console.log('YouTube second track: off by default; Shift+W loads the English subtitles and shows them under the Japanese line');
  await tab.keyboard.press('ArrowRight');
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '今日は雨');
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 2);
  console.log('YouTube subtitles with times from the server: the overlay follows them, and ArrowRight goes to the next line');
  await tab.mouse.move(0, 0);
  await tab.keyboard.press('a');
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '猫が魚を食べた');
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 0);
  await tab.keyboard.press('d');
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === '今日は雨');
  console.log('with no popup open, A goes to the previous line and D to the next');
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

  await worker.evaluate(() => chrome.storage.local.set({ 'w:猫': 'known' }));
  await sidebar.locator('li .ml-word.ml-unknown[data-ml-lemma="魚"]').waitFor();
  const cards = sidebar.locator('li');
  assert.deepEqual(await cards.evaluateAll(rows => rows.map(row => `${row.querySelector('time')?.textContent} ${row.querySelector('.text')?.textContent}`)),
    ['0:00 猫が魚を食べた', '0:02 今日は雨', '0:06 ［音楽］', '0:10 雨が降る']);
  // The panel follows the Minerr theme, whatever the theme of YouTube is.
  const sidebarColor = () => panel.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await worker.evaluate(() => chrome.storage.local.set({ theme: 'dark' }));
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await sidebarColor(), 'rgb(15, 29, 36)', 'the Minerr theme Dark makes the sidebar dark');
  await shot(panel, 'sidebar-youtube-dark.png', { animations: 'disabled' });
  assert.ok(await sidebar.locator('.text').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 18, 'the line text is 18 px or larger');
  await worker.evaluate(() => chrome.storage.local.set({ theme: 'light' }));
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await sidebarColor(), 'rgb(230, 237, 240)', 'the Minerr theme Light makes the sidebar light');
  await shot(panel, 'sidebar-youtube-light.png', { animations: 'disabled' });
  await shot(tab, 'youtube-beside-sidebar.png');
  await worker.evaluate(() => chrome.storage.local.set({ theme: 'system' }));

  const currentCard = (time: string) => panel.waitForFunction(t => document.querySelector('.minerr-lines li[aria-current="true"] time')?.textContent === t, time);
  await tab.evaluate(() => { const video = document.querySelector('video'); if (video) video.currentTime = 10.5; });
  await currentCard('0:10');
  await cards.nth(0).getByRole('button', { name: 'Play the line' }).click();
  await currentCard('0:00');
  await tab.waitForFunction(() => document.querySelector('video')?.paused === true, null, { timeout: 8000 });
  const playedTo = await tab.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  console.log('YouTube sidebar Play: the video played the first line and paused at', playedTo);
  assert.ok(playedTo >= 2 && playedTo < 2.2, `Play pauses at the end of the line, ${playedTo}`);

  const notesBefore = ankiRequests.filter(r => at(r, 'action') === 'addNote').length;
  await cards.nth(0).getByRole('button', { name: 'Add a card for a word of the line' }).click();
  await panelPopup.locator('.message', { hasText: 'Added to Anki.' }).waitFor({ timeout: 15000 });
  const notes = ankiRequests.filter(r => at(r, 'action') === 'addNote');
  assert.equal(notes.length, notesBefore + 1);
  const plusFields = at(notes.at(-1), 'params', 'note', 'fields');
  console.log('YouTube card from +:', plusFields);
  assert.equal(at(plusFields, 'Word'), '魚', 'a line with one unknown word gives its card at once');
  assert.equal(at(plusFields, 'Sentence'), '猫が<b>魚</b>を食べた');
  assert.match(String(at(plusFields, 'SentenceAudio')), /^\[sound:minerr-\d+\.mp3\]$/);
  assert.match(String(at(plusFields, 'Image')), /^<img src="minerr-\d+\.jpg">$/);
  assert.equal(whisperRequests.at(-1), 'POST /clip {"url":"https://www.youtube.com/watch?v=timedvideo","start":0,"end":2.5}', 'the server cuts the audio of the line');
  await panel.keyboard.press('Escape');
  await panel.mouse.move(0, 0);

  const shownCards = () => sidebar.locator('li:not([hidden]) time').allTextContents();
  const filter = sidebar.getByRole('combobox', { name: 'Filter the lines' });
  await cards.nth(3).getByRole('button', { name: 'Bookmark the line (B)' }).click();
  await sidebar.locator('option[value="bookmarks"]', { hasText: 'Bookmarks (1)' }).waitFor({ state: 'attached' });
  await filter.selectOption('bookmarks');
  assert.deepEqual(await shownCards(), ['0:10']);
  await filter.selectOption('iPlusOne');
  assert.deepEqual(await shownCards(), ['0:02', '0:10'], 'the card from + made 魚 learning');
  await worker.evaluate(() => chrome.storage.local.set({ 'w:今日': 'known', 'w:雨': 'unknown', 'w:降る': 'known' }));
  await sidebar.locator('li .ml-word.ml-known[data-ml-lemma="降る"]').waitFor();
  await panel.waitForFunction(() => document.querySelectorAll('.minerr-lines .ml-word.ml-unknown[data-ml-lemma="雨"]').length === 2);
  assert.deepEqual(await shownCards(), ['0:02', '0:10'], 'both lines have the one unknown word 雨');
  await filter.selectOption('unique');
  assert.deepEqual(await shownCards(), ['0:02'], 'Unique 1 unknown word shows only the first line of 雨');
  await filter.selectOption('unknown2');
  assert.deepEqual(await shownCards(), []);
  await sidebar.locator('.minerr-lines-empty', { hasText: 'No line matches the filter.' }).waitFor();
  await sidebar.getByRole('button', { name: 'Show all lines' }).click();
  assert.deepEqual(await shownCards(), ['0:00', '0:02', '0:06', '0:10'], 'Clear filter shows all lines');
  assert.equal(await filter.inputValue(), 'all');
  await panel.close();
  console.log('YouTube sidebar: Play, a card from +, the follow mark, filters, and bookmarks');

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

  otherProgram = true;
  await action.locator('#server.error').waitFor({ timeout: 5000 });
  assert.equal(await action.textContent('#server'), 'The WhisperX server answered 404.', 'an answer that is not the health keeps its error');
  otherProgram = false;
  await new Promise(resolve => whisper.close(resolve));
  whisper.closeAllConnections();
  await action.emulateMedia({ colorScheme: 'light' });
  await action.locator('#server', { hasText: 'uv run' }).waitFor({ timeout: 5000 });
  assert.equal(await action.textContent('#server'), 'Start the WhisperX server: uv run server/whisper_server.py', 'a refused connection is not running');
  await shot(action, 'action-server-down-light.png', { fullPage: true });

  const lineText = (text: string) => tab.waitForFunction(t => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === t, text, { timeout: 20000 });
  const openVideo = (videoId: string) => tab.evaluate(id => {
    history.pushState({}, '', `/watch?v=${id}`);
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, videoId);
  await tab.evaluate(() => {
    const video = document.querySelector('video');
    if (video) video.currentTime = 0.5;
    localStorage.setItem('yt-player-caption-sticky-language', JSON.stringify({ data: 'en' }));
  });
  await openVideo('tabvideo');
  await lineText('猫を見た');
  await tab.locator('.minerr-subs-second', { hasText: 'I saw a cat.' }).waitFor();
  assert.deepEqual(timedtext, ['tabvideo ja own', 'tabvideo ja own pot=token-tabvideo', 'tabvideo ja own pot=token-tabvideo', 'tabvideo ja own en pot=token-tabvideo'],
    'the player asks for the uploader track again after its first request without a token; the tab reads the track and its English translation with the token');
  assert.equal(await tab.evaluate(() => localStorage.getItem('yt-player-caption-sticky-language')), JSON.stringify({ data: 'en' }),
    'the caption language of the user stays English after Minerr made the player show the Japanese track');
  console.log('server stopped: the overlay shows the YouTube captions with times that the tab read through the player, and the English translation');
  await tab.keyboard.press('ArrowRight');
  await lineText('魚を食べた');
  assert.equal(await tab.evaluate(() => document.querySelector('video')?.currentTime), 3);
  const panelAgain = await openSidebar(context, worker, extensionId, tab);
  await panelAgain.locator('.minerr-lines li .ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.deepEqual(await panelAgain.locator('.minerr-lines li').evaluateAll(rows => rows.map(row => `${row.querySelector('time')?.textContent} ${row.querySelector('.text')?.textContent}`)),
    ['0:00 猫を見た', '0:03 魚を食べた']);
  await panelAgain.close();
  await tab.hover('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]');
  await popup.getByRole('button', { name: 'Add to Anki A' }).click();
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor({ timeout: 15000 });
  const tabNote = at(ankiRequests.filter(r => at(r, 'action') === 'addNote').at(-1), 'params', 'note', 'fields');
  assert.equal(at(tabNote, 'Sentence'), '魚を<b>食べた</b>');
  const recorded = /^\[sound:(minerr-\d+\.webm)\]$/.exec(String(at(tabNote, 'SentenceAudio')))?.[1];
  assert.ok(recorded && ankiRequests.some(r => at(r, 'action') === 'storeMediaFile' && at(r, 'params', 'filename') === recorded),
    `the tab recorded the line audio: ${String(at(tabNote, 'SentenceAudio'))}`);
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);
  console.log('server stopped: ArrowRight, the sidebar, and a card with the line audio that the tab recorded');

  await openVideo('englishvideo');
  await lineText('猫が魚を食べなかった今日は雨');
  await tab.waitForFunction(() => Reflect.get(Reflect.get(window, 'asked'), 'englishvideo') >= 1);
  await tab.waitForTimeout(1500);
  assert.equal(await line.innerText(), '猫が魚を食べなかった今日は雨', 'an English video has no Japanese track, so the overlay copies the captions');
  assert.ok(!timedtext.some(request => request.startsWith('englishvideo')), 'the tab asks for no translation into Japanese');
  await tab.evaluate(() => {
    const [top, bottom] = document.querySelectorAll('.ytp-caption-segment');
    if (!top || !bottom) throw new Error('The page has no two caption lines');
    top.textContent = 'so this is a';
    bottom.textContent = 'test of the rows';
  });
  await lineText('so this is a\ntest of the rows');
  assert.equal(await line.evaluate(element => getComputedStyle(element).textAlign), 'center', 'a caption window without a side keeps the line in the center');
  const boxOf = () => line.evaluate(element => { const box = element.getBoundingClientRect(); return { left: Math.round(box.left), align: getComputedStyle(element).textAlign }; });
  // The automatic captions of YouTube: a caption window at the left of the video, with the text at the left.
  const windowLeft = await tab.evaluate(() => {
    const window = document.querySelector<HTMLElement>('.caption-window');
    const bottom = document.querySelectorAll('.ytp-caption-segment')[1];
    if (!window || !bottom) throw new Error('The page has no caption window');
    Object.assign(window.style, { textAlign: 'left', left: '10%', transform: 'none' });
    bottom.textContent = 'test';
    return Math.round(window.getBoundingClientRect().left);
  });
  await lineText('so this is a\ntest');
  const before = await boxOf();
  await tab.evaluate(() => { const bottom = document.querySelectorAll('.ytp-caption-segment')[1]; if (bottom) bottom.textContent = 'test of the rows'; });
  await lineText('so this is a\ntest of the rows');
  assert.equal(before.align, 'left', 'the line takes the side of the YouTube caption window');
  assert.ok(Math.abs(before.left - windowLeft) <= 1, `the line starts where the YouTube caption window starts: ${before.left} and ${windowLeft}`);
  assert.deepEqual(await boxOf(), before, 'a new word of a left caption window does not move the line');
  await tab.evaluate(() => {
    const [top, bottom] = document.querySelectorAll('.ytp-caption-segment');
    if (!top || !bottom) throw new Error('The page has no two caption lines');
    top.textContent = 'test of the rows';
    bottom.textContent = 'and a';
  });
  await tab.waitForFunction(() => document.querySelector('.minerr-subs-rows')?.getAttribute('data-gone') === 'so this is a');
  assert.equal(await line.innerText(), 'test of the rows\nand a', 'the row that rolls up is no text of the line');
  await tab.waitForFunction(() => !document.querySelector('.minerr-subs-rows')?.hasAttribute('data-gone'));
  console.log('a roll up of the YouTube captions slides the old row up and out of the line');
  await shot(tab, 'overlay-english-left.png');
  await tab.evaluate(() => { const window = document.querySelector<HTMLElement>('.caption-window'); if (window) Object.assign(window.style, { textAlign: '', left: '', transform: '' }); });
  await options.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await tab.waitForFunction(() => document.documentElement.hasAttribute('data-minerr-off'));
  await tab.waitForTimeout(500);
  const englishOff = await tab.evaluate(() => ({ layer: getComputedStyle(document.querySelector('.minerr-subs') ?? document.body).display,
    line: document.querySelector<HTMLElement>('.minerr-subs-line')?.checkVisibility(), layers: document.querySelectorAll('.minerr-subs').length }));
  console.log("English video, Minerr off:", englishOff);
  assert.equal(await line.isVisible(), false, 'Minerr off hides the overlay on an English video');
  await options.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-minerr-off'));
  console.log('English video: no Japanese lines from a translation; the overlay copies the YouTube captions, English rows on their own lines');

  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Not YouTube</p>' }));
  await (await context.newPage()).goto('https://example.com/');
  const otherTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://example.com/*' }))[0]?.id);
  assert.equal(typeof otherTabId, 'number');
  const elsewhere = await context.newPage();
  await elsewhere.goto(`chrome-extension://${extensionId}/pages/action.html?tab=${otherTabId}`);
  await elsewhere.locator('#elsewhere:not([hidden])').waitFor();
  assert.ok(await elsewhere.locator('#controls').isHidden());

  const started = join(work, 'started');
  const hostScript = join(work, 'host.sh');
  writeFileSync(hostScript, `#!/bin/sh\ntouch "${started}"\n`, { mode: 0o755 });
  const win = await context.newPage();
  await win.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' }));
  await win.goto(`chrome-extension://${extensionId}/pages/action.html?tab=${otherTabId}`);
  await win.locator('#server.error').waitFor();
  assert.equal(await win.textContent('#server'), 'The WhisperX server is not running.');
  await win.click('#start');
  await win.locator('#setup:not([hidden])').waitFor({ timeout: 5000 });
  assert.equal(await win.textContent('#server'), 'To set up the Start button, double-click "Start WhisperX server (Windows).cmd" in the Minerr folder one time.');
  assert.ok(await win.locator('#server-start').isHidden(), 'no Start button until the double-click');
  await shot(win, 'action-server-setup-light.png', { fullPage: true });
  const [extensions] = await Promise.all([context.waitForEvent('page'), win.click('#folder')]);
  await extensions.waitForURL(`chrome://extensions/?id=${extensionId}`);
  console.log('no host: the popup asks for one double-click of the launcher, and Show the Minerr folder opens the page of Minerr in chrome://extensions');

  assert.equal(await worker.evaluate(async () => (await chrome.management.getSelf()).installType), 'development',
    'Load unpacked, read without the management permission');
  const store = await context.newPage();
  await store.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
    Object.defineProperty(chrome.management, 'getSelf', { value: async () => ({ installType: 'normal' }) });
  });
  await store.goto(`chrome-extension://${extensionId}/pages/action.html?tab=${otherTabId}`);
  await store.locator('#server.error').waitFor();
  assert.equal(await store.textContent('#server'), 'The WhisperX server is not running.');
  assert.ok(await store.locator('#start').isVisible(), 'a store install keeps the Start button');
  assert.ok(await store.locator('#addon:not(.primary)').isVisible(), 'and offers the add-on after it, before the first click');
  await shot(store, 'action-store-off-light.png', { fullPage: true });
  await store.click('#start');
  await store.locator('#addon.primary').waitFor({ timeout: 5000 });
  assert.equal(await store.textContent('#server'), 'To set up the Start button, get the free WhisperX add-on from GitHub and unzip it. Then double-click "Start WhisperX server (Windows).cmd" in its folder one time.');
  assert.ok(await store.locator('#setup').isHidden(), 'a store install has no Minerr folder');
  assert.ok(await store.locator('#server-start').isHidden(), 'no Start button until the double-click');
  await shot(store, 'action-store-setup-light.png', { fullPage: true });
  // The tab has no network here, so Playwright sees an error page. Chrome keeps the address of the tab.
  const [releases] = await Promise.all([context.waitForEvent('page'), store.click('#addon')]);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://github.com/*' })).map(tab => tab.url)),
    ['https://github.com/haziqhilmismail/minerr/releases/latest']);
  await releases.close();
  console.log('store install: the popup offers the WhisperX add-on from GitHub next to Start, and in place of the Minerr folder');

  // Chromium on Linux reads user-level hosts from <user data dir>/NativeMessagingHosts.
  mkdirSync(join(work, 'profile', 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(join(work, 'profile', 'NativeMessagingHosts', 'com.minerr.whisperx.json'), JSON.stringify({
    name: 'com.minerr.whisperx', description: 'Test host', path: hostScript, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`],
  }));
  await win.reload();
  await win.click('#start');
  await win.locator('#server', { hasText: 'Starting the WhisperX server…' }).waitFor();
  assert.ok(await win.locator('#server-start').isHidden(), 'no Start button while the server starts');
  for (let i = 0; !existsSync(started) && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(existsSync(started), 'Chrome ran the host');
  await win.reload();
  await win.locator('#server', { hasText: 'Starting the WhisperX server…' }).waitFor();
  await win.evaluate(([key, limit]) => chrome.storage.session.set({ [key]: Date.now() - limit - 1000 }), [CLICK_KEY, START_LIMIT_MS] as const);
  await win.reload();
  await win.locator('#server', { hasText: 'did not answer' }).waitFor();
  assert.equal(await win.textContent('#server'), 'The WhisperX server did not answer in 90 seconds. Look at the WhisperX window.');
  assert.ok(await win.locator('#start').isVisible(), 'a failed start offers the Start button again');
  await listen(whisper, 8766);
  await win.locator('#server.ok').waitFor({ timeout: 5000 });
  assert.equal(await win.textContent('#server'), 'WhisperX server is running: large-v3-turbo on the CPU.');
  await new Promise(resolve => whisper.close(resolve));
  whisper.closeAllConnections();
  await win.reload();
  await win.locator('#server.error').waitFor({ timeout: 5000 });
  assert.equal(await win.textContent('#server'), 'The WhisperX server is not running.', 'the popup forgets a start after the server answered');
  console.log('Start the server: Chrome ran the host, a reopened popup shows the start, and after the limit a failed start;',
    'it shows the server when the server answers, then forgets the start');

  await action.click('#generate');
  await action.locator('#job.error').waitFor({ timeout: 5000 });
  assert.equal(await action.textContent('#job'), 'Start the WhisperX server: uv run server/whisper_server.py', 'the service worker knows the install');
  console.log('Generate without the server: the error of the service worker tells an unpacked install to run uv');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('SUBTITLES E2E PASS');
} finally {
  await context.close();
  anki.close();
  whisper.close();
}
