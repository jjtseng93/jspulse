// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {chooseAtMost,chooseParam,makeHwParams} from "../lib/alsa-pcm.js";

describe("direct ALSA PCM parameters",()=>{
  test("builds s16le stereo 48 kHz kernel parameters",()=>{const p=makeHwParams(3,48000,2),v=new DataView(p.bytes.buffer);p.apply();expect(p.sampleBytes).toBe(2);expect(v.getUint32(4,true)).toBe(8);expect(v.getUint32(36,true)).toBe(4);expect(v.getUint32(260+(10-8)*12,true)).toBe(2);expect(v.getUint32(260+(11-8)*12,true)).toBe(48000);expect(v.getUint32(520,true)).toBe(0xffffffff);});
  test("keeps open non-integer intervals when choosing like the kernel",()=>{const p=makeHwParams(3,48000,2),v=new DataView(p.bytes.buffer),o=260+(12-8)*12;v.setUint32(o,1333,true);v.setUint32(o+4,1334,true);v.setUint32(o+8,3,true);chooseParam(p.bytes,12);expect([v.getUint32(o,true),v.getUint32(o+4,true),v.getUint32(o+8,true)]).toEqual([1333,1334,3]);v.setUint32(o,64,true);v.setUint32(o+4,8192,true);v.setUint32(o+8,4,true);chooseParam(p.bytes,12,true);expect([v.getUint32(o,true),v.getUint32(o+4,true),v.getUint32(o+8,true)]).toEqual([8192,8192,4]);});
  test("bounds the buffer size instead of taking the device maximum",()=>{const p=makeHwParams(3,48000,2),v=new DataView(p.bytes.buffer),o=260+(17-8)*12;v.setUint32(o,64,true);v.setUint32(o+4,786432,true);v.setUint32(o+8,4,true);chooseAtMost(p.bytes,17,4800);expect([v.getUint32(o,true),v.getUint32(o+4,true)]).toEqual([4800,4800]);v.setUint32(o,8192,true);v.setUint32(o+4,786432,true);chooseAtMost(p.bytes,17,4800);expect([v.getUint32(o,true),v.getUint32(o+4,true)]).toEqual([8192,8192]);});
  test("rejects unsupported Pulse formats",()=>expect(()=>makeHwParams(99,48000,2)).toThrow());
});
