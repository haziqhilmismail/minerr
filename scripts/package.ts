// Packs dist/ for a GitHub release: release/minerr-v<version>.zip, with the one top folder minerr, and its SHA-256.
// Run npm run build first. Python makes the zip, because Node.js has no zip writer.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const release = join(root, 'release');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (typeof version !== 'string') throw new Error('manifest.json has no version.');
const zip = `minerr-v${version}.zip`;

rmSync(release, { recursive: true, force: true });
cpSync(join(root, 'dist'), join(release, 'minerr'), { recursive: true });
execFileSync('python3', ['-I', '-c', 'import shutil, sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], "minerr")',
  join(release, zip.slice(0, -'.zip'.length)), release]);
rmSync(join(release, 'minerr'), { recursive: true });
const sha256 = createHash('sha256').update(readFileSync(join(release, zip))).digest('hex');
writeFileSync(join(release, `${zip}.sha256`), `${sha256}  ${zip}\n`);
console.log(`${join(release, zip)}\n${sha256}`);
