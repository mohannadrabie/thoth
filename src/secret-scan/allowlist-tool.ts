// One-shot migration generator, its verify mode, and the hash helper for the OSS-01 allowlist
// (`docs/qa/secret-scan-allowlist.json`). Issues 136 and 203, THOTH-ADR-0002.
//
//   generate --base <ref> --out <file>       legacy entries at <ref> -> value-scoped entries (scratch file)
//   verify   --base <ref> --migrated <file>  prove <file> is a faithful, non-widening migration
//   hash     <commit> <path> <patternId>     the sha256 of each match in that blob (the unlock command)
//
// The generator and verify mode print COUNTS ONLY: no raw value, no hash. A reviewer approving the
// migrated file is approving opaque hashes, so the counts are the value-level evidence they get: how
// many blessed values per pattern, how many under the dated-report directory, how many credential-
// shaped. Matching and hashing reuse `scanBlobText` / `scanHistory` from `history-scan.ts`; nothing is
// reimplemented here, so this tool and the gate cannot disagree about what a match is.
//
// Generation scope is the history reachable from the base ref only, never the tree about to be
// committed, so a new literal added in the same change blocks instead of being absorbed into the file.
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import type { AllowlistEntry } from "./history-scan.ts";
import { SCAN_TIMEOUT_PATTERN_ID, clip, decodeBlobVariants, entryRejection, scanBlobText, scanHistory } from "./history-scan.ts";
import { SECRET_PATTERNS } from "./patterns.ts";

export const ALLOWLIST_PATH = "docs/qa/secret-scan-allowlist.json";

/** The three pattern ids that describe identifiers rather than credentials (same split the
 * `REVIEWED_BASELINE` guard in `history-scan.test.ts` uses). */
const NON_CREDENTIAL_PATTERN_IDS = ["internal-hostname", "ipv4-private", "email-address"];
const REPORTS_PREFIX = ["docs", "reviews"].join("/") + "/";

export interface ScopedMatch {
  path: string;
  patternId: string;
  valueSha256: string;
}

export interface MigrationResult {
  entries: AllowlistEntry[];
  /** Legacy entries that matched nothing at the base: counted, never written. */
  dropped: Array<{ path: string; patternId: string }>;
  /** Entries that were already value-scoped and were carried through untouched. */
  carried: number;
}

function pairKey(path: string, patternId: string): string {
  return `${path}\0${patternId}`;
}

/** Turns legacy `{path, patternId, reason}` entries into value-scoped entries carrying the sorted,
 * distinct hashes of that pair's own matches. An entry that is already value-scoped is validated and
 * carried through UNCHANGED, never widened (a re-run must be a no-op). Anything malformed throws: the
 * generator never guesses. */
export function migrateAllowlist(input: unknown, matches: readonly ScopedMatch[]): MigrationResult {
  if (!Array.isArray(input)) throw new Error("allowlist input is not an array");
  const byPair = new Map<string, Set<string>>();
  for (const m of matches) {
    const key = pairKey(m.path, m.patternId);
    const set = byPair.get(key) ?? new Set<string>();
    set.add(m.valueSha256);
    byPair.set(key, set);
  }
  const seen = new Set<string>();
  const entries: AllowlistEntry[] = [];
  const dropped: MigrationResult["dropped"] = [];
  let carried = 0;
  input.forEach((raw: unknown, i) => {
    const why = entryRejection(raw);
    if (why !== null && why !== "missing-valueSha256") throw new Error(`allowlist input entry ${i}: ${why}`);
    const o = raw as Record<string, unknown>;
    const path = o.path as string;
    const patternId = o.patternId as string;
    const reason = o.reason as string;
    const key = pairKey(path, patternId);
    if (seen.has(key)) throw new Error(`allowlist input entry ${i}: duplicate path and patternId (merge by hand)`);
    seen.add(key);
    if (why === null) {
      entries.push({ path, patternId, valueSha256: [...(o.valueSha256 as string[])], reason });
      carried++;
      return;
    }
    const hashes = [...(byPair.get(key) ?? [])].sort();
    if (hashes.length === 0) {
      dropped.push({ path, patternId });
      return;
    }
    entries.push({ path, patternId, valueSha256: hashes, reason });
  });
  return { entries, dropped, carried };
}

/** Same layout as the existing file: two-space JSON and a trailing newline, one hash per line. */
export function serializeAllowlist(entries: readonly AllowlistEntry[]): string {
  return JSON.stringify(entries, null, 2) + "\n";
}

/** Counts only: how many blessed values per pattern, how many sit under the dated-report directory,
 * how many are credential-shaped. Never a value or a hash. */
export function classificationLines(entries: readonly AllowlistEntry[]): string[] {
  const byPattern = new Map<string, number>();
  let underReports = 0;
  let credentialShaped = 0;
  for (const e of entries) {
    const n = e.valueSha256.length;
    byPattern.set(e.patternId, (byPattern.get(e.patternId) ?? 0) + n);
    if (e.path.startsWith(REPORTS_PREFIX)) underReports += n;
    if (!NON_CREDENTIAL_PATTERN_IDS.includes(e.patternId)) credentialShaped += n;
  }
  const perPattern = [...byPattern.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, n]) => `${clip(id)}=${n}`);
  return [
    `blessed values by pattern: ${perPattern.join(", ")}`,
    `blessed values under ${REPORTS_PREFIX}: ${underReports}`,
    `blessed credential-shaped values: ${credentialShaped}`,
  ];
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

async function readLegacyAtRef(base: string): Promise<unknown> {
  const git = makeGitOps(realRunner, process.cwd());
  const sha = (await git.lsTree(base)).get(ALLOWLIST_PATH);
  if (sha === undefined) throw new Error(`${ALLOWLIST_PATH} is not tracked at ${base}`);
  try {
    return JSON.parse((await git.catFileBlob(sha)).toString("utf8")) as unknown;
  } catch {
    // A fixed message: the parser's own message quotes a piece of the file, which a pull request author chose.
    throw new Error("the legacy allowlist at the base ref is not valid JSON");
  }
}

async function runGenerate(argv: string[]): Promise<number> {
  const base = argValue(argv, "--base");
  const out = argValue(argv, "--out");
  if (base === undefined || out === undefined) throw new Error("generate needs --base <ref> and --out <file>");
  const git = makeGitOps(realRunner, process.cwd());
  const result = migrateAllowlist(await readLegacyAtRef(base), await scanHistory(git, { ref: base }));
  await writeFile(out, serializeAllowlist(result.entries), "utf8");
  const hashes = result.entries.reduce((n, e) => n + e.valueSha256.length, 0);
  console.log(
    `[allowlist-tool generate] entries written: ${result.entries.length} (carried already-scoped: ${result.carried}), ` +
      `dropped as matching nothing: ${result.dropped.length}, value hashes: ${hashes}`,
  );
  for (const line of classificationLines(result.entries)) console.log(`[allowlist-tool generate] ${line}`);
  return 0;
}

export interface VerifyCounts {
  legacyEntries: number;
  migratedEntries: number;
  /** Legacy entries absent from the migrated file because they match nothing. */
  droppedEntries: number;
  hashes: number;
  occurrencesBefore: number;
  occurrencesAfter: number;
  /** Occurrences the migrated file allowlists that the legacy file did not (must be zero). */
  newlyAllowlisted: number;
  /** Occurrences the legacy file allowlisted that the migrated file no longer does (must be zero). */
  newlyBlocking: number;
}

export interface VerifyReport {
  ok: boolean;
  problems: string[];
  counts: VerifyCounts;
}

interface ParsedEntry {
  index: number;
  path: string;
  patternId: string;
  reason: string;
  /** null for a legacy-shaped entry (covers its whole pair), else the exact hashes it lists. */
  hashes: string[] | null;
}

function parseEntries(input: unknown, label: string, problems: string[], allowLegacy: boolean): ParsedEntry[] {
  if (!Array.isArray(input)) {
    problems.push(`${label} is not an array`);
    return [];
  }
  const out: ParsedEntry[] = [];
  input.forEach((raw: unknown, index) => {
    const why = entryRejection(raw);
    const legacyShaped = why === "missing-valueSha256";
    if (why !== null && !(allowLegacy && legacyShaped)) {
      const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const where = typeof o.path === "string" && typeof o.patternId === "string" ? ` (${clip(o.path)}, ${clip(o.patternId)})` : "";
      problems.push(`${label} entry ${index}${where} is not a valid value-scoped entry: ${why}`);
      return;
    }
    const o = raw as Record<string, unknown>;
    out.push({
      index,
      path: o.path as string,
      patternId: o.patternId as string,
      reason: o.reason as string,
      hashes: legacyShaped ? null : [...(o.valueSha256 as string[])],
    });
  });
  return out;
}

function covers(e: ParsedEntry, m: ScopedMatch): boolean {
  return e.path === m.path && e.patternId === m.patternId && (e.hashes === null || e.hashes.includes(m.valueSha256));
}

/** Proves `migrated` is a faithful, non-widening migration of `legacy` over the scanner's own matches:
 * every migrated entry is a valid value-scoped entry sitting on a legacy pair with its reason verbatim;
 * every hash is carried by a real match at that pair; every legacy entry that still matches is present;
 * and, over the scanned matches, the migrated file allowlists exactly what the legacy one did (nothing
 * newly allowlisted, nothing newly blocking). Reports counts and names, never a value or a hash. */
export function verifyMigration(legacy: unknown, migrated: unknown, matches: readonly ScopedMatch[]): VerifyReport {
  const problems: string[] = [];
  const legacyEntries = parseEntries(legacy, "legacy", problems, true);
  const migratedEntries = parseEntries(migrated, "migrated", problems, false);

  const legacyByPair = new Map(legacyEntries.map((e) => [pairKey(e.path, e.patternId), e]));
  const migratedByPair = new Map<string, ParsedEntry>();
  for (const e of migratedEntries) {
    const key = pairKey(e.path, e.patternId);
    if (migratedByPair.has(key)) problems.push(`migrated has two entries for (${clip(e.path)}, ${clip(e.patternId)})`);
    migratedByPair.set(key, e);
  }
  const hashesAtPair = new Map<string, Set<string>>();
  for (const m of matches) {
    const key = pairKey(m.path, m.patternId);
    const set = hashesAtPair.get(key) ?? new Set<string>();
    set.add(m.valueSha256);
    hashesAtPair.set(key, set);
  }

  for (const e of migratedEntries) {
    const key = pairKey(e.path, e.patternId);
    const was = legacyByPair.get(key);
    if (was === undefined) {
      problems.push(`migrated entry ${e.index} (${clip(e.path)}, ${clip(e.patternId)}) sits on a pair with no legacy entry`);
      continue;
    }
    if (was.reason !== e.reason) problems.push(`migrated entry ${e.index} (${clip(e.path)}, ${clip(e.patternId)}) changed its reason`);
    const real = hashesAtPair.get(key) ?? new Set<string>();
    const unbacked = (e.hashes ?? []).filter((h) => !real.has(h)).length;
    if (unbacked > 0) problems.push(`migrated entry ${e.index} (${clip(e.path)}, ${clip(e.patternId)}) lists ${unbacked} hash(es) that no scanned match carries`);
    if (was.hashes !== null && (e.hashes ?? []).join() !== was.hashes.join()) {
      problems.push(`migrated entry ${e.index} (${clip(e.path)}, ${clip(e.patternId)}) differs from an already value-scoped legacy entry`);
    }
  }

  let droppedEntries = 0;
  for (const was of legacyEntries) {
    const key = pairKey(was.path, was.patternId);
    if (migratedByPair.has(key)) continue;
    const real = hashesAtPair.get(key) ?? new Set<string>();
    const stillMatches = was.hashes === null ? real.size > 0 : was.hashes.some((h) => real.has(h));
    if (stillMatches) problems.push(`legacy entry ${was.index} (${clip(was.path)}, ${clip(was.patternId)}) is missing from migrated although it still matches`);
    else droppedEntries++;
  }

  let before = 0;
  let after = 0;
  let newlyAllowlisted = 0;
  let newlyBlocking = 0;
  for (const m of matches) {
    const was = legacyEntries.some((e) => covers(e, m));
    const now = migratedEntries.some((e) => covers(e, m));
    if (was) before++;
    if (now) after++;
    if (now && !was) newlyAllowlisted++;
    if (was && !now) newlyBlocking++;
  }
  // The direct measurement of the subset property over the scanner's own matches. It is reachable, but
  // never the only failure: a widening always also trips a structural check above (an entry on a pair with
  // no legacy entry, or an already value-scoped legacy entry that differs), as the exhaustive test
  // sb2-verify-widening-is-always-also-caught-structurally shows. Kept as an independent second proof, and
  // its count is what the verify output shows the reviewer.
  if (newlyAllowlisted > 0) problems.push(`${newlyAllowlisted} occurrence(s) are allowlisted by migrated but were not by legacy (a widening)`);
  if (newlyBlocking > 0) problems.push(`${newlyBlocking} occurrence(s) were allowlisted by legacy but would block under migrated`);

  return {
    ok: problems.length === 0,
    problems,
    counts: {
      legacyEntries: legacyEntries.length,
      migratedEntries: migratedEntries.length,
      droppedEntries,
      hashes: migratedEntries.reduce((n, e) => n + (e.hashes?.length ?? 0), 0),
      occurrencesBefore: before,
      occurrencesAfter: after,
      newlyAllowlisted,
      newlyBlocking,
    },
  };
}

/** One line per match of `patternId` in `text`: the sha256 of the matched bytes, two spaces, then the
 * redacted form the block message showed, so a developer can pair a hash with a blocked match.
 *
 * Issue 267 (red-team, fix-now round, MED): `oss01-scan-timeout` is not in `SECRET_PATTERNS` (it names a
 * scan failure, not a real pattern — see `history-scan.ts`), so looking it up there and throwing on "not
 * found" made the HASH-COMMAND the gate prints for EVERY scan-timeout block fail, unconditionally, for
 * every path and every commit — there was no way to actually compute and grant that finding kind. Fixed
 * together with Issue 264 (never alone: landing this without 264 would make the content-blind grant easy
 * to add) by re-running every real pattern against `text` and keeping only the resulting
 * `oss01-scan-timeout` findings — the exact same computation `scanBlobText` performs for the gate itself,
 * so this reproduces the identical hash(es) the gate reported, whichever real pattern(s) timed out. */
export function hashLines(text: string, patternId: string): string[] {
  if (patternId === SCAN_TIMEOUT_PATTERN_ID) {
    return scanBlobText(text, SECRET_PATTERNS)
      .filter((f) => f.patternId === SCAN_TIMEOUT_PATTERN_ID)
      .map((f) => `${f.valueSha256}  ${f.redacted}`);
  }
  const pattern = SECRET_PATTERNS.find((p) => p.id === patternId);
  if (pattern === undefined) throw new Error(`unknown pattern id ${patternId}`);
  return scanBlobText(text, [pattern]).map((f) => `${f.valueSha256}  ${f.redacted}`);
}

async function runVerify(argv: string[]): Promise<number> {
  const base = argValue(argv, "--base");
  const file = argValue(argv, "--migrated");
  if (base === undefined || file === undefined) throw new Error("verify needs --base <ref> and --migrated <file>");
  const git = makeGitOps(realRunner, process.cwd());
  let migrated: unknown;
  try {
    migrated = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    // A read error keeps its own message (the file name is the developer's argument); a parse error gets a fixed
    // one, because the parser's message quotes a piece of the file, which a pull request author chose.
    if (err instanceof SyntaxError) throw new Error("the migrated file is not valid JSON");
    throw err;
  }
  const report = verifyMigration(await readLegacyAtRef(base), migrated, await scanHistory(git, { ref: base }));
  const c = report.counts;
  console.log(`[allowlist-tool verify] ${report.ok ? "PASS" : "FAIL"}`);
  console.log(`[allowlist-tool verify] legacy entries: ${c.legacyEntries}, migrated entries: ${c.migratedEntries}, dropped as matching nothing: ${c.droppedEntries}, value hashes: ${c.hashes}`);
  console.log(`[allowlist-tool verify] occurrences allowlisted before: ${c.occurrencesBefore}, after: ${c.occurrencesAfter}; newly allowlisted: ${c.newlyAllowlisted}; newly blocking: ${c.newlyBlocking}`);
  for (const p of report.problems) console.log(`[allowlist-tool verify] problem: ${p}`);
  const entries = Array.isArray(migrated) ? (migrated as unknown[]).filter((e): e is AllowlistEntry => entryRejection(e) === null) : [];
  for (const line of classificationLines(entries)) console.log(`[allowlist-tool verify] ${line}`);
  return report.ok ? 0 : 1;
}

async function runHash(argv: string[]): Promise<number> {
  const [commit, path, patternId] = argv;
  if (commit === undefined || path === undefined || patternId === undefined) {
    throw new Error("hash needs <commit> <path> <patternId>");
  }
  const git = makeGitOps(realRunner, process.cwd());
  const sha = (await git.lsTree(commit)).get(path);
  if (sha === undefined) throw new Error(`${path} is not in ${commit}`);
  // Issue 246: decode every way the gate itself decodes (the latin1 reading, PLUS a BOM-triggered UTF-16
  // reading when present) and union the hash lines, so this command prints the SAME hash(es) the gate
  // computed — a raw `.toString("latin1")` here would silently miss a UTF-16-only match and the printed
  // unlock would never actually unlock it.
  const content = await git.catFileBlob(sha);
  const lines = [...new Set(decodeBlobVariants(content).flatMap((text) => hashLines(text, patternId)))];
  if (lines.length === 0) {
    console.error(`[allowlist-tool hash] no ${patternId} match in that blob`);
    return 1;
  }
  for (const line of lines) console.log(line);
  return 0;
}

export async function runTool(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "generate") return runGenerate(rest);
  if (command === "verify") return runVerify(rest);
  if (command === "hash") return runHash(rest);
  console.error(
    "usage: allowlist-tool.ts generate --base <ref> --out <file> | verify --base <ref> --migrated <file> | hash <commit> <path> <patternId>",
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTool(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`[allowlist-tool] ${(err as Error).message}`);
      process.exit(2);
    },
  );
}
