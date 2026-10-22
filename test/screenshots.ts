// Saves a light and a dark screenshot of every Minerr surface to OUT_DIR (default /tmp/minerr-ui), as <surface>-<scheme>.png.
// With SUFFIX=before, the names are <surface>-<scheme>-before.png. To shoot a different build, set EXTENSION_DIR.
// With STORE=1, the reader (in vertical text) and the word browser are 1280 x 800, the size of a Chrome Web Store screenshot.
// Needs test/fixtures/JMdict_english.zip and ffmpeg, and uses port 8765. If the system has no Japanese font, set CJK_FONT_DIR to a folder of fonts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { launch, listen, openSidebar, useCjkFonts } from './harness.ts';

const out = process.env.OUT_DIR ?? '/tmp/minerr-ui';
const suffix = process.env.SUFFIX ? `-${process.env.SUFFIX}` : '';
const store = process.env.STORE === '1';
const jmdict = join(import.meta.dirname, 'fixtures', 'JMdict_english.zip');
const work = mkdtempSync(join(tmpdir(), 'ml-shots-'));
mkdirSync(out, { recursive: true });
useCjkFonts(work);

const SCHEMES = ['light', 'dark'] as const;
const TEXT = '猫が魚を食べなかった。今日は雨が降っているので、家で本を読みます。';
const LINES = ['猫が魚を食べなかった。', '今日は雨が降っている。', '家で本を読みます。', '明日は晴れるでしょう。', '駅まで歩いて行きました。', '友達と映画を見た。'];

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Minerr test page</title><body style="margin:0;font:20px/1.8 sans-serif;color:#222;background:#fff">
<p id="light" style="margin:0;padding:24px 32px">${TEXT}</p>
<div id="dark" style="margin-top:220px;padding:16px 32px;background:#000;color:#fff;font-size:30px;text-align:center">${TEXT}</div>
</body>`);
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/watch`;

const ANKI: Record<string, unknown> = {
  version: 6,
  modelNames: ['Basic', 'Japanese sentences'],
  modelFieldNames: ['Expression', 'Reading', 'Sentence', 'Meaning', 'Picture', 'Source'],
};
const anki = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const action = String(JSON.parse(body).action);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(action in ANKI ? { result: ANKI[action], error: null } : { result: null, error: `no mock for ${action}` }));
  });
});
await listen(anki, 8765);

const clip = join(work, 'clip.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  `gradients=s=1280x720:c0=0x1f4e5f:c1=0x0f1d24:c2=0x2d6a4f:x0=0:y0=0:x1=1280:y1=720:speed=0.002:r=10:d=${LINES.length * 2}`,
  '-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-b:v', '300k', clip]);
const stamp = (seconds: number) => `00:00:${String(seconds).padStart(2, '0')},000`;
const srt = join(work, 'clip.srt');
writeFileSync(srt, LINES.map((line, i) => `${i + 1}\n${stamp(i * 2)} --> ${stamp(i * 2 + 2)}\n${line}\n`).join('\n'));

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const page = (path: string) => `chrome-extension://${extensionId}/pages/${path}`;
const shot = async (target: Page | Locator, name: string, fullPage = false) => {
  const path = join(out, `${name}${suffix}.png`);
  await target.screenshot({ path, fullPage, animations: 'disabled' });
  console.log('saved', path);
};
// One shot in each color scheme. The theme setting stays 'system', so the scheme of the page decides.
const both = async (target: Page, name: string, before: (scheme: 'light' | 'dark') => Promise<void> = async () => {}, fullPage = false) => {
  for (const scheme of SCHEMES) {
    await target.emulateMedia({ colorScheme: scheme });
    // The colors of a control fade to the new scheme (--fast in src/shared/design-tokens.ts).
    await target.waitForTimeout(300);
    await before(scheme);
    await shot(target, `${name}-${scheme}`, fullPage);
  }
  await target.emulateMedia({ colorScheme: 'light' });
};

try {
  await worker.evaluate(() => chrome.storage.local.set({ wordAudio: false }));
  const options = await context.newPage();
  await options.setViewportSize({ width: 900, height: 1000 });
  await options.goto(page('options.html'));
  await options.setInputFiles('#dict-file', jmdict);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'), null, { timeout: 180000 });
  await worker.evaluate(() => chrome.storage.local.set({
    'w:魚': 'learning', 'w:雨': 'learning', 'w:食べる': 'known', 'w:今日': 'known', 'w:本': 'known', 'w:家': 'ignored', 'w:見る': 'known', 'w:行く': 'known',
  }));
  await options.reload();
  await options.fill('#deck', 'Japanese::Mining');
  await options.press('#deck', 'Tab');
  await options.click('#anki-check');
  await options.locator('#anki-status:not(:empty)').waitFor();
  await options.locator('#anki-check').blur();
  await options.mouse.move(0, 0);
  await options.locator('#status-counts', { hasText: 'Known' }).waitFor();
  await both(options, 'options', async () => {}, true);
  await both(options, 'options-top');

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 1000, height: 720 });
  await tab.goto(pageUrl);
  await tab.waitForSelector('#dark .ml-word[data-ml-lemma="読む"]', { timeout: 20000 });
  await shot(tab.locator('#light'), 'page-light');
  await shot(tab.locator('#dark'), 'page-dark');

  const popup = tab.locator('minerr-popup .popup');
  const openPopup = async () => {
    await tab.mouse.move(0, 0);
    await tab.keyboard.press('Escape');
    await popup.waitFor({ state: 'detached' }).catch(() => {});
    await tab.hover('#light .ml-word[data-ml-lemma="食べる"]');
    await popup.locator('li').first().waitFor();
  };
  await both(tab, 'popup', openPopup);
  await both(tab, 'cardform', async () => {
    await openPopup();
    await tab.keyboard.press('e');
    await popup.locator('form.card-form').waitFor();
  });
  await tab.keyboard.press('Escape');
  await tab.keyboard.press('Escape');

  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, tab.url());
  const menu = await context.newPage();
  await menu.setViewportSize({ width: 340, height: 600 });
  await menu.goto(page(`action.html?tab=${tabId}`));
  await menu.locator('#score-percent').filter({ hasText: '%' }).waitFor();
  for (const scheme of SCHEMES) {
    await menu.emulateMedia({ colorScheme: scheme });
    await shot(menu, `menu-${scheme}`, true);
  }

  const player = await context.newPage();
  await player.setViewportSize({ width: 1280, height: 800 });
  await player.goto(page('player.html'));
  await player.setInputFiles('#video-file', clip);
  await player.setInputFiles('#subs-file', srt);
  await player.locator('#status', { hasText: 'lines' }).waitFor();
  const seek = (time: number) => player.evaluate(t => new Promise(resolve => {
    const video = document.querySelector('video');
    video?.addEventListener('seeked', resolve, { once: true });
    if (video) video.currentTime = t;
  }), time);
  await seek(1);
  await player.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 3);
  await player.locator('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  await both(player, 'player', async () => { await player.mouse.move(0, 0); });
  const panel = await openSidebar(context, worker, extensionId, player);
  if (store) await panel.setViewportSize({ width: 400, height: 800 });
  const cards = panel.locator('.minerr-lines li');
  await cards.nth(3).locator('.ml-word').first().waitFor({ timeout: 20000 });
  await cards.nth(1).hover();
  await cards.nth(1).locator('.check').click();
  await cards.nth(2).hover();
  await cards.nth(2).locator('.check').click();
  await both(panel, 'sidebar', async () => { await panel.mouse.move(0, 0); });
  await both(player, 'video', async () => {
    await player.mouse.move(0, 0);
    await player.keyboard.press('Escape');
    await player.hover('.minerr-subs-line .ml-word[data-ml-lemma="魚"]');
    await player.locator('minerr-popup .popup li').first().waitFor();
  });

  const reader = await context.newPage();
  await reader.setViewportSize(store ? { width: 1280, height: 800 } : { width: 1000, height: 720 });
  await reader.goto(page('reader.html'));
  const book = join(work, '猫の話.txt');
  const story = `${LINES.join('')}\n\n${TEXT}\n\n${LINES.slice().reverse().join('')}`;
  writeFileSync(book, store ? [story, story, story].join('\n\n') : story);
  await reader.setInputFiles('#file', book);
  await reader.waitForSelector('#article .ml-word[data-ml-lemma="魚"]', { timeout: 20000 });
  if (store) await reader.click('#vertical');
  await both(reader, 'reader');

  const words = await context.newPage();
  await words.setViewportSize(store ? { width: 1280, height: 800 } : { width: 1000, height: 900 });
  await words.goto(page('words.html'));
  await words.locator('#rows tr').first().waitFor();
  await words.locator('#rows input[type="checkbox"]').nth(1).check();
  await both(words, 'words', async () => {}, !store);
} finally {
  await context.close();
  site.close();
  anki.close();
  rmSync(work, { recursive: true, force: true });
}
