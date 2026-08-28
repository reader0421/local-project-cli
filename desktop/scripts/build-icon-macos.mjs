import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const desktopRoot = resolve(import.meta.dirname, '..');
const source = join(desktopRoot, 'resources', 'AppIcon.png');
const destination = join(desktopRoot, 'resources', 'AppIcon.icns');
const iconset = join(desktopRoot, 'resources', 'AppIcon.iconset');

if (process.platform !== 'darwin') throw new Error('macOS icon generation must run on macOS.');
if (!existsSync(source)) throw new Error(`Icon source not found: ${source}`);

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

try {
  const entries = [];
  for (const [type, size] of [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ]) {
    const pngPath = join(iconset, `icon-${size}.png`);
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', pngPath], { stdio: 'ignore' });
    const png = readFileSync(pngPath);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(header.length + png.length, 4);
    entries.push(header, png);
  }

  const body = Buffer.concat(entries);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(header.length + body.length, 4);
  rmSync(destination, { force: true });
  writeFileSync(destination, Buffer.concat([header, body]));
  console.log(`Created ${destination}`);
} finally {
  rmSync(iconset, { recursive: true, force: true });
}
