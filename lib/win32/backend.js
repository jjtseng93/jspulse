// SPDX-License-Identifier: LGPL-2.1-or-later
import {Mixer} from "../mixer.js";
import {openWinmm} from "./native.js";
import {WaveOutSink} from "./wave-out.js";
import {WaveInSource} from "./wave-in.js";
export class Win32WaveBackend{
  constructor(){if(process.platform!=="win32")throw new Error("the Win32 backend is only available on Windows");this.native=openWinmm();this.streams=new Set();this.mixer=new Mixer(spec=>new WaveOutSink(this.native,spec));}
  openPlayback(spec){const stream=this.mixer.add(spec);this.streams.add(stream);return stream;}
  openRecord(spec){const stream=new WaveInSource(this.native,spec);this.streams.add(stream);return stream;}
  close(stream){stream?.kill?.();stream?.close?.();this.streams.delete(stream);}
  async shutdown(){for(const stream of [...this.streams])this.close(stream);this.mixer.close();this.native.close();}
}
export function createWin32Backend(){return new Win32WaveBackend();}
