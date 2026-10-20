import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, listen } from './harness.ts';

const work = mkdtempSync(join(tmpdir(), 'ml-pages-'));

const PAGES: Record<string, string> = {
  '/article': '<p id="a">猫が魚を食べた。</p><p>雨と風。</p><p>猫が魚を食べた。</p><div style="height: 3000px"></div><p id="far">本を読む。</p>',
  '/watch': '<div class="minerr-subs"><div class="minerr-subs-line">猫が魚を食べた。</div></div><p>本を読む。</p>',
  '/empty': '<p>No Japanese here.</p>',
};
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><body>${PAGES[new URL(req.url ?? '/', 'http://x').pathname] ?? ''}</body>`);
});
const origin = `http://127.0.0.1:${await listen(site, 0)}`;

const { context, worker, extensionId } = await launch(join(work, 'profile'));
const failures: string[] = [];
context.on('weberror', error => failures.push(error.error().message));
const extensionPage = (path: string) => `chrome-extension://${extensionId}/${path}`;
const tabIdOf = (url: string) => worker.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id, url);

async function toolbarPopup(url: string): Promise<Page> {
  const action = await context.newPage();
  await action.goto(extensionPage(`action.html?tab=${await tabIdOf(url)}`));
  await action.waitForFunction(() => document.querySelector<HTMLElement>('#score')?.hidden === false
    || document.querySelector('#score-empty')?.textContent !== 'Reading this tab…');
  return action;
}

const scoreText = (action: Page) => action.$$eval('#score-percent, #score-label, #score-counts li, #score-basis, #sentences-title, #sentences li',
  nodes => nodes.map(node => node.textContent));

try {
  await worker.evaluate(() => chrome.storage.local.set({ 'w:猫': 'known', 'w:食べる': 'known', 'w:本': 'known', 'w:田中': 'ignored' }));

  const article = await context.newPage();
  await article.goto(`${origin}/article`);
  await article.waitForSelector('#far .ml-word[data-ml-lemma="読む"]', { timeout: 20000 });
  const action = await toolbarPopup(`${origin}/article`);
  const shown = await scoreText(action);
  console.log('page comprehension:', shown);
  assert.deepEqual(shown, [
    '50%', 'Ambitious', 'Unknown 4', 'Learning 0', 'Known 3', 'Ignored 0',
    '10 words on this page. Known and ignored words are understood.',
    'Recommended sentences (2)', '猫が魚を食べた。', '本を読む。',
  ]);
  assert.equal(await article.evaluate(() => scrollY), 0);
  await action.click('#sentences button >> text=本を読む。');
  await article.waitForFunction(() => scrollY > 1000 && CSS.highlights.has('minerr-focus'));
  console.log('a click on a recommended sentence scrolls the tab to it');
  await action.close();

  await worker.evaluate(() => chrome.storage.local.set({ 'w:魚': 'known', 'w:雨': 'ignored', 'w:風': 'known', 'w:読む': 'known' }));
  await article.waitForSelector('#far .ml-word.ml-known[data-ml-lemma="読む"]');
  const easy = await toolbarPopup(`${origin}/article`);
  assert.deepEqual((await scoreText(easy)).slice(0, 6), ['100%', 'Exceptional', 'Unknown 0', 'Learning 0', 'Known 6', 'Ignored 1']);
  await easy.close();
  await worker.evaluate(() => chrome.storage.local.remove(['w:魚', 'w:雨', 'w:風', 'w:読む']));

  const video = await context.newPage();
  await video.goto(`${origin}/watch?v=abc`);
  await video.waitForSelector('.minerr-subs-line .ml-word[data-ml-lemma="食べる"]', { timeout: 20000 });
  await video.evaluate(() => document.dispatchEvent(new Event('timeupdate')));
  await video.evaluate(() => {
    const line = document.querySelector('.minerr-subs-line');
    if (line) line.textContent = '雨と風。';
  });
  await video.waitForSelector('.minerr-subs-line .ml-word[data-ml-lemma="風"]');
  await video.evaluate(() => document.dispatchEvent(new Event('timeupdate')));
  const videoPopup = await toolbarPopup(`${origin}/watch?v=abc`);
  const videoShown = await scoreText(videoPopup);
  console.log('video comprehension:', videoShown);
  assert.deepEqual(videoShown, [
    '40%', 'Ambitious', 'Unknown 3', 'Learning 0', 'Known 2', 'Ignored 0',
    '5 words in 2 subtitle lines. Known and ignored words are understood.',
    'Recommended sentences (1)', '猫が魚を食べた。',
  ]);
  assert.equal(await videoPopup.locator('#sentences button').count(), 0);
  await videoPopup.close();

  const empty = await context.newPage();
  await empty.goto(`${origin}/empty`);
  const emptyPopup = await toolbarPopup(`${origin}/empty`);
  assert.equal(await emptyPopup.textContent('#score-empty'), 'This page has no Japanese words.');
  assert.equal(await emptyPopup.isVisible('#score'), false);
  await emptyPopup.close();
  console.log('video score from the seen subtitle lines; a page without Japanese has no score');

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('PAGES E2E PASS');
} finally {
  await context.close();
  site.close();
}
