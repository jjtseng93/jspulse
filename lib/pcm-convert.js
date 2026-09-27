// SPDX-License-Identifier: LGPL-2.1-or-later
// PulseAudio sample format, channel count, and rate conversion through s16le.
// G.711 conversion follows Sun Microsystems' g711.c (provided for unrestricted use; see NOTICE.md).
export const SAMPLE_BYTES=[1,1,1,2,2,4,4,4,4,3,3,4,4];

function alaw(x){x^=0x55;let t=(x&15)<<4,seg=(x&112)>>4;t+=8;if(seg>=1)t+=0x100;if(seg>1)t<<=seg-1;return (x&128)?t:-t;}
function ulaw(x){x=~x&255;let t=((x&15)<<3)+0x84;t<<=(x&112)>>4;return (x&128)?0x84-t:t-0x84;}
function toAlaw(x){x>>=3;let mask=0xd5;if(x<0){mask=0x55;x=-x-1;}let seg=0;while(seg<8&&x>=(0x20<<seg))seg++;if(seg>=8)return 0x7f^mask;return ((seg<<4)|((seg<2?x>>1:x>>seg)&15))^mask;}
function toUlaw(x){let sign=0;if(x<0){sign=0x80;x=-x;}x=Math.min(x,32635)+0x84;let exp=7;for(let m=0x4000;!(x&m)&&exp>0;m>>=1)exp--;return ~(sign|exp<<4|((x>>(exp+3))&15))&255;}

export function toS16LE(input,format){const b=input instanceof Uint8Array?input:new Uint8Array(input);if(format===3)return new Uint8Array(b);const bytes=SAMPLE_BYTES[format]||0;if(!bytes)throw new Error(`unsupported Pulse sample format ${format}`);const n=Math.floor(b.length/bytes),out=new Uint8Array(n*2),o=new DataView(out.buffer),v=new DataView(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<n;i++){let x,p=i*bytes;switch(format){case 0:x=(b[p]-128)<<8;break;case 1:x=alaw(b[p]);break;case 2:x=ulaw(b[p]);break;case 4:x=v.getInt16(p,false);break;case 5:x=Math.max(-1,Math.min(1,v.getFloat32(p,true)))*32767;break;case 6:x=Math.max(-1,Math.min(1,v.getFloat32(p,false)))*32767;break;case 7:x=v.getInt32(p,true)>>16;break;case 8:x=v.getInt32(p,false)>>16;break;case 9:x=((b[p]|b[p+1]<<8|b[p+2]<<16)<<8)>>16;break;case 10:x=((b[p+2]|b[p+1]<<8|b[p]<<16)<<8)>>16;break;case 11:x=(v.getInt32(p,true)<<8)>>16;break;case 12:x=(v.getInt32(p,false)<<8)>>16;break;}o.setInt16(i*2,Math.max(-32768,Math.min(32767,x)),true);}return out;}

export function fromS16LE(input,format){const b=input instanceof Uint8Array?input:new Uint8Array(input);if(format===3)return new Uint8Array(b);const bytes=SAMPLE_BYTES[format]||0;if(!bytes)throw new Error(`unsupported Pulse sample format ${format}`);const n=b.length>>1,out=new Uint8Array(n*bytes),o=new DataView(out.buffer),v=new DataView(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<n;i++){const x=v.getInt16(i*2,true),p=i*bytes;switch(format){case 0:out[p]=(x>>8)+128;break;case 1:out[p]=toAlaw(x);break;case 2:out[p]=toUlaw(x);break;case 4:o.setInt16(p,x,false);break;case 5:o.setFloat32(p,x/32767,true);break;case 6:o.setFloat32(p,x/32767,false);break;case 7:o.setInt32(p,x<<16,true);break;case 8:o.setInt32(p,x<<16,false);break;case 9:out[p]=0;out[p+1]=x&255;out[p+2]=(x>>8)&255;break;case 10:out[p]=(x>>8)&255;out[p+1]=x&255;out[p+2]=0;break;case 11:o.setInt32(p,x<<8,true);break;case 12:o.setInt32(p,x<<8,false);break;}}return out;}

// Streaming converter: keeps partial input frames and linear-resampler state between calls.
export class PcmConverter {
  constructor(from,to){this.from=from;this.to=to;this.frameBytes=SAMPLE_BYTES[from.format]*from.channels;this.rest=new Uint8Array(0);this.prev=null;this.pos=0;}
  process(input){
    let b=input instanceof Uint8Array?input:new Uint8Array(input);if(this.rest.length){const x=new Uint8Array(this.rest.length+b.length);x.set(this.rest);x.set(b,this.rest.length);b=x;}
    const usable=b.length-b.length%this.frameBytes;this.rest=b.slice(usable);
    const fc=this.from.channels,tc=this.to.channels,src=new Int16Array(toS16LE(b.subarray(0,usable),this.from.format).buffer),frames=src.length/fc;
    let mapped=src;if(fc!==tc){mapped=new Int16Array(frames*tc);for(let f=0;f<frames;f++)for(let c=0;c<tc;c++){if(tc===1){let sum=0;for(let k=0;k<fc;k++)sum+=src[f*fc+k];mapped[f]=Math.round(sum/fc);}else mapped[f*tc+c]=src[f*fc+c%fc];}}
    if(this.from.rate!==this.to.rate){const buf=this.prev?new Int16Array(this.prev.length+mapped.length):mapped;if(this.prev){buf.set(this.prev);buf.set(mapped,this.prev.length);}const n=buf.length/tc,step=this.from.rate/this.to.rate,out=[];while(this.pos+1<n){const i=Math.floor(this.pos),t=this.pos-i;for(let c=0;c<tc;c++)out.push(Math.round(buf[i*tc+c]*(1-t)+buf[(i+1)*tc+c]*t));this.pos+=step;}if(n){this.prev=buf.slice((n-1)*tc);this.pos-=n-1;}mapped=Int16Array.from(out);}
    return fromS16LE(new Uint8Array(mapped.buffer,mapped.byteOffset,mapped.byteLength),this.to.format);
  }
}
