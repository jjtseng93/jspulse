// SPDX-License-Identifier: LGPL-2.1-or-later
// JavaScript port created in 2026 by Dr. John (醫者小智), based on
// PulseAudio tagstruct.c, copyright 2004-2006 Lennart Poettering.
const te = new TextEncoder();
const td = new TextDecoder();
const TAG = { STRING: 116, NULL: 78, U32: 76, U8: 66, U64: 82, SAMPLE: 97, ARBITRARY: 120, TRUE: 49, FALSE: 48, USEC: 85, MAP: 109, CVOLUME: 118, VOLUME: 86 };

export class Writer {
  constructor() { this.parts = []; }
  raw(a) { this.parts.push(a instanceof Uint8Array ? a : Uint8Array.from(a)); return this; }
  byte(v) { return this.raw([v & 255]); }
  u32(v) { const b = new Uint8Array(5); b[0]=TAG.U32; new DataView(b.buffer).setUint32(1,v>>>0); return this.raw(b); }
  u8(v) { return this.raw([TAG.U8,v&255]); }
  u64tag(tag,v) { v=BigInt(v); const b=new Uint8Array(9); b[0]=tag; const d=new DataView(b.buffer); d.setUint32(1,Number(v>>32n)); d.setUint32(5,Number(v&0xffffffffn)); return this.raw(b); }
  usec(v) { return this.u64tag(TAG.USEC,v); }
  string(v) { if (v == null) return this.byte(TAG.NULL); return this.byte(TAG.STRING).raw(te.encode(v)).byte(0); }
  arbitrary(v) { const b=v instanceof Uint8Array?v:Uint8Array.from(v); this.byte(TAG.ARBITRARY); const n=new Uint8Array(4); new DataView(n.buffer).setUint32(0,b.length); return this.raw(n).raw(b); }
  bool(v) { return this.byte(v?TAG.TRUE:TAG.FALSE); }
  sample(s) { const b=new Uint8Array(7); b[0]=TAG.SAMPLE;b[1]=s.format;b[2]=s.channels;new DataView(b.buffer).setUint32(3,s.rate);return this.raw(b); }
  map(channels) { this.byte(TAG.MAP).byte(channels); for(let i=0;i<channels;i++) this.byte(i===0?1:i===1?2:0); return this; }
  cvolume(channels, volume=0x10000) { this.byte(TAG.CVOLUME).byte(channels); for(let i=0;i<channels;i++){ const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,volume);this.raw(b); } return this; }
  volume(v=0x10000) { const b=new Uint8Array(5);b[0]=TAG.VOLUME;new DataView(b.buffer).setUint32(1,v);return this.raw(b); }
  finish(){ const n=this.parts.reduce((x,p)=>x+p.length,0), out=new Uint8Array(n);let o=0;for(const p of this.parts){out.set(p,o);o+=p.length;}return out; }
}

export class Reader {
  constructor(data){this.data=data;this.i=0;}
  need(n){if(this.i+n>this.data.length)throw new Error("truncated tagstruct");}
  tag(t){this.need(1);if(this.data[this.i++]!==t)throw new Error("unexpected tag");}
  rawU32(){this.need(4);const v=new DataView(this.data.buffer,this.data.byteOffset+this.i,4).getUint32(0);this.i+=4;return v;}
  u32(){this.tag(TAG.U32);return this.rawU32();}
  string(){this.need(1);if(this.data[this.i]===TAG.NULL){this.i++;return null;}this.tag(TAG.STRING);const z=this.data.indexOf(0,this.i);if(z<0)throw new Error("unterminated string");const s=td.decode(this.data.subarray(this.i,z));this.i=z+1;return s;}
  arbitrary(){this.tag(TAG.ARBITRARY);const n=this.rawU32();this.need(n);const v=this.data.subarray(this.i,this.i+n);this.i+=n;return v;}
  bool(){this.need(1);const v=this.data[this.i++];if(v!==TAG.TRUE&&v!==TAG.FALSE)throw new Error("bad boolean");return v===TAG.TRUE;}
  sample(){this.tag(TAG.SAMPLE);this.need(6);const s={format:this.data[this.i++],channels:this.data[this.i++],rate:this.rawU32()};return s;}
  map(){this.tag(TAG.MAP);this.need(1);const n=this.data[this.i++];this.need(n);this.i+=n;return n;}
  cvolume(){this.tag(TAG.CVOLUME);this.need(1);const n=this.data[this.i++];this.need(n*4);this.i+=n*4;return n;}
  get eof(){return this.i===this.data.length;}
}

export const command = (id,tag) => new Writer().u32(id).u32(tag);
