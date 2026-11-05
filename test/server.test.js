// SPDX-License-Identifier: LGPL-2.1-or-later
import { describe, expect, test } from "bun:test";
import net from "node:net";
import { PulseServer } from "../lib/server.js";
import { Reader, Writer, command } from "../lib/tagstruct.js";

const packet = (w, channel = 0xffffffff) => {
  const body = w.finish(),
    h = Buffer.alloc(20);
  h.writeUInt32BE(body.length, 0);
  h.writeUInt32BE(channel, 4);
  return Buffer.concat([h, Buffer.from(body)]);
};
const audio = (id, bytes) => {
  const h = Buffer.alloc(20);
  h.writeUInt32BE(bytes.length, 0);
  h.writeUInt32BE(id, 4);
  return Buffer.concat([h, Buffer.from(bytes)]);
};

function fakeBackend() {
  const stream = {
    written: 0,
    readyResolvers: [],
    stdin: {
      write(d) {
        stream.written += d.length;
      },
    },
    ready() {
      return new Promise((r) => stream.readyResolvers.push(r));
    },
    latencyUsec: () => 123456,
    exited: Promise.resolve(),
  };
  return {
    stream,
    openPlayback: () => stream,
    close() {},
    async shutdown() {},
  };
}

async function connect(port) {
  const socket = net.connect(port, "127.0.0.1"),
    packets = [];
  let buf = Buffer.alloc(0);
  socket.on("data", (x) => {
    buf = Buffer.concat([buf, x]);
    while (buf.length >= 20 && buf.length >= 20 + buf.readUInt32BE(0)) {
      const n = buf.readUInt32BE(0);
      packets.push(new Reader(new Uint8Array(buf.subarray(20, 20 + n))));
      buf = buf.subarray(20 + n);
    }
  });
  await new Promise((r) => socket.once("connect", r));
  const next = async () => {
    for (let i = 0; i < 200 && !packets.length; i++) await Bun.sleep(5);
    return packets.shift();
  };
  return { socket, packets, next };
}

describe("Pulse server", () => {
  test("paces REQUEST on backend readiness, reports latency, and closes with clients attached", async () => {
    const backend = fakeBackend(),
      server = new PulseServer({ backend, port: 0 });
    await server.listen();
    const { port } = server.server.address(),
      c = await connect(port);
    c.socket.write(
      packet(
        command(3, 1)
          .string("x")
          .sample({ format: 5, channels: 2, rate: 48000 })
          .map(2)
          .u32(0xffffffff)
          .string(null)
          .u32(0xffffffff)
          .bool(false)
          .u32(0xffffffff)
          .u32(0xffffffff)
          .u32(0xffffffff)
          .u32(0xffffffff)
          .cvolume(2),
      ),
    );
    const created = await c.next();
    expect(created.u32()).toBe(2);
    created.u32();
    const id = created.u32();
    c.socket.write(audio(id, new Uint8Array(64)));
    await Bun.sleep(30);
    expect(backend.stream.written).toBe(64);
    expect(c.packets.length).toBe(0);
    backend.stream.readyResolvers.shift()();
    const request = await c.next();
    expect([
      request.u32(),
      request.u32(),
      request.u32(),
      request.u32(),
    ]).toEqual([61, 0xffffffff, id, 64]);
    c.socket.write(packet(command(14, 2).u32(id).timeval({ sec: 1, usec: 2 })));
    const latency = await c.next();
    expect([latency.u32(), latency.u32()]).toEqual([2, 2]);
    expect(latency.data[latency.i]).toBe(85);
    latency.i += 1;
    expect(
      new DataView(
        latency.data.buffer,
        latency.data.byteOffset + latency.i,
        8,
      ).getBigUint64(0),
    ).toBe(123456n);
    await Promise.race([
      server.close(),
      Bun.sleep(1000).then(() => {
        throw new Error("server.close() hung with a client attached");
      }),
    ]);
  });
  test("reports a busy device as a stream error and keeps the connection", async () => {
    const backend = {
        openPlayback() {
          throw Object.assign(new Error("cannot open ALSA PCM (EBUSY)"), {
            errno: 16,
          });
        },
        close() {},
        async shutdown() {},
      },
      server = new PulseServer({ backend, port: 0 });
    await server.listen();
    const c = await connect(server.server.address().port),
      error = console.error;
    console.error = () => {};
    try {
      c.socket.write(
        packet(
          command(3, 7)
            .string("x")
            .sample({ format: 3, channels: 2, rate: 48000 })
            .map(2)
            .u32(0xffffffff)
            .string(null)
            .u32(0xffffffff)
            .bool(false)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .cvolume(2),
        ),
      );
      const reply = await c.next();
      expect([reply.u32(), reply.u32(), reply.u32()]).toEqual([0, 7, 26]);
      expect(c.socket.destroyed).toBeFalse();
    } finally {
      console.error = error;
      await server.close();
    }
  });
});

const auth = (tag, version) =>
  packet(command(8, tag).u32(version).arbitrary(new Uint8Array(256)));
const header = (reply) => [reply.u32(), reply.u32()];

describe("negotiated protocol", () => {
  test("the default server still answers 8 to a current libpulse", async () => {
    const server = new PulseServer({ backend: fakeBackend(), port: 0 });
    await server.listen();
    const c = await connect(server.server.address().port);
    try {
      c.socket.write(auth(1, 35 | 0x80000000));
      const reply = await c.next();
      expect([...header(reply), reply.u32()]).toEqual([2, 1, 8]);
      expect(reply.eof).toBeTrue();
    } finally {
      await server.close();
    }
  });

  test("--protocol 21 serves pa_stream_new_extended in libpulse's layouts", async () => {
    const backend = fakeBackend(),
      specs = [];
    backend.openPlayback = (spec) => (specs.push(spec), backend.stream);
    const server = new PulseServer({ backend, port: 0, protocol: 21 });
    await server.listen();
    const c = await connect(server.server.address().port);
    try {
      // The lower of the two versions, without SHM flags.
      c.socket.write(auth(1, 35 | 0x80000000));
      let reply = await c.next();
      expect([...header(reply), reply.u32()]).toEqual([2, 1, 21]);

      c.socket.write(
        packet(command(9, 2).proplist([["application.name", "mpv"]])),
      );
      reply = await c.next();
      expect(header(reply)).toEqual([2, 2]);
      expect(reply.u32()).not.toBe(0xffffffff);
      expect(reply.eof).toBeTrue();

      c.socket.write(packet(command(20, 3)));
      reply = await c.next();
      expect(header(reply)).toEqual([2, 3]);
      for (let i = 0; i < 4; i++) reply.string();
      reply.sample();
      reply.string();
      reply.string();
      reply.u32();
      expect(reply.channelMap()).toEqual([1, 2]);
      expect(reply.eof).toBeTrue();

      c.socket.write(packet(command(21, 4).u32(0xffffffff).string(null)));
      reply = await c.next();
      expect(header(reply)).toEqual([2, 4]);
      reply.u32();
      reply.string();
      reply.string();
      reply.sample();
      reply.channelMap();
      reply.u32();
      reply.cvolume();
      reply.bool();
      reply.u32();
      reply.string();
      reply.i += 9; // latency usec
      reply.string();
      reply.u32();
      reply.proplist();
      reply.i += 9; // configured latency usec
      reply.i += 5; // base volume
      reply.u32();
      reply.u32();
      reply.u32();
      expect(reply.u32()).toBe(0);
      expect(reply.string()).toBeNull();
      expect(reply.u8()).toBe(1);
      expect(reply.formatInfo().encoding).toBe(1);
      expect(reply.eof).toBeTrue();

      // What pa_stream_connect_playback sends for an extended stream: an invalid
      // sample spec and channel map, with the real format in the list.
      c.socket.write(
        packet(
          command(3, 5)
            .sample({ format: 255, channels: 0, rate: 0 })
            .channelMap([])
            .u32(0xffffffff)
            .string(null)
            .u32(0xffffffff)
            .bool(false)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .u32(0xffffffff)
            .cvolume(32)
            .bool(false).bool(false).bool(false).bool(false)
            .bool(false).bool(false).bool(false)
            .bool(false)
            .bool(true)
            .proplist([["media.name", "audio stream"]])
            .bool(false).bool(false)
            .bool(false).bool(false).bool(false)
            .bool(false)
            .bool(false)
            .u8(1)
            .formatInfo(1, [
              ["format.sample_format", '"float32le"'],
              ["format.rate", "44100"],
              ["format.channels", "1"],
              ["format.channel_map", '"mono"'],
            ]),
        ),
      );
      reply = await c.next();
      expect(header(reply)).toEqual([2, 5]);
      const channel = reply.u32();
      reply.u32();
      const requested = reply.u32();
      expect(requested).toBeGreaterThan(0);
      const attr = [reply.u32(), reply.u32(), reply.u32(), reply.u32()];
      expect(attr[0]).toBeGreaterThanOrEqual(attr[1]);
      expect(reply.sample()).toEqual({ format: 5, channels: 1, rate: 44100 });
      expect(reply.channelMap()).toEqual([0]);
      expect(reply.u32()).not.toBe(0xffffffff);
      expect(reply.string()).toBe("jspulse_sink");
      expect(reply.bool()).toBeFalse();
      reply.i += 9; // configured sink latency usec
      const format = reply.formatInfo();
      expect(format.encoding).toBe(1);
      expect(
        new TextDecoder().decode(format.props.get("format.sample_format")),
      ).toBe('"float32le"\0');
      expect(reply.eof).toBeTrue();
      expect(specs).toEqual([{ format: 5, channels: 1, rate: 44100 }]);

      c.socket.write(
        packet(command(14, 6).u32(channel).timeval({ sec: 1, usec: 2 })),
      );
      reply = await c.next();
      expect(header(reply)).toEqual([2, 6]);
      reply.i += 9 + 9 + 1 + 9 + 9 + 9 + 9; // usec, usec, bool, 2 timevals, 2 s64
      expect(reply.data[reply.i]).toBe(82); // u64 underrun_for
      reply.i += 9;
      expect(reply.data[reply.i]).toBe(82); // u64 playing_for
      reply.i += 9;
      expect(reply.eof).toBeTrue();

      // Once the backend has played everything, one UNDERFLOW, then quiet until more audio.
      backend.stream.latencyUsec = () => 0;
      c.socket.write(audio(channel, new Uint8Array(64)));
      const underflow = await c.next();
      expect([underflow.u32(), underflow.u32(), underflow.u32()]).toEqual([
        63,
        0xffffffff,
        channel,
      ]);
      expect(underflow.eof).toBeTrue();
      await Bun.sleep(80);
      expect(c.packets.length).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("an out-of-range protocol is refused", () => {
    for (const protocol of [7, 36, 21.5])
      expect(
        () => new PulseServer({ backend: fakeBackend(), port: 0, protocol }),
      ).toThrow("protocol version");
  });
});
