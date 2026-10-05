// Platform specifics: where FFmpeg lives, where conversions write, and file URLs for local paths.
// TV Thing for Windows targets Windows; the other branch only lets the extension run on a
// developer's Mac or Linux machine (`npm run dev:extension`). The functions take the OS and
// environment as arguments so the tests can exercise both branches on any machine.

export type OS = 'windows' | 'other';
export type Environment = (name: string) => string | undefined;

/**
 * Where to look for FFmpeg, in order. PATH comes first because the manifest's `run:ffmpeg`
 * permission is granted for whichever ffmpeg.exe is first on PATH. The rest are the usual
 * installs (winget, Scoop, Chocolatey, a manual unzip to C:\ffmpeg), each also named in the
 * manifest, for when Bridgething was started before PATH was updated.
 */
export function ffmpegCandidates(os: OS, env: Environment): string[] {
  const windows = os === 'windows';
  const candidates: string[] = [];
  for (const dir of (env('PATH') ?? '').split(windows ? ';' : ':')) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (trimmed) candidates.push(join(os, trimmed, windows ? 'ffmpeg.exe' : 'ffmpeg'));
  }
  if (!windows) return [...new Set([...candidates, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'])];
  const home = env('USERPROFILE');
  if (home) {
    candidates.push(join(os, home, 'AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe'));
    candidates.push(join(os, home, 'scoop\\shims\\ffmpeg.exe'));
  }
  candidates.push('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe');
  return [...new Set(candidates)];
}

/** The folder conversions write into, inside the user's temp folder. */
export function workRoot(os: OS, env: Environment): string {
  if (os !== 'windows') return join(os, env('TMPDIR') ?? '/tmp', 'TVThing-Transcodes');
  const profile = env('USERPROFILE');
  const temp = env('TEMP') ?? env('TMP') ?? (profile ? join(os, profile, 'AppData\\Local\\Temp') : 'C:\\Windows\\Temp');
  return join(os, temp, 'TVThing-Transcodes');
}

/** Joins path parts with single separators (backslashes on Windows). */
export function join(os: OS, ...parts: string[]): string {
  const separator = os === 'windows' ? '\\' : '/';
  const [first, ...rest] = parts;
  const root = /^[\\/]+$/.test(first) ? separator : '';
  const joined = [root ? '' : first.replace(/[\\/]+$/, ''), ...rest.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
  const path = root + joined;
  return os === 'windows' ? path.replace(/\//g, '\\') : path;
}

/**
 * A file: URL for a local path. `new URL('file://' + path)` would take a Windows path's drive
 * letter as a host, and leave spaces and `#` (both possible in user names) unescaped.
 */
export function fileURL(path: string): URL {
  const segments = path.replace(/\\/g, '/').split('/');
  const encoded = segments.map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)));
  const joined = encoded.join('/');
  return new URL(`file://${joined.startsWith('/') ? '' : '/'}${joined}`);
}

/** The OS the extension is running on. */
export function currentOS(): OS {
  return Deno.build.os === 'windows' ? 'windows' : 'other';
}

/** Environment lookup that tolerates a missing `env` permission. */
export const processEnvironment: Environment = (name) => {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
};
