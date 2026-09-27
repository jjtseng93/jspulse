// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {parseTone,sineChunk} from "../lib/tone.js";

describe("test tone",()=>{
  test("defaults to 432 Hz for three seconds",()=>expect(parseTone()).toEqual({frequency:432,duration:3}));
  test("parses frequency and seconds separated by x",()=>expect(parseTone("442x0.5")).toEqual({frequency:442,duration:0.5}));
  test("a frequency without duration uses three seconds",()=>expect(parseTone("440")).toEqual({frequency:440,duration:3}));
  test("x-1 plays until interrupted",()=>expect(parseTone("442x-1")).toEqual({frequency:442,duration:-1}));
  test("rejects invalid or unsafe values",()=>{expect(()=>parseTone("440*1")).toThrow();expect(()=>parseTone("10x1")).toThrow();expect(()=>parseTone("440x0")).toThrow();});
  test("generates continuous s16le sine chunks",()=>{const a=sineChunk(432,0,16),b=sineChunk(432,16,16);expect(a.byteLength).toBe(32);expect(b.byteLength).toBe(32);expect([...a]).not.toEqual([...b]);});
});
