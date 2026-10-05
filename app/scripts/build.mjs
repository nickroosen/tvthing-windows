// Builds TV Thing for Windows into dist/app/:
// - app.js, app.css: the Car Thing app
// - settings.html: the settings page, as one self-contained file
// - extension/desktop.mjs: the extension that runs on the computer
// and dist/extension-dev.mjs, the same extension runnable on its own with Deno.
// With --package, also zips dist/app for installing.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(dist, 'app');
const watch = process.argv.includes('--watch');
const pack = process.argv.includes('--package');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(version) };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });

// The manifest's version always matches package.json.
const manifestPath = join(out, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), version }, null, 2) + '\n');

const device = {
  entryPoints: [
    { in: join(root, 'src', 'device', 'main.ts'), out: 'app' },
    { in: join(root, 'src', 'device', 'ui', 'app.css'), out: 'app' },
  ],
  outdir: out,
  bundle: true,
  format: 'iife',
  // The Car Thing runs an older Chromium (the previous build relied on optional chaining, so 80+).
  target: 'chrome80',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  define,
  logLevel: 'info',
};

const extension = (standalone, outfile) => ({
  entryPoints: [join(root, 'extension', 'main.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
  define: { ...define, __STANDALONE__: String(standalone) },
  logLevel: 'info',
});

/** The settings page must be a single file, so its script and styles are inlined. */
async function buildSettings() {
  const script = await esbuild.build({
    entryPoints: [join(root, 'src', 'settings', 'settings.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !watch,
    legalComments: 'none',
    define,
    write: false,
  });
  const style = await esbuild.build({ entryPoints: [join(root, 'src', 'settings', 'settings.css')], bundle: true, minify: !watch, write: false });
  const html = readFileSync(join(root, 'src', 'settings', 'settings.html'), 'utf8')
    .replace('/*STYLE*/', () => style.outputFiles[0].text)
    .replace('/*SCRIPT*/', () => script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
  writeFileSync(join(out, 'settings.html'), html);
  const size = statSync(join(out, 'settings.html')).size;
  if (size > 1024 * 1024) throw new Error(`settings.html is ${size} bytes; Bridgething allows 1 MiB`);
}

if (watch) {
  await (await esbuild.context(device)).watch();
  await (await esbuild.context(extension(true, join(dist, 'extension-dev.mjs')))).watch();
  await buildSettings();
} else {
  await Promise.all([
    esbuild.build(device),
    esbuild.build(extension(false, join(out, 'extension', 'desktop.mjs'))),
    esbuild.build(extension(true, join(dist, 'extension-dev.mjs'))),
    buildSettings(),
  ]);
}

if (pack) {
  const zip = join(dist, 'TVThing-Windows.zip');
  rmSync(zip, { force: true });
  // The top-level entries are named rather than zipping `.`: excluding hidden files with a
  // `.*` pattern also matches `.` itself, which left Windows' tar writing an empty zip.
  const entries = readdirSync(out).filter((name) => !name.startsWith('.'));
  // Windows 10 and later include bsdtar, which writes zips; elsewhere use zip. Windows' own tar
  // is named in full so Git's GNU tar, which can't write zips, isn't picked up from PATH.
  const windowsTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  if (process.platform === 'win32') execFileSync(windowsTar, ['-a', '-c', '-f', zip, ...entries], { cwd: out });
  else execFileSync('zip', ['-qrX', zip, ...entries], { cwd: out });

  // Check the zip has what Bridgething needs, so a broken package fails the build.
  const listing = process.platform === 'win32' ? execFileSync(windowsTar, ['-t', '-f', zip], { encoding: 'utf8' }) : execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
  const files = listing.split(/\r?\n/).map((line) => line.replace(/^\.\//, '').replace(/\\/g, '/'));
  const missing = ['manifest.json', 'index.html', 'app.js', 'app.css', 'settings.html', 'extension/desktop.mjs'].filter((file) => !files.includes(file));
  if (missing.length) throw new Error(`${zip} is missing ${missing.join(', ')}`);
  console.log(`Packaged ${zip} (${files.filter(Boolean).length} entries, ${statSync(zip).size} bytes)`);
}
