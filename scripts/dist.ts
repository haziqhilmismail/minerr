import { cpSync, globSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_CSS } from '../src/shared/design-tokens.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
for (const path of ['manifest.json', 'vendor', 'icons', 'LICENSE', ...globSync('pages/*.html', { cwd: root }),
  'Start WhisperX server.cmd', 'server/whisper_server.py', 'server/media.py', 'server/chrome_start.py', 'server/start-from-chrome.cmd']) {
  cpSync(join(root, path), join(dist, path), { recursive: true });
}
writeFileSync(join(dist, 'theme.css'), PAGE_CSS);
