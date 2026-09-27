// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {makeHwParams} from "../lib/alsa-pcm.js";

describe("direct ALSA PCM parameters",()=>{
  test("builds s16le stereo 48 kHz kernel parameters",()=>{const p=makeHwParams(3,48000,2),v=new DataView(p.bytes.buffer);p.apply();expect(p.sampleBytes).toBe(2);expect(v.getUint32(4,true)).toBe(8);expect(v.getUint32(36,true)).toBe(4);expect(v.getUint32(260+(10-8)*12,true)).toBe(2);expect(v.getUint32(260+(11-8)*12,true)).toBe(48000);expect(v.getUint32(520,true)).toBe(0xffffffff);});
  test("rejects unsupported Pulse formats",()=>expect(()=>makeHwParams(99,48000,2)).toThrow());
});
