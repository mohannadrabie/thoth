import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_PATTERNS } from "./patterns.ts";

function findPattern(id: string) {
  const p = SECRET_PATTERNS.find((x) => x.id === id);
  if (!p) throw new Error(`no pattern ${id}`);
  p.regex.lastIndex = 0;
  return p;
}

test("email-address: matches a real email", () => {
  const p = findPattern("email-address");
  assert.ok(p.regex.test("contact security@example.com for reports"));
});

test("email-address: does NOT match an npm package version specifier (regression — false " +
  "positive found scanning this repo's own REQUIREMENTS.md: `@microsoft/agent-governance-sdk@5.0.0`)", () => {
  const p = findPattern("email-address");
  assert.equal(p.regex.test("@microsoft/agent-governance-sdk@5.0.0"), false);
  p.regex.lastIndex = 0;
  assert.equal(p.regex.test("agent-governance-claude-code@5.0.0"), false);
});

test("aws-access-key-id: matches an AKIA-shaped key", () => {
  const p = findPattern("aws-access-key-id");
  assert.ok(p.regex.test("AKIAABCDEFGHIJKLMNOP"));
});

test("internal-hostname: matches a bare internal-suffixed host", () => {
  const p = findPattern("internal-hostname");
  assert.ok(p.regex.test("connect to db01.internal for the staging replica"));
});

test("internal-hostname: does NOT match a config-filename fragment (regression — false " +
  "positive found scanning this repo's own history, GitHub Issue #113: every doc/hook mention " +
  "of `.claude/settings.local.json` matched 'settings.local' as an internal hostname)", () => {
  const p = findPattern("internal-hostname");
  assert.equal(p.regex.test("edit .claude/settings.local.json to override CLAUDE_PROJECT_DIR"), false);
  p.regex.lastIndex = 0;
  assert.equal(p.regex.test("settings.local.json"), false);
  p.regex.lastIndex = 0;
  // Same false positive, hyphenated-modifier shape (this repo's own history: "settings.local-
  // shaped strings", docs/reviews/s6-policy-centralization-red-team-round5-2026-09-08.md).
  assert.equal(p.regex.test("the internal-hostname pattern false-positiving on settings.local-shaped strings"), false);
  p.regex.lastIndex = 0;
  // Sentence-final punctuation must not be mistaken for a filename extension.
  assert.ok(p.regex.test("the replica lives at db01.internal."));
});

test("internal-hostname: DOES match a real multi-label corporate FQDN (regression — GitHub " +
  "Issue #130: the #113 fix's blanket no-continuation lookahead silently dropped this true-" +
  "positive class; `.corp`/`.internal` are routinely a MIDDLE label of a real FQDN, not always " +
  "the terminating one)", () => {
  const p = findPattern("internal-hostname");
  assert.ok(p.regex.test("host01.corp.contoso.com"));
  p.regex.lastIndex = 0;
  assert.ok(p.regex.test("api.internal.acme.com"));
  p.regex.lastIndex = 0;
  assert.ok(p.regex.test("db1.internal.example.com"));
});

test("github-fine-grained-pat: matches GitHub's fine-grained PAT format (regression — GitHub " +
  "Issue #129: the classic github-pat pattern's `gh[pousr]_` prefix never matches " +
  "`github_pat_...`, the exact format this project's own ADR_REPO_PAT credential uses)", () => {
  const p = findPattern("github-fine-grained-pat");
  assert.ok(p.regex.test(
    "github_pat_11ABCDEFGHIJKLMNOPQR_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUV",
  ));
  p.regex.lastIndex = 0;
  // Zero overlap with the classic github-pat pattern's own shape.
  assert.equal(p.regex.test("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789AB"), false);
});

// Synthetic fixtures for the two github-fine-grained-pat tests below, built at runtime so this
// file's own text never contains the literal prefix followed by 20+ alphanumerics (Issue #136
// hygiene: new positive fixtures should not lean on the whole-file allowlist entry).
const PAT_PREFIX = "github" + "_pat_";
const PAT_IDENTIFIER_SEGMENT = "ABCDEFGHIJKLMNOPQRSTUV"; // 22 alphanumerics, visibly synthetic
const PAT_SECRET_SEGMENT = "abcdefghijklmnopqrstuvwxyz1234567890"; // visibly synthetic

test("github-fine-grained-pat: does NOT match ordinary PAT-discussion prose (regression -- " +
  "Issue #135: the snake_case false-positive class the fix removed; a synthetic real-format " +
  "token still matches in the same test) [github-fine-grained-pat-word-boundary-test]", () => {
  const exemplars = [
    "load_github_pat_for_submodule_checkout",
    "read_github_pat_from_environment_variable",
    "const github_pat_env_var_name_constant = 1",
    "my.github_pat_helper_function_name_here()",
  ];
  for (const text of exemplars) {
    const p = findPattern("github-fine-grained-pat");
    assert.equal(p.regex.test(text), false, `must not match prose: ${text}`);
  }
  const contrast = PAT_PREFIX + PAT_IDENTIFIER_SEGMENT + "_" + PAT_SECRET_SEGMENT;
  const p = findPattern("github-fine-grained-pat");
  assert.ok(p.regex.test(contrast), "the synthetic real-format token must still match");
});

test("github-fine-grained-pat: matches a truncated prefix-only disclosure (22-char identifier " +
  "segment, empty secret segment; Issue #89 exemplar shape)", () => {
  const truncated = PAT_PREFIX + PAT_IDENTIFIER_SEGMENT + "_";
  const p = findPattern("github-fine-grained-pat");
  assert.deepEqual(truncated.match(p.regex), [truncated], "the whole truncated fixture is the match");
});

test("ipv4-private: matches a private-range address, not a public one", () => {
  const priv = findPattern("ipv4-private");
  assert.ok(priv.regex.test("server at 10.0.1.5 is internal"));
  priv.regex.lastIndex = 0;
  assert.equal(priv.regex.test("public DNS 8.8.8.8"), false);
});

// ================================================================================================
// Issue 237 (the second decode miss the issue names): the scanner reads a blob as latin1, and JS `\s`
// matches the latin1 character 0xA0. Inside the negated value class of generic-password-assignment that
// let any UTF-8 character whose second byte is 0xA0 (a grave, for one) END the value early and hide the
// password. The whitespace-sensitive tokens are enumerated below by a tokenizer over the pattern
// sources, not by hand. Every planted value is built at runtime.
// ================================================================================================

interface WhitespaceToken {
  token: string;
  where: "outside" | "class" | "negated-class";
  classBody: string | null;
}

/** Every `\s` and `\S` in a regex source and where it sits: outside any class, inside a class, or inside
 * a negated class (the position that hides data). Honors escapes, so an escaped bracket opens no class. */
function whitespaceTokens(source: string): WhitespaceToken[] {
  const out: WhitespaceToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const token = source.slice(i, i + 2);
      if (token === "\\s" || token === "\\S") out.push({ token, where: "outside", classBody: null });
      i += 2;
      continue;
    }
    if (ch === "[") {
      const negated = source[i + 1] === "^";
      const start = i + (negated ? 2 : 1);
      let j = start;
      while (j < source.length && source[j] !== "]") j += source[j] === "\\" ? 2 : 1;
      const body = source.slice(start, j);
      for (let k = 0; k < body.length; k += body[k] === "\\" ? 2 : 1) {
        const token = body.slice(k, k + 2);
        if (body[k] === "\\" && (token === "\\s" || token === "\\S")) {
          out.push({ token, where: negated ? "negated-class" : "class", classBody: body });
        }
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

test("oss01-no-negated-whitespace-class-hides-a-high-byte", () => {
  // The tokenizer is not blind: synthetic sources exercise each position it must tell apart.
  assert.deepEqual(whitespaceTokens("[^'\"\\s]{8,}").map((t) => t.where), ["negated-class"]);
  assert.deepEqual(whitespaceTokens("a\\s*b").map((t) => t.where), ["outside"]);
  assert.deepEqual(
    whitespaceTokens("[\\s\\S]*?").map((t) => [t.token, t.where, t.classBody]),
    [["\\s", "class", "\\s\\S"], ["\\S", "class", "\\s\\S"]],
  );
  assert.deepEqual(whitespaceTokens("\\[\\s\\]").map((t) => t.where), ["outside"], "an escaped bracket opens no class");

  const all = SECRET_PATTERNS.flatMap((p) => whitespaceTokens(p.regex.source).map((t) => ({ patternId: p.id, ...t })));
  assert.ok(all.length > 0, "non-vacuous: the catalog has whitespace-sensitive tokens");
  assert.ok(all.some((t) => t.where === "outside"), "non-vacuous: separator tokens are enumerated");
  assert.ok(all.some((t) => t.where === "class" && t.classBody === "\\s\\S"), "non-vacuous: the any-character idiom is enumerated");

  const hiding = all.filter((t) => t.where === "negated-class");
  assert.deepEqual(hiding, [], "no whitespace escape may sit inside a negated class: latin1 0xA0 would end the value and hide it");
  const unexpected = all.filter((t) => !(t.where === "outside" || (t.where === "class" && t.classBody === "\\s\\S")));
  assert.deepEqual(unexpected, [], "every remaining whitespace token is a separator or the any-character idiom");
});

// Issue 249 (red-team, s1-237-nul-byte-scan, attack 2): the guard above only recognises the two-character
// `\s`/`\S` tokens, so a value class written with `\xa0`, the U+00A0 escape, `\p{White_Space}` or a literal 0xA0
// byte reinstates the identical defect while the tokenizer stays blind to it (4 of 5 spellings demonstrated
// blind). This replaces the spelling enumeration with a BEHAVIOUR probe: every negated character class in
// the catalog is extracted, rebuilt standalone, and run against every byte 0x80-0xFF — no spelling can
// evade it, because it never looks at how the exclusion was written, only at what it actually excludes. The
// test above stays as the friendlier diagnostic (it names the offending token, not just the byte).

/** Every `[^...]` negated character class in a regex source, honoring escapes so an escaped bracket opens
 * no class (mirrors `whitespaceTokens`'s own escape handling above). Returns each class's raw body text
 * (without the `[^`/`]` delimiters) — the only shape that can HIDE data, since a non-negated class can only
 * ever match MORE, never less. */
function negatedClasses(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      const negated = source[i + 1] === "^";
      const start = i + (negated ? 2 : 1);
      let j = start;
      while (j < source.length && source[j] !== "]") j += source[j] === "\\" ? 2 : 1;
      if (negated) out.push(source.slice(start, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

test("oss01-no-negated-class-rejects-a-high-byte", () => {
  // The extractor is not blind either: it finds the one negated class the shipped catalog has, and
  // correctly ignores a non-negated class (`[\s\S]`, `private-key-block`'s any-character idiom) and an
  // escaped bracket.
  assert.deepEqual(negatedClasses("[^'\"\\s]{8,}"), ["'\"\\s"]);
  assert.deepEqual(negatedClasses("[\\s\\S]*?"), [], "a non-negated class can only match MORE, never hide data");
  assert.deepEqual(negatedClasses("\\[\\^x\\]"), [], "an escaped bracket opens no class");

  const all = SECRET_PATTERNS.flatMap((p) => negatedClasses(p.regex.source).map((body) => ({ patternId: p.id, body })));
  assert.ok(all.length > 0, "non-vacuous: the catalog has at least one negated class to probe");

  for (const { patternId, body } of all) {
    // Rebuilt standalone (never widened by the pattern's own surrounding context) and run behaviourally,
    // preserving the original flags (a future `\p{White_Space}` spelling needs the `u` flag to even parse).
    const probe = new RegExp(`[^${body}]`, findPattern(patternId).regex.flags.replace("g", ""));
    const rejected: string[] = [];
    for (let b = 0x80; b <= 0xff; b++) {
      if (!probe.test(String.fromCharCode(b))) rejected.push("0x" + b.toString(16).toUpperCase());
    }
    assert.deepEqual(
      rejected,
      [],
      `pattern ${patternId}'s negated class [^${body}] rejects high byte(s) ${rejected.join(",")} -- ` +
        "a spliced high byte would end the value early and hide it, whatever spelling excluded it",
    );
  }
});

// Positive control for the behaviour probe above, mirroring red-team's own measured table exactly: five
// spellings of the identical defect (only the last four of which the OLD spelling-based guard missed), each
// rebuilt as a standalone negated class the same way the real test above rebuilds a catalog entry.
test("oss01-no-negated-class-rejects-a-high-byte: catches every spelling of the 0xA0 defect (positive control)", () => {
  const base = `'" \\t\\n\\v\\f\\r`; // the shipped, fixed class body -- rejects nothing above 0x7F
  const spellings: Record<string, { body: string; flags: string }> = {
    "shipped (fixed, control)": { body: base, flags: "" },
    "\\s": { body: `${base}\\s`, flags: "" },
    "\\xa0": { body: `${base}\\xa0`, flags: "" },
    "\\u00a0": { body: `${base}\\u00a0`, flags: "" },
    "\\p{White_Space}": { body: `${base}\\p{White_Space}`, flags: "u" },
    "literal 0xA0 byte": { body: `${base}${String.fromCharCode(0xa0)}`, flags: "" },
  };
  for (const [label, { body, flags }] of Object.entries(spellings)) {
    const probe = new RegExp(`[^${body}]`, flags);
    const rejects0xA0 = !probe.test(String.fromCharCode(0xa0));
    const expected = label !== "shipped (fixed, control)";
    assert.equal(rejects0xA0, expected, `${label}: expected rejects-0xA0=${expected}, got ${rejects0xA0}`);
  }
});

/** A fresh, non-global copy of the generic-password pattern, so no lastIndex leaks between cells. */
function passwordRegex(): RegExp {
  const p = findPattern("generic-password-assignment");
  return new RegExp(p.regex.source, p.regex.flags.replace("g", ""));
}
const PASSWORD_NAME = ["pass", "word"].join("");

test("oss01-high-byte-in-a-password-value-does-not-hide-it", () => {
  const re = passwordRegex();
  const misses: string[] = [];
  let cells = 0;
  for (let b = 0x80; b <= 0xff; b++) {
    cells++;
    const text = `${PASSWORD_NAME} = "abcd${String.fromCharCode(b)}efgh"`;
    if (re.exec(text)?.[0] !== text) misses.push("0x" + b.toString(16).toUpperCase());
  }
  assert.equal(cells, 128, "derived: every high byte 0x80 to 0xFF was tried");
  assert.deepEqual(misses, [], "a high byte inside a password value must leave the whole literal matched");
});

test("oss01-ascii-whitespace-still-ends-a-password-value", () => {
  const re = passwordRegex();
  const ascii: number[] = [];
  for (let b = 0; b < 0x80; b++) if (/\s/.test(String.fromCharCode(b))) ascii.push(b);
  assert.ok(ascii.length >= 6, "derived: the ASCII whitespace bytes come from the engine's own definition of whitespace");
  assert.ok(re.test(`${PASSWORD_NAME} = "abcdefghijklmnop"`), "control: the same value with no whitespace matches");
  for (const b of ascii) {
    const text = `${PASSWORD_NAME} = "abcdefgh${String.fromCharCode(b)}ijklmnop"`;
    assert.equal(re.test(text), false, `ASCII byte 0x${b.toString(16)} inside a value must still end it`);
  }
});

test("oss01-latin1-nbsp-separator-still-matches", () => {
  // A lone 0xA0 as the separator between name, operator and value is matched by the separator tokens'
  // `\s*`. Those tokens are deliberately left as they are: narrowing them would open a new evasion.
  const nbsp = String.fromCharCode(0xa0);
  const text = `${PASSWORD_NAME}${nbsp}=${nbsp}"abcdefgh"`;
  assert.equal(passwordRegex().exec(text)?.[0], text);
});

// ================================================================================================
// Issue 268 (red-team, fix-now round, MED): `oss01-no-negated-class-rejects-a-high-byte` (above) only
// extracts NEGATED classes ([^...]) before probing them, and its own stated premise -- "a non-negated
// class can only match MORE, never hide data" -- is false. Demonstrated: a POSITIVE class narrower than
// the shipped one, or a lookahead, hides a high byte exactly the same way a negated class can, and every
// one of those spellings passes the old guard green because it never looks at how the class was written.
// This replaces syntax classification with a whole-PATTERN behaviour sweep: put every byte 0x80-0xFF into
// the value and run the REAL, shipped regex end to end, asserting the match still covers the whole
// literal -- construct-independent by design, so a future narrowing, however it is spelled, cannot pass
// this the way it passed the syntax-scoped guard it supersedes.
//
// Issue 270 (red-team, s1-oss01-detection-residuals round 2, MED; the fourth iteration of one root-cause
// class after 244, 249 and 268): that sweep still had two hand-kept dimensions -- WHICH patterns it swept
// (a two-key table) and WHERE the byte went (one fixed offset). Both are now derived:
//   - scope: `HIGH_BYTE_SWEEP` must classify EVERY id in `SECRET_PATTERNS`, checked in both directions by
//     `unclassifiedPatternIds`, so a new pattern fails the suite until its author declares it;
//   - position: the byte replaces EACH character of the exemplar's value in turn, so a narrowing that
//     bites only the first or only the last character is seen.
// What stays a declared judgment, by design: whether a pattern is `free-form` (a high byte is legitimate
// inside its value) or `ascii-only` (a fixed alphabet; the reason says which). That choice is forced and
// visible in the diff of any change that adds a pattern; it is not a mechanical proof. Every count below
// comes from the run (`t.diagnostic`), never from prose. Named per red-team's own suggested test:
// oss01-no-value-class-however-written-hides-a-high-byte.
// ================================================================================================

type SweepSpec =
  | { kind: "free-form"; prefix: string; value: string; suffix: string }
  | { kind: "ascii-only"; reason: string };

const PEM_BEGIN = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const PEM_END = ["-----END", "PRIVATE KEY-----"].join(" ");

/** One entry per catalog pattern id. `free-form`: `value` is the region a high byte must never hide (the
 * whole exemplar `prefix + value + suffix` must be what the pattern matches). `ascii-only`: a fixed
 * alphabet with the reason it needs no high-byte sweep. */
const HIGH_BYTE_SWEEP: Record<string, SweepSpec> = {
  "generic-password-assignment": { kind: "free-form", prefix: `${PASSWORD_NAME} = "`, value: "abcdefgh", suffix: `"` },
  "private-key-block": { kind: "free-form", prefix: `${PEM_BEGIN}\n`, value: "MIIBAAAA", suffix: `\n${PEM_END}` },
  "aws-access-key-id": { kind: "ascii-only", reason: "fixed [0-9A-Z] alphabet after a literal prefix" },
  "aws-secret-access-key": { kind: "ascii-only", reason: "fixed base64 alphabet [A-Za-z0-9/+=]" },
  "github-pat": { kind: "ascii-only", reason: "fixed [A-Za-z0-9] alphabet after a literal prefix" },
  "github-fine-grained-pat": { kind: "ascii-only", reason: "fixed [A-Za-z0-9] segments after a literal prefix" },
  "slack-token": { kind: "ascii-only", reason: "fixed [A-Za-z0-9-] alphabet after a literal prefix" },
  "internal-hostname": { kind: "ascii-only", reason: "hostname labels are ASCII (internationalized names travel as punycode)" },
  "ipv4-private": { kind: "ascii-only", reason: "digits and dots only" },
  "email-address": { kind: "ascii-only", reason: "ASCII local part and domain; a high byte ends the match, it hides no value inside one" },
};

/** Pure. Ids in `patterns` with no registry entry (`missing`) and registry ids not in `patterns` (`stale`). */
function unclassifiedPatternIds(
  patterns: ReadonlyArray<{ id: string }>,
  registry: Record<string, SweepSpec>,
): { missing: string[]; stale: string[] } {
  const ids = new Set(patterns.map((p) => p.id));
  return {
    missing: [...ids].filter((id) => !(id in registry)),
    stale: Object.keys(registry).filter((id) => !ids.has(id)),
  };
}

/** Behaviourally sweeps `re` (a fresh, non-global copy is made internally) over a free-form exemplar: every
 * character of `value`, in turn, is replaced by every byte 0x80-0xFF, and the WHOLE exemplar must still be
 * the match. Returns the cells where it was not (a truncated match, or none: the literal goes unreported)
 * and the number of cells tried. */
function sweepEveryPosition(
  re: RegExp,
  spec: Extract<SweepSpec, { kind: "free-form" }>,
): { hidden: string[]; cells: number } {
  const fresh = new RegExp(re.source, re.flags.replace("g", ""));
  const hidden: string[] = [];
  let cells = 0;
  for (let pos = 0; pos < spec.value.length; pos++) {
    for (let b = 0x80; b <= 0xff; b++) {
      cells++;
      const value = spec.value.slice(0, pos) + String.fromCharCode(b) + spec.value.slice(pos + 1);
      const text = spec.prefix + value + spec.suffix;
      fresh.lastIndex = 0;
      if (fresh.exec(text)?.[0] !== text) hidden.push(`pos${pos}:0x${b.toString(16).toUpperCase()}`);
    }
  }
  return { hidden, cells };
}

function freeFormSpec(id: string): Extract<SweepSpec, { kind: "free-form" }> {
  const spec = HIGH_BYTE_SWEEP[id];
  if (spec?.kind !== "free-form") throw new Error(`${id} is not a free-form entry`);
  return spec;
}

test("oss01-every-catalog-pattern-is-classified-for-the-high-byte-sweep", (t) => {
  const { missing, stale } = unclassifiedPatternIds(SECRET_PATTERNS, HIGH_BYTE_SWEEP);
  assert.deepEqual(missing, [], "a catalog pattern has no HIGH_BYTE_SWEEP entry: declare it free-form (with an exemplar) or ascii-only (with a reason)");
  assert.deepEqual(stale, [], "HIGH_BYTE_SWEEP names an id that is not in SECRET_PATTERNS");
  for (const [id, spec] of Object.entries(HIGH_BYTE_SWEEP)) {
    if (spec.kind === "ascii-only") assert.ok(spec.reason.trim().length > 0, `${id}: an ascii-only entry must say why`);
    else {
      const control = spec.prefix + spec.value + spec.suffix;
      assert.equal(freshMatch(id, control), control, `${id}: control, the all-ASCII exemplar is matched whole`);
    }
  }
  const kinds = Object.values(HIGH_BYTE_SWEEP).map((s) => s.kind);
  t.diagnostic(`catalog patterns=${SECRET_PATTERNS.length} free-form=${kinds.filter((k) => k === "free-form").length} ascii-only=${kinds.filter((k) => k === "ascii-only").length}`);
});

/** The first match of a fresh, non-global copy of catalog pattern `id` in `text`. */
function freshMatch(id: string, text: string): string | undefined {
  const p = findPattern(id);
  return new RegExp(p.regex.source, p.regex.flags.replace("g", "")).exec(text)?.[0];
}

test("oss01-no-value-class-however-written-hides-a-high-byte", (t) => {
  let total = 0;
  for (const [id, spec] of Object.entries(HIGH_BYTE_SWEEP)) {
    if (spec.kind !== "free-form") continue;
    const { hidden, cells } = sweepEveryPosition(findPattern(id).regex, spec);
    total += cells;
    assert.equal(cells, spec.value.length * 128, `${id}: derived, every position times every high byte was tried`);
    assert.deepEqual(
      hidden,
      [],
      `pattern ${id} hides high byte(s) ${hidden.join(",")} somewhere in its value class, however that class is spelled`,
    );
  }
  assert.ok(total > 0, "non-vacuous: at least one free-form pattern was swept");
  t.diagnostic(`sweep cells=${total}`);
});

test("oss01-no-value-class-however-written-hides-a-high-byte: catches non-negated spellings the old guard missed (positive control)", () => {
  const shipped = findPattern("generic-password-assignment").regex.source;
  const classBody = negatedClasses(shipped)[0];
  assert.ok(classBody !== undefined, "control: the shipped source has a negated class to swap out");
  const shippedClass = `[^${classBody}]`;
  assert.ok(shipped.includes(shippedClass), "control: the exact class text is present in the shipped source");
  const flags = findPattern("generic-password-assignment").regex.flags.replace("g", "");
  const spec = freeFormSpec("generic-password-assignment");

  // Two of red-team's own demonstrated shapes -- neither is a negated class, so `negatedClasses()` (the
  // #249 guard's own extractor) finds NOTHING to probe in either mutated source, proving the old guard is
  // vacuous against them, while this whole-pattern sweep is not.
  // The shipped source's own trailing `{8,}` quantifier stays put -- only the class token itself
  // (`[^...]`) is swapped for an alternate spelling, never widened with a second quantifier.
  const alternateShapes: Record<string, string> = {
    "positive printable-ASCII class [\\x21-\\x7e]": "[\\x21-\\x7e]",
    "positive class [\\w!@#$%^&*()+=./-]": "[\\w!@#$%^&*()+=./-]",
  };
  for (const [label, altClass] of Object.entries(alternateShapes)) {
    const mutatedSource = shipped.replace(shippedClass, altClass);
    assert.notEqual(mutatedSource, shipped, `control: the substitution for ${label} actually changed the source`);
    assert.deepEqual(
      negatedClasses(mutatedSource),
      [],
      `control: ${label} is not a negated class -- the OLD guard's own extractor must be blind to it`,
    );
    const { hidden } = sweepEveryPosition(new RegExp(mutatedSource, flags), spec);
    assert.ok(
      hidden.length > 0,
      `${label}: this whole-pattern sweep must catch the same defect class the old, syntax-scoped guard missed`,
    );
  }
});

// Issue 270 shapes 5 and 6: a narrowing that bites only ONE end of the value. The old sweep spliced the
// byte at one interior offset, so it reported 0 hidden cells for both of these (measured before the fix);
// the every-position sweep must see each.
test("oss01-no-value-class-however-written-hides-a-high-byte: catches a first-character-only and a last-character-only narrowing (positive control)", () => {
  const shipped = findPattern("generic-password-assignment").regex.source;
  const classBody = negatedClasses(shipped)[0] ?? "";
  const cls = `[^${classBody}]{8,}`;
  assert.ok(shipped.includes(cls), "control: the shipped class token with its {8,} quantifier is present");
  const flags = findPattern("generic-password-assignment").regex.flags.replace("g", "");
  const spec = freeFormSpec("generic-password-assignment");

  const firstOnly = new RegExp(shipped.replace(cls, `(?!\\xa0)${cls}`), flags);
  const lastOnly = new RegExp(shipped.replace(cls, `[^${classBody}]{7,}(?<!\\xa0)`), flags);
  const interior = Math.floor(spec.value.length / 2);
  for (const [label, re] of [["first-character-only", firstOnly], ["last-character-only", lastOnly]] as const) {
    const { hidden } = sweepEveryPosition(re, spec);
    assert.ok(hidden.length > 0, `${label}: the every-position sweep must catch it`);
    assert.ok(hidden.every((c) => !c.startsWith(`pos${interior}:`)), `${label}: control, it bites at an END position, not at the interior offset the old sweep used`);
    // The pre-fix probe: one interior splice, on this same mutant, sees nothing.
    const oldStyle = spec.prefix + spec.value.slice(0, interior) + String.fromCharCode(0xa0) + spec.value.slice(interior + 1) + spec.suffix;
    assert.equal(re.exec(oldStyle)?.[0], oldStyle, `${label}: control, the single-interior-offset probe the old sweep used passes this mutant`);
  }
});

test("oss01-no-value-class-however-written-hides-a-high-byte: an unclassified 11th pattern fails coverage (positive control)", () => {
  const eleventh = { id: "synthetic-eleventh-pattern", description: "control", regex: /zz[a-z]{8}/g };
  const withEleventh = [...SECRET_PATTERNS, eleventh];
  assert.deepEqual(unclassifiedPatternIds(withEleventh, HIGH_BYTE_SWEEP), { missing: [eleventh.id], stale: [] }, "a pattern added to the catalog without a registry entry is reported");
  const withoutFirst = SECRET_PATTERNS.slice(1);
  assert.deepEqual(unclassifiedPatternIds(withoutFirst, HIGH_BYTE_SWEEP).stale, [SECRET_PATTERNS[0]?.id], "a registry entry whose pattern left the catalog is reported");
});
