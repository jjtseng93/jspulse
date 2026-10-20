// SPDX-License-Identifier: LGPL-2.1-or-later
import { expect, test } from "bun:test";
import { connect } from "node:net";
import { parsePortOptions } from "../lib/port-options.js";

test("port defaults and aliases preserve the existing argument parser", () => {
  expect(parsePortOptions([])).toEqual({ port: 4713, args: [] });
  for (const flags of [["-p", "4714"], ["--port", "4714"], ["--port=4714"]]) {
    expect(parsePortOptions(["--sles", ...flags])).toEqual({
      port: 4714,
      args: ["--sles"],
    });
    expect(parsePortOptions(["--volume", ...flags, "--alsa"])).toEqual({
      port: 4714,
      args: ["--volume", "--alsa"],
    });
  }
  expect(parsePortOptions(["-p", "0", "--port=65535"]).port).toBe(65535);
  expect(parsePortOptions(["-p", "0"]).port).toBe(0);
});

test("bad ports are rejected before opening a backend", () => {
  for (const args of [
    ["-p"],
    ["--port"],
    ["--port="],
    ["-p", "--sles"],
    ["-p", "-1"],
    ["-p", "1.5"],
    ["--port=65536"],
    ["--port=Infinity"],
    ["--port=1e3"],
  ]) {
    expect(() => parsePortOptions(args)).toThrow("expected a port");
    const result = Bun.spawnSync(
      [
        process.execPath,
        new URL("../jspulse.js", import.meta.url).pathname,
        ...args,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("expected a port");
  }
});

test("CLI binds and reports the selected ephemeral localhost port", async () => {
  // ALSA opens hardware only when a client requests an audio stream.
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("../jspulse.js", import.meta.url).pathname,
      "--alsa",
      "-p",
      "0",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => child.kill(), 5000);
  const errors = new Response(child.stderr).text();
  let output = "",
    port;
  try {
    for await (const bytes of child.stdout) {
      output += new TextDecoder().decode(bytes);
      const match = output.match(/ready on 127\.0\.0\.1:(\d+)/);
      if (match) {
        port = Number(match[1]);
        break;
      }
    }
    expect(port).toBeGreaterThan(0);
    await new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    });
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
    await errors;
  }
});
