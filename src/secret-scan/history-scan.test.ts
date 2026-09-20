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
import { isValidAllowlistEntry, loadAllowlist, partitionAllowlisted, scanHistory, summarizeMatches } from "./history-scan.ts";
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
    assert.match(how[0] ?? "", /allowlist-tool\.ts hash/);
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
async function withPlumbingRepo<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
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

/** Tracked files (from the index) that the scanner's own rule (history-scan.ts looksBinary: a NUL byte in
 * the first 8000 bytes) would skip, unscanned, so they are invisible to OSS-01. Reads each blob from the
 * object database in one `git cat-file --batch` call, never the working tree, so a file that is deleted
 * or edited on disk cannot change the answer. Scope: the index (the tree about to be committed); the gate
 * also walks older commits, which this does not. */
async function trackedFilesSkippedAsBinary(repoDir: string, knownBinaries: readonly string[]): Promise<string[]> {
  const res = await realRunner("git", ["ls-files", "-s", "-z"], { cwd: repoDir, encoding: "latin1" });
  assert.equal(res.code, 0, res.stderr);
  const entries: Array<{ path: string; sha: string }> = [];
  for (const rec of res.stdout.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab === -1) continue;
    const [mode, sha] = rec.slice(0, tab).split(" ");
    if (mode === "160000" || sha === undefined) continue; // a submodule gitlink is a commit in another repo
    const path = rec.slice(tab + 1);
    if (!knownBinaries.includes(path)) entries.push({ path, sha });
  }
  const batch = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repoDir,
    input: [...new Set(entries.map((e) => e.sha))].join("\n") + "\n",
    maxBuffer: 1 << 30,
  });
  assert.equal(batch.status, 0, `git cat-file --batch failed: ${String(batch.stderr)}`);
  const out = batch.stdout;
  const hasNul = new Map<string, boolean>();
  for (let pos = 0; pos < out.length; ) {
    const nl = out.indexOf(0x0a, pos);
    const [sha, type, size] = out.toString("latin1", pos, nl).split(" ");
    assert.ok(sha !== undefined && type === "blob" && size !== undefined, `unexpected cat-file header: ${out.toString("latin1", pos, nl)}`);
    const len = Number(size);
    hasNul.set(sha, out.subarray(nl + 1, nl + 1 + Math.min(len, 8000)).includes(0));
    pos = nl + 1 + len + 1;
  }
  return entries.filter((e) => hasNul.get(e.sha) === true).map((e) => e.path);
}

test("sb2-no-tracked-text-file-is-skipped-as-binary", async () => {
  // A tracked text file with a NUL in its first 8000 bytes is invisible to OSS-01. Derived from git.
  const KNOWN_BINARIES: string[] = []; // name a real binary asset here by path; none is tracked today
  const skipped = await trackedFilesSkippedAsBinary(PROJECT_ROOT, KNOWN_BINARIES);
  assert.deepEqual(skipped, [], "a tracked text file that OSS-01 would skip as binary must be fixed (or named in KNOWN_BINARIES)");
});

// Code-reviewer LOW (post-build round): the assurance above read the working tree, so an unstaged
// deletion of any tracked file died with ENOENT, a message about nothing this test is for. It must read
// what the scanner reads: the blob the index holds. A repo built with plumbing has no working-tree file
// at all, which is the same state as a deleted one.
test("sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion", async () => {
  const files = { "text.txt": "plain text\n", "blob.dat": "head\0tail\n" };
  await withPlumbingRepo(files, async (dir) => {
    assert.ok(!existsSync(join(dir, "text.txt")), "control: no working-tree file exists for a tracked path");
    assert.deepEqual(await trackedFilesSkippedAsBinary(dir, []), ["blob.dat"], "the index blob with a NUL is found, the text blob is not");
    assert.deepEqual(await trackedFilesSkippedAsBinary(dir, ["blob.dat"]), [], "a named binary is excluded");
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
