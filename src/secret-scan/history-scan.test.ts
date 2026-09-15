import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import { loadAllowlist, partitionAllowlisted, scanHistory, summarizeMatches } from "./history-scan.ts";
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
    { commit: "abc123", path: "config.ts", patternId: "aws-access-key-id", description: "AWS key", redacted: "AKIA…[REDACTED 20 chars]" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /REDACTED/);
  assert.ok(!result.details.join("").includes("AKIAABCDEFGHIJKLMNOP"), "raw secret must never appear in output");
});

test("OSS-01 allowlist: partitionAllowlisted splits matches by exact path+patternId", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r" },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r" },
  ];
  const { blocking, allowlisted } = partitionAllowlisted(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(allowlisted.length, 1);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.path, "src/config.ts");
});

test("OSS-01 allowlist: an allowlisted match does not fail the gate, but IS still reported (never silently dropped)", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "AKIA…[REDACTED]" },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(result.ok, true, "allowlisted-only matches must not fail the gate");
  assert.match(result.details.join("\n"), /ALLOWLISTED/, "an allowlisted match must still appear in the report");
});

test("OSS-01 allowlist: a match NOT on the allowlist still fails the gate even if other matches ARE allowlisted", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r1" },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r2" },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.summary, /1 secret-shaped match/);
});

test("OSS-01 allowlist loader: an entry WITH a non-empty reason is accepted (positive control, red-team finding 4)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oss01-allowlist-reason-"));
  try {
    const p = join(dir, "allowlist.json");
    await writeFile(p, JSON.stringify([
      { path: "src/foo.ts", patternId: "aws-access-key-id", reason: "documented test fixture" },
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
      { path: "src/foo.ts", patternId: "aws-access-key-id" }, // no `reason` field at all
      { path: "src/bar.ts", patternId: "aws-access-key-id", reason: "   " }, // whitespace-only
      { path: "src/baz.ts", patternId: "aws-access-key-id", reason: "real, non-empty reason" },
    ]));
    const loaded = await loadAllowlist(p);
    assert.equal(loaded.length, 1, "only the entry with a real, non-empty reason may survive");
    assert.equal(loaded[0]?.path, "src/baz.ts");

    // End-to-end: a match against the reason-less entry's own (path, patternId) must now BLOCK
    // the gate, not pass silently — this is the actual security property red-team's finding
    // demonstrated was missing.
    const matches = [
      { commit: "a", path: "src/foo.ts", patternId: "aws-access-key-id", description: "x", redacted: "r" },
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
  const allowlistJson: unknown = JSON.parse(await readFile("docs/qa/secret-scan-allowlist.json", "utf8"));
  const allowlist = allowlistJson as { path: string; patternId: string; reason: string }[];
  const result = summarizeMatches(matches, allowlist);
  assert.equal(result.ok, true, `expected a clean pass, got: ${result.summary}\n${result.details.join("\n")}`);
});

// GitHub Issue #193 (red-team round-2, path-b-precommit-secret-scan, [MED], security-class,
// demonstrated): `partitionAllowlisted` matches an entry by `{path, patternId}` ONLY, never by
// the actual matched value (`history-scan.ts`'s own header already discloses this as pre-existing,
// intentional OSS-01 design). Applying that to a CREDENTIAL-shaped pattern on
// `docs/qa/secret-scan-allowlist.json` itself is what turned dangerous: round-1's own fix-now
// quoted a fake AWS-key-shaped fixture literal in a `reason` field to document it, which granted
// a BLANKET exemption for every future `aws-access-key-id` match ANYWHERE in that file, forever —
// not just in the entry that needed it. Red-team staged a DISTINCT, real-shaped key literal in a
// completely different `reason` field and it committed clean through both this pre-commit hook and
// CI's full-history scan (same allowlist, same blind spot, both layers), because ONE grant for a
// (path, patternId) pair exempts the WHOLE file's blob for that pattern, not just the JSON key that
// motivated it. `docs/qa/secret-scan-allowlist.json` is the one file whose entire purpose is prose
// ABOUT secret-shaped strings, so it is also the single most dangerous place to ever reproduce one
// instead of describing it.
//
// Two invariants, both required, checked at the FILE level rather than per-entry — a per-entry
// check (does entry X's own reason match entry X's own patternId) is not sufficient: it would miss
// a real secret hidden in some OTHER entry's `reason` field (a different patternId, or even a
// totally unrelated one) while ANY grant for the dangerous pattern still exists anywhere in the
// file, since the exemption is whole-file, not per-key.
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
// LATER recurrence there needed its own whole-file `aws-access-key-id` grant on each.
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
//   2. One named, in-code exclusion: a file under `docs/reviews/`, on the theory that PRINCIPLES
//      rule 11 forbids rewriting a persisted, dated report's existing bytes. GitHub Issue #203
//      (red-team round-5, [MED], demonstrated, deliberately deferred, still open) found this
//      overstates: rule 11's own first option is an *appended* addendum, so a report's bytes are
//      not bounded at write time the way this exclusion assumes -- a brand-new report (or a fresh
//      addendum) can still carry an unreviewed live secret on its first commit, same as any other
//      file. This exclusion is a disclosed, pre-existing residual, not a closed gap; see Issue #203
//      before treating `docs/reviews/*` as safe. `docs/decisions.md`'s append-only rows and every
//      `*.test.ts` fixture (edited every round of this very story) are NOT given this exclusion --
//      both stay in the checked set, generalized rather than special-cased away (fixes F2's
//      mis-scoped exclusions).
//   3. Every remaining {path, patternId} is checked against a pinned, already-reviewed baseline
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

const IMMUTABLE_REPORT_PREFIX = "docs/reviews/";

/** Pure (F1's actual fix): every credential-shaped grant in `allowlist`, minus the one named,
 * content-bounded exclusion (a dated `docs/reviews/*.md` report; PRINCIPLES rule 11). No
 * hand-typed opt-in list -- add a grant on any new file anywhere and it is in this set on the very
 * next run, with no change to this function. */
function deriveMutableCredentialGrants(
  allowlist: { path: string; patternId: string }[],
): { path: string; patternId: string }[] {
  const seen = new Set<string>();
  const out: { path: string; patternId: string }[] = [];
  for (const e of allowlist) {
    if (!CREDENTIAL_SHAPED_PATTERN_IDS.includes(e.patternId)) continue;
    if (e.path.startsWith(IMMUTABLE_REPORT_PREFIX)) continue;
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
// 0`), that `loadAllowlist` (history-scan.ts:150-159) already mechanically enforces on the real
// allowlist six lines away. Without it, a new grant + a live literal + a self-computed sha256
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
// baseline's own JUSTIFICATION. Mutation M3 (widening IMMUTABLE_REPORT_PREFIX from "docs/reviews/"
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
    { path: "docs/reviews/some-report-2026-09-14.md", patternId: "aws-access-key-id" }, // the one real exclusion
    { path: "docs/STATE.md", patternId: "email-address" }, // non-credential pattern id, excluded on that basis
    { path: "CHANGELOG.md", patternId: "aws-access-key-id" }, // duplicate grant, deduped
  ];
  assert.deepEqual(deriveMutableCredentialGrants(fakeAllowlist), [{ path: "CHANGELOG.md", patternId: "aws-access-key-id" }]);
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
