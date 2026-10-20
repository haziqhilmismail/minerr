// Measures the first parse of a page with many Japanese text nodes: the longest task of the page and the time until
// every line has its words. Run it after npm run build: node test/page-perf.ts [lines], 50000 lines by default.
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, listen } from './harness.ts';

const lines = Number(process.argv[2] ?? 50000);
const work = mkdtempSync(join(tmpdir(), 'ml-page-perf-'));
// The line after a <br> stays one text node, as on an Aozora Bunko page.
const html = '<!doctype html><meta charset="utf-8"><title>perf</title><body><script>'
  + 'window.tasks = []; new PerformanceObserver(list => window.tasks.push(...list.getEntries().map(e => e.duration))).observe({ type: "longtask", buffered: true });'
  + `</script><div class="main_text">${'猫が魚を食べた。<br>'.repeat(lines)}</div></body>`;
const site = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
const url = `http://127.0.0.1:${await listen(site, 0)}/`;
const { context } = await launch(join(work, 'profile'));
try {
  const tab = await context.newPage();
  const start = Date.now();
  await tab.goto(url);
  await tab.waitForFunction(n => document.querySelectorAll('.main_text .ml-word[data-ml-lemma="食べる"]').length === n, lines, { timeout: 600000, polling: 500 });
  const wrapped = (Date.now() - start) / 1000;
  const tasks = await tab.evaluate(() => (Reflect.get(window, 'tasks') as number[]).toSorted((a, b) => b - a));
  console.log(`${lines} text nodes: all words after ${wrapped} s; longest tasks (ms): ${tasks.slice(0, 5).map(t => t.toFixed(0)).join(' ')}; ${tasks.length} long tasks`);
} finally {
  await context.close();
  site.close();
}
