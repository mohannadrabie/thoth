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
//
// Every blob is scanned. A NUL byte is an ordinary byte here: an earlier rule skipped a whole blob when
// a NUL sat in its first 8000 bytes, which hid any secret in such a file (Issue 237). A blob's text is
// decoded by `decodeBlobVariants` below and each decoding is matched against every pattern; a legitimate
// binary that produces a match is handled by the value-scoped allowlist below, the one exemption this
// gate has.
//
// UTF-16 (Issue 246): a blob starting with a UTF-16 byte-order-mark (LE `FF FE` or BE `FE FF`) is ALSO
// decoded to real text and matched, on top of the always-on latin1 byte-for-byte reading that otherwise
// leaves a NUL between every character and hides every pattern — additive, never a replacement, because a
// byte-order-mark can open a non-text binary blob for reasons that have nothing to do with UTF-16 (this
// module's own `high-bytes.bin` test fixture). BOM presence is the sole detection signal for the extra
// reading — deliberately not a heuristic guess at BOM-less UTF-16 (interleaved NULs can equally be an
// ASCII file with NUL separators, Issue 237's own fixture shape), so a UTF-16 file with no BOM is a
// disclosed, narrower residual. Every `SECRET_PATTERNS` regex matches ASCII-only text, so a decoded match
// is byte-identical, in the latin1 sense `hashMatchedBytes` already uses, to the same value written as
// plain ASCII — the same literal secret therefore hashes the same whether it lives in a plain-text file or
// a UTF-16 one, which is what lets one allowlist entry cover both forms (Manager ruling,
// s1-oss01-detection-residuals plan).
//
// Scan-time bound (Issue 247): `internal-hostname`, `email-address` and `private-key-block` all
// backtrack super-linearly on an adversarial shape with no closing anchor, which is invisible in a PR
// diff when the blob is binary-looking. Every pattern's match against every blob runs under a hard
// wall-clock ceiling (`SCAN_TIMEOUT_MS`, `matchAllBounded` below); a pattern that cannot finish in time is
// recorded as a blocking finding under the reserved `oss01-scan-timeout` pattern id rather than silently
// skipped, so the gate fails closed instead of passing a blob nobody actually scanned. That finding is a
// plain `HistoryMatch` like any other, reviewable and grantable through the SAME value-scoped allowlist —
// THOTH-ADR-0002 forbids a NEW exemption shape, not reuse of the existing one for a new kind of finding —
// and, since Issue 264 (fix-now round), its `valueSha256` is a hash of this variant's own scanned text
// (not `text.length`), so the property that makes the existing shape safe to reuse — content addressing —
// actually holds for this finding kind too, not just its field names.
//
// Blob dedupe and path scoping (Issue 250): a blob's own content is scanned once per distinct sha
// (matching is pure over the blob's own bytes, so re-scanning an identical blob would only reproduce the
// same matches) and its result is cached and replayed under every distinct PATH that blob sha is found
// at — not just the first path seen — so an allowlist grant scoped to one path no longer silently exempts
// an identical blob living at a second path (`THOTH-ADR-0002`'s path-agreement rule). Deliberately scoped
// to PATH, not to (commit, path): a file that never changes across history still gets a fresh tree entry
// at every commit that includes it, and reporting it again at every one of those would inflate matches
// without adding any real information the ADR's own path-scoped rule needs.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import vm from "node:vm";
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

export interface ScanOptions {
  ref?: string;
  allRefs?: boolean;
  patterns?: SecretPattern[];
}

/** sha256 over the bytes of a match. The scanner decodes a blob as latin1 (or, for a UTF-16 blob with a
 * BOM, to real text — see `decodeBlobVariants`), so for every pattern in this catalog (ASCII-only match
 * shapes) the latin1 round trip recovers the same bytes whichever path the text came from; the result
 * equals the hash of the same literal read from a plain-ASCII file, which is the idiom this repo's
 * reviewed-baseline tests already use.
 *
 * Issue 266 (app-security-reviewer, fix-now round): `Buffer.from(str, "latin1")` truncates any JS string
 * code point above 0xFF to its low byte. The latin1-decoded variant's own `toString("latin1")` never
 * produces one of those (every byte maps 1:1 into 0x00-0xFF), so this branch is unreachable for that
 * variant — but the UTF-16 variant (Issue 246) can. For the two patterns whose value class is open or
 * negated (`generic-password-assignment`, `private-key-block`), a UTF-16-decoded match built from
 * high-code-point characters (visually nothing like a reviewed ASCII literal) truncated to the exact same
 * low-byte sequence as an already-reviewed plain-ASCII value, colliding on `valueSha256` — demonstrated:
 * Armenian-range glyphs shifted to the same low bytes as `"SuperSecretPW1"` hashed identically to it.
 * Rather than reject the match outright (which would silently stop reporting a genuine secret that merely
 * contains a non-latin1 character, the worse failure mode for a security gate), a match containing a code
 * point above 0xFF is hashed over its own UTF-16LE code units instead — lossless, so two distinct matched
 * strings never collide — while every match that stays inside 0x00-0xFF (every latin1-variant match, and
 * every UTF-16-variant match of genuinely ASCII-or-latin1-range text, which is the common, intended case)
 * keeps the existing latin1 hash unchanged, so the "one entry covers both forms" equivalence this module's
 * header comment describes still holds for the case it was designed for. */
function hashMatchedBytes(matched: string): string {
  const hasHighCodePoint = [...matched].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
  const bytes = Buffer.from(matched, hasHighCodePoint ? "utf16le" : "latin1");
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every way one blob's raw bytes are decoded and matched (Issue 246). ALWAYS includes the latin1
 * byte-for-byte reading first — this is not an either/or choice: a byte-order-mark can legitimately open a
 * non-text binary blob for reasons that have nothing to do with UTF-16 (this module's own test fixture
 * `high-bytes.bin` starts `FF FE 80 81 ...`, four arbitrary high bytes, not text), so replacing the latin1
 * reading with a BOM-triggered UTF-16 one would silently re-hide whatever that blob's latin1 reading would
 * have caught — trading Issue 246 for a regression on Issue 237's own "no blob is skipped whatever its
 * bytes" guarantee. Instead, a byte-order-mark ADDS a second reading on top of the first, so this change
 * keeps the same "can only add matches, never remove one" property the gate has held since Issue 237.
 * BOM presence is the only detection signal for the second reading — deliberately not a heuristic guess at
 * BOM-less UTF-16, which cannot be told apart from an ordinary NUL-separated-ASCII fixture without a real
 * risk of misreading binary content as text. */
export function decodeBlobVariants(content: Buffer): string[] {
  const variants = [content.toString("latin1")];
  if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
    variants.push(content.subarray(2).toString("utf16le"));
  } else if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
    // Node has no native "utf16be" decoder; byte-swap each pair, then decode as utf16le. A trailing lone
    // byte (an odd-length body) is dropped rather than guessed at — the same "don't guess" posture as the
    // BOM-only detection above.
    const body = content.subarray(2);
    const evenLen = body.length - (body.length % 2);
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped.writeUInt8(body.readUInt8(i + 1), i);
      swapped.writeUInt8(body.readUInt8(i), i + 1);
    }
    variants.push(swapped.toString("utf16le"));
  }
  return variants;
}

// Issue 247: a hard wall-clock ceiling on every single pattern-against-blob match, so a catastrophically
// backtracking shape (internal-hostname, email-address, private-key-block all measured quadratic-or-worse
// on an adversarial input) cannot stall the gate. Measured, not assumed (PRINCIPLES.md rule 18): this
// repo's own largest real blob (CHANGELOG.md, ~330 KB) never took more than ~5ms against any one pattern;
// 500ms is roughly 100x that, so no real content observed in this repo is expected to trip it, while a
// hostile blob is stopped in well under a second per pattern instead of running for minutes.
export const SCAN_TIMEOUT_MS = 500;

// A single, reused V8 context and pre-compiled script for the bounded match below (Issue 247). Reusing
// both across every (blob, pattern) call — measured over 8000 calls — cuts the per-call cost to a small
// fraction of a millisecond; creating a fresh context per call would dominate the scan's own runtime on a
// history of this repo's size. Sequential use only: `scanHistory`'s own loop below awaits one blob's scan
// to finish before starting the next, so nothing else may write `timeoutSandbox` concurrently.
const timeoutSandbox: { text: string | undefined; regex: RegExp | undefined } = { text: undefined, regex: undefined };
vm.createContext(timeoutSandbox);
const matchAllScript = new vm.Script("[...text.matchAll(regex)]");

/** Runs `text.matchAll(regex)` under `SCAN_TIMEOUT_MS`, returning `null` on timeout instead of throwing or
 * hanging. Measured directly (not assumed): `vm.Script#runInContext`'s own `timeout` option interrupts an
 * in-progress, catastrophically-backtracking `RegExp` match in this Node version — a crafted blob that
 * free-runs for over ten seconds is cut off at the configured ceiling. */
function matchAllBounded(text: string, regex: RegExp): RegExpMatchArray[] | null {
  timeoutSandbox.text = text;
  timeoutSandbox.regex = regex;
  try {
    return matchAllScript.runInContext(timeoutSandbox, { timeout: SCAN_TIMEOUT_MS }) as RegExpMatchArray[];
  } catch {
    return null;
  } finally {
    timeoutSandbox.text = undefined;
    timeoutSandbox.regex = undefined;
  }
}

/** Reserved pattern id for a scan that could not complete within `SCAN_TIMEOUT_MS` (Issue 247). Never a
 * real `SECRET_PATTERNS` id, so it can never collide with one; a blocking finding under this id names a
 * scan failure, not a secret. Reviewable and grantable through the same value-scoped allowlist as any
 * other match — THOTH-ADR-0002 forbids a NEW exemption shape, not reuse of the existing one. */
export const SCAN_TIMEOUT_PATTERN_ID = "oss01-scan-timeout";

/** The grant hash of an `oss01-scan-timeout` finding for one decoded blob text (Issues 264, 271): a pure
 * function of the text, independent of which pattern was slow and of this machine's clock. */
export function scanTimeoutHash(text: string): string {
  return hashMatchedBytes(`${SCAN_TIMEOUT_PATTERN_ID}:${text}`);
}

/** Pure: scans one blob's already-decoded text against every pattern, each under the scan-time bound
 * above. Exported so the allowlist tool (`allowlist-tool.ts`) reuses this exact matching and hashing
 * instead of reimplementing it. */
export function scanBlobText(
  text: string,
  patterns: SecretPattern[],
): Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">> {
  const found: Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">> = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const raw = matchAllBounded(text, pattern.regex);
    if (raw === null) {
      // Fail closed (Issue 247): a pattern that could not finish against this blob within the scan-time
      // budget is reported as a blocking finding, never silently skipped — a timeout is not the same
      // thing as "no match", and treating it that way would reopen exactly the class of blind spot
      // Issue 237 closed.
      //
      // Issue 264 (red-team + app-security-reviewer, fix-now round, HIGH): the hash below MUST be a
      // function of this variant's own decoded text, not of `text.length` alone. A length-only hash
      // meant two blobs of the same decoded length that both time out on the same pattern at the same
      // path produced the IDENTICAL valueSha256 — demonstrated: a 200,000-byte padding blob and a
      // 200,000-byte blob carrying a real hostname and email hashed identically, so granting the first
      // (a legitimate, reviewed oversized asset) silently exempted the second (an attacker's blob of the
      // same length) forever, with zero allowlist.json diff and zero reviewer visibility — THOTH-ADR-0002's
      // "hash over the matched bytes" rule, applied to a finding that has no matched bytes of its own, so
      // it is hashed over the blob's own scanned text instead. This keeps the finding content-addressed
      // like every other one: two different blobs (even the same length) never share a hash, so one grant
      // covers exactly the one blob it was reviewed against, and a novel blob at the same path — however
      // similar in size — still blocks and still names its own unlock.
      //
      // Issue 271 (red-team, MED): the hash must ALSO not depend on which pattern was slow. Which pattern
      // times out on a blob near the budget is a wall-clock race (one machine gave "none" and
      // "internal-hostname" on identical input), so a pattern-keyed hash made the grant a developer
      // computed differ from the one CI needed. The pattern id is display-only (in `redacted` and
      // `description`); identity is the scanned text alone (`scanTimeoutHash`, shared with the
      // allowlist tool's unlock so the two cannot drift).
      found.push({
        patternId: SCAN_TIMEOUT_PATTERN_ID,
        description: `scan of this blob against pattern '${pattern.id}' did not finish within ${SCAN_TIMEOUT_MS}ms and was stopped; this is a scan that could not complete, not a secret match`,
        redacted: `…[SCAN-TIMEOUT pattern=${pattern.id} bytes=${text.length}]`,
        valueSha256: scanTimeoutHash(text),
      });
      continue;
    }
    for (const m of raw) {
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

/** Scans one blob's raw bytes (every decoding in `decodeBlobVariants`, then match) exactly once — the
 * cache below replays the result for every path the blob is found at, so this function's own cost is paid
 * once per distinct blob sha. Deliberately does NOT deduplicate matches across (or within) a variant: a
 * value repeated many times in one blob (this repo's own CHANGELOG.md, measured — the same hostname
 * mentioned across many changelog entries) has always been reported once per occurrence, and a dedup keyed
 * on (patternId, valueSha256) would collapse every one of those repeats into a single finding, silently
 * changing what "a match" means for every blob in real history, not just a UTF-16 one. Caught by
 * measuring this fix's effect on this repo's own real scan (2031 to 923 allowlisted matches) before this
 * function shipped — the fix here is to not dedupe at all, letting each variant's own matches (each
 * variant's own occurrences included) all flow through unchanged. */
async function scanBlob(
  git: GitOps,
  sha: string,
  patterns: SecretPattern[],
): Promise<Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">>> {
  const content = await git.catFileBlob(sha);
  const found: Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">> = [];
  for (const text of decodeBlobVariants(content)) {
    found.push(...scanBlobText(text, patterns));
  }
  return found;
}

export async function scanHistory(git: GitOps, opts: ScanOptions = {}): Promise<HistoryMatch[]> {
  const patterns = opts.patterns ?? SECRET_PATTERNS;
  const commits = await git.revList(opts.ref ?? "HEAD", opts.allRefs !== undefined ? { allRefs: opts.allRefs } : {});

  // Issue 250, corrected for a real-history blow-up caught measuring this fix: the dedupe key is
  // (path, sha), NOT sha alone (the pre-fix bug: the SAME shared blob at a different path was silently
  // dropped) and NOT (commit, path) either (a first cut of this fix tried that and inflated this repo's
  // own allowlisted-match count over 12x — 2031 to 25021 — because a file that simply never changes still
  // gets a fresh tree entry at every commit that includes it; reporting it again at every one of those
  // commits is not what Issue 250 asked for and is not what THOTH-ADR-0002 scopes an entry by, which is
  // PATH, not commit).
  //
  // So: for a given PATH, its content is scanned+reported once per DISTINCT blob sha that path ever holds
  // across history (exactly the granularity a "full history scan" needs — an older, since-changed version
  // of a file can hold a different secret than its current one, and must still be caught) — but a blob
  // sha's OWN scan cost and match set is computed once, in `blobMatchCache`, no matter how many paths or
  // commits share it, and simply replayed under every (path, sha) pair that is new.
  const blobMatchCache = new Map<string, Array<Pick<HistoryMatch, "patternId" | "description" | "redacted" | "valueSha256">>>();
  const reportedPathSha = new Set<string>();
  const matches: HistoryMatch[] = [];

  for (const commit of commits) {
    const tree = await git.lsTree(commit);
    for (const [path, sha] of tree) {
      const pathShaKey = `${path}\0${sha}`;
      if (reportedPathSha.has(pathShaKey)) continue; // this exact (path, content) pairing already reported
      reportedPathSha.add(pathShaKey);

      let found = blobMatchCache.get(sha);
      if (found === undefined) {
        found = await scanBlob(git, sha, patterns);
        blobMatchCache.set(sha, found);
      }
      for (const f of found) {
        matches.push({ commit, path, ...f });
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
 * `summarizeMatches` can name them without any caller having to thread a second value through.
 * Caveat (red-team F5): `rejected` lives on the array object, so any copy of the array (a spread, a
 * filter, a map) silently drops it. That loses DIAGNOSTICS only, never gating: a rejected entry is never
 * in the array, so its matches block regardless. Both live callers pass the loaded object straight to
 * `summarizeMatches`; keep doing so if the rejection lines matter. They are printed on a blocking run only. */
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

/** Printable, single-line, shell-inert form of a string that came from the allowlist file (Issue 243, red-team
 * F1). Also used by the problem and classification lines of allowlist-tool.ts `verify`, which reads the same
 * file. At most 120 code points, then percent-encoded exactly like a path in the no-command line, so no character
 * of a contributor-authored entry reaches the log unquoted or splits a line. A non-string or empty value is a lone
 * percent sign, which the encoder never produces on its own and no shell reads as syntax. */
export function clip(s: unknown): string {
  if (typeof s !== "string" || s.length === 0) return "%";
  return percentEncode([...s].slice(0, 120).join(""));
}

const MAX_UNLOCK_COMMANDS = 10;
const HASH_TOOL = "src/secret-scan/allowlist-tool.ts";

// Issue 239 (and red-team F1): the unlock command is printed for a maintainer to paste, and a match's
// path comes from the tree of a pull request, so it is contributor-chosen. A path is placed in a printed
// command only when no shell (sh, PowerShell, cmd) can give any character in it a meaning. Every other
// path gets a line that is not a command and shows the path percent-encoded.
const SHELL_SAFE = /^[A-Za-z0-9._/-]+$/;

/** Every character outside the safe set becomes %HH, one per UTF-8 byte (upper-case hex). The result
 * uses only [A-Za-z0-9._/%-] and is injective because a literal percent is itself encoded. Only the
 * percent needs a caveat: cmd reads a percent-delimited name as a variable reference. Every percent here
 * starts a two-hex-digit group, so a reference could only name a variable made of hex digits, such as the
 * current-directory one (CD); that substitutes text and runs nothing. The line it appears on is not a
 * command anyway. */
function percentEncode(s: string): string {
  let out = "";
  for (const ch of s) {
    if (SHELL_SAFE.test(ch)) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

// The one how-to sentence for a path that gets no runnable command (Issue 241 ruling, Issue 244). It names no
// path and no command, and it never tells the reader to quote, copy or paste a path: red-team measured every
// quoting strategy executing a payload for some hostile name in some shell. The test
// oss01-unlock-no-command-line-is-pinned-verbatim-and-every-printed-line-is-checked declares the same text, so
// a rewording is a deliberate change to both.
const NO_COMMAND_HOWTO =
  "NO-COMMAND-PRINTED: to get the value hash for such a path, compute the sha256 of the matched text with a local sha256 tool " +
  "over the literal in your own file. The matched text is the whole regex match with no trailing newline, so for " +
  "generic-password-assignment and aws-secret-access-key it includes the key name, operator and quotes. In the allowlist entry, " +
  "the path field is the percent-decoded form of the path shown above. Or rename the path to one of [A-Za-z0-9._/-] first, " +
  "or have a maintainer review it. A shell-safe channel for this hash is tracked in Issue 241.";

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
    lines.push(NO_COMMAND_HOWTO);
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
