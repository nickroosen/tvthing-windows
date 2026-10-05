// End-to-end check of the extension with a real FFmpeg: serves a generated test stream, runs the
// built extension under Deno with exactly the manifest's permissions (as Bridgething does), and
// has it convert the stream. Run `npm run build` first; needs ffmpeg and deno on PATH.
//
//   node scripts/smoke.mjs
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const extensionPort = 17859;
const origin = `http://127.0.0.1:${extensionPort}`;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

/** Bridgething's conversion of manifest permissions to Deno flags, `~` expanded to the home folder. */
function denoFlags(permissions) {
  const byKind = new Map();
  for (const permission of permissions) {
    const [kind, ...rest] = permission.split(':');
    let scope = rest.length ? rest.join(':') : null;
    if (scope && ['read', 'write', 'run', 'ffi'].includes(kind) && (scope === '~' || scope.startsWith('~/'))) scope = homedir() + scope.slice(1);
    const entry = byKind.get(kind) ?? { bare: false, scopes: [] };
    if (scope === null) entry.bare = true;
    else if (!entry.scopes.includes(scope)) entry.scopes.push(scope);
    byKind.set(kind, entry);
  }
  return [...byKind].map(([kind, { bare, scopes }]) => (bare || !scopes.length ? `--allow-${kind}` : `--allow-${kind}=${scopes.join(',')}`));
}

const work = mkdtempSync(join(tmpdir(), 'tvthing-smoke-'));
let extension;
let streamServer;
try {
  // A 1280×720 test stream, as a "live" playlist (no end tag), which the Car Thing can't take directly.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '20', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', join(work, 'vod.m3u8')], { stdio: 'inherit' });
  writeFileSync(join(work, 'live.m3u8'), readFileSync(join(work, 'vod.m3u8'), 'utf8').replace(/#EXT-X-(ENDLIST|PLAYLIST-TYPE:VOD)\r?\n/g, ''));

  streamServer = createServer((req, res) => {
    const name = req.url.replace(/^\/+/, '');
    if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' });
    createReadStream(join(work, name)).on('error', () => res.end()).pipe(res);
  });
  await new Promise((resolve) => streamServer.listen(0, '127.0.0.1', resolve));
  const source = `http://127.0.0.1:${streamServer.address().port}/live.m3u8`;

  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
  const flags = denoFlags(manifest.extension.permissions);
  console.log(`deno run --no-prompt ${flags.join(' ')}`);
  extension = spawn('deno', ['run', '--no-prompt', ...flags, join(root, 'dist', 'extension-dev.mjs')], {
    env: { ...process.env, TVTHING_PORT: String(extensionPort), DENO_NO_PACKAGE_JSON: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let health;
  for (let attempt = 0; attempt < 100 && !health; attempt++) {
    health = await fetch(`${origin}/api/v1/health`).then((r) => r.json()).catch(() => undefined);
    if (!health) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!health) fail("the extension didn't start");
  if (!health.ffmpeg) fail("the extension didn't find FFmpeg");
  console.log('health:', health);

  const session = await fetch(`${origin}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { provider: 'hls', value: source }, playback: 'convert' }),
  }).then((r) => r.json());
  const asCarThing = { headers: { 'User-Agent': 'bridgething/smoke' } };
  const playlistResponse = await fetch(origin + session.playlist, asCarThing);
  const playlist = await playlistResponse.text();
  if (!playlistResponse.ok || !playlist.includes('#EXTINF')) fail(`no converted playlist (HTTP ${playlistResponse.status}): ${playlist}`);
  if (!playlist.includes('#EXT-X-PROGRAM-DATE-TIME')) fail('the converted playlist has no timestamps');
  const segmentPath = playlist.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
  const segment = await fetch(origin + segmentPath, asCarThing);
  const bytes = (await segment.arrayBuffer()).byteLength;
  if (!segment.ok || bytes < 10_000) fail(`segment ${segmentPath} came back HTTP ${segment.status}, ${bytes} bytes`);
  console.log(`OK: converted playlist served, first segment ${bytes} bytes`);
} finally {
  if (extension && extension.exitCode === null) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(extension.pid), '/t', '/f'], { stdio: 'ignore' });
    else extension.kill();
  }
  streamServer?.close();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  rmSync(work, { recursive: true, force: true });
}
