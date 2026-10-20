// Recreates dist/ with the files that the extension loads as they are; tsc then adds the compiled code.
import { cpSync, globSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
for (const path of ['manifest.json', 'vendor', ...globSync('*.html', { cwd: root })]) {
  cpSync(join(root, path), join(dist, path), { recursive: true });
}
