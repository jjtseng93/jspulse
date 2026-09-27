// SPDX-License-Identifier: LGPL-2.1-or-later
import { describe, expect, test } from "bun:test";
import { Reader, Writer, command } from "../lib/tagstruct.js";

describe("Pulse tagstruct codec", () => {
  test("round trips v8 primitives", () => {
    const data=new Writer().u32(42).string("pulse").string(null).bool(true).sample({format:3,channels:2,rate:48000}).arbitrary(new Uint8Array([1,2,3])).finish();
    const r=new Reader(data);
    expect(r.u32()).toBe(42);expect(r.string()).toBe("pulse");expect(r.string()).toBeNull();expect(r.bool()).toBeTrue();expect(r.sample()).toEqual({format:3,channels:2,rate:48000});expect([...r.arbitrary()]).toEqual([1,2,3]);expect(r.eof).toBeTrue();
  });
  test("command header contains opcode and tag",()=>{const r=new Reader(command(8,99).finish());expect(r.u32()).toBe(8);expect(r.u32()).toBe(99);});
});
