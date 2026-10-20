// SPDX-License-Identifier: LGPL-2.1-or-later
import { playbackTiming } from "./playback-timing.js";

/** WHDR_DONE confirms completed buffers; queued headers are not played PCM. */
export function installWaveOutTiming(sink) {
  sink.timing = () => {
    sink.reap();
    return playbackTiming(
      sink.queue.reduce((sum, item) => sum + item.data.length, 0) /
        (sink.spec.channels * 2),
      sink.spec.rate,
    );
  };
  sink.latencyUsec = () => sink.timing().queuedUsec;
}
