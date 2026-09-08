// POL-10 (S6): printer.ts needs the ORIGIN LINE of every resolved rule ("origin file and line of
// every rule ... one command answers 'why is this blocked'"). This is a minimal, dependency-free
// JSON tokenizer that tracks {line, column} for every token's START position, computed from a
// SINGLE linear scan of the RAW, UNMODIFIED source text — never from an unescaped/transformed copy
// of a string's value.
//
// This decoupling is deliberate (design-challenger S6 Attack E): a JSON string can encode a
// multi-line rationale (POL-02) ONLY via the ESCAPE SEQUENCE `\n` (two ordinary characters,
// backslash then the letter "n") — valid JSON forbids a literal, unescaped newline byte inside a
// string. Counting REAL `\r\n` / bare `\n` / bare `\r` byte sequences found anywhere in the raw
// text — string content included — is therefore already correct by construction: an escaped `\n`
// contains no real newline byte to miscount, and a genuine newline between tokens is always a real
// byte. The mistake this file specifically avoids is the INVERSE one: unescaping a string into its
// final JS value first (turning the two-character `\n` into a real newline in a working buffer)
// and then re-scanning THAT buffer for position tracking — which would silently invent a line
// break that never existed in the source. This tokenizer never does that: it never computes a
// string token's unescaped VALUE at all (JSON.parse — already used by
// src/policy/rule/schema.ts's validateRuleSet, via loader.ts — does that correctly, escapes
// included; this file answers "what line/column did this token start on", nothing else).
//
// Column counting is UTF-16-code-unit-consistent (AC10), not "visual columns": iteration is by
// string index (JS's native per-code-unit indexing) — an astral-plane emoji (encoded as a
// surrogate PAIR) advances the column counter by 2, matching how every other module in this
// codebase already indexes JS strings (no code-point-aware `for...of` iteration anywhere here).
//
// Scope, disclosed rather than assumed (PRINCIPLES rule 18): this function is only ever called
// (by loader.ts) on text that has ALREADY passed `JSON.parse` and `validateRuleSet` successfully —
// it does not itself validate JSON grammar, and a malformed input may produce an incomplete or
// nonsensical token list rather than a thrown error. That is acceptable because schema/parse
// validation always runs first and rejects malformed input before this function is ever reached.

export interface Position {
  /** 1-indexed. */
  line: number;
  /** 1-indexed, UTF-16 code units — not a "visual column" count. */
  column: number;
}

export type TokenType = "{" | "}" | "[" | "]" | ":" | "," | "string" | "number" | "true" | "false" | "null";

export interface Token {
  type: TokenType;
  /** Raw source text this token spans. For "string", this INCLUDES the surrounding quotes and any
   * escape sequences, unparsed/unescaped (see this file's header for why). */
  raw: string;
  start: Position;
}

const PUNCTUATORS: Record<string, TokenType> = { "{": "{", "}": "}", "[": "[", "]": "]", ":": ":", ",": "," };

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Tokenizes `source` as JSON, tracking line/column across a single linear scan. See this file's
 * header for the scope disclosure (well-formed input only) and the CRLF / escaped-newline /
 * non-ASCII correctness reasoning.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  function advance(count = 1): void {
    for (let k = 0; k < count; k++) {
      const ch = source[i];
      if (ch === "\r") {
        // CRLF counts as exactly ONE line break, never two — consume the paired \n here too.
        if (source[i + 1] === "\n") i++;
        line++;
        column = 1;
        i++;
      } else if (ch === "\n") {
        line++;
        column = 1;
        i++;
      } else {
        column++;
        i++;
      }
    }
  }

  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      advance();
      continue;
    }

    const start: Position = { line, column };

    const punctuator = PUNCTUATORS[ch];
    if (punctuator !== undefined) {
      advance();
      tokens.push({ type: punctuator, raw: ch, start });
      continue;
    }

    if (ch === '"') {
      const startIndex = i;
      advance(); // opening quote
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") {
          // Skip the backslash AND the next character as one unit — safe even for `\uXXXX`: the
          // 4 following hex digits are then consumed as ordinary characters by later iterations,
          // harmless since hex digits are never a quote, a backslash, or a real newline byte.
          advance(2);
        } else {
          advance();
        }
      }
      advance(); // closing quote (input is assumed well-formed — see header)
      tokens.push({ type: "string", raw: source.slice(startIndex, i), start });
      continue;
    }

    if (ch === "-" || isDigit(ch)) {
      const startIndex = i;
      if (source[i] === "-") advance();
      while (isDigit(source[i])) advance();
      if (source[i] === ".") {
        advance();
        while (isDigit(source[i])) advance();
      }
      if (source[i] === "e" || source[i] === "E") {
        advance();
        if (source[i] === "+" || source[i] === "-") advance();
        while (isDigit(source[i])) advance();
      }
      tokens.push({ type: "number", raw: source.slice(startIndex, i), start });
      continue;
    }

    if (source.startsWith("true", i)) {
      advance(4);
      tokens.push({ type: "true", raw: "true", start });
      continue;
    }
    if (source.startsWith("false", i)) {
      advance(5);
      tokens.push({ type: "false", raw: "false", start });
      continue;
    }
    if (source.startsWith("null", i)) {
      advance(4);
      tokens.push({ type: "null", raw: "null", start });
      continue;
    }

    // Unrecognized character — skip it rather than throw. Per this file's header, malformed input
    // is already excluded by the time this runs; a single stray character here should not abort
    // the whole scan (loader.ts only uses this for *already-valid* JSON's own line numbers).
    advance();
  }

  return tokens;
}

/** Strips the surrounding quotes from a simple (no meaningful escapes expected) string token's
 * raw text — used only to compare a key name against a literal like "rules", never to recover a
 * general string's real value (JSON.parse already does that correctly, escapes included). */
function unquoteSimple(raw: string): string {
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/**
 * Walks a token stream (from `tokenize`) looking for a TOP-LEVEL `"rules"` key (a key directly
 * inside the outermost `{}`) followed by `:` and a `[` array, and returns the start `Position` of
 * every direct-child object (`{`) inside that array, in array order — index-aligned with the
 * `RuleSet.rules` array `JSON.parse` produces from the SAME source text. Returns `[]` if no
 * top-level "rules" array is found (schema validation, not this function, is responsible for
 * rejecting a document missing "rules" — this helper just reports what it can find).
 */
export function findRulePositions(tokens: readonly Token[]): Position[] {
  const positions: Position[] = [];
  let depth = 0;
  let rulesArrayDepth: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    if (tok.type === "{" || tok.type === "[") {
      if (tok.type === "{" && rulesArrayDepth !== null && depth === rulesArrayDepth) {
        positions.push(tok.start);
      }
      if (tok.type === "[" && rulesArrayDepth === null && depth === 1) {
        const prevColon = tokens[i - 1];
        const prevKey = tokens[i - 2];
        if (prevColon?.type === ":" && prevKey?.type === "string" && unquoteSimple(prevKey.raw) === "rules") {
          rulesArrayDepth = depth + 1;
        }
      }
      depth++;
      continue;
    }

    if (tok.type === "}" || tok.type === "]") {
      depth--;
      if (tok.type === "]" && rulesArrayDepth !== null && depth === rulesArrayDepth - 1) {
        rulesArrayDepth = null;
      }
      continue;
    }
  }

  return positions;
}
