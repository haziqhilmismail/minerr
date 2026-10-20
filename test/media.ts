// End-to-end test of the i+1 highlight and the local video player.
// Uses port 8765 (mock AnkiConnect) and 8766 (mock WhisperX server), and ffmpeg for a short test clip.
// Saves screenshots to OUT_DIR (default: the temporary work folder).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, PageScreenshotOptions } from 'playwright';
import { launch, listen, useCjkFonts } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-media-'));
const out = process.env.OUT_DIR ?? work;
mkdirSync(out, { recursive: true });
useCjkFonts(work);

const ARTICLE = `<p id="a">猫が魚を食べた。今日は雨が降っている。</p><p id="b">本を<b>読む</b>。</p>`;
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const dark = req.url === '/dark';
  res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px 32px;font:22px/1.9 sans-serif;
    ${dark ? 'background:#16161a;color:#e8e8ea' : 'background:#fff;color:#222'}">${ARTICLE}</body>`);
});
const pageUrl = `http://127.0.0.1:${await listen(site, 0)}`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
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
  await setStorage({ enabled: true });
  await waitHighlighted(tab, ['本を読む。']);
  console.log('Minerr off: no highlight; on: highlight back');

  await setStorage({ 'w:魚': 'unknown', 'w:読む': 'unknown' });
  const dark = await context.newPage();
  await dark.setViewportSize({ width: 760, height: 220 });
  await dark.goto(`${pageUrl}/dark`);
  await waitHighlighted(dark, ['猫が魚を食べた。']);
  await shot(dark, 'iplusone-dark.png');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('MEDIA E2E PASS');
} finally {
  await context.close();
  site.close();
}
