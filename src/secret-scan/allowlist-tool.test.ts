import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
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
