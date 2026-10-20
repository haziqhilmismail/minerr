// Saves UI screenshots to OUT_DIR (default /tmp/minerr-ui) for a visual check.
// Needs test/fixtures/JMdict_english.zip. If the system has no Japanese font, set CJK_FONT_DIR to a folder of fonts.
import { mkdirSync, mkdtempSync } from 'node:fs';
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

  await worker.evaluate(() => chrome.storage.local.set({
    'w:魚': 'learning', 'w:雨': 'learning', 'w:食べる': 'known', 'w:今日': 'known', 'w:本': 'known', 'w:家': 'ignored',
  }));
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
} finally {
  await context.close();
  site.close();
}
