// SPDX-License-Identifier: LGPL-2.1-or-later
// JavaScript port created in 2026 by Dr. John (醫者小智), based on
// PulseAudio protocol-native.c and pstream.c (Lennart Poettering,
// Pierre Ossman, and other PulseAudio contributors). Modified for Bun.
import net from "node:net";
import os from "node:os";
import { Reader, Writer, command } from "./tagstruct.js";

const PACKET=0xffffffff, INVALID=0xffffffff, VERSION=8;
const C={ERROR:0,REPLY:2,CREATE_PLAYBACK:3,DELETE_PLAYBACK:4,CREATE_RECORD:5,DELETE_RECORD:6,EXIT:7,AUTH:8,SET_NAME:9,LOOKUP_SINK:10,LOOKUP_SOURCE:11,DRAIN:12,STAT:13,GET_PLAYBACK_LATENCY:14,GET_SERVER:20,GET_SINK:21,GET_SINK_LIST:22,GET_SOURCE:23,GET_SOURCE_LIST:24,SUBSCRIBE:35,SET_SINK_VOLUME:36,SET_SINK_INPUT_VOLUME:37,SET_SOURCE_VOLUME:38,SET_SINK_MUTE:39,SET_SOURCE_MUTE:40,CORK_PLAYBACK:41,FLUSH_PLAYBACK:42,TRIGGER:43,SET_DEFAULT_SINK:44,SET_DEFAULT_SOURCE:45,SET_PLAYBACK_NAME:46,SET_RECORD_NAME:47,GET_RECORD_LATENCY:57,CORK_RECORD:58,FLUSH_RECORD:59,PREBUF:60,REQUEST:61,OVERFLOW:62,UNDERFLOW:63};
const defaultSpec={format:3,channels:2,rate:44100}; // s16le

function frame(channel,payload,offset=0n,flags=0){const h=new Uint8Array(20),d=new DataView(h.buffer);d.setUint32(0,payload.length);d.setUint32(4,channel>>>0);d.setUint32(8,Number(BigInt(offset)>>32n));d.setUint32(12,Number(BigInt(offset)&0xffffffffn));d.setUint32(16,flags);return [h,payload];}
function deviceInfo(w,name,desc,isSource=false){w.u32(0).string(name).string(desc).sample(defaultSpec).map(2).u32(INVALID).cvolume(2).bool(false).u32(INVALID).string(null).usec(0).string("jspulse").u32(isSource?1:1);}

class Client {
  constructor(socket,backend){this.socket=socket;this.backend=backend;this.buf=Buffer.alloc(0);this.streams=new Map();this.next=1;socket.on("data",x=>this.feed(x));socket.on("close",()=>this.close());socket.on("error",()=>{});}
  send(channel,payload,offset=0n,flags=0){for(const p of frame(channel,payload,offset,flags))this.socket.write(p);}
  packet(w){this.send(PACKET,w.finish());}
  reply(tag,fill){const w=command(C.REPLY,tag);fill?.(w);this.packet(w);}
  error(tag,code=3){const w=command(C.ERROR,tag).u32(code);this.packet(w);}
  feed(chunk){this.buf=Buffer.concat([this.buf,chunk]);while(this.buf.length>=20){const n=this.buf.readUInt32BE(0);if(n>16*1024*1024){this.socket.destroy();return;}if(this.buf.length<20+n)return;const channel=this.buf.readUInt32BE(4),flags=this.buf.readUInt32BE(16),body=this.buf.subarray(20,20+n);this.buf=this.buf.subarray(20+n);try{channel===PACKET?this.onPacket(body):this.onAudio(channel,body,flags);}catch(e){console.error(`jspulse: protocol error: ${e.stack||e.message}`);this.socket.destroy();return;}}}
  onPacket(body){const r=new Reader(body),cmd=r.u32(),tag=r.u32();
    switch(cmd){
      case C.AUTH:{r.u32();const cookie=r.arbitrary();if(cookie.length!==256)throw new Error("invalid auth cookie");this.reply(tag,w=>w.u32(VERSION));break;}
      case C.SET_NAME:r.string();this.reply(tag);break;
      case C.GET_SERVER:this.reply(tag,w=>w.string("jspulse").string("0.1").string(process.env.USER||"termux").string(os.hostname()).sample(defaultSpec).string("jspulse_sink").string("jspulse_source").u32(0));break;
      case C.LOOKUP_SINK:case C.LOOKUP_SOURCE:r.string();this.reply(tag,w=>w.u32(0));break;
      case C.GET_SINK:case C.GET_SOURCE:r.u32();r.string();this.reply(tag,w=>deviceInfo(w,cmd===C.GET_SINK?"jspulse_sink":"jspulse_source",cmd===C.GET_SINK?"JS Pulse output":"JS Pulse input",cmd===C.GET_SOURCE));break;
      case C.GET_SINK_LIST:case C.GET_SOURCE_LIST:this.reply(tag,w=>deviceInfo(w,cmd===C.GET_SINK_LIST?"jspulse_sink":"jspulse_source",cmd===C.GET_SINK_LIST?"JS Pulse output":"JS Pulse input",cmd===C.GET_SOURCE_LIST));break;
      case C.CREATE_PLAYBACK:this.createPlayback(tag,r);break;
      case C.CREATE_RECORD:this.createRecord(tag,r);break;
      case C.DELETE_PLAYBACK:{const id=r.u32(),s=this.streams.get(id);if(s)this.backend.close(s.process);this.streams.delete(id);this.reply(tag);break;}
      case C.DELETE_RECORD:{const id=r.u32(),s=this.streams.get(id);if(s)this.backend.close(s.process);this.streams.delete(id);this.reply(tag);break;}
      case C.GET_PLAYBACK_LATENCY:this.playbackLatency(tag,r);break;
      case C.DRAIN:{const id=r.u32(),s=this.streams.get(id),drained=s?.process?.drain?.();drained?.then(()=>this.reply(tag),()=>this.error(tag));if(!drained)this.reply(tag);break;}
      case C.CORK_PLAYBACK:case C.FLUSH_PLAYBACK:case C.TRIGGER:case C.PREBUF:{r.u32();if(cmd===C.CORK_PLAYBACK)r.bool();this.reply(tag);break;}
      case C.SUBSCRIBE:r.u32();this.reply(tag);break;
      case C.SET_DEFAULT_SINK:case C.SET_DEFAULT_SOURCE:r.string();this.reply(tag);break;
      case C.EXIT:this.reply(tag);this.socket.end();break;
      default:this.error(tag,19);
    }
  }
  createPlayback(tag,r){r.string();const spec=r.sample();r.map();r.u32();r.string();let maxlength=r.u32();const corked=r.bool();let tlength=r.u32();r.u32();r.u32();r.u32();r.cvolume();if(!r.eof)throw new Error("unexpected playback fields");
    const process=this.openStream(tag,"playback",spec);if(!process)return;const id=this.next++;maxlength=maxlength===INVALID?262144:maxlength;tlength=tlength===INVALID?65536:tlength;const request=Math.min(maxlength,tlength,65536);this.streams.set(id,{process,spec,corked,offset:0n,request});this.reply(tag,w=>w.u32(id).u32(id).u32(request));
  }
  // A backend failure (e.g. the ALSA device is busy) is a per-stream error, not a protocol error that drops the connection.
  openStream(tag,kind,spec){try{return kind==="playback"?this.backend.openPlayback(spec):this.backend.openRecord(spec);}catch(e){console.error(`jspulse: cannot open ${kind} stream: ${e.message}`);this.error(tag,e.errno===16?26:10);return null;}}
  createRecord(tag,r){r.string();const spec=r.sample();r.map();r.u32();r.string();r.u32();const corked=r.bool();r.u32();if(!r.eof)throw new Error("unexpected record fields");const process=this.openStream(tag,"record",spec);if(!process)return;const id=this.next++,s={process,spec,corked,offset:0n,record:true};this.streams.set(id,s);this.reply(tag,w=>w.u32(id).u32(id));if(!corked)this.pumpRecord(id,s);}
  async pumpRecord(id,s){try{const reader=s.process.stdout.getReader();while(this.streams.get(id)===s){const {done,value}=await reader.read();if(done)break;if(value?.length){this.send(id,value,s.offset,0);s.offset+=BigInt(value.length);}}}catch{}finally{if(this.streams.get(id)===s)this.streams.delete(id);}}
  // Only ask the client for more once the backend has room, so its clock follows real playback.
  onAudio(id,body){const s=this.streams.get(id);if(!s)return;try{const pending=s.process.stdin.write(body);if(pending?.catch)pending.catch(()=>this.streams.delete(id));s.offset+=BigInt(body.length);Promise.resolve(s.process.ready?.()).then(()=>{if(this.streams.get(id)===s&&!this.socket.destroyed)this.request(id,body.length);});}catch{this.streams.delete(id);}}
  // Reply layout from protocol-native.c command_get_playback_latency (protocol version < 13).
  playbackLatency(tag,r){const id=r.u32(),sent=r.timeval();if(!r.eof)throw new Error("unexpected latency fields");const s=this.streams.get(id);if(!s||s.record){this.error(tag,5);return;}const now=Date.now()*1000;this.reply(tag,w=>w.usec(s.process.latencyUsec?.()??0).usec(0).bool(true).timeval(sent).timeval({sec:Math.floor(now/1e6),usec:now%1e6}).s64(s.offset).s64(s.offset));}
  request(id,n){const w=command(C.REQUEST,INVALID).u32(id).u32(n);this.packet(w);}
  close(){for(const s of this.streams.values())this.backend.close(s.process);this.streams.clear();}
}

export class PulseServer {
  constructor({backend,host="127.0.0.1",port=4713}){this.backend=backend;this.host=host;this.port=port;this.clients=new Set();this.server=net.createServer(s=>{const client=new Client(s,backend);this.clients.add(client);s.on("close",()=>this.clients.delete(client));});}
  listen(){return new Promise((ok,no)=>{this.server.once("error",no);this.server.listen(this.port,this.host,()=>{this.server.off("error",no);ok();});});}
  // net.Server.close() waits for open connections, and Pulse clients such as Chromium never hang up on their own.
  async close(){const closed=new Promise(ok=>this.server.close(ok));for(const client of this.clients){client.close();client.socket.destroy();}await closed;await this.backend.shutdown();}
}
