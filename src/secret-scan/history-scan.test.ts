import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink, mkdir, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import type { AllowlistEntry, HistoryMatch } from "./history-scan.ts";
import {
  isValidAllowlistEntry,
  loadAllowlist,
  partitionAllowlisted,
  scanHistory,
  SCAN_TIMEOUT_MS,
  SCAN_TIMEOUT_PATTERN_ID,
  summarizeMatches,
} from "./history-scan.ts";
import { redact, SECRET_PATTERNS } from "./patterns.ts";
import { readFile } from "node:fs/promises";

test("patterns: redact() never returns the full matched secret", () => {
  const fake = "AKIAABCDEFGHIJKLMNOP";
  const r = redact(fake);
  assert.ok(!r.includes(fake));
  assert.match(r, /REDACTED/);
});

test("history-scan: 0 matches -> real (non-vacuous) pass", () => {
  const result = summarizeMatches([]);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("history-scan: matches present -> FAIL, details carry only redacted values", () => {
  const result = summarizeMatches([
    { commit: "abc123", path: "config.ts", patternId: "aws-access-key-id", description: "AWS key", redacted: "AKIA…[REDACTED 20 chars]", valueSha256: sha256("fixture-a") },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /REDACTED/);
  assert.ok(!result.details.join("").includes("AKIAABCDEFGHIJKLMNOP"), "raw secret must never appear in output");
});

// Since Issue 136 (THOTH-ADR-0002) an entry exempts a match only when its path, its pattern id AND the
// value hash all agree. The two fixtures below share one hash, so this test isolates the path dimension;
// its title predates the hash and is kept as written (the value dimension is tested by the oss01- tests).
test("OSS-01 allowlist: partitionAllowlisted splits matches by exact path+patternId", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r", valueSha256: sha256("fixture-a") },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r", valueSha256: sha256("fixture-a") },
  ];
  const { blocking, allowlisted } = partitionAllowlisted(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "test fixture" },
  ]);
  assert.equal(allowlisted.length, 1);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.path, "src/config.ts");
});

test("OSS-01 allowlist: an allowlisted match does not fail the gate, but IS still reported (never silently dropped)", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "AKIA…[REDACTED]", valueSha256: sha256("fixture-a") },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "test fixture" },
  ]);
  assert.equal(result.ok, true, "allowlisted-only matches must not fail the gate");
  assert.match(result.details.join("\n"), /ALLOWLISTED/, "an allowlisted match must still appear in the report");
});

test("OSS-01 allowlist: a match NOT on the allowlist still fails the gate even if other matches ARE allowlisted", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r1", valueSha256: sha256("fixture-a") },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r2", valueSha256: sha256("fixture-a") },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "test fixture" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.summary, /1 secret-shaped match/);
});

test("OSS-01 allowlist loader: an entry WITH a non-empty reason is accepted (positive control, red-team finding 4)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-allowlist-reason-"));
  try {
    const p = join(dir, "allowlist.json");
    await writeFile(p, JSON.stringify([
      { path: "src/foo.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "documented test fixture" },
    ]));
    const loaded = await loadAllowlist(p);
    assert.equal(loaded.length, 1, "an entry with a real reason must be honored");
    assert.equal(loaded[0]?.reason, "documented test fixture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OSS-01 allowlist loader: an entry WITHOUT a reason (missing, or whitespace-only) is REJECTED, not silently honored (regression — GitHub Issue #135 finding 4 / red-team round-3 finding 4: `history-scan.ts`'s own header claims 'every entry is a reviewed, reasoned exception,' but the type-guard previously enforced only path+patternId)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-allowlist-noreason-"));
  try {
    const p = join(dir, "allowlist.json");
    await writeFile(p, JSON.stringify([
      { path: "src/foo.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")] }, // no `reason` field at all
      { path: "src/bar.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "   " }, // whitespace-only
      { path: "src/baz.ts", patternId: "aws-access-key-id", valueSha256: [sha256("fixture-a")], reason: "real, non-empty reason" },
    ]));
    const loaded = await loadAllowlist(p);
    assert.equal(loaded.length, 1, "only the entry with a real, non-empty reason may survive");
    assert.equal(loaded[0]?.path, "src/baz.ts");

    // End-to-end: a match against the reason-less entry's own (path, patternId) must now BLOCK
    // the gate, not pass silently — this is the actual security property red-team's finding
    // demonstrated was missing.
    const matches = [
      { commit: "a", path: "src/foo.ts", patternId: "aws-access-key-id", description: "x", redacted: "r", valueSha256: sha256("fixture-a") },
    ];
    const result = summarizeMatches(matches, loaded);
    assert.equal(result.ok, false, "a match against a reason-less (rejected) entry must fail the gate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass", async () => {
  const git = makeGitOps(realRunner, process.cwd());
  const matches = await scanHistory(git);
  const allowlist = await loadAllowlist("docs/qa/secret-scan-allowlist.json");
  const result = summarizeMatches(matches, allowlist);
  assert.equal(result.ok, true, `expected a clean pass, got: ${result.summary}\n${result.details.join("\n")}`);
});

// Historical context: this block records Issue #193 as it was fixed, when an entry exempted a file
// by `{path, patternId}` alone. Since Issue #136 (THOTH-ADR-0002) an entry exempts only the values it
// names, so the whole-file reach described below no longer exists; the two invariants that follow still
// hold and stay as defense in depth.
//
// GitHub Issue #193 (red-team round-2, path-b-precommit-secret-scan, [MED], security-class,
// demonstrated): `partitionAllowlisted` then matched an entry by `{path, patternId}` ONLY, never by
// the actual matched value (`history-scan.ts`'s own header disclosed this as pre-existing,
// intentional OSS-01 design). Applying that to a CREDENTIAL-shaped pattern on
// `docs/qa/secret-scan-allowlist.json` itself is what turned dangerous: round-1's own fix-now
// quoted a fake AWS-key-shaped fixture literal in a `reason` field to document it, which granted
// a BLANKET exemption for every future `aws-access-key-id` match ANYWHERE in that file, forever —
// not just in the entry that needed it. Red-team staged a DISTINCT, real-shaped key literal in a
// completely different `reason` field and it committed clean through both this pre-commit hook and
// CI's full-history scan (same allowlist, same blind spot, both layers), because ONE grant for a
// (path, patternId) pair then exempted the WHOLE file's blob for that pattern, not just the JSON key
// that motivated it. `docs/qa/secret-scan-allowlist.json` is the one file whose entire purpose is prose
// ABOUT secret-shaped strings, so it is also the single most dangerous place to ever reproduce one
// instead of describing it.
//
// Two invariants, both required, checked at the FILE level rather than per-entry — a per-entry
// check (does entry X's own reason match entry X's own patternId) is not sufficient: it would miss
// a real secret hidden in some OTHER entry's `reason` field (a different patternId, or even a
// totally unrelated one) while ANY grant for the dangerous pattern still existed anywhere in the
// file, since the exemption was whole-file, not per-key.
//   1. `docs/qa/secret-scan-allowlist.json` itself never GRANTS a credential-shaped pattern on
//      itself (no `{path: "docs/qa/secret-scan-allowlist.json", patternId: <credential-shaped>}`
//      entry at all) — this is the structural fix (GitHub Issue #193's own recommended shape).
//   2. The file's own raw text never CONTAINS a live match for any credential-shaped pattern,
//      anywhere, regardless of which entry it would sit in — catches the case invariant 1 alone
//      would miss, and is real defense-in-depth: as long as invariant 1 holds, this is what the
//      normal (non-exempted) scan would ALSO catch, so this test exists for fast, clearly-named,
//      local feedback pointing at this exact risk class rather than a generic scan failure.
//
// Scoped to CREDENTIAL-shaped patterns only (every `SECRET_PATTERNS` id except `internal-hostname`
// / `ipv4-private` / `email-address`) — this project's own established, human-accepted convention
// is to self-referentially quote hostname/email/IP exemplars directly (see this file's own
// pre-existing self-referential entries for those three patterns, which legitimately self-match by
// design); a real hostname/email/IP slipping through carries materially lower risk than a real
// credential, and scoping this check to "any pattern at all" would fail against dozens of
// already-accepted, already-reviewed entries.
const CREDENTIAL_SHAPED_PATTERN_IDS = SECRET_PATTERNS.map((p) => p.id).filter(
  (id) => !["internal-hostname", "ipv4-private", "email-address"].includes(id),
);

function matchesPatternLive(text: string, pattern: (typeof SECRET_PATTERNS)[number]): boolean {
  // A fresh, non-global RegExp per check — reusing a shared `g`-flagged regex's `.test()` would
  // carry `lastIndex` state across calls and silently skip matches.
  return new RegExp(pattern.regex.source, pattern.regex.flags.replace("g", "")).test(text);
}

const ALLOWLIST_PATH = "docs/qa/secret-scan-allowlist.json";

test("OSS-01 allowlist (GitHub Issue #193, red-team round-2 [MED], regression): the allowlist file " +
  "itself never grants a credential-shaped pattern on itself", async () => {
  const allowlistJson: unknown = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  const allowlist = allowlistJson as { path: string; patternId: string; reason: string }[];
  const selfGrants = allowlist.filter(
    (e) => e.path === ALLOWLIST_PATH && CREDENTIAL_SHAPED_PATTERN_IDS.includes(e.patternId),
  );
  assert.deepEqual(
    selfGrants,
    [],
    `${ALLOWLIST_PATH} must never grant itself a credential-shaped pattern (GitHub Issue #193) -- ` +
      `such a grant exempts EVERY future match for that pattern anywhere in this file, not just the ` +
      `entry that motivated it:\n${JSON.stringify(selfGrants, null, 2)}`,
  );
});

test("OSS-01 allowlist (GitHub Issue #193, red-team round-2 [MED], regression): the allowlist " +
  "file's own raw text contains no live match for any credential-shaped pattern, anywhere -- a real " +
  "secret hidden in ANY entry's reason field (not just one granting its own pattern) would be " +
  "invisible to this test if it only checked entries against their own declared patternId, since " +
  "the exemption is whole-file, not per-key", async () => {
  const raw = await readFile(ALLOWLIST_PATH, "utf8");
  const offenders: string[] = [];
  for (const id of CREDENTIAL_SHAPED_PATTERN_IDS) {
    const pattern = SECRET_PATTERNS.find((p) => p.id === id)!;
    if (matchesPatternLive(raw, pattern)) offenders.push(id);
  }
  assert.deepEqual(
    offenders,
    [],
    `${ALLOWLIST_PATH}'s own raw text must never contain a live credential-shaped match (GitHub ` +
      `Issue #193) -- describe an attack literal in prose, never reproduce it: ${offenders.join(", ")}`,
  );
});

// GitHub Issue #199 (red-team round-3, path-b-precommit-secret-scan, [MED], security-class,
// demonstrated): Issue #193's own fix -- reword the allowlist file's `reason` fields, delete its
// self-grant -- correctly closed the blind spot for `docs/qa/secret-scan-allowlist.json` itself,
// but the SAME blind spot then opened on `docs/STATE.md` and `docs/decisions.md`, when fixing a
// LATER recurrence there needed its own (then whole-file) `aws-access-key-id` grant on each.
//
// GitHub Issue #199 follow-up (red-team round-4, findings F1 + F2 + F3 -- Issue #199 reopened +
// Issue #200): the first fix (commit `c96a4d5`) replaced one hardcoded path with a hardcoded
// ONE-ELEMENT array (`NARRATIVE_STATUS_FILES = ["docs/STATE.md"]`) -- the exact same
// hand-typed-opt-in shape this Issue itself was filed against, one file over (F1). A second,
// independent gap (F2, Issue #200): the exclusion categories it reasoned about were unbounded in
// TIME -- they exempted a file's FUTURE bytes forever, not just the already-reviewed bytes that
// justified the exemption at the time (a NEW `docs/decisions.md` row, or a new trailing comment in
// the already-granted `patterns.test.ts`, both committed clean with zero setup). F3: the exclusion
// taxonomy itself was a hand-derived completeness claim -- CLAUDE.md forbids that for a non-trivial
// set. All three are fixed together below by one DERIVED, data-driven mechanism, not a bigger
// hand-typed list:
//   1. The checked set is every {path, patternId} credential-shaped grant CURRENTLY in the real
//      allowlist (`deriveMutableCredentialGrants`, below) -- an instrument read (JSON.parse of the
//      real file), never a hand-typed array. A new grant on any file, anywhere, is in this set on
//      its very next run with no code change here (fixes F1).
//   2. No path is excluded. A dated report under `docs/reviews/` was once excluded on the theory
//      that a persisted report's bytes stay fixed, but a brand-new report, or an appended addendum,
//      can carry an unreviewed live value on its first commit like any other file (issue 203,
//      closed by the value-scoped allowlist change). A report grant is therefore pinned to a
//      baseline at grant time exactly like every other file. Report immutability itself is not
//      enforced mechanically (issue 233); nothing here relies on it. `docs/decisions.md`'s
//      append-only rows and every `*.test.ts` fixture (edited every round of this very story) stay
//      in the checked set too, generalized rather than special-cased away (fixes F2's mis-scoped
//      exclusions).
//   3. Every {path, patternId} is checked against a pinned, already-reviewed baseline
//      (`REVIEWED_BASELINE`, below): the sha256 hashes of the exact literal(s) present in that file
//      when this baseline was pinned (this commit). A live match whose hash is NOT in the baseline
//      is, by construction, an occurrence nobody has reviewed yet -- it fails, whether it arrives
//      via a brand-new grant (F1's class -- empty baseline, anything fails) or a new occurrence
//      added to an already-granted file (F2's class -- the file has a baseline, but this specific
//      value isn't in it). `docs/STATE.md`'s own baseline is the empty set, unchanged from the
//      original #199 fix's zero-tolerance property (its "Last updated" section is routinely
//      rewritten in full, so a live literal there is always a fresh mistake, never an
//      already-reasoned historical record).
// Hashes, never raw literal text, in the baseline map below -- so this file's own baseline data
// can't itself become the next place a secret-shaped string gets reproduced (the same discipline
// `redact()` applies in production code).
//
// This also fixes F3: there is no longer a hand-typed "these are the N files in M categories"
// claim anywhere in this comment for a future edit to silently drift out of sync with -- the
// derivation re-reads the real allowlist every run, and the self-check test near the end of this
// file (which runs this very file's own text through QA-15's `completeness-claim-checker`)
// mechanically verifies no such claim has crept back in.

/** Pure (F1's actual fix): every credential-shaped grant in `allowlist`, with no path excluded
 * (issue 203: a dated report is pinned like any other file). No hand-typed opt-in list -- add a grant
 * on any new file anywhere and it is in this set on the very next run, with no change to this
 * function. */
function deriveMutableCredentialGrants(
  allowlist: { path: string; patternId: string }[],
): { path: string; patternId: string }[] {
  const seen = new Set<string>();
  const out: { path: string; patternId: string }[] = [];
  for (const e of allowlist) {
    if (!CREDENTIAL_SHAPED_PATTERN_IDS.includes(e.patternId)) continue;
    const key = `${e.path}::${e.patternId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.path, patternId: e.patternId });
  }
  return out;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Pure: live match substrings for one patternId in one file's raw current text. */
function liveMatchValues(raw: string, patternId: string): string[] {
  const pattern = SECRET_PATTERNS.find((p) => p.id === patternId)!;
  return [...raw.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))].map((m) => m[0]);
}

/** Pure (F2's actual fix): the count of live matches whose sha256 is NOT already in the pinned,
 * already-reviewed baseline for this {path, patternId} -- i.e. occurrences nobody has reviewed. */
function unreviewedOccurrenceCount(raw: string, patternId: string, baselineHashes: readonly string[]): number {
  return liveMatchValues(raw, patternId).filter((v) => !baselineHashes.includes(sha256(v))).length;
}

// Pinned at this fix's own commit: the sha256 hashes of the exact, already-reviewed occurrences
// this repo's real history carries today for each still-mutable credential-granted file (computed
// via the same `deriveMutableCredentialGrants` + live-scan mechanism above, against real HEAD --
// not hand-counted). A key with no entry here defaults to an EMPTY baseline (zero tolerance) --
// exactly what a brand-new grant gets on its first run. Bump an entry only alongside a real review
// of the new literal it would admit; anything else is exactly the "unreviewed occurrence" this
// mechanism exists to catch.
// GitHub Issue #201 (red-team round-5 F1, [MED], demonstrated): each entry now also carries a
// non-empty `reason` -- the same field, same strictness (`typeof === "string" && .trim().length >
// 0`), that `loadAllowlist` (history-scan.ts, `entryRejection`) already mechanically enforces on the real
// allowlist. Without it, a new grant + a live literal + a self-computed sha256
// baseline bump could land in one commit with zero justification -- this map is a suppression
// list (DevOps ADR-0008) and was the only suppression surface in this repo without one.
const REVIEWED_BASELINE: Readonly<Record<string, { readonly hashes: readonly string[]; readonly reason: string }>> = Object.freeze({
  "docs/STATE.md::aws-access-key-id": {
    hashes: [],
    reason:
      "zero-tolerance baseline: STATE.md's own \"Last updated\" section is rewritten in full every " +
      "commit, so any live literal here is always a fresh, unreviewed mistake, never an " +
      "already-reasoned historical record (original Issue #199 fix).",
  },
  "docs/decisions.md::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "the story's HARD STOP ruling row quotes the same sed search-string literal as STATE.md's " +
      "matching row (docs/qa/secret-scan-allowlist.json's own grant reason) -- a command's search " +
      "string can't be described instead of reproduced and still be copy-pasteable. Reviewed at pin time.",
  },
  "src/secret-scan/history-scan.test.ts::aws-access-key-id": {
    hashes: [
      "457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3",
      "228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5",
      // AKIABRANDNEWLITERALX -- this file's own F2 mutation-proof fixture literal (below), reviewed
      // and pinned in this same commit.
      "e9da1ee448bf00a9b51dc63897b3fc459d76a080a4cc900f03efb43a9fc45c08",
    ],
    reason:
      "this file's own OSS-01 fixture literals: Issue #193's fake-AWS-key self-test fixture, plus " +
      "this commit's own F2 mutation-proof fixture -- each clearly labeled fake at its point of use. Not a real credential.",
  },
  "src/secret-scan/patterns.test.ts::aws-access-key-id": {
    hashes: ["457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3"],
    reason:
      "pattern-catalog unit test fixture proving the aws-access-key-id regex matches its target " +
      "shape (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "src/secret-scan/patterns.test.ts::github-pat": {
    hashes: ["69d9b3cd81135e6d313218061397834a72fca4a414f3c9fa86c9a3e703003d16"],
    reason:
      "pattern-catalog unit test fixture: a classic-shaped ghp_ literal proving the " +
      "github-fine-grained-pat negative-control case (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "src/secret-scan/patterns.test.ts::github-fine-grained-pat": {
    hashes: ["f9d7b451214c89291bbfca241ea863a76e3785c4eb9e501d1d6f6160327a0d63"],
    reason:
      "pattern-catalog unit test fixture proving the github-fine-grained-pat regex matches GitHub's " +
      "real fine-grained-PAT shape (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "src/secret-scan/simulated-commit.test.ts::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "this file's own synthetic AWS-key-shaped fixture, planted directly into isolated mkdtemp git " +
      "fixtures to prove buildSimulatedCommit() sources the real staged index (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "src/secret-scan/pre-commit-scan.test.ts::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "this file's own FAKE_SECRET constant, planted into isolated fixture repos to prove the " +
      "pre-commit CLI and installed git hook both refuse it (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  // Issue 203: dated reports are pinned like every other file. The hashes below were computed by the
  // derivation above (each report's live matches for its pattern, sha256), not typed by hand; the
  // reasons are written by hand and each says what the reviewed literal is.
  "docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-round2-2026-09-06.md::github-fine-grained-pat": {
    hashes: ["31413d391f94609e50a50ab19d59c6963a4e20d10c9f00ad123719675c6cb786"],
    reason:
      "NAMED EXCEPTION, not a synthetic literal: a truncated prefix (identifier segment and separator, " +
      "secret segment absent) of what the report records as a real credential, quoted as demonstrated " +
      "evidence. The allowlist entry's own reason says the rotation call on the underlying credential is a " +
      "human decision still open (issue 89); THOTH-ADR-0002 names this one exception and the human " +
      "decides it at the pull request.",
  },
  "docs/reviews/cifix-cross-domain-round2-2026-09-09.md::github-pat": {
    hashes: ["19036933862b4b4080198c2c821cf36c2ae17f058269eacf7dd29ba1a4cdae47"],
    reason:
      "a classic-shaped exemplar quoted in a dated report while it discusses the fine-grained pattern's " +
      "coverage gap (docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "docs/reviews/cifix-cross-domain-round2-2026-09-09.md::github-fine-grained-pat": {
    hashes: ["79fc75fe924ade1dd03d6e8ff052602c1dfedbee54744ddc92d9934f3c6c328a"],
    reason:
      "a fine-grained-shaped exemplar quoted in the same report while it discusses that coverage gap " +
      "(docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "docs/reviews/path-b-precommit-secret-scan-red-team-2026-09-14.md::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "the story's synthetic AWS-key-shaped fixture literal (the same value as pre-commit-scan.test.ts's " +
      "FAKE_SECRET, so the same hash), quoted as verbatim evidence in a dated report " +
      "(docs/qa/secret-scan-allowlist.json's own grant reason). Not a real credential.",
  },
  "docs/reviews/path-b-precommit-secret-scan-app-security-2026-09-14.md::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "the story's synthetic AWS-key-shaped fixture literal (same value and hash as the red-team report's " +
      "entry above), quoted as verbatim evidence in a dated report. Not a real credential.",
  },
  "docs/reviews/path-b-precommit-secret-scan-cross-domain-round2-2026-09-14.md::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "the story's synthetic AWS-key-shaped fixture literal (same value and hash as the entries above), " +
      "quoted as verbatim evidence in a dated report. Not a real credential.",
  },
  "docs/reviews/path-b-precommit-secret-scan-cross-domain-round3-2026-09-14.md::aws-access-key-id": {
    hashes: ["228e2fa94b1e1b9c1d89cc194806f7582d814b3cad812a6a28994dd50eb9d1d5"],
    reason:
      "the story's synthetic AWS-key-shaped fixture literal (same value and hash as the entries above), " +
      "quoted as verbatim evidence in a dated report. Not a real credential.",
  },
});

test("OSS-01 allowlist (GitHub Issue #199 reopened + Issue #200, red-team round-4 [MED]x2, " +
  "regression): every still-mutable file carrying a credential-pattern allowlist grant has no " +
  "live match beyond its own pinned, already-reviewed baseline -- the checked set is DERIVED from " +
  "the real allowlist every run (no hand-typed opt-in list, F1), and each grant's exemption is " +
  "bounded to its already-reviewed occurrences, not the whole file forever (F2)", async () => {
  const allowlistJson: unknown = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  const allowlist = allowlistJson as { path: string; patternId: string; reason: string }[];
  const grants = deriveMutableCredentialGrants(allowlist);

  const offenders: string[] = [];
  for (const { path, patternId } of grants) {
    const raw = await readFile(path, "utf8");
    const baseline = REVIEWED_BASELINE[`${path}::${patternId}`]?.hashes ?? [];
    const n = unreviewedOccurrenceCount(raw, patternId, baseline);
    if (n > 0) offenders.push(`${path} (${patternId}): ${n} unreviewed occurrence(s) beyond its pinned baseline`);
  }
  assert.deepEqual(
    offenders,
    [],
    "every still-mutable credential-granted file must carry no live match beyond its pinned, " +
      `already-reviewed baseline (GitHub Issue #199/#200): ${offenders.join("; ")}`,
  );
});

// GitHub Issues #201 + #202 (red-team round-5 F1/F2, [MED]x2, both demonstrated): the checks above
// pin WHICH occurrences are reviewed, but nothing pinned the derived set's own MEMBERSHIP or the
// baseline's own JUSTIFICATION. Mutation M3 (widening the since-removed IMMUTABLE_REPORT_PREFIX from "docs/reviews/"
// to "docs/") silently dropped docs/STATE.md and docs/decisions.md from the checked set (8 -> 6
// derived grants, measured) with every other test staying green (#202); separately,
// REVIEWED_BASELINE's bare hex-hash entries carried no per-grant reason, unlike loadAllowlist's
// mechanically-enforced `reason` field six lines away in history-scan.ts, so a new grant + a live
// literal + a self-computed baseline hash could land in one commit with zero justification (#201).
// Same discipline as completeness-claim-checker.ts's own DEFAULT_FILES precedent (Issue #142):
// pin the set's exact membership and assert it, rather than trusting the derivation to keep
// deriving the same thing forever.
test("OSS-01 baseline integrity (GitHub Issues #201 + #202, red-team round-5 [MED]x2, " +
  "demonstrated): REVIEWED_BASELINE's key set equals deriveMutableCredentialGrants(the real " +
  "allowlist) exactly -- catching a silently widened/narrowed IMMUTABLE_REPORT_PREFIX (#202) -- " +
  "and every baseline entry carries a non-empty, real per-grant reason, the same strictness " +
  "loadAllowlist already enforces on the allowlist itself (#201)", async () => {
  const allowlistJson: unknown = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  const allowlist = allowlistJson as { path: string; patternId: string; reason: string }[];
  const derivedKeys = deriveMutableCredentialGrants(allowlist)
    .map((g) => `${g.path}::${g.patternId}`)
    .sort();
  assert.deepEqual(
    derivedKeys,
    Object.keys(REVIEWED_BASELINE).sort(),
    "REVIEWED_BASELINE's key set has drifted from the real allowlist's derived credential grants -- " +
      "a narrowed/widened IMMUTABLE_REPORT_PREFIX, or a stale/missing baseline entry (GitHub Issue #202)",
  );
  const unjustified = Object.entries(REVIEWED_BASELINE)
    .filter(([, v]) => typeof v.reason !== "string" || v.reason.trim().length === 0)
    .map(([k]) => k);
  assert.deepEqual(
    unjustified,
    [],
    `every REVIEWED_BASELINE entry must carry a non-empty per-grant reason (GitHub Issue #201): ${unjustified.join(", ")}`,
  );
});

test("OSS-01 allowlist (Issue #199 follow-up, mutation/positive-control proof, F1): " +
  "deriveMutableCredentialGrants includes ANY new file's credential grant -- proving the checked " +
  "set is genuinely derived, not a hardcoded list scoped to docs/STATE.md alone", () => {
  const fakeAllowlist = [
    { path: "CHANGELOG.md", patternId: "aws-access-key-id" }, // a file never named anywhere in this test file
    { path: "docs/reviews/some-report-2026-09-14.md", patternId: "aws-access-key-id" }, // a report grant: no longer excluded (issue 203)
    { path: "docs/STATE.md", patternId: "email-address" }, // non-credential pattern id, excluded on that basis
    { path: "CHANGELOG.md", patternId: "aws-access-key-id" }, // duplicate grant, deduped
  ];
  assert.deepEqual(deriveMutableCredentialGrants(fakeAllowlist), [
    { path: "CHANGELOG.md", patternId: "aws-access-key-id" },
    { path: "docs/reviews/some-report-2026-09-14.md", patternId: "aws-access-key-id" },
  ]);
});

test("OSS-01 allowlist (GitHub Issue #199 follow-up, mutation proof, red-team's own CHANGELOG.md " +
  "attack shape, F1): a BRAND-NEW file grant with no pinned baseline blocks on its very first live " +
  "occurrence -- proves the empty-default baseline is real, not a silent pass", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-newgrant-"));
  try {
    const fixturePath = join(dir, "CHANGELOG.md");
    await writeFile(fixturePath, "- fixed a bug, accidentally left AKIAFAKEFAKEFAKEFAKE in the notes\n");
    const raw = await readFile(fixturePath, "utf8");
    // No REVIEWED_BASELINE entry exists for this path -- `?? []`, same default a real brand-new
    // grant gets on its first run.
    const n = unreviewedOccurrenceCount(raw, "aws-access-key-id", REVIEWED_BASELINE[`${fixturePath}::aws-access-key-id`]?.hashes ?? []);
    assert.ok(n > 0, "a brand-new grant's first live literal must be caught with zero prior baseline");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OSS-01 allowlist (GitHub Issue #200 follow-up, mutation proof, red-team's own " +
  "docs/decisions.md-new-row / patterns.test.ts-trailing-comment attack shape, F2): an " +
  "ALREADY-baselined file's already-reviewed literal stays clean, but ONE new, distinct live " +
  "literal beyond its pinned baseline still blocks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-beyondbaseline-"));
  try {
    const fixturePath = join(dir, "already-granted.md");
    const baseline = [sha256("AKIAFAKEFAKEFAKEFAKE")]; // simulates a real pinned baseline
    await writeFile(
      fixturePath,
      "old, already-reviewed row: AKIAFAKEFAKEFAKEFAKE\nnew row nobody has reviewed: AKIABRANDNEWLITERALX\n",
    );
    const raw = await readFile(fixturePath, "utf8");
    const n = unreviewedOccurrenceCount(raw, "aws-access-key-id", baseline);
    assert.equal(n, 1, "the already-reviewed literal must not re-trip the gate, but the new distinct one must");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// GitHub Issue #199 follow-up (F3): the comment block above no longer makes a hand-typed
// completeness claim about "N files in M categories" for a future edit to drift out of sync with
// -- but to keep it that way, this file's own real text is run through QA-15's own instrument
// (`completeness-claim-checker.ts`, already proven sound by its own test suite) on every
// `npm test`, the same mechanical check CLAUDE.md's "no hand-derived completeness claims" rule
// requires. A reintroduced "N files, M categories" claim with no `[[completeness: ...]]` marker
// would fail this test the same way it would fail against `docs/STATE.md`/`CHANGELOG.md`.
test("OSS-01 allowlist (GitHub Issue #199 follow-up, F3): this file's own text carries no " +
  "un-instrumented numeric completeness claim -- mechanically verified via QA-15's " +
  "completeness-claim-checker, not hand-asserted in a comment", async () => {
  const { checkCompleteness } = await import("../qa/completeness-claim-checker.ts");
  const ownText = await readFile("src/secret-scan/history-scan.test.ts", "utf8");
  const result = await checkCompleteness(ownText, realRunner);
  assert.equal(result.ok, true, `this file's own text failed QA-15: ${result.summary}\n${result.details.join("\n")}`);
});

test("OSS-01 allowlist (GitHub Issue #193, red-team round-2 [MED], regression, mutation-sensitivity " +
  "proof): both checks above ARE detected when a live credential-shaped literal/self-grant is " +
  "actually present -- proves the guards are real, not green-by-construction", () => {
  const pattern = SECRET_PATTERNS.find((p) => p.id === "aws-access-key-id")!;

  const plantedRawText =
    'some prose around it, "reason": "this reason field carelessly reproduces AKIAFAKEFAKEFAKEFAKE instead of describing it"';
  assert.ok(
    matchesPatternLive(plantedRawText, pattern),
    "the raw-text detection helper itself must catch a live credential-shaped literal when one is present",
  );

  const plantedAllowlist = [{ path: ALLOWLIST_PATH, patternId: "aws-access-key-id", reason: "no literal here" }];
  const selfGrants = plantedAllowlist.filter(
    (e) => e.path === ALLOWLIST_PATH && CREDENTIAL_SHAPED_PATTERN_IDS.includes(e.patternId),
  );
  assert.equal(selfGrants.length, 1, "the self-grant detection itself must catch a credential-shaped grant when one is present");
});

test("OSS-01 allowlist (GitHub Issue #199, red-team round-3 [MED], regression, mutation-sensitivity " +
  "proof): the check above genuinely reads each narrative-status file's real, current content -- " +
  "not a stubbed or cached copy -- and would fail if a live literal were actually present", async () => {
  // Reuses the same matchesPatternLive detection helper already proven live above (the #193
  // mutation-sensitivity test); what needs proving here is narrower and specific to this test's own
  // new plumbing -- that reading the real file and scanning its real bytes actually happens, not that
  // pattern matching itself works. A fresh temp copy of a real narrative-status shape, seeded with a
  // planted literal, must be caught by the exact same read-and-scan steps the real test performs.
  const fixtureDir = await mkdtemp(join(tmpdir(), "oss01-narrative-status-"));
  try {
    const fixturePath = join(fixtureDir, "STATE.md");
    await writeFile(
      fixturePath,
      "**Last updated:** a session note carelessly quoting AKIAFAKEFAKEFAKEFAKE verbatim\n",
    );
    const pattern = SECRET_PATTERNS.find((p) => p.id === "aws-access-key-id")!;
    const raw = await readFile(fixturePath, "utf8");
    assert.ok(
      matchesPatternLive(raw, pattern),
      "a real read of a fixture file containing a live literal must be detected by the same steps " +
        "the #199 test above performs against docs/STATE.md itself",
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("OSS-01: catches a fake secret planted in a NON-HEAD commit, and redacts it before logging", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "oss01-history-"));
  try {
    const git = makeGitOps(realRunner, repoDir);
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }

    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");

    // Commit 1: innocuous.
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");

    // Commit 2: a fake secret lands in history.
    const fakeSecret = "AKIAFAKEFAKEFAKEFAKE"; // AWS-key-shaped, 20 chars, clearly not a real credential
    await writeFile(join(repoDir, "config.js"), `const key = "${fakeSecret}";\n`);
    await run("add", ".");
    await run("commit", "-q", "-m", "oops, added a key");

    // Commit 3: removed again — the fake secret is now ABSENT from the working tree / HEAD,
    // present only in a non-HEAD ancestor commit. A working-tree-only scan would miss it.
    await unlink(join(repoDir, "config.js"));
    await run("add", ".");
    await run("commit", "-q", "-m", "remove the key");

    const matches = await scanHistory(git);

    const found = matches.filter((m) => m.patternId === "aws-access-key-id");
    assert.equal(found.length, 1, "must find the fake secret even though it is absent from HEAD");
    assert.equal(found[0]?.path, "config.js");

    // Redaction proof: the raw fake secret must never appear anywhere in the match object.
    const serialized = JSON.stringify(matches);
    assert.ok(!serialized.includes(fakeSecret), "raw secret text must be redacted before it is ever logged/serialized");
    assert.match(found[0]?.redacted ?? "", /REDACTED/);

    const result = summarizeMatches(matches);
    assert.equal(result.ok, false, "the history scan must fail the build on a real finding");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("OSS-01: a working-tree-only view would miss the planted secret (proves 'full history' is the load-bearing part)", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "oss01-worktree-"));
  try {
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");

    const fakeSecret = "AKIAFAKEFAKEFAKEFAKE";
    await writeFile(join(repoDir, "config.js"), `const key = "${fakeSecret}";\n`);
    await run("add", ".");
    await run("commit", "-q", "-m", "oops");
    await unlink(join(repoDir, "config.js"));
    await run("add", ".");
    await run("commit", "-q", "-m", "remove");

    // A naive "scan the files currently on disk" check — the thing OSS-01 says is insufficient.
    const { readdirSync } = await import("node:fs");
    const filesOnDisk = readdirSync(repoDir);
    assert.ok(!filesOnDisk.includes("config.js"), "the secret file is genuinely gone from the working tree");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

// ================================================================================================
// Issues 136 and 203 (story S-B2): value-scoped allowlist entries. An entry exempts a match only
// when its path, its patternId AND the sha256 of the matched bytes all agree. Every literal below
// is built at RUNTIME from fragments so this file's own text never holds a secret-shaped string
// (the fixtures need no allowlist entry, and the scanner reading this file finds nothing new).
// Hashes in assertions come from the independent `sha256` helper defined earlier in this file,
// never from the production hashing code.
// ================================================================================================

const HISTORY_SCAN_SCRIPT = fileURLToPath(new URL("./history-scan.ts", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REVIEWS_DIR = ["docs", "reviews"].join("/");

function pad(seed: string, len: number, fill: string): string {
  return (seed + fill.repeat(len)).slice(0, len);
}
function tag(n: number): string {
  return n.toString(36);
}

/** One builder per pattern id: `text` is a file line holding exactly one match, `match` is the exact
 * substring the pattern's regex captures (the bytes that get hashed). `n` makes the value distinct. */
const NOVEL: Record<string, (n: number) => { text: string; match: string }> = {
  "aws-access-key-id": (n) => {
    const m = "AKIA" + pad(tag(n).toUpperCase(), 16, "Q");
    return { text: `k = ${m}`, match: m };
  },
  "aws-secret-access-key": (n) => {
    const m = `${["aws", "secret", "access", "key"].join("_")} = "${pad(tag(n), 40, "a")}"`;
    return { text: m, match: m };
  },
  "github-pat": (n) => {
    const m = ["ghp", pad(tag(n), 36, "b")].join("_");
    return { text: `t ${m}`, match: m };
  },
  "github-fine-grained-pat": (n) => {
    const m = ["github", "pat", pad(tag(n), 22, "c"), pad(tag(n), 30, "d")].join("_");
    return { text: `t ${m}`, match: m };
  },
  "slack-token": (n) => {
    const m = ["xoxb", pad(tag(n), 12, "e")].join("-");
    return { text: `t ${m}`, match: m };
  },
  "private-key-block": (n) => {
    const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const end = ["-----END", "PRIVATE KEY-----"].join(" ");
    const m = [begin, pad("MIIB" + tag(n), 32, "A"), end].join("\n");
    return { text: m, match: m };
  },
  "generic-password-assignment": (n) => {
    const m = `${["pass", "word"].join("")} = "${pad(tag(n), 12, "x")}"`;
    return { text: m, match: m };
  },
  "internal-hostname": (n) => {
    const m = [`novel${tag(n)}`, "internal"].join(".");
    return { text: `h ${m}`, match: m };
  },
  "ipv4-private": (n) => {
    const m = ["10", String(n), "3", "4"].join(".");
    return { text: `a ${m}`, match: m };
  },
  "email-address": (n) => {
    const m = [`novel${tag(n)}.person`, "mail.example.org"].join("@");
    return { text: `e ${m}`, match: m };
  },
};

function novel(patternId: string, n: number): { text: string; match: string } {
  const build = NOVEL[patternId];
  if (build === undefined) assert.fail(`no runtime literal builder for pattern id ${patternId} -- add one to NOVEL`);
  return build(n);
}

function matchFor(path: string, patternId: string, valueSha256: string): HistoryMatch {
  return { commit: "c0ffee000000", path, patternId, description: "d", redacted: "r", valueSha256 };
}

function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** A throwaway git repo with `files` committed in one commit. The committer identity is built at
 * runtime. The caller's callback gets the repo directory; cleanup always runs. */
async function withRepo<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-"));
  try {
    const run = async (...args: string[]): Promise<void> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    };
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", ["ci", "example.org"].join("@"));
    await run("config", "user.name", "Test");
    await run("config", "commit.gpgsign", "false");
    for (const [p, content] of Object.entries(files)) {
      const abs = join(dir, ...p.split("/"));
      await mkdir(join(abs, ".."), { recursive: true });
      await writeFile(abs, content);
    }
    await run("add", ".");
    await run("commit", "-q", "-m", "fixture");
    return await fn(dir);
  } finally {
    await removeDir(dir);
  }
}

function allowlistJson(entries: unknown[]): string {
  return JSON.stringify(entries, null, 2) + "\n";
}

function runCli(script: string, cwd: string, args: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("node", [script, ...args], { cwd, encoding: "utf8", timeoutMs: 120_000 });
}

test("oss01-entry-exempts-only-its-granted-values", () => {
  const granted = sha256("granted-value");
  const other = sha256("some-other-value");
  const entry: AllowlistEntry = { path: "src/a.txt", patternId: "aws-access-key-id", valueSha256: [granted], reason: "fixture" };
  const matches = [
    matchFor("src/a.txt", "aws-access-key-id", granted), // cell 1: same path, same pattern, granted hash
    matchFor("src/a.txt", "aws-access-key-id", other), // cell 2: same path, same pattern, other hash
    matchFor("src/a.txt", "github-pat", granted), // cell 3: same hash, other pattern
    matchFor("src/b.txt", "aws-access-key-id", granted), // cell 4: same hash, other path
  ];
  const { blocking, allowlisted } = partitionAllowlisted(matches, [entry]);
  assert.deepEqual(allowlisted, [matches[0]], "only the fully agreeing cell may be exempt");
  assert.deepEqual(blocking, [matches[1], matches[2], matches[3]]);
});

test("oss01-allowlisted-file-still-blocks-a-novel-secret", async () => {
  const granted = novel("aws-access-key-id", 1);
  const fresh = novel("aws-access-key-id", 2);
  const entries = [{ path: "fixture.txt", patternId: "aws-access-key-id", valueSha256: [sha256(granted.match)], reason: "synthetic fixture" }];
  await withRepo({ "fixture.txt": `${granted.text}\n${fresh.text}\n`, [ALLOWLIST_PATH]: allowlistJson(entries) }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const allowlist = await loadAllowlist(join(dir, ALLOWLIST_PATH));
    const result = summarizeMatches(matches, allowlist);
    const output = [result.summary, ...result.details].join("\n");
    assert.equal(result.ok, false, "a novel value in a granted file must block");
    assert.match(result.summary, /^1 secret-shaped match/, "exactly the novel value blocks");
    assert.ok(result.details.some((d) => d.startsWith("ALLOWLISTED") && d.includes("fixture.txt")), "the granted literal is still reported");
    assert.ok(result.details.some((d) => /UNLOCK/.test(d)), "the block names its unlock (PRINCIPLES rule 2)");
    for (const secret of [granted.match, fresh.match, sha256(fresh.match), sha256(granted.match)]) {
      assert.ok(!output.includes(secret), "no raw value and no hash appears in the block output");
    }
  });
});

test("oss01-reviewed-literal-stays-allowlisted-and-reported", () => {
  const h = sha256("reviewed-fixture-literal");
  const result = summarizeMatches(
    [matchFor("src/fixture.txt", "aws-access-key-id", h)],
    [{ path: "src/fixture.txt", patternId: "aws-access-key-id", valueSha256: [h], reason: "reviewed fixture" }],
  );
  assert.equal(result.ok, true);
  assert.ok(result.details.some((d) => d.startsWith("ALLOWLISTED") && d.includes("src/fixture.txt")), "an allowlisted match is still reported");
});

test("oss01-real-allowlist-refuses-a-novel-value-in-every-granted-pair", async () => {
  const entries = await loadAllowlist(ALLOWLIST_PATH);
  assert.ok(entries.length > 0, "the real allowlist must not be empty (derived from the file, not typed)");
  const perPath = new Map<string, string[]>();
  entries.forEach((e, i) => {
    const lines = perPath.get(e.path) ?? [];
    lines.push(novel(e.patternId, i + 1).text);
    perPath.set(e.path, lines);
  });
  const files: Record<string, string> = {};
  for (const [p, lines] of perPath) files[p] = lines.join("\n") + "\n";
  await withRepo(files, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const { blocking, allowlisted } = partitionAllowlisted(matches, entries);
    assert.equal(allowlisted.length, 0, "a novel value must never be exempt by the real allowlist");
    assert.equal(blocking.length, matches.length);
    for (const e of entries) {
      assert.ok(
        blocking.some((m) => m.path === e.path && m.patternId === e.patternId),
        `expected a blocking novel value at a granted pair (pattern ${e.patternId}, path ${e.path})`,
      );
    }
  });
});

test("sb2-three-human-named-pairs-are-value-scoped", async () => {
  const entries = await loadAllowlist(ALLOWLIST_PATH);
  const file = ["src", "secret-scan", "patterns.test.ts"].join("/");
  const raw = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8")) as Array<{ path: string; patternId: string; valueSha256?: unknown }>;
  for (const id of ["github-fine-grained-pat", "github-pat", "internal-hostname"]) {
    const found = raw.filter((e) => e.path === file && e.patternId === id);
    assert.equal(found.length, 1, `exactly one entry for ${id} on the pattern catalog test file`);
    const e = found[0]!;
    assert.ok(isValidAllowlistEntry(e), `${id}: entry must be a valid value-scoped entry`);
    assert.ok(Array.isArray(e.valueSha256) && e.valueSha256.length > 0, `${id}: entry must carry a non-empty hash list`);
    const { blocking } = partitionAllowlisted([matchFor(file, id, sha256(`novel-${id}`))], entries);
    assert.equal(blocking.length, 1, `${id}: a novel value must block on the once-whole-file pair`);
  }
});

const MALFORMED_SCOPES: Array<[string, (h: string) => unknown]> = [
  ["missing valueSha256", () => undefined],
  ["empty list", () => []],
  ["a string, not a list", (h) => h],
  ["null", () => null],
  ["a non-hex character", (h) => [h.slice(0, 63) + "g"]],
  ["uppercase hex", (h) => [h.toUpperCase()]],
  ["wrong length (short)", (h) => [h.slice(0, 63)]],
  ["wrong length (long)", (h) => [h + "a"]],
  ["a non-string element", () => [123]],
  ["one valid hash plus one malformed", (h) => [h, "zz"]],
];

test("sb2-malformed-or-missing-scope-is-rejected-and-blocks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-malformed-"));
  try {
    const good = sha256("control-value");
    const entries: unknown[] = [];
    const matches: HistoryMatch[] = [];
    MALFORMED_SCOPES.forEach(([, scope], i) => {
      const h = sha256(`malformed-${i}`);
      const value = scope(h);
      entries.push({ path: `bad-${i}.txt`, patternId: "aws-access-key-id", ...(value === undefined ? {} : { valueSha256: value }), reason: "fixture" });
      matches.push(matchFor(`bad-${i}.txt`, "aws-access-key-id", h));
    });
    entries.push({ path: "control.txt", patternId: "aws-access-key-id", valueSha256: [good], reason: "fixture" });
    matches.push(matchFor("control.txt", "aws-access-key-id", good));
    const p = join(dir, "allowlist.json");
    await writeFile(p, allowlistJson(entries));
    const loaded = await loadAllowlist(p);
    assert.deepEqual(loaded.map((e) => e.path), ["control.txt"], "only the well-formed control entry survives the loader");
    const { blocking, allowlisted } = partitionAllowlisted(matches, loaded);
    assert.deepEqual(allowlisted.map((m) => m.path), ["control.txt"]);
    assert.equal(blocking.length, MALFORMED_SCOPES.length, "every malformed entry's match blocks");
  } finally {
    await removeDir(dir);
  }
});

test("sb2-partial-migration-does-not-leave-legacy-shape-entries-honored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-partial-"));
  try {
    const hashes = ["a", "b", "c"].map((k) => sha256(`partial-${k}`));
    const p = join(dir, "allowlist.json");
    await writeFile(p, allowlistJson([
      { path: "a.txt", patternId: "aws-access-key-id", valueSha256: [hashes[0]], reason: "fixture" },
      { path: "b.txt", patternId: "aws-access-key-id", reason: "legacy shape: path and pattern only" },
      { path: "c.txt", patternId: "aws-access-key-id", valueSha256: [hashes[2]], reason: "fixture" },
    ]));
    const loaded = await loadAllowlist(p);
    assert.deepEqual(loaded.map((e) => e.path), ["a.txt", "c.txt"], "the legacy-shaped entry must not be loaded");
    const matches = [
      matchFor("a.txt", "aws-access-key-id", hashes[0]!),
      matchFor("b.txt", "aws-access-key-id", hashes[1]!),
      matchFor("c.txt", "aws-access-key-id", hashes[2]!),
    ];
    const { blocking } = partitionAllowlisted(matches, loaded);
    assert.deepEqual(blocking.map((m) => m.path), ["b.txt"], "only the legacy-shaped entry's match blocks");
  } finally {
    await removeDir(dir);
  }
});

test("sb2-partial-migration-control-all-valid-entries-are-honored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-partial-ctl-"));
  try {
    const h = sha256("partial-control");
    const p = join(dir, "allowlist.json");
    await writeFile(p, allowlistJson([{ path: "a.txt", patternId: "aws-access-key-id", valueSha256: [h], reason: "fixture" }]));
    const loaded = await loadAllowlist(p);
    assert.equal(loaded.length, 1);
    assert.equal(partitionAllowlisted([matchFor("a.txt", "aws-access-key-id", h)], loaded).blocking.length, 0);
  } finally {
    await removeDir(dir);
  }
});

test("sb2-regex-edit-invalidates-entries-loudly", async () => {
  // Same literal, two boundaries for one pattern id: A matches a 6-character prefix, B matches 8.
  const boundaryA = [{ id: "custom", description: "boundary A", regex: /zq[a-z]{4}/g }];
  const boundaryB = [{ id: "custom", description: "boundary B", regex: /zq[a-z]{6}/g }];
  const literal = ["zq", "abcdef"].join("");
  await withRepo({ "notes.txt": `x ${literal}\n` }, async (dir) => {
    const git = makeGitOps(realRunner, dir);
    const entries: AllowlistEntry[] = [{ path: "notes.txt", patternId: "custom", valueSha256: [sha256("zqabcd")], reason: "hashed under boundary A" }];
    const underA = summarizeMatches(await scanHistory(git, { patterns: boundaryA }), entries);
    assert.equal(underA.ok, true, "control: the entry hashed under the boundary it was derived from is honored");
    const underB = summarizeMatches(await scanHistory(git, { patterns: boundaryB }), entries);
    assert.equal(underB.ok, false, "the boundary moved, the entry is stale, the match must block");
    assert.ok(underB.details.some((d) => /UNLOCK/.test(d)), "and the block says how to re-derive it");
  });
});

test("sb2-scanner-hashes-at-match-time-and-stores-no-raw-text", async () => {
  const aws = novel("aws-access-key-id", 5);
  const key = novel("private-key-block", 6);
  const pwText = `${["pass", "word"].join("")} = "caféxyz12"`; // one non-ASCII character inside the match
  await withRepo({ "one.txt": `${aws.text}\n`, "two.txt": `${key.text}\n`, "three.txt": `${pwText}\n` }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const byPath = new Map(matches.map((m) => [m.path, m]));
    assert.equal(byPath.get("one.txt")?.valueSha256, sha256(aws.match));
    assert.equal(byPath.get("two.txt")?.valueSha256, sha256(key.match), "a match spanning lines hashes the raw bytes");
    assert.equal(byPath.get("three.txt")?.valueSha256, sha256(pwText), "a non-ASCII match hashes the file's own UTF-8 bytes");
    const serialized = JSON.stringify(matches);
    for (const raw of [aws.match, key.match, pwText]) assert.ok(!serialized.includes(raw), "raw matched text is never stored on the match");
  });
});

test("sb2-real-allowlist-loads-with-no-rejected-entry", async () => {
  const raw: unknown = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  assert.ok(Array.isArray(raw));
  const loaded = await loadAllowlist(ALLOWLIST_PATH);
  assert.equal(loaded.length, raw.length, "the loader silently dropped an entry of the real file");
  assert.deepEqual(loaded.rejected, [], "the real file must load with nothing rejected");
  for (const e of loaded) assert.ok(Array.isArray(e.valueSha256) && e.valueSha256.length > 0);
});

test("sb2-rejected-entry-is-named-in-blocking-output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-rejected-"));
  try {
    const good = sha256("named-good");
    const upper = sha256("named-upper").toUpperCase();
    const blocked = matchFor("blocked.txt", "aws-access-key-id", sha256("named-blocked"));
    const entriesFile = join(dir, "entries.json");
    await writeFile(entriesFile, allowlistJson([
      { path: "ok.txt", patternId: "aws-access-key-id", valueSha256: [good], reason: "fixture" },
      { path: "upper.txt", patternId: "github-pat", valueSha256: [upper], reason: "fixture" },
      { path: "legacy.txt", patternId: "email-address", reason: "legacy shape" },
    ]));
    const loaded = await loadAllowlist(entriesFile);
    const text = summarizeMatches([blocked], loaded).details.join("\n");
    assert.match(text, /REJECTED-ENTRY index=1 path=upper\.txt pattern=github-pat: .*valueSha256/, "the malformed-hash entry is named");
    assert.match(text, /REJECTED-ENTRY index=2 path=legacy\.txt pattern=email-address: .*valueSha256/, "the legacy-shaped entry is named");
    for (const secret of [good, upper, upper.toLowerCase(), blocked.valueSha256]) assert.ok(!text.includes(secret), "no hash in the block output");

    // File-level rejections: a BOM-prefixed file, a non-array document, a missing file.
    const bomFile = join(dir, "bom.json");
    await writeFile(bomFile, "﻿" + allowlistJson([{ path: "ok.txt", patternId: "aws-access-key-id", valueSha256: [good], reason: "fixture" }]));
    const objectFile = join(dir, "object.json");
    await writeFile(objectFile, "{}");
    const fileCases: Array<[string, string]> = [
      [bomFile, "not-valid-json"],
      [objectFile, "not-an-array"],
      [join(dir, "absent.json"), "unreadable-or-missing"],
    ];
    for (const [file, reasonClass] of fileCases) {
      const l = await loadAllowlist(file);
      assert.equal(l.length, 0, "an unusable file yields no entries, every match blocks");
      const t = summarizeMatches([blocked], l).details.join("\n");
      assert.match(t, /REJECTED-ALLOWLIST-FILE/);
      assert.ok(t.includes(reasonClass), `the file-level reason class ${reasonClass} is named`);
    }
  } finally {
    await removeDir(dir);
  }
});

test("sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file", async () => {
  const granted = novel("aws-access-key-id", 7);
  const fresh = novel("aws-access-key-id", 8);
  const entries = [{ path: "fixture.txt", patternId: "aws-access-key-id", valueSha256: [sha256(granted.match)], reason: "synthetic fixture" }];
  await withRepo({ "fixture.txt": `${granted.text}\n${fresh.text}\n`, [ALLOWLIST_PATH]: allowlistJson(entries) }, async (dir) => {
    const res = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.notEqual(res.code, 0, `the CI entry point must fail on a novel secret in a granted file:\n${res.stdout}`);
    assert.match(res.stdout, /UNLOCK/, "the failing run names its unlock");
    assert.ok(!res.stdout.includes(fresh.match) && !res.stdout.includes(granted.match), "no raw value on stdout");
  });
});

test("sb2-history-scan-cli-control-granted-literal-alone-exits-zero", async () => {
  const granted = novel("aws-access-key-id", 9);
  const entries = [{ path: "fixture.txt", patternId: "aws-access-key-id", valueSha256: [sha256(granted.match)], reason: "synthetic fixture" }];
  await withRepo({ "fixture.txt": `${granted.text}\n`, [ALLOWLIST_PATH]: allowlistJson(entries) }, async (dir) => {
    const res = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.equal(res.code, 0, `positive control: a fully granted literal must pass:\n${res.stdout}\n${res.stderr}`);
  });
});

test("sb2-report-file-omits-value-hash-for-blocking-matches", async () => {
  const granted = novel("aws-access-key-id", 10);
  const fresh = novel("aws-access-key-id", 11);
  const entries = [{ path: "granted.txt", patternId: "aws-access-key-id", valueSha256: [sha256(granted.match)], reason: "synthetic fixture" }];
  await withRepo({ "granted.txt": `${granted.text}\n`, "blocked.txt": `${fresh.text}\n`, [ALLOWLIST_PATH]: allowlistJson(entries) }, async (dir) => {
    const res = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.notEqual(res.code, 0);
    const reportText = await readFile(join(dir, "docs", "qa", "history-scan-report.json"), "utf8");
    const report = JSON.parse(reportText) as { matches: Array<{ path: string; valueSha256?: string }> };
    const blockedMatch = report.matches.find((m) => m.path === "blocked.txt");
    const grantedMatch = report.matches.find((m) => m.path === "granted.txt");
    assert.ok(blockedMatch !== undefined && grantedMatch !== undefined);
    assert.ok(!("valueSha256" in blockedMatch), "a blocking match carries no value hash (a guessable hash of a possibly-real secret)");
    assert.equal(grantedMatch.valueSha256, sha256(granted.match), "an allowlisted match may carry its hash");
    assert.ok(!reportText.includes(sha256(fresh.match)), "the blocking value's hash appears nowhere in the report");
    assert.ok(!reportText.includes(fresh.match) && !reportText.includes(granted.match), "no raw value in the report");
    assert.ok(!res.stdout.includes(sha256(fresh.match)), "and not in the log either");
  });
});

test("sb2-unlock-command-output-is-accepted-by-the-gate", async () => {
  // For every pattern id the catalog carries (derived, so a new pattern without a builder fails here).
  for (const pattern of SECRET_PATTERNS) {
    const lit = novel(pattern.id, 12);
    await withRepo({ "fixture.txt": `${lit.text}\n`, [ALLOWLIST_PATH]: allowlistJson([]) }, async (dir) => {
      const blocked = await runCli(HISTORY_SCAN_SCRIPT, dir);
      assert.notEqual(blocked.code, 0, `${pattern.id}: an ungranted literal must block`);
      assert.match(blocked.stdout, /regex MATCH/, "the unlock names what is hashed");
      assert.match(blocked.stdout, /generic-password-assignment/);
      assert.match(blocked.stdout, /aws-secret-access-key/);
      const line = blocked.stdout.split("\n").find((l) => l.includes("HASH-COMMAND") && l.includes(`[${pattern.id}]`));
      assert.ok(line !== undefined, `${pattern.id}: the unlock prints a hash command for the blocked pair`);
      const command = /: (node .*)$/.exec(line.trimEnd())?.[1];
      assert.ok(command !== undefined, `${pattern.id}: could not read the printed command`);

      // The printed command names a repo-relative tool: give the fixture repo its own copy.
      await mkdir(join(dir, "src"), { recursive: true });
      await cp(join(PROJECT_ROOT, "src", "lib"), join(dir, "src", "lib"), { recursive: true });
      await cp(join(PROJECT_ROOT, "src", "secret-scan"), join(dir, "src", "secret-scan"), { recursive: true });
      const shellRun = spawnSync(command, { cwd: dir, shell: true, encoding: "utf8" });
      assert.equal(shellRun.status, 0, `${pattern.id}: the printed command must run in the platform shell: ${shellRun.stderr}`);
      const hashes = shellRun.stdout.split("\n").map((l) => /^([0-9a-f]{64})\s/.exec(l)?.[1]).filter((h): h is string => h !== undefined);
      assert.deepEqual(hashes, [sha256(lit.match)], `${pattern.id}: the command yields the hash of the regex match text`);

      await writeFile(
        join(dir, ...ALLOWLIST_PATH.split("/")),
        allowlistJson([{ path: "fixture.txt", patternId: pattern.id, valueSha256: hashes, reason: "synthetic fixture" }]),
      );
      const after = await runCli(HISTORY_SCAN_SCRIPT, dir);
      assert.equal(after.code, 0, `${pattern.id}: the gate must accept the hash the command printed:\n${after.stdout}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Issue 239 (app-security HIGH, and red-team F1, the same defect found independently), which also
// covers the symptom of Issue 238: the gate prints a per-pair HASH-COMMAND for a maintainer to paste,
// and the path in it comes from the tree of a pull request, i.e. from a contributor. A path holding a
// shell metacharacter must never sit inside a printed command. Rule under test: a runnable command is
// printed only for a path of [A-Za-z0-9._/-]; any other path gets a line that is not a command and
// carries the path only percent-encoded. Nothing here writes a scanner-shaped literal: the hostile
// names carry a payload that only creates a marker file, and the secret-shaped content comes from
// `novel(...)`, built at runtime.
// ---------------------------------------------------------------------------------------------

const SAFE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;
const RUNNABLE_LINE =
  /^HASH-COMMAND for [A-Za-z0-9._/-]+ \[[a-z0-9-]+\]: node src\/secret-scan\/allowlist-tool\.ts hash [0-9a-f]{12} "[A-Za-z0-9._/-]+" [a-z0-9-]+$/;
const NO_COMMAND_PREFIX = "NO-COMMAND-PRINTED for path ";
// Every character a shell (sh, PowerShell or cmd) can give a meaning to. A line that is not a command
// must carry none of them, so pasting it anywhere cannot run anything.
const SHELL_METACHARS = /[$`;&|<>"'\\(){}*?~!#^\n\r]/;
const PAYLOAD = "node mk.mjs"; // the payload only writes MARKER into the shell's working directory
const MARKER = "MARK";

/** Independent statement of the display rule (not the production function): every character outside
 * the safe set becomes %HH per UTF-8 byte, upper-case hex. */
function pctEncode(s: string): string {
  let out = "";
  for (const ch of s) {
    if (SAFE_PATH_CHARS.test(ch)) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Hostile file names as a contributor could commit them. `labels` say which shell each is aimed at. */
const HOSTILE_BATCH_A: Array<[string, string]> = [
  ["command substitution", `a$(${PAYLOAD})b.txt`],
  ["backticks", `a\`${PAYLOAD}\`b.txt`],
  ["semicolons", `a;${PAYLOAD};b.txt`],
  ["single ampersands", `a&${PAYLOAD}&b.txt`],
  ["pipes", `a|${PAYLOAD}|b.txt`],
  ["double ampersands", `a&&${PAYLOAD}&&b.txt`],
  ["parentheses and spaces", `a (${PAYLOAD}) b.txt`],
  ["non-ASCII with a substitution", `é$(${PAYLOAD}).txt`],
  ["a plain space, no payload", "my file.md"],
];
const HOSTILE_BATCH_B: Array<[string, string]> = [
  ["two double quotes, cmd parity even", `a" & ${PAYLOAD} & "b.txt`],
  ["four double quotes, cmd parity even", `a"" & ${PAYLOAD} & ""b.txt`],
  ["one double quote, cmd parity odd", `a" & ${PAYLOAD} & b.txt`],
  ["quotes around a semicolon", `a"; ${PAYLOAD}; "b.txt`],
  ["single quotes around a substitution", `a'$(${PAYLOAD})'b.txt`],
  ["backslash quote", `a\\"$(${PAYLOAD})\\"b.txt`],
  ["non-ASCII only, no payload", "résumé.md"],
  ["cmd variable syntax, no payload", "%PATH%.txt"],
  ["shell variable syntax, no payload", "a$HOME.txt"],
];
const SAFE_PATHS = ["plain.txt", "docs/reviews/x-2026-09-19.md", "src/a_b-c.d/e.ts", "-leading-dash.txt", "UPPER.MD"];

test("sb2-unlock-command-never-embeds-a-shell-metacharacter-path", () => {
  // The other two parts of the printed command are safe by construction; this proves it from the catalog.
  for (const p of SECRET_PATTERNS) assert.match(p.id, /^[a-z0-9-]+$/, `pattern id ${p.id} must be printable in a command`);

  const linesFor = (path: string): string[] => summarizeMatches([matchFor(path, "aws-access-key-id", sha256("x"))]).details;

  // (a) Every printable ASCII character: the safe set keeps its runnable command, every other one gets
  // none. Derived from the character range, so a character added to the safe set by mistake fails here.
  for (let code = 0x20; code <= 0x7e; code++) {
    const ch = String.fromCharCode(code);
    const path = `a${ch}b.txt`;
    const lines = linesFor(path);
    const runnable = lines.filter((l) => l.startsWith("HASH-COMMAND for "));
    if (SAFE_PATH_CHARS.test(path)) {
      assert.equal(runnable.length, 1, `a path with ${JSON.stringify(ch)} is safe and keeps its command`);
      assert.match(runnable[0] ?? "", RUNNABLE_LINE);
    } else {
      assert.deepEqual(runnable, [], `a path holding ${JSON.stringify(ch)} must never appear in a printed command`);
    }
  }

  // (b) The hostile table, plus non-ASCII: no line of the runnable shape, one non-command line that
  // carries the path only percent-encoded and no metacharacter of any shell.
  for (const [label, name] of [...HOSTILE_BATCH_A, ...HOSTILE_BATCH_B]) {
    const lines = linesFor(name);
    assert.deepEqual(lines.filter((l) => l.startsWith("HASH-COMMAND for ")), [], `${label}: no runnable command for this path`);
    const own = lines.filter((l) => l.startsWith(NO_COMMAND_PREFIX));
    assert.equal(own.length, 1, `${label}: exactly one non-command line for the pair`);
    const line = own[0] ?? "";
    assert.ok(line.startsWith(`${NO_COMMAND_PREFIX}${pctEncode(name)} [aws-access-key-id]`), `${label}: the path appears percent-encoded, first: ${line}`);
    assert.match(line, /shell quoting/, `${label}: says plainly why no command is printed`);
    assert.ok(!SHELL_METACHARS.test(line), `${label}: the non-command line carries no shell metacharacter: ${line}`);
    assert.ok(!line.includes(PAYLOAD), `${label}: the payload text never appears verbatim`);
    const how = lines.filter((l) => l.startsWith("NO-COMMAND-PRINTED: "));
    assert.equal(how.length, 1, `${label}: one line tells the developer how to get the hash`);
    // Updated in the Issue 241 batch: the how-to line used to name the hash tool and a path to quote; it now
    // names the sha256 of the matched text and involves no path (see the oss01-unlock-no-command-line test).
    assert.match(how[0] ?? "", /sha256 tool/);
    assert.doesNotMatch(how[0] ?? "", /allowlist-tool\.ts hash/);
    assert.ok(!SHELL_METACHARS.test(how[0] ?? ""), `${label}: the how-to line carries no shell metacharacter`);
  }

  // (c) Safe paths still get exactly the runnable command, and no non-command line.
  for (const path of SAFE_PATHS) {
    const lines = linesFor(path);
    const runnable = lines.filter((l) => l.startsWith("HASH-COMMAND for "));
    assert.equal(runnable.length, 1, `${path}: keeps its command`);
    assert.match(runnable[0] ?? "", RUNNABLE_LINE);
    assert.deepEqual(lines.filter((l) => l.startsWith("NO-COMMAND-PRINTED")), [], `${path}: no non-command line`);
  }

  // (d) The percent encoding is injective (a literal percent is itself encoded), so the shown path is
  // never ambiguous, and it only ever uses characters that are inert in every shell.
  assert.notEqual(pctEncode("a b"), pctEncode("a%20b"));
  assert.match(pctEncode(`a$(x)"\`;&|é%`), /^[A-Za-z0-9._/%-]+$/);

  // (e) A mixed run keeps the safe pair's command and gives the hostile pair none.
  const mixed = summarizeMatches([
    matchFor("plain.txt", "aws-access-key-id", sha256("x")),
    matchFor(`a$(${PAYLOAD})b.txt`, "aws-access-key-id", sha256("x")),
  ]).details;
  assert.equal(mixed.filter((l) => l.startsWith("HASH-COMMAND for ")).length, 1);
  assert.equal(mixed.filter((l) => l.startsWith(NO_COMMAND_PREFIX)).length, 1);
});

/** A throwaway repo built with git plumbing only, so a path a filesystem would refuse (a double quote,
 * a pipe, an angle bracket) can still be a tree entry: no working-tree file is created for it. The
 * allowlist file is written to the working directory (untracked), which is where the gate reads it. */
async function withPlumbingRepo<T>(files: Record<string, string | Buffer>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-plumb-"));
  const blobs = await mkdtemp(join(tmpdir(), "oss01-sb2-blobs-"));
  try {
    const git = async (...args: string[]): Promise<string> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
      return res.stdout.trim();
    };
    await git("init", "-q", "-b", "main");
    let n = 0;
    for (const [path, content] of Object.entries(files)) {
      const src = join(blobs, `blob-${n++}`);
      await writeFile(src, content);
      const sha = await git("hash-object", "-w", "--no-filters", src);
      await git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${sha},${path}`);
    }
    const tree = await git("write-tree");
    const commit = await git(
      "-c", "user.name=Test", "-c", `user.email=${["ci", "example.org"].join("@")}`, "-c", "commit.gpgsign=false",
      "commit-tree", tree, "-m", "fixture",
    );
    await git("update-ref", "refs/heads/main", commit);
    await mkdir(join(dir, "docs", "qa"), { recursive: true });
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson([]));
    return await fn(dir);
  } finally {
    await removeDir(dir);
    await removeDir(blobs);
  }
}

/** Runs one line through the platform shell (sh, or cmd on Windows) in `cwd`, as a maintainer pasting it. */
function pasteIntoShell(line: string, cwd: string): void {
  spawnSync(line, { cwd, shell: true, encoding: "utf8", timeout: 30_000 });
}

test("oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path", async () => {
  const tool = ["src", "secret-scan", "allowlist-tool.ts"].join("/");
  const shellDir = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "oss01-sb2-shell-"));
    await writeFile(join(d, "mk.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(MARKER)}, "x");\n`);
    return d;
  };
  const batches: Array<[string, Array<[string, string]>]> = [["A", HOSTILE_BATCH_A], ["B", HOSTILE_BATCH_B]];
  let controlRuns = 0;
  const controlExecuted: string[] = [];

  for (const [batchName, rows] of batches) {
    const files: Record<string, string> = {};
    rows.forEach(([, name], i) => { files[name] = `${novel("aws-access-key-id", 100 + i).text}\n`; });
    await withPlumbingRepo(files, async (dir) => {
      const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
      assert.equal(cli.code, 1, `batch ${batchName}: the gate blocks every hostile-named file:\n${cli.stdout}\n${cli.stderr}`);
      const printed = cli.stdout.split(/\r?\n/).map((l) => l.replace(/^ {2}- /, ""));

      // (i) no printed command carries a hostile path: not one line has the runnable shape here.
      assert.deepEqual(printed.filter((l) => l.startsWith("HASH-COMMAND for ")), [], `batch ${batchName}: a hostile path reached a printed command`);
      const noCommand = printed.filter((l) => l.startsWith(NO_COMMAND_PREFIX));
      assert.equal(noCommand.length, rows.length, `batch ${batchName}: one non-command line per hostile pair (cap of ten not reached)`);
      for (const l of noCommand) assert.ok(!SHELL_METACHARS.test(l), `batch ${batchName}: a non-command line carries a shell metacharacter: ${l}`);

      // (iii) defense in depth: paste every unlock line, raw and as printed, into the platform shell.
      const unlockLines = cli.stdout.split(/\r?\n/).filter((l) => l.includes("HASH-COMMAND") || l.includes("NO-COMMAND-PRINTED"));
      assert.ok(unlockLines.length > rows.length, `batch ${batchName}: the unlock lines were found`);
      const scratch = await shellDir();
      try {
        for (const l of unlockLines) {
          pasteIntoShell(l, scratch);
          pasteIntoShell(l.replace(/^ {2}- /, ""), scratch);
        }
        assert.ok(!existsSync(join(scratch, MARKER)), `batch ${batchName}: pasting the printed unlock lines into the shell ran a payload`);
      } finally {
        await removeDir(scratch);
      }

      // Positive control, so the check above cannot pass because the harness is blind: the command the
      // OLD code printed for the same tree entries (path as git spells it, inside double quotes) must
      // execute a payload on this platform's shell for at least one of them.
      const spelled = await realRunner("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8" });
      for (const gitSpelling of spelled.stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0)) {
        const oldShape = `node ${tool} hash c0ffee000000 "${gitSpelling}" aws-access-key-id`;
        const control = await shellDir();
        try {
          pasteIntoShell(oldShape, control);
          controlRuns++;
          if (existsSync(join(control, MARKER))) controlExecuted.push(gitSpelling);
        } finally {
          await removeDir(control);
        }
      }
    });
  }
  assert.ok(controlRuns >= HOSTILE_BATCH_A.length + HOSTILE_BATCH_B.length, "the control ran for every hostile tree entry");
  assert.ok(
    controlExecuted.length > 0,
    "positive control: the old command shape must execute a payload in this platform shell for some hostile name, or this test proves nothing",
  );

  // Control for the other direction: a safe path in the same real CLI still prints the runnable command.
  await withPlumbingRepo({ "docs/plain-fixture.txt": `${novel("aws-access-key-id", 150).text}\n` }, async (dir) => {
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    const runnable = cli.stdout.split(/\r?\n/).map((l) => l.replace(/^ {2}- /, "")).filter((l) => l.startsWith("HASH-COMMAND for "));
    assert.equal(runnable.length, 1);
    assert.match(runnable[0] ?? "", RUNNABLE_LINE);
  });
});

// Red-team round 2 R1 (Issue 241, MED) and app-security round 2 LOW 1: for a path that gets no runnable
// command, the gate must not tell the maintainer to quote a contributor-chosen path by hand or to paste
// one anywhere. Red-team measured every quoting strategy (as printed, double quotes, single quotes)
// executing a payload for some hostile name in some shell, so the instruction is removed, not improved.
// What the how-to line offers instead involves no path: the value hash is the sha256 of the matched text.
test("oss01-unlock-no-command-line-never-instructs-hand-quoting-or-pasting-a-path", async () => {
  const INSTRUCTS_PATH_HANDLING =
    /quote (the|this|that|it|your)|hand-quot|quote the path|wrap\b.*\bquotes|\bpaste|copy (the|this) path|spelled (exactly )?as|type the path|match line|escape|enclos|surround/i;
  const names: Array<[string, string]> = [
    ["command substitution", `a$(${PAYLOAD})b.txt`],
    ["backticks", `a\`${PAYLOAD}\`b.txt`],
    ["even double-quote parity", `a"" & ${PAYLOAD} & ""b.txt`],
    ["a plain space", "my file.md"],
    ["non-ASCII", "résumé.md"],
  ];
  const files: Record<string, string> = {};
  names.forEach(([, name], i) => { files[name] = `${novel("aws-access-key-id", 200 + i).text}\n`; });
  await withPlumbingRepo(files, async (dir) => {
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.equal(cli.code, 1, `the gate blocks every one of these files:\n${cli.stdout}\n${cli.stderr}`);
    const printed = cli.stdout.split(/\r?\n/).map((l) => l.replace(/^ {2}- /, ""));

    assert.equal(printed.filter((l) => l.startsWith(NO_COMMAND_PREFIX)).length, names.length, "control: every name took the no-command branch");
    const offenders = printed.filter((l) => INSTRUCTS_PATH_HANDLING.test(l) && (l.startsWith("NO-COMMAND-PRINTED") || l.startsWith("UNLOCK") || l.startsWith("HASH-COMMAND")));
    assert.deepEqual(offenders, [], "no unlock line tells the reader to quote, wrap, copy or paste a path, or to look one up in the match line");

    // The how-to line still says how to get the hash, and it involves no path at all.
    const how = printed.filter((l) => l.startsWith("NO-COMMAND-PRINTED: "));
    assert.equal(how.length, 1, "one how-to line for the run");
    const line = how[0] ?? "";
    assert.match(line, /sha256/, "names the hash to compute");
    assert.match(line, /matched text/, "says what is hashed: the regex match, as the ADR defines it");
    assert.match(line, /sha256 tool/, "computable with any sha256 tool, over the literal in the developer's own file");
    assert.match(line, /rename/, "the alternative for a path that needs quoting: rename it to a shell-safe path");
    assert.match(line, /Issue 241/, "and where a shell-safe channel is tracked");
    assert.doesNotMatch(line, /allowlist-tool\.ts hash/, "no command to assemble, so no path goes into one");
    assert.ok(!SHELL_METACHARS.test(line), "and the line itself carries no shell metacharacter");
  });
});

// ---------------------------------------------------------------------------------------------
// Round 3. Red-team F1 (Issue 243, MED): the rejected-entry line echoed a contributor-authored allowlist
// path and pattern id raw, so a name holding shell syntax reached the log unquoted. Red-team F2 (Issue 244,
// MED): the guard for the Issue 241 ruling was a phrase blacklist, so a rewording of the removed advice
// passed. Payloads are built at runtime; the hostile strings only ever create a marker file.
// ---------------------------------------------------------------------------------------------

/** A scratch directory holding mk.mjs, the marker-writing script the payload runs. */
async function shellScratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "oss01-sb2-shell-"));
  await writeFile(join(d, "mk.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(MARKER)}, "x");\n`);
  return d;
}

/** The rejected-entry line as the round-2 code printed it: control characters become "?", nothing else changes. */
function oldRejectedLine(index: number, path: unknown, patternId: unknown, reasonClass: string): string {
  const clipOld = (s: unknown): string =>
    typeof s !== "string" ? "?" : [...s.slice(0, 120)].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? "?" : c)).join("");
  return `REJECTED-ENTRY index=${index} path=${clipOld(path)} pattern=${clipOld(patternId)}: ${reasonClass}`;
}

const REJECTED_ENTRY_LINE = /^REJECTED-ENTRY index=(\d+) path=([A-Za-z0-9._/%-]+) pattern=([A-Za-z0-9._/%-]+): ([A-Za-z0-9-]+)$/;
const REJECTED_FILE_LINE = /^REJECTED-ALLOWLIST-FILE: (unreadable-or-missing|not-valid-json|not-an-array)$/;

test("oss01-rejected-entry-line-never-carries-a-shell-metacharacter-from-the-allowlist-file", async () => {
  // Hostile entries: a path AND a pattern id built from the same shell syntax. The hash list is malformed
  // on purpose, so the loader rejects every entry and the gate prints one rejected-entry line each.
  const rows: Array<[string, unknown, unknown]> = [
    ["command substitution", `a$(${PAYLOAD})b.txt`, `p$(${PAYLOAD})`],
    ["backticks", `a\`${PAYLOAD}\`b.txt`, `p\`${PAYLOAD}\``],
    ["ampersand", `a&${PAYLOAD}&b.txt`, `p&${PAYLOAD}&`],
    ["semicolon", `a;${PAYLOAD};b.txt`, `p;${PAYLOAD};`],
    ["pipe", `a|${PAYLOAD}|b.txt`, `p|${PAYLOAD}|`],
    ["double-quote parity, even", `a"" & ${PAYLOAD} & ""b.txt`, `p" & ${PAYLOAD} & "`],
    ["double-quote parity, odd", `a" & ${PAYLOAD} & b.txt`, `p"`],
    ["PowerShell subexpression", `a $(New-Item ${MARKER} -ItemType File) b.txt`, `p $(New-Item ${MARKER} -ItemType File)`],
    ["raw newline", `a\n${PAYLOAD}\nb.txt`, `p\n${PAYLOAD}`],
    ["a plain space", "my file.md", "my pattern"],
    ["non-ASCII", "résumé.md", "pattèrn"],
    ["percent forms", "%PATH%.txt", "%CD%%%"],
    ["longer than the cap", `${"x".repeat(150)}$(${PAYLOAD})`, `${"y".repeat(150)}`],
    ["not a string", 42, ["not", "a", "string"]],
  ];
  const entries = rows.map(([, path, patternId]) => ({ path, patternId, valueSha256: ["zz"], reason: "r" }));
  await withPlumbingRepo({ "plain.txt": `${novel("aws-access-key-id", 400).text}\n` }, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson(entries));
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.equal(cli.code, 1, `a blocking match is present, so the gate fails and prints the rejections:\n${cli.stdout}\n${cli.stderr}`);
    const stdoutLines = cli.stdout.split(/\r?\n/).filter((l) => l.length > 0);

    // One physical line per rejected entry, and nothing in column zero except the bracketed status lines.
    const rejected = stdoutLines.filter((l) => l.replace(/^ {2}- /, "").startsWith("REJECTED-ENTRY"));
    assert.equal(rejected.length, rows.length, "exactly one physical line per rejected entry (a raw newline must not split one)");
    for (const l of stdoutLines) assert.ok(/^ {2}- /.test(l) || l.startsWith("[OSS-01 history-scan]"), `a line in column zero: ${JSON.stringify(l)}`);

    // The path and pattern fields carry only [A-Za-z0-9._/%-], and equal the independent encoding of the clipped input.
    rows.forEach(([label, path, patternId], i) => {
      const line = (rejected[i] ?? "").replace(/^ {2}- /, "");
      const m = REJECTED_ENTRY_LINE.exec(line);
      assert.ok(m !== null, `${label}: the rejected-entry line has only safe fields: ${JSON.stringify(line)}`);
      assert.equal(m[1], String(i), `${label}: index kept`);
      const reasonClass = typeof path !== "string" ? "missing-path" : typeof patternId !== "string" ? "missing-patternId" : "valueSha256-element-malformed";
      assert.equal(m[4], reasonClass, `${label}: the reason class text is kept`);
      const clip120 = (s: unknown): string => (typeof s === "string" && s.length > 0 ? pctEncode([...s].slice(0, 120).join("")) : "%");
      assert.equal(m[2], clip120(path), `${label}: path field is the percent-encoded, clipped input`);
      assert.equal(m[3], clip120(patternId), `${label}: pattern field is the percent-encoded, clipped input`);
      assert.ok(!SHELL_METACHARS.test(line), `${label}: no shell metacharacter on the line`);
    });

    // Defense in depth: paste every printed rejected line, raw and prefix-stripped, into the platform shell.
    const scratch = await shellScratch();
    try {
      for (const l of rejected) {
        pasteIntoShell(l, scratch);
        pasteIntoShell(l.replace(/^ {2}- /, ""), scratch);
      }
      assert.ok(!existsSync(join(scratch, MARKER)), "pasting the printed rejected-entry lines into the shell ran a payload");
    } finally {
      await removeDir(scratch);
    }
  });

  // Positive control: the RAW-echo shape (what the round-2 code printed) does execute a payload in this platform shell.
  let controlExecuted = 0;
  for (const [i, [, path, patternId]] of rows.entries()) {
    const scratch = await shellScratch();
    try {
      pasteIntoShell(oldRejectedLine(i, path, patternId, "valueSha256-element-malformed"), scratch);
      if (existsSync(join(scratch, MARKER))) controlExecuted++;
    } finally {
      await removeDir(scratch);
    }
  }
  assert.ok(controlExecuted > 0, "positive control: the old raw-echo shape must execute a payload in this shell for some row, or this test proves nothing");

  // The file-level line carries no text from the file at all, only a fixed reason class.
  await withPlumbingRepo({ "plain.txt": `${novel("aws-access-key-id", 401).text}\n` }, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), `not json $(${PAYLOAD}) \`${PAYLOAD}\` & ;`);
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    const line = cli.stdout.split(/\r?\n/).map((l) => l.replace(/^ {2}- /, "")).find((l) => l.startsWith("REJECTED-ALLOWLIST-FILE"));
    assert.ok(line !== undefined && REJECTED_FILE_LINE.test(line), `the file-level line is a fixed reason class: ${String(line)}`);
  });
});

// --- Issue 244: pin the how-to sentence exactly, and classify EVERY printed detail line ---------------

const EXPECTED_UNLOCK_LINES = [
  "UNLOCK: a real secret is rotated and removed from the tree, never allowlisted. A reviewed fixture " +
    "literal is exempted by adding the sha256 of its matched text to the valueSha256 list of that path and " +
    "pattern's entry in docs/qa/secret-scan-allowlist.json (a new entry needs path, patternId, valueSha256 " +
    "and a reason), in a pull request whose diff shows it (THOTH-ADR-0002).",
  "UNLOCK: the hashed value is the regex MATCH text, which is not always the bare secret: for " +
    "generic-password-assignment and aws-secret-access-key it includes the key name, operator and quotes.",
];
/** The one how-to sentence. Any rewording is a deliberate change to this constant AND to the source. */
const EXPECTED_HOWTO =
  "NO-COMMAND-PRINTED: to get the value hash for such a path, compute the sha256 of the matched text with a local sha256 tool " +
  "over the literal in your own file. The matched text is the whole regex match with no trailing newline, so for " +
  "generic-password-assignment and aws-secret-access-key it includes the key name, operator and quotes. In the allowlist entry, " +
  "the path field is the percent-decoded form of the path shown above. Or rename the path to one of [A-Za-z0-9._/-] first, " +
  "or have a maintainer review it. A shell-safe channel for this hash is tracked in Issue 241.";
const NO_COMMAND_PATH_LINE =
  /^NO-COMMAND-PRINTED for path [A-Za-z0-9._/%-]+ \[[A-Za-z0-9._/%-]+\] at [A-Za-z0-9._/%-]+: the path has characters that need shell quoting, so no command is printed\. It is shown percent-encoded, each %HH is one byte, so this line cannot run\.$/;
const OMITTED_PAIRS_LINE =
  /^HASH-COMMAND: \d+ more path and pattern pair\(s\) are not listed\. Each takes the same command shape, or the no-command rule when its path needs shell quoting\.$/;

/** The class of one printed detail line, or null when it is none of the known classes. A match line and an
 * ALLOWLISTED line echo the git-spelled path (pre-existing, Issue 241 scope) but are built from a fixed
 * commit, a catalog id and a catalog description; every other class is a fixed constant or a strict shape
 * whose only variable text is in [A-Za-z0-9._/%-]. */
function classifyDetailLine(line: string): string | null {
  if (EXPECTED_UNLOCK_LINES.includes(line)) return "unlock-constant";
  if (line === EXPECTED_HOWTO) return "how-to";
  if (OMITTED_PAIRS_LINE.test(line)) return "omitted-pairs";
  if (RUNNABLE_LINE.test(line)) return "command";
  if (NO_COMMAND_PATH_LINE.test(line)) return "no-command-path";
  if (REJECTED_ENTRY_LINE.test(line) || REJECTED_FILE_LINE.test(line)) return "rejected";
  const body = line.startsWith("ALLOWLISTED ") ? line.slice("ALLOWLISTED ".length) : line;
  if (/^[0-9a-f]{1,12} /.test(body)) {
    for (const p of SECRET_PATTERNS) {
      const at = body.lastIndexOf(` [${p.id}] ${p.description}: `);
      if (at > 0 && body.length > at + ` [${p.id}] ${p.description}: `.length && !body.includes("\n")) return line.startsWith("ALLOWLISTED ") ? "allowlisted" : "match";
    }
    // the unit fixtures use a one-letter description and redaction
    if (/^c0ffee000000 .+ \[[a-z0-9-]+\] d: r$/.test(body)) return line.startsWith("ALLOWLISTED ") ? "allowlisted" : "match";
  }
  return null;
}

test("oss01-unlock-no-command-line-is-pinned-verbatim-and-every-printed-line-is-checked", async () => {
  const hostile = [`a$(${PAYLOAD})b.txt`, `a"" & ${PAYLOAD} & ""b.txt`, "my file.md", "résumé.md", `a|${PAYLOAD}|b.txt`];
  const safe = ["plain.txt", "docs/safe-one.md", "src/safe_two.ts"];

  // A. Unit rendering: safe and hostile pairs, one ALLOWLISTED match, rejected entries from a real loaded file.
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-classify-"));
  try {
    const file = join(dir, "allowlist.json");
    await writeFile(file, allowlistJson([
      { path: "granted.txt", patternId: "aws-access-key-id", valueSha256: [sha256("g")], reason: "fixture" },
      { path: `bad$(${PAYLOAD}).txt`, patternId: "github-pat", valueSha256: ["zz"], reason: "r" },
      { path: "legacy.txt", patternId: "email-address", reason: "legacy shape" },
    ]));
    const loaded = await loadAllowlist(file);
    const matches = [
      ...safe.map((p, i) => matchFor(p, "aws-access-key-id", sha256(`s${i}`))),
      ...hostile.map((p, i) => matchFor(p, "github-pat", sha256(`h${i}`))),
      matchFor("granted.txt", "aws-access-key-id", sha256("g")),
    ];
    const details = summarizeMatches(matches, loaded).details;
    const classes = details.map((l) => [classifyDetailLine(l), l] as const);
    assert.deepEqual(classes.filter(([c]) => c === null).map(([, l]) => l), [], "every printed detail line belongs to a known class");
    const howto = details.filter((l) => l.startsWith("NO-COMMAND-PRINTED: "));
    assert.deepEqual(howto, [EXPECTED_HOWTO], "the printed how-to line equals the declared sentence exactly, once");
    for (const c of ["unlock-constant", "command", "no-command-path", "rejected", "match", "allowlisted"]) {
      assert.ok(classes.some(([k]) => k === c), `control: the rendering exercises the ${c} class`);
    }

    // B. More pairs than the cap: the omitted-pairs line is a fixed shape too.
    const many = Array.from({ length: 13 }, (_, i) => matchFor(i % 2 === 0 ? `f${i}.txt` : `f ${i}.txt`, "aws-access-key-id", sha256(`m${i}`)));
    const manyDetails = summarizeMatches(many).details;
    assert.deepEqual(manyDetails.filter((l) => classifyDetailLine(l) === null), [], "every line of the over-the-cap rendering is classified");
    assert.ok(manyDetails.some((l) => classifyDetailLine(l) === "omitted-pairs"), "control: the omitted-pairs class is exercised");
  } finally {
    await removeDir(dir);
  }

  // C. The real CLI, real output: hostile tree entries plus rejected allowlist entries; every stdout line is classified.
  const files: Record<string, string> = {};
  [...hostile, "docs/safe-cli.md"].forEach((p, i) => { files[p] = `${novel("aws-access-key-id", 500 + i).text}\n`; });
  await withPlumbingRepo(files, async (repo) => {
    await writeFile(join(repo, ...ALLOWLIST_PATH.split("/")), allowlistJson([
      { path: `rej$(${PAYLOAD}).txt`, patternId: "aws-access-key-id", valueSha256: ["zz"], reason: "r" },
    ]));
    const cli = await runCli(HISTORY_SCAN_SCRIPT, repo);
    assert.equal(cli.code, 1);
    const lines = cli.stdout.split(/\r?\n/).filter((l) => l.length > 0).map((l) => l.replace(/^ {2}- /, ""));
    const unclassified = lines.filter((l) => !l.startsWith("[OSS-01 history-scan]") && classifyDetailLine(l) === null);
    assert.deepEqual(unclassified, [], "every line the CLI printed belongs to a known class");
    assert.equal(lines.filter((l) => l.startsWith("NO-COMMAND-PRINTED: ")).length, 1);
    assert.ok(lines.includes(EXPECTED_HOWTO), "the CLI prints the declared how-to sentence exactly");
  });
});

// Issue 237: this was `sb2-no-tracked-text-file-is-skipped-as-binary`, an assurance that no tracked file
// held a NUL byte in its first 8000 bytes, because the scanner skipped such a blob unscanned. The rule is
// gone, so the invariant it stood for now holds by construction: NO blob is skipped, whatever its bytes.
// This test replaces it (a new test, not an inversion) and runs on generated bytes in the fixture shapes
// below (NUL offsets are covered by `oss01-nul-byte-does-not-hide-a-secret`) instead of on this repo's
// tracked files. The
// helper that read the index and its unstaged-deletion sibling measured the rule that no longer exists
// and are retired with it; the plumbing repo below has no working-tree file at all, the same state.
// Each fixture holds its own distinct runtime-built literal beside bytes a content-sniffing skip treats
// as binary.
function bytesFixtures(seed: number): { files: Record<string, Buffer>; literals: Map<string, { text: string; match: string }> } {
  const literals = new Map<string, { text: string; match: string }>();
  const files: Record<string, Buffer> = {};
  let n = seed;
  const add = (path: string, build: (keyLine: string) => Buffer): void => {
    const lit = novel("aws-access-key-id", n++);
    literals.set(path, lit);
    files[path] = build(`${lit.text}\n`);
  };
  const b = (s: string): Buffer => Buffer.from(s, "latin1");
  add("leading-nul.bin", (k) => b(`\u0000${k}`));
  add("interior-nul.bin", (k) => b(`head\u0000${k}tail\n`));
  add("trailing-nul.bin", (k) => b(`${k}\u0000`));
  add("nul-padding.bin", (k) => Buffer.concat([Buffer.alloc(9000), b(k), Buffer.alloc(9000)]));
  add("high-bytes.bin", (k) => Buffer.concat([Buffer.from([0xff, 0xfe, 0x80, 0x81]), b(k), Buffer.from([0xc3, 0xa0, 0xff])]));
  add("png-prefix.bin", (k) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]), b(`IHDR${k}`)]));
  add("every-byte-value.bin", (k) => Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), b(`\n${k}`)]));
  return { files, literals };
}

test("oss01-no-blob-is-skipped-whatever-its-bytes", async (t) => {
  const { files, literals } = bytesFixtures(800);
  await withPlumbingRepo(files, async (dir) => {
    const path0 = Object.keys(files)[0] ?? "";
    assert.ok(!existsSync(join(dir, path0)), "control: no working-tree file exists for a tracked path");
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    for (const [path, lit] of literals) {
      await t.test(`the literal in ${path} is matched`, () => {
        const mine = matches.filter((m) => m.path === path);
        assert.equal(mine.length, 1, `${path}: exactly one match expected, got ${mine.length}`);
        assert.equal(mine[0]?.valueSha256, sha256(lit.match));
      });
    }
    assert.equal(matches.length, Object.keys(files).length, "derived: one match per fixture blob, no blob skipped, nothing else matched");
  });
});

// Code-reviewer LOW (post-build round): the ten-pair cap of the unlock lines had no pin, so an off-by-one
// (nine listed, or eleven) went unseen. Ten pairs get ten commands; every pair past ten is counted.
test("sb2-unlock-command-lists-ten-pairs-then-counts-the-rest", () => {
  const pairs = (n: number): HistoryMatch[] => Array.from({ length: n }, (_, i) => matchFor(`files/f${i}.txt`, "aws-access-key-id", sha256(`v${i}`)));
  const listed = (details: string[]): string[] => details.filter((l) => l.startsWith("HASH-COMMAND for "));
  const more = (details: string[]): string[] => details.filter((l) => l.startsWith("HASH-COMMAND: "));

  const nine = summarizeMatches(pairs(9)).details;
  assert.equal(listed(nine).length, 9, "under the cap: every pair listed");
  assert.deepEqual(more(nine), [], "and no count line");
  const ten = summarizeMatches(pairs(10)).details;
  assert.equal(listed(ten).length, 10, "exactly at the cap: all ten listed");
  assert.deepEqual(more(ten), [], "and nothing is left to count");
  const twelve = summarizeMatches(pairs(12)).details;
  assert.equal(listed(twelve).length, 10, "past the cap: still ten commands");
  assert.equal(more(twelve).length, 1);
  assert.match(more(twelve)[0] ?? "", /^HASH-COMMAND: 2 more path and pattern pair\(s\)/, "the count line names how many pairs were left out");

  // Two matches at one pair are one pair: they neither add a command nor count against the cap.
  const doubled = [...pairs(10), matchFor("files/f0.txt", "aws-access-key-id", sha256("another"))];
  assert.equal(listed(summarizeMatches(doubled).details).length, 10);
  assert.deepEqual(more(summarizeMatches(doubled).details), []);
});

// Code-reviewer LOW (round 2): three behaviors of the unlock code that survived as mutants. The encoder
// must zero-pad each hex byte and iterate by code point, and the dedupe key must include the pattern id.
test("sb2-percent-encoding-is-injective-for-control-and-astral-characters", () => {
  const shown = (name: string): string => {
    const line = summarizeMatches([matchFor(name, "aws-access-key-id", sha256("x"))]).details.find((l) => l.startsWith(NO_COMMAND_PREFIX)) ?? "";
    return line.slice(NO_COMMAND_PREFIX.length).split(" ")[0] ?? "";
  };
  // A control byte below 0x10 must be zero-padded: 0x01 then "A" would otherwise collide with 0x1A.
  assert.equal(shown("A"), "%01A");
  assert.equal(shown(""), "%1A");
  assert.notEqual(shown("A"), shown(""), "two different names never display the same");
  // A four-byte character is one code point, encoded as its four UTF-8 bytes; a per-UTF-16-unit loop would
  // encode two lone surrogates as two replacement characters instead.
  assert.equal(shown("\u{1F600}"), "%F0%9F%98%80");
  const names = ["A", "", "", "\u{1F600}", "a\u{1F600}b", "\u{10FFFF}", "\u{1F600}\u{1F601}", "é"];
  for (const name of names) assert.equal(shown(name), pctEncode(name), `matches the independent statement of the rule for ${JSON.stringify(name)}`);
  assert.equal(new Set(names.map(shown)).size, names.length, "every distinct name displays distinctly");
});

test("sb2-unlock-command-lists-each-pattern-of-one-path", () => {
  const details = summarizeMatches([
    matchFor("one/path.txt", "aws-access-key-id", sha256("a")),
    matchFor("one/path.txt", "github-pat", sha256("b")),
    matchFor("one/path.txt", "aws-access-key-id", sha256("c")), // the same pair again: still one command
  ]).details;
  const commands = details.filter((l) => l.startsWith("HASH-COMMAND for "));
  assert.equal(commands.length, 2, "one command per (path, pattern id) pair, so two for this path");
  assert.ok(commands.some((l) => l.includes("[aws-access-key-id]") && l.endsWith(" aws-access-key-id")));
  assert.ok(commands.some((l) => l.includes("[github-pat]") && l.endsWith(" github-pat")));
});

// Issue 237: this was `sb2-binary-helper-window-matches-the-scanner`, which pinned the scanner's 8000-byte
// window: a NUL at byte 7999 made the scanner skip the blob, a NUL at byte 8000 did not. Same two
// fixtures and offsets, assertion inverted: the window is gone, so both blobs are scanned.
test("oss01-no-8000-byte-window-nul-at-7999-and-8000-are-both-scanned", async () => {
  const withNulAt = (n: number, index: number): string => {
    const head = `${novel("aws-access-key-id", n).text}\n`;
    return head + "x".repeat(index - head.length) + "\0" + "tail\n";
  };
  const files = { "inside.dat": withNulAt(300, 7999), "outside.dat": withNulAt(301, 8000) };
  await withPlumbingRepo(files, async (dir) => {
    const scanned = new Set((await scanHistory(makeGitOps(realRunner, dir))).map((m) => m.path));
    assert.ok(scanned.has("outside.dat"), "control: the scanner scans the NUL at byte 8000");
    assert.ok(scanned.has("inside.dat"), "the scanner also scans the NUL at byte 7999: there is no window");
  });
});

// Issue 246: a blob starting with a UTF-16 byte-order-mark must not hide a secret from the scanner. Named
// per the issue: oss01-utf16-text-file-does-not-hide-a-secret. Both a UTF-16LE-with-BOM and a
// UTF-16BE-with-BOM file, each holding a runtime-built key literal, must yield at least one match through
// `scanHistory` (the pre-commit-hook half of the same proof-test is in pre-commit-scan.test.ts).
function utf16LEBytes(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}
function utf16BEBytes(text: string): Buffer {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1] ?? 0;
    be[i + 1] = le[i] ?? 0;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
}

test("oss01-utf16-text-file-does-not-hide-a-secret", async () => {
  const lit = novel("aws-access-key-id", 900);
  const line = `${lit.text}\n`;
  const files = { "utf16le.txt": utf16LEBytes(line), "utf16be.txt": utf16BEBytes(line) };
  await withPlumbingRepo(files, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    for (const path of Object.keys(files)) {
      const mine = matches.filter((m) => m.path === path && m.patternId === "aws-access-key-id");
      assert.equal(mine.length, 1, `${path}: expected exactly one match, got ${mine.length}`);
      assert.equal(
        mine[0]?.valueSha256,
        sha256(lit.match),
        `${path}: the UTF-16 match hashes IDENTICALLY to the same literal written as plain ASCII -- one ` +
          "allowlist entry covers both forms (Manager ruling, s1-oss01-detection-residuals plan)",
      );
    }
  });
});

// Issue 246 residual, disclosed: BOM presence is the only detection signal, deliberately not a heuristic
// guess at BOM-less UTF-16 -- so a UTF-16 file with no BOM stays exactly as invisible as before this fix.
test("oss01-utf16-without-a-bom-stays-a-disclosed-residual", async () => {
  const lit = novel("aws-access-key-id", 901);
  const noBom = Buffer.from(`${lit.text}\n`, "utf16le"); // no BOM prefix
  await withPlumbingRepo({ "utf16-no-bom.txt": noBom }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    assert.deepEqual(matches, [], "control: documents the disclosed residual rather than silently widening detection past the ADR's own BOM-only rule");
  });
});

// Issue 246 x Issue 237 interaction: a blob that merely STARTS with the UTF-16LE BOM bytes for reasons
// that have nothing to do with UTF-16 (this file's own `high-bytes.bin` fixture below,
// `oss01-no-blob-is-skipped-whatever-its-bytes`) must still be scanned as latin1 too -- the UTF-16 reading
// is additive, never a replacement, so this stays green rather than reopening Issue 237.
test("oss01-utf16-bom-sniff-does-not-hide-a-latin1-secret-in-a-non-utf16-blob", async () => {
  const lit = novel("aws-access-key-id", 902);
  // FF FE (a real UTF-16LE BOM) followed by ordinary latin1 bytes that are NOT UTF-16 -- exactly the
  // `high-bytes.bin` shape, isolated here so this interaction has its own named, focused proof.
  const blob = Buffer.concat([Buffer.from([0xff, 0xfe, 0x80, 0x81]), Buffer.from(`${lit.text}\n`, "latin1")]);
  await withPlumbingRepo({ "bom-prefixed-binary.bin": blob }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const mine = matches.filter((m) => m.path === "bom-prefixed-binary.bin" && m.patternId === "aws-access-key-id");
    assert.equal(mine.length, 1, "the latin1 reading still finds the literal even though the blob starts with a UTF-16LE BOM");
    assert.equal(mine[0]?.valueSha256, sha256(lit.match));
  });
});

// Issue 203 (red-team round 5, F3): a docs/reviews report grant was excluded from the baseline guard on
// the theory that a dated report is immutable. It is not (an addendum or a new report can carry an
// unreviewed live value on its first commit), so report grants are pinned like every other file.

test("OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline at grant time like every other file, not excluded", async () => {
  const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8")) as { path: string; patternId: string }[];
  const reportPrefix = REVIEWS_DIR + "/";
  const reportGrants = allowlist.filter((e) => e.path.startsWith(reportPrefix) && CREDENTIAL_SHAPED_PATTERN_IDS.includes(e.patternId));
  assert.ok(reportGrants.length > 0, "control: the real allowlist has credential-shaped report grants (derived from the file)");
  const derivedKeys = new Set(deriveMutableCredentialGrants(allowlist).map((g) => `${g.path}::${g.patternId}`));
  for (const g of reportGrants) {
    const key = `${g.path}::${g.patternId}`;
    assert.ok(derivedKeys.has(key), `a report grant must be in the derived checked set: ${key}`);
    const pinned = REVIEWED_BASELINE[key];
    assert.ok(pinned !== undefined && pinned.hashes.length > 0, `a report grant must carry a non-empty pinned baseline: ${key}`);
  }
});

test("oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate", async () => {
  const lit = novel("aws-access-key-id", 13);
  const report = `${REVIEWS_DIR}/zz-attack-e-2026-09-19.md`;
  const legacyGrant = [{ path: report, patternId: "aws-access-key-id", reason: "attacker-supplied whole-file grant" }];
  await withRepo({ [report]: `${lit.text}\n`, [ALLOWLIST_PATH]: allowlistJson(legacyGrant) }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const result = summarizeMatches(matches, await loadAllowlist(join(dir, ALLOWLIST_PATH)));
    assert.equal(result.ok, false, "a new report with a live literal and a legacy-shaped whole-file grant must block at the gate");
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.notEqual(cli.code, 0, "and through the CI entry point");
  });
});

test("oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard", async () => {
  // Stated residual: the gate has no oracle to tell an attacker's hash from a reviewed one, so a
  // report grant that carries the literal's own correct hash PASSES the gate. What catches it is the
  // baseline guard (an omitted pin) and the pull request diff (a deliberate one). This test proves the
  // first half only; it does not claim the gate blocks a deliberate self-hashed grant.
  const lit = novel("aws-access-key-id", 14);
  const report = `${REVIEWS_DIR}/zz-attack-e-selfhash-2026-09-19.md`;
  const grant = { path: report, patternId: "aws-access-key-id", valueSha256: [sha256(lit.match)], reason: "attacker-supplied, self-hashed" };
  await withRepo({ [report]: `${lit.text}\n`, [ALLOWLIST_PATH]: allowlistJson([grant]) }, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const result = summarizeMatches(matches, await loadAllowlist(join(dir, ALLOWLIST_PATH)));
    assert.equal(result.ok, true, "stated residual: a self-hashed report grant passes the gate (no oracle)");
    const derived = deriveMutableCredentialGrants([grant]);
    assert.deepEqual(derived, [{ path: report, patternId: "aws-access-key-id" }], "the report grant is in the guard's checked set");
    const raw = await readFile(join(dir, ...report.split("/")), "utf8");
    const key = `${report}::aws-access-key-id`;
    assert.ok(unreviewedOccurrenceCount(raw, "aws-access-key-id", REVIEWED_BASELINE[key]?.hashes ?? []) > 0, "with no pinned baseline the live literal is reported as unreviewed");
  });
});

// ================================================================================================
// Issue 237 (found by design-challenger, S-B2 pre-build round 1, attack A1): OSS-01 used to skip a whole
// blob when a NUL byte sat in its first 8000 bytes, in the pre-commit hook and in CI, so any secret in
// such a file was invisible. A NUL byte is an ordinary byte now: every blob is matched like any other.
// Every planted literal is built at runtime and every NUL / high byte is an escape, never a raw byte in
// this file. Hashes in assertions come from the independent `sha256` helper above. UTF-16 text (BOM plus
// interleaved NUL) is a stated residual, Issue 246: nothing here claims it is covered.
// ================================================================================================

/** A body with a NUL byte at absolute byte `index` (ASCII filler before it) and the key line AFTER it, so
 * the literal is only reachable if the scanner reads past the NUL. */
function nulFirstBody(keyLine: string, index: number): string {
  return "x".repeat(index) + "\u0000\n" + keyLine + "\n";
}

const NUL_OFFSETS = [0, 1, 7000, 7999, 8000, 9000];

/** One file per NUL offset plus a NUL-free control, each with its own distinct runtime-built key literal. */
function nulFixture(seed: number): { files: Record<string, string>; literals: Map<string, { text: string; match: string }> } {
  const files: Record<string, string> = {};
  const literals = new Map<string, { text: string; match: string }>();
  NUL_OFFSETS.forEach((offset, i) => {
    const path = `nul-at-${offset}.dat`;
    const lit = novel("aws-access-key-id", seed + i);
    files[path] = nulFirstBody(lit.text, offset);
    literals.set(path, lit);
  });
  const control = novel("aws-access-key-id", seed + NUL_OFFSETS.length);
  files["no-nul.txt"] = `${control.text}\n`;
  literals.set("no-nul.txt", control);
  return { files, literals };
}

test("oss01-nul-byte-does-not-hide-a-secret", async (t) => {
  const { files, literals } = nulFixture(700);
  await withPlumbingRepo(files, async (dir) => {
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    for (const [path, lit] of literals) {
      await t.test(`scanHistory matches the key literal in ${path}`, () => {
        const mine = matches.filter((m) => m.path === path);
        assert.equal(mine.length, 1, `${path}: exactly one match expected, got ${mine.length}`);
        assert.equal(mine[0]?.patternId, "aws-access-key-id");
        assert.equal(mine[0]?.valueSha256, sha256(lit.match), "the hash is the independent hash of the literal");
      });
    }
    assert.equal(matches.length, literals.size, "derived: one match per fixture file, nothing else");
  });
});

test("oss01-nul-byte-does-not-hide-a-secret (history-scan CLI)", async (t) => {
  const { files, literals } = nulFixture(720);
  await withPlumbingRepo(files, async (dir) => {
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.equal(cli.code, 1, `the CI entry point must fail on a tree holding keys, stderr: ${cli.stderr}`);
    for (const [path, lit] of literals) {
      await t.test(`the CI entry point names ${path}`, () => {
        assert.ok(cli.stdout.includes(path), `${path} must be named in the blocking output`);
        assert.ok(!cli.stdout.includes(lit.match), "the raw literal is never printed");
      });
    }
  });
  // Controls: the exit code means something. A NUL-free key repo fails; a NUL-bearing repo with no key passes.
  const solo = novel("aws-access-key-id", 740);
  await withPlumbingRepo({ "solo.txt": `${solo.text}\n` }, async (dir) => {
    assert.equal((await runCli(HISTORY_SCAN_SCRIPT, dir)).code, 1, "control: a NUL-free key file fails the gate");
  });
  await withPlumbingRepo({ "clean.dat": nulFirstBody("nothing secret-shaped here", 0) }, async (dir) => {
    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.equal(cli.code, 0, `control: a NUL-bearing file with no key passes, got:\n${cli.stdout}${cli.stderr}`);
  });
});

test("oss01-nul-bearing-blob-is-governed-by-the-value-scoped-allowlist", async () => {
  const granted = novel("aws-access-key-id", 760);
  const fresh = novel("aws-access-key-id", 761);
  const legacy = novel("aws-access-key-id", 762);
  const files = {
    "granted.dat": `\u0000\n${granted.text}\n${fresh.text}\n`,
    "legacy.dat": `\u0000\n${legacy.text}\n`,
  };
  const entries = [
    { path: "granted.dat", patternId: "aws-access-key-id", valueSha256: [sha256(granted.match)], reason: "synthetic fixture" },
    { path: "legacy.dat", patternId: "aws-access-key-id", reason: "legacy whole-file shape, must not be honored" },
  ];
  await withPlumbingRepo(files, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson(entries));
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const allowlist = await loadAllowlist(join(dir, ALLOWLIST_PATH));
    const { blocking, allowlisted } = partitionAllowlisted(matches, allowlist);
    assert.deepEqual(allowlisted.map((m) => [m.path, m.valueSha256]), [["granted.dat", sha256(granted.match)]], "the granted literal in a NUL-bearing blob is allowlisted");
    assert.deepEqual(
      blocking.map((m) => [m.path, m.valueSha256]).sort(),
      [["granted.dat", sha256(fresh.match)], ["legacy.dat", sha256(legacy.match)]].sort(),
      "a novel literal in the granted file and a legacy-shaped grant both block",
    );
    const result = summarizeMatches(matches, allowlist);
    const output = [result.summary, ...result.details].join("\n");
    assert.equal(result.ok, false);
    assert.ok(result.details.some((d) => d.startsWith("ALLOWLISTED") && d.includes("granted.dat")), "the granted literal is still reported");
    for (const secret of [granted.match, fresh.match, legacy.match]) assert.ok(!output.includes(secret), "no raw value in the output");
  });
  // Control: with only the granted literal present the same blob passes and is still reported.
  await withPlumbingRepo({ "granted.dat": `\u0000\n${granted.text}\n` }, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson([entries[0]]));
    const result = summarizeMatches(await scanHistory(makeGitOps(realRunner, dir)), await loadAllowlist(join(dir, ALLOWLIST_PATH)));
    assert.equal(result.ok, true, "an allowlisted NUL-bearing blob does not fail the gate");
    assert.ok(result.details.some((d) => d.startsWith("ALLOWLISTED") && d.includes("granted.dat")), "and is reported, never silently dropped");
  });
});

test("oss01-utf8-character-ending-in-0xa0-does-not-hide-a-password", async (t) => {
  // The scanner reads a blob as latin1, where JS whitespace includes 0xA0. UTF-8 "a grave" is C3 A0 and
  // "e acute" is C3 A9: the first used to end the password value early and hide it, the second never did.
  const name = ["pass", "word"].join("");
  for (const [label, ch] of [["a grave (C3 A0)", "\u00e0"], ["e acute (C3 A9), control", "\u00e9"]] as const) {
    await t.test(`a password containing ${label} is matched`, async () => {
      const line = `${name} = "abcd${ch}efgh"`;
      await withPlumbingRepo({ "utf8-password.txt": `${line}\n` }, async (dir) => {
        const found = (await scanHistory(makeGitOps(realRunner, dir))).filter((m) => m.patternId === "generic-password-assignment");
        assert.equal(found.length, 1, "the password literal is matched");
        assert.equal(found[0]?.valueSha256, sha256(line), "the hash is the independent hash of the file's own bytes");
      });
    });
  }
});

// ================================================================================================
// Issue 250 (red-team, s1-237-nul-byte-scan, attack 3): a byte-identical blob living at two paths was
// scanned once, at whichever (commit, path) the tree walk reached first, so an allowlist grant scoped to
// that path silently exempted the identical blob at every other path too -- contradicting THOTH-ADR-0002's
// own "path, patternId AND value hash must all agree" rule. Named per the issue:
// oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another.
// ================================================================================================

test("oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another", async () => {
  const lit = novel("aws-access-key-id", 950);
  const body = `${lit.text}\n`;
  // Path names deliberately mirror red-team's own repro ("aaa" sorts/walks before "zzz"): the granted path
  // is the one a naive tree walk visits FIRST, which is the worst case for a dedupe-by-sha bug -- the
  // OTHER path is the one that would have been silently dropped.
  const files = { "aaa-granted.dat": body, "zzz-not-granted.dat": body };
  const entries = [
    { path: "aaa-granted.dat", patternId: "aws-access-key-id", valueSha256: [sha256(lit.match)], reason: "synthetic fixture, path-scoped grant" },
  ];
  await withPlumbingRepo(files, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson(entries));
    const matches = await scanHistory(makeGitOps(realRunner, dir));
    const byPath = new Map(matches.map((m) => [m.path, m]));
    assert.equal(matches.length, 2, "the byte-identical blob is reported at BOTH paths, not just the first one the tree walk reaches");
    assert.ok(byPath.has("aaa-granted.dat") && byPath.has("zzz-not-granted.dat"), "both paths are present in the report");
    assert.equal(byPath.get("zzz-not-granted.dat")?.valueSha256, sha256(lit.match), "the replayed match carries the identical value hash, not a placeholder");

    const allowlist = await loadAllowlist(join(dir, ALLOWLIST_PATH));
    const { blocking, allowlisted } = partitionAllowlisted(matches, allowlist);
    assert.deepEqual(allowlisted.map((m) => m.path), ["aaa-granted.dat"], "the grant exempts only the path it names");
    assert.deepEqual(
      blocking.map((m) => m.path),
      ["zzz-not-granted.dat"],
      "the identical blob at the UNGRANTED path still blocks -- THOTH-ADR-0002's path-agreement rule holds even under blob dedupe",
    );

    const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
    assert.notEqual(cli.code, 0, "and through the real CI entry point");
    assert.ok(cli.stdout.includes("zzz-not-granted.dat"), "the ungranted path is named in the blocking output");
  });
  // Control: with the SAME grant present at BOTH paths (two entries, each scoped to its own path), the
  // blob is reported at both and blocks neither -- dedupe-with-replay does not over-grant either.
  const entriesBoth = [
    { path: "aaa-granted.dat", patternId: "aws-access-key-id", valueSha256: [sha256(lit.match)], reason: "fixture" },
    { path: "zzz-not-granted.dat", patternId: "aws-access-key-id", valueSha256: [sha256(lit.match)], reason: "fixture" },
  ];
  await withPlumbingRepo(files, async (dir) => {
    await writeFile(join(dir, ...ALLOWLIST_PATH.split("/")), allowlistJson(entriesBoth));
    const result = summarizeMatches(await scanHistory(makeGitOps(realRunner, dir)), await loadAllowlist(join(dir, ALLOWLIST_PATH)));
    assert.equal(result.ok, true, "control: a grant at EVERY path the blob lives at passes cleanly");
    assert.equal(result.details.filter((d) => d.startsWith("ALLOWLISTED")).length, 2, "and both paths are reported");
  });
});

// ================================================================================================
// Issue 247 (red-team, s1-237-nul-byte-scan, attack 1): internal-hostname, email-address and
// private-key-block all backtrack super-linearly on an adversarial shape with no closing anchor -- a
// crafted blob invisible in a PR diff (git shows "Binary files ... differ") could stall CI and the
// pre-commit hook for minutes. Named per the issue: oss01-scan-time-is-bounded-on-a-hostile-blob.
// ================================================================================================

test("oss01-scan-time-is-bounded-on-a-hostile-blob", async (t) => {
  // Generous ceiling shared by every cell below: SCAN_TIMEOUT_MS per (blob, pattern) pair, times every
  // pattern in the catalog (worst case every single one times out), plus slack for process/spawn
  // overhead -- still a small fraction of the ~180s (single pattern, single blob) red-team measured
  // unbounded on a similarly sized hostile blob.
  const CEILING_MS = SCAN_TIMEOUT_MS * SECRET_PATTERNS.length + 15_000;

  await t.test("a long hyphen-joined run (internal-hostname / email-address) is bounded, not left to run", async () => {
    // Measured directly (not assumed): this exact 200 KB shape takes ~33s (internal-hostname) / ~27s
    // (email-address) UNBOUNDED on this machine -- comfortably over SCAN_TIMEOUT_MS, so this cell
    // actually exercises the timeout path rather than completing comfortably inside the budget.
    const hostile = "a-".repeat(100_000);
    await withPlumbingRepo({ "hostile-hyphen-run.bin": hostile }, async (dir) => {
      const start = Date.now();
      const matches = await scanHistory(makeGitOps(realRunner, dir));
      const ms = Date.now() - start;
      assert.ok(ms < CEILING_MS, `scan took ${ms}ms, expected under ${CEILING_MS}ms (unbounded: ~180000ms for a similar 200KB blob per pattern)`);
      const timeouts = matches.filter((m) => m.patternId === SCAN_TIMEOUT_PATTERN_ID);
      assert.ok(timeouts.length > 0, "at least one pattern could not finish in time and is reported as a blocking scan-timeout finding, not silently skipped");
      assert.equal(summarizeMatches(matches, []).ok, false, "a scan-timeout finding fails the gate closed by default (never a silent pass)");
    });
  });

  await t.test("a repeated BEGIN marker with no END (private-key-block) is bounded too", async () => {
    // Measured directly (not assumed): this pattern scales quadratically on repeated, never-closed BEGIN
    // markers (10ms at 1000 reps, 8295ms at 32000 reps); 20000 reps (~560 KB) takes several seconds
    // unbounded, comfortably over SCAN_TIMEOUT_MS, so this cell actually exercises the timeout path.
    const hostile = "-----BEGIN PRIVATE KEY-----\n".repeat(20_000);
    await withPlumbingRepo({ "hostile-pem.bin": hostile }, async (dir) => {
      const start = Date.now();
      const matches = await scanHistory(makeGitOps(realRunner, dir));
      const ms = Date.now() - start;
      assert.ok(ms < CEILING_MS, `scan took ${ms}ms, expected under ${CEILING_MS}ms`);
      const timeouts = matches.filter((m) => m.patternId === SCAN_TIMEOUT_PATTERN_ID && m.description.includes("private-key-block"));
      assert.ok(timeouts.length > 0, "private-key-block is bounded on a repeated-BEGIN-marker blob the same way the other two patterns are");
    });
  });

  await t.test("control: ordinary content under the budget still matches exactly as before, nothing bounded", async () => {
    const lit = novel("aws-access-key-id", 960);
    await withPlumbingRepo({ "clean.txt": `${lit.text}\n` }, async (dir) => {
      const matches = await scanHistory(makeGitOps(realRunner, dir));
      assert.deepEqual(matches.map((m) => m.patternId), ["aws-access-key-id"]);
      assert.equal(matches[0]?.valueSha256, sha256(lit.match));
    });
  });

  // Through the real CI entry point too: a hostile blob still fails the gate (a scan-timeout finding
  // blocks by default), and it does so within the bounded ceiling, not the unbounded one.
  await t.test("through the real CI entry point: bounded, and still blocking", async () => {
    const hostile = "a-".repeat(100_000);
    await withPlumbingRepo({ "hostile-hyphen-run.bin": hostile }, async (dir) => {
      const start = Date.now();
      const cli = await runCli(HISTORY_SCAN_SCRIPT, dir);
      const ms = Date.now() - start;
      assert.ok(ms < CEILING_MS + 10_000, `CLI took ${ms}ms, expected under ${CEILING_MS + 10_000}ms`);
      assert.notEqual(cli.code, 0, "a scan-timeout finding blocks the real CLI, fail closed");
    });
  });
});
