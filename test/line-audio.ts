// End-to-end test of the sentence audio of a YouTube card, with a long WhisperX line that has no punctuation.
// The line and the YouTube caption rows are from a real video (s0OAUwiHheE). Uses port 8765 (mock AnkiConnect) and 8766 (mock WhisperX server).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at } from '../src/parse.ts';
import { launch, listen, makeDictionary, mockAnki, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-lineaudio-'));
useCjkFonts(work);

// A loud and a quiet video, 29 LU apart: a 300 Hz tone with a syllable rhythm of 4 Hz and a pause in each 2 seconds, like speech.
const speech = (volume: number) => {
  const path = join(work, `speech-${volume}.webm`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x36:r=1:d=230', '-f', 'lavfi', '-i',
    `aevalsrc=${volume}*sin(2*PI*300*t)*(0.5+0.5*sin(2*PI*4*t))*lt(mod(t\\,2)\\,1.3):s=48000:d=230`,
    '-c:v', 'libvpx', '-b:v', '20k', '-c:a', 'libopus', '-b:a', '16k', path]);
  return `data:video/webm;base64,${readFileSync(path).toString('base64')}`;
};
const loud = speech(0.9);
const quiet = speech(0.03);
// The integrated loudness (EBU R128) of an audio file in base64, in LUFS.
const loudness = (base64: unknown) => {
  const path = join(work, 'measure.webm');
  writeFileSync(path, Buffer.from(String(base64), 'base64'));
  const report = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return Number([...report.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
};

const dictionary = makeDictionary(join(work, 'fixture.zip'), 'Fixture', [
  ['登山口', 'とざんぐち', 'n', '', 100, ['trailhead (fixture)'], 1, ''],
]);

const VIDEO = 'https://www.youtube.com/watch?v=s0OAUwiHheE';
const TEXT = 'かっこいいやけだけ登山口こっちだ人がいないなにしても猿しかおらないやけだけ登山口こっちださあ気をつけようおはようおはようあ、食べとるおはー';
const SEGMENTS = [{ start: 189.25, end: 217.077, text: TEXT }];
const clips: unknown[] = [];
const whisper = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    if (req.url === '/subs/s0OAUwiHheE') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(SEGMENTS));
    }
    if (req.method === 'POST' && req.url === '/clip') {
      clips.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end('ID3 clip');
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found.' }));
  });
});

// YouTube's own caption window at 206 s shows these two rows of its automatic captions.
const WATCH = `<!doctype html><meta charset="utf-8"><title>Fake YouTube</title>
<style>
  body { margin: 0; padding: 24px; background: #0f0f0f; }
  #movie_player { position: relative; width: 854px; height: 480px; overflow: hidden; background: #000; }
  video { width: 100%; height: 100%; }
</style>
<div id="movie_player">
  <video src="${loud}"></video>
  <div class="ytp-caption-window-container"><span class="captions-text">
    <span class="caption-visual-line">だけ登山口</span><br><span class="caption-visual-line">こっちだ。さあ、気をつけよう。おはよう</span>
  </span></div>
</div>`;

const anki = await mockAnki();
// Lapis, the default note type: it has the word audio field, for the check of one audio per card.
anki.replies.modelNames = () => ['Basic', 'Lapis'];
const { context, worker, extensionId } = await launch(join(work, 'profile'), null);
await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
const jpod: string[] = [];
await context.route('https://assets.languagepod101.com/**', route => {
  jpod.push(route.request().url());
  return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from('ID3 word audio of the mock') });
});
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const lastNote = () => at(anki.requests.filter(r => at(r, 'action') === 'addNote').at(-1), 'params', 'note', 'fields');
const notes = () => anki.requests.filter(r => at(r, 'action') === 'addNote').length;
const storedAudio = (field: unknown) => {
  const name = /^\[sound:(.+)\]$/.exec(String(at(field, 'SentenceAudio')))?.[1];
  return anki.requests.filter(r => at(r, 'action') === 'storeMediaFile' && at(r, 'params', 'filename') === name).map(r => at(r, 'params'));
};

try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', dictionary);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'));
  await options.close();

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 902, height: 528 });
  await tab.goto(VIDEO);
  const line = tab.locator('#movie_player .minerr-subs-line');
  const popup = tab.locator('minerr-popup .popup');
  const word = (index: number) => line.locator('.ml-word', { hasText: '登山口' }).nth(index);
  const add = async (index: number, how: 'a' | 'e') => {
    const before = notes();
    await word(index).hover();
    await popup.locator('li', { hasText: 'trailhead (fixture)' }).waitFor();
    await tab.keyboard.press(how);
    if (how === 'e') await popup.locator('form.card-form').getByRole('button', { name: 'Send' }).click({ timeout: 60000 });
    await popup.locator('.message', { hasText: 'Added to Anki.' }).waitFor({ timeout: 60000 });
    assert.equal(notes(), before + 1);
    await tab.keyboard.press('Escape');
    await tab.mouse.move(0, 0);
    return lastNote();
  };
  await tab.evaluate(() => { const video = document.querySelector('video'); if (video) video.currentTime = 206; });
  await word(0).waitFor({ timeout: 20000 });
  assert.equal(await line.innerText(), 'だけ登山口こっちだ。さあ、気をつけよう。おはよう');

  const mirrored = await add(0, 'a');
  assert.deepEqual([at(mirrored, 'Sentence'), at(mirrored, 'SentenceAudio')], ['だけ<b>登山口</b>こっちだ。さあ、気をつけよう。おはよう', ''], 'the card sentence is the whole subtitle line on the screen');
  assert.match(String(at(mirrored, 'ExpressionAudio')), /^\[sound:minerr-word-[0-9a-f]+\.mp3\]$/, 'a card with no line audio gets the word audio');
  console.log('server down when the video opened: the card gets the whole line of the joined YouTube caption rows, without audio', mirrored);

  await listen(whisper, 8766);
  await tab.waitForFunction(text => document.querySelector<HTMLElement>('.minerr-subs-line')?.innerText === text, TEXT, { timeout: 15000 });
  console.log('the server started after the video opened: the overlay shows the cached WhisperX line');

  const first = await add(0, 'a');
  assert.deepEqual(clips.at(-1), { url: VIDEO, start: 188.75, end: 217.077 + 0.5 }, 'the server cuts the whole line with 0.5 s on each side');
  assert.equal(at(first, 'Sentence'), `かっこいいやけだけ<b>登山口</b>${TEXT.slice(12)}`);
  assert.equal(storedAudio(first).length, 1, 'A: the card has the line audio');
  const asked = jpod.length;
  assert.equal(at(first, 'ExpressionAudio'), '', 'one audio per card: a card with the line audio gets no word audio');
  const second = await add(1, 'e');
  assert.equal(clips.length, 2);
  assert.equal(at(second, 'Sentence'), `${TEXT.slice(0, 37)}<b>登山口</b>${TEXT.slice(40)}`);
  assert.equal(storedAudio(second).length, 1, 'E then Send: the card has the line audio');
  assert.equal(at(second, 'ExpressionAudio'), '');
  assert.equal(jpod.length, asked, 'Minerr asks JapanesePod101 only for a card with no line audio');
  console.log('WhisperX line: A on the first and E on the second 登山口 give the server audio and no word audio', clips);

  await new Promise(resolve => { whisper.close(resolve); whisper.closeAllConnections(); });
  await tab.evaluate(() => { const video = document.querySelector('video'); if (video) video.playbackRate = 4; });
  const recorded = await add(0, 'a');
  assert.match(String(at(recorded, 'SentenceAudio')), /^\[sound:minerr-\d+\.webm\]$/, 'the tab records the line when the server stopped');
  assert.equal(storedAudio(recorded).length, 1);
  console.log('server stopped: the tab records the line', at(recorded, 'SentenceAudio'));

  await tab.evaluate(async src => {
    const video = document.querySelector('video');
    if (!video) return;
    video.src = src;
    await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    video.playbackRate = 4;
    video.currentTime = 206;
  }, quiet);
  await word(0).waitFor();
  const recordedQuiet = await add(0, 'a');
  const loudLevel = loudness(at(storedAudio(recorded)[0], 'data'));
  const quietLevel = loudness(at(storedAudio(recordedQuiet)[0], 'data'));
  console.log('tab recordings of the loud and the quiet video (29 LU apart):', loudLevel, quietLevel, 'LUFS');
  assert.ok(Math.abs(loudLevel - quietLevel) <= 3, `the tab recordings are within 3 LU of each other: ${loudLevel}, ${quietLevel} LUFS`);

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('LINE AUDIO E2E PASS');
} finally {
  await context.close();
  anki.server.close();
  whisper.close();
}
