// SPDX-License-Identifier: LGPL-2.1-or-later
// Direct ALSA PCM kernel UAPI. No libasound, aplay, arecord, or subprocesses.
// HW_REFINE/HW_PARAMS selection follows alsa-lib's pcm_params.c design by
// Abramo Bagnara and other ALSA contributors; interval choice follows the
// snd_interval_refine_first/last semantics in alsa-lib's interval.c.
import {ptr,read} from "bun:ffi";
import {existsSync} from "node:fs";
import {openLibc} from "./libc.js";
import {PcmConverter,SAMPLE_BYTES} from "./pcm-convert.js";
import {Mixer} from "./mixer.js";

const P64=["arm64","x64"].includes(process.arch),HW_SIZE=P64?608:604;
const IOC=(dir,nr,size)=>((dir<<30)|(size<<16)|(0x41<<8)|nr)>>>0;
const IO={HW_REFINE:IOC(3,0x10,HW_SIZE),HW_PARAMS:IOC(3,0x11,HW_SIZE),HW_FREE:IOC(0,0x12,0),PREPARE:IOC(0,0x40,0),START:IOC(0,0x42,0),DROP:IOC(0,0x43,0),DRAIN:IOC(0,0x44,0),DELAY:IOC(2,0x21,P64?8:4)};
const COMMON_RATES=[8000,11025,16000,22050,32000,44100,48000,88200,96000,176400,192000,384000];
const FORMAT_NAMES={0:"S8",1:"U8",2:"S16_LE",3:"S16_BE",4:"U16_LE",5:"U16_BE",6:"S24_LE",7:"S24_BE",10:"S32_LE",11:"S32_BE",14:"FLOAT_LE",15:"FLOAT_BE",20:"MU_LAW",21:"A_LAW",32:"S24_3LE",33:"S24_3BE"};
const describeSpec=spec=>`${FORMAT_NAMES[ALSA_FORMAT[spec.format]]} ${spec.rate} Hz ${spec.channels} ch`;
const O_RDWR=2,O_NONBLOCK=0x800,EAGAIN=11,EINTR=4,EPIPE=32,ESTRPIPE=86,TARGET_BUFFER_MS=100;
const ALSA_FORMAT=[1,21,20,2,3,14,15,10,11,32,33,6,7];

export function availablePcmDevices(direction="playback"){
  const suffix=direction==="playback"?"p":"c",out=[];
  for(let card=0;card<32;card++)for(let device=0;device<32;device++){const path=`/dev/snd/pcmC${card}D${device}${suffix}`;if(existsSync(path))out.push(path);}
  return out;
}

const setMask=(bytes,index,value)=>{bytes.fill(0,4+index*32,4+(index+1)*32);new DataView(bytes.buffer).setUint32(4+index*32+(value>>>5)*4,1<<(value&31),true);};
const setInterval=(bytes,param,value)=>{const o=260+(param-8)*12,v=new DataView(bytes.buffer);v.setUint32(o,value,true);v.setUint32(o+4,value,true);v.setUint32(o+8,4,true);};
const changed=(bytes,param)=>{const v=new DataView(bytes.buffer),bit=(1<<param)>>>0;v.setUint32(512,bit,true);v.setUint32(516,(v.getUint32(516,true)|bit)>>>0,true);};

export function makeHwParams(format,rate,channels){
  const alsaFormat=ALSA_FORMAT[format];if(alsaFormat==null)throw new Error(`unsupported PCM format ${format}`);
  const b=new Uint8Array(HW_SIZE),v=new DataView(b.buffer);b.fill(0xff,4,100);for(let i=0;i<12;i++){const o=260+i*12;v.setUint32(o,0,true);v.setUint32(o+4,0xffffffff,true);v.setUint32(o+8,0,true);}v.setUint32(512,0xffffffff,true);v.setUint32(520,0xffffffff,true);
  return {bytes:b,constraints:[[0,"access",()=>setMask(b,0,3)],[1,"format",()=>setMask(b,1,alsaFormat)],[2,"subformat",()=>setMask(b,2,0)],[10,"channels",()=>setInterval(b,10,channels)],[11,"rate",()=>setInterval(b,11,rate)]],apply(){for(const [param,,set] of this.constraints){set();changed(b,param);}},sampleBytes:SAMPLE_BYTES[format]};
}

export function chooseParam(bytes,param,last=false){const v=new DataView(bytes.buffer);if(param<=2){const o=4+param*32;let chosen=-1;for(let word=0;word<8;word++){const bits=v.getUint32(o+word*4,true);if(bits){chosen=word*32+(last?31-Math.clz32(bits):31-Math.clz32(bits&-bits));if(!last)break;}}if(chosen<0)throw new Error(`ALSA parameter ${param} has no available value`);setMask(bytes,param,chosen);}else{const o=260+(param-8)*12,min=v.getUint32(o,true),max=v.getUint32(o+4,true),flags=v.getUint32(o+8,true);if(min>max||(min===max&&flags&3))throw new Error(`ALSA parameter ${param} has no available interval`);if(min!==max){if(last){const value=flags&2?max-1:max;v.setUint32(o,value,true);v.setUint32(o+8,(flags&~1)|(flags&1&&value<=min?1:0),true);}else{const value=flags&1?min+1:min;v.setUint32(o+4,value,true);v.setUint32(o+8,(flags&~2)|(flags&2&&value>=max?2:0),true);}}}const bit=(1<<param)>>>0;v.setUint32(512,bit,true);v.setUint32(516,(v.getUint32(516,true)|bit)>>>0,true);}

// Pick the largest value not above limit (a bounded buffer keeps latency and client pacing sane); fall back to the minimum.
export function chooseAtMost(bytes,param,limit){const v=new DataView(bytes.buffer),o=260+(param-8)*12,min=v.getUint32(o,true),max=v.getUint32(o+4,true);if(limit<min+(v.getUint32(o+8,true)&1)){chooseParam(bytes,param,false);return;}if(limit<max){v.setUint32(o+4,limit,true);v.setUint32(o+8,v.getUint32(o+8,true)&~2,true);}chooseParam(bytes,param,true);}
const interval=(bytes,param)=>new DataView(bytes.buffer).getUint32(260+(param-8)*12,true);
const libcSymbols={open:{args:["ptr","i32"],returns:"i32"},close:{args:["i32"],returns:"i32"},ioctl:{args:["i32","u64","ptr"],returns:"i32"},read:{args:["i32","ptr","u64"],returns:"i64"},write:{args:["i32","ptr","u64"],returns:"i64"}};
// glibc and musl export __errno_location; Android bionic exports __errno.
function openPcmLibc(){try{const library=openLibc({...libcSymbols,__errno_location:{args:[],returns:"ptr"}}).library;return {library,errno:()=>read.i32(library.symbols.__errno_location(),0)};}catch{const library=openLibc({...libcSymbols,__errno:{args:[],returns:"ptr"}}).library;return {library,errno:()=>read.i32(library.symbols.__errno(),0)};}}

// What a PCM accepts before any constraint. The kernel reports rate only as a range, so common rates are probed one by one.
function probeHw(native,fd,path){const refine=bytes=>native.symbols.ioctl(fd,BigInt(IO.HW_REFINE),ptr(bytes))>=0,p=makeHwParams(3,48000,2),v=new DataView(p.bytes.buffer);if(!refine(p.bytes))throw new Error(`probe HW_REFINE failed on ${path}`);const formats=[];for(let bit=0;bit<64;bit++)if(v.getUint32(36+(bit>>>5)*4,true)&(1<<(bit&31)))formats.push(FORMAT_NAMES[bit]||`format-${bit}`);const range=param=>[v.getUint32(260+(param-8)*12,true),v.getUint32(260+(param-8)*12+4,true)],[rmin,rmax]=range(11),[cmin,cmax]=range(10),rates=COMMON_RATES.filter(rate=>{if(rate<rmin||rate>rmax)return false;const q=makeHwParams(3,rate,2);q.constraints.find(([param])=>param===11)[2]();changed(q.bytes,11);return refine(q.bytes);});return `rates ${rates.join(", ")||"none of the common rates"} Hz (range ${rmin}-${rmax}), channels ${cmin}-${cmax}, formats ${formats.join(", ")}`;}

export function describePcmDevice(path){const {library,errno}=openPcmLibc(),name=new TextEncoder().encode(`${path}\0`),fd=library.symbols.open(ptr(name),O_RDWR|O_NONBLOCK);try{if(fd<0){const e=errno();return e===16?"busy (in use by another program)":`cannot open (errno ${e})`;}try{return probeHw(library,fd,path);}catch(error){return error.message;}finally{library.symbols.close(fd);}}finally{library.close();}}

class AlsaPcmStream {
  constructor(direction,spec,path){this.direction=direction;this.spec=spec;this.path=path;this.closed=false;let resolve;this.exited=new Promise(r=>resolve=r);this.resolveExit=resolve;({library:this.native,errno:this.errno}=openPcmLibc());const name=new TextEncoder().encode(`${path}\0`);this.fd=this.native.symbols.open(ptr(name),O_RDWR|O_NONBLOCK);if(this.fd<0){const e=this.errno();this.native.close();throw Object.assign(new Error(`cannot open ALSA PCM ${path} (${e===16?"EBUSY: device already in use":`errno ${e}`})`),{errno:e});}try{this.configure();}catch(error){this.native.symbols.close(this.fd);this.native.close();throw error;}}
  ioctl(request,data=null,operation="ioctl"){const r=this.native.symbols.ioctl(this.fd,BigInt(request),data?ptr(data):null);if(r<0)throw new Error(`ALSA PCM ${operation} (0x${request.toString(16)}) failed on ${this.path}`);return r;}
  configureHw(spec){const p=makeHwParams(spec.format,spec.rate,spec.channels),v=new DataView(p.bytes.buffer);this.ioctl(IO.HW_REFINE,p.bytes,"initial HW_REFINE");for(const [param,name,set] of p.constraints){set();changed(p.bytes,param);this.ioctl(IO.HW_REFINE,p.bytes,`${name} HW_REFINE`);}for(const [param,last] of [[0,false],[1,false],[2,false],[10,false],[11,false]]){chooseParam(p.bytes,param,last);this.ioctl(IO.HW_REFINE,p.bytes,`parameter-${param} HW_REFINE`);}const rate=interval(p.bytes,11);chooseAtMost(p.bytes,17,Math.round(rate*TARGET_BUFFER_MS/1000));this.ioctl(IO.HW_REFINE,p.bytes,"parameter-17 HW_REFINE");chooseAtMost(p.bytes,13,Math.floor(interval(p.bytes,17)/4));this.ioctl(IO.HW_REFINE,p.bytes,"parameter-13 HW_REFINE");for(const param of [12,19]){chooseParam(p.bytes,param);this.ioctl(IO.HW_REFINE,p.bytes,`parameter-${param} HW_REFINE`);}v.setUint32(512,0,true);v.setUint32(516,0,true);this.ioctl(IO.HW_PARAMS,p.bytes,"HW_PARAMS");this.ioctl(IO.PREPARE,null,"PREPARE");this.frameBytes=p.sampleBytes*spec.channels;this.rate=interval(p.bytes,11);this.bufferFrames=interval(p.bytes,17);this.periodMs=Math.max(1,Math.round(interval(p.bytes,13)*1000/this.rate));}
  // Like PulseAudio, fall back to an s16le hardware format and convert in software when the device rejects the client spec.
  configure(){try{console.log(`jspulse: ${this.path} hardware supports ${probeHw(this.native,this.fd,this.path)}`);}catch(error){console.log(`jspulse: ${this.path} hardware probe failed: ${error.message}`);}const {format,rate,channels}=this.spec,seen=new Set(),errors=[];for(const spec of [this.spec,{format:3,rate,channels},{format:3,rate:48000,channels},{format:3,rate:48000,channels:2},{format:3,rate:44100,channels:2}]){const key=`${spec.format}/${spec.rate}/${spec.channels}`;if(seen.has(key))continue;seen.add(key);try{this.configureHw(spec);this.hwSpec=spec;console.log(`jspulse: ${this.path} opened at ${describeSpec(spec)}, buffer ${Math.round(this.bufferFrames*1000/this.rate)} ms${spec===this.spec?"":` (requested ${describeSpec(this.spec)}; converting in software)`}`);if(spec!==this.spec)this.converter=this.direction==="playback"?new PcmConverter(this.spec,spec):new PcmConverter(spec,this.spec);return;}catch(error){errors.push(`${key}: ${error.message}`);try{this.ioctl(IO.HW_FREE);}catch{}}}throw new Error(`no usable ALSA hardware configuration for ${this.path}:\n${errors.join("\n")}`);}
  recover(){try{this.ioctl(IO.PREPARE);return true;}catch{return false;}}
  // Frames queued in the hardware buffer; 0 when stopped or after an xrun.
  delayFrames(){if(this.closed)return 0;const b=new Uint8Array(8),v=new DataView(b.buffer);if(this.native.symbols.ioctl(this.fd,BigInt(IO.DELAY),ptr(b))<0)return 0;return Math.max(0,P64?Number(v.getBigInt64(0,true)):v.getInt32(0,true));}
  close(){if(this.closed)return;this.closed=true;clearTimeout(this.timer);try{this.ioctl(IO.DROP);}catch{}this.native.symbols.close(this.fd);this.fd=-1;this.native.close();this.resolveExit(0);}
  kill(){this.close();}
}

// Non-blocking playback: data waits in a small JS queue and is pushed to ALSA on a period timer, so
// the event loop (and SIGINT) never blocks. ready() lets the Pulse server pace clients to real playback.
class AlsaPlayback extends AlsaPcmStream {
  constructor(spec,path){super("playback",spec,path);this.pending=[];this.pendingBytes=0;this.partial=new Uint8Array(0);this.waiters=[];this.timer=null;this.stdin={write:data=>this.write(data),end:()=>this.close(),flush:()=>Promise.resolve()};}
  write(input){if(this.closed)return 0;const raw=input instanceof Uint8Array?input:new Uint8Array(input);let data=this.converter?this.converter.process(raw):raw;if(this.partial.length){const x=new Uint8Array(this.partial.length+data.length);x.set(this.partial);x.set(data,this.partial.length);data=x;}const keep=data.length%this.frameBytes;this.partial=data.slice(data.length-keep);data=data.subarray(0,data.length-keep);if(data.length){this.pending.push(data);this.pendingBytes+=data.length;}this.pump();return raw.length;}
  pump(){this.timer=null;while(!this.closed&&this.pending.length){const data=this.pending[0],n=Number(this.native.symbols.write(this.fd,ptr(data),data.length));if(n<0){const e=this.errno();if(e===EINTR)continue;if(e===EAGAIN)break;if((e===EPIPE||e===ESTRPIPE)&&this.recover())continue;console.error(`jspulse: ALSA PCM write failed on ${this.path} (errno ${e})`);this.pending=[];this.pendingBytes=0;break;}if(n===0)break;this.pendingBytes-=n;if(n<data.length)this.pending[0]=data.subarray(n);else this.pending.shift();}this.wake();if(!this.closed&&this.pending.length&&!this.timer)this.timer=setTimeout(()=>this.pump(),this.periodMs);}
  wake(){const lowWater=this.bufferFrames*this.frameBytes/4;this.waiters=this.waiters.filter(w=>{if(this.closed||(w.drain?!this.pendingBytes&&!this.delayFrames():this.pendingBytes<=lowWater)){w.resolve();return false;}return true;});if(!this.closed&&this.waiters.some(w=>w.drain)&&!this.timer)this.timer=setTimeout(()=>this.pump(),this.periodMs);}
  ready(){return new Promise(resolve=>{this.waiters.push({resolve});this.wake();});}
  drain(){return new Promise(resolve=>{this.waiters.push({resolve,drain:true});this.wake();});}
  latencyUsec(){return Math.round((this.delayFrames()+this.pendingBytes/this.frameBytes)*1e6/this.rate);}
  close(){super.close();this.pending=[];this.pendingBytes=0;this.wake();}
}

class AlsaCapture extends AlsaPcmStream {
  constructor(spec,path){super("capture",spec,path);this.stdout=new ReadableStream({start:controller=>{this.controller=controller;this.pump();},cancel:()=>this.close()});}
  async pump(){const buffer=new Uint8Array(Math.max(4096,this.frameBytes*1024));while(!this.closed){let n=Number(this.native.symbols.read(this.fd,ptr(buffer),buffer.length));if(n<0){const e=this.errno();if(e===EAGAIN){await new Promise(resolve=>setTimeout(resolve,this.periodMs));continue;}if(e===EINTR)continue;if(!this.recover())break;continue;}if(n){const chunk=buffer.slice(0,n),data=this.converter?this.converter.process(chunk):chunk;if(data.length)this.controller.enqueue(data);}await new Promise(resolve=>setTimeout(resolve,0));}if(!this.closed){try{this.controller.close();}catch{}this.close();}}
}

export class AlsaPcmBackend {
  constructor(){this.streams=new Set();this.mixer=new Mixer(spec=>{const path=availablePcmDevices("playback")[0];if(!path)throw new Error("no ALSA playback PCM device found");return new AlsaPlayback(spec,path);});}
  // Playback streams share one device through the software mixer; capture still opens the device per stream.
  openPlayback(spec){const stream=this.mixer.add(spec);this.streams.add(stream);stream.exited.finally(()=>this.streams.delete(stream));return stream;}
  openRecord(spec){const path=availablePcmDevices("capture")[0];if(!path)throw new Error("no ALSA capture PCM device found");const stream=new AlsaCapture(spec,path);this.streams.add(stream);stream.exited.finally(()=>this.streams.delete(stream));return stream;}
  close(stream){stream.close();}
  async shutdown(){for(const stream of [...this.streams])stream.close();await Promise.allSettled([...this.streams].map(stream=>stream.exited));}
}
