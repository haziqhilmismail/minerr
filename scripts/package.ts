// Packs dist/ for a release into release/. Run npm run build first. Python makes the zips, because Node.js has no zip writer.
// minerr-whisperx-v<version>.zip: the WhisperX add-on (the server and its .cmd launcher), in the top folder minerr-whisperx.
// minerr-v<version>.zip: the whole extension with the add-on, in the top folder minerr, for Load unpacked.
// minerr-store-v<version>.zip: the extension without the add-on, with manifest.json at the root, for the Chrome Web Store,
// which takes no zip with the manifest in a folder.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, globSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const release = join(root, 'release');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (typeof version !== 'string') throw new Error('manifest.json has no version.');
// The add-on: the server folder and the launcher at the root of dist.
const addOn = ['server', ...globSync('*.cmd', { cwd: dist })];

// Zips release/<folder>: as the one top folder of the zip with top, else with its files at the root. Writes the SHA-256.
function zip(name: string, folder: string, top: boolean): void {
  execFileSync('python3', ['-I', '-c', 'import shutil, sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], sys.argv[3] or None)',
    join(release, name), top ? release : join(release, folder), top ? folder : '']);
  rmSync(join(release, folder), { recursive: true });
  const file = `${name}.zip`;
  const sha256 = createHash('sha256').update(readFileSync(join(release, file))).digest('hex');
  writeFileSync(join(release, `${file}.sha256`), `${sha256}  ${file}\n`);
  console.log(`${join(release, file)}  ${sha256}`);
}

rmSync(release, { recursive: true, force: true });

for (const path of [...addOn, 'LICENSE']) cpSync(join(dist, path), join(release, 'minerr-whisperx', path), { recursive: true });
zip(`minerr-whisperx-v${version}`, 'minerr-whisperx', true);

cpSync(dist, join(release, 'minerr'), { recursive: true });
zip(`minerr-v${version}`, 'minerr', true);

cpSync(dist, join(release, 'store'), { recursive: true });
for (const path of addOn) rmSync(join(release, 'store', path), { recursive: true });
zip(`minerr-store-v${version}`, 'store', false);
