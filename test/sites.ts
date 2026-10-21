// End-to-end test of the subtitle overlay on a video page that is not YouTube.
// Uses port 8765 (mock AnkiConnect) and 8766 (mock Minerr server), and ffmpeg for a short test clip.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at } from '../src/shared/guards.ts';
import { launch, listen, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-sites-'));
useCjkFonts(work);
const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', clip]);
const srt = join(work, 'lesson.srt');
writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\n猫が好き\n\n2\n00:00:02,000 --> 00:00:04,000\n魚が好き\n');
const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['猫', 'ねこ', 'n', '', 100, ['cat (fixture)'], 1, ''],
  ['魚', 'さかな', 'n', '', 100, ['fish (fixture)'], 2, ''],
]);

const anki = await mockAnki();

const VTT = 'WEBVTT\n\n00:00.000 --> 00:03.000\n猫が魚を食べた\n\n00:03.000 --> 00:06.000\n今日は雨\n';
const serverRequests: string[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    serverRequests.push(`${req.method} ${req.url} ${body}`);
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/captions' && body.includes('/drm')) return reply(502, { error: 'yt-dlp failed: ERROR: This video is DRM protected' });
    if (req.url === '/captions' && body.includes('"ja"')) return reply(200, { ext: 'vtt', text: VTT });
    if (req.url === '/jobs') return reply(200, { id: 'site1' });
    if (req.url === '/jobs/site1') return reply(200, { state: 'done', segments: [{ start: 0, end: 8, text: '雨が降る' }] });
    if (req.url === '/clip') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end('ID3 site clip');
    }
    reply(404, { error: 'Not found.' });
  });
});
await listen(server, 8766);

const video = `data:video/webm;base64,${readFileSync(clip).toString('base64')}`;
const page = (title: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;padding:20px;background:#111">
  <p id="text" style="color:#eee">猫が好き</p><video id="ad" src="${video}" muted style="width:160px;height:90px"></video>
  <div style="position:relative;width:800px;height:450px"><video id="main" src="${video}" style="width:100%;height:100%"></video></div>`;
const { context, worker, extensionId } = await launch(join(work, 'profile'));
await context.route('https://videos.example/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
  body: route.request().url().endsWith('/empty') ? '<p>No video here</p>' : page('Example video') }));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  await options.close();

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 860, height: 520 });
  await tab.goto('https://videos.example/watch/1');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://videos.example/*' }))[0]?.id);
  const action = await context.newPage();
  await action.goto(`chrome-extension://${extensionId}/pages/action.html?tab=${tabId}`);
  await action.click('#attach');
  await action.locator('#elsewhere', { hasText: 'Minerr shows its subtitle overlay on the video.' }).waitFor();
  await tab.bringToFront();

  const layer = tab.locator('.minerr-subs');
  await layer.waitFor({ state: 'attached' });
  const placed = await tab.evaluate(() => {
    const box = document.querySelector('.minerr-subs')?.getBoundingClientRect();
    const main = document.querySelector('#main')?.getBoundingClientRect();
    return box && main ? [box.left - main.left, box.top - main.top, box.width - main.width, box.height - main.height] : null;
  });
  assert.deepEqual(placed, [0, 0, 0, 0], 'the overlay covers the largest video, not the small one');

  const line = tab.locator('.minerr-subs-line');
  const toast = tab.locator('.minerr-subs-toast');
  await tab.getByRole('button', { name: 'Subtitles of the site' }).click();
  await line.locator('.ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), '猫が魚を食べた');
  assert.equal(await tab.locator('#text .ml-word').count(), 0, 'the page text of a site that is off gets no words');
  assert.ok(serverRequests.includes('POST /captions {"url":"https://videos.example/watch/1","lang":"ja"}'));
  await tab.keyboard.press('d');
  await line.locator('.ml-word[data-ml-lemma="雨"]').waitFor();
  console.log('site subtitles from the server: the overlay shows them on the main video, and D goes to the next line');

  await line.locator('.ml-word[data-ml-lemma="雨"]').hover();
  const popup = tab.locator('minerr-popup .popup');
  await popup.locator('.add').waitFor();
  await tab.keyboard.press('a');
  await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor();
  assert.ok(serverRequests.includes('POST /clip {"url":"https://videos.example/watch/1","start":2.5,"end":6.5}'));
  const note = at(anki.requests.find(r => at(r, 'action') === 'addNote'), 'params', 'note');
  assert.match(String(at(note, 'fields', 'SentenceAudio')), /^\[sound:minerr-\d+\.mp3\]$/);
  console.log('card on another site: the server cut the line audio from the page URL');
  await tab.keyboard.press('Escape');
  await tab.mouse.move(0, 0);

  await tab.setInputFiles('.minerr-site-bar input[type="file"]', srt);
  await toast.filter({ hasText: 'Subtitles from lesson.srt: 2 lines.' }).waitFor();
  await tab.evaluate(() => { const main = document.querySelector<HTMLVideoElement>('#main'); if (main) main.currentTime = 2.5; });
  await line.locator('.ml-word[data-ml-lemma="魚"]').waitFor();
  console.log('subtitle file on another site:', await line.innerText());

  await tab.getByRole('button', { name: 'WhisperX' }).click();
  await toast.filter({ hasText: 'WhisperX subtitles: 1 lines.' }).waitFor();
  assert.ok(serverRequests.includes('POST /jobs {"url":"https://videos.example/watch/1"}'));
  await line.filter({ hasText: '雨が降る' }).waitFor();

  await tab.goto('https://videos.example/watch/drm');
  await action.reload();
  await action.click('#attach');
  await tab.bringToFront();
  await tab.getByRole('button', { name: 'Subtitles of the site' }).click();
  await toast.filter({ hasText: 'yt-dlp failed: ERROR: This video is DRM protected' }).waitFor();
  console.log('a DRM site: the overlay shows the error of the server');

  await tab.goto('https://videos.example/empty');
  await action.reload();
  await action.click('#attach');
  await action.locator('#elsewhere', { hasText: 'This page has no video on the screen.' }).waitFor();

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('SITES E2E PASS');
} finally {
  await context.close();
  anki.server.close();
  server.close();
}
