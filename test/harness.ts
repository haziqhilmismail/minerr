import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { type BrowserContext, chromium, type Page, type Worker } from 'playwright';
import { BUILTIN, type NoteType } from '../src/anki/anki.ts';
import type { MetaRow } from '../src/dictionary/meta.ts';
import { at } from '../src/shared/guards.ts';
import type { TagRow, TermRow } from '../src/dictionary/yomitan.ts';

const here = import.meta.dirname;
// Run npm run build first: the tests load the built extension in dist/.
export const extension = process.env.EXTENSION_DIR ?? join(here, '..', 'dist');

export function makeDictionary(path: string, title: string, rows: TermRow[], tags: TagRow[] = [], meta: MetaRow[] = []): string {
  execFileSync('python3', ['-I', join(here, 'make-zip.py'), path,
    `index.json=stored:${JSON.stringify({ title, revision: '1', format: 3 })}`,
    `term_bank_1.json=deflated:${JSON.stringify(rows)}`,
    `tag_bank_1.json=deflated:${JSON.stringify(tags)}`,
    ...(meta.length ? [`term_meta_bank_1.json=deflated:${JSON.stringify(meta)}`] : [])]);
  return path;
}

// Resolves with the port, which is a free one if port is 0.
export const listen = (server: Server, port: number) => new Promise<number>(resolve => server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  resolve(typeof address === 'object' && address !== null ? address.port : port);
}));

// The tests of the classic note type select it, as a user can; the mock AnkiConnect servers have no Lapis note type.
// A null noteType keeps the default of a fresh profile. The page text is off on a fresh profile; the test pages on 127.0.0.1
// get it on, so the tests of words read them. localhost is the same server with the page text off.
export async function launch(profileDir: string, noteType: NoteType | null = BUILTIN, enabledSites = ['127.0.0.1']) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(value => chrome.storage.local.set(value), { enabledSites, ...(noteType ? { noteType } : {}) });
  return { context, worker, extensionId: new URL(worker.url()).host };
}

// Runs a browser shortcut of manifest.json on page, as Chrome does for the active tab. Playwright cannot press a browser shortcut.
export async function runCommand(worker: Worker, page: Page, command: string): Promise<void> {
  await page.bringToFront();
  await worker.evaluate(async name => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await (globalThis as unknown as { runCommand: (command: string, tab?: chrome.tabs.Tab) => Promise<void> }).runCommand(name, tab);
  }, command);
}

// The subtitle side panel page of the tab of page, in a tab of its own, 400 px wide as a side panel: Playwright cannot reach
// the side panel of Chrome. page stays the active tab, so the screenshot of a card shows it, as with the real side panel.
export async function openSidebar(context: BrowserContext, worker: Worker, extensionId: string, page: Page): Promise<Page> {
  await page.bringToFront();
  const [tab] = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
  if (tab?.id === undefined) throw new Error('The page has no tab');
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/pages/sidepanel.html?tab=${tab.id}`);
  await page.bringToFront();
  return panel;
}

// The URLs of the open side panels of Chrome, from the service worker.
export const sidePanels = (worker: Worker): Promise<string[]> =>
  worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).map(found => found.documentUrl ?? ''));

// Waits until check() gives true, for up to 5 s.
export async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${what}`);
}

// If CJK_FONT_DIR is set, Chromium launched after this call also uses the fonts in that folder.
export function useCjkFonts(work: string): void {
  if (!process.env.CJK_FONT_DIR) return;
  const conf = join(work, 'fonts.conf');
  writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${process.env.CJK_FONT_DIR}</dir></fontconfig>`);
  process.env.FONTCONFIG_FILE = conf;
}

// A mock AnkiConnect on port 8765. replies maps an action to its result; a test can change it. requests records every request.
export async function mockAnki() {
  const requests: unknown[] = [];
  const replies: Record<string, (params: unknown) => unknown> = {
    createDeck: () => 1, modelNames: () => ['Basic'], createModel: () => ({}), addNote: () => 1700000000000,
    storeMediaFile: params => at(params, 'filename'),
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const request: unknown = JSON.parse(body);
      requests.push(request);
      const handler = replies[String(at(request, 'action'))];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(handler ? { result: handler(at(request, 'params')), error: null } : { result: null, error: 'The mock has no such action' }));
    });
  });
  await listen(server, 8765);
  return { requests, replies, server };
}
