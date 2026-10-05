// #308 story E0 (Issue #408): the CLOSED set of read-only shell commands the normalizer may resolve to verb `read` or
// `list`. Without it every ordinary Bash read (`ls`, `cat`, `grep`) reaches POL-05 unresolved and is denied once the gate
// is wired. Plan: docs/plans/s308-E0-readonly-shell-plan-2026-10-05.md. Design challenge:
// docs/reviews/s308-E0-readonly-shell-design-challenge-2026-10-04.md. Scope ruling: docs/decisions.md, session
// `s7/knockout` ruling 2 (git and rg stay out until #409; the #82 multi-target cap stays; any wrapper is unresolved).
//
// Pure data plus a pure matcher: no I/O, no environment, no clock (same shape as wrapper-catalog.ts). It decides only
// "does this whole simple command match one command's closed grammar", and returns the verb and the path operands. The
// caller (shell.ts) owns everything else: syntax pre-emption, wrapper and depth guards, redirect refusal, canonical
// targets, the multi-target cap, and the record.
//
// Closed by construction. A token that is not exactly a listed short flag, a bare integer, a bare path or (grep only)
// a safe pattern makes the whole command unclaimed; there is no partial claim. Disclosed non-goals:
//   - git and rg: not here. They run config- and env-driven helper programs (core.fsmonitor was measured to run on a
//     plain `git status`); #409 owns sealing those levers. find, sed, awk and the rest: not triaged, so not here.
//   - A shell alias, function, or a planted bare-name binary on a session-writable PATH directory is invisible to a
//     static parse (#428, a K blocker). Adding a binary to this table does not change that exposure class.
//   - `-d` and `-C` (directory flags) never reach this module: shell.ts's directory-flag gate returns first.

/** Raw view of one token: `value` is the dequoted text, `raw` the exact source span (quotes and backslashes intact). */
export interface RawToken {
  value: string;
  raw: string;
}

export interface ReadOnlyMatch {
  verb: "read" | "list";
  /** Path operands exactly as written (bare, so raw equals dequoted); `["."]` when the command defaults to the current directory. */
  operands: string[];
}

type PathlessRule = "never" | "always" | "recursive";

interface CommandSpec {
  verb: "read" | "list";
  /** Short flags that take no value; they may be clustered. */
  boolFlags: string;
  /** Short flags that take a 1 to 6 digit integer, glued (`-n20`) or as the next token; last in a cluster. */
  intFlags: string;
  /** A short flag whose next token is the pattern (grep `-e`), accepted at most once. */
  patternFlag?: string;
  /** The command's first non-flag operand is a pattern (grep), unless the pattern flag supplied it. */
  patternSlot: boolean;
  /** When zero path operands is acceptable, and the target is then `.`. */
  pathless: PathlessRule;
  /** Short flags that make a pathless grep legitimate (it searches the current directory). */
  recursiveFlags: string;
}

const SPECS: ReadonlyMap<string, CommandSpec> = new Map<string, CommandSpec>([
  ["ls", { verb: "list", boolFlags: "aAlh1trSFR", intFlags: "", patternSlot: false, pathless: "always", recursiveFlags: "" }],
  ["cat", { verb: "read", boolFlags: "nbsAETv", intFlags: "", patternSlot: false, pathless: "never", recursiveFlags: "" }],
  ["head", { verb: "read", boolFlags: "qv", intFlags: "nc", patternSlot: false, pathless: "never", recursiveFlags: "" }],
  ["tail", { verb: "read", boolFlags: "qv", intFlags: "nc", patternSlot: false, pathless: "never", recursiveFlags: "" }],
  ["wc", { verb: "read", boolFlags: "lwcmL", intFlags: "", patternSlot: false, pathless: "never", recursiveFlags: "" }],
  [
    "grep",
    { verb: "read", boolFlags: "iEFnrRlLcvwxHhIosq", intFlags: "ABm", patternFlag: "e", patternSlot: true, pathless: "recursive", recursiveFlags: "rR" },
  ],
]);

/** The table's command names, derived from the table (a new command must be added to SPECS, and the pin test then fails until triaged). */
export const READONLY_COMMAND_NAMES: readonly string[] = [...SPECS.keys()];

/** Cheap pre-check for the caller: is this raw first token EXACTLY a table name (bare, lowercase, no quoting)? */
export function isReadOnlyBinaryToken(token: RawToken | undefined): boolean {
  return token !== undefined && token.raw === token.value && SPECS.has(token.value);
}

const MAX_TOKENS = 32;
const MAX_PATH_OPERANDS = 8;
const MAX_OPERAND_LENGTH = 512;
const BARE_WORD = /^[A-Za-z0-9_./@%+,:=-]+$/;
const INT_VALUE = /^[0-9]{1,6}$/;
const FLAG_BODY = /^[A-Za-z0-9]+$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** A path operand: bare (raw equals dequoted, so the screened string is the recorded string), from a safe character set, not flag-shaped. */
function isBarePath(t: RawToken): boolean {
  return t.raw === t.value && t.value.length <= MAX_OPERAND_LENGTH && BARE_WORD.test(t.value) && !t.value.startsWith("-");
}

/** grep's pattern slot: a bare word, or a SINGLE-quoted span (inert to the shell) of printable ASCII with no inner quote. */
function isSafePattern(t: RawToken): boolean {
  if (isBarePath(t)) return true;
  if (t.raw.length < 3 || t.raw.length > MAX_OPERAND_LENGTH + 2) return false;
  if (!t.raw.startsWith("'") || !t.raw.endsWith("'") || t.raw.slice(1, -1) !== t.value) return false;
  return PRINTABLE_ASCII.test(t.value) && !t.value.includes("'") && !t.value.startsWith("-");
}

function isIntValue(t: RawToken | undefined): boolean {
  return t !== undefined && t.raw === t.value && INT_VALUE.test(t.value);
}

interface FlagResult {
  /** Index of the next unconsumed token. */
  next: number;
  recursive: boolean;
  pattern?: RawToken;
}

/** Parses one flag token (and a value token it owns) at `i`; undefined when anything is outside the closed grammar. */
function parseFlag(spec: CommandSpec, tokens: readonly RawToken[], i: number, patternAlreadySet: boolean): FlagResult | undefined {
  const t = tokens[i];
  if (t === undefined || t.raw !== t.value) return undefined;
  const body = t.value.slice(1);
  if (!FLAG_BODY.test(body)) return undefined;
  let recursive = false;
  for (let j = 0; j < body.length; j += 1) {
    const c = body.charAt(j);
    if (spec.recursiveFlags.includes(c)) recursive = true;
    if (spec.boolFlags.includes(c)) continue;
    const rest = body.slice(j + 1);
    if (spec.intFlags.includes(c)) {
      if (rest !== "") return INT_VALUE.test(rest) ? { next: i + 1, recursive } : undefined;
      return isIntValue(tokens[i + 1]) ? { next: i + 2, recursive } : undefined;
    }
    if (spec.patternFlag === c && rest === "" && !patternAlreadySet) {
      const p = tokens[i + 1];
      return p !== undefined && isSafePattern(p) ? { next: i + 2, recursive, pattern: p } : undefined;
    }
    return undefined;
  }
  return { next: i + 1, recursive };
}

/** Matches a whole simple command against the closed table. `tokens[0]` is the binary. Undefined means NOT claimed. */
export function matchReadOnly(tokens: readonly RawToken[]): ReadOnlyMatch | undefined {
  const first = tokens[0];
  if (!isReadOnlyBinaryToken(first) || first === undefined || tokens.length > MAX_TOKENS) return undefined;
  const spec = SPECS.get(first.value);
  if (spec === undefined) return undefined;

  const positionals: RawToken[] = [];
  let flagPattern: RawToken | undefined;
  let recursive = false;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) return undefined;
    if (t.raw.startsWith("-") || t.value.startsWith("-")) {
      const r = parseFlag(spec, tokens, i, flagPattern !== undefined);
      if (r === undefined) return undefined;
      recursive ||= r.recursive;
      flagPattern ??= r.pattern;
      i = r.next;
    } else {
      positionals.push(t);
      i += 1;
    }
  }

  let paths = positionals;
  if (spec.patternSlot && flagPattern === undefined) {
    const pattern = positionals[0];
    if (pattern === undefined || !isSafePattern(pattern)) return undefined;
    paths = positionals.slice(1);
  }
  if (paths.length > MAX_PATH_OPERANDS || !paths.every(isBarePath)) return undefined;
  if (paths.length === 0) {
    const ok = spec.pathless === "always" || (spec.pathless === "recursive" && recursive);
    return ok ? { verb: spec.verb, operands: ["."] } : undefined;
  }
  return { verb: spec.verb, operands: paths.map((p) => p.value) };
}
