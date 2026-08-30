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

/** Pure: scans one blob's already-decoded text against every pattern. */
function scanBlobText(
  text: string,
  patterns: SecretPattern[],
): Array<Pick<HistoryMatch, "patternId" | "description" | "redacted">> {
  const found: Array<Pick<HistoryMatch, "patternId" | "description" | "redacted">> = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const m of text.matchAll(pattern.regex)) {
      found.push({ patternId: pattern.id, description: pattern.description, redacted: redact(m[0]) });
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
// test fixture, never a real secret) — matched by exact path + pattern id, never by a broad glob,
// so adding one is a deliberate, auditable act. An allowlisted match is still REPORTED (never
// silently dropped, QA-16's own discipline applied here) — it just doesn't fail the gate.
export interface AllowlistEntry {
  path: string;
  patternId: string;
  reason: string;
}

export function partitionAllowlisted(
  matches: HistoryMatch[],
  allowlist: AllowlistEntry[],
): { blocking: HistoryMatch[]; allowlisted: HistoryMatch[] } {
  const blocking: HistoryMatch[] = [];
  const allowlisted: HistoryMatch[] = [];
  for (const m of matches) {
    const hit = allowlist.some((e) => e.path === m.path && e.patternId === m.patternId);
    (hit ? allowlisted : blocking).push(m);
  }
  return { blocking, allowlisted };
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
      ...allowlistedDetails,
    ],
  };
}

async function loadAllowlist(path: string): Promise<AllowlistEntry[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AllowlistEntry =>
        typeof x === "object" && x !== null &&
        typeof (x as Record<string, unknown>).path === "string" &&
        typeof (x as Record<string, unknown>).patternId === "string",
    );
  } catch {
    return [];
  }
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

  // Report file: redacted matches only — never the raw secret text, per this module's own header.
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ scannedAt: new Date().toISOString(), allRefs, matchCount: matches.length, matches }, null, 2),
    "utf8",
  );

  printInstrumentResult("OSS-01 history-scan", result);
  console.log(`[OSS-01 history-scan] full report (redacted): ${outPath}`);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
