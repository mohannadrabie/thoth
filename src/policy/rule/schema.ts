// POL-06: "Configuration shall be schema-validated and versioned, rejected with a message naming
// the offending key and expected shape." Acceptance: "Unknown key is an error, not a silent
// no-op."
//
// Operates on `unknown` input by design — S2 has no real config-file loader (see
// docs/decisions.md's 2026-09-01 S2 row; that is S6's job), but this validator is written to
// accept untyped/parsed-JSON-shaped input from day one so S6 can call it directly on a loader's
// parsed output with no rewrite. Lives outside the kernel purity boundary
// (src/policy/kernel/**) — the kernel never validates configuration itself (POL-11).
import type { ValidationError } from "../kernel/rule-types.ts";

const RULE_KEYS = ["id", "effect", "verbs", "targets", "environments", "rationale", "mandatory"] as const;
const RULE_SET_KEYS = ["version", "rules"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// === Stage-3 round-1 fix-now (2026-09-08), Issue #105 + red-team's extension [MED] ===
//
// Two silent-acceptance gaps in one family: `validateRuleSet` previously reported ZERO errors for
// (a) two rules sharing the same `id` inside one layer's `rules` array, and (b) a raw JSON document
// with a DUPLICATE top-level `"rules"` key (`JSON.parse` silently keeps only the LAST occurrence —
// there is no way to detect this from the parsed value alone, only from the raw source text).
// Both let `printer.ts`'s `findIndex()`-based origin-line lookup report the WRONG line for the
// winning rule (red-team's demonstrated B2/B3 attacks). Rejecting both here, at the schema-
// validation layer, closes the gap at its root: `loader.ts`'s `parseLayerText` never reaches
// `position-parser.ts`'s tokenizer for a document either of these checks rejects.

// === Stage-3 round-3 fix-now (2026-09-08), Issue #115 [MED], red-team round-2-demonstrated ===
//
// Round 1's `findDuplicateTopLevelKeys` compared each captured key's RAW, still-escaped source text
// (`"rules"` vs. `"rules"` — two different strings to a raw-text comparison). `JSON.parse`
// compares the UNESCAPED value (`r` = `r`, so both are the same key `rules` to the parser). A
// unicode-escaped duplicate top-level key therefore slipped straight past round 1's check, re-opening
// the exact wrong-origin-line defect Issue #105 was written to close (red-team round 2, finding 2).
//
// Round 1's own mistake, named plainly so it isn't repeated: comparing RAW text was itself a second,
// independent hand-rolled notion of "key identity", competing with `JSON.parse`'s authoritative one,
// instead of just asking `JSON.parse`'s own decoder to resolve the escape. The fix below does not add
// a third notion (a hand-rolled unescaper for `\n`/`\t`/`\uXXXX`/etc. would just be a SECOND
// reimplementation of the same logic `JSON.parse` already gets right) — it delegates the unescape
// step to `JSON.parse` itself (`unescapeJsonStringLiteral`, below), keeping this file's own
// responsibility to exactly one thing: finding where the top-level key TOKENS are in the raw text.
//
// `validateRuleSet` additionally asserts a TOKENIZER/PARSER-AGREEMENT INVARIANT (not a blocklist
// entry for one more escape shape): after unescaping, the raw-text scanner's own top-level key SET
// must equal `Object.keys(JSON.parse(text))` exactly, for ANY reason a divergence could occur — not
// only the specific unicode-escape shape red-team demonstrated. This is the standing-instrument
// answer this bug's own root cause calls for (two independent views of the same document, assumed
// to agree, never actually asserted to) — the same defect FAMILY as Issue #114 one file over
// (architecture-reviewer's council report names both as the same "locally-reimplemented signal
// substituted for the authoritative one" shape), fixed here by asserting agreement with the
// authoritative signal instead of reimplementing a competing one.

/** Delegates unescaping a captured JSON string-literal's raw (still-escaped) inner text to
 * `JSON.parse` itself — the authoritative decoder every other string value in this document is
 * already unescaped by — rather than hand-rolling a second `\n`/`\t`/`\uXXXX`/etc. unescaper that
 * could itself diverge from `JSON.parse`'s own rules. `raw` is always a value this file's own
 * scanner captured as the exact text between two quotes, so wrapping it back in quotes and parsing
 * reproduces exactly what a full `JSON.parse` of the whole document would have produced for that key.
 * Falls back to the raw text on a malformed sequence rather than throwing: in production this is
 * unreachable (the caller only ever supplies `rawText` after a full `JSON.parse` of the WHOLE
 * document already succeeded — see loader.ts's `parseLayerText` — so every captured key segment is
 * already a valid JSON string literal on its own); a direct/defensive test caller passing malformed
 * text still gets a safe, non-throwing (if imprecise) answer rather than a crash.
 *
 * Exported (Stage-3 round-3 re-confirm fix-now, 2026-09-08, Issue #119 [MED], red-team-demonstrated)
 * so `position-parser.ts`'s own top-level-"rules"-key detection can delegate to this SAME decoder
 * instead of comparing raw, still-escaped text — the same bug family (a competing, locally-
 * reimplemented notion of key identity, instead of asking the one authoritative decoder) Issue #115
 * was fixed for one file over, in this same file's `findTopLevelKeys`. */
export function unescapeJsonStringLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * Scans a raw JSON object's source text for every TOP-LEVEL `"key"` token (a key directly inside the
 * outermost `{}`, immediately followed by `:`), in document order, DUPLICATES INCLUDED, UNESCAPED.
 * A minimal, purpose-built scanner (not a general JSON parser, and deliberately NOT
 * `position-parser.ts`'s tokenizer: that module lives in `src/policy/config/`, one layer above
 * `src/policy/rule/`, and importing it here would invert this codebase's established layering —
 * config consumes rule validation, not the other way around). Walks the text once, tracking `{}`/`[]`
 * nesting depth and quoted-string state (respecting `\"` escapes so a brace/bracket/quote INSIDE a
 * string value is never mistaken for structure). This is the raw material both
 * `findDuplicateTopLevelKeys` and `validateRuleSet`'s own tokenizer/parser-agreement invariant are
 * built from.
 */
export function findTopLevelKeys(text: string): string[] {
  let depth = 0;
  let i = 0;
  const keys: string[] = [];

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      let raw = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          raw += (text[j] ?? "") + (text[j + 1] ?? "");
          j += 2;
        } else {
          raw += text[j];
          j++;
        }
      }
      i = j + 1; // past the closing quote
      if (depth === 1) {
        let k = i;
        while (k < text.length && /\s/.test(text[k] ?? "")) k++;
        if (text[k] === ":") {
          keys.push(unescapeJsonStringLiteral(raw));
        }
      }
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      i++;
      continue;
    }
    i++;
  }

  return keys;
}

/**
 * Detects duplicate TOP-LEVEL keys in a raw JSON object's source text — before `JSON.parse` has a
 * chance to silently collapse them to last-write-wins. Built on `findTopLevelKeys`'s UNESCAPED key
 * list (Issue #115 fix), so a duplicate expressed via a `\uXXXX`/`\n`/etc. escape in one occurrence
 * is caught exactly like a byte-identical literal duplicate. Returns the list of key names that
 * appear more than once at the top level.
 */
export function findDuplicateTopLevelKeys(text: string): string[] {
  const counts = new Map<string, number>();
  for (const key of findTopLevelKeys(text)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

/**
 * POL-06: validates a single rule. Every unknown key is reported (not silently dropped); every
 * error names the offending field (dotted path, honoring `pathPrefix` for nested callers) and the
 * expected shape.
 */
export function validateRule(input: unknown, pathPrefix = ""): ValidationError[] {
  const at = (field: string): string => (pathPrefix ? `${pathPrefix}.${field}` : field);

  if (!isRecord(input)) {
    return [{ message: "rule must be an object", field: pathPrefix || "<root>", expected: "object" }];
  }

  const errors: ValidationError[] = [];

  for (const key of Object.keys(input)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) {
      errors.push({
        message: `unknown key "${key}"`,
        field: at(key),
        expected: `one of: ${RULE_KEYS.join(", ")}`,
      });
    }
  }

  if (typeof input.id !== "string" || input.id.length === 0) {
    errors.push({ message: "id is required and must be a non-empty string", field: at("id"), expected: "non-empty string" });
  }

  if (input.effect !== "allow" && input.effect !== "deny") {
    errors.push({ message: 'effect must be "allow" or "deny"', field: at("effect"), expected: '"allow" | "deny"' });
  }

  for (const field of ["verbs", "targets", "environments"] as const) {
    if (field in input && input[field] !== undefined && !isStringArray(input[field])) {
      errors.push({ message: `${field} must be an array of strings`, field: at(field), expected: "string[]" });
    }
  }

  if ("rationale" in input && input.rationale !== undefined && typeof input.rationale !== "string") {
    errors.push({ message: "rationale must be a string", field: at("rationale"), expected: "string" });
  }

  // POL-07 (S6): the mandatory-lock flag. Boolean only — a truthy-but-non-boolean value (e.g. the
  // string "true") is rejected by name, same discipline as every other typed field here.
  if ("mandatory" in input && input.mandatory !== undefined && typeof input.mandatory !== "boolean") {
    errors.push({ message: "mandatory must be a boolean", field: at("mandatory"), expected: "boolean" });
  }

  return errors;
}

/**
 * POL-06: validates a whole rule set — versioned, schema-checked, every rule validated in turn.
 *
 * `rawText` (Stage-3 round-1 fix-now, Issue #105 + red-team's extension [MED]): OPTIONAL — when the
 * caller has the original, unparsed source text in hand (loader.ts's `parseLayerText` always does),
 * pass it here so a duplicate TOP-LEVEL key (e.g. two `"rules"` arrays in one document — see
 * `findDuplicateTopLevelKeys`'s own header) is rejected by name rather than silently resolved by
 * `JSON.parse`'s own last-write-wins behavior. Omitted by every existing direct-object-literal
 * caller in this file's own tests — that check simply doesn't run without it, same as before.
 */
export function validateRuleSet(input: unknown, rawText?: string): ValidationError[] {
  if (!isRecord(input)) {
    return [{ message: "rule set must be an object", field: "<root>", expected: "object" }];
  }

  const errors: ValidationError[] = [];

  for (const key of Object.keys(input)) {
    if (!(RULE_SET_KEYS as readonly string[]).includes(key)) {
      errors.push({
        message: `unknown key "${key}"`,
        field: key,
        expected: `one of: ${RULE_SET_KEYS.join(", ")}`,
      });
    }
  }

  if (rawText !== undefined) {
    const scannedKeys = findTopLevelKeys(rawText);
    const scannedKeyCounts = new Map<string, number>();
    for (const key of scannedKeys) scannedKeyCounts.set(key, (scannedKeyCounts.get(key) ?? 0) + 1);
    for (const [dupKey, count] of scannedKeyCounts) {
      if (count > 1) {
        errors.push({
          message: `duplicate top-level key "${dupKey}" — JSON.parse silently keeps only the LAST occurrence; rejected outright rather than silently resolved`,
          field: dupKey,
          expected: "each top-level key to appear at most once",
        });
      }
    }

    // Issue #115 [MED] fix (Stage-3 round 3): the TOKENIZER/PARSER-AGREEMENT INVARIANT — the
    // raw-text scanner's own (unescaped) top-level key SET must equal JSON.parse's own
    // Object.keys(input) exactly. This is general, not a blocklist entry for one more escape shape:
    // it fires on ANY divergence between the two independent views of "what are the top-level
    // keys", not only the specific unicode-escaped-duplicate shape red-team demonstrated. A
    // byte-identical-duplicate or escaped-duplicate document does NOT trip this (both views still
    // agree on the resulting SET once unescaped, even though a duplicate is present — that case is
    // already caught by the loop above); this catches the scanner disagreeing with JSON.parse for
    // any OTHER reason (a scanning bug, a future edge case neither of us has thought of yet).
    const scannedKeySet = new Set(scannedKeys);
    const parsedKeySet = new Set(Object.keys(input));
    const setsAgree = scannedKeySet.size === parsedKeySet.size && [...scannedKeySet].every((k) => parsedKeySet.has(k));
    if (!setsAgree) {
      errors.push({
        message: `the raw-text top-level key scan disagrees with JSON.parse's own key set (scanned: ${[...scannedKeySet].sort().join(", ")}; parsed: ${[...parsedKeySet].sort().join(", ")}) — rejected rather than trusting either view alone`,
        field: "<root>",
        expected: "the raw-text scanner and JSON.parse to agree on the document's top-level keys",
      });
    }
  }

  if (typeof input.version !== "string" || input.version.length === 0) {
    errors.push({ message: "version is required and must be a non-empty string", field: "version", expected: "non-empty string" });
  }

  if (!Array.isArray(input.rules)) {
    errors.push({ message: "rules is required and must be an array", field: "rules", expected: "Rule[]" });
    return errors;
  }

  const firstIndexById = new Map<string, number>();
  input.rules.forEach((rule: unknown, i: number) => {
    errors.push(...validateRule(rule, `rules[${i}]`));
    if (isRecord(rule) && typeof rule.id === "string" && rule.id.length > 0) {
      const firstIndex = firstIndexById.get(rule.id);
      if (firstIndex !== undefined) {
        errors.push({
          message: `duplicate rule id "${rule.id}" (first defined at rules[${firstIndex}], repeated at rules[${i}])`,
          field: `rules[${i}].id`,
          expected: "a unique id within this rule set",
        });
      } else {
        firstIndexById.set(rule.id, i);
      }
    }
  });

  return errors;
}
