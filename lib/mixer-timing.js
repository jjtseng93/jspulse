// SPDX-License-Identifier: LGPL-2.1-or-later
import {InputTimeline,playbackTiming,readPlaybackTiming} from "./playback-timing.js";

const sinks=new WeakMap();

/** Track the mixed sink's submitted frame cursor without changing mixing. */
export function installMixerTiming(mixer) {
  const open=mixer.openSink;
  mixer.openSink=spec=>{
    const sink=open(spec),state={written:0,played:0,rate:spec.rate};
    sinks.set(sink,state);
    const write=sink.write;
    sink.write=function(bytes){
      const result=write.call(this,bytes);
      state.written+=bytes.length/(spec.channels*2);
      return result;
    };
    return sink;
  };
}

/** Per-input accounting avoids attributing other streams' queued silence or
 * sound to a starved input. Drain polls actual device completion, not a timer
 * calculated once from an old latency estimate.
 */
export function installMixerInputTiming(input) {
  const timeline=new InputTimeline(),take=input.take,close=input.close;
  const drains=new Set();
  input.take=function(frames){
    const data=take.call(this,frames),state=sinks.get(this.mixer.sink);
    if(state)timeline.submit(state.written,data.length/2);
    return data;
  };
  input.timing=()=>{
    if(input.closed)return playbackTiming(0,48000);
    const sink=input.mixer.sink,state=sinks.get(sink);
    if(!state)throw new Error("mixer output timing unavailable");
    const queued=readPlaybackTiming(sink).queuedUsec*state.rate/1e6;
    state.played=Math.max(state.played,Math.min(state.written,Math.max(0,state.written-queued)));
    return playbackTiming(input.frames+timeline.queued(state.played),state.rate);
  };
  input.latencyUsec=()=>input.timing().queuedUsec;
  input.drain=()=>new Promise((resolve,reject)=>{
    const entry={timer:null,resolve,reject};
    const check=()=>{
      try{
        if(input.closed||input.timing().queuedUsec===0){drains.delete(entry);resolve();}
        else entry.timer=setTimeout(check,5);
      }catch(error){drains.delete(entry);reject(error);}
    };
    drains.add(entry);check();
  });
  input.close=function(...args){
    try{return close.apply(this,args);}finally{
      for(const entry of drains){clearTimeout(entry.timer);entry.resolve();}
      drains.clear();
    }
  };
}
