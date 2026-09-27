// SPDX-License-Identifier: LGPL-2.1-or-later
import {describe,expect,test} from "bun:test";

const run=flag=>Bun.spawnSync([process.execPath,new URL("../jspulse.js",import.meta.url).pathname,flag],{stdout:"pipe",stderr:"pipe"});

describe("CLI information",()=>{
  test("no arguments prints concise usage and points to help",()=>{const r=Bun.spawnSync([process.execPath,new URL("../jspulse.js",import.meta.url).pathname],{stdout:"pipe",stderr:"pipe"}),output=r.stderr.toString();expect(r.exitCode).toBe(2);expect(output).toContain("Usage: jspulse");expect(output).toContain("--help");expect(output).toContain("-h");});
  for(const flag of ["--help","-h"])test(`${flag} prints help without starting audio`,()=>{const r=run(flag),output=r.stdout.toString();expect(r.exitCode).toBe(0);expect(output).toContain("Usage:");expect(output).toContain("--audio-info-zh");expect(output).toContain("--readme");expect(r.stderr.toString()).toBe("");});
  test("--readme renders README.md with Bun.markdown.ansi",()=>{const r=run("--readme"),output=Bun.stripANSI(r.stdout.toString());expect(r.exitCode).toBe(0);expect(output).toContain("jspulse");expect(output).toContain("PulseAudio native protocol");expect(r.stderr.toString()).toBe("");});
});
