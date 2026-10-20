// Saves the README screenshots of real sites to docs/: a Japanese Wikipedia article and a YouTube video with WhisperX subtitles.
// Needs test/fixtures/JMdict_english.zip, the network, and a WhisperX server on 127.0.0.1:8766 that has the subtitles of VIDEO.
// If the system has no Japanese font, set CJK_FONT_DIR to a folder of fonts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, useCjkFonts } from './harness.ts';

const ARTICLE = 'https://ja.wikipedia.org/wiki/%E3%83%8D%E3%82%B3';
const VIDEO = 'https://www.youtube.com/watch?v=KfQPZZ5JmXw';
const docs = join(import.meta.dirname, '..', 'docs');
const jmdict = join(import.meta.dirname, 'fixtures', 'JMdict_english.zip');
// A beginner's known words, so the screenshots show all statuses and some i+1 sentences.
const KNOWN = ['する', 'ある', 'いる', 'なる', '言う', '行く', '来る', '見る', '思う', 'できる', '人', '日本', '今日', '時', '年', '月', '日',
  '国', '外国', '話', '大きい', '新しい', '多い', 'いい', '毎日', 'ニュース', '大切', '情報', 'サイト', 'こと', 'もの', 'ため', '中', '前', '後'];
const LEARNING = ['生活', '紹介', '住む', '分かる', '必要'];

const work = mkdtempSync(join(tmpdir(), 'minerr-readme-'));
useCjkFonts(work);
const { context, extensionId } = await launch(join(work, 'profile'));

const options = await context.newPage();
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.setInputFiles('#dict-file', jmdict);
await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'), null, { timeout: 180000 });
await options.evaluate(([known, learning]) => chrome.storage.local.set(Object.fromEntries([
  ...known.map(word => [`w:${word}`, 'known']), ...learning.map(word => [`w:${word}`, 'learning'])])), [KNOWN, LEARNING] as const);

const news = await context.newPage();
await news.setViewportSize({ width: 1280, height: 800 });
await news.goto(ARTICLE, { waitUntil: 'load' });
await news.locator('#mw-content-text .ml-word').nth(200).waitFor({ timeout: 60000 });
await news.waitForTimeout(2000);
const target = news.locator('#mw-content-text p .ml-word[data-ml-lemma="狭義"]').first();
await target.scrollIntoViewIfNeeded();
await news.mouse.wheel(0, -120);
await target.hover();
await news.locator('minerr-popup .popup li').first().waitFor();
await news.screenshot({ path: join(docs, 'page.png') });
console.log('saved docs/page.png from', news.url());

const video = await context.newPage();
await video.setViewportSize({ width: 1280, height: 800 });
await video.goto(VIDEO, { waitUntil: 'domcontentloaded' });
const player = video.locator('#movie_player video');
await player.waitFor({ timeout: 60000 });
await video.locator('#movie_player .minerr-subs-line').waitFor({ state: 'attached', timeout: 60000 });
await player.evaluate((element: HTMLVideoElement) => { element.muted = true; element.currentTime = 27; return element.play(); });
await video.waitForTimeout(2500);
await player.evaluate((element: HTMLVideoElement) => element.pause());
const word = video.locator('#movie_player .minerr-subs-line .ml-word.ml-unknown').first();
await word.waitFor({ timeout: 30000 });
await video.mouse.move(0, 0);
await word.hover();
await video.locator('minerr-popup .popup li').first().waitFor();
await video.screenshot({ path: join(docs, 'video.png') });
console.log('saved docs/video.png');

await context.close();
