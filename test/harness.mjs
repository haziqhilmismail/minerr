import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const here = import.meta.dirname;
// Run npm run build first: the tests load the built extension in dist/.
export const extension = process.env.EXTENSION_DIR ?? join(here, '..', 'dist');

// rows are Yomitan term_bank rows, tags are tag_bank rows.
export function makeDictionary(path, title, rows, tags = []) {
  execFileSync('python3', ['-I', join(here, 'make-zip.py'), path,
    `index.json=stored:${JSON.stringify({ title, revision: '1', format: 3 })}`,
    `term_bank_1.json=deflated:${JSON.stringify(rows)}`,
    `tag_bank_1.json=deflated:${JSON.stringify(tags)}`]);
  return path;
}

export const listen = (server, port) => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));

export async function launch(profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  return { context, worker, extensionId: new URL(worker.url()).host };
}

// If CJK_FONT_DIR is set, Chromium launched after this call also uses the fonts in that folder.
export function useCjkFonts(work) {
  if (!process.env.CJK_FONT_DIR) return;
  const conf = join(work, 'fonts.conf');
  writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${process.env.CJK_FONT_DIR}</dir></fontconfig>`);
  process.env.FONTCONFIG_FILE = conf;
}
