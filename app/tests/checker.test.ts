import { checkSources } from '../extension/engine/checker.ts';
import { equal } from './assert.ts';

Deno.test('checking channels tells working streams from dead ones', async () => {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, (request) => {
    switch (new URL(request.url).pathname) {
      case '/live/master.m3u8': return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360/index.m3u8\n');
      case '/live/360/index.m3u8': return new Response('#EXTM3U\n#EXTINF:6.0,\nseg1.ts\n');
      case '/jump.m3u8': return Response.redirect(new URL('/live/master.m3u8', request.url), 302);
      case '/empty.m3u8': return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n');
      case '/page.m3u8': return new Response('<html>Channel moved</html>');
      case '/broken-variant.m3u8': return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\ngone.m3u8\n');
      default: return new Response('not found', { status: 404 });
    }
  });
  try {
    const at = (path: string) => ({ provider: 'hls', value: `http://127.0.0.1:${server.addr.port}${path}` });
    const results = await checkSources([
      at('/live/master.m3u8'),
      at('/jump.m3u8'),
      at('/gone.m3u8'),
      at('/empty.m3u8'),
      at('/page.m3u8'),
      at('/broken-variant.m3u8'),
      { provider: 'hls', value: 'not a link' },
      { provider: 'mystery', value: 'x' },
    ]);
    equal(results.map((r) => r.ok), [true, true, false, false, false, false, false, false]);
    equal(results[2].reason, 'HTTP 404');
    equal(results[3].reason, 'The playlist has no video in it');
    equal(results[4].reason, "The link isn't a stream playlist");
    equal(results[5].reason, 'HTTP 404');
    equal(results[6].reason, "The link isn't a valid URL");
  } finally {
    await server.shutdown();
  }
});

Deno.test('a server that refuses connections counts as dead', async () => {
  const [result] = await checkSources([{ provider: 'hls', value: 'http://127.0.0.1:9/index.m3u8' }]);
  equal(result, { ok: false, reason: "Couldn't connect" });
});
