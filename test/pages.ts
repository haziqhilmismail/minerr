import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { at } from '../src/shared/guards.ts';
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
  await action.goto(extensionPage(`pages/action.html?tab=${await tabIdOf(url)}`));
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
    '5 words in the 2 subtitle lines that the overlay showed. Known and ignored words are understood.',
    'Recommended sentences (1)', '猫が魚を食べた。',
  ]);
  assert.equal(await videoPopup.locator('#sentences button').count(), 0);
  await videoPopup.close();

  const empty = await context.newPage();
  await empty.goto(`${origin}/empty`);
  const emptyPopup = await toolbarPopup(`${origin}/empty`);
  assert.equal(await emptyPopup.textContent('#score-empty'), 'This page has no Japanese words.');
  assert.equal(await emptyPopup.isVisible('#score'), false);
  for (const [button, path] of [['#words', 'pages/words.html'], ['#reader', 'pages/reader.html'], ['#paste', 'pages/reader.html?paste']] as const) {
    const [opened] = await Promise.all([context.waitForEvent('page'), emptyPopup.click(button)]);
    await opened.waitForURL(extensionPage(path));
    await opened.close();
  }
  await emptyPopup.close();
  console.log('video score from the seen subtitle lines; a page without Japanese has no score');

  const many = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`w:語${String(i).padStart(5, '0')}`, i % 3 ? 'known' : 'learning']));
  await worker.evaluate(words => chrome.storage.local.set(words), many);
  const browser = await context.newPage();
  const opened = Date.now();
  await browser.goto(extensionPage('pages/words.html'));
  await browser.waitForSelector('#rows tr');
  const openMs = Date.now() - opened;
  const listedWords = () => browser.$$eval('#rows tr', rows => rows.map(row => `${row.querySelector('.word')?.textContent} ${row.querySelector('select')?.value}`));
  assert.equal((await listedWords()).length, 200);
  assert.equal(await browser.textContent('#range'), '1–200 of 20004');
  const searched = Date.now();
  await browser.fill('#search', '猫');
  await browser.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);
  console.log(`word browser with 20,004 words: open ${openMs} ms, search ${Date.now() - searched} ms`);
  assert.ok(openMs < 5000, 'the word browser opens in less than 5 s with 20,000 words');
  assert.deepEqual(await listedWords(), ['猫 known']);
  await browser.fill('#search', '');
  await browser.selectOption('#filter', 'ignored');
  assert.deepEqual(await listedWords(), ['田中 ignored']);
  await browser.selectOption('#filter', 'all');
  await browser.selectOption('#sort', 'status');
  assert.deepEqual((await listedWords()).slice(0, 2), ['語00000 learning', '語00003 learning']);
  await browser.click('#next');
  assert.equal(await browser.textContent('#range'), '201–400 of 20004');

  await browser.fill('#search', '語0000');
  await browser.check('#select-all');
  assert.equal(await browser.textContent('#selection'), '10 selected');
  await browser.click('#bulk button:has-text("Ignored")');
  await browser.waitForFunction(() => [...document.querySelectorAll('#rows select')].every(select => select instanceof HTMLSelectElement && select.value === 'ignored'));
  const stored = (keys: string[]) => worker.evaluate(keys => chrome.storage.local.get(keys), keys);
  assert.deepEqual(await stored(['w:語00000', 'w:語00001', 'w:語00010']), { 'w:語00000': 'ignored', 'w:語00001': 'ignored', 'w:語00010': 'known' });
  assert.equal(await browser.textContent('#selection'), '0 selected');
  await browser.check('#select-all');
  browser.once('dialog', dialog => dialog.accept());
  await browser.click('#bulk button:has-text("Unknown (remove)")');
  await browser.locator('#range', { hasText: 'No word matches.' }).waitFor();
  assert.deepEqual(await stored(['w:語00000', 'w:語00009', 'w:語00010']), { 'w:語00010': 'known' });
  console.log('word browser: search, filter, sort, pages, bulk status, bulk remove');

  await browser.fill('#search', '猫');
  await browser.selectOption('#rows select', 'learning');
  await browser.waitForFunction(() => document.querySelector<HTMLSelectElement>('#rows select')?.value === 'learning');
  assert.deepEqual(await stored(['w:猫']), { 'w:猫': 'learning' });
  await browser.fill('#paste-text', '猫\n犬\n犬\n\n本\n');
  await browser.click('#paste-preview-button');
  await browser.locator('#paste-preview', { hasText: 'Click Save' }).waitFor();
  assert.equal(await browser.textContent('#paste-preview'),
    '3 words: 1 new, 1 with a different status, 1 with this status. 猫、犬、本. Click Save to set them to known.');
  assert.deepEqual(await stored(['w:犬']), {}, 'the preview changes no status');
  await browser.click('#paste-save');
  await browser.locator('#paste-preview', { hasText: 'Saved. 1 new words, 1 changed.' }).waitFor();
  assert.deepEqual(await stored(['w:猫', 'w:犬']), { 'w:猫': 'known', 'w:犬': 'known' });
  await browser.fill('#paste-text', '雨が降らなかった。猫');
  await browser.check('input[name="pasteKind"][value="text"]');
  await browser.selectOption('#paste-status', 'ignored');
  await browser.click('#paste-preview-button');
  await browser.locator('#paste-preview', { hasText: 'Click Save' }).waitFor();
  assert.equal(await browser.textContent('#paste-preview'),
    '3 words: 2 new, 1 with a different status, 0 with this status. 雨、降る、猫. Click Save to set them to ignored.');
  await browser.click('#paste-save');
  await browser.locator('#paste-preview', { hasText: 'Saved.' }).waitFor();
  assert.deepEqual(await stored(['w:雨', 'w:降る', 'w:猫']), { 'w:雨': 'ignored', 'w:降る': 'ignored', 'w:猫': 'ignored' });
  console.log('word browser: paste a word list and a parsed text, with a preview before the save');
  await worker.evaluate(keys => chrome.storage.local.remove(keys), [...Object.keys(many), 'w:犬', 'w:雨', 'w:降る']);
  await worker.evaluate(() => chrome.storage.local.set({ 'w:猫': 'known' }));
  await browser.close();

  const xhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>`
    + `<style>p { color: red }</style><script>window.pwned = 1</script></head><body>${body}</body></html>`;
  const longChapter = Array.from({ length: 80 }, (_, i) => `<p>本を読む。${i}</p>`).join('');
  const epub = join(work, 'book.epub');
  execFileSync('python3', ['-I', join(import.meta.dirname, 'make-zip.py'), epub,
    'mimetype=stored:application/epub+zip',
    'META-INF/container.xml=deflated:<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
      + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf=deflated:<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
      + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>猫の本</dc:title></metadata><manifest>'
      + '<item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="Text/one.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="c2" href="Text/two%20b.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="Text/three.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="css" href="style.css" media-type="text/css"/></manifest>'
      + '<spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="css"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>',
    `OEBPS/Text/cover.xhtml=deflated:${xhtml('<div><img src="../cover.jpg" alt=""/></div>')}`,
    `OEBPS/Text/one.xhtml=deflated:${xhtml('<h1 class="t" style="color: red">第一章</h1>'
      + '<p id="first" onclick="window.pwned = 2" style="color: red">猫が<ruby>魚<rp>(</rp><rt>さかな</rt><rp>)</rp></ruby>を食べた。</p>'
      + '<p><a href="javascript:window.pwned = 3">雨と風。</a><img src="x" onerror="window.pwned = 4"/></p>'
      + `<svg xmlns="http://www.w3.org/2000/svg"><script>window.pwned = 5</script><text>描画</text></svg>${longChapter}`)}`,
    `OEBPS/Text/two b.xhtml=deflated:${xhtml(`<h2>第二章</h2><p>猫が好き。</p>${longChapter}`)}`,
    // Not well-formed XML (an HTML entity), so the HTML parser reads it.
    'OEBPS/Text/three.xhtml=deflated:<html><body><p>最後&nbsp;の章。</p></body></html>',
  ]);
  const reader = await context.newPage();
  await reader.goto(extensionPage('pages/reader.html'));
  await reader.setInputFiles('#file', epub);
  await reader.waitForSelector('#article .ml-word[data-ml-lemma="魚"]', { timeout: 20000 });
  assert.equal(await reader.title(), '猫の本 - Minerr');
  assert.equal(await reader.locator('header .ml-word').count(), 0, 'the book title is not page text');
  assert.deepEqual(await reader.$$eval('#chapters option', options => options.map(option => option.textContent)), ['第一章', '第二章', 'Section 3']);
  const safety = await reader.evaluate(() => ({
    pwned: 'pwned' in window,
    attributes: [...new Set([...document.querySelectorAll('#article *')].flatMap(element => [...element.attributes].map(attribute => attribute.name)))].sort(),
    tags: [...new Set([...document.querySelectorAll('#article *')].map(element => element.localName))].sort(),
    rt: [...document.querySelectorAll('#article rt')].map(rt => [rt.textContent, rt.getAttribute('data-rt')]),
    first: document.querySelector('#article p')?.textContent,
  }));
  console.log('epub chapter after the sanitizer:', safety);
  assert.deepEqual(safety, {
    pwned: false, attributes: ['class', 'data-ml-lemma', 'data-ml-reading', 'data-rt'], tags: ['h1', 'p', 'rt', 'ruby', 'span'],
    rt: [['', 'さかな']], first: '猫が魚を食べた。',
  });

  const scrollTop = () => reader.$eval('#text', text => text.scrollTop);
  const chapterIndex = () => reader.$eval('#chapters', select => select instanceof HTMLSelectElement ? select.value : '');
  await reader.keyboard.press('PageDown');
  const page = await scrollTop();
  const viewHeight = await reader.$eval('#text', text => text.clientHeight);
  assert.ok(Math.abs(page - Math.round(viewHeight * 0.9)) <= 1, `PageDown scrolls 90% of the view (${page} of ${viewHeight})`);
  await reader.keyboard.press('Space');
  await reader.keyboard.press('Shift+Space');
  assert.equal(await scrollTop(), page);
  for (let i = 0; i < 100 && (await chapterIndex()) === '0'; i++) await reader.keyboard.press('ArrowDown');
  assert.equal(await chapterIndex(), '1');
  assert.equal(await scrollTop(), 0);
  await reader.waitForSelector('#article .ml-word[data-ml-lemma="好き"]');
  await reader.keyboard.press('ArrowUp');
  assert.equal(await chapterIndex(), '0');
  assert.ok(await reader.$eval('#text', text => text.scrollTop + text.clientHeight >= text.scrollHeight - 1), 'PageUp at a chapter start opens the end of the chapter before');
  await reader.keyboard.press('PageDown');
  await reader.selectOption('#chapters', '1');
  await reader.keyboard.press('PageDown');
  await reader.waitForTimeout(500);
  const bookKey = `reader:${statSync(epub).size}:book.epub`;
  const savedPosition = at(await worker.evaluate(key => chrome.storage.local.get(key), bookKey), bookKey);
  assert.equal(at(savedPosition, 'chapter'), 1);
  console.log('epub: chapter list, page keys across chapters, position', savedPosition);

  await reader.hover('#article .ml-word[data-ml-lemma="好き"]');
  const readerPopup = reader.locator('minerr-popup .popup');
  await readerPopup.locator('.lemma', { hasText: '好き' }).waitFor();
  await reader.keyboard.press('2');
  await reader.waitForSelector('#article .ml-word.ml-learning[data-ml-lemma="好き"]');
  await reader.keyboard.press('Escape');
  const readerStats = await toolbarPopup(extensionPage('pages/reader.html'));
  assert.equal((await scoreText(readerStats))[3], 'Learning 1', 'the score of the reader tab counts 好き as learning');
  await readerStats.close();
  console.log('reader: the word popup sets a status, and the toolbar popup shows the score of the reader tab');

  await reader.keyboard.press('PageDown');
  const savedTop = await scrollTop();
  await reader.waitForTimeout(500);
  await reader.reload();
  await reader.setInputFiles('#file', epub);
  await reader.waitForSelector('#article .ml-word[data-ml-lemma="好き"]');
  assert.equal(await chapterIndex(), '1');
  const restoredTop = await scrollTop();
  // The word spans of page.ts can move the text by a few pixels after the reader restores the place.
  assert.ok(Math.abs(restoredTop - savedTop) <= 10, `the reader opens the file at the saved place (${restoredTop}, saved ${savedTop})`);

  await reader.click('#vertical');
  await reader.waitForFunction(() => getComputedStyle(document.querySelector('#text') ?? document.body).writingMode === 'vertical-rl');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('readerVertical')), { readerVertical: true });
  await reader.selectOption('#chapters', '1');
  await reader.keyboard.press('ArrowLeft');
  const [left, width] = await reader.$eval('#text', text => [text.scrollLeft, text.clientWidth]);
  assert.ok(left < 0 && Math.abs(-left - Math.round((width ?? 0) * 0.9)) <= 1, `ArrowLeft goes forward in vertical text (${left} of ${width})`);
  await reader.keyboard.press('ArrowRight');
  assert.equal(await reader.$eval('#text', text => text.scrollLeft), 0);
  await reader.click('#vertical');
  await reader.keyboard.press('Space');
  await reader.waitForFunction(() => document.querySelector('#text')?.classList.contains('vertical'));
  await reader.keyboard.press('Space');
  await reader.waitForFunction(() => !document.querySelector('#text')?.classList.contains('vertical'));
  console.log('vertical text: the left arrow turns the page forward; Space presses a focused button');

  const txt = join(work, 'long.txt');
  writeFileSync(txt, `﻿${Array.from({ length: 25 }, (_, i) => `${'猫'.repeat(999)}${i}`).join('\r\n')}`);
  await reader.setInputFiles('#file', txt);
  await reader.waitForFunction(() => document.title === 'long.txt - Minerr');
  assert.deepEqual(await reader.$$eval('#chapters option', options => options.map(option => option.textContent)), ['Part 1', 'Part 2', 'Part 3']);
  const srt = join(work, 'clip.srt');
  writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,000\n猫が魚を\n食べた。\n\n2\n00:00:03,000 --> 00:00:04,000\n雨と風。\n');
  await reader.setInputFiles('#file', srt);
  await reader.waitForFunction(() => document.title === 'clip.srt - Minerr');
  assert.deepEqual(await reader.$$eval('#article p', ps => ps.map(p => p.textContent)), ['猫が魚を\n食べた。', '雨と風。']);
  assert.equal(await reader.isVisible('#chapter-choice'), false);
  console.log('txt in parts of about 10,000 characters; srt with one paragraph for each cue');
  await reader.close();

  const paste = await context.newPage();
  await paste.addInitScript(() => {
    // The test cannot click the permission prompt of Chrome, and Playwright cannot grant clipboard access to an extension page.
    chrome.permissions.request = async () => true;
    chrome.permissions.contains = async () => true;
    Object.defineProperty(navigator.clipboard, 'readText', { value: async () => document.documentElement.dataset.clipboard ?? '' });
  });
  await paste.goto(extensionPage('pages/reader.html?paste'));
  assert.equal(await paste.textContent('#status'), 'Press Ctrl+V to read the text in the clipboard.');
  const pasteText = (value: string) => paste.evaluate(value => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, value);
  await pasteText('猫が魚を食べた。');
  await pasteText('雨と風。\n本を読む。');
  await paste.waitForSelector('.entry:nth-child(2) .ml-word[data-ml-lemma="読む"]', { timeout: 20000 });
  assert.deepEqual(await paste.$$eval('.entry', entries => entries.map(entry => [...entry.querySelectorAll('p')].map(p => p.textContent))),
    [['猫が魚を食べた。'], ['雨と風。', '本を読む。']]);
  await paste.check('#auto-paste');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('readerAutoPaste')), { readerAutoPaste: true });
  await paste.evaluate(() => { document.documentElement.dataset.clipboard = '猫が好き。'; });
  await paste.evaluate(() => window.dispatchEvent(new Event('focus')));
  await paste.waitForSelector('.entry:nth-child(3) .ml-word[data-ml-lemma="好き"]');
  await paste.evaluate(() => window.dispatchEvent(new Event('focus')));
  await paste.waitForTimeout(300);
  assert.equal(await paste.locator('.entry').count(), 3, 'a focus without a new copy adds nothing');
  console.log('paste page: Ctrl+V adds an entry; auto-paste reads the clipboard on focus');
  await paste.close();

  assert.deepEqual(failures, [], 'no uncaught page errors');
  console.log('PAGES E2E PASS');
} finally {
  await context.close();
  site.close();
}
