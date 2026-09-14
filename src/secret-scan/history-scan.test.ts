import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
