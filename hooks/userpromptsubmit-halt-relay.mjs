#!/usr/bin/env node
// UserPromptSubmit hook (ADR-0021 gap G5): the ACTUAL halt point. A SessionStart hook cannot block
// a session on this runtime (exit code 2 there shows stderr and the session proceeds) — this
// script is what blocks, by reading the halt-state file hooks/sessionstart-tool-enum.mjs (or any
// future S11b-era mechanism) may have written for the CURRENT session_id.
//
// Read-only by design: this script never writes the halt-state file itself (criterion 20's
// "additive by construction... each writer owns one key under reasons" is a property of a WRITER's
// own merge logic — see hooks/sessionstart-tool-enum.mjs's own writeHaltReason — not of this relay,
// which only ever reads).
//
// Fail-closed on a malformed halt-state file (SUR-10-shaped, symmetry with the other two hooks in
// this story): a halt-state file that exists but fails to JSON.parse is treated as an ACTIVE halt
// (exit 2), never as "no halt" — a truncated/corrupted file could be mid-write by a genuine halt
// condition, and silently proceeding past that is exactly the fail-open shape this project's own
// SUR-10 discipline forbids.
//
// Session isolation: only the halt-state file for THIS session's own session_id is ever consulted
// — another session's halt (even one that is very much still active) never blocks this one.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", (err) => rejectPromise(err));
  });
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

function haltStatePath(sessionId) {
  return join(projectDir(), ".thoth", "halt-state", `${sessionId}.json`);
}

function anyReasonSet(haltState) {
  if (typeof haltState !== "object" || haltState === null) return false;
  const reasons = haltState.reasons;
  if (typeof reasons !== "object" || reasons === null) return false;
  return Object.values(reasons).some((entry) => typeof entry === "object" && entry !== null && entry.set === true);
}

async function main() {
  const raw = await readStdin();
  const input = raw.trim() === "" ? {} : JSON.parse(raw);
  const sessionId = typeof input.session_id === "string" ? input.session_id : "unknown-session";

  const p = haltStatePath(sessionId);
  if (!existsSync(p)) {
    process.exit(0); // no halt-state file at all for this session -> nothing to block on
    return;
  }

  let haltState;
  let malformed = false;
  try {
    haltState = JSON.parse(readFileSync(p, "utf8"));
    // A file that parses as valid JSON but is not itself a well-formed object (e.g. a bare
    // string, number, array, or null) is JUST AS MUCH "not a valid halt-state file" as a JSON
    // syntax error — both fail closed identically. A halt-state file is always expected to be an
    // object; anything else means something wrote content this schema was never meant to hold.
    if (typeof haltState !== "object" || haltState === null || Array.isArray(haltState)) {
      malformed = true;
    }
  } catch {
    malformed = true;
  }

  if (malformed) {
    // Fail-closed: an existing-but-unparseable (or wrong-shaped) halt-state file could be
    // mid-write by a genuine halt condition. Silently proceeding here would be exactly the
    // fail-open shape SUR-10 forbids.
    process.stderr.write(`userpromptsubmit-halt-relay.mjs: halt-state file for session ${sessionId} is malformed or wrong-shaped — failing closed (blocking)\n`);
    process.exit(2);
    return;
  }

  if (anyReasonSet(haltState)) {
    process.stderr.write(`userpromptsubmit-halt-relay.mjs: session ${sessionId} has an active halt reason — blocking this prompt\n`);
    process.exit(2);
    return;
  }

  process.exit(0);
}

main().catch((err) => {
  // An internal exception on THIS script's own side (e.g. unparseable stdin from Claude Code
  // itself, which should never happen per the documented contract) fails closed too — never a
  // bare non-blocking exit that would silently let a possibly-active halt condition through.
  process.stderr.write(`userpromptsubmit-halt-relay.mjs: internal exception, fail-closed (blocking): ${err?.stack ?? err}\n`);
  process.exit(2);
});
