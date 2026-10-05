// #308 story E0 (Issue #408): the closed read-only shell command set. Written FAILING FIRST by story-implementer (the
// story has no new UI or API surface, so test-writer is not dispatched). Plan: docs/plans/s308-E0-readonly-shell-plan-
// 2026-10-05.md, section 5. Design challenge: docs/reviews/s308-E0-readonly-shell-design-challenge-2026-10-04.md.
// Everything goes through the public normalizeShellCall entry (and the kernel for the bundling proof), so the checks are
// independent of how readonly-catalog.ts is built. Only the table-shape checks import the catalog module, dynamically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShellCall, RESOLVABLE_BINARIES } from "./shell.ts";
import { WRAPPER_BINARY_NAMES } from "./wrapper-catalog.ts";
import { decide } from "../kernel/kernel.ts";
import type { Rule } from "../kernel/rule-types.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import { ACCEPT_ROWS, CONFIG_EXEC_OR_BROAD_BINARIES, DENY_ROWS, RULING_WRAPPER_NAMES } from "../fixtures/readonly-corpus.ts";

const call = (command: string): ActionRecord => normalizeShellCall({ command, environment: "e", identity: "i" });
const isCleanReadOrList = (r: ActionRecord): boolean => r.unresolved.length === 0 && r.verbs.some((v) => v === "read" || v === "list");

// --- Criterion 1: the table is closed ---------------------------------------------------------------------------------

test("RO-table-closed: the exported command names equal the pinned list", async () => {
  const mod = await import("./readonly-catalog.ts");
  assert.deepEqual([...mod.READONLY_COMMAND_NAMES].sort(), ["cat", "grep", "head", "ls", "tail", "wc"]);
});

test("RO-table-has-no-wrapper: no table name is a wrapper (catalogued or from the Manager's ruling)", async () => {
  const mod = await import("./readonly-catalog.ts");
  for (const name of mod.READONLY_COMMAND_NAMES) {
    assert.ok(!WRAPPER_BINARY_NAMES.includes(name), `${name} is in the wrapper catalog`);
    assert.ok(!RULING_WRAPPER_NAMES.includes(name), `${name} is a wrapper named by the ruling`);
  }
});

test("RO-table-excludes-config-exec-binaries: no git, rg, find, sed or other helper-running or broad-grammar binary is a table name", async () => {
  const mod = await import("./readonly-catalog.ts");
  for (const name of CONFIG_EXEC_OR_BROAD_BINARIES) assert.ok(!mod.READONLY_COMMAND_NAMES.includes(name), `${name} must not be in the table until its own story triages it`);
});

test("RO-mutant-widen-RESOLVABLE_BINARIES guard: the kubectl grammar's binary set is untouched, and 'ls get pods/x --context=c' stays unresolved", () => {
  assert.deepEqual([...RESOLVABLE_BINARIES], ["kubectl"]);
  assert.ok(call("ls get pods/x --context=c").unresolved.length > 0);
  assert.ok(call("cat get pods/x --context=c").unresolved.length > 0);
});

// --- Criterion 2: accept rows ------------------------------------------------------------------------------------------

for (const row of ACCEPT_ROWS) {
  test(`RO-accept: ${row.command}`, () => {
    const r = call(row.command);
    assert.deepEqual(r.verbs, [row.verb]);
    assert.deepEqual(r.targets, [row.target]);
    assert.deepEqual(r.unresolved, []);
    assert.equal(r.source, "parsed");
    assert.equal(r.deferred, false);
    assert.equal(r.environment, "e");
    assert.equal(r.identity, "i");
  });
}

test("RO-implicit-dot-target: ls and grep -r with no path operand carry the target '.'", () => {
  assert.deepEqual(call("ls").targets, ["."]);
  assert.deepEqual(call("grep -r foo").targets, ["."]);
  assert.deepEqual(call("grep -R foo").targets, ["."]);
});

// --- Criteria 3, 5, 6, 7, 8, 9, 10, 11: nothing outside the grammar is claimed ---------------------------------------

for (const row of DENY_ROWS) {
  test(`RO-deny [${row.group}]: ${JSON.stringify(row.command)} never resolves to a clean read or list`, () => {
    const r = call(row.command);
    assert.equal(isCleanReadOrList(r), false, `resolved clean: ${JSON.stringify(r)}`);
    assert.ok(r.unresolved.length > 0, `must carry an unresolved cause: ${JSON.stringify(r)}`);
  });
}

test("RO-wrappers-unresolved: every ruling and catalog wrapper name in front of a table command is unresolved as a whole", () => {
  const names = [...new Set([...RULING_WRAPPER_NAMES, ...WRAPPER_BINARY_NAMES])];
  for (const w of names) {
    for (const cmd of [`${w} ls`, `${w} cat README.md`, `${w} -c 'ls'`, `${w} -c "cat README.md"`]) {
      assert.equal(isCleanReadOrList(call(cmd)), false, cmd);
    }
  }
});

test("RO-wrapper-inner-read-not-deferred: a wrapper's inner read is never resolved (not even as a deferred record)", () => {
  for (const cmd of ["bash -c 'cat README.md'", "sh -c 'ls -la'", "env ls", "nohup cat README.md", "eval 'ls'"]) {
    const r = call(cmd);
    assert.equal(isCleanReadOrList(r), false, cmd);
  }
});

test("RO-directory-flag-preempts: -d and -C (all four spellings) stay unresolved because the directory-flag gate runs before E0", () => {
  for (const cmd of ["ls -d", "ls -d x", "ls -d=x", "grep -C 3 p README.md", "grep -C=3 p README.md", "ls --directory x", "ls --directory=x"]) {
    const r = call(cmd);
    assert.ok(r.unresolved.some((u) => u.includes("directory flag")), `${cmd}: ${JSON.stringify(r.unresolved)}`);
  }
});

test("RO-git-family-unresolved / RO-rg-family-unresolved: git and rg are out until #409 seals the config and env levers", () => {
  for (const cmd of ["git status", "git log", "git log -p", "git diff", "git show", "rg p", "rg --pre cat p", "rg -z p"]) {
    assert.equal(isCleanReadOrList(call(cmd)), false, cmd);
  }
});

test("RO-out-of-set-unresolved: find, sed, awk and friends are not claimed", () => {
  for (const cmd of ["find . -name x", "sed -n 1p f", "awk 1 f", "less f", "echo hi", "pwd"]) assert.equal(isCleanReadOrList(call(cmd)), false, cmd);
});

// --- Criterion 4: the #82 multi-target cap stays -----------------------------------------------------------------------

test("RO-multitarget-read-no-bundling (normalizer layer, #410): two or more path operands are unresolved with the Issue #82 message and no multi-target record", () => {
  for (const cmd of ["cat docs/a.md /etc/shadow", "grep p a b", "ls a b", "head -n 1 a b", "wc -l a b"]) {
    const r = call(cmd);
    assert.ok(r.targets.length < 2, `${cmd}: ${JSON.stringify(r.targets)}`);
    assert.ok(r.unresolved.some((u) => u.includes("Issue #82")), `${cmd}: ${JSON.stringify(r.unresolved)}`);
  }
});

test("RO-multitarget-read-no-bundling (kernel layer, #410): a read ALLOW scoped to one filesystem path does not authorize the unlisted second operand", () => {
  const rule: Rule = { id: "allow-read-docs-ok", effect: "allow", verbs: ["read"], targets: ["docs/ok.md"] };
  const world = { rules: { version: "0.0.0-test", rules: [rule] }, defaultOutcome: "deny" as const };
  assert.equal(decide(world, call("cat docs/ok.md")).outcome, "allow", "control: the single listed operand is allowed by the scoped rule");
  const bundled = decide(world, call("cat docs/ok.md /etc/shadow"));
  assert.notEqual(bundled.outcome, "allow", `bundled operand must not be authorized: ${JSON.stringify(bundled)}`);
});

test("RO-one-target-only: no accept or deny row ever yields a record with two or more targets", () => {
  for (const c of [...ACCEPT_ROWS.map((r) => r.command), ...DENY_ROWS.map((r) => r.command)]) {
    assert.ok(call(c).targets.length < 2, c);
  }
});

// --- Criterion 8 / F8: redirect-decorated reads keep exactly the F8 record ---------------------------------------------

test("RO-f8-redirect-record-unchanged: a redirect-decorated read stays a write record with the F8 cause (E0 never claims a redirect)", () => {
  const r = call("cat a > f");
  assert.deepEqual(r.verbs, ["write"]);
  assert.deepEqual(r.targets, ["f"]);
  assert.ok(r.unresolved.some((u) => u.includes("F8")));
});

// --- Criterion 9: target identity (challenge A3) -----------------------------------------------------------------------

test("RO-target-canonical-form-pinned: the recorded target is the canonical form of the bare operand; quoted spellings are refused", () => {
  assert.deepEqual(call("cat ./x").targets, ["x"]);
  assert.deepEqual(call("cat a/../b").targets, ["b"]);
  assert.deepEqual(call("cat Docs/README.md").targets, ["docs/readme.md"]);
  assert.deepEqual(call("cat ./.thoth/policy.json").targets, [".thoth/policy.json"]);
  for (const cmd of ["cat 'x'", 'cat "x"', 'cat a"b"c', String.raw`cat a\b`]) assert.equal(isCleanReadOrList(call(cmd)), false, cmd);
});

// --- Criterion 10: grep pattern slot (challenge A4) --------------------------------------------------------------------

test("RO-grep-pattern-metachar-decision: single-quoted and bare patterns resolve; unquoted or double-quoted metacharacters do not; the pattern is not a target", () => {
  for (const cmd of ["grep '[0-9]' f", "grep 'a.*b' f", "grep -e 'x|y' f", "grep foo f", "grep 'two words' f"]) {
    const r = call(cmd);
    assert.equal(isCleanReadOrList(r), true, cmd);
    assert.deepEqual(r.targets, ["f"], `${cmd}: the pattern must not become a target`);
  }
  for (const cmd of ["grep * f", "grep [0-9] f", 'grep "$x" f', 'grep "a.*b" f', "grep '-x' f", "grep -f p f"]) assert.equal(isCleanReadOrList(call(cmd)), false, cmd);
});

// --- Criterion 11: integer values --------------------------------------------------------------------------------------

test("RO-int-cap: integer flag values are 1 to 6 digits", () => {
  assert.equal(isCleanReadOrList(call("head -n 999999 f")), true);
  assert.equal(isCleanReadOrList(call("head -n 9999999 f")), false);
  assert.equal(isCleanReadOrList(call("head -n 0 f")), true);
});

// --- Linearity: a huge operand and a huge token count stay unresolved without hanging --------------------------------

test("RO-B22-length: a 100 KB operand and 10k tokens are unresolved (no clean read), and return", () => {
  assert.equal(isCleanReadOrList(call(`cat ${"a".repeat(100_000)}`)), false);
  assert.equal(isCleanReadOrList(call(`cat ${Array.from({ length: 10_000 }, () => "a").join(" ")}`)), false);
});
