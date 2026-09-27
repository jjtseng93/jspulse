// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import {AlsaControl,formatAudioInfo} from "../lib/alsa-control.js";

const snapshot={card:{card:0,id:"PCH",driver:"snd_hda_intel",name:"Built-in Audio",longName:"Built-in Audio at 0",mixerName:"Realtek"},elements:[{name:"Master Playback Volume",typeName:"integer",type:2,count:2,min:0,max:87,step:1,current:[70,70]},{name:"Capture Switch",typeName:"boolean",type:1,count:2,min:0,max:1,step:1,current:[1,1]}]};

describe("ALSA audio information",()=>{
  test("formats English output",()=>{const s=formatAudioInfo(snapshot,false);expect(s).toContain("Audio card 0: Built-in Audio");expect(s).toContain("Master Playback Volume");});
  test("formats Traditional Chinese output",()=>{const s=formatAudioInfo(snapshot,true);expect(s).toContain("音效卡 0：Built-in Audio");expect(s).toContain("混音控制項：");});
});

describe("ALSA mixer controls",()=>{
  test("expands a short playback control name",()=>{const ctl=Object.create(AlsaControl.prototype);ctl.elements=[{iface:2,name:"Master Playback Volume"}];expect(ctl.choose("playback","Master").name).toBe("Master Playback Volume");});
  test("expands a short capture control name",()=>{const ctl=Object.create(AlsaControl.prototype);ctl.elements=[{iface:2,name:"Mic Capture Volume"}];expect(ctl.choose("capture","Mic").name).toBe("Mic Capture Volume");});
  test("a numeric volume automatically unmutes its switch",()=>{const ctl=Object.create(AlsaControl.prototype),volume={iface:2,name:"Master Playback Volume",count:2,min:0,max:100,step:1},toggle={iface:2,name:"Master Playback Switch",count:2};ctl.elements=[volume,toggle];ctl.values=new Map([[volume,[20,20]],[toggle,[0,0]]]);ctl.read=e=>ctl.values.get(e);ctl.write=(e,v)=>ctl.values.set(e,v);const result=ctl.volume("playback",0,"Master");expect(result.percent).toEqual([0,0]);expect(ctl.values.get(toggle)).toEqual([1,1]);});
});
