// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {MIX_SPEC,Mixer} from "../lib/mixer.js";

function fakeSinks(){const sinks=[];return {sinks,open:spec=>{const sink={spec,written:[],closed:false,write(b){sink.written.push(...new Int16Array(b.buffer,b.byteOffset,b.length/2));},ready:()=>Promise.resolve(),latencyUsec:()=>0,close(){sink.closed=true;}};sinks.push(sink);return sink;}};}
const s16=(...x)=>new Uint8Array(Int16Array.from(x).buffer);

describe("software mixer",()=>{
  test("sums streams of different formats into one sink",async()=>{const f=fakeSinks(),mixer=new Mixer(f.open),a=mixer.add({format:3,rate:48000,channels:2}),b=mixer.add({format:5,rate:48000,channels:1});expect(f.sinks.length).toBe(1);expect(f.sinks[0].spec).toEqual(MIX_SPEC);a.stdin.write(s16(1000,-1000,1000,-1000));b.stdin.write(new Uint8Array(Float32Array.of(.5,.5).buffer));await Bun.sleep(5);expect(f.sinks[0].written).toEqual([17383,15383,17383,15383]);mixer.close();});
  test("clips instead of wrapping",async()=>{const f=fakeSinks(),mixer=new Mixer(f.open),a=mixer.add(MIX_SPEC),b=mixer.add(MIX_SPEC);a.stdin.write(s16(30000,-30000));b.stdin.write(s16(30000,-30000));await Bun.sleep(5);expect(f.sinks[0].written).toEqual([32767,-32768]);mixer.close();});
  test("pads a stream that is short of data with silence",async()=>{const f=fakeSinks(),mixer=new Mixer(f.open),a=mixer.add(MIX_SPEC),b=mixer.add(MIX_SPEC);b.stdin.write(s16(5,5));a.stdin.write(s16(1,1,2,2));await Bun.sleep(5);expect(f.sinks[0].written).toEqual([6,6,2,2]);mixer.close();});
  test("releases the device when the last stream closes and reopens it on demand",async()=>{const f=fakeSinks(),mixer=new Mixer(f.open),a=mixer.add(MIX_SPEC),b=mixer.add(MIX_SPEC);a.close();expect(f.sinks[0].closed).toBeFalse();b.close();expect(f.sinks[0].closed).toBeTrue();await b.exited;const c=mixer.add(MIX_SPEC);c.stdin.write(s16(7,7));await Bun.sleep(5);expect(f.sinks.length).toBe(2);expect(f.sinks[1].written).toEqual([7,7]);mixer.close();});
  test("paces clients and drains",async()=>{const f=fakeSinks(),mixer=new Mixer(f.open),a=mixer.add(MIX_SPEC);let ready=false;a.ready().then(()=>ready=true);await Bun.sleep(1);expect(ready).toBeTrue();a.stdin.write(s16(...Array(2*4800).fill(1)));expect(await Promise.race([a.drain().then(()=>"drained"),Bun.sleep(200).then(()=>"timeout")])).toBe("drained");expect(f.sinks[0].written.length).toBe(9600);mixer.close();});
});
