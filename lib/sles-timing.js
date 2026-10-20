// SPDX-License-Identifier: LGPL-2.1-or-later
import { playbackTiming } from "./playback-timing.js";

/** Completed OpenSL buffers are the device's progress reports, not REQUEST
 * credits. Retain pending AND native-queued buffers until consumption callbacks.
 * Resolution is one buffer; no guessed per-device delay is subtracted.
 */
export function installSlesTiming(player) {
  const waiters = [];
  player.timing = () =>
    playbackTiming(
      [...player.pending, ...player.inflight].reduce(
        (sum, b) => sum + b.length,
        0,
      ) /
        (2 * Math.min(2, player.spec.channels)),
      player.spec.rate,
    );
  player.latencyUsec = () => player.timing().queuedUsec;
  const ready = () => player.closed || player.timing().queuedUsec <= 50000;
  player.ready = () =>
    ready()
      ? Promise.resolve()
      : new Promise((resolve) => waiters.push(resolve));
  const wake = () => {
    if (ready()) for (const resolve of waiters.splice(0)) resolve();
  };
  for (const name of ["consumed", "close"]) {
    const original = player[name];
    player[name] = function (...args) {
      try {
        return original.apply(this, args);
      } finally {
        wake();
      }
    };
  }
}
