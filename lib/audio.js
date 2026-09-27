// SPDX-License-Identifier: LGPL-2.1-or-later
export async function createBackend(mode){
  if(mode==="sles") {
    const {createOpenSLESBackend}=await import("./sles.js");
    return createOpenSLESBackend();
  }
  const {AlsaPcmBackend}=await import("./alsa-pcm.js");
  return new AlsaPcmBackend();
}
