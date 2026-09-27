// SPDX-License-Identifier: LGPL-2.1-or-later
// Software mixer: every playback stream is converted to one sink format and summed into a
// single shared device, because an ALSA hw PCM can only be opened by one stream at a time.
import {PcmConverter} from "./pcm-convert.js";

export const MIX_SPEC={format:3,rate:48000,channels:2};
const CHUNK_FRAMES=MIX_SPEC.rate/100,INPUT_TARGET_FRAMES=MIX_SPEC.rate/20; // mix 10 ms at a time; pace each client to ~50 ms queued

class MixerInput {
  constructor(mixer,spec){this.mixer=mixer;this.spec=spec;this.converter=new PcmConverter(spec,MIX_SPEC);this.queue=[];this.frames=0;this.waiters=[];this.closed=false;let resolve;this.exited=new Promise(r=>resolve=r);this.resolveExit=resolve;this.stdin={write:data=>this.write(data),end:()=>this.close(),flush:()=>Promise.resolve()};}
  write(input){if(this.closed)return 0;const raw=input instanceof Uint8Array?input:new Uint8Array(input),data=this.converter.process(raw);if(data.length){this.queue.push(new Int16Array(data.buffer,data.byteOffset,data.length>>1));this.frames+=data.length/2/MIX_SPEC.channels;this.mixer.poke();}this.wake();return raw.length;}
  take(frames){const n=Math.min(frames,this.frames),out=new Int16Array(n*MIX_SPEC.channels);let filled=0;while(filled<out.length){const chunk=this.queue[0],count=Math.min(chunk.length,out.length-filled);out.set(chunk.subarray(0,count),filled);filled+=count;if(count<chunk.length)this.queue[0]=chunk.subarray(count);else this.queue.shift();}this.frames-=n;this.wake();return out;}
  wake(){this.waiters=this.waiters.filter(w=>{if(this.closed){w.resolve();return false;}if(w.drain){if(this.frames)return true;setTimeout(w.resolve,Math.ceil((this.mixer.sink?.latencyUsec?.()??0)/1000));return false;}if(this.frames<=INPUT_TARGET_FRAMES){w.resolve();return false;}return true;});}
  ready(){return new Promise(resolve=>{this.waiters.push({resolve});this.wake();});}
  drain(){return new Promise(resolve=>{this.waiters.push({resolve,drain:true});this.wake();});}
  latencyUsec(){return Math.round(this.frames*1e6/MIX_SPEC.rate)+(this.mixer.sink?.latencyUsec?.()??0);}
  close(){if(this.closed)return;this.closed=true;this.queue=[];this.frames=0;this.wake();this.mixer.remove(this);this.resolveExit(0);}
  kill(){this.close();}
}

export class Mixer {
  constructor(openSink){this.openSink=openSink;this.inputs=new Set();this.sink=null;this.signal=null;this.running=false;}
  add(spec){if(!this.sink)this.sink=this.openSink(MIX_SPEC);const input=new MixerInput(this,spec);this.inputs.add(input);if(!this.running)this.run();return input;}
  // The device is released as soon as no stream uses it, so other programs can open it.
  remove(input){this.inputs.delete(input);if(!this.inputs.size&&this.sink){this.sink.close();this.sink=null;}this.poke();}
  poke(){const signal=this.signal;this.signal=null;signal?.();}
  mix(frames){const channels=MIX_SPEC.channels,sum=new Int32Array(frames*channels);for(const input of this.inputs){const data=input.take(frames);for(let i=0;i<data.length;i++)sum[i]+=data[i];}const out=new Int16Array(sum.length);for(let i=0;i<sum.length;i++)out[i]=Math.max(-32768,Math.min(32767,sum[i]));return new Uint8Array(out.buffer);}
  // Pull from the inputs only when the sink wants more; inputs short of data are padded with silence.
  async run(){this.running=true;try{while(this.sink){await this.sink.ready();if(!this.sink)break;const frames=Math.min(CHUNK_FRAMES,Math.max(0,...[...this.inputs].map(input=>input.frames)));if(!frames){await new Promise(resolve=>this.signal=resolve);continue;}this.sink.write(this.mix(frames));}}finally{this.running=false;}}
  close(){for(const input of [...this.inputs])input.close();}
}
