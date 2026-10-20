import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { MetaRow } from '../src/meta.ts';
import { at } from '../src/parse.ts';
import type { TagRow, TermRow } from '../src/yomitan.ts';

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

export async function launch(profileDir: string) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  return { context, worker, extensionId: new URL(worker.url()).host };
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
