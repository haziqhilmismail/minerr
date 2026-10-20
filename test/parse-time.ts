// Prints the parse time of a long page with the real JMdict installed: the first parse of its words, and a second parse.
// Needs test/fixtures/JMdict_english.zip. Set EXTENSION_DIR to time another build.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readYomitan } from '../src/yomitan.ts';
import { launch } from './harness.ts';

const jmdict = join(import.meta.dirname, 'fixtures', 'JMdict_english.zip');
const PARAGRAPHS = 200;
const WORDS = 15;

// Common headwords with kanji, so most words of the page are different words, as on a long article.
const dict = await readYomitan(readFileSync(jmdict));
const headwords = new Set<string>();
for (const load of dict.banks) {
  for (const term of await load()) if (term.score > 0 && /[一-鿿]/.test(term.expression)) headwords.add(term.expression);
}
const pool = [...headwords];
const step = Math.floor(pool.length / (PARAGRAPHS * WORDS));
const particles = ['が', 'を', 'に', 'の', 'と', 'で'];
const paragraphs = Array.from({ length: PARAGRAPHS }, (_, p) => Array.from({ length: WORDS },
  (_, w) => `${pool[(p * WORDS + w) * step]}${particles[w % particles.length]}`).join('') + '。');

const { context, extensionId } = await launch(mkdtempSync(join(tmpdir(), 'ml-parse-time-')));
try {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.setInputFiles('#dict-file', jmdict);
  await options.waitForFunction(() => document.querySelector('#dict-status')?.textContent?.startsWith('Imported'), undefined, { timeout: 600000 });
  const time = () => options.evaluate(async texts => {
    const start = performance.now();
    // In batches of 100 texts, as src/page.ts sends them.
    for (let i = 0; i < texts.length; i += 100) await chrome.runtime.sendMessage({ type: 'parse', texts: texts.slice(i, i + 100) });
    return Math.round(performance.now() - start);
  }, paragraphs);
  // The first parse also starts the offscreen document and loads kuromoji.
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'parse', texts: ['準備'] }));
  const characters = paragraphs.join('').length;
  console.log(`${PARAGRAPHS} paragraphs, ${characters} characters: first parse ${await time()} ms, second parse ${await time()} ms`);
} finally {
  await context.close();
}
