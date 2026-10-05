// #308 story F8 (Issue #411, decisions row 2026-10-04): a redirect never replaces the command it decorates.
// `<cmd> > path` (and >>, 2>, &>, fd forms) resolves only if `<cmd>` resolves on its own; otherwise POL-05
// denies. The record STILL carries verbs [write] and the (canonical) redirect target, so a deny rule keyed on
// a protected path sees it. story-implementer's own tests, written FAILING FIRST (plan section 7).
// `echo x > file` becomes denied too: accepted and disclosed; a producer command set is E0 (#408) work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./registry.ts";
import "./shell.ts";
import { decide } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";

function rec(command: string): ActionRecord {
  return normalize("shell", { command, environment: "e", identity: "i", deferred: false });
}
const ALLOW = { rules: { version: "0.0.0-test", rules: [] }, defaultOutcome: "allow" as const };

const CORPUS = [
  "rm -rf hooks > /dev/null",
  'python -c "print(1)" > /dev/null',
  'node -e "1" > out.txt',
  "sed -i s/a/b/ f > x",
  "git checkout -- .thoth/policy.json >/dev/null",
  "echo x > file",
  "echo x >> file",
  "echo x 2> file",
  "echo x &> file",
  "echo x 1> file",
  "cat <<EOF > file\nbody\nEOF",
];

test("F8-corpus: every redirect-decorated unresolvable command is denied at default allow (POL-05), none resolves clean", () => {
  const problems: string[] = [];
  for (const c of CORPUS) {
    const r = rec(c);
    const v = decide(ALLOW, r);
    if (v.outcome !== "deny") problems.push(`${JSON.stringify(c)} -> ${v.outcome}; record ${JSON.stringify(r)}`);
    if (r.unresolved.length === 0) problems.push(`${JSON.stringify(c)}: unresolved is empty`);
  }
  assert.deepEqual(problems, []);
  console.log(`F8-corpus: ${String(CORPUS.length)} commands`);
});

test("F8-target-kept: the denied record still says verb write and carries the redirect target, so a path deny rule sees it", () => {
  for (const c of ["rm -rf hooks > out.txt", "echo x >> out.txt", "python -c 1 > out.txt"]) {
    const r = rec(c);
    assert.deepEqual(r.verbs, ["write"], c);
    assert.deepEqual(r.targets, ["out.txt"], c);
  }
});

test("F8-controls: a command that resolves on its own is unchanged; a redirect-free unresolvable command stays denied; a single-fd dup is not a file target", () => {
  const ok = rec("kubectl get pods/x --context=c");
  assert.equal(ok.unresolved.length, 0);
  assert.equal(decide(ALLOW, ok).outcome, "allow");
  assert.equal(decide(ALLOW, rec("rm -rf hooks")).outcome, "deny");
});
