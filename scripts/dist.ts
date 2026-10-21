// Recreates dist/ with the files that the extension loads as they are; tsc then adds the compiled code.
import { cpSync, globSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_CSS } from '../src/shared/design-tokens.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
for (const path of ['manifest.json', 'vendor', ...globSync('pages/*.html', { cwd: root })]) {
  cpSync(join(root, path), join(dist, path), { recursive: true });
}
writeFileSync(join(dist, 'theme.css'), PAGE_CSS);
