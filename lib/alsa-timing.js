// SPDX-License-Identifier: LGPL-2.1-or-later
import {playbackTiming} from "./playback-timing.js";

/** Hardware DELAY plus software pending frames, in the negotiated HW format. */
export function installAlsaTiming(stream,{ptr,request,is64}) {
  stream.timing=()=>{
    if(stream.closed)return playbackTiming(0,stream.rate);
    const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);
    let frames=0;
    if(stream.native.symbols.ioctl(stream.fd,BigInt(request),ptr(bytes))<0){
      const error=stream.errno();
      // After an xrun/suspend the hardware queue is empty. Other ioctl failures
      // are unknown timing, not zero latency (which would advance video).
      if(error!==32&&error!==86)throw new Error(`ALSA playback timing unavailable (errno ${error})`);
    }else frames=Math.max(0,is64?Number(view.getBigInt64(0,true)):view.getInt32(0,true));
    return playbackTiming(frames+stream.pendingBytes/stream.frameBytes,stream.rate);
  };
  stream.latencyUsec=()=>stream.timing().queuedUsec;
}
