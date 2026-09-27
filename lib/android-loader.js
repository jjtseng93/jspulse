// SPDX-License-Identifier: LGPL-2.1-or-later AND NCSA
// JavaScript port created in 2026 by Dr. John (醫者小智), based on the
// NCSA-licensed Termux libandroid-stub/platform-ns.c implementation.
// Standalone port of Termux libandroid-stub/platform-ns.c. It gives a Bun
// process outside an APK linker access to Android platform libraries without
// requiring Termux, $PREFIX, or libandroid-stub at runtime.
import {CFunction,dlopen,ptr} from "bun:ffi";
import {readFileSync} from "node:fs";

const P64=["arm64","x64"].includes(process.arch), PT=P64?"u64":"u32", RTLD_NOW=2, RTLD_GLOBAL=0x100, USE_NAMESPACE=0x200n;
const keep=[];
const cstr=s=>{const b=new TextEncoder().encode(`${s}\0`);keep.push(b);return ptr(b);};
const fn=(address,args,returns=PT)=>new CFunction({ptr:address,args,returns});

export function openAndroidPlatformLibrary(path){
  const libdl=dlopen("libdl.so",{
    dlopen:{args:["ptr","i32"],returns:PT},dlsym:{args:["ptr","ptr"],returns:PT},dlclose:{args:["ptr"],returns:"i32"},
    android_dlopen_ext:{args:["ptr","i32","ptr"],returns:PT},
  });
  const dlhandle=libdl.symbols.dlopen(cstr("libdl.so"),RTLD_NOW);
  const sym=name=>libdl.symbols.dlsym(dlhandle,cstr(name));
  const createPtr=sym("__loader_android_create_namespace"),linkPtr=sym("__loader_android_link_namespaces"),linkAllPtr=sym("__loader_android_link_namespaces_all_libs"),getPtr=sym("__loader_android_get_exported_namespace");
  let ns=null;
  const dynamic=[];
  if(createPtr&&linkPtr&&linkAllPtr&&getPtr){
    const create=fn(createPtr,["ptr","ptr","ptr","u64","ptr","ptr","ptr"]),link=fn(linkPtr,["ptr","ptr","ptr"],"bool"),linkAll=fn(linkAllPtr,["ptr","ptr"],"bool"),get=fn(getPtr,["ptr"]);dynamic.push(create,link,linkAll,get);
    const dirs=P64?"/system/lib64:/system/system_ext/lib64":"/system/lib:/system/system_ext/lib";
    ns=create(cstr("jspulse-platform"),cstr(dirs),cstr(dirs),0n,null,null,sym("dlopen"));
    if(ns&&link(ns,null,cstr("libc.so:libm.so:libdl.so:liblog.so"))){
      const names=new Set(["system","runtime","sphal","vndk","com_android_art","com_android_media"]);
      for(const file of ["/linkerconfig/ld.config.txt","/system/etc/ld.config.txt"])try{for(const line of readFileSync(file,"utf8").split("\n")){const m=/^namespace\.([^.]+)\.visible\s*=\s*true/.exec(line);if(m)names.add(m[1]);}}catch{}
      for(const name of names){const platform=get(cstr(name));if(platform)try{linkAll(ns,platform);}catch{}}
    }else ns=null;
  }
  let handle=null;
  if(ns){const info=new Uint8Array(P64?48:40),v=new DataView(info.buffer);v.setBigUint64(0,USE_NAMESPACE,true);if(P64)v.setBigUint64(40,BigInt(ns),true);else v.setUint32(32,Number(ns),true);handle=libdl.symbols.android_dlopen_ext(cstr(path),RTLD_NOW|RTLD_GLOBAL,ptr(info));keep.push(info);}
  if(!handle)handle=libdl.symbols.dlopen(cstr(path),RTLD_NOW|RTLD_GLOBAL);
  if(!handle){for(const f of dynamic)f.close();libdl.close();throw new Error(`Android linker could not load ${path}`);}
  return {
    symbol(name){const p=libdl.symbols.dlsym(handle,cstr(name));if(!p)throw new Error(`${path} does not export ${name}`);return p;},
    close(){libdl.symbols.dlclose(handle);for(const f of dynamic)f.close();libdl.close();},
  };
}
