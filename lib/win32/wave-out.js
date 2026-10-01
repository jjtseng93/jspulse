// SPDX-License-Identifier: LGPL-2.1-or-later
import {POINTER_SIZE,HEADER_SIZE,WAVE_MAPPER,WHDR_DONE,check,waveFormat,readHandle,waveHeader} from "./native.js";
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_QUEUED_BUFFERS=8; // 80 ms with the mixer's 10 ms chunks: enough headroom for Bun/Windows scheduling jitter.
export class WaveOutSink{
  constructor(lib,spec){this.lib=lib;this.spec=spec;this.closed=false;this.queue=[];this.handleStorage=new Uint8Array(POINTER_SIZE);this.format=waveFormat(spec);check(lib.symbols.waveOutOpen(this.handleStorage,WAVE_MAPPER,this.format,null,null,0),"waveOutOpen");this.handle=readHandle(this.handleStorage);}
  isDone(item){return (new DataView(item.header.buffer).getUint32(POINTER_SIZE+16,true)&WHDR_DONE)!==0;}
  reap(){while(this.queue.length&&this.isDone(this.queue[0])){const item=this.queue.shift();check(this.lib.symbols.waveOutUnprepareHeader(this.handle,item.header,HEADER_SIZE),"waveOutUnprepareHeader");}}
  async ready(){this.reap();while(!this.closed&&this.queue.length>=MAX_QUEUED_BUFFERS){await delay(1);this.reap();}}
  write(input){if(this.closed)throw new Error("waveOut device is closed");if(this.queue.length>=MAX_QUEUED_BUFFERS)throw new Error("waveOut queue is full");const data=new Uint8Array(input),header=waveHeader(data);check(this.lib.symbols.waveOutPrepareHeader(this.handle,header,HEADER_SIZE),"waveOutPrepareHeader");try{check(this.lib.symbols.waveOutWrite(this.handle,header,HEADER_SIZE),"waveOutWrite");}catch(error){this.lib.symbols.waveOutUnprepareHeader(this.handle,header,HEADER_SIZE);throw error;}this.queue.push({data,header});return data.length;}
  async drain(){while(!this.closed&&this.queue.length){await delay(1);this.reap();}}
  latencyUsec(){this.reap();const bytes=this.queue.reduce((sum,item)=>sum+item.data.length,0);return Math.round(bytes/(this.spec.rate*this.spec.channels*2)*1e6);}
  close(){if(this.closed)return;this.closed=true;this.lib.symbols.waveOutReset(this.handle);for(const item of this.queue)this.lib.symbols.waveOutUnprepareHeader(this.handle,item.header,HEADER_SIZE);this.queue=[];this.lib.symbols.waveOutClose(this.handle);}
}
