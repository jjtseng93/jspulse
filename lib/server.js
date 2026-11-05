// SPDX-License-Identifier: LGPL-2.1-or-later
// JavaScript port created in 2026 by Dr. John (醫者小智), based on
// PulseAudio protocol-native.c and pstream.c (Lennart Poettering,
// Pierre Ossman, and other PulseAudio contributors). Modified for Bun.
import net from "node:net";
import os from "node:os";
import { Reader, Writer, command } from "./tagstruct.js";
import { sendPlaybackTiming } from "./server-timing.js";
import { readPlaybackTiming } from "./playback-timing.js";
import {
  ENCODING_PCM,
  defaultChannelMap,
  pcmFormatEntries,
  pcmFromFormats,
} from "./format-info.js";
import { SAMPLE_BYTES } from "./pcm-convert.js";

const PACKET = 0xffffffff,
  INVALID = 0xffffffff;
// The default stays the long-advertised v8; --protocol opts a server into newer layouts.
export const PROTOCOL_VERSION = 8,
  MAX_PROTOCOL_VERSION = 35;
// pa_tagstruct version word: the low 16 bits are the version, the high bits SHM/memfd flags (never set here).
const VERSION_MASK = 0xffff;
const C = {
  ERROR: 0,
  REPLY: 2,
  CREATE_PLAYBACK: 3,
  DELETE_PLAYBACK: 4,
  CREATE_RECORD: 5,
  DELETE_RECORD: 6,
  EXIT: 7,
  AUTH: 8,
  SET_NAME: 9,
  LOOKUP_SINK: 10,
  LOOKUP_SOURCE: 11,
  DRAIN: 12,
  STAT: 13,
  GET_PLAYBACK_LATENCY: 14,
  GET_SERVER: 20,
  GET_SINK: 21,
  GET_SINK_LIST: 22,
  GET_SOURCE: 23,
  GET_SOURCE_LIST: 24,
  SUBSCRIBE: 35,
  SET_SINK_VOLUME: 36,
  SET_SINK_INPUT_VOLUME: 37,
  SET_SOURCE_VOLUME: 38,
  SET_SINK_MUTE: 39,
  SET_SOURCE_MUTE: 40,
  CORK_PLAYBACK: 41,
  FLUSH_PLAYBACK: 42,
  TRIGGER: 43,
  SET_DEFAULT_SINK: 44,
  SET_DEFAULT_SOURCE: 45,
  SET_PLAYBACK_NAME: 46,
  SET_RECORD_NAME: 47,
  GET_RECORD_LATENCY: 57,
  CORK_RECORD: 58,
  FLUSH_RECORD: 59,
  PREBUF: 60,
  REQUEST: 61,
  OVERFLOW: 62,
  UNDERFLOW: 63,
};
const defaultSpec = { format: 3, channels: 2, rate: 48000 }; // s16le; matches the ALSA mixer sink so clients such as Chromium need no resampling
const defaultMap = defaultChannelMap(defaultSpec.channels);

const bytesToUsec = (bytes, spec) =>
  Math.floor(
    (bytes * 1e6) / ((SAMPLE_BYTES[spec.format] ?? 2) * spec.channels * spec.rate),
  );

function frame(channel, payload, offset = 0n, flags = 0) {
  const h = new Uint8Array(20),
    d = new DataView(h.buffer);
  d.setUint32(0, payload.length);
  d.setUint32(4, channel >>> 0);
  d.setUint32(8, Number(BigInt(offset) >> 32n));
  d.setUint32(12, Number(BigInt(offset) & 0xffffffffn));
  d.setUint32(16, flags);
  return [h, payload];
}
// Layout from introspect.c context_get_{sink,source}_info_callback; later fields by protocol version.
function deviceInfo(w, name, desc, isSource = false, version = PROTOCOL_VERSION) {
  w.u32(0)
    .string(name)
    .string(desc)
    .sample(defaultSpec)
    .map(2)
    .u32(INVALID)
    .cvolume(2)
    .bool(false)
    .u32(INVALID)
    .string(null)
    .usec(0)
    .string("jspulse")
    .u32(isSource ? 1 : 1);
  if (version >= 13) w.proplist().usec(0);
  // base volume, state (RUNNING), volume steps, card
  if (version >= 15) w.volume().u32(0).u32(0x10001).u32(INVALID);
  // no ports, so no active port
  if (version >= 16) w.u32(0).string(null);
  if (version >= (isSource ? 22 : 21)) w.u8(1).formatInfo(ENCODING_PCM);
}

class Client {
  constructor(socket, backend, { protocol = PROTOCOL_VERSION, index = 0 } = {}) {
    this.socket = socket;
    this.backend = backend;
    this.maxVersion = protocol;
    this.version = PROTOCOL_VERSION;
    this.index = index;
    this.buf = Buffer.alloc(0);
    this.streams = new Map();
    this.next = 1;
    socket.on("data", (x) => this.feed(x));
    socket.on("close", () => this.close());
    socket.on("error", () => {});
  }
  send(channel, payload, offset = 0n, flags = 0) {
    for (const p of frame(channel, payload, offset, flags))
      this.socket.write(p);
  }
  packet(w) {
    this.send(PACKET, w.finish());
  }
  reply(tag, fill) {
    const w = command(C.REPLY, tag);
    fill?.(w);
    this.packet(w);
  }
  error(tag, code = 3) {
    const w = command(C.ERROR, tag).u32(code);
    this.packet(w);
  }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 20) {
      const n = this.buf.readUInt32BE(0);
      if (n > 16 * 1024 * 1024) {
        this.socket.destroy();
        return;
      }
      if (this.buf.length < 20 + n) return;
      const channel = this.buf.readUInt32BE(4),
        flags = this.buf.readUInt32BE(16),
        body = this.buf.subarray(20, 20 + n);
      this.buf = this.buf.subarray(20 + n);
      try {
        channel === PACKET
          ? this.onPacket(body)
          : this.onAudio(channel, body, flags);
      } catch (e) {
        console.error(`jspulse: protocol error: ${e.stack || e.message}`);
        this.socket.destroy();
        return;
      }
    }
  }
  onPacket(body) {
    const r = new Reader(body),
      cmd = r.u32(),
      tag = r.u32();
    switch (cmd) {
      case C.AUTH: {
        // Both ends then use the lower version; libpulse rejects anything below 8.
        const requested = r.u32() & VERSION_MASK;
        const cookie = r.arbitrary();
        if (cookie.length !== 256) throw new Error("invalid auth cookie");
        this.version = Math.max(
          PROTOCOL_VERSION,
          Math.min(requested, this.maxVersion),
        );
        this.reply(tag, (w) => w.u32(this.version));
        break;
      }
      case C.SET_NAME:
        if (this.version >= 13) r.proplist();
        else r.string();
        this.reply(tag, (w) => this.version >= 13 && w.u32(this.index));
        break;
      case C.GET_SERVER:
        this.reply(tag, (w) => {
          w.string("jspulse")
            .string("0.1")
            .string(process.env.USER || "termux")
            .string(os.hostname())
            .sample(defaultSpec)
            .string("jspulse_sink")
            .string("jspulse_source")
            .u32(0);
          if (this.version >= 15) w.channelMap(defaultMap);
        });
        break;
      case C.LOOKUP_SINK:
      case C.LOOKUP_SOURCE:
        r.string();
        this.reply(tag, (w) => w.u32(0));
        break;
      case C.GET_SINK:
      case C.GET_SOURCE:
        r.u32();
        r.string();
        this.reply(tag, (w) =>
          deviceInfo(
            w,
            cmd === C.GET_SINK ? "jspulse_sink" : "jspulse_source",
            cmd === C.GET_SINK ? "JS Pulse output" : "JS Pulse input",
            cmd === C.GET_SOURCE,
            this.version,
          ),
        );
        break;
      case C.GET_SINK_LIST:
      case C.GET_SOURCE_LIST:
        this.reply(tag, (w) =>
          deviceInfo(
            w,
            cmd === C.GET_SINK_LIST ? "jspulse_sink" : "jspulse_source",
            cmd === C.GET_SINK_LIST ? "JS Pulse output" : "JS Pulse input",
            cmd === C.GET_SOURCE_LIST,
            this.version,
          ),
        );
        break;
      case C.CREATE_PLAYBACK:
        this.createPlayback(tag, r);
        break;
      case C.CREATE_RECORD:
        this.createRecord(tag, r);
        break;
      case C.DELETE_PLAYBACK: {
        const id = r.u32(),
          s = this.streams.get(id);
        stopUnderflow(s);
        if (s) this.backend.close(s.process);
        this.streams.delete(id);
        this.reply(tag);
        break;
      }
      case C.DELETE_RECORD: {
        const id = r.u32(),
          s = this.streams.get(id);
        if (s) this.backend.close(s.process);
        this.streams.delete(id);
        this.reply(tag);
        break;
      }
      case C.GET_PLAYBACK_LATENCY:
        this.playbackLatency(tag, r);
        break;
      case C.DRAIN: {
        const id = r.u32(),
          s = this.streams.get(id),
          drained = s?.process?.drain?.();
        drained?.then(
          () => this.reply(tag),
          () => this.error(tag),
        );
        if (!drained) this.reply(tag);
        break;
      }
      case C.CORK_PLAYBACK:
      case C.FLUSH_PLAYBACK:
      case C.TRIGGER:
      case C.PREBUF: {
        r.u32();
        if (cmd === C.CORK_PLAYBACK) r.bool();
        this.reply(tag);
        break;
      }
      case C.SUBSCRIBE:
        r.u32();
        this.reply(tag);
        break;
      case C.SET_DEFAULT_SINK:
      case C.SET_DEFAULT_SOURCE:
        r.string();
        this.reply(tag);
        break;
      case C.EXIT:
        this.reply(tag);
        this.socket.end();
        break;
      default:
        this.error(tag, 19);
    }
  }
  // Request layout from stream.c create_stream; each later field by protocol version.
  createPlayback(tag, r) {
    const v = this.version;
    if (v < 13) r.string();
    let spec = r.sample();
    let map = r.channelMap();
    r.u32();
    r.string();
    let maxlength = r.u32();
    const corked = r.bool();
    let tlength = r.u32();
    let prebuf = r.u32();
    let minreq = r.u32();
    r.u32();
    r.cvolume();
    if (v >= 12) for (let i = 0; i < 7; i++) r.bool(); // remap/remix/fix/dont-move/variable-rate flags
    if (v >= 13) {
      r.bool(); // start muted
      r.bool(); // adjust latency
      r.proplist();
    }
    if (v >= 14) {
      r.bool(); // volume set
      r.bool(); // early requests
    }
    if (v >= 15) for (let i = 0; i < 3; i++) r.bool(); // muted set, don't inhibit suspend, fail on suspend
    if (v >= 17) r.bool(); // relative volume
    if (v >= 18) r.bool(); // passthrough
    const formats = [];
    if (v >= 21) for (let n = r.u8(); n > 0; n--) formats.push(r.formatInfo());
    if (!r.eof) throw new Error("unexpected playback fields");
    // pa_stream_new_extended sends an invalid sample spec and names the stream's format in the list.
    if (formats.length) {
      const pcm = pcmFromFormats(formats, defaultSpec);
      if (!pcm) {
        this.error(tag, 19);
        return;
      }
      ({ spec, map } = pcm);
    } else if (map.length !== spec.channels) map = defaultChannelMap(spec.channels);
    const process = this.openStream(tag, "playback", spec);
    if (!process) return;
    const id = this.next++;
    maxlength = maxlength === INVALID ? 262144 : maxlength;
    tlength = tlength === INVALID ? 65536 : tlength;
    const request = Math.min(maxlength, tlength, 65536);
    minreq = minreq === INVALID ? Math.floor(tlength / 4) : Math.min(minreq, tlength);
    prebuf = prebuf === INVALID ? tlength - minreq : Math.min(prebuf, tlength);
    this.streams.set(id, { process, spec, corked, offset: 0n, request });
    this.reply(tag, (w) => {
      w.u32(id).u32(id).u32(request);
      if (v >= 9) w.u32(maxlength).u32(tlength).u32(prebuf).u32(minreq);
      if (v >= 12)
        w.sample(spec).channelMap(map).u32(0).string("jspulse_sink").bool(false);
      if (v >= 13) w.usec(bytesToUsec(tlength, spec));
      if (v >= 21) w.formatInfo(ENCODING_PCM, pcmFormatEntries(spec, map));
    });
  }
  // A backend failure (e.g. the ALSA device is busy) is a per-stream error, not a protocol error that drops the connection.
  openStream(tag, kind, spec) {
    try {
      return kind === "playback"
        ? this.backend.openPlayback(spec)
        : this.backend.openRecord(spec);
    } catch (e) {
      console.error(`jspulse: cannot open ${kind} stream: ${e.message}`);
      this.error(tag, e.errno === 16 ? 26 : 10);
      return null;
    }
  }
  createRecord(tag, r) {
    const v = this.version;
    if (v < 13) r.string();
    let spec = r.sample();
    let map = r.channelMap();
    r.u32();
    r.string();
    let maxlength = r.u32();
    const corked = r.bool();
    let fragsize = r.u32();
    if (v >= 12) for (let i = 0; i < 7; i++) r.bool(); // remap/remix/fix/dont-move/variable-rate flags
    if (v >= 13) {
      r.bool(); // peak detect
      r.bool(); // adjust latency
      r.proplist();
      r.u32(); // direct on input
    }
    if (v >= 14) r.bool(); // early requests
    if (v >= 15) {
      r.bool(); // don't inhibit suspend
      r.bool(); // fail on suspend
    }
    const formats = [];
    if (v >= 22) {
      for (let n = r.u8(); n > 0; n--) formats.push(r.formatInfo());
      r.cvolume();
      for (let i = 0; i < 5; i++) r.bool(); // muted, volume set, muted set, relative volume, passthrough
    }
    if (!r.eof) throw new Error("unexpected record fields");
    if (formats.length) {
      const pcm = pcmFromFormats(formats, defaultSpec);
      if (!pcm) {
        this.error(tag, 19);
        return;
      }
      ({ spec, map } = pcm);
    } else if (map.length !== spec.channels) map = defaultChannelMap(spec.channels);
    const process = this.openStream(tag, "record", spec);
    if (!process) return;
    const id = this.next++,
      s = { process, spec, corked, offset: 0n, record: true };
    this.streams.set(id, s);
    maxlength = maxlength === INVALID ? 262144 : maxlength;
    fragsize = fragsize === INVALID ? Math.min(maxlength, 65536) : fragsize;
    this.reply(tag, (w) => {
      w.u32(id).u32(id);
      if (v >= 9) w.u32(maxlength).u32(fragsize);
      if (v >= 12)
        w.sample(spec).channelMap(map).u32(0).string("jspulse_source").bool(false);
      if (v >= 13) w.usec(bytesToUsec(fragsize, spec));
      if (v >= 22) w.formatInfo(ENCODING_PCM, pcmFormatEntries(spec, map));
    });
    if (!corked) this.pumpRecord(id, s);
  }
  async pumpRecord(id, s) {
    try {
      const reader = s.process.stdout.getReader();
      while (this.streams.get(id) === s) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) {
          this.send(id, value, s.offset, 0);
          s.offset += BigInt(value.length);
        }
      }
    } catch {
    } finally {
      if (this.streams.get(id) === s) this.streams.delete(id);
    }
  }
  // Only ask the client for more once the backend has room, so its clock follows real playback.
  onAudio(id, body) {
    const s = this.streams.get(id);
    if (!s) return;
    try {
      const pending = s.process.stdin.write(body);
      if (pending?.catch) pending.catch(() => this.streams.delete(id));
      s.offset += BigInt(body.length);
      Promise.resolve(s.process.ready?.()).then(() => {
        if (this.streams.get(id) === s && !this.socket.destroyed)
          this.request(id, body.length);
      });
      this.watchUnderflow(id, s);
    } catch {
      stopUnderflow(s);
      this.streams.delete(id);
    }
  }
  // From v13 the client hears when the backend has played all it was sent, as
  // protocol-native.c does on a sink input underrun; libmpv ends playback on it.
  // A v8 connection never gets here, so the default server sends nothing new.
  watchUnderflow(id, s) {
    if (this.version < 13 || s.underflowTimer) return;
    s.underflowTimer = setInterval(() => {
      if (this.streams.get(id) !== s || this.socket.destroyed) {
        stopUnderflow(s);
        return;
      }
      let timing;
      try {
        timing = readPlaybackTiming(s.process);
      } catch {
        return;
      }
      if (timing.queuedUsec > 0) return;
      stopUnderflow(s);
      const w = command(C.UNDERFLOW, INVALID).u32(id);
      if (this.version >= 23) w.s64(s.offset);
      this.packet(w);
    }, 20);
  }
  // Reply layout from protocol-native.c command_get_playback_latency.
  playbackLatency(tag, r) {
    return sendPlaybackTiming(this, tag, r);
  }
  request(id, n) {
    const w = command(C.REQUEST, INVALID).u32(id).u32(n);
    this.packet(w);
  }
  close() {
    for (const s of this.streams.values()) {
      stopUnderflow(s);
      this.backend.close(s.process);
    }
    this.streams.clear();
  }
}

function stopUnderflow(s) {
  if (!s?.underflowTimer) return;
  clearInterval(s.underflowTimer);
  s.underflowTimer = null;
}

export class PulseServer {
  constructor({
    backend,
    host = "127.0.0.1",
    port = 4713,
    protocol = PROTOCOL_VERSION,
  }) {
    if (
      !Number.isInteger(protocol) ||
      protocol < PROTOCOL_VERSION ||
      protocol > MAX_PROTOCOL_VERSION
    )
      throw new Error(
        `protocol version must be ${PROTOCOL_VERSION}-${MAX_PROTOCOL_VERSION}`,
      );
    this.backend = backend;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.clients = new Set();
    let nextClient = 0;
    this.server = net.createServer((s) => {
      const client = new Client(s, backend, { protocol, index: nextClient++ });
      this.clients.add(client);
      s.on("close", () => this.clients.delete(client));
    });
  }
  listen() {
    return new Promise((ok, no) => {
      this.server.once("error", no);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", no);
        ok();
      });
    });
  }
  // net.Server.close() waits for open connections, and Pulse clients such as Chromium never hang up on their own.
  async close() {
    const closed = new Promise((ok) => this.server.close(ok));
    for (const client of this.clients) {
      client.close();
      client.socket.destroy();
    }
    await closed;
    await this.backend.shutdown();
  }
}
