import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { once } from 'node:events';
import { packager } from '@electron/packager';

const desktopRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const productName = packageJson.productName;
const electronVersion = packageJson.devDependencies.electron.replace(/^[^\d]*/, '');
const requestedArchitecture = process.argv.includes('--arch')
  ? process.argv[process.argv.indexOf('--arch') + 1]
  : process.arch;
const architectures = new Set(['arm64', 'x64']);

if (process.platform !== 'darwin') throw new Error('macOS packages must be built on macOS.');
if (!architectures.has(requestedArchitecture)) throw new Error(`Unsupported architecture: ${requestedArchitecture}`);

execFileSync(process.execPath, [join(desktopRoot, 'scripts', 'build-icon-macos.mjs')], { stdio: 'inherit' });

const artifactStem = `LocalProject-${version}-darwin-${requestedArchitecture}`;
const outputDirectory = join(desktopRoot, 'release');
const zipPath = join(outputDirectory, `${artifactStem}.zip`);
const dmgPath = join(outputDirectory, `${artifactStem}.dmg`);
const checksumPath = join(outputDirectory, `${artifactStem}.sha256.txt`);
const dmgStagingPath = join(outputDirectory, `.dmg-staging-${requestedArchitecture}`);
const cachedElectronDirectory = join(desktopRoot, 'vendor', 'electron');
const cachedElectronZip = join(cachedElectronDirectory, `electron-v${electronVersion}-darwin-${requestedArchitecture}.zip`);

mkdirSync(outputDirectory, { recursive: true });
for (const artifact of [zipPath, dmgPath, checksumPath, dmgStagingPath]) {
  rmSync(artifact, { recursive: true, force: true });
}

const options = {
  dir: desktopRoot,
  name: productName,
  executableName: productName,
  platform: 'darwin',
  arch: requestedArchitecture,
  electronVersion,
  out: outputDirectory,
  overwrite: true,
  prune: false,
  asar: true,
  appBundleId: 'io.github.reader0421.local-project-desktop',
  appCategoryType: 'public.app-category.developer-tools',
  appVersion: version,
  buildVersion: process.env.BUILD_NUMBER || version,
  icon: join(desktopRoot, 'resources', 'AppIcon.icns'),
  extendInfo: {
    CFBundleDisplayName: productName,
    LSMinimumSystemVersion: '13.0',
    NSHighResolutionCapable: true,
  },
  ignore: [
    /^\/src($|\/)/,
    /^\/node_modules($|\/)/,
    /^\/release($|\/)/,
    /^\/resources($|\/)/,
    /^\/scripts($|\/)/,
    /^\/vendor($|\/)/,
    /^\/electron\.vite\.config\.js$/,
    /^\/vite\.config\.js$/,
    /^\/vitest\.config\.js$/,
    /^\/pnpm-lock\.yaml$/,
    /^\/pnpm-workspace\.yaml$/,
  ],
};

if (existsSync(cachedElectronZip)) options.electronZipDir = cachedElectronDirectory;
else console.log(`Cached Electron runtime not found; @electron/packager will download ${basename(cachedElectronZip)}.`);

const packagedPaths = await packager(options);
const appPath = join(packagedPaths[0], `${productName}.app`);
if (!existsSync(appPath)) throw new Error(`Packager did not create ${appPath}`);

const licensesDirectory = join(appPath, 'Contents', 'Resources', 'licenses');
mkdirSync(licensesDirectory, { recursive: true });
const licenseFiles = [
  [join(desktopRoot, '..', 'LICENSE'), 'LocalProject-MIT.txt'],
  [join(desktopRoot, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'],
  [join(desktopRoot, 'node_modules', 'electron', 'dist', 'LICENSE'), 'Electron-MIT.txt'],
  [join(desktopRoot, 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'), 'Chromium-Third-Party-Notices.html'],
  [join(desktopRoot, 'node_modules', 'vue', 'LICENSE'), 'Vue-MIT.txt'],
  [join(desktopRoot, 'node_modules', '@phosphor-icons', 'vue', 'LICENSE'), 'Phosphor-Icons-MIT.txt'],
];
for (const [source, destination] of licenseFiles) {
  if (!existsSync(source)) throw new Error(`Required license file not found: ${source}`);
  copyFileSync(source, join(licensesDirectory, destination));
}

execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], { stdio: 'inherit' });

mkdirSync(dmgStagingPath);
execFileSync('/usr/bin/ditto', [appPath, join(dmgStagingPath, `${productName}.app`)], { stdio: 'inherit' });
symlinkSync('/Applications', join(dmgStagingPath, 'Applications'));
execFileSync('/usr/bin/hdiutil', ['create', '-volname', productName, '-srcfolder', dmgStagingPath, '-ov', '-format', 'UDZO', dmgPath], { stdio: 'inherit' });
rmSync(dmgStagingPath, { recursive: true, force: true });
execFileSync('/usr/bin/hdiutil', ['verify', dmgPath], { stdio: 'inherit' });

async function sha256(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

const checksums = [];
for (const artifact of [zipPath, dmgPath]) checksums.push(`${await sha256(artifact)}  ${basename(artifact)}`);
writeFileSync(checksumPath, `${checksums.join('\n')}\n`, 'utf8');

const megabytes = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`Packaged ${appPath}`);
console.log(`Created ${basename(zipPath)} (${megabytes(zipPath)})`);
console.log(`Created ${basename(dmgPath)} (${megabytes(dmgPath)})`);
console.log(`Created ${basename(checksumPath)}`);
