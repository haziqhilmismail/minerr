// Renders the promo tiles of the Chrome Web Store listing from docs/logo.svg to OUT_DIR (default /tmp/minerr-store):
// promo-small-440x280.png and promo-marquee-1400x560.png. For the font of the tiles, set CJK_FONT_DIR to a folder with
// Segoe UI, for example /mnt/c/Windows/Fonts.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { useCjkFonts } from './harness.ts';

const out = process.env.OUT_DIR ?? '/tmp/minerr-store';
const logo = `data:image/svg+xml;base64,${readFileSync(join(import.meta.dirname, '..', 'docs', 'logo.svg')).toString('base64')}`;

const CSS = `body { margin: 0; overflow: hidden; color: #e7f2f1; font-family: 'Segoe UI', sans-serif;
  background: radial-gradient(circle at 18% 30%, #0f4f49 0%, #0f1d24 62%); }
  .tile { display: flex; align-items: center; box-sizing: border-box; width: 100%; height: 100%; }
  img { image-rendering: pixelated; filter: drop-shadow(0 12px 28px rgb(0 0 0 / .45)); }
  h1 { margin: 0; font-weight: 700; letter-spacing: -.01em; line-height: 1; }
  p { margin: 0; color: #a9bfc2; font-weight: 600; text-wrap: balance; }
  .chips { display: flex; gap: 14px; }
  .chip { padding: 8px 18px; border-radius: 999px; background: rgb(45 212 191 / .14); color: #5eead4; font-weight: 600; }
  .accent { color: #ffb238; }`;

const TILES = [
  { name: 'promo-small-440x280', width: 440, height: 280, html: `<div class="tile" style="gap: 24px; padding: 0 30px">
    <img src="${logo}" width="168" height="168">
    <div><h1 style="font-size: 50px">Minerr</h1>
    <p style="margin-top: 12px; font-size: 18px; line-height: 1.35">Read Japanese.<br><span class="accent">Mine Anki cards.</span></p></div></div>` },
  { name: 'promo-marquee-1400x560', width: 1400, height: 560, html: `<div class="tile" style="gap: 70px; padding: 0 110px">
    <img src="${logo}" width="380" height="380">
    <div><h1 style="font-size: 110px">Minerr</h1>
    <p style="margin-top: 22px; font-size: 34px; line-height: 1.35; color: #e7f2f1">Read Japanese on any page and in video subtitles.</p>
    <p style="margin-top: 8px; font-size: 34px; line-height: 1.35"><span class="accent">Look up a word on hover. Add it to Anki with one key.</span></p>
    <div class="chips" style="margin-top: 34px; font-size: 22px"><span class="chip">Free and open source</span><span class="chip">No account, no cloud</span></div></div></div>` },
];

useCjkFonts(mkdtempSync(join(tmpdir(), 'minerr-tiles-')));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const { name, width, height, html } of TILES) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<style>${CSS}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('saved', join(out, `${name}.png`));
}
await browser.close();
