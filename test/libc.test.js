// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {libcCandidates} from "../lib/libc.js";

describe("libc discovery",()=>{
  const only=(...present)=>path=>present.includes(path);
  test("prefers an existing Buninu musl copy",()=>{expect(libcCandidates("arm64",only("/lib/libc.musl-aarch64.so.1","/lib/aarch64-linux-gnu/libc.so.6"))).toEqual(["/lib/libc.musl-aarch64.so.1","/lib/aarch64-linux-gnu/libc.so.6"]);});
  test("supports the x64 Buninu filename",()=>{expect(libcCandidates("x64",only("/lib/libc.musl-x86_64.so.1"))).toEqual(["/lib/libc.musl-x86_64.so.1"]);});
  test("ignores paths which do not exist",()=>{expect(libcCandidates("arm64",only("/usr/lib/aarch64-linux-gnu/libc.so.6"))).toEqual(["/usr/lib/aarch64-linux-gnu/libc.so.6"]);});
  test("finds an existing Android bionic file",()=>{expect(libcCandidates("arm64",only("/apex/com.android.runtime/lib64/bionic/libc.so"))).toEqual(["/apex/com.android.runtime/lib64/bionic/libc.so"]);});
});
