// Measures the first parse of a long article with distinct words and inline links, as a Wikipedia article (see README).
// With test/fixtures/JMdict_english.zip the words come from JMdict and the dictionary is installed, as on the user's Chrome.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readYomitan } from '../src/dictionary/yomitan.ts';
import { launch, listen } from './harness.ts';

const paragraphs = Number(process.argv[2] ?? 2000);
const runs = Number(process.argv[3] ?? 3);
const WORDS = 15;
const VIEWPORT_MS = 400;

const jmdict = join(import.meta.dirname, 'fixtures', 'JMdict_english.zip');
const hasJmdict = existsSync(jmdict);

async function wordPool(): Promise<string[]> {
  if (!hasJmdict) return ['猫', '魚', '食べる', '犬', '走る', '空', '青い', '本', '読む', '水', '飲む', '山', '登る', '花', '咲く'];
  const dict = await readYomitan(readFileSync(jmdict));
  const headwords = new Set<string>();
  for (const load of dict.banks) {
    for (const term of await load()) if (term.score > 0 && /[一-鿿]/.test(term.expression)) headwords.add(term.expression);
  }
  return [...headwords];
}

const pool = await wordPool();
const particles = ['が', 'を', 'に', 'の', 'と', 'で'];
// Every third word is a link, so a paragraph is several text nodes that read as one run.
const paragraph = (p: number) => Array.from({ length: WORDS }, (_, w) => {
  const text = `${pool[(p * WORDS + w) % pool.length]}${particles[w % particles.length]}`;
  return w % 3 === 1 ? `<a href="#">${text}</a>` : text;
}).join('') + '。';
const html = '<!doctype html><meta charset="utf-8"><title>perf</title><body><script>'
  + 'window.tasks = []; new PerformanceObserver(list => window.tasks.push(...list.getEntries().map(e => e.duration))).observe({ type: "longtask", buffered: true });'
  + 'window.marks = { firstViewport: null, lastAdd: null };'
  + 'const inView = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };'
  + 'new MutationObserver(records => { const now = performance.now(); for (const r of records) for (const n of r.addedNodes) {'
  + '  if (!(n instanceof Element) || !n.classList.contains("ml-word")) continue; marks.lastAdd = now;'
  + '  if (marks.firstViewport === null && inView(n)) marks.firstViewport = now; } }).observe(document.body, { childList: true, subtree: true });'
  + `</script>${Array.from({ length: paragraphs }, (_, p) => `<p id="p${p}">${paragraph(p)}</p>`).join('')}</body>`;

const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
const url = `http://127.0.0.1:${await listen(site, 0)}/`;
const work = mkdtempSync(join(tmpdir(), 'ml-page-perf-'));
const { context, extensionId } = await launch(join(work, 'profile'));

// The content scripts run at document_idle, which is about the end of the load event, so firstViewport - load is Minerr's part of the wait.
interface Run { load: number; firstViewport: number; all: number; tasks: number[] }

// Loads the article with the viewport at the top, or at the paragraph of the anchor, and waits for all its words.
async function measure(anchor = ''): Promise<Run> {
  const tab = await context.newPage();
  try {
    await tab.goto(url + anchor);
    await tab.waitForFunction(() => [...document.querySelectorAll('p')].every(p => p.querySelector('.ml-word')), undefined, { timeout: 600000, polling: 200 });
    return await tab.evaluate(() => {
      const marks = Reflect.get(window, 'marks') as { firstViewport: number; lastAdd: number };
      const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      return {
        load: navigation?.loadEventEnd ?? 0, firstViewport: marks.firstViewport, all: marks.lastAdd,
        tasks: (Reflect.get(window, 'tasks') as number[]).toSorted((a, b) => b - a),
      };
    });
  } finally {
    await tab.close();
  }
}

const afterLoad = (run: Run) => run.firstViewport - run.load;
const show = (name: string, run: Run) =>
  console.log(`${name}: page loaded after ${run.load.toFixed(0)} ms, first word in the viewport ${afterLoad(run).toFixed(0)} ms after that, `
    + `all words after ${(run.all / 1000).toFixed(1)} s; ${run.tasks.length} long tasks, longest (ms): ${run.tasks.slice(0, 5).map(t => t.toFixed(0)).join(' ')}`);
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

try {
  if (hasJmdict) {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
    await options.setInputFiles('#dict-file', jmdict);
    await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'), undefined, { timeout: 600000 });
    await options.close();
  }
  console.log(`${paragraphs} paragraphs, ${html.length} bytes, ${hasJmdict ? 'JMdict installed' : 'no dictionary'}`);
  show('cold, top', await measure());
  const top: Run[] = [];
  const middle: Run[] = [];
  for (let i = 0; i < runs; i++) {
    const atTop = await measure();
    show(`warm, top, run ${i + 1}`, atTop);
    top.push(atTop);
    const atMiddle = await measure(`#p${Math.floor(paragraphs / 2)}`);
    show(`warm, middle, run ${i + 1}`, atMiddle);
    middle.push(atMiddle);
  }
  const first = median([...top, ...middle].map(afterLoad));
  console.log(`median first word in the viewport on a warm run: ${first.toFixed(0)} ms after the page load`);
  assert.ok(first < VIEWPORT_MS, `the first word in the viewport shows within ${VIEWPORT_MS} ms of the page load on a warm run`);
} finally {
  await context.close();
  site.close();
}
