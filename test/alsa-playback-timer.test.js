// SPDX-License-Identifier: LGPL-2.1-or-later
import { expect, test } from "bun:test";

test("ALSA playback owns one period timer through writes, backpressure and close", async () => {
  // Keep the deterministic host timer replacement isolated from other tests.
  const child = Bun.spawn([process.execPath,
    new URL("./fixtures/alsa-playback-timer.js", import.meta.url).pathname], {
    stdout: "pipe", stderr: "pipe",
  });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(out).toContain("ALSA period timer regression passed");
}, 10_000);
