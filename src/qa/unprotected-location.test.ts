// #466 (S7, #308 K blocker): "unprotected location" is defined by the protected-path list itself (one source), never a second hand list.
// Written FAILING FIRST. The classifier is pure over (path, home, protected list); the realpath variant adds a junction check.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { protectedPaths } from "./protected-path-list.ts";
import { classifyBinary, classifyLocation, sha256File } from "./unprotected-location.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LIST = protectedPaths(ROOT).all;
const HOME = process.platform === "win32" ? "C:\\Users\\alice" : "/home/alice";
const at = (...p: string[]): string => join(HOME, ...p);

test("ULOC-classify-table: protected install dirs and both Desktop roots are protected; everything else is unprotected", () => {
  const protectedCases = [
    at(".local", "bin", "claude.exe"),
    at(".local", "share", "claude", "versions", "2.1.289"),
    at(".vscode", "extensions", "anthropic.claude-code-2.1.289-win32-x64", "resources", "native-binary", "claude.exe"),
    at(".vscode-insiders", "extensions", "x", "claude.exe"),
    at(".cursor", "extensions", "x", "claude.exe"),
    at("AppData", "Roaming", "Claude", "claude-code", "2.1.284", "3f4bed3e44ad", "claude.exe"),
    at("AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude-code", "2.1.286", "635c1867224a", "claude.exe"),
    at("APPDATA", "ROAMING", "CLAUDE", "Claude-Code", "2.1.284", "h", "CLAUDE.EXE"), // case-folded like the kernel
  ];
  for (const p of protectedCases) assert.equal(classifyLocation(p, HOME, LIST), "protected", p);
  const unprotectedCases = [
    at("pathbin", "claude.exe"),
    at("AppData", "Local", "Packages", "Claude_abc123", "LocalCache", "Roaming", "Claude", "claude-code", "2.1.286", "h", "claude.exe"), // an unpinned publisher
    at("AppData", "Roaming", "Claude", "claude.exe"), // beside the root, not in it
    at("AppData", "Roaming", "Claude", "claude-code-evil", "2.1.1", "h", "claude.exe"), // sibling with a shared name prefix
    at(".local", "binx", "claude.exe"), // shared name prefix of a protected dir
    process.platform === "win32" ? "D:\\redirected\\Roaming\\Claude\\claude-code\\2.1.284\\h\\claude.exe" : "/opt/redirected/Claude/claude-code/2.1.284/h/claude",
    process.platform === "win32" ? "C:\\Program Files\\tools\\claude.exe" : "/usr/local/bin/claude",
    at("..", "bob", ".local", "bin", "claude.exe"), // another user's home
  ];
  for (const p of unprotectedCases) assert.equal(classifyLocation(p, HOME, LIST), "unprotected", p);
});

test("ULOC-single-source-mutant: the classification follows the protected list and nothing else", () => {
  const desktop = at("AppData", "Roaming", "Claude", "claude-code", "2.1.284", "h", "claude.exe");
  assert.equal(classifyLocation(desktop, HOME, LIST), "protected");
  const without = LIST.filter((p) => p !== "~/appdata/roaming/claude/claude-code/");
  assert.equal(without.length, LIST.length - 1, "the Desktop root entry exists on the real list in its canonical form");
  assert.equal(classifyLocation(desktop, HOME, without), "unprotected");
  assert.equal(classifyLocation(at(".local", "bin", "claude.exe"), HOME, []), "unprotected", "an empty list protects nothing");
  assert.equal(classifyLocation(at("x", "claude.exe"), HOME, [...LIST, "~/x/"]), "protected", "a newly listed dir becomes protected with no other change");
});

test("ULOC-realpath-junction: a protected-looking path that resolves outside the protected dirs is unprotected", (t) => {
  const home = mkdtempSync(join(tmpdir(), "uloc-home-"));
  try {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "claude.exe"), "x");
    mkdirSync(join(home, ".local"), { recursive: true });
    try {
      symlinkSync(elsewhere, join(home, ".local", "bin"), "junction");
    } catch (e) {
      t.skip(`cannot create a junction here: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const viaLink = join(home, ".local", "bin", "claude.exe");
    assert.equal(classifyLocation(viaLink, home, LIST), "protected", "lexically it is under a protected dir");
    assert.equal(classifyBinary(viaLink, home, LIST), "unprotected", "its real path is not");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ULOC-sha256: sha256File equals an independent hash of the bytes", () => {
  const d = mkdtempSync(join(tmpdir(), "uloc-hash-"));
  try {
    const f = join(d, "b.bin");
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 65, 66]);
    writeFileSync(f, bytes);
    const got = sha256File(f);
    assert.match(got, /^[0-9a-f]{64}$/);
    assert.equal(got, createHash("sha256").update(bytes).digest("hex"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
