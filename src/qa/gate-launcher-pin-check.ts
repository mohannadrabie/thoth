// #308 story D, D4b: pins the SHA-256 of hooks/launch-gate.sh so an emptied, truncated-to-nothing or altered launcher
// fails a check in CI (src/qa/gate-launcher-pin-check.test.ts runs it under `npm test`). Changing the launcher means
// changing this constant in the same commit, on purpose: that is the review friction. Disclosed: the pin lives in this
// repo, so it guards against a bad merge or accidental edit, not a deliberate one (story F's deny rules cover both paths).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export const LAUNCHER_PATH = "hooks/launch-gate.sh";
export const PINNED_SHA256 = "6c7525336c7ed11f2ce92840d5d81304bd4fc5fc554d8f4f0ec365744b01b5d5";

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function checkLauncherPin(content: Uint8Array): InstrumentResult {
  if (content.length === 0) return { ok: false, vacuous: false, summary: `${LAUNCHER_PATH} is empty: an empty launcher exits 0 and lets every call through`, details: [] };
  const actual = sha256Hex(content);
  if (actual !== PINNED_SHA256) {
    return { ok: false, vacuous: false, summary: `${LAUNCHER_PATH} does not match the pinned hash`, details: [`pinned ${PINNED_SHA256}`, `actual ${actual}`] };
  }
  return { ok: true, vacuous: false, summary: `${LAUNCHER_PATH} matches the pinned hash (${actual.slice(0, 12)}...)`, details: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const result = checkLauncherPin(readFileSync(resolve(repoRoot, LAUNCHER_PATH)));
  printInstrumentResult("D4b gate-launcher-pin-check", result);
  process.exit(exitCodeFor(result));
}
