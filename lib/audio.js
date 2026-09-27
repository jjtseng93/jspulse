// pa_sample_format_t values, kept in protocol order.
const formats = ["U8","A_LAW","MU_LAW","S16_LE","S16_BE","FLOAT_LE","FLOAT_BE","S32_LE","S32_BE","S24_LE","S24_BE","S24_3LE","S24_3BE","U20_LE","U20_BE","U20_3LE","U20_3BE"];
const which = name => Bun.which(name);

class ProcessBackend {
  constructor(mode){this.mode=mode;this.children=new Set();}
  openPlayback(spec){
    const fmt=formats[spec.format];
    if(!fmt) throw new Error(`unsupported sample format ${spec.format}`);
    let cmd;
    if(this.mode==="alsa") {
      const exe=which("aplay"); if(!exe) throw new Error("--alsa requires aplay (alsa-utils)");
      cmd=[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    } else {
      // Android's tinyplay reaches the Audio HAL/OpenSL output path without PulseAudio.
      const exe=which("tinyplay")||which("aplay"); if(!exe) throw new Error("--sles requires tinyplay (or aplay fallback)");
      cmd=exe.endsWith("tinyplay")?[exe,"-","-r",String(spec.rate),"-c",String(spec.channels),"-b",String(fmt.includes("16")?16:32)]:[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    }
    const p=Bun.spawn(cmd,{stdin:"pipe",stdout:"ignore",stderr:"inherit"});this.children.add(p);p.exited.finally(()=>this.children.delete(p));return p;
  }
  openRecord(spec){
    const fmt=formats[spec.format];
    if(!fmt) throw new Error(`unsupported sample format ${spec.format}`);
    let cmd;
    if(this.mode==="alsa") {
      const exe=which("arecord"); if(!exe) throw new Error("recording requires arecord (alsa-utils)");
      cmd=[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    } else {
      const exe=which("tinycap")||which("arecord"); if(!exe) throw new Error("--sles recording requires tinycap (or arecord fallback)");
      cmd=exe.endsWith("tinycap")?[exe,"-","-r",String(spec.rate),"-c",String(spec.channels),"-b",String(fmt.includes("16")?16:32)]:[exe,"-q","-t","raw","-f",fmt,"-r",String(spec.rate),"-c",String(spec.channels),"-"];
    }
    const p=Bun.spawn(cmd,{stdin:"ignore",stdout:"pipe",stderr:"inherit"});this.children.add(p);p.exited.finally(()=>this.children.delete(p));return p;
  }
  close(p){try{p.stdin.end();}catch{} try{p.kill();}catch{}}
  async shutdown(){for(const p of this.children)this.close(p);await Promise.allSettled([...this.children].map(p=>p.exited));}
}

export async function createBackend(mode){return new ProcessBackend(mode);}
