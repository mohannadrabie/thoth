// #308 story D, D4b-shim-hash-pinned: the launcher's content hash is pinned so an emptied or altered
// hooks/launch-gate.sh fails a check in CI (the 0-byte case is the one the truncation sweep cannot cover).
// Disclosed: the pin lives in this repo, so someone who can edit the launcher can edit the pin; story F's deny rules
// protect both paths. This catches a bad merge or an accidental edit, not a deliberate one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { LAUNCHER_PATH, PINNED_SHA256, checkLauncherPin, sha256Hex } from "./gate-launcher-pin-check.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("D4b-shim-hash-pinned: the committed launcher matches the pinned hash", () => {
  const content = readFileSync(resolve(REPO_ROOT, LAUNCHER_PATH));
  const r = checkLauncherPin(content);
  assert.equal(r.ok, true, r.summary);
  assert.equal(sha256Hex(content), PINNED_SHA256);
});

test("D4b-shim-hash-pinned: an empty launcher, a one-byte change and a trailing addition each fail the check", () => {
  const content = readFileSync(resolve(REPO_ROOT, LAUNCHER_PATH));
  assert.equal(checkLauncherPin(Buffer.alloc(0)).ok, false, "empty");
  const flipped = Buffer.from(content);
  flipped[flipped.length - 3] = flipped[flipped.length - 3] === 0x78 ? 0x79 : 0x78;
  assert.equal(checkLauncherPin(flipped).ok, false, "one byte changed");
  assert.equal(checkLauncherPin(Buffer.concat([content, Buffer.from("# x\n")])).ok, false, "trailing addition");
});
