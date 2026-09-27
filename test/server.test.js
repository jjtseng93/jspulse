// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";
import net from "node:net";
import {PulseServer} from "../lib/server.js";
import {Reader,Writer,command} from "../lib/tagstruct.js";

const packet=(w,channel=0xffffffff)=>{const body=w.finish(),h=Buffer.alloc(20);h.writeUInt32BE(body.length,0);h.writeUInt32BE(channel,4);return Buffer.concat([h,Buffer.from(body)]);};
const audio=(id,bytes)=>{const h=Buffer.alloc(20);h.writeUInt32BE(bytes.length,0);h.writeUInt32BE(id,4);return Buffer.concat([h,Buffer.from(bytes)]);};

function fakeBackend(){const stream={written:0,readyResolvers:[],stdin:{write(d){stream.written+=d.length;}},ready(){return new Promise(r=>stream.readyResolvers.push(r));},latencyUsec:()=>123456,exited:Promise.resolve()};return {stream,openPlayback:()=>stream,close(){},async shutdown(){}};}

async function connect(port){const socket=net.connect(port,"127.0.0.1"),packets=[];let buf=Buffer.alloc(0);socket.on("data",x=>{buf=Buffer.concat([buf,x]);while(buf.length>=20&&buf.length>=20+buf.readUInt32BE(0)){const n=buf.readUInt32BE(0);packets.push(new Reader(new Uint8Array(buf.subarray(20,20+n))));buf=buf.subarray(20+n);}});await new Promise(r=>socket.once("connect",r));const next=async()=>{for(let i=0;i<200&&!packets.length;i++)await Bun.sleep(5);return packets.shift();};return {socket,packets,next};}

describe("Pulse server",()=>{
  test("paces REQUEST on backend readiness, reports latency, and closes with clients attached",async()=>{
    const backend=fakeBackend(),server=new PulseServer({backend,port:0});await server.listen();const {port}=server.server.address(),c=await connect(port);
    c.socket.write(packet(command(3,1).string("x").sample({format:5,channels:2,rate:48000}).map(2).u32(0xffffffff).string(null).u32(0xffffffff).bool(false).u32(0xffffffff).u32(0xffffffff).u32(0xffffffff).u32(0xffffffff).cvolume(2)));
    const created=await c.next();expect(created.u32()).toBe(2);created.u32();const id=created.u32();
    c.socket.write(audio(id,new Uint8Array(64)));await Bun.sleep(30);expect(backend.stream.written).toBe(64);expect(c.packets.length).toBe(0);
    backend.stream.readyResolvers.shift()();const request=await c.next();expect([request.u32(),request.u32(),request.u32(),request.u32()]).toEqual([61,0xffffffff,id,64]);
    c.socket.write(packet(command(14,2).u32(id).timeval({sec:1,usec:2})));const latency=await c.next();expect([latency.u32(),latency.u32()]).toEqual([2,2]);expect(latency.data[latency.i]).toBe(85);latency.i+=1;expect(new DataView(latency.data.buffer,latency.data.byteOffset+latency.i,8).getBigUint64(0)).toBe(123456n);
    await Promise.race([server.close(),Bun.sleep(1000).then(()=>{throw new Error("server.close() hung with a client attached");})]);
  });
  test("reports a busy device as a stream error and keeps the connection",async()=>{
    const backend={openPlayback(){throw Object.assign(new Error("cannot open ALSA PCM (EBUSY)"),{errno:16});},close(){},async shutdown(){}},server=new PulseServer({backend,port:0});await server.listen();const c=await connect(server.server.address().port),error=console.error;console.error=()=>{};
    try{c.socket.write(packet(command(3,7).string("x").sample({format:3,channels:2,rate:48000}).map(2).u32(0xffffffff).string(null).u32(0xffffffff).bool(false).u32(0xffffffff).u32(0xffffffff).u32(0xffffffff).u32(0xffffffff).cvolume(2)));const reply=await c.next();expect([reply.u32(),reply.u32(),reply.u32()]).toEqual([0,7,26]);expect(c.socket.destroyed).toBeFalse();}finally{console.error=error;await server.close();}
  });
});
