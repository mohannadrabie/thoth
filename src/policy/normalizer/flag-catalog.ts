// Flag-name alias resolution + directory-flag recognition for src/policy/normalizer/shell.ts. Two
// distinct, small, named data concerns kept in one file (both are "special handling of a
// particular flag token" — the same reason-to-change, ADR-0003's SOLID split-by-responsibility
// bar draws the line at "unrelated" responsibilities, not "adjacent" ones).
//
// 1. KNOWN_FLAG_ALIASES / resolveFlagAlias — SUR-07's flag-abbreviation criterion (`story-
//    implementer`'s Phase 1 plan, Blocking Question 2, unchanged by design-challenger's round-1
//    report). Deliberately one entry (short "-c" -> canonical "context"), because "context" is the
//    only flag this codebase's documented grammar actually consumes today (see shell.ts).
//    Equals-form only ("-c=value"), not space-separated ("-c value") — space-separated short flags
//    are materially harder to disambiguate from positional tokens and were not asked for. Growing
//    this table for a new flag is a data addition (mirrors action-catalog.ts's own KNOWN_VERBS
//    convention), not a parser change.
//
// 2. DIRECTORY_FLAG_* / matchDirectoryFlagToken — design-challenger's S4 round-1 Finding #2
//    (docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md), ruled fix logged in
//    docs/decisions.md's 2026-09-02 "design-challenger's pre-build attack" row: a directory/chdir
//    -style flag (-C, -d, --directory) MUST NOT be silently invisible to the produced Action record
//    — SUR-07 names "directory flags" as a P0 acceptance case (REQUIREMENTS.md:463). This story
//    does NOT attempt to resolve WHERE the flag points or fold it into the target (the ruled fix is
//    explicit: "not new path-relative-target-joining/resolution logic ... satisfied by never
//    silently dropping the flag, not by resolving where it points") — presence alone is reported
//    via `unresolved`, fail-closed, the same pattern as every other ambiguity in this component.
//
//    WIDENED, S4 Stage-3 review (red-team Finding 3 / Issue #72, app-security Finding 2 /
//    Issue #69): the first cut only recognized `--directory=<v>` and bare `-C`/`-d` (two-token).
//    Three ordinary spellings slipped past — `--directory <v>` (long, space-separated), `-C=<v>`
//    and `-d=<v>` (short, equals-form) — and the worst of the three was a SECOND, compounding
//    defect: `-C=<v>` missed this guard entirely, fell through to shell.ts's generic short-flag
//    branch, and `resolveFlagAlias`'s lowercasing resolved `C` to the SAME canonical name `c`
//    aliases to (`context`) — a directory flag could silently SUPPLY the cluster field. Fixed by
//    widening `matchDirectoryFlagToken` to catch all 4 shapes; because it is checked BEFORE the
//    generic alias branch in shell.ts's `scanFlags`, the alias-collision closes as a direct
//    consequence of the coverage fix, not a second, separate patch.

const KNOWN_FLAG_ALIASES: ReadonlyMap<string, string> = new Map([["c", "context"]]);

/** Resolves an abbreviated (short, `-x=value`) flag name to its canonical long name. Returns
 * `undefined` for anything not in the table — callers must not guess at an unlisted alias. */
export function resolveFlagAlias(shortName: string): string | undefined {
  return KNOWN_FLAG_ALIASES.get(shortName.trim().toLowerCase());
}

const DIRECTORY_FLAG_LONG_EQUALS: ReadonlySet<string> = new Set(["directory"]);
const DIRECTORY_FLAG_SHORT_NEXT_TOKEN: ReadonlySet<string> = new Set(["C", "d"]);

export interface DirectoryFlagMatch {
  /** Number of tokens this match consumes: 1 for `--directory=value`, 2 for the two-token
   * `-C <value>` / `-d <value>` forms (the flag token plus its separate value token). */
  tokenSpan: 1 | 2;
}

/** Checks `tokens[i]` (and, for the two-token forms, implicitly `tokens[i + 1]` via `tokenSpan`)
 * for a recognized directory/chdir-style flag shape — all 4 ordinary spellings: `--directory=<v>`,
 * `--directory <v>`, `-C=<v>`/`-d=<v>`, `-C <v>`/`-d <v>`. Returns `undefined` when `tokens[i]` is
 * not a directory flag at all — callers fall through to ordinary flag/positional handling for that
 * token in that case. Checked BEFORE `resolveFlagAlias` in shell.ts's `scanFlags` — a directory
 * flag can never reach the generic alias-resolution path (see this file's own header comment). */
export function matchDirectoryFlagToken(tokens: readonly string[], i: number): DirectoryFlagMatch | undefined {
  const token = tokens[i] ?? "";

  // Long, equals-form: "--directory=<value>" (one token).
  const longEquals = /^--([a-zA-Z][\w-]*)=(.+)$/.exec(token);
  if (longEquals && DIRECTORY_FLAG_LONG_EQUALS.has((longEquals[1] ?? "").toLowerCase())) {
    return { tokenSpan: 1 };
  }
  // Long, space-separated form: "--directory <value>" (two tokens).
  if (token.startsWith("--") && !token.includes("=") && DIRECTORY_FLAG_LONG_EQUALS.has(token.slice(2).toLowerCase())) {
    return { tokenSpan: 2 };
  }
  // Short, equals-form: "-C=<value>" / "-d=<value>" (one token).
  const shortEquals = /^-([a-zA-Z])=(.+)$/.exec(token);
  if (shortEquals && DIRECTORY_FLAG_SHORT_NEXT_TOKEN.has(shortEquals[1] ?? "")) {
    return { tokenSpan: 1 };
  }
  // Short, space-separated form: "-C <value>" / "-d <value>" (two tokens).
  const shortForm = /^-([a-zA-Z])$/.exec(token);
  if (shortForm && DIRECTORY_FLAG_SHORT_NEXT_TOKEN.has(shortForm[1] ?? "")) {
    return { tokenSpan: 2 };
  }
  return undefined;
}
