// SPDX-License-Identifier: LGPL-2.1-or-later

export function parseTone(value=""){
  const match=/^(?:(\d+(?:\.\d+)?))?(?:x(-1|\d+(?:\.\d+)?))?$/.exec(value);
  if(!match||(!match[1]&&value&&!value.startsWith("x")))throw new Error("--play expects FREQUENCY or FREQUENCYxSECONDS");
  const frequency=match[1]?Number(match[1]):432,duration=match[2]?Number(match[2]):3;
  if(!Number.isFinite(frequency)||frequency<20||frequency>20000)throw new Error("tone frequency must be from 20 to 20000 Hz");
  if(!Number.isFinite(duration)||(duration!==-1&&(duration<=0||duration>3600)))throw new Error("tone duration must be -1, or greater than 0 and at most 3600 seconds");
  return {frequency,duration};
}

export function sineChunk(frequency,startFrame,frames,rate=48000,amplitude=0.2){
  const data=new Uint8Array(frames*2),view=new DataView(data.buffer);
  for(let i=0;i<frames;i++)view.setInt16(i*2,Math.round(Math.sin((startFrame+i)*frequency*2*Math.PI/rate)*32767*amplitude),true);
  return data;
}

export async function playTone(backend,{frequency,duration}){
  const rate=48000,chunkFrames=2048,total=duration===-1?Infinity:Math.ceil(duration*rate),player=backend.openPlayback({format:3,rate,channels:1});
  let frame=0,stopped=false;
  const stop=()=>{stopped=true;backend.close(player);};
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
  try{
    while(!stopped&&frame<total){const frames=Math.min(chunkFrames,total-frame),data=sineChunk(frequency,frame,frames,rate);await player.stdin.write(data);if(player.stdin.flush)await player.stdin.flush();if(player.drain)await player.drain();frame+=frames;}
    if(!stopped){if(player.drain)await player.drain();player.stdin.end();if(!player.drain)await player.exited;}
  }finally{process.off("SIGINT",stop);process.off("SIGTERM",stop);await backend.shutdown();}
}
