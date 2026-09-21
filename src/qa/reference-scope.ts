// QA-14 scan scope: which TEXT of each changed file the reference resolver examines.
//
// Default: the whole file, read from disk. Two narrowings, each a named constant with its reason:
//
//  1. APPEND_ONLY_FILES / APPEND_ONLY_DIR_PREFIXES. Historical records that this project appends to
//     and does not rewrite (the decision log and its archive, the review log, the changelog, the
//     dated review reports). In a diff-mode run only the text the diff ADDS to such a file is
//     checked; the reference examples that already sit in old rows are not re-litigated every time a
//     row is appended. A full-tree run, and any file this module cannot attribute in the diff
//     (see "Fails closed" below), is checked whole.
//  2. GENERATED_MIRROR_FILE. The adrCatalog cache inside docs/.maat-state.json is regenerated from
//     ADR files under adr/, which this repository does not author and QA-14 never scans. It is
//     dropped before scanning (root object and the priorScope chain only); every other field of the
//     file, authored notes included, is scanned whole. Applies in full-tree runs too.
//
// Nothing here is keyed on a token or on a path-plus-token pair: a citation that a diff adds to any
// file, an append-only record included, is checked.
//
// Moved lines. An added line that is byte-identical (a trailing carriage return ignored) to a line
// the same diff removes is a move (an archive sweep, a reorder), not new text, and is not checked.
// The rule is a multiset: each removed line licenses at most ONE added identical line, so a line
// added three times and removed once still has two checked copies. A removal licenses a move only
// if it came from a file this same run scans (a changed file that passes shouldScan and exists on
// disk), and never from GENERATED_MIRROR_FILE. That closes the laundering path: text removed from
// a file QA-14 never examines (a *.test.ts, the adrCatalog mirror, a file the diff deletes, the old
// path of a renamed file, a path the parser cannot attribute) cannot be re-added elsewhere as a
// free "move". Consequence, stricter and accepted: a line moved out of a deleted or renamed-away
// file is checked as new text.
//
// Fails closed (whole-file scan, never a vacuous pass): a full-tree run; a diff that cannot be read;
// a changed file the diff parser cannot attribute (a C-quoted path, a pure rename or mode change with
// no hunk, a binary diff, a non-default git prefix setting). A removal from an unattributable path
// licenses nothing.
//
// Pure apart from the injected deps: the diff text and the file reader are passed in, never
// instantiated here (SE ADR-0003).

/** Append-only historical records: only the text a diff adds is checked (diff mode). */
export const APPEND_ONLY_FILES: readonly string[] = [
  "docs/decisions.md",
  "docs/decisions-archive.md",
  "docs/REVIEW_LOG.md",
  "CHANGELOG.md",
];
/** Directories whose every file is an append-only, dated record (immutable once merged). */
export const APPEND_ONLY_DIR_PREFIXES: readonly string[] = ["docs/reviews/"];
/** File holding a generated cache of ADR text this repository does not author. */
export const GENERATED_MIRROR_FILE = "docs/.maat-state.json";
/** The generated key inside GENERATED_MIRROR_FILE, and the key its nested snapshots hang from. */
const MIRROR_KEY = "adrCatalog";
const MIRROR_CHAIN_KEY = "priorScope";
/** Separator between added runs: text that cannot combine with either neighbour into a citation. */
const RUN_BREAK = "---";

export interface AddedLine {
  text: string;
  /** Which contiguous block of added lines (hunk or run within a hunk) this line belongs to. */
  run: number;
}
export interface ParsedDiff {
  /** New-side path -> the lines the diff adds to it. A path is present only if its header was readable. */
  added: Map<string, AddedLine[]>;
  /** Old-side path -> the lines the diff removes from it. Only readable headers are recorded. */
  removed: Map<string, string[]>;
}
export interface ScanTextDeps {
  diffText: () => Promise<string>;
  /** File text at the head being checked, or null when the file does not exist there. */
  readFile: (repoRelativePath: string) => Promise<string | null>;
  shouldScan: (repoRelativePath: string) => boolean;
  /** True when the path exists at the diff's base commit. A rejection is treated as "unknown". */
  existsAtBase?: (repoRelativePath: string) => Promise<boolean>;
}

export function isAppendOnlyRecord(repoRelativePath: string): boolean {
  return (
    APPEND_ONLY_FILES.includes(repoRelativePath) ||
    APPEND_ONLY_DIR_PREFIXES.some((prefix) => repoRelativePath.startsWith(prefix) && repoRelativePath.length > prefix.length)
  );
}

const stripCr = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

// --- unified diff parsing -------------------------------------------------------------------------

const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/** A path from a "--- " or "+++ " header: string = path, null = /dev/null, undefined = cannot attribute. */
function headerPath(line: string, marker: "--- " | "+++ ", prefix: "a/" | "b/"): string | null | undefined {
  const afterMarker = line.slice(marker.length);
  const tab = afterMarker.indexOf("\t"); // git appends a tab after a path holding a space
  const rest = tab === -1 ? afterMarker : afterMarker.slice(0, tab);
  if (rest === "/dev/null") return null;
  return rest.startsWith(prefix) ? rest.slice(prefix.length) : undefined; // C-quoted, or a non-default prefix
}

type PathSide = string | null | undefined;

interface ParseState {
  lines: string[];
  i: number;
  run: number;
  oldPath: PathSide;
  newPath: PathSide;
  added: Map<string, AddedLine[]>;
  removed: Map<string, string[]>;
}

function recordAdded(s: ParseState, text: string): void {
  if (typeof s.newPath === "string") s.added.get(s.newPath)?.push({ text, run: s.run });
}

function recordRemoved(s: ParseState, text: string): void {
  if (typeof s.oldPath !== "string") return;
  const list = s.removed.get(s.oldPath);
  if (list) list.push(text);
  else s.removed.set(s.oldPath, [text]);
}

/** Consumes one hunk body, using the line counts in its header to know where it ends. */
function readHunk(s: ParseState, header: RegExpExecArray): void {
  let oldLeft = header[1] === undefined ? 1 : Number(header[1]);
  let newLeft = header[2] === undefined ? 1 : Number(header[2]);
  let previous = "";
  s.run += 1;
  while (s.i < s.lines.length && (oldLeft > 0 || newLeft > 0)) {
    const body = s.lines[s.i] ?? "";
    s.i += 1;
    const kind = body.charAt(0);
    if (kind === "\\") continue; // "\ No newline at end of file"
    if (kind === "+") {
      newLeft -= 1;
      if (previous !== "+") s.run += 1;
      recordAdded(s, body.slice(1));
    } else if (kind === "-") {
      oldLeft -= 1;
      recordRemoved(s, body.slice(1));
    } else {
      oldLeft -= 1;
      newLeft -= 1;
    }
    previous = kind;
  }
}

/**
 * Parses `git diff` output. Hunk bodies are consumed by the line counts in their header, so a
 * content line that merely looks like a file header ("+++ b/...", "--- a/...") is content.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const s: ParseState = {
    lines: diffText.split("\n"),
    i: 0,
    run: 0,
    oldPath: undefined,
    newPath: undefined,
    added: new Map(),
    removed: new Map(),
  };
  while (s.i < s.lines.length) {
    const line = s.lines[s.i] ?? "";
    s.i += 1;
    if (line.startsWith("diff --git ")) {
      s.oldPath = undefined;
      s.newPath = undefined;
    } else if (line.startsWith("--- ")) {
      s.oldPath = headerPath(line, "--- ", "a/");
    } else if (line.startsWith("+++ ")) {
      s.newPath = headerPath(line, "+++ ", "b/");
      if (typeof s.newPath === "string" && !s.added.has(s.newPath)) s.added.set(s.newPath, []);
    } else {
      const header = HUNK_RE.exec(line);
      if (header) readHunk(s, header);
    }
  }
  return { added: s.added, removed: s.removed };
}

// --- the generated mirror -------------------------------------------------------------------------

function skipWhitespace(t: string, from: number): number {
  let i = from;
  while (i < t.length && " \t\r\n".includes(t.charAt(i))) i += 1;
  return i;
}

/** End index (exclusive) of the string token starting at `from`. Input is known-valid JSON. */
function skipString(t: string, from: number): number {
  let i = from + 1;
  while (i < t.length) {
    const c = t.charAt(i);
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else i += 1;
  }
  return i;
}

/** End index (exclusive) of the object or array starting at `from`. Input is known-valid JSON. */
function skipContainer(t: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < t.length) {
    const c = t.charAt(i);
    if (c === '"') {
      i = skipString(t, i);
      continue;
    }
    if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/** End index (exclusive) of the JSON value starting at `from`. Input is known-valid JSON. */
function skipValue(t: string, from: number): number {
  const first = t.charAt(from);
  if (first === '"') return skipString(t, from);
  if (first === "{" || first === "[") return skipContainer(t, from);
  let i = from;
  while (i < t.length && !",}] \t\r\n".includes(t.charAt(i))) i += 1; // number, true, false, null
  return i;
}

interface KeySpan {
  key: string; // the key as written between its quotes, escapes unresolved
  valueStart: number;
  valueEnd: number;
}

/** Every member of the object starting at `objectStart`, duplicates included. Input is known-valid JSON. */
function objectMembers(t: string, objectStart: number): KeySpan[] {
  const members: KeySpan[] = [];
  let i = skipWhitespace(t, objectStart + 1);
  while (i < t.length && t.charAt(i) !== "}") {
    const keyEnd = skipString(t, i);
    const key = t.slice(i + 1, keyEnd - 1);
    i = skipWhitespace(t, skipWhitespace(t, keyEnd) + 1); // past the colon
    const valueEnd = skipValue(t, i);
    members.push({ key, valueStart: i, valueEnd });
    i = skipWhitespace(t, valueEnd);
    if (t.charAt(i) === ",") i = skipWhitespace(t, i + 1);
  }
  return members;
}

function collectMirrorSpans(t: string, objectStart: number, spans: [number, number][]): void {
  for (const m of objectMembers(t, objectStart)) {
    if (t.charAt(m.valueStart) !== "{") continue; // a non-object value under either key is authored text
    if (m.key === MIRROR_KEY) spans.push([m.valueStart, m.valueEnd]);
    else if (m.key === MIRROR_CHAIN_KEY) collectMirrorSpans(t, m.valueStart, spans);
  }
}

/**
 * Text of GENERATED_MIRROR_FILE with each adrCatalog object (root, and along the priorScope chain)
 * cut out of the ORIGINAL text. Working on the original text, not on a parse-and-reserialize, keeps
 * every other character scannable: a duplicate key cannot hide an earlier value, and no escape is
 * decoded into or out of a citation. Anything that is not one valid JSON object is returned whole.
 */
export function stripAdrCatalog(text: string): string {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return text;
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) return text;
  const spans: [number, number][] = [];
  collectMirrorSpans(text, skipWhitespace(text, 0), spans);
  spans.sort((a, b) => b[0] - a[0]); // cut from the end so earlier offsets stay valid
  let out = text;
  for (const [start, end] of spans) out = `${out.slice(0, start)}null${out.slice(end)}`;
  return out;
}

// --- per-file scan text ---------------------------------------------------------------------------

/** Removed-line counts, from files this run scans, that may each license one identical added line. */
function moveLicences(parsed: ParsedDiff, scanned: ReadonlyMap<string, string>): Map<string, number> {
  const licences = new Map<string, number>();
  for (const [path, lines] of parsed.removed) {
    if (!scanned.has(path) || path === GENERATED_MIRROR_FILE) continue;
    for (const line of lines) {
      const key = stripCr(line);
      licences.set(key, (licences.get(key) ?? 0) + 1);
    }
  }
  return licences;
}

/** The added lines that are new text: each licence is spent on at most one line, across every file. */
function newText(lines: readonly AddedLine[], licences: Map<string, number>): string {
  const out: string[] = [];
  let previousRun = -1;
  let pendingBreak = false;
  for (const { text, run } of lines) {
    const line = stripCr(text);
    const left = licences.get(line) ?? 0;
    if (left > 0) {
      licences.set(line, left - 1);
      pendingBreak = true;
      continue;
    }
    if (out.length > 0 && (pendingBreak || run !== previousRun)) out.push(RUN_BREAK);
    out.push(line);
    previousRun = run;
    pendingBreak = false;
  }
  return out.join("\n");
}

async function readScannable(changedFiles: readonly string[], deps: ScanTextDeps): Promise<Map<string, string>> {
  const whole = new Map<string, string>();
  for (const file of changedFiles) {
    if (!deps.shouldScan(file)) continue;
    const text = await deps.readFile(file);
    if (text !== null) whole.set(file, text);
  }
  return whole;
}

async function readDiff(deps: ScanTextDeps): Promise<ParsedDiff | null> {
  try {
    return parseUnifiedDiff(await deps.diffText());
  } catch {
    return null; // cannot read the diff: whole-file, never a vacuous pass
  }
}

/**
 * The text QA-14 scans for each changed file (file path -> text), in `changedFiles` order.
 * `fullTree` true means the run had no diff to read; every file is then whole.
 */
export async function buildScanTexts(
  changedFiles: readonly string[],
  fullTree: boolean,
  deps: ScanTextDeps,
): Promise<Map<string, string>> {
  const whole = await readScannable(changedFiles, deps);
  const needsDiff = !fullTree && [...whole.keys()].some(isAppendOnlyRecord);
  const parsed = needsDiff ? await readDiff(deps) : null;
  const licences = parsed === null ? new Map<string, number>() : moveLicences(parsed, whole);

  const out = new Map<string, string>();
  for (const [file, text] of whole) {
    if (file === GENERATED_MIRROR_FILE) {
      out.set(file, stripAdrCatalog(text));
      continue;
    }
    const added = parsed !== null && isAppendOnlyRecord(file) ? parsed.added.get(file) : undefined;
    out.set(file, added === undefined ? text : newText(added, licences));
  }
  return out;
}
