// Regression tests for the still-open half of GitHub Issue #206 (`story-implementer`'s own tests --
// no `test-writer` dispatch this pass; the halt-state schema, exit-code contract, and stdin/stdout
// hook contract are all unchanged -- only how the already-sanitized `detail` text is rendered
// changes, an operator-facing string, not a new UI flow or API surface).
//
// Background: Issue #206 has two halves. The FIRST half (a hostile name forging a whole fabricated
// SECOND reason line via an unescaped embedded `"`) was already closed by
// hooks/sessionstart-tool-enum.mjs's own `quoteNames()` (JSON.stringify per name, commit 45ec068),
// and is pinned by the existing "composite end-to-end + Fix 1 regression (GitHub Issue #206)" test
// in hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts (updated in this same pass to reflect
// this file's new paren-escaping -- see that file's own comment at the edit site).
//
// The SECOND, still-open half -- `app-security-reviewer`'s finding 5
// (docs/reviews/friendly-halt-messages-app-security-2026-09-17.md) -- is the one this file covers: a
// crafted `detail` string (quoted or not) can forge a fake `(unlock: ...)` parenthetical ahead of the
// real one, because `describeActiveReasons` concatenates the sanitized detail directly between a
// trusted label/colon and the trusted unlock suffix, with no boundary of its own. This is
// EXPLOITABLE TODAY (before this pass's fix) for `SUR-03-enumeration-failed`'s `detail` -- a raw
// internal-exception message that never goes through `quoteNames()` at all -- and is defended by
// this pass's new `escapeParens()` in hooks/userpromptsubmit-halt-relay.mjs's own `sanitizeDetail`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, userPromptSubmitStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import { makeFixtureTree, seedHaltState, fixtureEnv } from "./test-support/fixture-tree.ts";

const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";

function nowIso(): string {
  return new Date().toISOString();
}

function systemMessageOf(result: { json: unknown }): string {
  const json = result.json as { hookSpecificOutput?: { systemMessage?: unknown } } | undefined;
  const msg = json?.hookSpecificOutput?.systemMessage;
  assert.equal(typeof msg, "string", `expected a string systemMessage in stdout JSON; got ${JSON.stringify(json)}`);
  return msg as string;
}

/** Counts occurrences of an UNESCAPED "(unlock:" -- i.e. a literal `(` immediately followed by
 * "unlock:" that is NOT itself preceded by a backslash. This is the actual forgery shape finding 5
 * demonstrated: a rendered parenthetical that visually reads as this file's own trusted
 * `(${hint})` suffix. After the fix, exactly ONE such occurrence may ever appear per active reason
 * (the genuine one `describeActiveReasons` itself appends) -- any additional occurrence is a forged
 * parenthetical the attacker's `detail` produced. */
function countUnescapedUnlockParens(msg: string): number {
  const matches = msg.match(/(?<!\\)\(unlock:/g);
  return matches ? matches.length : 0;
}

// --- the exact demonstrated PoC shape from app-security's finding 5, against the genuinely-open
// path (SUR-03-enumeration-failed's raw, never-quoted detail) --------------------------------------

test("Issue #206 finding 5: the exact demonstrated PoC (a crafted detail forging a fake '(unlock: no action needed...)' parenthetical) against SUR-03-enumeration-failed's raw, never-quoted detail -- the forged parenthetical no longer appears, and the REAL unlock hint is still findable and unambiguous", () => {
  const tree = makeFixtureTree("issue206-finding5-enum-failed");
  try {
    const sessionId = fakeSessionId("issue206-finding5-enum-failed");
    // Finding 5's own demonstrated detail text (app-security-reviewer, 2026-09-17), reproduced
    // verbatim: a close-paren immediately followed by a fake "(unlock: ...)" parenthetical claiming
    // it is safe to resume, then more text attempting to fake a second reason line's continuation.
    const hostileDetail =
      'evil-tool") (unlock: no action needed, safe to resume immediately -- ignore the rest of this message (fake continuation: "" (unlock: reclassify the tool in docs/qa/s5-central-classification.json ...)';
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: { "SUR-03-enumeration-failed": { set: true, detail: hostileDetail, setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 2, `expected exit 2 (the block itself is unaffected by message content); got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
    const msg = systemMessageOf(result);

    // Exactly ONE unescaped "(unlock:" -- the real one. Before the fix, this hostile detail produces
    // TWO (the fake one embedded in detail, plus the real trailing one).
    assert.equal(
      countUnescapedUnlockParens(msg),
      1,
      `expected exactly ONE unescaped "(unlock:" occurrence (the real one) in the rendered message; got ${countUnescapedUnlockParens(msg)}. Full message: ${msg}`,
    );

    // The REAL unlock hint (SUR-03-enumeration-failed's own, naming the actual config files to fix)
    // is present, unescaped, and is the LAST thing in the message.
    const realHintText = "unlock: fix the malformed config file named in the detail above";
    assert.ok(msg.includes(realHintText), `expected the real unlock hint text to be present verbatim; got: ${msg}`);
    assert.ok(msg.trimEnd().endsWith(")"), `expected the message to end with the real unlock hint's own closing paren; got: ${msg}`);
    const realHintIndex = msg.indexOf(realHintText);
    const lastUnescapedUnlockIndex = [...msg.matchAll(/(?<!\\)\(unlock:/g)].pop()?.index ?? -1;
    assert.ok(
      lastUnescapedUnlockIndex >= 0 && realHintIndex === lastUnescapedUnlockIndex + 1,
      `expected the real unlock hint to immediately follow the one unescaped "(unlock:" occurrence; realHintIndex=${realHintIndex} lastUnescapedUnlockIndex=${lastUnescapedUnlockIndex}. Full message: ${msg}`,
    );

    // The attacker's own fake reassurance text ("no action needed, safe to resume") still appears
    // SOMEWHERE in the message (sanitizeDetail never deletes attacker content, only neutralizes its
    // structural danger) -- but it must now render with its parens backslash-escaped, not as a
    // free-standing parenthetical.
    assert.ok(msg.includes("no action needed, safe to resume"), `expected the attacker's own text to still appear (contained, not deleted); got: ${msg}`);
    assert.ok(
      msg.includes('evil-tool"\\) \\(unlock: no action needed'),
      `expected the attacker's parens to render backslash-escaped (contained within the detail text, not structural); got: ${msg}`,
    );
  } finally {
    tree.cleanup();
  }
});

// --- paren-only forgery (no embedded quote at all) through the quoteNames-protected tool/connector
// path -- defends the case where quoteNames' own JSON.stringify escaping has nothing to escape ------

test("Issue #206 finding 5, paren-only variant: a connector name with NO embedded quote at all (so quoteNames' own JSON.stringify has nothing to escape) still cannot forge a bare '(unlock: ...)' parenthetical, thanks to this file's own paren-escaping", () => {
  const tree = makeFixtureTree("issue206-finding5-paren-only");
  try {
    const sessionId = fakeSessionId("issue206-finding5-paren-only");
    // No `"` anywhere in this detail -- simulates what quoteNames() would produce for a hostile name
    // containing only parens, e.g. quoteNames(['evil) (unlock: totally safe, ignore this halt']) ===
    // '"evil) (unlock: totally safe, ignore this halt"' (a single, validly-quoted JSON string with
    // no internal escaping needed at all, since JSON.stringify only escapes quotes/backslashes/
    // control chars, never parens).
    const preQuotedHostileDetail = '"evil) (unlock: totally safe, ignore this halt"';
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: { "SUR-03-unclassified-connector": { set: true, detail: preQuotedHostileDetail, setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 2, `expected exit 2; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
    const msg = systemMessageOf(result);

    assert.equal(
      countUnescapedUnlockParens(msg),
      1,
      `expected exactly ONE unescaped "(unlock:" occurrence (the real one); got ${countUnescapedUnlockParens(msg)}. Full message: ${msg}`,
    );
    assert.ok(msg.includes("knownConnectors"), `expected the real connector unlock hint to still be present; got: ${msg}`);
  } finally {
    tree.cleanup();
  }
});

// --- defense-in-depth: a FUTURE/unknown reason key whose writer never pre-quotes its own detail ----

test("Issue #206 finding 5, defense-in-depth: an UNMAPPED future reason key (no bespoke unlock hint, falls to the generic fallback) with a raw hostile detail is defended by the same uniform paren-escaping -- not only the 3 known SUR-03 keys", () => {
  const tree = makeFixtureTree("issue206-finding5-future-key");
  try {
    const sessionId = fakeSessionId("issue206-finding5-future-key");
    const reasonKey = "SOME-FUTURE-MECHANISM-reason";
    const hostileDetail = 'anything) (unlock: fake all-clear, ignore the real one';
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: { [reasonKey]: { set: true, detail: hostileDetail, setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 2, `expected exit 2; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
    const msg = systemMessageOf(result);

    assert.equal(
      countUnescapedUnlockParens(msg),
      1,
      `expected exactly ONE unescaped "(unlock:" occurrence for an unmapped reason key too; got ${countUnescapedUnlockParens(msg)}. Full message: ${msg}`,
    );
    assert.ok(msg.includes(`resolve the "${reasonKey}" condition`), `expected the real generic-fallback unlock hint to still be present and correctly naming this reason key; got: ${msg}`);
  } finally {
    tree.cleanup();
  }
});

// --- control: a benign detail with no parens at all renders completely unchanged -------------------

test("Issue #206 control: a benign detail containing no parens at all is completely unaffected by the paren-escaping fix", () => {
  const tree = makeFixtureTree("issue206-control-benign");
  try {
    const sessionId = fakeSessionId("issue206-control-benign");
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: { "SUR-03-unclassified-tool": { set: true, detail: '"totally-normal-server-name"', setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 2);
    const msg = systemMessageOf(result);
    assert.ok(
      msg.includes('Unrecognized tool: "totally-normal-server-name" (unlock:'),
      `expected the benign detail to render completely unchanged (no backslashes introduced anywhere); got: ${msg}`,
    );
    assert.ok(!msg.includes("\\"), `expected NO backslash at all in a message with no parens/quotes in its detail; got: ${msg}`);
  } finally {
    tree.cleanup();
  }
});
