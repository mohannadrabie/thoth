// #308 story F round 3: the Manager's probe table (docs/reviews/s308-F-manager-probe-round3-2026-10-05.md, run at 695d3f1
// as a substitute for a red-team pass that a safety classifier stopped twice) as named hook-level tests, so any later
// reviewer can re-check it mechanically. Each row is one command string fed to the REAL copied hook through the
// registry-pinned copy-tree sandbox (hooks/test-support/gate-sandbox.ts), with the outcome the table records:
//   deny  = exit 0 plus an explicit deny JSON from the kernel (strict helper; a crash or exit 2 is not a deny);
//   allow = exit 0 with empty stdout and empty stderr.
// The sandbox writes EMPTY shipped-defaults and project policy and default allow, so every outcome below comes from the
// normalizer and POL-05 (an unresolved record), not from a shipped rule; the shipped deny rules are covered by
// src/policy/config/activation-preconditions.test.ts. Expected counts are asserted (29 deny, 5 allow, 34 rows) and
// printed. The five allows are each judged in the report (bare known wrapper plus bare kubectl; the last --context wins in
// both the record and kubectl; kubectl has no @-file expansion; the plain control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateSandbox, describeRun, isSilentAllow, wasPolicyDenied, type GateSandbox } from "./test-support/gate-sandbox.ts";

type Expect = "allow" | "deny";
const RAW = String.raw`deny   sh -c 'sh -c "./k get pods/x --context=c"'
deny   bash -c "env ./k get pods/x --context=c"
deny   env -S "./k get pods/x --context=c"
deny   env -- ./k get pods/x --context=c
deny   exec -a n ./k get pods/x --context=c
deny   nohup ./k get pods/x --context=c
deny   eval "./k get pods/x --context=c"
deny   command -p ./k get pods/x --context=c
deny   xargs ./k get pods/x --context=c
deny   time ./k get pods/x --context=c
deny   timeout 5 ./k get pods/x --context=c
deny   nice ./k get pods/x --context=c
deny   stdbuf -o0 ./k get pods/x --context=c
deny   sudo kubectl get pods/x --context=c
deny   doas kubectl get pods/x --context=c
deny   xargs kubectl get pods/x --context=c
deny   timeout 5 kubectl get pods/x --context=c
deny   nice kubectl get pods/x --context=c
allow  env kubectl get pods/x --context=c
deny   nohup kubectl get pods/x --context=c
allow  sh -c 'sh -c "kubectl get pods/x --context=c"'
deny   kubectl get pods/x -ctx
deny   kubectl get pods/x -c ctx
deny   kubectl get pods/x -n ns --context=c
deny   kubectl get pods/x --namespace ns --context=c
deny   kubectl get pods/x --context=c -- --kubeconfig=x
allow  kubectl get pods/x --context=a --context=b
deny   kubectl get pods/x --context=./file
deny   kubectl get pods/x --context=http://x
deny   KUBECONFIG=./x kubectl get pods/x --context=c
allow  kubectl get pods/x --context=c @args.txt
deny   kubectl get -f x.yaml --context=c
deny   kubectl get pods/x --context=c -o jsonpath={.a}
allow  kubectl get pods/x --context=c`;

const ROWS: { n: number; expect: Expect; command: string }[] = RAW.split("\n").map((line, i) => {
  const m = /^(allow|deny)\s+(.*)$/.exec(line);
  assert.ok(m, `row ${String(i + 1)} parses`);
  return { n: i + 1, expect: m[1] as Expect, command: m[2]! };
});

test("F-R3-probe-table-shape: 34 rows, 29 deny and 5 allow, as recorded in the Manager's probe report", () => {
  const deny = ROWS.filter((r) => r.expect === "deny").length;
  const allow = ROWS.filter((r) => r.expect === "allow").length;
  console.log(`F-R3: ${String(ROWS.length)} rows, ${String(deny)} deny, ${String(allow)} allow`);
  assert.deepEqual([ROWS.length, deny, allow], [34, 29, 5]);
});

let sandbox: GateSandbox | undefined;
const sb = (): GateSandbox => (sandbox ??= createGateSandbox());

for (const row of ROWS) {
  test(`F-R3-probe-${String(row.n).padStart(2, "0")} ${row.expect}: ${row.command}`, () => {
    const run = sb().bash(row.command);
    if (row.expect === "deny") assert.ok(wasPolicyDenied(run), `expected a kernel deny; ${describeRun(run)}`);
    else assert.ok(isSilentAllow(run), `expected a silent allow; ${describeRun(run)}`);
  });
}

test("F-R3-last-context-wins: the record for repeated --context keeps the LAST value (the probe table's allow row 27 relies on it)", async () => {
  const { normalizeShellCall } = await import("../src/policy/normalizer/shell.ts");
  const r = normalizeShellCall({ command: "kubectl get pods/x --context=dev --context=prod", environment: "e", identity: "i" });
  assert.equal(r.unresolved.length, 0);
  assert.deepEqual(r.targets, ["e/cluster/prod/pods/x"]);
});
