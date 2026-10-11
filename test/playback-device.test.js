// SPDX-License-Identifier: LGPL-2.1-or-later
// Opt-in real device test. Writes silence on a separate stream; never replaces
// a running Pulse server. Run natively, e.g. JSPULSE_TEST_BACKEND=sles bun test ...
import {expect,test} from "bun:test";
import {createBackend} from "../lib/audio.js";
import {readPlaybackTiming} from "../lib/playback-timing.js";

const mode=process.env.JSPULSE_TEST_BACKEND;
test.skipIf(!["sles","alsa","win32"].includes(mode))("real output reports queued PCM, completion, and resume after starvation",async()=>{
  const backend=await createBackend(mode);
  let stream;
  try{
    stream=backend.openPlayback({format:3,rate:48000,channels:2});
    stream.stdin.write(new Uint8Array(48000*4*0.4));
    const initial=readPlaybackTiming(stream);
    expect(initial.queuedUsec).toBeGreaterThan(0);
    expect(initial.queuedUsec).toBeLessThanOrEqual(400000);
    const started=performance.now();
    await stream.drain();
    expect(performance.now()-started).toBeGreaterThan(150);
    expect(readPlaybackTiming(stream).queuedUsec).toBe(0);
    await Bun.sleep(100); // no producer data: the media cursor must not advance
    expect(readPlaybackTiming(stream).playing).toBe(false);
    stream.stdin.write(new Uint8Array(48000*4*0.2));
    expect(readPlaybackTiming(stream).queuedUsec).toBeGreaterThan(0);
    await stream.drain();
    expect(readPlaybackTiming(stream).queuedUsec).toBe(0);
  }finally{
    if(stream)backend.close(stream);
    await backend.shutdown();
  }
},10000);
