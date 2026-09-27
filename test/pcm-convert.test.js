// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {PcmConverter,fromS16LE,toS16LE} from "../lib/pcm-convert.js";

const s16=(...x)=>new Uint8Array(Int16Array.from(x).buffer),ints=b=>[...new Int16Array(b.buffer,b.byteOffset,b.byteLength/2)];

describe("PCM conversion",()=>{
  test("round-trips every Pulse format through s16le",()=>{for(let format=0;format<13;format++){const back=ints(toS16LE(fromS16LE(s16(0,256,-256,32512,-32768),format),format));const input=[0,256,-256,32512,-32768],tolerance=format===1||format===2?1100:format===5||format===6?2:1;back.forEach((x,i)=>expect(Math.abs(x-input[i])).toBeLessThan(tolerance));}});
  test("decodes packed and padded 24 bit samples",()=>{expect(ints(toS16LE(Uint8Array.of(0,0x34,0x12),9))).toEqual([0x1234]);expect(ints(toS16LE(Uint8Array.of(0,0x34,0x12,0),11))).toEqual([0x1234]);});
  test("converts Chromium float32 mono to s16le stereo and keeps partial frames",()=>{const c=new PcmConverter({format:5,rate:48000,channels:1},{format:3,rate:48000,channels:2}),f=new Uint8Array(Float32Array.of(.5,-.5).buffer);expect(ints(c.process(f.subarray(0,6)))).toEqual([16383,16383]);expect(ints(c.process(f.subarray(6)))).toEqual([-16383,-16383]);});
  test("resamples across calls without dropping frames",()=>{const c=new PcmConverter({format:3,rate:44100,channels:1},{format:3,rate:48000,channels:1});let n=0;for(let i=0;i<100;i++)n+=c.process(s16(...Array(441).fill(1000))).length/2;expect(Math.abs(n-48000)).toBeLessThan(3);});
});
