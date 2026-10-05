// Re-encodes a stream into Car Thing–friendly HLS with FFmpeg: H.264 main profile at up to
// 800×480 and 30 fps, AAC stereo, even 2 s segments, and program-date-time stamps.

import { currentOS, ffmpegCandidates, join, processEnvironment, workRoot } from './platform';

export interface TranscodeSource {
  url: URL;
  /** A finished video rather than a live stream: paced to real time and looped. */
  onDemand: boolean;
  /** Which source variant to convert (FFmpeg's program number), or undefined for the first. */
  program?: number;
}

type Log = (message: string) => void;

/** The first FFmpeg found in the usual places (see `ffmpegCandidates`), or null. */
export function locateFFmpeg(): string | null {
  for (const path of ffmpegCandidates(currentOS(), processEnvironment)) {
    try {
      if (Deno.statSync(path).isFile) return path;
    } catch {
      // Not here.
    }
  }
  return null;
}

const WORK_ROOT = workRoot(currentOS(), processEnvironment);

/** FFmpeg finishing this soon after starting means a broken input, not the end of a video. */
const MINIMUM_LOOP_MS = 3_000;
const LOG_WINDOW_MS = 10_000;
const LINES_PER_WINDOW = 5;

export class Transcoder {
  private process: Deno.ChildProcess | null = null;
  private directory: string | null = null;
  private startedAt = 0;
  private stopped = false;
  private errorTail: string[] = [];
  private logWindowStart = 0;
  private loggedLines = 0;
  private suppressedLines = 0;

  constructor(private readonly ffmpeg: string, private readonly source: TranscodeSource, private readonly log: Log) {}

  get running(): boolean {
    return this.process !== null;
  }

  /** Starts FFmpeg if needed and returns the output playlist path once it has segments. */
  async playlist(): Promise<string> {
    if (this.process && this.directory) return this.waitForPlaylist(this.directory);
    this.stop();
    this.stopped = false;
    const directory = join(currentOS(), WORK_ROOT, crypto.randomUUID());
    await Deno.mkdir(directory, { recursive: true });
    this.directory = directory;
    this.launch(directory, false);
    this.log('Started FFmpeg conversion');
    return this.waitForPlaylist(directory);
  }

  stop() {
    this.stopped = true;
    const process = this.process;
    const directory = this.directory;
    this.process = null;
    this.directory = null;
    try {
      // On Windows this ends FFmpeg at once (TerminateProcess); there's no gentler signal.
      process?.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    // Remove the output once FFmpeg has exited, so it isn't writing into a missing folder.
    if (directory) (process?.status ?? Promise.resolve()).finally(() => Deno.remove(directory, { recursive: true }).catch(() => {}));
  }

  /**
   * Removes output left by an earlier crash. Windows has no equivalent of the Mac version's
   * `pkill`, but an orphaned FFmpeg doesn't outlive the extension for long: it reads its input
   * from the extension's relay, so it gives up within seconds once the relay is gone (see the
   * read timeout in `arguments_`). Files it still holds open are skipped and removed next time.
   */
  static async removeStaleOutput() {
    await Deno.remove(WORK_ROOT, { recursive: true }).catch(() => {});
  }

  private launch(directory: string, continuing: boolean) {
    const child = new Deno.Command(this.ffmpeg, {
      args: arguments_(this.source, directory, continuing),
      stdin: 'null',
      stdout: 'null',
      stderr: 'piped',
    }).spawn();
    this.process = child;
    this.startedAt = Date.now();
    this.pumpErrors(child.stderr);
    child.status.then((status) => this.ended(child, status.code));
  }

  /**
   * Loops on-demand videos: when one ends, FFmpeg restarts and appends to the same playlist,
   * so players see one continuous channel. FFmpeg's own -stream_loop isn't used because it
   * retries instantly forever if its input fails.
   */
  private ended(child: Deno.ChildProcess, code: number) {
    if (child !== this.process) return;
    this.process = null;
    if (this.stopped || !this.source.onDemand || code !== 0 || !this.directory) return;
    if (Date.now() - this.startedAt < MINIMUM_LOOP_MS) {
      this.log('FFmpeg ended too soon to loop; stopping conversion');
      return;
    }
    this.launch(this.directory, true);
    this.log('Looping on-demand video');
  }

  private async waitForPlaylist(directory: string): Promise<string> {
    const playlist = join(currentOS(), directory, 'index.m3u8');
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        if ((await Deno.readTextFile(playlist)).includes('#EXTINF')) return playlist;
      } catch {
        // Not written yet.
      }
      if (!this.process) throw new Error(`FFmpeg couldn't convert this stream. ${this.errorTail.join(' ')}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('FFmpeg took too long to start this stream.');
  }

  /** Records FFmpeg's messages, but summarizes floods from a damaged source. */
  private async pumpErrors(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      if (this.stopped) continue;
      for (const line of decoder.decode(chunk).split('\n').map((l) => l.trim()).filter(Boolean)) {
        this.errorTail = [...this.errorTail, line].slice(-3);
        if (Date.now() - this.logWindowStart > LOG_WINDOW_MS) {
          if (this.suppressedLines) this.log(`FFmpeg: ${this.suppressedLines} more messages (lots of decoding errors usually mean a damaged source stream)`);
          this.logWindowStart = Date.now();
          this.loggedLines = 0;
          this.suppressedLines = 0;
        }
        if (this.loggedLines < LINES_PER_WINDOW) {
          this.loggedLines += 1;
          this.log(`FFmpeg: ${line}`);
        } else {
          this.suppressedLines += 1;
        }
      }
    }
  }
}

export function arguments_(source: TranscodeSource, output: string, continuing: boolean): string[] {
  // Live input arrives in real time; a finished video would otherwise be converted as fast as
  // possible. The initial burst fills the buffer (not again when looping), and catch-up keeps
  // download delays from adding up.
  const pacing = source.onDemand ? ['-readrate', '1', ...(continuing ? [] : ['-readrate_initial_burst', '6']), '-readrate_catchup', '1.5'] : [];
  const streams = source.program === undefined ? '0' : `0:p:${source.program}`;
  const flags = 'delete_segments+program_date_time+independent_segments+omit_endlist' + (continuing ? '+append_list+discont_start' : '');
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
    // Give up on a read that stalls for 15 s, so FFmpeg exits if the extension (and its relay)
    // goes away without stopping it.
    '-rw_timeout', '15000000',
    ...pacing,
    '-i', source.url.href,
    '-map', `${streams}:v:0`, '-map', `${streams}:a:0?`,
    // Deinterlace interlaced video (progressive passes through) and fit within 800×480.
    '-vf', 'yadif=deint=interlaced,scale=w=800:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-profile:v', 'main', '-level:v', '3.1', '-pix_fmt', 'yuv420p',
    '-b:v', '700k', '-maxrate', '900k', '-bufsize', '1400k',
    // A keyframe exactly every 2 s gives even 2 s segments at any frame rate.
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_delete_threshold', '4',
    '-hls_flags', flags,
    '-hls_segment_filename', join(currentOS(), output, 'segment-%06d.ts'),
    join(currentOS(), output, 'index.m3u8'),
  ];
}
