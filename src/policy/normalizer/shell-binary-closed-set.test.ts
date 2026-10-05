// #308 story F9 (Issue #420, HIGH): the kubectl-shaped resolver must not ignore the binary. The shape resolves only
// when the leading binary token is the bare, lowercase name of a member of RESOLVABLE_BINARIES; any other binary
// (including a path-qualified or upper-case spelling of a member, which can be a planted file) is unresolved, so
// POL-05 denies. written FAILING FIRST against the binary-blind resolver (demonstrated: `node get pods/x
// --context=c` was allowed and executed ./get).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./registry.ts";
import { RESOLVABLE_BINARIES } from "./shell.ts";
import { decide } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";

const ALLOW = { rules: { version: "0.0.0-test", rules: [] }, defaultOutcome: "allow" as const };
function rec(command: string): ActionRecord {
  return normalize("shell", { command, environment: "e", identity: "i", deferred: false });
}

const OTHER = ["rm", "cp", "node", "python", "sh", "curl", "deltool"];
const SPELLINGS_OF_MEMBER = (b: string): string[] => [`/usr/bin/${b}`, `./${b}`, `../${b}`, b.toUpperCase(), `${b[0]!.toUpperCase()}${b.slice(1)}`, `${b}.exe`];
const VERBS = ["get", "describe", "list"];

test("F9-corpus: every other binary with get|describe|list pods/x --context=c is denied at default allow, and the record is unresolved", () => {
  const problems: string[] = [];
  let n = 0;
  for (const b of OTHER) {
    for (const v of VERBS) {
      n += 1;
      const r = rec(`${b} ${v} pods/x --context=c`);
      if (decide(ALLOW, r).outcome !== "deny" || r.unresolved.length === 0) problems.push(`${b} ${v}: ${JSON.stringify(r)}`);
    }
  }
  console.log(`F9-corpus: ${String(n)} commands`);
  assert.deepEqual(problems, []);
});

test("F9-members: the closed set is non-empty; a member resolves when bare and lowercase (also quoted); a path-qualified, upper-case or extension spelling does not", () => {
  assert.ok(RESOLVABLE_BINARIES.size > 0);
  for (const b of RESOLVABLE_BINARIES) {
    for (const v of VERBS) {
      const ok = rec(`${b} ${v} pods/x --context=c`);
      assert.equal(ok.unresolved.length, 0, `${b} ${v}`);
      assert.equal(decide(ALLOW, ok).outcome, "allow");
      assert.equal(rec(`"${b}" ${v} pods/x --context=c`).unresolved.length, 0, "quoted spelling is the same bare token");
      for (const sp of SPELLINGS_OF_MEMBER(b)) {
        const r = rec(`${sp} ${v} pods/x --context=c`);
        assert.ok(r.unresolved.length > 0 && decide(ALLOW, r).outcome === "deny", `${sp} ${v}`);
      }
    }
  }
});
