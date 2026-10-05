// Issue #428: the REAL ports for the gate's binary-trust check (src/policy/gate/bare-binary-trust.ts, which is pure). This is the one
// place that touches the file system for it, and every call only reads: readdir, realpath (native, so Windows long names and
// junctions resolve), lstat, the process cwd, the home directory and the three environment values the check names. The hook
// (hooks/pretooluse-kernel-gate.mjs) is the only importer, the same way it is the only importer of the policy loader.
//
// The sandbox helper (hooks/test-support/gate-sandbox.ts) pins THIS file to an allow-all stub in its copy-tree for tests that judge
// the normalizer and the kernel through the real hook; tests of the check itself ask for the real one.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { checkBareBinaries } from "../gate/bare-binary-trust.ts";
import type { TrustPorts, TrustResult } from "../gate/bare-binary-trust.ts";

export function createRealTrustPorts(cwd?: string): TrustPorts {
  return {
    platform: process.platform === "win32" ? "win32" : "posix",
    get env() {
      return { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, windir: process.env.windir };
    },
    cwd: () => cwd ?? process.cwd(),
    homedir: () => {
      try {
        const h = homedir();
        return h === "" ? undefined : h;
      } catch {
        return undefined;
      }
    },
    readdir: (dir) => readdirSync(dir),
    realpath: (p) => realpathSync.native(p),
    lstat: (p) => {
      const s = lstatSync(p);
      return { uid: s.uid, mode: s.mode };
    },
  };
}

/** The gate's `checkBareBinaries` port: reads the live PATH on every call (no cache: a cached answer is stale the moment a file is planted). */
export function createRealBinaryCheck(): (names: readonly string[], cwd: string | undefined) => TrustResult {
  return (names, cwd) => checkBareBinaries(names, createRealTrustPorts(typeof cwd === "string" && cwd !== "" ? cwd : undefined));
}
