// Renders the note type's front and back with a sample note to OUT_DIR (default /tmp/minerr-card) for a visual check.
// Needs test/fixtures/JMdict_english.zip. If the system has no Japanese font, set CJK_FONT_DIR to a folder of fonts.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { definitionHtml, NOTE_TYPE } from '../src/anki.js';
import { groupTerms, readYomitan } from '../src/yomitan.js';
import { useCjkFonts } from './harness.mjs';

const out = process.env.OUT_DIR ?? '/tmp/minerr-card';
mkdirSync(out, { recursive: true });
useCjkFonts(mkdtempSync(join(tmpdir(), 'ml-card-')));

const dict = await readYomitan(readFileSync(join(import.meta.dirname, 'fixtures', 'JMdict_english.zip')));
const rows = [];
for (const load of dict.banks) {
  rows.push(...(await load()).filter(t => t.expression === '食べる').map(t => ({ ...t, dict: dict.title })));
}
const [group] = groupTerms(rows.sort((a, b) => b.score - a.score), dict.tags.map(tag => ({ ...tag, dict: dict.title })));
const image = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
<rect width="1280" height="720" fill="#3b4a5e"/><rect y="560" width="1280" height="160" fill="#000"/>
<text x="640" y="660" fill="#fff" font-size="64" text-anchor="middle" font-family="Noto Sans JP, sans-serif">猫が魚を食べなかった。</text></svg>`)}`;
const fields = {
  Word: '食べる',
  Reading: 'たべる',
  Sentence: '猫が魚を<b>食べなかった</b>。',
  Definition: definitionHtml(group),
  Image: `<img src="${image}">`,
};
console.log('Definition:', fields.Definition);

// Enough of Anki's template syntax for these templates: {{#Field}}...{{/Field}} and {{Field}}.
const fill = (template, values) => template
  .replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, name, inner) => (values[name] ? inner : ''))
  .replace(/{{(\w+)}}/g, (_, name) => values[name]);
const [{ Front, Back }] = NOTE_TYPE.cardTemplates;
const front = fill(Front, fields);
const sides = { front, back: fill(Back, { ...fields, FrontSide: front }) };

const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const [device, viewport] of [['desktop', { width: 1000, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    for (const [side, html] of Object.entries(sides)) {
      for (const night of [false, true]) {
        await page.setContent(`<!doctype html><meta charset="utf-8"><style>${NOTE_TYPE.css}</style>
<body class="card${night ? ' nightMode' : ''}">${html}</body>`);
        const path = join(out, `${side}-${night ? 'night' : 'light'}-${device}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log('saved', path);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
