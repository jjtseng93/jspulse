// SPDX-License-Identifier: LGPL-2.1-or-later
// Direct ALSA kernel-control UAPI implementation. No libasound or amixer.
import {CFunction,ptr} from "bun:ffi";
import {existsSync} from "node:fs";
import {openLibc} from "./libc.js";

const P64=["arm64","x64"].includes(process.arch), PW=P64?8:4, ID=64;
const sizes=P64?{list:80,info:272,value:1224,valueOffset:72}:{list:72,info:272,value:708,valueOffset:68};
const IOC=(dir,nr,size)=>((dir<<30)|(size<<16)|(0x55<<8)|nr)>>>0;
const IO={CARD:IOC(2,0x01,376),LIST:IOC(3,0x10,sizes.list),INFO:IOC(3,0x11,sizes.info),READ:IOC(3,0x12,sizes.value),WRITE:IOC(3,0x13,sizes.value)};
const TYPE={1:"boolean",2:"integer",3:"enumerated",4:"bytes",5:"iec958",6:"integer64"};
const playback=["Master Playback Volume","PCM Playback Volume","Speaker Playback Volume","Headphone Playback Volume"];
const capture=["Capture Volume","Mic Capture Volume","Internal Mic Capture Volume"];
const dec=new TextDecoder(),enc=new TextEncoder();
const cstring=(b,o,n)=>{let z=o;while(z<o+n&&b[z])z++;return dec.decode(b.subarray(o,z));};
const putPtr=(v,o,p)=>P64?v.setBigUint64(o,BigInt(p),true):v.setUint32(o,Number(p),true);
const putLong=(v,o,n)=>P64?v.setBigInt64(o,BigInt(n),true):v.setInt32(o,Number(n),true);
const getLong=(v,o)=>Number(P64?v.getBigInt64(o,true):v.getInt32(o,true));

function libc(){return openLibc({open:{args:["ptr","i32"],returns:"i32"},close:{args:["i32"],returns:"i32"},ioctl:{args:["i32","u64","ptr"],returns:"i32"}}).library;}

export class AlsaControl {
  constructor(card=0){this.card=Number(card);this.path=`/dev/snd/controlC${this.card}`;this.lib=libc();const p=enc.encode(`${this.path}\0`);this.fd=this.lib.symbols.open(ptr(p),0x80002);if(this.fd<0){this.lib.close();throw new Error(`cannot open ${this.path}`);}this.elements=this.readElements();}
  call(request,data){const r=this.lib.symbols.ioctl(this.fd,BigInt(request),ptr(data));if(r<0)throw new Error(`ALSA ioctl 0x${request.toString(16)} failed on ${this.path}`);return data;}
  cardInfo(){const b=this.call(IO.CARD,new Uint8Array(376));return {card:new DataView(b.buffer).getInt32(0,true),id:cstring(b,8,16),driver:cstring(b,24,16),name:cstring(b,40,32),longName:cstring(b,72,80),mixerName:cstring(b,168,80),components:cstring(b,248,128)};}
  readElements(){const first=this.call(IO.LIST,new Uint8Array(sizes.list)),count=new DataView(first.buffer).getUint32(12,true);if(!count)return[];const ids=new Uint8Array(count*ID),list=new Uint8Array(sizes.list),v=new DataView(list.buffer);v.setUint32(4,count,true);putPtr(v,16,ptr(ids));this.call(IO.LIST,list);const used=v.getUint32(8,true),out=[];for(let i=0;i<used;i++){const id=new Uint8Array(ids.subarray(i*ID,(i+1)*ID)),info=new Uint8Array(sizes.info);info.set(id);this.call(IO.INFO,info);const d=new DataView(info.buffer),type=d.getInt32(64,true),n=d.getUint32(72,true),item={id,numid:d.getUint32(0,true),iface:d.getInt32(4,true),name:cstring(id,16,44),index:d.getUint32(60,true),type,typeName:TYPE[type]||`type-${type}`,access:d.getUint32(68,true),count:n,min:type===1?0:getLong(d,80),max:type===1?1:getLong(d,80+PW),step:type===1?1:getLong(d,80+PW*2)};out.push(item);}return out;}
  read(element){const b=new Uint8Array(sizes.value);b.set(element.id);this.call(IO.READ,b);const d=new DataView(b.buffer),values=[];for(let i=0;i<element.count;i++){const o=sizes.valueOffset+i*(element.type===3?4:element.type===6?8:PW);values.push(element.type===3?d.getUint32(o,true):element.type===6?Number(d.getBigInt64(o,true)):getLong(d,o));}return values;}
  write(element,values){if(!(element.access&2))throw new Error(`${element.name} is read-only`);const b=new Uint8Array(sizes.value);b.set(element.id);const d=new DataView(b.buffer);for(let i=0;i<element.count;i++){const n=values[Math.min(i,values.length-1)],o=sizes.valueOffset+i*(element.type===3?4:element.type===6?8:PW);if(element.type===3)d.setUint32(o,n,true);else if(element.type===6)d.setBigInt64(o,BigInt(n),true);else putLong(d,o,n);}this.call(IO.WRITE,b);}
  choose(kind,explicit,word="Volume"){const names=kind==="playback"?playback:capture;if(explicit){const suffix=kind==="playback"?`Playback ${word}`:`Capture ${word}`,candidates=[explicit,`${explicit} ${suffix}`,`${explicit} ${word}`].map(x=>x.toLowerCase()),e=this.elements.find(x=>candidates.includes(x.name.toLowerCase()));if(!e)throw new Error(`ALSA control not found: ${explicit}`);return e;}for(const name of names.map(x=>x.replace("Volume",word))){const e=this.elements.find(x=>x.name.toLowerCase()===name.toLowerCase());if(e)return e;}const fuzzy=this.elements.find(x=>x.iface===2&&x.name.includes(kind==="playback"?"Playback":"Capture")&&x.name.includes(word));if(fuzzy)return fuzzy;throw new Error(`no ${kind} ${word.toLowerCase()} control; available: ${this.elements.filter(x=>x.iface===2).map(x=>x.name).join(", ")}`);}
  switchFor(volume){const name=volume.name.replace(/Volume$/,"Switch");return this.elements.find(x=>x.name.toLowerCase()===name.toLowerCase())||null;}
  volume(kind,percent,explicit){const e=this.choose(kind,explicit);if(percent==null){const values=this.read(e),p=values.map(x=>Math.round((x-e.min)*100/(e.max-e.min||1))),sw=this.switchFor(e);return {element:e,values,percent:p,switchElement:sw,muted:sw?this.read(sw).every(x=>x===0):null};}if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error("volume must be from 0 to 100");const raw=e.min+Math.round((e.max-e.min)*percent/100/(e.step||1))*(e.step||1);this.write(e,Array(e.count).fill(Math.min(e.max,raw)));const sw=this.switchFor(e);if(sw)this.write(sw,Array(sw.count).fill(1));return this.volume(kind,null,explicit);}
  mute(kind,muted,explicit){const volume=this.choose(kind,explicit),e=this.switchFor(volume);if(!e)throw new Error(`no switch control corresponding to ${volume.name}`);this.write(e,Array(e.count).fill(muted?0:1));return {element:e,muted:this.read(e).every(x=>x===0)};}
  snapshot(){const card=this.cardInfo();return {card,elements:this.elements.filter(e=>e.iface===2).map(e=>({...e,current:(e.access&1)&&[1,2,3,6].includes(e.type)?this.read(e):null,id:undefined}))};}
  close(){if(this.fd>=0){this.lib.symbols.close(this.fd);this.fd=-1;}this.lib.close();}
}

export function availableCards(){const cards=[];for(let i=0;i<32;i++)if(existsSync(`/dev/snd/controlC${i}`))cards.push(i);return cards;}

export function formatAudioInfo(snapshot,zh=false){const c=snapshot.card,lines=zh?[`音效卡 ${c.card}：${c.name}`,`識別碼：${c.id}`,`驅動程式：${c.driver}`,`完整名稱：${c.longName}`,`混音器：${c.mixerName}`,"","混音控制項："]:[`Audio card ${c.card}: ${c.name}`,`ID: ${c.id}`,`Driver: ${c.driver}`,`Long name: ${c.longName}`,`Mixer: ${c.mixerName}`,"","Mixer controls:"];for(const e of snapshot.elements){const range=[1,2,6].includes(e.type)?` ${e.min}..${e.max}${e.step?` step ${e.step}`:""}`:"";const current=e.current?` = [${e.current.join(", ")}]`:"";lines.push(`- ${e.name} (${e.typeName}, ${e.count} ch${range})${current}`);}return lines.join("\n");}
