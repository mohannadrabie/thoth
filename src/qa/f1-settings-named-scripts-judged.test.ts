// #455 (S7, k-blocker): F1-settings-named-scripts-judged. Written FAILING FIRST.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as f1 from "./f1-settings-named-scripts-judged.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const snap = (commands: string[]): unknown => ({
  version: 1,
  plugins: [{ id: "t@t", version: "1", gitCommitSha: "abc", files: [{ path: "hooks/hooks.json", sha256: "x", commandsSha256: sha(JSON.stringify(commands)), commands }] }],
});

type Result = { ok: boolean; failures: string[]; notes: string[] };
const check = (o: Record<string, unknown>): Result => {
  const f = (f1 as unknown as Record<string, unknown>)["checkF1"];
  if (typeof f !== "function") throw new Error("export checkF1 does not exist yet");
  return (f as (o: unknown) => Result)(o);
};

test("f1: fails on unprotected plugin script", () => {
  const r = check({ root: REPO, snapshot: snap(['node "${CLAUDE_PROJECT_DIR}/docs/decisions-archive.mjs"']), protectedAll: ["docs/session-brief.mjs"], judgments: [], live: { status: "ok", detail: "" } });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((l) => l.includes("docs/decisions-archive.mjs")), JSON.stringify(r.failures));
});

test("f1: fails on unjudged unenumerable command, passes once judged", () => {
  const cmd = "echo hello";
  const base = { root: REPO, snapshot: snap([cmd]), protectedAll: [] as string[], live: { status: "ok", detail: "" } };
  const bad = check({ ...base, judgments: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((l) => l.includes("echo hello")), JSON.stringify(bad.failures));
  const good = check({ ...base, judgments: [{ plugin: "t@t", commandSha256: sha(cmd), verdict: "judged-safe", note: "n", date: "2026-10-06" }] });
  assert.equal(good.ok, true, JSON.stringify(good.failures));
});

test("f1: an outside-repo script is reported, not a failure", () => {
  const r = check({ root: REPO, snapshot: snap(['bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/x.sh"']), protectedAll: [], judgments: [], live: { status: "ok", detail: "" } });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.ok(r.notes.some((l) => l.includes("x.sh")));
});

test("f1: live drift fails, unverified does not", () => {
  const base = { root: REPO, snapshot: snap(["node docs/decisions-archive.mjs"]), protectedAll: ["docs/decisions-archive.mjs"], judgments: [] };
  assert.equal(check({ ...base, live: { status: "drift", detail: "t@t changed" } }).ok, false);
  const u = check({ ...base, live: { status: "unverified", detail: "no ~/.claude" } });
  assert.equal(u.ok, true, JSON.stringify(u.failures));
  assert.ok(u.notes.some((l) => /unverified/i.test(l)));
});

test("f1: a snapshot failing its internal check fails", () => {
  const s = snap(["node docs/a.mjs"]) as { plugins: Array<{ files: Array<{ commands: string[] }> }> };
  s.plugins[0]!.files[0]!.commands.push("node docs/b.mjs");
  assert.equal(check({ root: REPO, snapshot: s, protectedAll: ["docs/a.mjs", "docs/b.mjs"], judgments: [], live: { status: "ok", detail: "" } }).ok, false);
});
