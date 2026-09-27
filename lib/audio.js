// pa_sample_format_t values, kept in protocol order.
// SPDX-License-Identifier: LGPL-2.1-or-later
const formats = ["U8","A_LAW","MU_LAW","S16_LE","S16_BE","FLOAT_LE","FLOAT_BE","S32_LE","S32_BE","S24_LE","S24_BE","S24_3LE","S24_3BE","U20_LE","U20_BE","U20_3LE","U20_3BE"];
const which = name => Bun.which(name);

class ProcessBackend {
  constructor(){this.children=new Set();}
  openPlayback(spec){
    const fmt=formats[spec.format];
    if(!fmt) throw new Error(`unsupported sample format ${spec.format}`);
    const exe=which("aplay"); if(!exe) throw new Error("--alsa requires aplay (alsa-utils)");
    const cmd=[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    const p=Bun.spawn(cmd,{stdin:"pipe",stdout:"ignore",stderr:"inherit"});this.children.add(p);p.exited.finally(()=>this.children.delete(p));return p;
  }
  openRecord(spec){
    const fmt=formats[spec.format];
    if(!fmt) throw new Error(`unsupported sample format ${spec.format}`);
    const exe=which("arecord"); if(!exe) throw new Error("recording requires arecord (alsa-utils)");
    const cmd=[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    const p=Bun.spawn(cmd,{stdin:"ignore",stdout:"pipe",stderr:"inherit"});this.children.add(p);p.exited.finally(()=>this.children.delete(p));return p;
  }
  close(p){try{p.stdin.end();}catch{} try{p.kill();}catch{}}
  async shutdown(){for(const p of this.children)this.close(p);await Promise.allSettled([...this.children].map(p=>p.exited));}
}

export async function createBackend(mode){
  if(mode==="sles") {
    const {createOpenSLESBackend}=await import("./sles.js");
    return createOpenSLESBackend();
  }
  return new ProcessBackend();
}
