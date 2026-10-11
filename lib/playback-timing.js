// SPDX-License-Identifier: LGPL-2.1-or-later
/** Common backend contract. Queue sizes come from device progress, not timers.
 * A backend unable to measure its queue must throw, never report zero latency.
 */
export function playbackTiming(queuedFrames, rate) {
  if (!Number.isFinite(queuedFrames) || queuedFrames < 0 || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("playback timing unavailable");
  }
  return { queuedUsec: Math.round(queuedFrames * 1e6 / rate), playing: queuedFrames > 0 };
}

export function readPlaybackTiming(stream) {
  const timing=stream.timing?.()??{queuedUsec:stream.latencyUsec?.()};
  if(!Number.isSafeInteger(timing.queuedUsec)||timing.queuedUsec<0)throw new Error("playback timing unavailable");
  return {queuedUsec:timing.queuedUsec,playing:timing.playing??timing.queuedUsec>0};
}

/** Map one mixer input's real samples onto the shared sink timeline.
 * Silence inserted for another input is not progress in this input's media.
 */
export class InputTimeline {
  constructor(){this.ranges=[];}
  submit(start, frames){
    if (!frames) return;
    const last=this.ranges.at(-1);
    if(last?.end===start)last.end+=frames;
    else this.ranges.push({start,end:start+frames});
  }
  queued(played){
    while(this.ranges.length&&this.ranges[0].end<=played)this.ranges.shift();
    return this.ranges.reduce((sum,r)=>sum+Math.max(0,r.end-Math.max(played,r.start)),0);
  }
}
