import { Sound } from '../src/device/sound.ts';
import { equal, ok } from './assert.ts';

/**
 * Replays the situation from a field log: the picture runs ~14 s ahead of the sound, its buffer
 * only lets it move back a few seconds at a time, and the sound stalls partway through.
 */
Deno.test('sync pauses the picture instead of seeking over and over when the sound falls far behind', async () => {
  const realNow = Date.now;
  const realSetInterval = globalThis.setInterval;
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  try {
    const log: string[] = [];
    let gap = 13_700; // How far the picture is ahead of the sound, in ms.
    let heldUntil = 0;
    const moves: number[] = [];
    const client = { player: { onSnapshot() {}, play: async () => ({}), pause: async () => ({}), stateGet: async () => ({ ok: false }) } };
    const link = { resetHostTimeline: async () => {}, hostTimeline: async () => ({ origin: 0 }) };
    const sound = new Sound(
      client as never,
      link as never,
      (message) => log.push(message),
      (ms) => {
        moves.push(now);
        const achieved = Math.max(ms, -3_000); // Only 3 s of buffer behind the picture.
        gap += achieved;
        return achieved;
      },
      (ms) => (heldUntil = now + ms),
    );
    await sound.play('http://127.0.0.1/stream/x/index.m3u8', 'x');
    (sound as unknown as { origin: number }).origin = 0;

    let soundPosition = 0;
    for (let second = 0; second < 90; second += 1) {
      now += 1_000;
      soundPosition += 1_000;
      if (second === 40) soundPosition -= 8_000; // The sound stalls and comes back 8 s behind.
      const held = now <= heldUntil;
      if (held) gap -= 1_000; // A paused picture lets the sound catch up.
      (sound as unknown as { record(p: object): void }).record({ state: 'playing', positionMs: soundPosition, positionAgeMs: 0 });
      if (second === 40) gap += 8_000;
      sound.follow(soundPosition + gap, !held);
    }

    const perMinute = Math.max(...moves.map((at) => moves.filter((other) => other >= at && other - at < 60_000).length));
    ok(perMinute <= 4, `at most 4 picture moves a minute, saw ${perMinute}: ${log.join(' | ')}`);
    ok(log.some((line) => line.startsWith('Pausing the picture')), 'the picture pauses for the sound');
    ok(Math.abs(gap) <= 1_000, `the picture ends up with the sound, but is ${gap} ms ahead: ${log.join(' | ')}`);
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realSetInterval;
  }
});

Deno.test('small drift is still corrected with a single move', async () => {
  const realNow = Date.now;
  const realSetInterval = globalThis.setInterval;
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  try {
    let gap = 0;
    const moves: number[] = [];
    const client = { player: { onSnapshot() {}, play: async () => ({}), pause: async () => ({}), stateGet: async () => ({ ok: false }) } };
    const link = { resetHostTimeline: async () => {}, hostTimeline: async () => ({ origin: 0 }) };
    const sound = new Sound(client as never, link as never, () => {}, (ms) => (moves.push(ms), (gap += ms), ms), () => {});
    await sound.play('http://127.0.0.1/stream/x/index.m3u8', 'x');
    (sound as unknown as { origin: number }).origin = 0;
    for (let second = 0; second < 60; second += 1) {
      now += 1_000;
      if (second === 20) gap = 600; // Drifts 600 ms ahead.
      (sound as unknown as { record(p: object): void }).record({ state: 'playing', positionMs: now - 1_000_000, positionAgeMs: 0 });
      sound.follow(now - 1_000_000 + gap, true);
    }
    equal(moves.map(Math.round), [-600]);
    equal(gap, 0);
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realSetInterval;
  }
});
