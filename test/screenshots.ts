// Saves UI screenshots to OUT_DIR (default /tmp/minerr-ui) for a visual check.
// Needs test/fixtures/JMdict_english.zip and ffmpeg. If the system has no Japanese font, set CJK_FONT_DIR to a folder of fonts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { launch, listen, useCjkFonts } from './harness.ts';

const out = process.env.OUT_DIR ?? '/tmp/minerr-ui';
const jmdict = join(import.meta.dirname, 'fixtures', 'JMdict_english.zip');
const work = mkdtempSync(join(tmpdir(), 'ml-shots-'));
mkdirSync(out, { recursive: true });

useCjkFonts(work);

const TEXT = '猫が魚を食べなかった。今日は雨が降っているので、家で本を読みます。';
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:20px/1.8 sans-serif;color:#222;background:#fff">
<p id="light" style="margin:0;padding:24px 32px">${TEXT}</p>
<div id="dark" style="margin-top:220px;padding:16px 32px;background:#000;color:#fff;font-size:30px;text-align:center">${TEXT}</div>
</body>`);
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}/watch`;

// A mock AnkiConnect for the Anki section. It closes before the popup shots, so the popup shows the error of a closed Anki.
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

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const shot = async (target: Page | Locator, name: string, fullPage = false) => {
  await target.screenshot({ path: join(out, name), fullPage });
  console.log('saved', join(out, name));
};

try {
  const options = await context.newPage();
  await options.setViewportSize({ width: 900, height: 900 });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', jmdict);
  await options.waitForFunction(() => (document.querySelector<HTMLProgressElement>('#dict-progress')?.value ?? 0) >= 2, null, { timeout: 60000 });
  await shot(options.locator('#dictionaries'), 'options-importing-light.png');
  await options.reload();
  await options.locator('#dict-list li').first().waitFor();
  await shot(options.locator('#dictionaries'), 'options-unfinished-light.png');

  await options.setInputFiles('#dict-file', jmdict);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'), null, { timeout: 180000 });
  await options.fill('#deck', 'Japanese::Mining');
  await options.press('#deck', 'Tab');
  await options.click('#anki-check');
  await options.locator('#anki-status:not(:empty)').waitFor();
  await shot(options, 'options-light.png', true);
  await options.emulateMedia({ colorScheme: 'dark' });
  await shot(options, 'options-dark.png', true);
  await options.emulateMedia({ colorScheme: 'light' });

  const ankiSection = options.locator('section[aria-labelledby="anki-heading"]');
  await options.selectOption('#note-type', 'Japanese sentences');
  await options.getByLabel('Source', { exact: true }).fill('<a href="{url}">{title}</a>');
  await shot(ankiSection, 'options-note-type-light.png');
  await options.getByLabel('Reading', { exact: true }).fill('{Reading}');
  await shot(ankiSection, 'options-note-type-error-light.png');
  await options.getByLabel('Reading', { exact: true }).fill('{reading}');
  await options.click('label:has(input[name="theme"][value="dark"])');
  await shot(ankiSection, 'options-note-type-dark.png');
  await shot(options, 'options-forced-dark.png', true);
  await options.selectOption('#note-type', 'builtin');
  await options.click('label:has(input[name="theme"][value="system"])');
  anki.close();
  anki.closeAllConnections();

  await worker.evaluate(() => chrome.storage.local.set({
    'w:魚': 'learning', 'w:雨': 'learning', 'w:食べる': 'known', 'w:今日': 'known', 'w:本': 'known', 'w:家': 'ignored',
  }));
  const statuses = options.locator('section[aria-labelledby="statuses-heading"]');
  await options.locator('#status-counts', { hasText: 'Known3' }).waitFor();
  await shot(statuses, 'options-statuses-light.png');
  await options.emulateMedia({ colorScheme: 'dark' });
  await shot(statuses, 'options-statuses-dark.png');

  const tab = await context.newPage();
  await tab.setViewportSize({ width: 1000, height: 720 });
  await tab.goto(pageUrl);
  await tab.waitForSelector('#dark .ml-word[data-ml-lemma="読む"]', { timeout: 20000 });
  console.log('words:', await tab.$$eval('#light .ml-word', spans => spans.map(s => `${s.textContent}:${s.className.split(' ')[1]}`).join(' ')));
  await shot(tab.locator('#light'), 'page-light.png');
  await shot(tab.locator('#dark'), 'page-dark.png');

  const popup = tab.locator('minerr-popup .popup');
  const popups: ['light' | 'dark', string][] = [['light', '#light .ml-word[data-ml-lemma="食べる"]'], ['dark', '#dark .ml-word[data-ml-lemma="猫"]']];
  for (const [scheme, word] of popups) {
    await tab.emulateMedia({ colorScheme: scheme });
    await tab.hover(word);
    await popup.locator('li').first().waitFor();
    if (scheme === 'dark') {
      await tab.keyboard.press('a');
      await popup.locator('.message.error').waitFor();
    }
    await shot(tab, `popup-${scheme}.png`);
    await popup.locator('.definitions').evaluate(list => { list.scrollTop = list.scrollHeight; });
    await shot(tab, `popup-${scheme}-end.png`);
    await tab.mouse.move(0, 0);
    await tab.keyboard.press('Escape');
  }

  await worker.evaluate(() => chrome.storage.local.set({ theme: 'dark' }));
  await tab.emulateMedia({ colorScheme: 'light' });
  await tab.hover('#light .ml-word[data-ml-lemma="食べる"]');
  await popup.locator('li').first().waitFor();
  await shot(tab, 'popup-forced-dark-on-light.png');
  await tab.keyboard.press('Escape');
  await worker.evaluate(() => chrome.storage.local.set({ theme: 'system' }));

  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, tab.url());
  const menu = await context.newPage();
  await menu.setViewportSize({ width: 340, height: 600 });
  await menu.goto(`chrome-extension://${extensionId}/action.html?tab=${tabId}`);
  await menu.locator('#sentences li').first().waitFor();
  for (const scheme of ['light', 'dark'] as const) {
    await menu.emulateMedia({ colorScheme: scheme });
    await shot(menu, `menu-${scheme}.png`, true);
  }

  const clip = join(work, 'clip.webm');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=6', '-c:v', 'libvpx', '-b:v', '200k', clip]);
  const srt = join(work, 'clip.srt');
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:03,000\n猫が魚を食べなかった。\n\n2\n00:00:03,000 --> 00:00:06,000\n今日は雨が降っているので、家で本を読みます。\n');
  const player = await context.newPage();
  await player.setViewportSize({ width: 1000, height: 720 });
  await player.goto(`chrome-extension://${extensionId}/player.html`);
  await player.setInputFiles('#video-file', clip);
  await player.setInputFiles('#subs-file', srt);
  await player.evaluate(() => new Promise(resolve => {
    const video = document.querySelector('video');
    video?.addEventListener('seeked', resolve, { once: true });
    if (video) video.currentTime = 2;
  }));
  await player.locator('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]').waitFor({ timeout: 20000 });
  for (const scheme of ['light', 'dark'] as const) {
    await player.emulateMedia({ colorScheme: scheme });
    await shot(player, `player-${scheme}.png`);
  }
  await player.keyboard.press('g');
  await player.locator('.minerr-lines li[aria-current="true"]').waitFor();
  await player.setViewportSize({ width: 1400, height: 720 });
  for (const scheme of ['light', 'dark'] as const) {
    await player.emulateMedia({ colorScheme: scheme });
    await shot(player, `sidebar-${scheme}.png`);
  }
} finally {
  await context.close();
  site.close();
  anki.close();
}
