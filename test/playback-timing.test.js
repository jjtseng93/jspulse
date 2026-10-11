// SPDX-License-Identifier: LGPL-2.1-or-later
import {expect,test} from "bun:test";
import {playbackTiming,readPlaybackTiming,InputTimeline} from "../lib/playback-timing.js";
import {installSlesTiming} from "../lib/sles-timing.js";
import {installWaveOutTiming} from "../lib/wave-out-timing.js";
import {installAlsaTiming} from "../lib/alsa-timing.js";
import {sendPlaybackTiming} from "../lib/server-timing.js";
import {Reader,Writer} from "../lib/tagstruct.js";
import {Mixer,MIX_SPEC} from "../lib/mixer.js";

test("common timing rejects unknown latency rather than advertising zero",()=>{
  expect(playbackTiming(480,48000)).toEqual({queuedUsec:10000,playing:true});
  expect(playbackTiming(0,44100)).toEqual({queuedUsec:0,playing:false});
  for(const queued of [-1,NaN,Infinity])expect(()=>playbackTiming(queued,48000)).toThrow();
  expect(()=>readPlaybackTiming({})).toThrow();
});

test("SLES counts software and device queues and only advances on native completion",async()=>{
  const player={spec:{channels:2,rate:48000},pending:[new Uint8Array(3840)],inflight:[new Uint8Array(15360)],closed:false,
    consumed(){this.inflight.shift();this.inflight.push(...this.pending.splice(0));},
    close(){this.closed=true;this.pending=[];this.inflight=[];}};
  installSlesTiming(player);
  expect(player.timing().queuedUsec).toBe(100000);
  let ready=false;player.ready().then(()=>ready=true);
  await Bun.sleep(20);
  expect(ready).toBe(false);
  expect(player.timing().queuedUsec).toBe(100000); // wall time alone never consumes PCM
  player.consumed();await Promise.resolve();
  expect(ready).toBe(true);
  expect(player.timing().queuedUsec).toBe(20000);
  player.consumed();
  expect(player.timing()).toEqual({queuedUsec:0,playing:false});
  player.pending.push(new Uint8Array(38400));
  const closed=player.ready();player.close();await closed;
});

test("Windows reports only uncompleted wave buffers",()=>{
  const sink={spec:{channels:2,rate:48000},queue:[{data:new Uint8Array(1920),done:false},{data:new Uint8Array(1920),done:false}],
    reap(){while(this.queue[0]?.done)this.queue.shift();}};
  installWaveOutTiming(sink);
  expect(sink.timing().queuedUsec).toBe(20000);
  sink.queue[0].done=true;
  expect(sink.latencyUsec()).toBe(10000);
  sink.queue[0].done=true;
  expect(sink.timing().playing).toBe(false);
});

test.each([true,false])("ALSA uses negotiated rate, software queue, and hardware DELAY (%s-bit64)",is64=>{
  let frames=240,error=0;
  const stream={rate:48000,frameBytes:4,pendingBytes:960,fd:1,closed:false,errno:()=>error,
    native:{symbols:{ioctl(fd,request,bytes){if(error)return -1;const view=new DataView(bytes.buffer);
      if(is64)view.setBigInt64(0,BigInt(frames),true);else view.setInt32(0,frames,true);return 0;}}}};
  installAlsaTiming(stream,{ptr:x=>x,request:123,is64});
  expect(stream.timing().queuedUsec).toBe(10000);
  frames=0;expect(stream.latencyUsec()).toBe(5000);
  error=32;expect(stream.latencyUsec()).toBe(5000); // xrun loses device queue, not pending software data
  error=5;expect(()=>stream.timing()).toThrow("unavailable");
  stream.closed=true;expect(stream.timing()).toEqual({queuedUsec:0,playing:false});
});

test("input timeline never counts silence inserted during another stream's playback",()=>{
  const input=new InputTimeline();input.submit(0,480);input.submit(4800,480);
  expect(input.queued(240)).toBe(720);
  expect(input.queued(2400)).toBe(480);
  expect(input.queued(5040)).toBe(240);
  expect(input.queued(5280)).toBe(0);
});

test("mixed stream drain waits for actual device progress and ignores another stream's tail",async()=>{
  let written=0,played=0;
  const sink={ready:()=>Promise.resolve(),write:bytes=>written+=bytes.length/4,
    timing:()=>playbackTiming(written-played,48000),close(){}};
  const mixer=new Mixer(()=>sink),a=mixer.add(MIX_SPEC),b=mixer.add(MIX_SPEC);
  try{
    a.stdin.write(new Uint8Array(480*4));b.stdin.write(new Uint8Array(4800*4));
    await Bun.sleep(10);
    expect(a.latencyUsec()).toBe(10000);expect(b.latencyUsec()).toBe(100000);
    let drained=false;const job=a.drain().then(()=>drained=true);
    await Bun.sleep(30);expect(drained).toBe(false); // no fixed latency timeout
    played=480;await job;
    expect(a.timing()).toEqual({queuedUsec:0,playing:false});
    expect(b.latencyUsec()).toBe(90000);
    a.stdin.write(new Uint8Array(480*4));await Bun.sleep(10);
    played=2400;expect(a.latencyUsec()).toBe(10000);
    played=5040;expect(a.latencyUsec()).toBe(5000);
    played=written;expect(a.latencyUsec()).toBe(0);
  }finally{mixer.close();}
});

test("one protocol handler reports measured timing on every backend and rejects missing feedback",()=>{
  for(const stream of [
    {timing:()=>({queuedUsec:20000,playing:true})},
    {latencyUsec:()=>20000},
    {timing:()=>({queuedUsec:0,playing:false})},
    {},
  ]){
    let reply,error;
    const client={streams:new Map([[7,{process:stream,offset:9600n}]]),
      reply(tag,fill){const writer=new Writer();fill(writer);reply=writer.finish();},error(tag,code){error=code;}};
    const reader=new Reader(new Writer().u32(7).timeval({sec:1,usec:2}).finish());
    sendPlaybackTiming(client,4,reader);
    if(!stream.timing&&!stream.latencyUsec){expect(error).toBe(19);expect(reply).toBeUndefined();}
    else{
      const expected=readPlaybackTiming(stream);
      expect(Number(new DataView(reply.buffer).getBigUint64(1))).toBe(expected.queuedUsec);
      expect(reply[18]).toBe(expected.playing?49:48);
    }
  }
});
