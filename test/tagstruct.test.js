// SPDX-License-Identifier: LGPL-2.1-or-later
import { describe, expect, test } from "bun:test";
import { Reader, Writer, command } from "../lib/tagstruct.js";

describe("Pulse tagstruct codec", () => {
  test("round trips v8 primitives", () => {
    const data=new Writer().u32(42).string("pulse").string(null).bool(true).sample({format:3,channels:2,rate:48000}).arbitrary(new Uint8Array([1,2,3])).finish();
    const r=new Reader(data);
    expect(r.u32()).toBe(42);expect(r.string()).toBe("pulse");expect(r.string()).toBeNull();expect(r.bool()).toBeTrue();expect(r.sample()).toEqual({format:3,channels:2,rate:48000});expect([...r.arbitrary()]).toEqual([1,2,3]);expect(r.eof).toBeTrue();
  });
  test("round trips timeval and writes s64",()=>{const w=new Writer().timeval({sec:12,usec:34}).s64(-1).finish(),r=new Reader(w.subarray(0,9));expect(r.timeval()).toEqual({sec:12,usec:34});expect([...w.subarray(9)]).toEqual([114,255,255,255,255,255,255,255,255]);});
  test("command header contains opcode and tag",()=>{const r=new Reader(command(8,99).finish());expect(r.u32()).toBe(8);expect(r.u32()).toBe(99);});
});
