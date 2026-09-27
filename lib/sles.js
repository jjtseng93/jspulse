// SPDX-License-Identifier: LGPL-2.1-or-later
// JavaScript port created in 2026 by Dr. John (醫者小智), based on Termux's
// PulseAudio module-sles-sink/source work by Lennart Poettering,
// Nathan Martynov, Patrick Gaskin, and other contributors.
// Android OpenSL ES output for Bun. The object/interface calls mirror the
// public NDK ABI used by Termux's module-sles-sink.c; no PulseAudio daemon or
// native addon is involved.
import { CFunction, JSCallback, ptr, read } from "bun:ffi";
import {openAndroidPlatformLibrary} from "./android-loader.js";
import {existsSync} from "node:fs";

const P64 = ["arm64", "x64"].includes(process.arch);
const PW = P64 ? 8 : 4;
const readPointer=(address,offset=0)=>P64?read.u64(address,offset):read.u32(address,offset);
const SL = {
  SUCCESS: 0, FALSE: 0, TRUE: 1,
  DATALOCATOR_OUTPUTMIX: 4, DATALOCATOR_BUFFERQUEUE: 6,
  DATALOCATOR_IODEVICE: 3, DATALOCATOR_ANDROID_QUEUE: 0x800007bd,
  IODEVICE_AUDIOINPUT: 1, DEFAULT_AUDIOINPUT: 0xffffffff,
  DATAFORMAT_PCM: 2, BYTEORDER_LITTLEENDIAN: 2,
  SPEAKER_FRONT_LEFT: 1, SPEAKER_FRONT_RIGHT: 2, SPEAKER_FRONT_CENTER: 4,
  PLAYSTATE_STOPPED: 1, PLAYSTATE_PLAYING: 3,
  RECORDSTATE_STOPPED: 1, RECORDSTATE_RECORDING: 3,
};

function pointerArray(n=1) { return P64 ? new BigUint64Array(n) : new Uint32Array(n); }
function setPointer(view, offset, value) { P64 ? view.setBigUint64(offset,BigInt(value||0),true) : view.setUint32(offset,Number(value||0),true); }
function align(n,a=PW){return Math.ceil(n/a)*a;}
function outPointer(){const a=pointerArray(),p=ptr(a);return {a,p,get:()=>readPointer(p)};}
function struct(size, fields){const a=new Uint8Array(size),v=new DataView(a.buffer);fields(v);return a;}

function loadLibrary(){
  const path=P64?"/system/lib64/libOpenSLES.so":"/system/lib/libOpenSLES.so",native=openAndroidPlatformLibrary(path);
  const create=new CFunction({ptr:native.symbol("slCreateEngine"),args:["ptr","u32","ptr","u32","ptr","ptr"],returns:"u32"});
  return {symbols:{slCreateEngine:create,SL_IID_ENGINE:{ptr:native.symbol("SL_IID_ENGINE")},SL_IID_PLAY:{ptr:native.symbol("SL_IID_PLAY")},SL_IID_BUFFERQUEUE:{ptr:native.symbol("SL_IID_BUFFERQUEUE")},SL_IID_RECORD:{ptr:native.symbol("SL_IID_RECORD")},SL_IID_ANDROIDSIMPLEBUFFERQUEUE:{ptr:native.symbol("SL_IID_ANDROIDSIMPLEBUFFERQUEUE")}},close(){create.close();native.close();}};
}

export class OpenSLESBackend {
  constructor(lib){this.lib=lib;this.players=new Set();this.fns=[];this.fnCache=new Map();this.iids={};for(const n of ["ENGINE","PLAY","BUFFERQUEUE","RECORD","ANDROIDSIMPLEBUFFERQUEUE"]){const symbol=lib.symbols[`SL_IID_${n}`];this.iids[n]=readPointer(symbol.ptr);if(!this.iids[n])throw new Error(`OpenSL ES missing SL_IID_${n}`);}}
  static open(){const android=existsSync("/system/bin/linker64")||existsSync("/system/bin/linker");if(!android&&!process.env.JSPULSE_ALLOW_SLES)throw new Error("--sles is available only on Android");return new OpenSLESBackend(loadLibrary());}
  fn(address,args,returns="u32"){const key=`${address}:${returns}:${args.join(",")}`;let f=this.fnCache.get(key);if(!f){f=new CFunction({ptr:address,args,returns});this.fnCache.set(key,f);this.fns.push(f);}return f;}
  method(self,index,args,returns="u32"){const table=readPointer(self),address=readPointer(table,index*PW);if(!address)throw new Error(`OpenSL ES method ${index} is null`);return this.fn(address,["ptr",...args],returns);}
  check(result,operation){if(result!==SL.SUCCESS)throw new Error(`OpenSL ES ${operation} failed (${result})`);}
  openPlayback(spec){const p=new OpenSLESPlayer(this,spec);this.players.add(p);p.exited.finally(()=>this.players.delete(p));return p;}
  openRecord(spec){const p=new OpenSLESRecorder(this,spec);this.players.add(p);p.exited.finally(()=>this.players.delete(p));return p;}
  close(p){p.close();}
  async shutdown(){for(const p of [...this.players])p.close();for(const f of this.fns.splice(0))f.close();this.fnCache.clear();this.lib.close();}
}

class OpenSLESRecorder {
  constructor(api,spec){if(spec.format!==3)throw new Error("OpenSL ES source currently requires s16le");this.api=api;this.spec=spec;this.closed=false;let resolve;this.exited=new Promise(r=>resolve=r);this.resolveExit=resolve;this.stdout=new ReadableStream({start:c=>this.controller=c,cancel:()=>this.close()});this.create();}
  create(){const a=this.api,engine=outPointer();a.check(a.lib.symbols.slCreateEngine(engine.p,0,null,0,null,null),"create recorder engine");this.engine=engine.get();a.check(a.method(this.engine,0,["u32"])(this.engine,SL.FALSE),"realize recorder engine");const eitf=outPointer();a.check(a.method(this.engine,3,["ptr","ptr"])(this.engine,a.iids.ENGINE,eitf.p),"get recorder engine interface");this.engineItf=eitf.get();
    const sourceLocator=struct(align(12)+PW,v=>{v.setUint32(0,SL.DATALOCATOR_IODEVICE,true);v.setUint32(4,SL.IODEVICE_AUDIOINPUT,true);v.setUint32(8,SL.DEFAULT_AUDIOINPUT,true);setPointer(v,align(12),0);});const source=struct(PW*2,v=>{setPointer(v,0,ptr(sourceLocator));setPointer(v,PW,0);});
    const queueLocator=struct(8,v=>{v.setUint32(0,SL.DATALOCATOR_ANDROID_QUEUE,true);v.setUint32(4,8,true);});const channels=Math.max(1,Math.min(this.spec.channels,2));const pcm=struct(28,v=>{v.setUint32(0,SL.DATAFORMAT_PCM,true);v.setUint32(4,channels,true);v.setUint32(8,this.spec.rate*1000,true);v.setUint32(12,16,true);v.setUint32(16,16,true);v.setUint32(20,channels===1?SL.SPEAKER_FRONT_CENTER:SL.SPEAKER_FRONT_LEFT|SL.SPEAKER_FRONT_RIGHT,true);v.setUint32(24,SL.BYTEORDER_LITTLEENDIAN,true);});const sink=struct(PW*2,v=>{setPointer(v,0,ptr(queueLocator));setPointer(v,PW,ptr(pcm));});const ids=pointerArray(1);ids[0]=P64?BigInt(a.iids.ANDROIDSIMPLEBUFFERQUEUE):a.iids.ANDROIDSIMPLEBUFFERQUEUE;const required=new Uint32Array([SL.TRUE]);this.keep=[sourceLocator,source,queueLocator,pcm,sink,ids,required];
    const recorder=outPointer();a.check(a.method(this.engineItf,3,["ptr","ptr","ptr","u32","ptr","ptr"])(this.engineItf,recorder.p,ptr(source),ptr(sink),1,ptr(ids),ptr(required)),"create recorder (grant Android RECORD_AUDIO permission if denied)");this.recorder=recorder.get();a.check(a.method(this.recorder,0,["u32"])(this.recorder,SL.FALSE),"realize recorder");const record=outPointer();a.check(a.method(this.recorder,3,["ptr","ptr"])(this.recorder,a.iids.RECORD,record.p),"get record interface");this.record=record.get();const queue=outPointer();a.check(a.method(this.recorder,3,["ptr","ptr"])(this.recorder,a.iids.ANDROIDSIMPLEBUFFERQUEUE,queue.p),"get recorder queue");this.queue=queue.get();this.callback=new JSCallback(()=>this.filled(),{args:["ptr","ptr"],returns:"void",threadsafe:true});a.check(a.method(this.queue,3,["ptr","ptr"])(this.queue,this.callback.ptr,null),"register recorder callback");this.buffers=Array.from({length:8},()=>new Uint8Array(4096));for(const b of this.buffers)a.check(a.method(this.queue,0,["ptr","u32"])(this.queue,ptr(b),b.length),"enqueue recorder buffer");a.check(a.method(this.record,0,["u32"])(this.record,SL.RECORDSTATE_RECORDING),"start recorder");}
  filled(){if(this.closed)return;const b=this.buffers.shift();this.controller.enqueue(new Uint8Array(b));this.buffers.push(b);try{this.api.check(this.api.method(this.queue,0,["ptr","u32"])(this.queue,ptr(b),b.length),"re-enqueue recorder buffer");}catch(e){this.controller.error(e);this.close();}}
  kill(){this.close();}
  close(){if(this.closed)return;this.closed=true;try{this.api.method(this.record,0,["u32"])(this.record,SL.RECORDSTATE_STOPPED);}catch{}try{this.api.method(this.queue,1,[])(this.queue);}catch{}try{this.api.method(this.recorder,6,[],"void")(this.recorder);}catch{}try{this.api.method(this.engine,6,[],"void")(this.engine);}catch{}try{this.controller.close();}catch{}this.callback?.close();this.resolveExit(0);}
}

class OpenSLESPlayer {
  constructor(api,spec){
    this.api=api;this.spec=spec;this.pending=[];this.inflight=[];this.drainWaiters=[];this.closed=false;this.keep=[];
    let resolve;this.exited=new Promise(r=>resolve=r);this.resolveExit=resolve;
    this.create();
    this.stdin={write:data=>this.write(data),end:()=>this.close()};
  }
  create(){const a=this.api;
    const engine=outPointer();a.check(a.lib.symbols.slCreateEngine(engine.p,0,null,0,null,null),"create engine");this.engine=engine.get();a.check(a.method(this.engine,0,["u32"])(this.engine,SL.FALSE),"realize engine");
    const engineItf=outPointer();a.check(a.method(this.engine,3,["ptr","ptr"])(this.engine,a.iids.ENGINE,engineItf.p),"get engine interface");this.engineItf=engineItf.get();
    const mix=outPointer();a.check(a.method(this.engineItf,7,["ptr","u32","ptr","ptr"])(this.engineItf,mix.p,0,null,null),"create output mix");this.mix=mix.get();a.check(a.method(this.mix,0,["u32"])(this.mix,SL.FALSE),"realize output mix");

    const locator=struct(8,v=>{v.setUint32(0,SL.DATALOCATOR_BUFFERQUEUE,true);v.setUint32(4,8,true);});
    const channels=Math.max(1,Math.min(this.spec.channels,2));
    const pcm=struct(28,v=>{v.setUint32(0,SL.DATAFORMAT_PCM,true);v.setUint32(4,channels,true);v.setUint32(8,this.spec.rate*1000,true);v.setUint32(12,16,true);v.setUint32(16,16,true);v.setUint32(20,channels===1?SL.SPEAKER_FRONT_CENTER:SL.SPEAKER_FRONT_LEFT|SL.SPEAKER_FRONT_RIGHT,true);v.setUint32(24,SL.BYTEORDER_LITTLEENDIAN,true);});
    const source=struct(PW*2,v=>{setPointer(v,0,ptr(locator));setPointer(v,PW,ptr(pcm));});
    const mixLocator=struct(align(4)+PW,v=>{v.setUint32(0,SL.DATALOCATOR_OUTPUTMIX,true);setPointer(v,align(4),this.mix);});
    const sink=struct(PW*2,v=>{setPointer(v,0,ptr(mixLocator));setPointer(v,PW,0);});
    const ids=pointerArray(1);ids[0]=P64?BigInt(a.iids.BUFFERQUEUE):a.iids.BUFFERQUEUE;const required=new Uint32Array([SL.TRUE]);
    this.keep.push(locator,pcm,source,mixLocator,sink,ids,required);
    const player=outPointer();a.check(a.method(this.engineItf,2,["ptr","ptr","ptr","u32","ptr","ptr"])(this.engineItf,player.p,ptr(source),ptr(sink),1,ptr(ids),ptr(required)),"create player");this.player=player.get();a.check(a.method(this.player,0,["u32"])(this.player,SL.FALSE),"realize player");
    const play=outPointer();a.check(a.method(this.player,3,["ptr","ptr"])(this.player,a.iids.PLAY,play.p),"get play interface");this.play=play.get();
    const queue=outPointer();a.check(a.method(this.player,3,["ptr","ptr"])(this.player,a.iids.BUFFERQUEUE,queue.p),"get buffer queue");this.queue=queue.get();
    this.callback=new JSCallback(()=>this.consumed(),{args:["ptr","ptr"],returns:"void",threadsafe:true});
    a.check(a.method(this.queue,3,["ptr","ptr"])(this.queue,this.callback.ptr,null),"register buffer callback");
    a.check(a.method(this.play,0,["u32"])(this.play,SL.PLAYSTATE_PLAYING),"start player");
  }
  write(data){if(this.closed)return 0;const converted=toS16LE(data,this.spec.format);if(converted.length){this.pending.push(converted);this.fill();}return data.length;}
  fill(){while(!this.closed&&this.inflight.length<8&&this.pending.length){const b=this.pending.shift();const r=this.api.method(this.queue,0,["ptr","u32"])(this.queue,ptr(b),b.length);this.api.check(r,"enqueue audio");this.inflight.push(b);}}
  consumed(){if(this.closed)return;this.inflight.shift();this.fill();if(!this.pending.length&&!this.inflight.length)for(const done of this.drainWaiters.splice(0))done();}
  drain(){if(this.closed||(!this.pending.length&&!this.inflight.length))return Promise.resolve();return new Promise(resolve=>this.drainWaiters.push(resolve));}
  kill(){this.close();}
  close(){if(this.closed)return;this.closed=true;for(const done of this.drainWaiters.splice(0))done();try{this.api.method(this.play,0,["u32"])(this.play,SL.PLAYSTATE_STOPPED);}catch{}try{this.api.method(this.queue,1,[])(this.queue);}catch{}try{this.api.method(this.player,6,[],"void")(this.player);}catch{}try{this.api.method(this.mix,6,[],"void")(this.mix);}catch{}try{this.api.method(this.engine,6,[],"void")(this.engine);}catch{}this.callback?.close();this.pending=[];this.inflight=[];this.resolveExit(0);}
}

function alaw(x){x^=0x55;let t=(x&15)<<4,seg=(x&112)>>4;t+=8;if(seg>=1)t+=0x100;if(seg>1)t<<=seg-1;return (x&128)?t:-t;}
function ulaw(x){x=~x&255;let t=((x&15)<<3)+0x84;t<<=(x&112)>>4;return (x&128)?0x84-t:t-0x84;}
export function toS16LE(input,format){const b=input instanceof Uint8Array?input:new Uint8Array(input);if(format===3)return new Uint8Array(b);let bytes=[1,1,1,2,2,4,4,4,4,4,4,3,3][format]||0;if(!bytes)throw new Error(`OpenSL ES unsupported Pulse sample format ${format}`);const n=Math.floor(b.length/bytes),out=new Uint8Array(n*2),o=new DataView(out.buffer),v=new DataView(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<n;i++){let x,p=i*bytes;switch(format){case 0:x=(b[p]-128)<<8;break;case 1:x=alaw(b[p]);break;case 2:x=ulaw(b[p]);break;case 4:x=v.getInt16(p,false);break;case 5:x=Math.max(-1,Math.min(1,v.getFloat32(p,true)))*32767;break;case 6:x=Math.max(-1,Math.min(1,v.getFloat32(p,false)))*32767;break;case 7:x=v.getInt32(p,true)>>16;break;case 8:x=v.getInt32(p,false)>>16;break;case 9:x=v.getInt32(p,true)>>8;break;case 10:x=v.getInt32(p,false)>>8;break;case 11:x=((b[p]|b[p+1]<<8|b[p+2]<<16)<<8)>>16;break;case 12:x=((b[p+2]|b[p+1]<<8|b[p]<<16)<<8)>>16;break;}o.setInt16(i*2,Math.max(-32768,Math.min(32767,x)),true);}return out;}

export async function createOpenSLESBackend(){return OpenSLESBackend.open();}
