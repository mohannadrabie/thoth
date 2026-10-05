// #308 story F round 2 (Issue #420): F9b and F10. written FAILING FIRST.
//   F9b  the wrapper dispatch applies the same bare, lowercase RAW first-token check as F9. A path-qualified, upper-case
//        or .exe spelling of a wrapper binary (sh, bash, env, exec, eval, nohup, ... derived from the wrapper table, not
//        typed) is unresolved: the OS would run the planted file, not the real wrapper. The command nested inside a
//        recognized wrapper gets the same check.
//   F10  the kubectl shape resolves only when every flag is in the closed set the grammar reads for its decision
//        (KUBECTL_GRAMMAR_FLAGS). --kubeconfig, --server, --token, --as, --insecure-skip-tls-verify and any unknown
//        flag, in equals form, space form or bare, are unresolved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./registry.ts";
import { KUBECTL_GRAMMAR_FLAGS } from "./shell.ts";
import { WRAPPER_BINARY_NAMES } from "./wrapper-catalog.ts";
import { decide } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";

const ALLOW = { rules: { version: "0.0.0-test", rules: [] }, defaultOutcome: "allow" as const };
const rec = (command: string): ActionRecord => normalize("shell", { command, environment: "e", identity: "i", deferred: false });
const INNER = "kubectl get pods/x --context=c";
const clean = (r: ActionRecord): boolean => r.unresolved.length === 0;
const shapes = (name: string): string[] => [`${name} ${INNER}`, `${name} -c "${INNER}"`, `${name} "${INNER}"`, `${name} ${INNER} &`];
const NAMES = WRAPPER_BINARY_NAMES.filter((n) => /^[a-z]+$/.test(n));

test("F9b-derived: the wrapper names come from the wrapper table, and at least the shells, env, exec, eval and nohup resolve cleanly when bare (the corpus is not vacuous)", () => {
  const resolvingBare = NAMES.filter((n) => shapes(n).some((c) => clean(rec(c))));
  console.log(`F9b: ${String(NAMES.length)} derived wrapper names; bare spelling resolves for ${resolvingBare.join(",")}`);
  for (const must of ["sh", "bash", "env", "exec", "eval", "nohup"]) assert.ok(resolvingBare.includes(must), `${must} resolves when bare`);
});

test("F9b-corpus: every derived wrapper name spelled path-qualified, upper-case or with .exe is unresolved and denied, in every shape", () => {
  const problems: string[] = [];
  let n = 0;
  for (const name of NAMES) {
    const spellings = [`./scratch/${name}`, `/tmp/${name}`, `../${name}`, name.toUpperCase(), `${name[0]!.toUpperCase()}${name.slice(1)}`, `${name}.exe`];
    for (const sp of spellings) {
      for (const c of shapes(sp)) {
        n += 1;
        const r = rec(c);
        if (clean(r) || decide(ALLOW, r).outcome !== "deny") problems.push(c);
      }
    }
  }
  console.log(`F9b-corpus: ${String(n)} commands`);
  assert.deepEqual(problems, []);
});

test("F9b-nested: a non-recognized binary nested inside a bare wrapper is unresolved; a recognized one is unchanged", () => {
  for (const c of [`sh -c "node get pods/x --context=c"`, `sh -c "./scratch/sh -c '${INNER}'"`, `env node get pods/x --context=c`, `bash -c "env ./x/kubectl get pods/x --context=c"`]) {
    const r = rec(c);
    assert.ok(!clean(r) && decide(ALLOW, r).outcome === "deny", c);
  }
  for (const c of [`sh -c "${INNER}"`, `env ${INNER}`]) assert.ok(clean(rec(c)), `control: ${c}`);
});

test("F10-corpus: any flag outside the closed set makes the kubectl shape unresolved; the grammar's own flag still resolves", () => {
  assert.ok(KUBECTL_GRAMMAR_FLAGS.size > 0);
  const extras = [
    "--kubeconfig=./evil", "--kubeconfig ./evil", "--server=http://x", "--server http://x", "--token=t", "--as=root", "--as root",
    "--insecure-skip-tls-verify", "--insecure-skip-tls-verify=true", "-n=ns", "-n ns", "-s=x", "--unknown-flag=1", "--unknown-flag", "-x",
    "--kubeconfig=./evil/", "--cluster=c2", "--user=u",
  ];
  const problems: string[] = [];
  for (const e of extras) {
    const r = rec(`${INNER} ${e}`);
    const r2 = rec(`kubectl ${e} get pods/x --context=c`);
    if (clean(r) || decide(ALLOW, r).outcome !== "deny") problems.push(`after: ${e}`);
    if (clean(r2) || decide(ALLOW, r2).outcome !== "deny") problems.push(`before: ${e}`);
  }
  assert.deepEqual(problems, []);
  for (const f of KUBECTL_GRAMMAR_FLAGS) assert.ok(clean(rec(`kubectl get pods/x --${f}=c`)), `${f} resolves`);
  assert.ok(clean(rec("kubectl get pods/x -c=c")), "the one documented short alias still resolves");
});
