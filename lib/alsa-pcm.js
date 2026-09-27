// SPDX-License-Identifier: LGPL-2.1-or-later
// Direct ALSA PCM kernel UAPI. No libasound, aplay, arecord, or subprocesses.
// HW_REFINE/HW_PARAMS selection follows alsa-lib's pcm_params.c design by
// Abramo Bagnara and other ALSA contributors.
import {ptr} from "bun:ffi";
import {existsSync} from "node:fs";
import {openLibc} from "./libc.js";

const P64=["arm64","x64"].includes(process.arch),HW_SIZE=P64?608:604;
const IOC=(dir,nr,size)=>((dir<<30)|(size<<16)|(0x41<<8)|nr)>>>0;
const IO={HW_REFINE:IOC(3,0x10,HW_SIZE),HW_PARAMS:IOC(3,0x11,HW_SIZE),HW_FREE:IOC(0,0x12,0),PREPARE:IOC(0,0x40,0),START:IOC(0,0x42,0),DROP:IOC(0,0x43,0),DRAIN:IOC(0,0x44,0)};
const ALSA_FORMAT=[1,21,20,2,3,14,15,10,11,32,33,6,7];
const SAMPLE_BYTES=[1,1,1,2,2,4,4,4,4,3,3,4,4];

export function availablePcmDevices(direction="playback"){
  const suffix=direction==="playback"?"p":"c",out=[];
  for(let card=0;card<32;card++)for(let device=0;device<32;device++){const path=`/dev/snd/pcmC${card}D${device}${suffix}`;if(existsSync(path))out.push(path);}
  return out;
}

const setMask=(bytes,index,value)=>{bytes.fill(0,4+index*32,4+(index+1)*32);new DataView(bytes.buffer).setUint32(4+index*32+(value>>>5)*4,1<<(value&31),true);};
const setInterval=(bytes,param,value)=>{const o=260+(param-8)*12,v=new DataView(bytes.buffer);v.setUint32(o,value,true);v.setUint32(o+4,value,true);v.setUint32(o+8,4,true);};

export function makeHwParams(format,rate,channels){
  const alsaFormat=ALSA_FORMAT[format];if(alsaFormat==null)throw new Error(`unsupported PCM format ${format}`);
  const b=new Uint8Array(HW_SIZE),v=new DataView(b.buffer);b.fill(0xff,4,100);for(let i=0;i<12;i++){const o=260+i*12;v.setUint32(o,0,true);v.setUint32(o+4,0xffffffff,true);v.setUint32(o+8,0,true);}v.setUint32(512,0xffffffff,true);v.setUint32(520,0xffffffff,true);
  return {bytes:b,apply(){setMask(b,0,3);setMask(b,1,alsaFormat);setMask(b,2,0);setInterval(b,10,channels);setInterval(b,11,rate);const changed=(7|(1<<10)|(1<<11))>>>0;v.setUint32(512,changed,true);v.setUint32(516,changed,true);},sampleBytes:SAMPLE_BYTES[format]};
}

function chooseParam(bytes,param,last=false){const v=new DataView(bytes.buffer);if(param<=2){const o=4+param*32;let chosen=-1;for(let word=0;word<8;word++){const bits=v.getUint32(o+word*4,true);if(bits){chosen=word*32+(last?31-Math.clz32(bits):31-Math.clz32(bits&-bits));if(!last)break;}}if(chosen<0)throw new Error(`ALSA parameter ${param} has no available value`);setMask(bytes,param,chosen);}else{const o=260+(param-8)*12,min=v.getUint32(o,true),max=v.getUint32(o+4,true),flags=v.getUint32(o+8,true),value=last?max-(flags&2?1:0):min+(flags&1?1:0);if(value>max)throw new Error(`ALSA parameter ${param} has no available interval`);v.setUint32(o,value,true);v.setUint32(o+4,value,true);v.setUint32(o+8,flags&4,true);}const bit=(1<<param)>>>0;v.setUint32(512,bit,true);v.setUint32(516,(v.getUint32(516,true)|bit)>>>0,true);}

class AlsaPcmStream {
  constructor(direction,spec,path){this.direction=direction;this.spec=spec;this.path=path;this.closed=false;let resolve;this.exited=new Promise(r=>resolve=r);this.resolveExit=resolve;this.native=openLibc({open:{args:["ptr","i32"],returns:"i32"},close:{args:["i32"],returns:"i32"},ioctl:{args:["i32","u64","ptr"],returns:"i32"},read:{args:["i32","ptr","u64"],returns:"i64"},write:{args:["i32","ptr","u64"],returns:"i64"}}).library;const name=new TextEncoder().encode(`${path}\0`);this.fd=this.native.symbols.open(ptr(name),2);if(this.fd<0){this.native.close();throw new Error(`cannot open ALSA PCM ${path}`);}try{this.configure();}catch(error){this.native.symbols.close(this.fd);this.native.close();throw error;}}
  ioctl(request,data=null,operation="ioctl"){const r=this.native.symbols.ioctl(this.fd,BigInt(request),data?ptr(data):null);if(r<0)throw new Error(`ALSA PCM ${operation} (0x${request.toString(16)}) failed on ${this.path}`);return r;}
  configure(){const p=makeHwParams(this.spec.format,this.spec.rate,this.spec.channels),v=new DataView(p.bytes.buffer);this.ioctl(IO.HW_REFINE,p.bytes,"initial HW_REFINE");p.apply();this.ioctl(IO.HW_REFINE,p.bytes,"requested-format HW_REFINE");for(const [param,last] of [[0,false],[1,false],[2,false],[10,false],[11,false],[17,true],[13,false],[12,false],[19,false]]){chooseParam(p.bytes,param,last);this.ioctl(IO.HW_REFINE,p.bytes,`parameter-${param} HW_REFINE`);}v.setUint32(512,0,true);v.setUint32(516,0,true);this.ioctl(IO.HW_PARAMS,p.bytes,"HW_PARAMS");this.ioctl(IO.PREPARE,null,"PREPARE");this.frameBytes=p.sampleBytes*this.spec.channels;}
  recover(){try{this.ioctl(IO.PREPARE);return true;}catch{return false;}}
  close(){if(this.closed)return;this.closed=true;try{this.ioctl(this.direction==="playback"?IO.DRAIN:IO.DROP);}catch{}this.native.symbols.close(this.fd);this.fd=-1;this.native.close();this.resolveExit(0);}
  kill(){this.close();}
}

class AlsaPlayback extends AlsaPcmStream {
  constructor(spec,path){super("playback",spec,path);this.stdin={write:data=>this.write(data),end:()=>this.close(),flush:()=>Promise.resolve()};}
  write(input){if(this.closed)return 0;const data=input instanceof Uint8Array?input:new Uint8Array(input);let offset=0;while(offset<data.length){let n=Number(this.native.symbols.write(this.fd,ptr(data.subarray(offset)),data.length-offset));if(n<0){if(this.recover()){n=Number(this.native.symbols.write(this.fd,ptr(data.subarray(offset)),data.length-offset));}if(n<0)throw new Error(`ALSA PCM write failed on ${this.path}`);}if(n===0)break;offset+=n;}return offset;}
}

class AlsaCapture extends AlsaPcmStream {
  constructor(spec,path){super("capture",spec,path);this.stdout=new ReadableStream({start:controller=>{this.controller=controller;this.pump();},cancel:()=>this.close()});}
  async pump(){const buffer=new Uint8Array(Math.max(4096,this.frameBytes*1024));while(!this.closed){let n=Number(this.native.symbols.read(this.fd,ptr(buffer),buffer.length));if(n<0){if(!this.recover())break;continue;}if(n)this.controller.enqueue(buffer.slice(0,n));await new Promise(resolve=>setTimeout(resolve,0));}if(!this.closed){try{this.controller.close();}catch{}this.close();}}
}

export class AlsaPcmBackend {
  constructor(){this.streams=new Set();}
  openPlayback(spec){const path=availablePcmDevices("playback")[0];if(!path)throw new Error("no ALSA playback PCM device found");const stream=new AlsaPlayback(spec,path);this.streams.add(stream);stream.exited.finally(()=>this.streams.delete(stream));return stream;}
  openRecord(spec){const path=availablePcmDevices("capture")[0];if(!path)throw new Error("no ALSA capture PCM device found");const stream=new AlsaCapture(spec,path);this.streams.add(stream);stream.exited.finally(()=>this.streams.delete(stream));return stream;}
  close(stream){stream.close();}
  async shutdown(){for(const stream of [...this.streams])stream.close();await Promise.allSettled([...this.streams].map(stream=>stream.exited));}
}
