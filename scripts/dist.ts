// Recreates dist/ with the files that the extension loads as they are; tsc then adds the compiled code.
import { cpSync, globSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKENS } from '../src/tokens.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
for (const path of ['manifest.json', 'vendor', ...globSync('*.html', { cwd: root })]) {
  cpSync(join(root, path), join(dist, path), { recursive: true });
}
// The stylesheet of the extension pages. applyTheme() sets data-theme; before it runs, the page follows the system.
writeFileSync(join(dist, 'theme.css'), `:root { color-scheme: light dark; ${TOKENS} }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
`);
