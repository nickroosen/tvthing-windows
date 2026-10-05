import { ffmpegCandidates, fileURL, join, workRoot } from '../extension/engine/platform.ts';
import { Relay } from '../extension/engine/relay.ts';
import { equal, ok } from './assert.ts';

const windowsEnv = (values: Record<string, string>) => (name: string) => values[name];

Deno.test('FFmpeg is looked for on PATH first, then in the usual Windows installs', () => {
  const env = windowsEnv({ PATH: 'C:\\Windows\\system32;"C:\\Tools\\ffmpeg\\bin\\";;C:\\Windows\\system32', USERPROFILE: 'C:\\Users\\Pat Doe' });
  equal(ffmpegCandidates('windows', env), [
    'C:\\Windows\\system32\\ffmpeg.exe',
    'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Users\\Pat Doe\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
    'C:\\Users\\Pat Doe\\scoop\\shims\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ]);
});

Deno.test('the fixed FFmpeg locations match the run permissions in the manifest', async () => {
  const manifest = JSON.parse(await Deno.readTextFile(new URL('../public/manifest.json', import.meta.url)));
  const granted = (manifest.extension.permissions as string[])
    .filter((p) => p.startsWith('run:') && p !== 'run:ffmpeg')
    .map((p) => p.slice(4).replace(/^~/, 'C:\\Users\\Pat').replace(/\//g, '\\'));
  const fixed = ffmpegCandidates('windows', windowsEnv({ USERPROFILE: 'C:\\Users\\Pat' }));
  equal(fixed, granted);
  ok((manifest.extension.permissions as string[]).includes('run:ffmpeg'), 'PATH lookups need run:ffmpeg');
});

Deno.test('conversions write into the temp folder', () => {
  equal(workRoot('windows', windowsEnv({ TEMP: 'C:\\Users\\Pat\\AppData\\Local\\Temp\\' })), 'C:\\Users\\Pat\\AppData\\Local\\Temp\\TVThing-Transcodes');
  equal(workRoot('windows', windowsEnv({ USERPROFILE: 'C:\\Users\\Pat' })), 'C:\\Users\\Pat\\AppData\\Local\\Temp\\TVThing-Transcodes');
  equal(workRoot('other', windowsEnv({ TMPDIR: '/var/folders/x/T/' })), '/var/folders/x/T/TVThing-Transcodes');
  equal(join('other', '/', 'tmp'), '/tmp');
});

Deno.test('file URLs for Windows paths keep the drive letter and escape names', () => {
  equal(fileURL('C:\\Users\\Pat Doe #2\\Temp\\index.m3u8').href, 'file:///C:/Users/Pat%20Doe%20%232/Temp/index.m3u8');
  equal(fileURL('/tmp/TVThing-Transcodes/x/index.m3u8').href, 'file:///tmp/TVThing-Transcodes/x/index.m3u8');
  equal(new URL('segment-000001.ts', fileURL('C:\\Temp\\out\\index.m3u8')).href, 'file:///C:/Temp/out/segment-000001.ts');
});

Deno.test('the relay serves local files only from a local playlist', () => {
  const remote = new Relay('/stream/abc/s/', { entryURL: new URL('https://cdn.example/live/master.m3u8') });
  const fromRemote = remote.rewrite('#EXTM3U\nfile:///C:/Users/Pat/secret.ts\nseg.ts\n', new URL('https://cdn.example/live/media.m3u8')).split('\n');
  equal(fromRemote[1], 'file:///C:/Users/Pat/secret.ts', 'left unrelayed');
  equal(fromRemote[2], '/stream/abc/s/1.ts');

  const output = fileURL('C:\\Temp\\out\\index.m3u8');
  const local = new Relay('/stream/abc/o/', { entryURL: output });
  const fromLocal = local.rewrite('#EXTM3U\nsegment-000001.ts\nhttps://cdn.example/x.ts\n', output).split('\n');
  equal(fromLocal[1], '/stream/abc/o/1.ts');
  equal(fromLocal[2], 'https://cdn.example/x.ts', 'left unrelayed');
});
