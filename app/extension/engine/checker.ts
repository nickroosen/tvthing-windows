// Checks whether channels' streams still answer, for the settings page's "Check channels".
// A channel passes when its playlist loads and, through the variant the Car Thing would play,
// lists at least one segment. Segments themselves aren't fetched, to keep a check of a few
// hundred channels quick.

import type { SourceReference } from '../../src/shared/library';
import { parsePlaylist, preferredVariant } from './playlist';
import { provider } from './providers';
import { isPlaylist, type Upstream } from './relay';

export interface CheckResult {
  ok: boolean;
  /** Why it failed, e.g. "HTTP 404" or "Timed out". */
  reason?: string;
}

const TIMEOUT_MS = 10_000;
/** Channels checked at once, so a big lineup doesn't flood the network. */
const CONCURRENCY = 6;

export async function checkSources(sources: SourceReference[], fetcher: typeof fetch = fetch): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const index = next++;
      results[index] = await checkSource(sources[index], fetcher);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
  return results;
}

export async function checkSource(source: SourceReference, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  let upstream: Upstream;
  try {
    upstream = await provider(source.provider).resolve(source, false);
  } catch (error) {
    return { ok: false, reason: error instanceof TypeError ? "The link isn't a valid URL" : describe(error) };
  }
  try {
    const prepare = (url: URL) => (upstream.prepare ? upstream.prepare(url) : url);
    const entry = await load(prepare(upstream.entryURL), fetcher);
    const variant = preferredVariant(entry.playlist);
    const media = variant ? (await load(prepare(new URL(variant.uri, entry.url)), fetcher)).playlist : entry.playlist;
    if (media.segmentURIs.length === 0) return { ok: false, reason: 'The playlist has no video in it' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

/** Fetches a playlist, returning where it ended up after any redirects. */
async function load(url: URL, fetcher: typeof fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (!isPlaylist(body)) throw new Error("The link isn't a stream playlist");
  return { playlist: parsePlaylist(new TextDecoder().decode(body)), url: response.redirected && response.url ? new URL(response.url) : url };
}

function describe(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Timed out';
  if (error instanceof TypeError) return "Couldn't connect";
  return error instanceof Error ? error.message : String(error);
}
