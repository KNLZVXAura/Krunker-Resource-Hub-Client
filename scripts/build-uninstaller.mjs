// Builds the stand-alone uninstallers that ship next to the installers in every release:
//   out/KRH Client-<version>-Uninstaller.exe       Windows (NSIS; see build/uninstaller/krh-uninstaller.nsi)
//   out/KRH Client-<version>-linux-uninstall.sh    Linux, .deb and AppImage (see build/uninstaller/krh-client-uninstall.sh)
// makensis compiles the Windows .exe on Linux as well as on Windows (CI does it on the Linux job: `apt-get install nsis`).
// Locally: `npm run uninstaller` (needs makensis: apt install nsis / choco install nsis / brew install makensis).

import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// electron-builder.yml sets the version that is really built (extraMetadata); package.json is the fallback
const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
const fromYml = yml.match(/^\s*version:\s*([0-9][0-9.]*)\s*$/m);
const version = fromYml ? fromYml[1] : pkg.version;
if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error(`Unexpected version "${version}": expected 1.2.3 or 1.2.3.4`);
  process.exit(1);
}
const version4 = version.split('.').length === 3 ? `${version}.0` : version;

const outDir = join(root, 'out');
mkdirSync(outDir, { recursive: true });
const exe = join(outDir, `KRH Client-${version}-Uninstaller.exe`);
const sh = join(outDir, `KRH Client-${version}-linux-uninstall.sh`);

const candidates = [process.env.MAKENSIS, 'makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].filter(Boolean);
let built = false;
for (const mk of candidates) {
  try {
    execFileSync(mk, ['-V2', `-DVERSION=${version}`, `-DVERSION4=${version4}`, `-DOUTFILE=${exe}`, join(root, 'build', 'uninstaller', 'krh-uninstaller.nsi')], { stdio: 'inherit' });
    built = true;
    break;
  } catch (err) {
    if (err && err.code === 'ENOENT') continue; // not this one: try the next place
    console.error('makensis failed');
    process.exit(1);
  }
}
if (!built || !existsSync(exe)) {
  console.error('makensis was not found. Install NSIS (apt install nsis, choco install nsis or brew install makensis) or set MAKENSIS to its path.');
  process.exit(1);
}

copyFileSync(join(root, 'build', 'uninstaller', 'krh-client-uninstall.sh'), sh);
try { chmodSync(sh, 0o755); } catch { /* not on every file system */ }
console.log(`Built:\n  ${exe}\n  ${sh}`);
