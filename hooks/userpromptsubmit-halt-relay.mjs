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
// this story): a halt-state file that exists but fails to JSON.parse, OR whose shape doesn't
// conform to the documented schema below at ANY level (not just the top level — see
// `inspectHaltState`'s own header comment, S5 Stage-3 CRITICAL review round 1, `red-team` F6 /
// GitHub Issue #95), is treated as an ACTIVE halt (exit 2), never as "no halt" — a
// truncated/corrupted or malformed file could be mid-write by a genuine halt condition, and
// silently proceeding past that is exactly the fail-open shape this project's own SUR-10 discipline
// forbids.
//
// Session isolation: only the halt-state file for THIS session's own session_id is ever consulted
// — another session's halt (even one that is very much still active) never blocks this one.
//
// USER-VISIBLE MESSAGE (added 2026-09-08, corrected same day -- operator-reported gap: exit code 2
// alone showed the operator nothing, and a first attempt at fixing it used the wrong JSON shape).
// Verified verbatim against code.claude.com/docs/en/hooks's own dedicated "UserPromptSubmit"
// section (its "UserPromptSubmit decision control" table and the line immediately below it):
//   "On exit code 2, the blocking message is the first line of stderr or the `systemMessage` field
//   from JSON." -- and `systemMessage` is documented there as a field OF `hookSpecificOutput`, NOT
//   a top-level JSON field (that top-level placement is a DIFFERENT, generic hook-events section's
//   convention -- confirmed by this event's own dedicated schema table, which lists exactly
//   `hookEventName`, `updatedPromptText`, `additionalContext`, `systemMessage` as `hookSpecificOutput`'s
//   own members, nothing else -- notably NO `permissionDecision`/`decision`/`reason` field exists
//   for this event at all, that belongs to PreToolUse's own schema, not this one).
// So: every blocking path below writes `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
// "systemMessage": "<text>"}}` to stdout, in addition to (never instead of) the existing
// single-line stderr write and exit(2) -- either one alone is documented as sufficient, both
// together is belt-and-suspenders against whichever this runtime's own version actually reads.
//
// FLUSH-BEFORE-EXIT RACE (added 2026-09-08, second correction same day): `process.stdout.write()`
// and `process.stderr.write()` are NOT guaranteed synchronous -- when stdout/stderr are piped
// (exactly Claude Code's own hook invocation shape, never a TTY), Node queues the write and
// returns immediately; the actual OS-level flush happens on a later tick, and is especially prone
// to lagging behind on Windows pipes. `process.exit()` tears the process down immediately,
// without waiting for that queued write to land -- so the previous version of this file could
// call `process.exit(2)` before the JSON (or even the stderr line) had actually been delivered,
// losing the message from the reader's side entirely, silently, with no error here to catch it.
// Fix: every write below goes through `fs.writeSync` on the raw file descriptor (1 = stdout, 2 =
// stderr) instead of `process.stdout/stderr.write` -- `writeSync` blocks the calling code until
// the write system call itself returns, so nothing after it (including `process.exit`) can run
// until the bytes are actually handed to the OS. This is the same fix pattern Node's own docs
// recommend for exactly this class of bug (a process that exits right after writing output).
//
// EVERY BLOCK NAMES ITS UNLOCK (added S5 Stage-3 CRITICAL review round 1 fix-now,
// PRINCIPLES.md rule 2 / `red-team` F5 / GitHub Issue #94): the message this file emits for an
// active reason now names a concrete, actionable next step per reason key (see UNLOCK_HINTS below),
// not just a restatement of the problem. Combined with sessionstart-tool-enum.mjs's own AC5
// reconciliation (a resolved condition is explicitly cleared, set:false, on the next SessionStart
// run — SessionStart genuinely re-runs on a resumed session), a halted session is no longer
// permanently bricked with no stated escape.
//
// (The former `SUR-03-central-fixture-expired` reason, its unlock hint and its friendly label were
// removed with the fixture's expiry timer — GitHub Issue #217. A leftover halt-state file carrying
// that key would fall through to the generic hint and the raw key below; none can be written any
// more.)
//
// THIRD-PARTY TEXT IS SANITIZED BEFORE IT REACHES A CHAT-VISIBLE MESSAGE (S5 Stage-3 CRITICAL
// review round 1 fix-now, GitHub Issue #97): `detail` values written by sessionstart-tool-enum.mjs
// can carry MCP server / connector names that a third party (a `.mcp.json` author, a claude.ai
// connector name) fully controls. `sanitizeDetail` below length-caps and control-character-strips
// that text before it is interpolated into `systemMessage` (documented as reaching BOTH the user
// and Claude, per this file's own "USER-VISIBLE MESSAGE" section above) — closing the injection
// channel this diff would otherwise widen, without changing the underlying security property (the
// block itself, exit code 2, is unaffected either way).
import { readFileSync, existsSync, writeSync } from "node:fs";
import { join } from "node:path";

const MAX_DETAIL_LENGTH = 200;

/** Length-caps and control-character-strips a third-party-controlled `detail` string before it is
 * interpolated into a chat-visible message (GitHub Issue #97). Strips ASCII control characters
 * (0x00-0x1F, 0x7F) — this also removes newlines, which matters here specifically: this file's own
 * `blockWithMessage` writes `fullMessage` as a SINGLE stderr line (documented as "the first line of
 * stderr" being what Claude Code reads), so an embedded newline in `detail` could otherwise truncate
 * or split the message. Truncation is marked explicitly ("...[truncated]") rather than silently
 * cutting the string, so a reader never mistakes a capped message for the complete one. */
function sanitizeDetail(detail) {
  const text = typeof detail === "string" ? detail : String(detail ?? "(no detail recorded)");
  // eslint-disable-next-line no-control-regex -- deliberate: stripping control characters IS the point.
  const stripped = text.replace(/[\x00-\x1F\x7F]/g, "");
  return stripped.length > MAX_DETAIL_LENGTH ? `${stripped.slice(0, MAX_DETAIL_LENGTH)}...[truncated]` : stripped;
}

/** PRINCIPLES.md rule 2 ("every block names its unlock") applied per reason key. Each hint names a
 * concrete file/action, not a restatement of the halt condition (the detail text already states
 * the problem — this states what to DO about it). A reason key with no specific hint here falls
 * back to a generic, still-actionable instruction (see `unlockHintFor` below) rather than silently
 * omitting one. */
const UNLOCK_HINTS = Object.freeze({
  "SUR-03-unclassified-tool":
    "unlock: reclassify the tool in docs/qa/s5-central-classification.json (a reviewed, committed fixture -- not a hook-file edit) or disconnect/remove the MCP server, then resume or start a new session -- SessionStart reconciles this reason automatically on its next run",
  "SUR-03-unclassified-connector":
    "unlock: add the connector's EXACT display name to docs/qa/s5-central-classification.json's knownConnectors list (a reviewed, committed change -- not a hook-file edit) or disconnect it in claude.ai, then resume or start a new session",
  "SUR-03-enumeration-failed":
    "unlock: fix the malformed config file named in the detail above (commonly ~/.claude.json, .mcp.json, or docs/qa/s5-central-classification.json), then resume or start a new session -- SessionStart reconciles this reason automatically once enumeration succeeds",
});

/** FIX-NOW (CRITICAL-tier review round, `red-team`): a reason key shaped like `constructor`,
 * `__proto__`, `hasOwnProperty`, or `valueOf` resolves through the JS prototype chain via a bare
 * `MAP[key] ?? fallback` lookup (every plain object inherits these from `Object.prototype`, so the
 * lookup never actually misses and `??`'s own nullish-fallback never fires), rendering
 * `function Object() { [native code] }` (or similar) as the label instead of falling back to the
 * generic, still-actionable text. This still fails closed (exit 2 is unaffected either way) but
 * names neither the real reason nor a real unlock. `Object.hasOwn(UNLOCK_HINTS, reasonKey)` checks
 * membership without walking the prototype chain, so a reason key matching an inherited
 * Object.prototype member now correctly falls through to the generic fallback below. */
function unlockHintFor(reasonKey) {
  return Object.hasOwn(UNLOCK_HINTS, reasonKey)
    ? UNLOCK_HINTS[reasonKey]
    : `unlock: inspect .thoth/halt-state/<this session's id>.json's "reasons" object, resolve the "${reasonKey}" condition named in the detail above, then resume or start a new session`;
}

/** `friendly-halt-messages` story: short, human-readable labels for the SUR-03-owned reason keys
 * (see hooks/sessionstart-tool-enum.mjs's own *_REASON_KEY constants), used as the prefix in place
 * of the raw, hyphenated reason-key string (Manager-approved 2026-09-17). A reason key with no entry
 * here falls back to the raw key itself via `friendlyLabelFor` below, mirroring `unlockHintFor`'s own
 * existing generic-fallback pattern -- a future/unrecognized reason key never renders as `undefined`. */
const FRIENDLY_LABELS = Object.freeze({
  "SUR-03-unclassified-tool": "Unrecognized tool",
  "SUR-03-unclassified-connector": "Unrecognized connector",
  "SUR-03-enumeration-failed": "Tool/connector check failed",
});

/** Same prototype-chain fix as `unlockHintFor` above (FIX-NOW, `red-team`, CRITICAL-tier review
 * round): `Object.hasOwn` instead of a bare `??` lookup, so a reason key shaped like `constructor`
 * etc. falls back to the raw key itself rather than resolving to an inherited
 * `Object.prototype` member. */
function friendlyLabelFor(reasonKey) {
  return Object.hasOwn(FRIENDLY_LABELS, reasonKey) ? FRIENDLY_LABELS[reasonKey] : reasonKey;
}

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

/** Validates the FULL halt-state shape, not just the top level (GitHub Issue #95, `red-team` F6):
 * a well-formed halt-state file must be a plain object; its `reasons` field, if the object is to be
 * trusted at all, must itself be a plain object (never absent, never an array, never a string);
 * and EVERY entry under `reasons` must itself be a plain object whose `set` field is a strict
 * boolean. Any deviation from this — including one malformed leaf, e.g. `{set: "true"}` or
 * `{set: 1}` — returns `valid: false`, which the caller treats identically to a JSON parse failure
 * (fails CLOSED, blocks). Previously, only the top level was checked; four distinct malformed
 * shapes (missing `reasons` key, `reasons` as a string, `set: "true"`, `set: 1`) all silently
 * resolved to "no active reason found" -> fail OPEN, demonstrated by `red-team`'s F6 table. This
 * function replaces that partial check with one that validates every level the schema actually
 * specifies, so "wrong-shaped fails closed" is true for the whole shape, not an accident of which
 * JS builtin (`Object.values`, `===`) happened to be forgiving. Returns the list of ACTIVE
 * (`set === true`) `[key, entry]` pairs only when the whole shape is valid — an invalid shape never
 * exposes any reasons to the caller, since none of them can be trusted. */
function inspectHaltState(haltState) {
  if (typeof haltState !== "object" || haltState === null || Array.isArray(haltState)) {
    return { valid: false, activeReasons: [] };
  }
  const reasons = haltState.reasons;
  if (typeof reasons !== "object" || reasons === null || Array.isArray(reasons)) {
    return { valid: false, activeReasons: [] };
  }
  const activeReasons = [];
  for (const [key, entry] of Object.entries(reasons)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof entry.set !== "boolean") {
      return { valid: false, activeReasons: [] };
    }
    if (entry.set === true) activeReasons.push([key, entry]);
  }
  return { valid: true, activeReasons };
}

/** The one blocking exit point for this script (three call sites below all route through this:
 * the malformed/wrong-shaped branch, the active-reason branch, and (inlined, for the reasons
 * documented at its own call site) the top-level exception handler).
 * Writes the SAME human-readable text to two places at once, per this file's header comment:
 *   1. stderr (unchanged, existing behavior -- raw hook logs / Claude-visible fallback)
 *   2. stdout as JSON `systemMessage` (the field the docs name as reaching the human operator,
 *      "on any platform")
 * then exits 2. Always exits 2 -- this function never returns.
 *
 * BEST-EFFORT WRITES (added 2026-09-07, debugger root-cause docs/reviews/
 * userpromptsubmit-halt-relay-debug-2026-09-07.md): `fs.writeSync` throws a synchronous,
 * uncaught EPIPE when the stdout/stderr pipe's reader is gone at write time (reproduced 3/3
 * against this exact file). Message delivery is best-effort -- the block itself (exit code 2) is
 * the actual security property and must never degrade to exit 1 or an uncaught crash because a
 * write failed. Each write is therefore its own try/catch that swallows any error; `process.exit(2)`
 * below is unconditional regardless of whether either write succeeded. */
function blockWithMessage(sessionId, humanMessage) {
  const fullMessage = `thoth halt: session ${sessionId} blocked -- ${humanMessage}`;
  const jsonPayload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      systemMessage: fullMessage,
    },
  });
  // fs.writeSync on the raw fd, not process.stdout/stderr.write -- see this file's header comment
  // ("FLUSH-BEFORE-EXIT RACE"). Both writes are forced to complete (or fail safely -- see the
  // BEST-EFFORT WRITES comment above) before exit(2) runs below.
  // First line of stderr is one of the two documented sources for the exit-2 blocking message
  // (see header) -- keep this a single line so that "first line" is the whole message.
  try {
    writeSync(2, `${fullMessage}\n`);
  } catch {
    // Best-effort: message delivery must never prevent or alter the exit(2) block below.
  }
  try {
    writeSync(1, `${jsonPayload}\n`);
  } catch {
    // Best-effort: message delivery must never prevent or alter the exit(2) block below.
  }
  process.exit(2);
}

/** Renders every active `[key, entry]` pair (already validated by `inspectHaltState`) as one
 * human-readable line each: a friendly label (`friendlyLabelFor`, `friendly-halt-messages` story) in
 * place of the raw reason key, followed by the sanitized detail, followed by that key's own concrete
 * unlock hint (PRINCIPLES.md rule 2 / GitHub Issue #94) -- never just the bare problem restated. */
function describeActiveReasons(activeReasons) {
  return activeReasons.map(([key, entry]) => `${friendlyLabelFor(key)}: ${sanitizeDetail(entry.detail)} (${unlockHintFor(key)})`);
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

  let parsed;
  let parseFailed = false;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    parseFailed = true;
  }

  if (parseFailed) {
    blockWithMessage(
      sessionId,
      "its halt-state file is not valid JSON, failing closed until it is fixed or removed -- unlock: fix or delete " +
        `${p}, then resume or start a new session`,
    );
    return; // unreachable (blockWithMessage always exits), kept for readability/symmetry
  }

  const { valid, activeReasons } = inspectHaltState(parsed);

  if (!valid) {
    // Fail-closed: an existing-but-wrong-shaped halt-state file (GitHub Issue #95 -- checked at
    // EVERY level of the schema now, not just the top) could be mid-write by a genuine halt
    // condition, or hand-edited incorrectly. Silently proceeding here would be exactly the
    // fail-open shape SUR-10 forbids.
    blockWithMessage(
      sessionId,
      "its halt-state file is malformed or wrong-shaped (its top level, its \"reasons\" field, or one " +
        "of that field's own entries doesn't match the documented schema), failing closed until it is " +
        `fixed or removed -- unlock: inspect and fix (or delete) ${p}, then resume or start a new session`,
    );
    return; // unreachable (blockWithMessage always exits), kept for readability/symmetry
  }

  if (activeReasons.length > 0) {
    const reasonLines = describeActiveReasons(activeReasons);
    blockWithMessage(sessionId, reasonLines.join("; "));
    return; // unreachable (blockWithMessage always exits), kept for readability/symmetry
  }

  process.exit(0);
}

main().catch((err) => {
  // An internal exception on THIS script's own side (e.g. unparseable stdin from Claude Code
  // itself, which should never happen per the documented contract) fails closed too — never a
  // bare non-blocking exit that would silently let a possibly-active halt condition through.
  // sessionId is not in scope here (the exception may predate its own resolution inside main()),
  // so this one path writes its own message directly rather than going through blockWithMessage
  // (which requires a resolved sessionId) -- same two-destination shape (stderr + stdout JSON
  // systemMessage), just inlined.
  const fullMessage =
    "thoth halt: userpromptsubmit-halt-relay.mjs hit an internal exception and is failing closed " +
    `(blocking): ${err?.message ?? String(err)} -- unlock: this is an unexpected internal error, not a ` +
    "normal halt condition; re-run the session, and if this recurs, file a bug (this is not a " +
    "SUR-03 condition sessionstart-tool-enum.mjs can reconcile)";
  const jsonPayload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      systemMessage: fullMessage,
    },
  });
  // fs.writeSync, not process.stdout/stderr.write -- see this file's header ("FLUSH-BEFORE-EXIT
  // RACE"). Kept as a single stderr line (see blockWithMessage's own comment on "first line") plus
  // the full stack on stderr afterward for anyone reading raw hook logs.
  // BEST-EFFORT WRITES (see blockWithMessage's own comment above): each write is its own
  // try/catch so a broken pipe here (the same EPIPE condition blockWithMessage guards against)
  // can never prevent or alter the unconditional exit(2) below.
  try {
    writeSync(2, `${fullMessage}\n${err?.stack ?? ""}\n`);
  } catch {
    // Best-effort: message delivery must never prevent or alter the exit(2) block below.
  }
  try {
    writeSync(1, `${jsonPayload}\n`);
  } catch {
    // Best-effort: message delivery must never prevent or alter the exit(2) block below.
  }
  process.exit(2);
});
