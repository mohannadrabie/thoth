import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { realRunner } from "../lib/exec.ts";
import { classificationLines, hashLines, migrateAllowlist, serializeAllowlist, verifyMigration } from "./allowlist-tool.ts";
import type { ScopedMatch } from "./allowlist-tool.ts";

// Issues 136 and 203 (story S-B2): the one-shot migration generator and its verify mode. Every value
// here is a placeholder word hashed at runtime; no email, hostname or key-shaped literal is written
// in this file's text, so it needs no allowlist entry. Hashes are computed by the independent `h`
// helper below, never by the production code.

const TOOL_SCRIPT = fileURLToPath(new URL("./allowlist-tool.ts", import.meta.url));
const AWS = "aws-access-key-id";
const MAIL = "email-address";
const REPORT = ["docs", "reviews", "x.md"].join("/"); // built at runtime: not a citation of a real file

function h(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function m(path: string, patternId: string, value: string): ScopedMatch {
  return { path, patternId, valueSha256: h(value) };
}
function legacyEntry(path: string, patternId: string, reason: string): { path: string; patternId: string; reason: string } {
  return { path, patternId, reason };
}
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const LEGACY = [legacyEntry("a.txt", AWS, "reason A"), legacyEntry("b.txt", MAIL, "reason B")];
const MATCHES: ScopedMatch[] = [
  m("a.txt", AWS, "v2"),
  m("a.txt", AWS, "v1"),
  m("a.txt", AWS, "v1"), // the same value twice: one hash
  m("b.txt", MAIL, "v3"),
  m("c.txt", AWS, "v9"), // a pair with no entry: never blessed
];

test("sb2-generator-scopes-each-legacy-entry-to-the-hashes-of-its-own-matches", () => {
  const out = migrateAllowlist(LEGACY, MATCHES);
  assert.deepEqual(out.entries, [
    { path: "a.txt", patternId: AWS, valueSha256: [h("v1"), h("v2")].sort(), reason: "reason A" },
    { path: "b.txt", patternId: MAIL, valueSha256: [h("v3")], reason: "reason B" },
  ]);
  for (const e of out.entries) {
    assert.deepEqual(Object.keys(e), ["path", "patternId", "valueSha256", "reason"], "key order is fixed so a diff reads the same every run");
  }
  assert.ok(!out.entries.some((e) => e.valueSha256.includes(h("v9"))), "a match at a pair with no entry is never blessed");
  assert.deepEqual(out.dropped, []);
});

test("sb2-generator-is-idempotent-and-deterministic", () => {
  const first = serializeAllowlist(migrateAllowlist(LEGACY, MATCHES).entries);
  const again = serializeAllowlist(migrateAllowlist(JSON.parse(first), MATCHES).entries);
  assert.equal(again, first, "a second run on the generator's own output is byte-identical");
  const reordered = serializeAllowlist(migrateAllowlist(LEGACY, [...MATCHES].reverse()).entries);
  assert.equal(reordered, first, "the order of the matches does not change the output");
});

test("sb2-generator-drops-and-reports-a-legacy-entry-that-matches-nothing", () => {
  const legacy = [...LEGACY, legacyEntry("gone.txt", AWS, "matches nothing")];
  const out = migrateAllowlist(legacy, MATCHES);
  assert.deepEqual(out.dropped, [{ path: "gone.txt", patternId: AWS }]);
  assert.ok(!out.entries.some((e) => e.path === "gone.txt"), "a dead entry is never written");
  assert.equal(out.entries.length, LEGACY.length);
});

test("sb2-generator-never-adds-a-hash-to-an-already-scoped-entry", () => {
  const scoped = [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1")], reason: "already scoped" }];
  const matches = [m("a.txt", AWS, "v1"), m("a.txt", AWS, "v2")]; // history now holds one more value at the pair
  const out = migrateAllowlist(scoped, matches);
  assert.deepEqual(out.entries[0]?.valueSha256, [h("v1")], "a scoped entry keeps exactly its own hashes; the extra value is never unioned in");
  assert.equal(out.carried, 1);
  const rerun = migrateAllowlist(out.entries, matches);
  assert.equal(serializeAllowlist(rerun.entries), serializeAllowlist(out.entries), "a re-run on scoped input is a no-op");
});

test("sb2-verify-rejects-a-widened-set", () => {
  const honest = migrateAllowlist(LEGACY, MATCHES).entries;
  assert.equal(verifyMigration(LEGACY, honest, MATCHES).ok, true, "control: the generator's own output verifies");
  const mutants: Array<[string, (entries: Array<Record<string, unknown>>) => unknown]> = [
    ["an added pair", (e) => [...e, { path: "zz.txt", patternId: AWS, valueSha256: [h("v1")], reason: "new" }]],
    ["an added hash no match has", (e) => { (e[0]!.valueSha256 as string[]).push(h("never-matched")); return e; }],
    ["a changed reason", (e) => { e[0]!.reason = "changed"; return e; }],
    ["a surviving legacy-shaped entry", (e) => { e[1] = legacyEntry("b.txt", MAIL, "reason B"); return e; }],
  ];
  for (const [name, mutate] of mutants) {
    const report = verifyMigration(LEGACY, mutate(clone(honest) as unknown as Array<Record<string, unknown>>), MATCHES);
    assert.equal(report.ok, false, `verify must fail on: ${name}`);
    assert.ok(report.problems.length > 0, `and say why: ${name}`);
  }
});

// Red-team F2 (post-build round): the count of newly allowlisted occurrences is REACHABLE (a hash added to an
// already value-scoped entry, or an entry on a pair with no legacy entry, both over a real match), but it is
// never the only reason verify fails: the structural checks (every migrated entry sits on a legacy pair, an
// already value-scoped entry is unchanged) always fire alongside it. The two tests pin exactly that, so
// what the ADR says about verify is what the instrument shows.
const WIDENING_PROBLEM = /are allowlisted by migrated but were not by legacy/;

test("sb2-verify-counts-and-names-a-widening", () => {
  const scoped = [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1")], reason: "r" }];
  const addedHash = verifyMigration(scoped, [{ ...scoped[0]!, valueSha256: [h("v1"), h("v2")].sort() }], [m("a.txt", AWS, "v1"), m("a.txt", AWS, "v2")]);
  assert.equal(addedHash.counts.newlyAllowlisted, 1, "a backed hash added to an already value-scoped entry is one newly allowlisted occurrence");
  assert.ok(addedHash.problems.some((p) => WIDENING_PROBLEM.test(p)), "and it is named");

  const addedPair = verifyMigration(
    [legacyEntry("a.txt", AWS, "r")],
    [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1")], reason: "r" }, { path: "z.txt", patternId: AWS, valueSha256: [h("v9")], reason: "r" }],
    [m("a.txt", AWS, "v1"), m("z.txt", AWS, "v9")],
  );
  assert.equal(addedPair.counts.newlyAllowlisted, 1, "a value allowlisted on a pair with no legacy entry is one newly allowlisted occurrence");
  assert.ok(addedPair.problems.some((p) => WIDENING_PROBLEM.test(p)));

  const honest = verifyMigration([legacyEntry("a.txt", AWS, "r")], [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1")], reason: "r" }], [m("a.txt", AWS, "v1")]);
  assert.equal(honest.counts.newlyAllowlisted, 0, "control: a faithful migration has none");
  assert.ok(!honest.problems.some((p) => WIDENING_PROBLEM.test(p)));
});

test("sb2-verify-widening-is-always-also-caught-structurally", () => {
  // Exhaustive over one pair: 5 legacy shapes x 5 migrated hash lists x every subset of 3 scanned values.
  const V = ["v1", "v2", "v3"];
  const legacies: unknown[][] = [
    [],
    [legacyEntry("a.txt", AWS, "r")],
    [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1")], reason: "r" }],
    [{ path: "a.txt", patternId: AWS, valueSha256: [h("v2")], reason: "r" }],
    [{ path: "a.txt", patternId: AWS, valueSha256: [h("v1"), h("v2")].sort(), reason: "r" }],
  ];
  const lists: string[][] = [[], ["v1"], ["v2"], ["v1", "v2"], ["v1", "v3"]];
  let cases = 0;
  let widenings = 0;
  for (const legacy of legacies) {
    for (const list of lists) {
      for (let mask = 0; mask < 1 << V.length; mask++) {
        const migrated = list.length === 0 ? [] : [{ path: "a.txt", patternId: AWS, valueSha256: list.map(h).sort(), reason: "r" }];
        const matches = V.filter((_, i) => (mask & (1 << i)) !== 0).map((v) => m("a.txt", AWS, v));
        const report = verifyMigration(legacy, migrated, matches);
        cases++;
        if (report.counts.newlyAllowlisted === 0) continue;
        widenings++;
        assert.ok(
          report.problems.some((p) => !WIDENING_PROBLEM.test(p)),
          `a widening must also be reported by a structural check, never by the count alone: ${JSON.stringify({ legacy, list, mask })}`,
        );
      }
    }
  }
  assert.equal(cases, 5 * 5 * 8);
  assert.ok(widenings > 0, "control: the enumeration reaches the widening count (it is not vacuous)");
});

test("sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches", () => {
  const honest = migrateAllowlist(LEGACY, MATCHES).entries;
  const droppedEntry = clone(honest).slice(1); // the entry for a.txt is gone, its values still match
  const r1 = verifyMigration(LEGACY, droppedEntry, MATCHES);
  assert.equal(r1.ok, false, "a dropped entry that still matches must fail verify");
  assert.ok(r1.counts.newlyBlocking > 0, "and be reported as newly blocking occurrences");
  const droppedHash = clone(honest);
  droppedHash[0]!.valueSha256 = droppedHash[0]!.valueSha256.slice(1); // one hash gone, its value still matches
  const r2 = verifyMigration(LEGACY, droppedHash, MATCHES);
  assert.equal(r2.ok, false, "a dropped hash whose value still matches must fail verify");
  assert.ok(r2.counts.newlyBlocking > 0);
});

test("sb2-generator-refuses-a-malformed-scoped-input", () => {
  const good = h("ok");
  const cases: Array<[string, unknown[]]> = [
    ["a non-hex element", [{ path: "a.txt", patternId: AWS, valueSha256: ["zz"], reason: "r" }]],
    ["uppercase hex", [{ path: "a.txt", patternId: AWS, valueSha256: [good.toUpperCase()], reason: "r" }]],
    ["a string, not a list", [{ path: "a.txt", patternId: AWS, valueSha256: good, reason: "r" }]],
    ["an empty list", [{ path: "a.txt", patternId: AWS, valueSha256: [], reason: "r" }]],
    ["null", [{ path: "a.txt", patternId: AWS, valueSha256: null, reason: "r" }]],
    ["a missing reason", [{ path: "a.txt", patternId: AWS }]],
    ["a non-object entry", ["a.txt"]],
    ["a duplicate (path, patternId)", [legacyEntry("a.txt", AWS, "one"), legacyEntry("a.txt", AWS, "two")]],
  ];
  for (const [name, input] of cases) {
    assert.throws(() => migrateAllowlist(input, MATCHES), Error, `the generator must refuse ${name}, never guess`);
  }
  assert.throws(() => migrateAllowlist({}, MATCHES), Error, "a non-array input document is refused");
});

test("sb2-generator-reports-classification-counts-per-pattern", () => {
  const entries = migrateAllowlist(
    [legacyEntry("a.txt", AWS, "r"), legacyEntry(REPORT, AWS, "r"), legacyEntry("b.txt", MAIL, "r")],
    [m("a.txt", AWS, "v1"), m("a.txt", AWS, "v2"), m(REPORT, AWS, "v3"), m("b.txt", MAIL, "v4")],
  ).entries;
  const lines = classificationLines(entries);
  assert.ok(lines.some((l) => l.includes(`${AWS}=3`) && l.includes(`${MAIL}=1`)), `blessed values per pattern: ${lines.join(" | ")}`);
  assert.ok(lines.some((l) => /under docs\/reviews\/: 1\b/.test(l)), "blessed values under the reports directory");
  assert.ok(lines.some((l) => /credential-shaped values: 3\b/.test(l)), "blessed credential-shaped values");
  assert.ok(!lines.join("\n").match(/[0-9a-f]{64}/), "counts only: no hash in the classification output");
});

test("sb2-hash-lines-hash-the-regex-match-text", () => {
  const key = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nQUJD\n" + ["-----END", "PRIVATE KEY-----"].join(" ");
  const lines = hashLines(`x\n${key}\ny\n`, "private-key-block");
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", new RegExp(`^${h(key)}  `), "the hash is over the whole multi-line match, from the raw bytes");
  assert.ok(!(lines[0] ?? "").includes("QUJD"), "only the redacted form is printed beside it");
  assert.throws(() => hashLines("x", "not-a-pattern"), Error);
});

async function withToolRepo(files: Record<string, string>, fn: (dir: string, scratch: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-tool-repo-"));
  const scratch = await mkdtemp(join(tmpdir(), "oss01-sb2-tool-out-"));
  try {
    const run = async (...args: string[]): Promise<void> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    };
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", ["ci", "example.org"].join("@"));
    await run("config", "user.name", "Test");
    await run("config", "commit.gpgsign", "false");
    // Pinned regardless of the machine's global git config: this is what `hash` must handle for a
    // non-ASCII fixture path (Issue 238), and quoting is git's own default anyway.
    await run("config", "core.quotepath", "true");
    for (const [p, content] of Object.entries(files)) {
      const abs = join(dir, ...p.split("/"));
      await mkdir(join(abs, ".."), { recursive: true });
      await writeFile(abs, content);
    }
    await run("add", ".");
    await run("commit", "-q", "-m", "fixture");
    await fn(dir, scratch);
  } finally {
    await removeDir(dir);
    await removeDir(scratch);
  }
}

test("sb2-generator-cli-prints-counts-only", async () => {
  const one = "AKIA" + "Q".repeat(16);
  const two = "AKIA" + "R".repeat(16);
  const legacy = [{ path: "fixture.txt", patternId: AWS, reason: "synthetic fixture" }];
  const allowlistPath = "docs/qa/secret-scan-allowlist.json";
  await withToolRepo(
    { "fixture.txt": `a ${one}\nb ${two}\n`, [allowlistPath]: JSON.stringify(legacy, null, 2) + "\n" },
    async (dir, scratch) => {
      const out = join(scratch, "migrated.json");
      const gen = await realRunner("node", [TOOL_SCRIPT, "generate", "--base", "HEAD", "--out", out], { cwd: dir, encoding: "utf8" });
      assert.equal(gen.code, 0, `generate failed:\n${gen.stdout}\n${gen.stderr}`);
      assert.match(gen.stdout, /blessed values by pattern/, "the classification counts are printed");
      const migratedText = await readFile(out, "utf8");
      const migrated = JSON.parse(migratedText) as Array<{ path: string; valueSha256: string[] }>;
      assert.deepEqual(migrated[0]?.valueSha256, [h(one), h(two)].sort());
      for (const text of [gen.stdout, gen.stderr, migratedText]) {
        assert.ok(!text.includes(one) && !text.includes(two), "no raw literal in stdout, stderr or the output file");
      }
      assert.ok(!/[0-9a-f]{64}/.test(gen.stdout), "no hash on stdout");

      const ver = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", out], { cwd: dir, encoding: "utf8" });
      assert.equal(ver.code, 0, `verify of the generator's own output must pass:\n${ver.stdout}\n${ver.stderr}`);
      assert.ok(!/[0-9a-f]{64}/.test(ver.stdout) && !ver.stdout.includes(one), "verify prints counts only");

      const widened = JSON.parse(migratedText) as Array<{ valueSha256: string[] }>;
      widened[0]!.valueSha256.push(h("a-hash-no-match-carries"));
      const bad = join(scratch, "widened.json");
      await writeFile(bad, JSON.stringify(widened, null, 2) + "\n");
      const rejected = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", bad], { cwd: dir, encoding: "utf8" });
      assert.notEqual(rejected.code, 0, "verify exits non-zero on a widened file");
    },
  );
});

// Code-reviewer MED (Issue 240, post-build round): generate and verify must read history AND the legacy
// allowlist at the BASE ref, never at HEAD, or a regeneration silently blesses whatever the newest
// commit added. Every test above uses base equal to HEAD, so this pins the case where they differ.
async function withToolRepoHistory(
  steps: Array<Record<string, string>>,
  fn: (dir: string, scratch: string, commits: string[]) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "oss01-sb2-tool-hist-"));
  const scratch = await mkdtemp(join(tmpdir(), "oss01-sb2-tool-hist-out-"));
  try {
    const run = async (...args: string[]): Promise<string> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
      return res.stdout.trim();
    };
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", ["ci", "example.org"].join("@"));
    await run("config", "user.name", "Test");
    await run("config", "commit.gpgsign", "false");
    const commits: string[] = [];
    for (const files of steps) {
      for (const [p, content] of Object.entries(files)) {
        const abs = join(dir, ...p.split("/"));
        await mkdir(join(abs, ".."), { recursive: true });
        await writeFile(abs, content);
      }
      await run("add", ".");
      await run("commit", "-q", "-m", `step ${commits.length + 1}`);
      commits.push(await run("rev-parse", "HEAD"));
    }
    await fn(dir, scratch, commits);
  } finally {
    await removeDir(dir);
    await removeDir(scratch);
  }
}

test("sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref", async () => {
  const one = "AKIA" + "S".repeat(16);
  const two = "AKIA" + "T".repeat(16);
  const allowlistPath = "docs/qa/secret-scan-allowlist.json";
  const legacyBase = [{ path: "fixture.txt", patternId: AWS, reason: "reason at the base" }];
  const legacyLater = [{ path: "fixture.txt", patternId: AWS, reason: "reason after the base" }];
  const steps = [
    { "fixture.txt": `a ${one}\n`, [allowlistPath]: JSON.stringify(legacyBase, null, 2) + "\n" },
    // the second commit adds a new literal AND changes the legacy file
    { "fixture.txt": `a ${one}\nb ${two}\n`, [allowlistPath]: JSON.stringify(legacyLater, null, 2) + "\n" },
  ];
  await withToolRepoHistory(steps, async (dir, scratch, commits) => {
    const [first] = commits;
    assert.ok(first !== undefined && commits.length === 2);
    const tool = (...args: string[]) => realRunner("node", [TOOL_SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
    const generate = async (base: string, name: string): Promise<Array<{ valueSha256: string[]; reason: string }>> => {
      const out = join(scratch, name);
      const res = await tool("generate", "--base", base, "--out", out);
      assert.equal(res.code, 0, `generate --base ${base} failed:\n${res.stdout}\n${res.stderr}`);
      return JSON.parse(await readFile(out, "utf8")) as Array<{ valueSha256: string[]; reason: string }>;
    };

    // generate: history AND the legacy file come from the base, not from HEAD.
    const atFirst = await generate(first, "at-first.json");
    assert.deepEqual(atFirst.map((e) => e.valueSha256), [[h(one)]], "base at the first commit blesses exactly one value: the later literal is not in that history");
    assert.equal(atFirst[0]?.reason, "reason at the base", "the legacy file is read at the base, not at HEAD");
    const atHead = await generate("HEAD", "at-head.json");
    assert.deepEqual(atHead.map((e) => e.valueSha256), [[h(one), h(two)].sort()], "base at HEAD blesses both values");
    assert.equal(atHead[0]?.reason, "reason after the base");

    // verify: the same scoping. A migrated file that already lists the later value is refused at the first commit.
    const write = async (name: string, hashes: string[], reason: string): Promise<string> => {
      const file = join(scratch, name);
      await writeFile(file, serializeAllowlist([{ path: "fixture.txt", patternId: AWS, valueSha256: hashes, reason }]));
      return file;
    };
    const oneHash = await write("one-hash.json", [h(one)], "reason at the base");
    const twoHashBaseReason = await write("two-hash-base-reason.json", [h(one), h(two)].sort(), "reason at the base");
    const twoHashLaterReason = await write("two-hash-later-reason.json", [h(one), h(two)].sort(), "reason after the base");
    assert.equal((await tool("verify", "--base", first, "--migrated", oneHash)).code, 0, "control: the one-hash file verifies at the first commit");
    const refused = await tool("verify", "--base", first, "--migrated", twoHashBaseReason);
    assert.equal(refused.code, 1, `the two-hash file must fail verify at the first commit:\n${refused.stdout}`);
    assert.match(refused.stdout, /lists 1 hash\(es\) that no scanned match carries/);
    assert.equal((await tool("verify", "--base", "HEAD", "--migrated", twoHashLaterReason)).code, 0, "control: the two-hash file verifies at HEAD");
  });
});

test("sb2-hash-command-prints-one-line-per-match-in-a-blob", async () => {
  const one = "AKIA" + "U".repeat(16);
  const two = "AKIA" + "V".repeat(16);
  await withToolRepo({ "fixture.txt": `a ${one}\nb ${two}\nc ${one}\n` }, async (dir) => {
    const res = await realRunner("node", [TOOL_SCRIPT, "hash", "HEAD", "fixture.txt", AWS], { cwd: dir, encoding: "utf8" });
    assert.equal(res.code, 0, `hash failed:\n${res.stdout}\n${res.stderr}`);
    const hashes = res.stdout.split(/\r?\n/).map((l) => /^([0-9a-f]{64}) {2}/.exec(l)?.[1]).filter((x): x is string => x !== undefined);
    assert.deepEqual([...hashes].sort(), [h(one), h(two)].sort(), "one line per distinct match in the blob, each with its hash; the repeat is printed once");
    assert.ok(!res.stdout.includes(one) && !res.stdout.includes(two), "only the redacted form is printed beside each hash");
  });
});

// Issue 238: git C-quotes a tree path holding a non-ASCII byte (e.g. `café.txt` prints from a real
// `git ls-tree` as `"caf\303\251.txt"`), and `lsTree()`'s Map is keyed by that exact raw spelling.
// Before this fix, `hash` matched ONLY that raw key, so a maintainer typing the plain filename they
// actually see got "is not in <commit>" and had to fall back to computing the hash by hand — the
// tool accepts either spelling now. This is a real `git ls-tree` C-quoted path, not a hand-typed
// escape sequence: the positive control below proves the raw spelling really is quoted on this
// platform, so the fixed behavior is demonstrated, not assumed.
test("oss01-238-hash-command-accepts-the-plain-decoded-spelling-of-a-C-quoted-path", async () => {
  const secret = "AKIA" + "W".repeat(16);
  const realName = "café.txt";
  await withToolRepo({ [realName]: `a ${secret}\n` }, async (dir) => {
    const spelled = await realRunner("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8" });
    const rawSpelling = spelled.stdout.trim();
    assert.notEqual(rawSpelling, realName, "positive control: git must really have C-quoted this non-ASCII filename, or this test proves nothing");
    assert.ok(rawSpelling.startsWith('"') && rawSpelling.endsWith('"'), `expected a C-quoted spelling, got: ${rawSpelling}`);

    // The fix: the plain, decoded filename a maintainer actually sees now resolves.
    const plain = await realRunner("node", [TOOL_SCRIPT, "hash", "HEAD", realName, AWS], { cwd: dir, encoding: "utf8" });
    assert.equal(plain.code, 0, `hash with the plain decoded path must succeed:\n${plain.stdout}\n${plain.stderr}`);
    assert.match(plain.stdout, /^[0-9a-f]{64} {2}/, "prints the hash line");
    assert.ok(!plain.stdout.includes(secret), "only the redacted form is printed beside the hash");

    // Unchanged (regression): the exact raw spelling git itself prints still resolves too.
    const raw = await realRunner("node", [TOOL_SCRIPT, "hash", "HEAD", rawSpelling, AWS], { cwd: dir, encoding: "utf8" });
    assert.equal(raw.code, 0, `hash with git's own raw C-quoted spelling must still succeed:\n${raw.stdout}\n${raw.stderr}`);
    assert.equal(raw.stdout, plain.stdout, "both spellings resolve to the exact same blob and print the exact same hash line");
  });
});

// ---------------------------------------------------------------------------------------------
// Round 4 (same class as Issue 243): `verify` prints problem lines that carry the allowlist entries' own
// path and pattern id, and reviewers and maintainers run it against a pull request's allowlist. Text a
// contributor authored must not reach the terminal unquoted. Payloads are built at runtime; a payload only
// creates a marker file in a scratch directory.
// ---------------------------------------------------------------------------------------------

const V_PAYLOAD = "node mk.mjs";
const V_MARKER = "MARK";
const V_PREFIX = "[allowlist-tool verify] ";

/** Independent statement of the display rule: at most 120 code points, every character outside
 * [A-Za-z0-9._/-] as %HH per UTF-8 byte (upper-case hex); a non-string or empty value is a lone percent sign. */
function shown(s: unknown): string {
  if (typeof s !== "string" || s.length === 0) return "%";
  let out = "";
  for (const ch of [...s].slice(0, 120)) {
    if (/^[A-Za-z0-9._/-]$/.test(ch)) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** A repo built with git plumbing only, in phases, so a path a filesystem refuses can still be a tree entry.
 * Each phase builds its files from the spelled paths the previous commit has (git quotes some of them). */
async function withPlumbingPhases<T>(
  phases: Array<(spelled: string[]) => Record<string, string>>,
  fn: (dir: string, scratch: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "oss01-vp-repo-"));
  const scratch = await mkdtemp(join(tmpdir(), "oss01-vp-out-"));
  try {
    const git = async (...args: string[]): Promise<string> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
      return res.stdout.trim();
    };
    await git("init", "-q", "-b", "main");
    let n = 0;
    let parent: string | null = null;
    let spelled: string[] = [];
    for (const build of phases) {
      for (const [path, content] of Object.entries(build(spelled))) {
        const src = join(scratch, `blob-${n++}`);
        await writeFile(src, content);
        const sha = await git("hash-object", "-w", "--no-filters", src);
        await git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${sha},${path}`);
      }
      const tree = await git("write-tree");
      const args = ["-c", "user.name=Test", "-c", `user.email=${["ci", "example.org"].join("@")}`, "-c", "commit.gpgsign=false", "commit-tree", tree, "-m", "fixture"];
      if (parent !== null) args.push("-p", parent);
      parent = await git(...args);
      await git("update-ref", "refs/heads/main", parent);
      spelled = (await git("ls-tree", "-r", "--name-only", "HEAD")).split("\n").filter((l) => l.length > 0);
    }
    return await fn(dir, scratch);
  } finally {
    await removeDir(dir);
    await removeDir(scratch);
  }
}

async function shellDirWithPayload(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "oss01-vp-shell-"));
  await writeFile(join(d, "mk.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(V_MARKER)}, "x");\n`);
  return d;
}

function pasteLine(line: string, cwd: string): void {
  spawnSync(line, { cwd, shell: true, encoding: "utf8", timeout: 30_000 });
}

test("oss01-allowlist-tool-verify-problem-lines-never-carry-a-shell-metacharacter-from-the-allowlist-file", async () => {
  const P = V_PAYLOAD;
  // Hostile text used as an entry path AND inside its pattern id. The pattern id leads with the class tag so
  // two classes stay distinguishable even where the cap truncates the long value.
  const hostile: string[] = [
    `a$(${P})b`, `a\`${P}\`b`, `a&${P}&b`, `a;${P};b`, `a|${P}|b`, `a"" & ${P} & ""b`, `a" & ${P} & b`,
    `a $(New-Item ${V_MARKER} -ItemType File) b`, `a\n${P}\nb`, "my file", "résumé", "%PATH%", "%CD%%%", `${"x".repeat(150)}$(${P})`,
  ];
  const tags = ["invalid", "dup", "nolegacy", "reason", "differs", "unbacked"];
  const pid = (tag: string, path: string): string => `${tag}::${path}`;
  const h1 = h("h1");
  const h2 = h("h2");

  // Tree entries whose pair really matches, for the "still matches" class: names a filesystem refuses are fine here.
  const treeNames = [`t$(${P})`, `t\`${P}\``, `t&${P}&`, `t"" & ${P} & ""`, `t|${P}|`, "t space", "tésumé", "t%PATH%"];
  const lit = (i: number): string => `k = AKIA${String.fromCharCode(65 + i).repeat(16)}\n`;

  const legacy: unknown[] = [];
  const migrated: unknown[] = [];
  for (const p of hostile) {
    legacy.push({ path: p, patternId: pid("dup", p), reason: "r" });
    legacy.push({ path: p, patternId: pid("reason", p), reason: "A" });
    legacy.push({ path: p, patternId: pid("differs", p), valueSha256: [h1], reason: "r" });
    legacy.push({ path: p, patternId: pid("unbacked", p), reason: "r" });
    legacy.push({ path: p, patternId: pid("linvalid", p) }); // no reason: an invalid LEGACY entry
    migrated.push({ path: p, patternId: pid("invalid", p), valueSha256: ["zz"], reason: "r" });
    migrated.push({ path: p, patternId: pid("dup", p), valueSha256: [h2], reason: "r" });
    migrated.push({ path: p, patternId: pid("dup", p), valueSha256: [h2], reason: "r" });
    migrated.push({ path: p, patternId: pid("nolegacy", p), valueSha256: [h2], reason: "r" });
    migrated.push({ path: p, patternId: pid("reason", p), valueSha256: [h2], reason: "B" });
    migrated.push({ path: p, patternId: pid("differs", p), valueSha256: [h2], reason: "r" });
    migrated.push({ path: p, patternId: pid("unbacked", p), valueSha256: [h2], reason: "r" });
  }
  const phase1 = (): Record<string, string> => Object.fromEntries(treeNames.map((n, i) => [n, lit(i)]));
  const phase2 = (spelled: string[]): Record<string, string> => {
    const still = spelled.map((s) => ({ path: s, patternId: AWS, reason: "r" })); // legacy-shaped, absent from migrated
    return { "docs/qa/secret-scan-allowlist.json": JSON.stringify([...legacy, ...still], null, 2) + "\n" };
  };

  await withPlumbingPhases([phase1, phase2], async (dir, scratch) => {
    const spelledNames = (await realRunner("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8" })).stdout
      .split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0 && l !== "docs/qa/secret-scan-allowlist.json");
    assert.equal(spelledNames.length, treeNames.length, "control: every hostile tree name is a tree entry");
    const migratedFile = join(scratch, "migrated.json");
    await writeFile(migratedFile, JSON.stringify(migrated, null, 2) + "\n");
    const run = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", migratedFile], { cwd: dir, encoding: "utf8" });
    assert.equal(run.code, 1, `verify fails on this migrated file:\n${run.stdout}\n${run.stderr}`);
    const lines = run.stdout.split(/\r?\n/).filter((l) => l.length > 0);

    // One physical line per problem, and every line starts with the tool's own bracketed prefix.
    for (const l of lines) assert.ok(l.startsWith(V_PREFIX), `a line without the fixed prefix (a raw newline split a line?): ${JSON.stringify(l)}`);
    const problems = lines.filter((l) => l.startsWith(V_PREFIX + "problem: "));

    const FIELDS = "\\(([A-Za-z0-9._/%-]+), ([A-Za-z0-9._/%-]+)\\)";
    const classes: Array<[string, RegExp]> = [
      ["invalid-entry", new RegExp(`^\\[allowlist-tool verify\\] problem: (legacy|migrated) entry \\d+ ${FIELDS} is not a valid value-scoped entry: [A-Za-z0-9-]+$`)],
      ["two-entries", new RegExp(`^\\[allowlist-tool verify\\] problem: migrated has two entries for ${FIELDS}$`)],
      ["no-legacy-pair", new RegExp(`^\\[allowlist-tool verify\\] problem: migrated entry \\d+ ${FIELDS} sits on a pair with no legacy entry$`)],
      ["changed-reason", new RegExp(`^\\[allowlist-tool verify\\] problem: migrated entry \\d+ ${FIELDS} changed its reason$`)],
      ["unbacked-hashes", new RegExp(`^\\[allowlist-tool verify\\] problem: migrated entry \\d+ ${FIELDS} lists \\d+ hash\\(es\\) that no scanned match carries$`)],
      ["differs-from-scoped", new RegExp(`^\\[allowlist-tool verify\\] problem: migrated entry \\d+ ${FIELDS} differs from an already value-scoped legacy entry$`)],
      ["still-matches", new RegExp(`^\\[allowlist-tool verify\\] problem: legacy entry \\d+ ${FIELDS} is missing from migrated although it still matches$`)],
      ["widening-count", /^\[allowlist-tool verify\] problem: \d+ occurrence\(s\) are allowlisted by migrated but were not by legacy \(a widening\)$/],
      ["newly-blocking-count", /^\[allowlist-tool verify\] problem: \d+ occurrence\(s\) were allowlisted by legacy but would block under migrated$/],
    ];
    const seenClasses = new Map<string, number>();
    const seenFields = new Set<string>();
    const unclassified: string[] = [];
    for (const l of problems) {
      const hit = classes.find(([, re]) => re.test(l));
      if (hit === undefined) { unclassified.push(l); continue; }
      seenClasses.set(hit[0], (seenClasses.get(hit[0]) ?? 0) + 1);
      const mm = hit[1].exec(l);
      const [a, b] = hit[0] === "invalid-entry" ? [2, 3] : [1, 2];
      if (mm !== null && mm[a] !== undefined && mm[b] !== undefined) seenFields.add(`${mm[a]}|${mm[b]}`);
    }
    assert.deepEqual(unclassified, [], "every problem line is a fixed shape whose only variable text is in [A-Za-z0-9._/%-]");
    for (const c of ["invalid-entry", "two-entries", "no-legacy-pair", "changed-reason", "unbacked-hashes", "differs-from-scoped", "still-matches"]) {
      assert.ok((seenClasses.get(c) ?? 0) > 0, `control: the ${c} problem class is exercised`);
    }
    assert.ok(problems.some((l) => l.includes("legacy entry") && l.includes("is not a valid value-scoped entry")), "an invalid LEGACY entry prints too");

    // The printed fields are exactly the encoded, clipped inputs.
    for (const p of hostile) {
      for (const tag of [...tags, "linvalid"]) {
        assert.ok(seenFields.has(`${shown(p)}|${shown(pid(tag, p))}`), `the ${tag} problem for ${JSON.stringify(p.slice(0, 12))} shows the encoded fields`);
      }
    }
    for (const s of spelledNames) assert.ok(seenFields.has(`${shown(s)}|${AWS}`), "the still-matches problem for a tree entry shows its encoded spelling");

    // Defense in depth: paste every printed line, raw and prefix-stripped, into the platform shell.
    const scratchShell = await shellDirWithPayload();
    try {
      for (const l of lines) {
        pasteLine(l, scratchShell);
        pasteLine(l.slice(V_PREFIX.length), scratchShell);
      }
      assert.ok(!existsSync(join(scratchShell, V_MARKER)), "pasting the printed verify lines into the shell ran a payload");
    } finally {
      await removeDir(scratchShell);
    }

    // Harness sanity on any platform: a bare payload pasted through the same helper does create the marker.
    const sanity = await shellDirWithPayload();
    try {
      pasteLine(P, sanity);
      assert.ok(existsSync(join(sanity, V_MARKER)), "the paste harness can run a payload in this shell");
    } finally {
      await removeDir(sanity);
    }

    // Positive control: the RAW echo (the old shape) executes a payload in this platform shell for some row.
    // Where the shell is cmd (Windows) it does. In a POSIX sh the bare parenthesis before the path is a syntax
    // error, so nothing could run there before the fix either; the harness sanity above covers that platform.
    let controlExecuted = 0;
    for (const p of hostile) {
      const control = await shellDirWithPayload();
      try {
        pasteLine(`${V_PREFIX}problem: migrated entry 3 (${p}, ${pid("nolegacy", p)}) sits on a pair with no legacy entry`, control);
        if (existsSync(join(control, V_MARKER))) controlExecuted++;
      } finally {
        await removeDir(control);
      }
    }
    if (process.platform === "win32") {
      assert.ok(controlExecuted > 0, "positive control: the old raw echo must execute a payload in cmd, or this test proves nothing");
    }
  });

  // File-level problems: a fixed message, never a snippet of the file. A non-array file, and unparseable input
  // (whose JSON parser error message would otherwise quote a piece of the file).
  const junk = `not json $(${P}) \`${P}\` & ; | "`;
  await withPlumbingPhases([() => ({ "docs/qa/secret-scan-allowlist.json": "[]\n" })], async (dir, scratch) => {
    const notArray = join(scratch, "not-array.json");
    await writeFile(notArray, JSON.stringify({ [`k$(${P})`]: `v\`${P}\`` }));
    const r1 = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", notArray], { cwd: dir, encoding: "utf8" });
    assert.ok(r1.stdout.split(/\r?\n/).includes(`${V_PREFIX}problem: migrated is not an array`), `a fixed line for a non-array file:\n${r1.stdout}`);
    assert.ok(!r1.stdout.includes(P) && !r1.stderr.includes(P), "no text of the file on any stream");

    const bad = join(scratch, "bad.json");
    await writeFile(bad, junk);
    const r2 = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", bad], { cwd: dir, encoding: "utf8" });
    assert.equal(r2.code, 2);
    assert.equal(r2.stderr.trim(), "[allowlist-tool] the migrated file is not valid JSON", "a fixed message, not a snippet of the file");
    assert.ok(!r2.stdout.includes(P) && !r2.stderr.includes(P));
  });
  await withPlumbingPhases([() => ({ "docs/qa/secret-scan-allowlist.json": junk })], async (dir, scratch) => {
    const okFile = join(scratch, "ok.json");
    await writeFile(okFile, "[]\n");
    const r = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", okFile], { cwd: dir, encoding: "utf8" });
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "[allowlist-tool] the legacy allowlist at the base ref is not valid JSON", "a fixed message for unparseable legacy text");
    assert.ok(!r.stdout.includes(P) && !r.stderr.includes(P));
  });
  await withPlumbingPhases([() => ({ "docs/qa/secret-scan-allowlist.json": JSON.stringify({ [`k$(${P})`]: 1 }) })], async (dir, scratch) => {
    const okFile = join(scratch, "ok.json");
    await writeFile(okFile, "[]\n");
    const r = await realRunner("node", [TOOL_SCRIPT, "verify", "--base", "HEAD", "--migrated", okFile], { cwd: dir, encoding: "utf8" });
    assert.ok(r.stdout.split(/\r?\n/).includes(`${V_PREFIX}problem: legacy is not an array`), `a fixed line for a non-array legacy file:\n${r.stdout}`);
  });
});
