// SPDX-License-Identifier: LGPL-2.1-or-later
// libc discovery for Android, glibc Linux, and Buninu/musl Linux.
import {dlopen} from "bun:ffi";
import {existsSync} from "node:fs";

const architectures={
  x64:{musl:"x86_64",gnu:"x86_64-linux-gnu",bits:64},
  arm64:{musl:"aarch64",gnu:"aarch64-linux-gnu",bits:64},
  arm:{musl:"arm",gnu:"arm-linux-gnueabihf",bits:32},
  ia32:{musl:"i386",gnu:"i386-linux-gnu",bits:32},
};

export function libcCandidates(arch=process.arch,exists=existsSync){
  const a=architectures[arch];
  if(!a)throw new Error(`unsupported CPU architecture ${arch}`);
  const android=a.bits===64?"lib64":"lib";
  const paths=[
    `/lib/libc.musl-${a.musl}.so.1`,
    `/lib/${a.gnu}/libc.so.6`,
    `/usr/lib/${a.gnu}/libc.so.6`,
    "/lib64/libc.so.6",
    "/lib/libc.so.6",
    `/apex/com.android.runtime/${android}/bionic/libc.so`,
    `/system/${android}/libc.so`,
  ];
  return [...new Set(paths)].filter(exists);
}

export function openLibc(symbols){
  const candidates=libcCandidates(),errors=[];
  if(!candidates.length)throw new Error("no supported libc file exists on this system");
  for(const name of candidates)try{return {library:dlopen(name,symbols),path:name};}catch(error){errors.push(`${name}: ${error.message}`);}
  throw new Error(`unable to load libc; tried:\n${errors.join("\n")}`);
}
