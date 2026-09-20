// OSS-01: "Full history shall be scanned for secrets, credentials, real account identifiers,
// internal hostnames and personal data before the repository is public." Acceptance: "A
// working-tree scan is not sufficient." Redacts before logging (never prints raw secret text,
// anywhere — console, file, or return value beyond this module's own match objects, which the
// CLI never dumps unredacted).
//
// Scope: scans every blob reachable from the given ref's own ancestry (default HEAD) — the
// history that actually ships when this branch goes public — not `--all` refs, so an unrelated
// branch's history isn't in scope for this check. Pass --all-refs to widen it. This is a
// disclosed design choice, not an assumption (PRINCIPLES.md rule 18).
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GitOps } from "../lib/git.ts";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import type { SecretPattern } from "./patterns.ts";
import { SECRET_PATTERNS, redact } from "./patterns.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface HistoryMatch {
  commit: string;
  path: string;
  patternId: string;
  description: string;
  redacted: string;
  /** sha256 (lowercase hex) of the matched bytes, computed when the match is found. The raw text is
   * never stored; this is what a value-scoped allowlist entry is compared against. */
  valueSha256: string;
}

function looksBinary(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8000);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface ScanOptions {
  ref?: string;
  allRefs?: boolean;
  patterns?: SecretPattern[];
}

/** sha256 over the bytes of a match. The scanner decodes a blob as latin1, so the latin1 round trip
 * recovers the blob's own bytes exactly; the result equals the hash of the same bytes read from the
 * file, which is the idiom this repo's reviewed-baseline tests already use. */
function hashMatchedBytes(matched: string): string {
  return createHash("sha256").update(Buffer.from(matched, "latin1")).digest("hex");
}

/** Pure: scans one blob's already-decoded text against every pattern. Exported so the allowlist tool
 * (`allowlist-tool.ts`) reuses this exact matching and hashing instead of reimplementing it. */
export function scanBlobText(
  text: string,
  patterns: SecretPattern[],
): Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">> {
  const found: Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">> = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const m of text.matchAll(pattern.regex)) {
      found.push({
        patternId: pattern.id,
        description: pattern.description,
        redacted: redact(m[0]),
        valueSha256: hashMatchedBytes(m[0]),
      });
    }
  }
  return found;
}

async function scanUnseenBlob(
  git: GitOps,
  seenBlobs: Set<string>,
  sha: string,
): Promise<string | null> {
  if (seenBlobs.has(sha)) return null; // dedupe: same blob content already scanned elsewhere
  seenBlobs.add(sha);
  const content = await git.catFileBlob(sha);
  if (looksBinary(content)) return null;
  return content.toString("latin1");
}

export async function scanHistory(git: GitOps, opts: ScanOptions = {}): Promise<HistoryMatch[]> {
  const patterns = opts.patterns ?? SECRET_PATTERNS;
  const commits = await git.revList(opts.ref ?? "HEAD", opts.allRefs !== undefined ? { allRefs: opts.allRefs } : {});

  const seenBlobs = new Set<string>();
  const matches: HistoryMatch[] = [];

  for (const commit of commits) {
    const tree = await git.lsTree(commit);
    for (const [path, sha] of tree) {
      const text = await scanUnseenBlob(git, seenBlobs, sha);
      if (text === null) continue;
      for (const found of scanBlobText(text, patterns)) {
        matches.push({ commit, path, ...found });
      }
    }
  }

  return matches;
}

// docs/qa/secret-scan-allowlist.json — the .gitleaksignore-equivalent this project's own
// CLAUDE.md names as a sensitive area. Every entry is a reviewed, reasoned exception (a known
// test fixture, never a real secret), and (issue 136, THOTH-ADR-0002) it exempts a match only when
// its path, its pattern id AND the sha256 of the matched bytes all agree. The hash list is what
// keeps an entry from blinding the gate to a whole file forever: a novel value in an already-granted
// file blocks. An entry without a valid hash list is rejected by the loader (its matches block);
// there is no path-plus-pattern shape any more. An allowlisted match is still REPORTED (never
// silently dropped, QA-16's own discipline applied here) — it just doesn't fail the gate.
export interface AllowlistEntry {
  path: string;
  patternId: string;
  /** Non-empty list of lowercase 64-hex sha256 values of the exact matched bytes this entry covers. */
  valueSha256: string[];
  reason: string;
}

/** One rejected piece of the allowlist, named so a blocked developer can see why an entry never took
 * effect. Never carries a value or a hash. `index` is null for a file-level rejection. */
export interface RejectedAllowlistEntry {
  index: number | null;
  path: string | null;
  patternId: string | null;
  reason: string;
}

/** What `loadAllowlist` returns: the honored entries, with the rejected ones riding along so that
 * `summarizeMatches` can name them without any caller having to thread a second value through. */
export type LoadedAllowlist = AllowlistEntry[] & { rejected: RejectedAllowlistEntry[] };

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function partitionAllowlisted(
  matches: HistoryMatch[],
  allowlist: AllowlistEntry[],
): { blocking: HistoryMatch[]; allowlisted: HistoryMatch[] } {
  // path + pattern id select the entries; the match's own hash must be on the entry's list.
  const granted = new Map<string, Set<string>>();
  for (const e of allowlist) {
    const key = `${e.path}\0${e.patternId}`;
    const hashes = granted.get(key) ?? new Set<string>();
    for (const h of e.valueSha256) hashes.add(h);
    granted.set(key, hashes);
  }
  const blocking: HistoryMatch[] = [];
  const allowlisted: HistoryMatch[] = [];
  for (const m of matches) {
    const hit = granted.get(`${m.path}\0${m.patternId}`)?.has(m.valueSha256) === true;
    (hit ? allowlisted : blocking).push(m);
  }
  return { blocking, allowlisted };
}

/** Printable, single-line form of a string that came from the allowlist file. */
function clip(s: unknown): string {
  if (typeof s !== "string") return "?";
  return [...s.slice(0, 120)].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? "?" : c)).join("");
}

const MAX_UNLOCK_COMMANDS = 10;
const HASH_TOOL = "src/secret-scan/allowlist-tool.ts";

// Issue 239 (and red-team F1): the unlock command is printed for a maintainer to paste, and a match's
// path comes from the tree of a pull request, so it is contributor-chosen. A path is placed in a printed
// command only when no shell (sh, PowerShell, cmd) can give any character in it a meaning. Every other
// path gets a line that is not a command and shows the path percent-encoded.
const SHELL_SAFE = /^[A-Za-z0-9._/-]+$/;

/** Every character outside the safe set becomes %HH, one per UTF-8 byte (upper-case hex). The result
 * uses only [A-Za-z0-9._/%-], which no shell treats as syntax, and it is injective because a literal
 * percent is itself encoded. */
function percentEncode(s: string): string {
  let out = "";
  for (const ch of s) {
    if (SHELL_SAFE.test(ch)) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function unlockDetails(blocking: HistoryMatch[]): string[] {
  const lines = [
    "UNLOCK: a real secret is rotated and removed from the tree, never allowlisted. A reviewed fixture " +
      "literal is exempted by adding the sha256 of its matched text to the valueSha256 list of that path and " +
      "pattern's entry in docs/qa/secret-scan-allowlist.json (a new entry needs path, patternId, valueSha256 " +
      "and a reason), in a pull request whose diff shows it (THOTH-ADR-0002).",
    "UNLOCK: the hashed value is the regex MATCH text, which is not always the bare secret: for " +
      "generic-password-assignment and aws-secret-access-key it includes the key name, operator and quotes.",
  ];
  const seen = new Set<string>();
  let omitted = 0;
  let needsQuoting = false;
  for (const m of blocking) {
    const key = `${m.path}\0${m.patternId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_UNLOCK_COMMANDS) {
      omitted++;
      continue;
    }
    const commit = m.commit.slice(0, 12);
    if (SHELL_SAFE.test(m.path) && SHELL_SAFE.test(m.patternId) && SHELL_SAFE.test(commit)) {
      // The command prints, per match in that blob, the hash beside the redacted form shown above. It runs
      // on the developer's own machine; nothing here prints the hash of a blocked value.
      lines.push(`HASH-COMMAND for ${m.path} [${m.patternId}]: node ${HASH_TOOL} hash ${commit} "${m.path}" ${m.patternId}`);
    } else {
      // Not a command, and it carries no character a shell can act on, so pasting it anywhere runs nothing.
      needsQuoting = true;
      lines.push(
        `NO-COMMAND-PRINTED for path ${percentEncode(m.path)} [${percentEncode(m.patternId)}] at ${percentEncode(commit)}: ` +
          "the path has characters that need shell quoting, so no command is printed. " +
          "It is shown percent-encoded, each %HH is one byte, so this line cannot run.",
      );
    }
  }
  if (omitted > 0) {
    lines.push(
      `HASH-COMMAND: ${omitted} more path and pattern pair(s) are not listed. Each takes the same command shape, ` +
        "or the no-command rule when its path needs shell quoting.",
    );
  }
  if (needsQuoting) {
    lines.push(
      "NO-COMMAND-PRINTED: to get the hash for such a path, quote the path yourself for your shell and run: " +
        `node ${HASH_TOOL} hash COMMIT PATH PATTERN-ID. Use the commit and pattern id shown above and the path ` +
        "spelled exactly as in the match line, since git spells some characters with backslash escapes and the tool " +
        "looks the path up in that spelling. Run the tool with no arguments for its usage.",
    );
  }
  return lines;
}

function rejectedDetails(allowlist: AllowlistEntry[]): string[] {
  const rejected = (allowlist as Partial<LoadedAllowlist>).rejected ?? [];
  return rejected.map((r) =>
    r.index === null
      ? `REJECTED-ALLOWLIST-FILE: ${r.reason}`
      : `REJECTED-ENTRY index=${r.index} path=${clip(r.path)} pattern=${clip(r.patternId)}: ${r.reason}`,
  );
}

export function summarizeMatches(matches: HistoryMatch[], allowlist: AllowlistEntry[] = []): InstrumentResult {
  const { blocking, allowlisted } = partitionAllowlisted(matches, allowlist);

  const allowlistedDetails = allowlisted.map(
    (m) => `ALLOWLISTED ${m.commit.slice(0, 12)} ${m.path} [${m.patternId}] ${m.description}: ${m.redacted}`,
  );

  if (blocking.length === 0) {
    return {
      ok: true,
      vacuous: false,
      summary: `Full history scanned, 0 blocking secret-shaped matches found (${allowlisted.length} allowlisted).`,
      details: allowlistedDetails,
    };
  }
  return {
    ok: false,
    vacuous: false,
    summary: `${blocking.length} secret-shaped match(es) found in history (${allowlisted.length} allowlisted, not counted). Values redacted below.`,
    details: [
      ...blocking.map((m) => `${m.commit.slice(0, 12)} ${m.path} [${m.patternId}] ${m.description}: ${m.redacted}`),
      ...unlockDetails(blocking),
      ...rejectedDetails(allowlist),
      ...allowlistedDetails,
    ],
  };
}

/** Why an allowlist entry is not honored, as a short class name (never a value or a hash), or null
 * when it is a valid value-scoped entry. Red-team finding 4 (cifix round 3, LOW): a reason-less entry
 * was once silently HONORED, so a non-empty `reason` stays a structural precondition. Issue 136: so is
 * a valueSha256 list of lowercase 64-hex strings, all of them; an entry missing it, empty, or with any
 * malformed element is rejected and its matches block. */
export function entryRejection(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "not-an-object";
  const o = x as Record<string, unknown>;
  if (typeof o.path !== "string") return "missing-path";
  if (typeof o.patternId !== "string") return "missing-patternId";
  if (typeof o.reason !== "string" || o.reason.trim().length === 0) return "missing-reason";
  if (o.valueSha256 === undefined) return "missing-valueSha256";
  if (!Array.isArray(o.valueSha256)) return "valueSha256-not-a-list";
  if (o.valueSha256.length === 0) return "valueSha256-empty";
  if (!o.valueSha256.every((v) => typeof v === "string" && SHA256_HEX.test(v))) return "valueSha256-element-malformed";
  return null;
}

// Exported so this precondition is independently testable (`history-scan.test.ts`) without going
// through the CLI's file-based `main()`.
export function isValidAllowlistEntry(x: unknown): x is AllowlistEntry {
  return entryRejection(x) === null;
}

/** Reads the allowlist file. Fails closed: an unreadable, unparseable or non-array file yields no
 * entries (every match then blocks) and says so in `rejected`; an invalid entry is dropped and named. */
export async function loadAllowlist(path: string): Promise<LoadedAllowlist> {
  const loaded: LoadedAllowlist = Object.assign([] as AllowlistEntry[], { rejected: [] as RejectedAllowlistEntry[] });
  const fileProblem = (reason: string): LoadedAllowlist => {
    loaded.rejected.push({ index: null, path: null, patternId: null, reason });
    return loaded;
  };
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return fileProblem("unreadable-or-missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fileProblem("not-valid-json");
  }
  if (!Array.isArray(parsed)) return fileProblem("not-an-array");
  parsed.forEach((entry: unknown, index) => {
    const why = entryRejection(entry);
    if (why === null) {
      loaded.push(entry as AllowlistEntry);
      return;
    }
    const o = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    loaded.rejected.push({
      index,
      path: typeof o.path === "string" ? o.path : null,
      patternId: typeof o.patternId === "string" ? o.patternId : null,
      reason: why,
    });
  });
  return loaded;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const allRefs = process.argv.includes("--all-refs");
  const outPath = "docs/qa/history-scan-report.json";
  const allowlistPath = "docs/qa/secret-scan-allowlist.json";

  const git = makeGitOps(realRunner, repoRoot);
  const [matches, allowlist] = await Promise.all([
    scanHistory(git, { allRefs }),
    loadAllowlist(allowlistPath),
  ]);
  const result = summarizeMatches(matches, allowlist);

  // Report file: redacted matches only — never the raw secret text, per this module's own header. The
  // value hash is kept only for an ALLOWLISTED match (a value already in clear text in a tracked file);
  // a blocking match carries none, since an unsalted hash of a possibly-real secret can be guessed.
  const allowed = new Set(partitionAllowlisted(matches, allowlist).allowlisted);
  const reportMatches = matches.map((m) =>
    allowed.has(m)
      ? m
      : { commit: m.commit, path: m.path, patternId: m.patternId, description: m.description, redacted: m.redacted },
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ scannedAt: new Date().toISOString(), allRefs, matchCount: matches.length, matches: reportMatches }, null, 2),
    "utf8",
  );

  printInstrumentResult("OSS-01 history-scan", result);
  console.log(`[OSS-01 history-scan] full report (redacted): ${outPath}`);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
