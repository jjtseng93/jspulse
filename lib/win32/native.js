// SPDX-License-Identifier: LGPL-2.1-or-later
import {dlopen,ptr} from "bun:ffi";

export const POINTER_SIZE=process.arch==="x64"||process.arch==="arm64"?8:4;
export const HEADER_SIZE=POINTER_SIZE===8?48:32;
export const WAVE_MAPPER=0xffffffff,WHDR_DONE=1;

export function openWinmm(){return dlopen("winmm.dll",{
  waveOutOpen:{args:["ptr","u32","ptr","ptr","ptr","u32"],returns:"u32"},waveOutPrepareHeader:{args:["ptr","ptr","u32"],returns:"u32"},waveOutUnprepareHeader:{args:["ptr","ptr","u32"],returns:"u32"},waveOutWrite:{args:["ptr","ptr","u32"],returns:"u32"},waveOutReset:{args:["ptr"],returns:"u32"},waveOutClose:{args:["ptr"],returns:"u32"},
  waveInOpen:{args:["ptr","u32","ptr","ptr","ptr","u32"],returns:"u32"},waveInPrepareHeader:{args:["ptr","ptr","u32"],returns:"u32"},waveInUnprepareHeader:{args:["ptr","ptr","u32"],returns:"u32"},waveInAddBuffer:{args:["ptr","ptr","u32"],returns:"u32"},waveInStart:{args:["ptr"],returns:"u32"},waveInStop:{args:["ptr"],returns:"u32"},waveInReset:{args:["ptr"],returns:"u32"},waveInClose:{args:["ptr"],returns:"u32"},
});}
export function check(code,operation){if(code!==0)throw new Error(`${operation} failed (MMRESULT ${code})`);}
export function waveFormat(spec){if(spec.format!==3)throw new Error(`Win32 waveform backend requires s16le (format 3), got ${spec.format}`);const b=new Uint8Array(18),v=new DataView(b.buffer),align=spec.channels*2;v.setUint16(0,1,true);v.setUint16(2,spec.channels,true);v.setUint32(4,spec.rate,true);v.setUint32(8,spec.rate*align,true);v.setUint16(12,align,true);v.setUint16(14,16,true);return b;}
export function readHandle(b){const v=new DataView(b.buffer);return POINTER_SIZE===8?Number(v.getBigUint64(0,true)):v.getUint32(0,true);}
export function waveHeader(data){const header=new Uint8Array(HEADER_SIZE),v=new DataView(header.buffer),address=ptr(data);if(POINTER_SIZE===8)v.setBigUint64(0,BigInt(address),true);else v.setUint32(0,address,true);v.setUint32(POINTER_SIZE,data.byteLength,true);return header;}
