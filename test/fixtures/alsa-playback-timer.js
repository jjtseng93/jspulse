// SPDX-License-Identifier: LGPL-2.1-or-later
import { strict as assert } from "node:assert";
import { toArrayBuffer } from "bun:ffi";
import { drainMicrotasks } from "bun:jsc";
import { AlsaPlayback } from "../../lib/alsa-pcm.js";

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

function fixture({ blocked = false } = {}) {
  let time = 0, next = 0, buffer = 0, updated = 0, maxTimers = 0;
  let writes = 0, callbacks = 0, deviceCloses = 0, libraryCloses = 0;
  const timers = new Map(), output = [];
  globalThis.setTimeout = (callback, delay) => {
    timers.set(++next, { callback, at: time + delay });
    maxTimers = Math.max(maxTimers, timers.size);
    return next;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const consume = () => {
    buffer = Math.max(0, buffer - Math.floor((time - updated) * 192 / 4) * 4);
    updated = time;
  };
  // Exercise the real playback/ready/drain/close methods, without opening a
  // device or loading libc. The fake HW has 100ms capacity at 48kHz stereo.
  const stream = Object.assign(Object.create(AlsaPlayback.prototype), {
    closed: false, fd: 42, path: "fake ALSA", rate: 48000, frameBytes: 4,
    bufferFrames: 4800, periodMs: 25, pending: [], pendingBytes: 0,
    partial: new Uint8Array(0), waiters: [], timer: null,
    errno: () => 11,
    resolveExit: () => {},
    native: {
      symbols: {
        write(_fd, address, length) {
          assert.equal(stream.closed, false, "no native write after close");
          writes++;
          consume();
          if (blocked) return -1;
          const n = Math.min(length, 19200 - buffer);
          if (!n) return -1;
          output.push(new Uint8Array(toArrayBuffer(address, 0, n)).slice());
          buffer += n;
          return n;
        },
        ioctl: () => 0,
        close: () => { deviceCloses++; },
      },
      close: () => { libraryCloses++; },
    },
    delayFrames() { consume(); return buffer / 4; },
  });
  return {
    stream, timers, output,
    stats: () => ({ time, writes, callbacks, maxTimers, deviceCloses, libraryCloses }),
    step() {
      const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0] ?? [];
      assert.ok(task, "pending audio must have a period timer");
      timers.delete(id);
      time = task.at;
      callbacks++;
      task.callback();
      drainMicrotasks();
    },
  };
}

try {
  const blocked = fixture({ blocked: true });
  for (let i = 0; i < 5; i++) {
    blocked.stream.write(new Uint8Array(1920));
    assert.equal(blocked.timers.size, 1, "new input replaces the existing period timer");
  }
  let ready = false, drained = false;
  blocked.stream.ready().then(() => { ready = true; });
  blocked.stream.drain().then(() => { drained = true; });
  drainMicrotasks();
  assert.equal(ready, false, "ready retains backpressure above the low-water mark");
  assert.equal(drained, false);
  for (let i = 0; i < 20; i++) blocked.step();
  assert.equal(blocked.stats().time, 500);
  assert.equal(blocked.stats().writes, 25, "one blocked write attempt per period");
  assert.equal(blocked.stats().maxTimers, 1);
  blocked.stream.close();
  blocked.stream.close();
  drainMicrotasks();
  assert.equal(blocked.timers.size, 0, "close removes all scheduled callbacks");
  assert.equal(ready, true);
  assert.equal(drained, true);
  assert.equal(blocked.stats().deviceCloses, 1);
  assert.equal(blocked.stats().libraryCloses, 1);

  const playback = fixture();
  const input = Uint8Array.from({ length: 1920000 }, (_, i) => i % 251);
  let sent = false, failure;
  (async () => {
    for (let at = 0; at < input.length; at += 1920) {
      await playback.stream.ready();
      playback.stream.write(input.subarray(at, at + 1920));
    }
    await playback.stream.drain();
    sent = true;
  })().catch(error => { failure = error; });
  drainMicrotasks();
  for (let steps = 0; !sent && !failure && steps < 1000; steps++) playback.step();
  if (failure) throw failure;
  assert.equal(sent, true, "ten seconds of PCM must drain without a growing callback queue");
  assert.equal(playback.stats().maxTimers, 1);
  assert.ok(playback.stats().callbacks <= 401, "25ms periods retain normal playback pacing");
  assert.equal(playback.stats().time, 10000);
  assert.ok(playback.stats().writes < 3000, "write attempts remain bounded despite partial writes/EAGAIN");
  assert.deepEqual(Buffer.concat(playback.output), Buffer.from(input), "partial writes preserve every PCM byte in order");
  assert.equal(playback.stream.pendingBytes, 0);
  assert.equal(playback.stream.delayFrames(), 0);
  assert.equal(playback.timers.size, 0);
  playback.stream.close();
  process.stdout.write("ALSA period timer regression passed\n");
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
