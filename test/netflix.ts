// End-to-end test of the subtitle overlay on a fake Netflix watch page: the subtitle list from the player, the WebVTT and TTML
// tracks, the seek through the player API, and the card of a protected video (no line audio, no screenshot).
// Uses port 8765 (mock AnkiConnect) and ffmpeg for a short test clip. Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { at } from '../src/parse.ts';
import { launch, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-netflix-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);
const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', clip]);
const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['食べる', 'たべる', 'v1', 'v1', 100, ['to eat (fixture)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 2, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 3, ''],
  ['雨', 'あめ', 'n', '', 100, ['rain (fixture)'], 4, ''],
]);
const anki = await mockAnki();

const FILES: Record<string, string> = {
  '/ja.vtt': 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000 position:50%,end align:center\n猫が魚を食べた\n\n2\n00:00:03.000 --> 00:00:06.000\n今日は雨\n',
  '/en.vtt': 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nThe cat ate a fish.\n\n2\n00:00:03.000 --> 00:00:06.000\nIt is raining today.\n',
  '/ja-cc.dfxp': `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><body><div>
<p begin="0t" end="25000000t" xml:id="s0"><span>［音楽］</span></p>
<p begin="25000000t" end="60000000t" xml:id="s1"><span>魚が</span><br/><span>好き</span></p></div></body></tt>`,
};
const cdn: string[] = [];

// A fake Netflix watch page. Its script does what the player does: it asks for the manifest with JSON.stringify, reads the reply with
// JSON.parse, offers the player API under window.netflix, and marks the video as protected. loadTitle(id) is the player on a new title.
const WATCH = `<!doctype html><meta charset="utf-8"><title>Netflix</title>
<style>
  body { margin: 0; background: #141414; }
  .watch-video { position: absolute; left: 0; top: 0; right: 0; height: 450px; background: #000; }
  .watch-video--player-view { position: absolute; inset: 0; }
  video { width: 100%; height: 100%; }
  .player-timedtext { position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; color: #fff; font-size: 24px; }
</style>
<div class="watch-video"><div class="watch-video--player-view">
  <video src="data:video/webm;base64,${readFileSync(clip).toString('base64')}" muted></video>
  <div class="player-timedtext"><span>ネトフリの字幕</span></div>
</div></div>
<script>
  const file = (name) => ({ urls: [{ url: 'https://cdn.example' + name, cdn_id: 0 }] });
  const track = (id, language, rawTrackType, downloadables, extra = {}) =>
    ({ new_track_id: id, language, rawTrackType, isForcedNarrative: false, isNoneTrack: false, ttDownloadables: downloadables, ...extra });
  // The reply lists only the formats that the request asked for, as Netflix does. 81002 has no WebVTT at all.
  const TITLES = {
    81001: (profiles) => [
      track('T:none', null, null, {}, { isNoneTrack: true }),
      track('T:ja', 'ja', 'subtitles', Object.fromEntries(profiles.filter(p => p !== 'simplesdh').map(p => [p, file(p.startsWith('webvtt') ? '/ja.vtt' : '/ja.dfxp')]))),
      track('T:ja-forced', 'ja', 'subtitles', { 'webvtt-lssdh-ios8': file('/ja-forced.vtt') }, { isForcedNarrative: true }),
      track('T:en', 'en', 'subtitles', { 'webvtt-lssdh-ios8': file('/en.vtt') }),
    ],
    81002: () => [
      track('T:ja', 'ja', 'subtitles', { 'dfxp-ls-sdh': file('/ja.dfxp') }),
      track('T:ja-cc', 'ja', 'closedcaptions', { 'dfxp-ls-sdh': file('/ja-cc.dfxp') }),
    ],
    81003: () => [track('T:ja', 'ja', 'subtitles', { 'nflx-cmisc': file('/ja.img') })],
  };
  const SELECTED = { 81002: 'T:ja-cc' };
  const video = document.querySelector('video');
  window.seeks = [];
  window.asked = [];
  window.requestProfiles = null;
  window.addEventListener('message', event => { if (event.data && event.data.minerr === 'ask') window.asked.push(event.data.movieId); });
  let title = null;
  const player = {
    seek: ms => { window.seeks.push(ms); video.currentTime = ms / 1000; },
    getTimedTextTrack: () => ({ trackId: SELECTED[title] || 'T:none' }),
  };
  window.netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
    getAllPlayerSessionIds: () => ['motion-billboard-1', 'watch-abc'],
    getVideoPlayerBySessionId: id => (id === 'watch-abc' ? player : null),
  } }) } } } };
  window.loadTitle = (id) => {
    title = id;
    const request = JSON.stringify({ url: 'https://www.netflix.com/nq/msl_v1/cadmium/pbo_manifests/%5E1.0.0/router',
      params: { profiles: ['dfxp-ls-sdh', 'simplesdh'] } });
    const profiles = JSON.parse(request).params.profiles;
    window.requestProfiles = profiles;
    const make = TITLES[id];
    if (make) JSON.parse(JSON.stringify({ result: { movieId: Number(id), timedtexttracks: make(profiles) } }));
  };
  // The player fires encrypted when the stream starts, after the content scripts loaded; the interval stands in for that.
  setInterval(() => video.dispatchEvent(new Event('encrypted')), 500);
  loadTitle(location.pathname.split('/').pop());
</script>`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
await context.route('https://www.netflix.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
await context.route('https://cdn.example/**', route => {
  const path = new URL(route.request().url()).pathname;
  cdn.push(path);
  const body = FILES[path];
  return body === undefined ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'text/plain; charset=utf-8', body });
});
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const shot = async (target: Page, name: string) => {
  await target.screenshot({ path: join(out, name) });
  console.log('saved', join(out, name));
};
const setStorage = (items: Record<string, unknown>) => worker.evaluate(value => chrome.storage.local.set(value), items);

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  await options.close();

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 900, height: 520 });
  await tab.goto('https://www.netflix.com/watch/81001');
  const line = tab.locator('.minerr-subs-line');
  const toast = tab.locator('.minerr-subs-toast');
  const lineText = (text: string) => tab.waitForFunction(t => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === t, text, { timeout: 20000 });
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), '猫が魚を食べた');
  assert.deepEqual(await tab.evaluate(() => Reflect.get(window, 'requestProfiles')), ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh'],
    'the page script asks Netflix for WebVTT too');
  assert.deepEqual(cdn, ['/ja.vtt'], 'the tab reads the regular Japanese track as WebVTT, not the forced track');
  assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.player-timedtext')!).opacity), '0', 'the captions of Netflix are invisible');
  const placed = await tab.evaluate(() => {
    const box = document.querySelector('.minerr-subs')?.getBoundingClientRect();
    const video = document.querySelector('video')?.getBoundingClientRect();
    return box && video ? [box.left - video.left, box.top - video.top, box.width - video.width, box.height - video.height] : null;
  });
  assert.deepEqual(placed, [0, 0, 0, 0], 'the overlay covers the video');
  console.log('Netflix: the overlay shows the Japanese WebVTT track from the subtitle list of the player');
  await shot(tab, 'netflix-overlay.png');

  await tab.keyboard.press('d');
  await lineText('今日は雨');
  assert.deepEqual(await tab.evaluate(() => Reflect.get(window, 'seeks')), [3000], 'D seeks through the player API of Netflix, in ms');
  await setStorage({ secondDisplay: 'show' });
  await tab.locator('.minerr-subs-second', { hasText: 'It is raining today.' }).waitFor();
  assert.deepEqual(cdn, ['/ja.vtt', '/en.vtt']);
  console.log('Netflix: D goes to the next line through the player, and the English track shows under the line');

  await tab.keyboard.press('g');
  const sidebar = tab.locator('.minerr-lines');
  const cards = sidebar.locator('li');
  await sidebar.locator('li .ml-word[data-ml-lemma="食べる"]').waitFor();
  assert.deepEqual(await cards.evaluateAll(rows => rows.map(row => `${row.querySelector('time')?.textContent} ${row.querySelector('.text')?.textContent}`)),
    ['0:00 猫が魚を食べた', '0:03 今日は雨']);
  const narrowed = await tab.evaluate(() => innerWidth - document.querySelector('.watch-video')!.getBoundingClientRect().right);
  assert.ok(narrowed > 100, `the open sidebar narrows the player: ${narrowed}px free at the right`);
  // The overlay follows the video every 250 ms.
  await tab.waitForFunction(() => document.querySelector('.minerr-subs')?.getBoundingClientRect().width === document.querySelector('video')?.getBoundingClientRect().width);
  await shot(tab, 'netflix-sidebar.png');
  await tab.keyboard.press('g');
  await sidebar.waitFor({ state: 'hidden' });

  await line.locator('.ml-word[data-ml-lemma="雨"]').hover();
  const popup = tab.locator('minerr-popup .popup');
  await popup.locator('.add').waitFor();
  // The toast shows while the card is made and goes after 2.5 s, so the wait starts before the key.
  const hinted = toast.filter({ hasText: 'Protected video: the card gets no line audio and no screenshot.' }).waitFor({ timeout: 15000 });
  await tab.keyboard.press('a');
  await hinted;
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor({ timeout: 15000 });
  const note = at(anki.requests.find(r => at(r, 'action') === 'addNote'), 'params', 'note');
  assert.equal(at(note, 'fields', 'Sentence'), '今日は<b>雨</b>');
  assert.equal(at(note, 'fields', 'SentenceAudio'), '', 'no line audio of a protected video');
  assert.equal(at(note, 'fields', 'Image'), '', 'no screenshot of a protected video');
  const stored = anki.requests.filter(r => at(r, 'action') === 'storeMediaFile').map(r => String(at(r, 'params', 'filename')));
  assert.ok(!stored.some(name => /\.(jpg|webm)$/.test(name)), `no screenshot or recording file: ${stored.join(', ')}`);
  console.log('Netflix card: the line as the sentence, no line audio, no screenshot, and the toast says so');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.netflix.com/*' }))[0]?.id);
  const action = await context.newPage();
  await action.goto(`chrome-extension://${extensionId}/action.html?tab=${tabId}`);
  await action.click('#attach');
  await action.locator('#elsewhere', { hasText: 'Netflix subtitles with times: 2 lines.' }).waitFor();

  const openTitle = (id: string) => tab.evaluate(movieId => {
    history.pushState({}, '', `/watch/${movieId}`);
    (window as unknown as { loadTitle: (id: string) => void }).loadTitle(movieId);
  }, id);
  await tab.bringToFront();
  await openTitle('81002');
  await lineText('魚が\n好き');
  assert.deepEqual(cdn.slice(2), ['/ja-cc.dfxp'], 'the tab reads the closed captions that the player shows, as TTML');
  console.log('Netflix: the next title shows the selected Japanese closed captions from TTML');

  await openTitle('81003');
  await toast.filter({ hasText: 'The Japanese subtitles of this title are images. Minerr cannot read them.' }).waitFor();
  await tab.waitForFunction(() => document.querySelector<HTMLElement>('.minerr-subs-line')?.hidden === true);
  assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.player-timedtext')!).opacity), '1', 'the captions of Netflix show again');
  console.log('Netflix: image subtitles get a message, and the captions of Netflix stay');

  await openTitle('81999');
  // After the second question about the title, the overlay has the reply to the first.
  await tab.waitForFunction(() => (Reflect.get(window, 'asked') as string[]).filter(id => id === '81999').length >= 2);
  await action.reload();
  await action.click('#attach');
  await action.locator('#elsewhere', { hasText: 'The player has the subtitle list of 81001, 81002, 81003, not of 81999.' }).waitFor();

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('NETFLIX E2E PASS');
} finally {
  await context.close();
  anki.server.close();
}
