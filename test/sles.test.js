// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {toS16LE} from "../lib/sles.js";

describe("OpenSL ES PCM conversion",()=>{
  test("passes s16le through",()=>expect([...toS16LE(Uint8Array.of(1,2,3,4),3)]).toEqual([1,2,3,4]));
  test("converts unsigned 8 bit",()=>expect([...toS16LE(Uint8Array.of(0,128,255),0)]).toEqual([0,128,0,0,0,127]));
  test("converts big endian s16",()=>expect([...toS16LE(Uint8Array.of(0x12,0x34,0xfe,0xdc),4)]).toEqual([0x34,0x12,0xdc,0xfe]));
  test("clips float32",()=>{const a=new Float32Array([-2,-.5,.5,2]);const x=toS16LE(new Uint8Array(a.buffer),5),v=new DataView(x.buffer);expect([v.getInt16(0,true),v.getInt16(2,true),v.getInt16(4,true),v.getInt16(6,true)]).toEqual([-32767,-16383,16383,32767]);});
});
