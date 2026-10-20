import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {selectPcmDevice} from "../lib/alsa-pcm.js";
import {createBackend} from "../lib/audio.js";
const devices=direction=>direction==="playback"
  ? ["/dev/snd/pcmC0D3p","/dev/snd/pcmC10D0p","/dev/snd/pcmC1D0p","/dev/snd/pcmC1D3p"]
  : ["/dev/snd/pcmC2D0c","/dev/snd/pcmC1D0c"];
test("card selection respects direction, exact card and defaults; never falls back",()=>{
  expect(selectPcmDevice("playback",null,devices("playback"))).toBe("/dev/snd/pcmC0D3p");
  expect(selectPcmDevice("playback",1,devices("playback"))).toBe("/dev/snd/pcmC1D0p");
  expect(selectPcmDevice("capture",1,devices("capture"))).toBe("/dev/snd/pcmC1D0c");
  expect(()=>selectPcmDevice("playback",2,devices("playback"))).toThrow("on card 2");
  expect(()=>selectPcmDevice("capture",1,[])).toThrow("capture");
});
test("backend factory passes card, caches the selected PCM and does not open hardware during construction",async()=>{
  let calls=0;
  const backend=await createBackend("alsa",{card:1,devices:direction=>{calls++;return devices(direction);}});
  expect(backend.pcmPath("playback")).toBe("/dev/snd/pcmC1D0p");
  expect(backend.pcmPath("playback")).toBe("/dev/snd/pcmC1D0p");
  expect(backend.pcmPath("capture")).toBe("/dev/snd/pcmC1D0c");
  expect(calls).toBe(2);
  await backend.shutdown();
});
test("CLI rejects missing, negative, fractional and unsafe card numbers",()=>{
  for(const args of [["--card"],["--card","--alsa"],["--card","-1"],["--card","1.5"],["--card","abc"],["--card","9007199254740992"]]){
    const r=Bun.spawnSync([process.execPath,"jspulse.js",...args]);
    expect(r.exitCode).toBe(2);expect(r.stderr.toString()).toContain("non-negative integer");
  }
});
test("both CLI server and tone entry points pass --card to the backend",()=>{
  const dir=mkdtempSync(join(tmpdir(),"jspulse-card-"));
  try{
    const preload=join(dir,"mock.js");
    writeFileSync(preload,`import {mock} from "bun:test";mock.module(${JSON.stringify(new URL("../lib/audio.js",import.meta.url).pathname)},()=>({createBackend:async(mode,options)=>{console.log("SELECTED:"+JSON.stringify({mode,...options}));process.exit(0);}}));`);
    for(const args of [["--alsa","--card","1"],["--alsa","--card","1","--play","440x1"]]){
      const r=Bun.spawnSync([process.execPath,"--preload",preload,"jspulse.js",...args]);
      expect(r.exitCode).toBe(0);expect(r.stdout.toString()).toContain('SELECTED:{"mode":"alsa","card":1}');
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("default backend re-scans devices instead of retaining a removed card",async()=>{
  let current=["/dev/snd/pcmC0D0p"];
  const backend=await createBackend("alsa",{devices:()=>current});
  expect(backend.pcmPath("playback")).toBe("/dev/snd/pcmC0D0p");
  current=["/dev/snd/pcmC1D0p"];
  expect(backend.pcmPath("playback")).toBe("/dev/snd/pcmC1D0p");
  current=[];
  expect(()=>backend.pcmPath("playback")).toThrow("no ALSA playback PCM device found");
  await backend.shutdown();
});

test("CLI rejects card selection on non-ALSA backends before opening hardware",()=>{
  for(const mode of ["--sles","--win32"]){
    const r=Bun.spawnSync([process.execPath,"jspulse.js",mode,"--card","1"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain("--card requires the ALSA backend");
  }
});
