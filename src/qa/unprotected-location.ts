// #466 (S7, #308 K blocker): where a Claude Code binary sits decides whether the readiness check may EXECUTE it.
// "Protected" has ONE definition: the generated protected-path list (src/qa/protected-path-list.ts, `protectedPaths().all`),
// passed in by the caller. There is no second list here. A binary under a `~/` entry of that list cannot be planted by a
// gated session; one anywhere else can, so the check hashes and flags it instead of running `--version`.
// Limits (disclosed): the match is lexical plus one realpath pass (the same case-folding and slash rules the kernel uses,
// canonicalizePathTarget); 8.3 short names are not expanded. A path outside the home directory is unprotected.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { canonicalizePathTarget } from "../policy/normalizer/path-canonical.ts";

export type Location = "protected" | "unprotected";

/** Pure: is `absPath` equal to, or inside, a `~/` entry of the protected list, with `~` meaning `home`? */
export function classifyLocation(absPath: string, home: string, protectedAll: readonly string[]): Location {
  const rel = relative(home, absPath);
  if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return "unprotected";
  const canon = canonicalizePathTarget(`~/${rel}`);
  for (const entry of protectedAll) {
    if (!entry.startsWith("~/")) continue;
    if (entry.endsWith("/") ? canon.startsWith(entry) : canon === entry) return "protected";
  }
  return "unprotected";
}

/** The path as discovered AND its real path (a junction or symlink resolved) must both be protected. */
export function classifyBinary(absPath: string, home: string, protectedAll: readonly string[]): Location {
  if (classifyLocation(absPath, home, protectedAll) !== "protected") return "unprotected";
  let real: string;
  let realHome: string;
  try {
    real = realpathSync(absPath);
    realHome = realpathSync(home);
  } catch {
    return "unprotected"; // cannot resolve it: fail closed
  }
  return classifyLocation(real, realHome, protectedAll);
}

/** Read-only: sha256 of the file's bytes, lowercase hex. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
