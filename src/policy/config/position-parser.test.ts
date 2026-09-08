// AC10 (S6, design-challenger Attack E): the hand-rolled tokenizer's three named edge cases —
// CRLF line endings, an embedded ESCAPED newline inside a multi-line rationale string, and a
// non-ASCII rationale value — each get a dedicated, named test here, plus baseline
// tokenize()/findRulePositions() correctness tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRulePositions, tokenize } from "./position-parser.ts";

// --- baseline correctness ------------------------------------------------------------------------

test("tokenize: a minimal well-formed document produces the expected token types/positions", () => {
  const tokens = tokenize('{"a":1}');
  assert.deepEqual(
    tokens.map((t) => t.type),
    ["{", "string", ":", "number", "}"],
  );
  assert.deepEqual(tokens[0]?.start, { line: 1, column: 1 });
  assert.deepEqual(tokens[1]?.start, { line: 1, column: 2 });
});

test("findRulePositions: locates every direct-child object of a top-level \"rules\" array, in order, ignoring nested arrays/objects inside a rule", () => {
  const doc = [
    "{",
    '  "version": "1.0.0",',
    '  "rules": [',
    "    {",
    '      "id": "a",',
    '      "verbs": ["x", "y"]',
    "    },",
    "    {",
    '      "id": "b"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
  const positions = findRulePositions(tokenize(doc));
  assert.deepEqual(
    positions.map((p) => p.line),
    [4, 8],
  );
});

test("findRulePositions: a \"rules\"-named key that is NOT top-level (nested inside something else) is not mistaken for the real one", () => {
  const doc = ['{', '  "version": "1.0.0",', '  "nested": { "rules": [ { "id": "decoy" } ] },', '  "rules": [ { "id": "real" } ]', "}"].join(
    "\n",
  );
  const positions = findRulePositions(tokenize(doc));
  assert.equal(positions.length, 1, "only the TOP-LEVEL rules array's element should be reported");
  assert.equal(positions[0]?.line, 4);
});

// --- AC10 case 1: CRLF line endings ---------------------------------------------------------------

test("AC10: a CRLF-only document (no bare LF anywhere) parses with correct line numbers, one line break per CRLF pair (never two)", () => {
  const crlfDoc = [
    "{",
    '  "version": "1.0.0",',
    '  "rules": [',
    "    {",
    '      "id": "a"',
    "    },",
    "    {",
    '      "id": "b"',
    "    }",
    "  ]",
    "}",
  ].join("\r\n");
  assert.ok(crlfDoc.includes("\r\n") && !crlfDoc.replace(/\r\n/g, "").includes("\n"), "fixture sanity: must be CRLF-only");

  const positions = findRulePositions(tokenize(crlfDoc));
  assert.deepEqual(
    positions.map((p) => p.line),
    [4, 7],
    "each \\r\\n pair must count as exactly ONE line break, not two",
  );
});

// --- AC10 case 2: an embedded ESCAPED newline inside a multi-line rationale ------------------------

test("AC10: an embedded escaped \\n (POL-02 multi-line rationale) inside a string does NOT perturb subsequent rules' line numbers", () => {
  const doc = [
    "{",
    '  "version": "1.0.0",',
    '  "rules": [',
    "    {",
    '      "id": "a",',
    '      "rationale": "line one\\nline two\\nline three"',
    "    },",
    "    {",
    '      "id": "b"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
  // Fixture sanity: the rationale line contains the literal two-character escape sequence
  // (backslash, "n"), never a real newline byte — confirm the fixture itself has exactly 12
  // physical lines (not more), i.e. the embedded "\n" text did not accidentally become a real
  // newline when this file was authored.
  assert.equal(doc.split("\n").length, 12, "fixture sanity: the escape sequence must not have become a real newline");

  const positions = findRulePositions(tokenize(doc));
  assert.deepEqual(
    positions.map((p) => p.line),
    [4, 8],
    "the second rule's opening { must still be on line 8 -- unperturbed by the embedded escape sequence on line 6",
  );
});

// --- AC10 case 3: non-ASCII rationale — UTF-16-code-unit-consistent COLUMN counting -----------------

test("AC10: a non-ASCII rationale value (an astral-plane emoji, encoded as a UTF-16 surrogate PAIR) advances the column counter by 2, not 1 -- UTF-16-code-unit-consistent, not \"visual columns\"", () => {
  // Columns (1-indexed), by construction:
  //   {  "a"  :  "🔒"  ,  "b"  :  1  }
  //   1  2-4  5  6-9   10 11-13 14 15 16
  // The emoji occupies a surrogate PAIR (2 UTF-16 code units) at columns 7-8, inside the string
  // token spanning columns 6-9 (quote, surrogate, surrogate, quote = 4 code units).
  const doc = '{"a":"\u{1F512}","b":1}';
  const tokens = tokenize(doc);
  const types = tokens.map((t) => t.type);
  assert.deepEqual(types, ["{", "string", ":", "string", ",", "string", ":", "number", "}"]);

  const emojiStringToken = tokens[3];
  const commaToken = tokens[4];
  const bStringToken = tokens[5];
  assert.deepEqual(emojiStringToken?.start, { line: 1, column: 6 });
  assert.deepEqual(commaToken?.start, { line: 1, column: 10 }, "the emoji must count as 2 columns (surrogate pair), landing the comma at column 10, not 9");
  assert.deepEqual(bStringToken?.start, { line: 1, column: 11 });
});

test("AC10: a non-ASCII rationale value does not perturb a SUBSEQUENT rule's own line/column tracking", () => {
  const doc = [
    "{",
    '  "version": "1.0.0",',
    '  "rules": [',
    "    {",
    '      "id": "a",',
    '      "rationale": "café, emoji \u{1F512}"',
    "    },",
    "    {",
    '      "id": "b"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
  const positions = findRulePositions(tokenize(doc));
  assert.deepEqual(
    positions.map((p) => p.line),
    [4, 8],
  );
});
