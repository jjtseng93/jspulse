// SPDX-License-Identifier: LGPL-2.1-or-later
import {readPlaybackTiming} from "./playback-timing.js";

/** Protocol v8 reply, common to all platforms. Missing measurements are errors,
 * not a fabricated empty queue. read/write cursors cover submitted PCM; the
 * measured unplayed portion is reported as sink latency, as before.
 */
export function sendPlaybackTiming(client,tag,reader) {
  const id=reader.u32(),sent=reader.timeval();
  if(!reader.eof)throw new Error("unexpected latency fields");
  const stream=client.streams.get(id);
  if(!stream||stream.record){client.error(tag,5);return;}
  let timing;
  try{timing=readPlaybackTiming(stream.process);}catch{client.error(tag,19);return;}
  const now=Date.now()*1000;
  client.reply(tag,w=>w.usec(timing.queuedUsec).usec(0).bool(timing.playing)
    .timeval(sent).timeval({sec:Math.floor(now/1e6),usec:now%1e6}).s64(stream.offset).s64(stream.offset));
}
