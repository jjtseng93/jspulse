#!/usr/bin/env bun
// SPDX-License-Identifier: LGPL-2.1-or-later
import { PulseServer } from "./lib/server.js";
import { createBackend } from "./lib/audio.js";
import {AlsaControl,availableCards,formatAudioInfo} from "./lib/alsa-control.js";
import {existsSync} from "node:fs";
import {parseTone,playTone} from "./lib/tone.js";
import {availablePcmDevices,describePcmDevice} from "./lib/alsa-pcm.js";

const help=`Usage:
  jspulse --alsa
  jspulse --sles
  jspulse --win32
  jspulse --play [FREQUENCY[xSECONDS]]
  jspulse [--card N] --volume [CONTROL] [0-100]
  jspulse [--card N] --mic-volume [CONTROL] [0-100]

Audio server:
  --alsa                       Use the direct ALSA kernel PCM backend
  --sles                       Use the native Android OpenSL ES backend
  --win32                      Use native Windows waveform audio (Win32 API)
  --play [FREQUENCY[xSECONDS]] Play a sine tone (default: 432 Hz for 3 seconds;
                               x-1 plays until Ctrl-C)

ALSA mixer:
  --volume [CONTROL] [0-100]   Read or set playback volume
  --mic-volume [CONTROL] [0-100]
                               Read or set capture volume
  --mute [CONTROL]             Mute playback
  --unmute [CONTROL]           Unmute playback
  --mic-mute [CONTROL]         Mute capture
  --mic-unmute [CONTROL]       Unmute capture
  --card N                     Select ALSA card (default: 0)
  --playback-control NAME      Select the full playback control name
  --capture-control NAME       Select the full capture control name
  --audio-info                 Show ALSA card and control information
  --audio-info-zh              Show it in Traditional Chinese

Information:
  -h, --help                   Show this help and exit
  --readme                     Render README.md in the terminal and exit

Set PULSE_SERVER=127.0.0.1 for PulseAudio clients. Numeric volumes are
percentages; setting one automatically unmutes the corresponding switch.
Volume and mute options control the ALSA hardware mixer and do not apply to
Android; use the Android system volume there.`;

const argv=process.argv.slice(2),options={card:null};
for(let i=0;i<argv.length;i++){
  const a=argv[i],next=argv[i+1];
  if(a==="-h"||a==="--help")options.help=true;
  else if(a==="--readme")options.readme=true;
  else if(a==="--alsa"||a==="--sles"||a==="--win32")options.mode=a.slice(2);
  else if(a==="--play"){options.play=next!=null&&!next.startsWith("--")?argv[++i]:"";}
  else if(a==="--card")options.card=Number(argv[++i]);
  else if(a==="--playback-control")options.playbackControl=argv[++i];
  else if(a==="--capture-control")options.captureControl=argv[++i];
  else if(a==="--volume"||a==="--mic-volume"){
    const key=a==="--volume"?"volume":"micVolume",controlKey=a==="--volume"?"playbackControl":"captureControl";
    if(next==null||next.startsWith("--"))options[key]=null;
    else if(Number.isFinite(Number(next))){options[key]=Number(next);i++;}
    else {options[controlKey]=next;i++;const value=argv[i+1];if(value==null||value.startsWith("--"))options[key]=null;else if(Number.isFinite(Number(value))){options[key]=Number(value);i++;}else {console.error(`${a}: expected a volume from 0 to 100 after ${next}`);process.exit(2);}}
  }
  else if(a==="--mute"||a==="--unmute"){options.mute=a==="--mute";if(next!=null&&!next.startsWith("--")){options.playbackControl=next;i++;}}
  else if(a==="--mic-mute"||a==="--mic-unmute"){options.micMute=a==="--mic-mute";if(next!=null&&!next.startsWith("--")){options.captureControl=next;i++;}}
  else if(a==="--audio-info"||a==="--audio-info-zh")options.info=a.endsWith("-zh")?"zh":"en";
  else {console.error(`Unknown option: ${a}`);process.exit(2);}
}

if(options.help){console.log(help);process.exit(0);}
if(options.readme){process.stdout.write(Bun.markdown.ansi(await Bun.file(new URL("./README.md",import.meta.url)).text(),{hyperlinks:true}));process.exit(0);}
if("play" in options)try{options.tone=parseTone(options.play);}catch(error){console.error(error.message);process.exit(2);}

const mixerRequested=options.info||"volume" in options||"micVolume" in options||"mute" in options||"micMute" in options;
if(options.mode==="sles"&&mixerRequested){console.error("ALSA mixer options cannot be used with --sles");process.exit(2);}
const showVolume=r=>`${r.element.name}: ${r.percent.join("%, ")}%${r.muted==null?"":` (${r.muted?"muted":"unmuted"})`}`;
if(mixerRequested){const infoOnly=options.info&&!("volume" in options)&&!("micVolume" in options)&&!("mute" in options)&&!("micMute" in options),cards=options.card==null&&infoOnly?availableCards():[options.card??0];if(!cards.length){console.error("No ALSA control devices found");process.exit(1);}for(const card of cards){let ctl;try{ctl=new AlsaControl(card);if(options.info)console.log(formatAudioInfo(ctl.snapshot(),options.info==="zh"));if("volume" in options)console.log(showVolume(ctl.volume("playback",options.volume,options.playbackControl)));if("micVolume" in options)console.log(showVolume(ctl.volume("capture",options.micVolume,options.captureControl)));if("mute" in options){const r=ctl.mute("playback",options.mute,options.playbackControl);console.log(`${r.element.name}: ${r.muted?"muted":"unmuted"}`);}if("micMute" in options){const r=ctl.mute("capture",options.micMute,options.captureControl);console.log(`${r.element.name}: ${r.muted?"muted":"unmuted"}`);}}finally{ctl?.close();}}
}

const mode=options.mode;
if(options.tone){const androidAudio=(existsSync("/system/lib64/libOpenSLES.so")||existsSync("/system/lib/libOpenSLES.so"))&&(existsSync("/system/bin/linker64")||existsSync("/system/bin/linker")),toneMode=mode||(process.platform==="win32"?"win32":androidAudio?"sles":availablePcmDevices("playback").length?"alsa":null);if(!toneMode){console.error("--play requires a Windows, Android OpenSL ES, or ALSA PCM device");process.exit(1);}console.log(`jspulse: playing ${options.tone.frequency} Hz${options.tone.duration===-1?" until Ctrl-C":` for ${options.tone.duration} seconds`} via ${toneMode}`);if(toneMode==="alsa"&&!("mute" in options)){const card=options.card??Number(availablePcmDevices("playback")[0].match(/pcmC(\d+)/)[1]);let ctl;try{ctl=new AlsaControl(card);try{ctl.mute("playback",false,options.playbackControl);}catch(error){console.error(`jspulse: cannot unmute playback: ${error.message}`);}console.log(showVolume(ctl.volume("playback",null,options.playbackControl)));}catch(error){console.error(`jspulse: cannot read playback volume: ${error.message}`);}finally{ctl?.close();}}await playTone(await createBackend(toneMode),options.tone);process.exit(0);}
if(!mode){if(mixerRequested)process.exit(0);console.error("Usage: jspulse --alsa | --sles | --win32 | --play [FREQUENCY[xSECONDS]] | --audio-info[-zh]\nRun 'jspulse --help' or 'jspulse -h' for complete usage.");process.exit(2);}

const backend = await createBackend(mode);
const server = new PulseServer({ backend, host: "127.0.0.1", port: 4713 });
await server.listen();
if(mode==="alsa")for(const direction of ["playback","capture"]){const devices=availablePcmDevices(direction);if(!devices.length)console.log(`jspulse: no ALSA ${direction} PCM device found`);for(const path of devices)console.log(`jspulse: ${direction} ${path}: ${describePcmDevice(path)}`);}
console.log(`jspulse: ${mode} source/sink ready on 127.0.0.1:4713 (anonymous)`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
