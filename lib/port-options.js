// SPDX-License-Identifier: LGPL-2.1-or-later
import { MAX_PROTOCOL_VERSION, PROTOCOL_VERSION } from "./server.js";

/** Extract server options before the existing mixer/tone parser sees them. */
export function parsePortOptions(argv) {
  const args = [];
  let port = 4713,
    protocol = PROTOCOL_VERSION;
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (option === "--protocol" || option.startsWith("--protocol=")) {
      const value = option.startsWith("--protocol=")
        ? option.slice(11)
        : argv[++i];
      if (
        typeof value !== "string" ||
        !/^\d+$/.test(value) ||
        Number(value) < PROTOCOL_VERSION ||
        Number(value) > MAX_PROTOCOL_VERSION
      ) {
        throw new Error(
          `--protocol: expected a version from ${PROTOCOL_VERSION} to ${MAX_PROTOCOL_VERSION}`,
        );
      }
      protocol = Number(value);
      continue;
    }
    if (
      option !== "-p" &&
      option !== "--port" &&
      !option.startsWith("--port=")
    ) {
      args.push(option);
      continue;
    }
    const value = option.startsWith("--port=") ? option.slice(7) : argv[++i];
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      Number(value) > 65535
    ) {
      throw new Error(
        `${option.split("=")[0]}: expected a port from 0 to 65535 (0 selects a free port)`,
      );
    }
    port = Number(value);
  }
  return { args, port, protocol };
}
