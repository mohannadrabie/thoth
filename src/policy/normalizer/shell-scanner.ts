// S4 (Milestone #22, CRITICAL tier): the quote/heredoc-aware raw-text primitives shell.ts composes
// over. Deliberately free of ActionRecord/verb/target knowledge (ADR-0003 SOLID: parsing is a
// distinct reason-to-change from ActionRecord-building) — every function here operates on plain
// strings only.
//
// Quoting model (bounded, not a full shell grammar per the 2026-09-02 decision row): a
// single-quoted span is fully inert — real shells give backslash no special meaning inside single
// quotes, and neither do we. A double-quoted span is "live" for command/process substitution
// (`$(...)`, backtick) exactly as a real shell evaluates it there, but inert for chain operators
// (`&&`/`;`/`|`/`||`), which are literal text inside double quotes. Backslash-escaping is
// recognized only far enough to find the real closing quote (`\"`/`\\` inside a double-quoted
// span; nothing inside a single-quoted span; `\'`/`\"` outside any quote making that character
// literal rather than an opener). An UNTERMINATED quote (the walk reaches end-of-string still
// "inside" a span) is a distinct, always-checked-first condition — see `hasUnterminatedQuote`.

export type QuoteState = "none" | "single" | "double";

/** Single source of truth for the quote walk — `quoteStates` and `hasUnterminatedQuote` are both
 * thin wrappers over this. `perChar[i]` is the state ACTIVE AT character `i` (a quote delimiter
 * character itself carries the state of the span it opens/closes — the SAME state whether it is
 * the opening or the closing delimiter). `final` is the state the walk ends in AFTER the last
 * character is processed — a DIFFERENT signal from `perChar`'s last entry: a properly-closed quote
 * whose closing delimiter is the very last character of `text` has `perChar[last] === "single"`
 * (that delimiter's own recorded state) but `final === "none"` (the walk closed it); only an
 * unterminated quote has `final !== "none"`. Never determine "unterminated" from `perChar` alone —
 * that was Issue #68's follow-up bug, caught by this file's own regression test.
 *
 * `escaped[i]` (red-team round-3 re-confirm, Finding 1 / Issue #83) is a SEPARATE, additive
 * companion array — `perChar` keeps its exact existing meaning ("what quote span is this character
 * inside") for every current caller; `escaped[i]` answers a DIFFERENT question ("is this character
 * a backslash-escaped literal, immediately following a live backslash outside any quote"), which
 * `perChar` alone cannot answer (an escaped character's span-state is still "none", identical to an
 * ordinary live one — that identity is exactly what #83 exploited). Marked ONLY for the unquoted
 * ("none"-state) backslash branch: this is the one case where a caller checking `states[i] !== "none"`
 * to mean "live" is actually wrong, because bash treats a backslash-escaped operator character
 * outside any quote as ordinary literal text, not as a live operator. */
function walkQuoteState(text: string): { perChar: QuoteState[]; final: QuoteState; escaped: boolean[] } {
  const perChar: QuoteState[] = new Array<QuoteState>(text.length);
  const escaped: boolean[] = new Array<boolean>(text.length).fill(false);
  let state: QuoteState = "none";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (state === "none") {
      if (ch === "\\" && i + 1 < text.length) {
        perChar[i] = state;
        perChar[i + 1] = state;
        escaped[i + 1] = true;
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        state = ch === "'" ? "single" : "double";
        perChar[i] = state;
        i += 1;
        continue;
      }
      perChar[i] = state;
      i += 1;
      continue;
    }
    if (state === "single") {
      perChar[i] = state;
      if (ch === "'") state = "none";
      i += 1;
      continue;
    }
    // state === "double"
    if (ch === "\\" && i + 1 < text.length) {
      perChar[i] = state;
      perChar[i + 1] = state;
      i += 2;
      continue;
    }
    perChar[i] = state;
    if (ch === '"') state = "none";
    i += 1;
  }
  return { perChar, final: state, escaped };
}

/** The quote state ACTIVE AT each character of `text`. See `walkQuoteState`'s own comment for the
 * exact delimiter-character convention. */
export function quoteStates(text: string): QuoteState[] {
  return walkQuoteState(text).perChar;
}

/** True at exactly the positions immediately following a live (unquoted) backslash — i.e., a
 * character bash treats as an ESCAPED LITERAL rather than a live operator/marker character, even
 * though `quoteStates` reports its own span-state as "none" (outside any quote). Round 3 red-team
 * re-confirm, Finding 1 (Issue #83): a caller that only checks `states[i] !== "none"` still misreads
 * a backslash-escaped operator character (e.g. `\>`) as live, because `perChar`'s "none" means
 * "not inside a quote," not "not escaped" — those are different questions with the same answer for
 * every ordinary live character, which is exactly what made the two easy to conflate. Companion to
 * `quoteStates`, not a replacement: every existing "is this state 'none'" check keeps its current,
 * unchanged meaning; a caller that also needs escape-awareness ANDs this in explicitly, rather than
 * this file growing a fourth independent raw-character check of the same underlying property. */
export function escapedChars(text: string): boolean[] {
  return walkQuoteState(text).escaped;
}

// app-security-reviewer, S4 Stage-3 review, Finding 1 (Issue #68): a quote opened but never
// closed made every character from the opening quote to end-of-string permanently "quoted-inert"
// to every other check in this module (chain-operator detection AND command-substitution
// detection both silently disabled by the same single stray character). This is checked FIRST,
// ahead of every other syntax check (shell.ts's collectSyntaxUnresolved), because once a quote is
// unterminated, quoteStates' model of the rest of the string is meaningless — there is nothing
// trustworthy left to check with it.
/** True when `text` ends while the quote walk is still inside a single- or double-quoted span —
 * i.e. an unmatched `'` or `"` somewhere in `text`. Uses the walk's FINAL state, not
 * `quoteStates`'s per-character array — see `walkQuoteState`'s comment for why those two differ
 * for a quote closed by the very last character of `text`. */
export function hasUnterminatedQuote(text: string): boolean {
  return walkQuoteState(text).final !== "none";
}

// red-team, S4 Stage-3 review, Finding 1 (Issue #70): the original 4-operator table
// (`&&`, `||`, `;`, `|`) omitted the two separators that need NO special syntax at all — a bare
// newline and a bare (non-doubled) `&` — both of which start a genuinely separate command in real
// bash. Kept as its own check, not folded into CHAIN_OPERATORS, because both need an "is there
// live content after it" guard the other four do not: a bare TRAILING `&` is SUR-09's nohup-style
// background marker (not a hidden second command — `wrapper-catalog.ts`'s `nohup-background`
// entry owns that shape), and a bare trailing newline is ordinary string formatting, not
// chaining. Only a NON-trailing occurrence of either one actually hides a second command.
const CHAIN_OPERATORS = ["&&", "||", ";", "|"] as const;

/** SUR-06a: the first chaining operator (`&&`, `;`, `|`, `||`) found OUTSIDE any quoted span, or
 * `undefined` if none. SUR-06b: a chain-operator-shaped substring fully inside a single- OR
 * double-quoted span is never live — this function only reports `state === "none"` matches. */
export function findLiveChainOperator(text: string): string | undefined {
  const states = quoteStates(text);
  for (let i = 0; i < text.length; i++) {
    for (const op of CHAIN_OPERATORS) {
      if (!text.startsWith(op, i)) continue;
      // Every character of the candidate operator must be live (states[i] itself included, via
      // k=0) — the single source of truth for SUR-06b's "fully outside any quoted span" bar.
      let allLive = true;
      for (let k = 0; k < op.length; k++) {
        if (states[i + k] !== "none") {
          allLive = false;
          break;
        }
      }
      if (allLive) return op;
    }
  }
  return undefined;
}

export function hasLiveChainOperator(text: string): boolean {
  return findLiveChainOperator(text) !== undefined;
}

/** True when `text[pos]` is a genuinely LIVE `>` character: not out of bounds, not inside any
 * quoted span, and — round 3 re-confirm, Finding 1 (Issue #83) — not a backslash-escaped literal
 * either. Shared by `findLiveTrailingSensitiveSeparator`'s fd-dup-adjacency check and
 * `findLiveRedirectMatches`'s own operator-liveness check, so "is this `>` live" is answered in
 * exactly one place rather than re-derived at each call site (the recurring failure shape #83's own
 * report names directly). */
function isLiveGreaterThan(
  text: string,
  states: readonly QuoteState[],
  escaped: readonly boolean[],
  pos: number,
): boolean {
  return pos >= 0 && pos < text.length && text[pos] === ">" && states[pos] === "none" && !escaped[pos];
}

/** red-team Finding 1 (Issue #70): a live newline, or a live single `&` (not part of `&&`), that
 * has more live command content after it — bash command separators the 4-entry table above
 * cannot express uniformly because both need the "is this trailing" exemption. Returns a
 * human-readable label for whichever separator matched first (`"\n"` or `"&"`), or `undefined`.
 *
 * red-team round-2, Finding N2 (Issue #81): an `&` directly adjacent to a live `>` — either side
 * (`2>&1`, `>&`, or `&>`/`&>>`) — is the fd-dup idiom (REQUIREMENTS.md:173 names "fd-dup ampersand
 * handling" as in-scope), not a command separator. Adjacency (no space) is what distinguishes the
 * idiom from a real separator; a space breaks it into two ordinary tokens, which is why this only
 * checks the IMMEDIATELY neighboring character, not "any `>` nearby."
 *
 * red-team round-3 re-confirm, Finding 1 (Issue #83): the ORIGINAL fix for #81 compared the raw
 * neighbouring character to `">"` with no check that it was actually LIVE — a backslash-escaped `\>`
 * (an ordinary, inert argument character in bash, no redirect at all) satisfied that raw comparison
 * just as well as a genuine live operator, so the `&` right after it was wrongly excluded as
 * "fd-dup," when in real bash it is a genuine background separator. `isLiveGreaterThan` (above) now
 * requires the neighbour be both unquoted AND unescaped before it counts as fd-dup-adjacent. */
export function findLiveTrailingSensitiveSeparator(text: string): string | undefined {
  const states = quoteStates(text);
  const escaped = escapedChars(text);
  for (let i = 0; i < text.length; i++) {
    if (states[i] !== "none") continue;
    const ch = text[i];
    const isNewline = ch === "\n";
    const isSingleAmpersand =
      ch === "&" &&
      text[i + 1] !== "&" &&
      text[i - 1] !== "&" &&
      !isLiveGreaterThan(text, states, escaped, i + 1) &&
      !isLiveGreaterThan(text, states, escaped, i - 1);
    if (!isNewline && !isSingleAmpersand) continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
    if (j < text.length) return isNewline ? "\\n" : "&";
  }
  return undefined;
}

// design-challenger, S4 round-1 Finding #1 (docs/reviews/s4-shell-semantic-detector-design-
// challenger-2026-09-02.md): command/process substitution is indirect execution that needs no
// chain operator and no named wrapper binary to run. Detected, never recursively resolved (that is
// a materially larger, unbounded mechanism explicitly out of S4's bar) — presence alone denies.
const SUBSTITUTION_MARKERS = ["$(", "`", "<(", ">("] as const;

/** The first live command/process-substitution marker (`$(`, backtick, `<(`, `>(`), or `undefined`.
 * "Live" here means NOT inside a single-quoted span — a real shell still evaluates `$(...)` inside
 * double quotes, so double-quoted spans count as live for this check (unlike chain operators). */
export function findLiveSubstitution(text: string): string | undefined {
  const states = quoteStates(text);
  for (let i = 0; i < text.length; i++) {
    for (const marker of SUBSTITUTION_MARKERS) {
      if (!text.startsWith(marker, i)) continue;
      // Every character of the candidate marker must be live (states[i] itself included, via
      // k=0) — the single source of truth for "not inside a single-quoted span."
      let allLive = true;
      for (let k = 0; k < marker.length; k++) {
        if (states[i + k] === "single") {
          allLive = false;
          break;
        }
      }
      if (allLive) return marker;
    }
  }
  return undefined;
}

export function hasLiveSubstitution(text: string): boolean {
  return findLiveSubstitution(text) !== undefined;
}

// red-team, S4 Stage-3 review, Finding 2 (Issue #71): against "<<<DELIM", the ORIGINAL regex
// (`/<<(-)?\s*(['"]?)([A-Za-z_]\w*)\2/g`) failed to match starting at index 0 (the third "<" isn't
// a valid identifier-start character) but the `g`-flag scan then matched starting at index 1,
// reading the 2nd and 3rd "<" as an ordinary heredoc marker's "<<" and "DELIM" as its identifier —
// silently mis-detecting a `<<<` HERESTRING (a single-line construct with no body at all) as a
// real heredoc, and swallowing every following line as inert "body". Fixed with a lookbehind AND
// lookahead: a genuine heredoc marker's "<<" must have neither a third "<" immediately before it
// NOR immediately after it — exactly two consecutive "<" characters, no more, no fewer.
function findLiveHeredocMarker(line: string): { delimiter: string; stripTabs: boolean } | undefined {
  const states = quoteStates(line);
  const re = /(?<!<)<<(?!<)(-)?\s*(['"]?)([A-Za-z_]\w*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const idx = m.index;
    if (states[idx] === "none" && states[idx + 1] === "none") {
      return { delimiter: m[3] ?? "", stripTabs: m[1] === "-" };
    }
  }
  return undefined;
}

export interface HeredocStripResult {
  /** `raw` with every heredoc BODY (the lines between the marker line and the terminating
   * delimiter line) removed. Every marker's own line — including anything after the marker on that
   * same line, such as a trailing redirect (SUR-08) — is preserved byte-for-byte. */
  liveText: string;
  /** Each heredoc body's content (lines joined with "\n"), in the order the markers were found. */
  bodies: string[];
}

/** SUR-08: heredoc body consumption never eats a redirect on the marker's own line. Operates
 * line-by-line: a live (unquoted) `<<[-]DELIM` marker starts body consumption on the FOLLOWING
 * line, ending at (and excluding) the first line that equals DELIM exactly (tabs stripped first
 * when the marker used `<<-`). Body content is never scanned as live syntax by any other function
 * in this module — it is a distinct return field the caller may inspect only when a wrapper
 * (e.g. `at`) explicitly wants heredoc body content as its inner command. */
export function stripHeredocBodies(raw: string): HeredocStripResult {
  const lines = raw.split("\n");
  const outputLines: string[] = [];
  const bodies: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const marker = findLiveHeredocMarker(line);
    if (!marker) {
      outputLines.push(line);
      i += 1;
      continue;
    }
    outputLines.push(line);
    i += 1;
    const bodyLines: string[] = [];
    while (i < lines.length) {
      const bodyLine = lines[i] ?? "";
      const trimmed = marker.stripTabs ? bodyLine.replace(/^\t+/, "") : bodyLine;
      if (trimmed === marker.delimiter) {
        i += 1;
        break;
      }
      bodyLines.push(bodyLine);
      i += 1;
    }
    bodies.push(bodyLines.join("\n"));
  }
  return { liveText: outputLines.join("\n"), bodies };
}

/** A single live `>`/`>>` match. `idx`/`length` describe the operator CHARACTERS themselves (used
 * to slice past them for target extraction). `tokenStart` is where `tokenizeWithOffsets` would
 * report this same construct's token beginning — identical to `idx` for a bare `>`/`>>`, but ONE
 * EARLIER when the operator is prefixed by a live `&` (the `&>`/`&>>` both-streams form is one
 * token starting at the `&`, not at the `>`) — needed so `shell.ts`'s position-based exclusion
 * (Issue #80) recognizes `&>` as a redirect token too, not just a bare `>`. */
interface LiveRedirectMatch {
  idx: number;
  length: number;
  tokenStart: number;
}

/** The one shared scan `extractRedirectTargets` and `findLiveRedirectOperatorPositions` both
 * build on — single source of truth for what counts as a live, FILE-TARGETING redirect operator.
 * Excludes the fd-dup ampersand idiom (`2>&1`, bare `>&2`) round 3's Finding N2 / Issue #81 also
 * fixed for `findLiveTrailingSensitiveSeparator`: a `>` immediately followed by `&` duplicates a
 * file descriptor onto another — it creates no file and has no path target, so treating the text
 * right after it (`&1`) as a path (the pre-round-3 behavior) fabricated a bogus target. `&>`/`&>>`
 * (redirect BOTH streams to a real file) is unaffected — that shape's `>` is preceded by `&`, not
 * followed by it, and still correctly extracts its real file target.
 *
 * red-team round-3 re-confirm, Finding 1 (Issue #83): the quote check above (`states[idx] !== "none"`)
 * answers "is this `>` inside a quote," not "is this `>` backslash-escaped" — a `\>` outside any
 * quote has `states[idx] === "none"` identically to a genuinely live `>`, so this scan wrongly
 * treated an escaped literal as a real redirect operator (e.g. `echo a \> b` wrongly "extracted"
 * `b` as a write target). Now also skips an escaped leading `>` via `escapedChars` — resuming the
 * scan right after just the escaped character (`re.lastIndex = idx + 1`), not past the whole
 * matched run, so a genuinely live second `>` glued directly onto an escaped one (`\>>x`) is still
 * found as its own, real, single-character redirect. */
function findLiveRedirectMatches(liveText: string): LiveRedirectMatch[] {
  const states = quoteStates(liveText);
  const escaped = escapedChars(liveText);
  const re = />{1,2}/g;
  const matches: LiveRedirectMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(liveText)) !== null) {
    const idx = m.index;
    if (states[idx] !== "none") continue;
    if (escaped[idx]) {
      re.lastIndex = idx + 1;
      continue;
    }
    const length = m[0].length;
    const precededByLiveAmpersand =
      idx > 0 && liveText[idx - 1] === "&" && states[idx - 1] === "none" && !escaped[idx - 1];
    if (liveText[idx + length] === "&") {
      // Issue #84 (red-team round-4): bash treats '>&DIGIT' and '>&-' as a fd-dup (no file
      // created, no path target) but '>&WORD' (spaced or glued — the historical synonym for
      // '&>WORD', both streams to a REAL file) as an ordinary file redirect. The skip below is
      // conditional on the character IMMEDIATELY after the '&' being a digit or '-' — mirroring
      // `precededByLiveAmpersand`'s own single-character adjacency check just above, not a full
      // run-of-digits validation (a deliberately narrow fix: docs/decisions.md's 2026-09-06
      // second-stall ruling explicitly declined a broader redirect-classification grammar rewrite).
      const afterAmpersand = liveText[idx + length + 1];
      const isFdDup = afterAmpersand === "-" || (afterAmpersand !== undefined && /\d/.test(afterAmpersand));
      if (isFdDup) continue; // fd-dup destination ('>&DIGIT' / '>&-'), not a file path
      // '>&WORD': the '&' is part of the operator itself (equivalent to '&>WORD'), not a separate
      // token — extend `length` by 1 so target extraction (extractRedirectTargets) and the token
      // exclusion (findLiveRedirectOperatorPositions) both start right after the '&', not the '>'.
      matches.push({ idx, length: length + 1, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });
      continue;
    }
    matches.push({ idx, length, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });
  }
  return matches;
}

/** EVERY path token following a live (unquoted) `>`/`>>` redirect in `liveText`, quotes stripped,
 * in the order they occur — never just the first (red-team, S4 Stage-3 review, Finding 5 /
 * Issue #74: a real shell opens and truncates EVERY redirect target on the line, not only the
 * first, and stdout lands on the last). Empty array when no live, file-targeting redirect exists
 * (a fd-dup redirect contributes nothing — see `findLiveRedirectMatches`). */
export function extractRedirectTargets(liveText: string): string[] {
  const targets: string[] = [];
  for (const { idx, length } of findLiveRedirectMatches(liveText)) {
    const rest = liveText.slice(idx + length);
    // Reuses the same quote-aware tokenizer as everything else in this module, rather than a
    // naive `\S+` whitespace match — a quoted target containing live whitespace (e.g.
    // `> "/path with spaces/file"`) must be read as ONE token, not truncated at its first space.
    const [target] = tokenize(rest);
    if (target) targets.push(target);
  }
  return targets;
}

export interface OffsetToken {
  /** The dequoted token value — identical to what `tokenize` returns at the same array index. */
  value: string;
  /** Character index into the ORIGINAL `liveText` where this token begins (the first raw
   * character, quote delimiter included if the token opens with one). Used by `shell.ts`'s
   * `scanFlags` to exclude a redirect operator token by POSITION rather than by value (red-team
   * round-2, Finding N1 / Issue #80: a quoted literal `">"` argument is indistinguishable from a
   * live operator by value alone once quoting is already stripped, so value-based exclusion
   * silently swallows a legitimate token that merely LOOKS like an operator after dequoting). */
  start: number;
}

/** Quote-aware whitespace tokenizer, offset-tracking core. A quoted span becomes part of one
 * token — the enclosing quote DELIMITER characters are stripped from the token's value (SUR-07:
 * quoted binary/verb/resource tokens resolve identically to their bare form), but the content,
 * including any live-inside-quote whitespace or chain-operator-shaped text, is preserved verbatim
 * (SUR-06b). A backslash escape outside a single-quoted span keeps the escaped character literal
 * and drops the backslash itself. `tokenize` (below) is a thin wrapper over this — single source
 * of truth, same lesson this file already learned once for `quoteStates`/`hasUnterminatedQuote`. */
export function tokenizeWithOffsets(liveText: string): OffsetToken[] {
  const states = quoteStates(liveText);
  const tokens: OffsetToken[] = [];
  let current = "";
  let start = -1;
  let inToken = false;
  let i = 0;
  const n = liveText.length;
  while (i < n) {
    const ch = liveText[i] ?? "";
    if (states[i] === "none" && /\s/.test(ch)) {
      if (inToken) {
        tokens.push({ value: current, start });
        current = "";
        inToken = false;
      }
      i += 1;
      continue;
    }
    if (!inToken) {
      inToken = true;
      start = i;
    }
    if (ch === "\\" && states[i] !== "single" && i + 1 < n) {
      current += liveText[i + 1] ?? "";
      i += 2;
      continue;
    }
    // Only drop a quote character when it is genuinely acting as ITS OWN delimiter type in this
    // context (states[i] carries the span's own state for both the opening and closing delimiter
    // char — see quoteStates). A `"` occurring literally inside a single-quoted span carries
    // states[i] === "single", not "double" — it must be kept as literal content, not dropped as if
    // it were a double-quote delimiter (and symmetrically for a `'` inside a double-quoted span).
    if ((ch === "'" && states[i] === "single") || (ch === '"' && states[i] === "double")) {
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (inToken) tokens.push({ value: current, start });
  return tokens;
}

export function tokenize(liveText: string): string[] {
  return tokenizeWithOffsets(liveText).map((t) => t.value);
}

/** Character positions (start index into `liveText`) of every LIVE `>`/`>>` redirect operator —
 * the exact same scan `extractRedirectTargets` uses, so the two functions agree by construction
 * on what counts as a live redirect. `shell.ts`'s `scanFlags` uses this to exclude a redirect
 * operator's TOKEN from `positional` by comparing the token's `start` (from
 * `tokenizeWithOffsets`) against this set — position, not value (Issue #80). */
export function findLiveRedirectOperatorPositions(liveText: string): number[] {
  return findLiveRedirectMatches(liveText).map((m) => m.tokenStart);
}

/** Strips a path prefix (everything up to and including the last "/") and lowercases — used to
 * compare a possibly path-qualified tool-binary token (SUR-07) against a known wrapper name.
 * Quoting is already handled by `tokenize`; this only handles the path-qualification half. */
export function normalizeToolToken(token: string): string {
  const withoutPath = token.includes("/") ? token.slice(token.lastIndexOf("/") + 1) : token;
  return withoutPath.toLowerCase();
}
