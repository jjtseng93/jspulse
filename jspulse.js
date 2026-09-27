#!/usr/bin/env bun
// SPDX-License-Identifier: LGPL-2.1-or-later
import { PulseServer } from "./lib/server.js";
import { createBackend } from "./lib/audio.js";

const args = new Set(process.argv.slice(2));
const mode = args.has("--alsa") ? "alsa" : args.has("--sles") ? "sles" : null;
if (!mode || args.size !== 1) {
  console.error("Usage: jspulse --alsa | jspulse --sles");
  process.exit(2);
}

const backend = await createBackend(mode);
const server = new PulseServer({ backend, host: "127.0.0.1", port: 4713 });
await server.listen();
console.log(`jspulse: ${mode} source/sink ready on 127.0.0.1:4713 (anonymous)`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
