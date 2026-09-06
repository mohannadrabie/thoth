import { test } from "node:test";
import assert from "node:assert/strict";
import { matchDirectoryFlagToken, resolveFlagAlias } from "./flag-catalog.ts";

// --- SUR-07: resolveFlagAlias ---------------------------------------------------------------

test("resolveFlagAlias: 'c' resolves to canonical 'context'", () => {
  assert.equal(resolveFlagAlias("c"), "context");
});

test("resolveFlagAlias: case-insensitive", () => {
  assert.equal(resolveFlagAlias("C"), "context");
});

test("resolveFlagAlias: an unlisted short name returns undefined, never guessed", () => {
  assert.equal(resolveFlagAlias("x"), undefined);
});

// --- design-challenger S4 round-1 Finding #2: matchDirectoryFlagToken -----------------------

test("Finding #2: '--directory=<path>' (long, equals-form) is recognized, spans 1 token", () => {
  const match = matchDirectoryFlagToken(["--directory=/root/.ssh"], 0);
  assert.deepEqual(match, { tokenSpan: 1 });
});

test("Finding #2: '-C <path>' (short, two-token form) is recognized, spans 2 tokens", () => {
  const match = matchDirectoryFlagToken(["-C", "/root/.ssh"], 0);
  assert.deepEqual(match, { tokenSpan: 2 });
});

test("Finding #2: '-d <path>' (short, two-token form) is recognized, spans 2 tokens", () => {
  const match = matchDirectoryFlagToken(["-d", "/root/.ssh"], 0);
  assert.deepEqual(match, { tokenSpan: 2 });
});

test("matchDirectoryFlagToken: an ordinary flag is not a directory flag", () => {
  assert.equal(matchDirectoryFlagToken(["--context=prod"], 0), undefined);
});

test("matchDirectoryFlagToken: a short flag not in the recognized set is not a directory flag", () => {
  assert.equal(matchDirectoryFlagToken(["-n", "value"], 0), undefined);
});

test("matchDirectoryFlagToken: a positional (non-flag) token is not a directory flag", () => {
  assert.equal(matchDirectoryFlagToken(["pod/x"], 0), undefined);
});

// --- S4 Stage-3 review, red-team Finding 3 / app-security Finding 2 (Issues #72/#69): widened ---
// coverage — 3 additional ordinary spellings, plus the alias-collision half.

test("Issue #72/#69: '--directory <path>' (long, space-separated) is recognized, spans 2 tokens", () => {
  const match = matchDirectoryFlagToken(["--directory", "/etc"], 0);
  assert.deepEqual(match, { tokenSpan: 2 });
});

test("Issue #72/#69: '-d=<path>' (short, equals-form) is recognized, spans 1 token", () => {
  const match = matchDirectoryFlagToken(["-d=/etc"], 0);
  assert.deepEqual(match, { tokenSpan: 1 });
});

test("Issue #72/#69: '-C=<path>' (short, equals-form) is recognized, spans 1 token", () => {
  const match = matchDirectoryFlagToken(["-C=prod"], 0);
  assert.deepEqual(match, { tokenSpan: 1 });
});

test("Issue #72/#69 (the sharpest half): '-C=<v>' is caught by matchDirectoryFlagToken, never reaching resolveFlagAlias's lowercasing at all", () => {
  // matchDirectoryFlagToken alone MUST resolve this — the caller (shell.ts's scanFlags) checks it
  // BEFORE the generic short-flag/resolveFlagAlias branch, so a { tokenSpan: 1 } return here is
  // itself the proof the alias-collision route is unreachable for this token.
  const match = matchDirectoryFlagToken(["-C=prod"], 0);
  assert.notEqual(match, undefined, "a directory flag must never fall through to generic alias resolution");
});

test("regression: '-c=<v>' (lowercase, the legitimate context abbreviation) is still NOT a directory flag", () => {
  // DIRECTORY_FLAG_SHORT_NEXT_TOKEN is deliberately case-sensitive (only "C"/"d") — lowercase "c"
  // must keep resolving via resolveFlagAlias as before, unaffected by the widened coverage.
  assert.equal(matchDirectoryFlagToken(["-c=prod"], 0), undefined);
});
