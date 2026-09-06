import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWrapper } from "./wrapper-catalog.ts";
import { normalizeToolToken, stripHeredocBodies, tokenize } from "./shell-scanner.ts";

function detect(command: string) {
  const { liveText, bodies } = stripHeredocBodies(command);
  const tokens = tokenize(liveText);
  const toolToken = normalizeToolToken(tokens[0] ?? "");
  return detectWrapper(toolToken, tokens, liveText, bodies);
}

const INNER = "kubectl delete pod/payment-worker --context=prod-cluster";

// --- SUR-09: each of the 9 named wrappers -----------------------------------------------------

test("SUR-09 wrapper: 'bash -c <cmd>'", () => {
  const match = detect(`bash -c "${INNER}"`);
  assert.deepEqual(match, { id: "bash-sh-c", inner: INNER });
});

test("SUR-09 wrapper: 'sh -c <cmd>'", () => {
  const match = detect(`sh -c "${INNER}"`);
  assert.deepEqual(match, { id: "bash-sh-c", inner: INNER });
});

test("SUR-09 wrapper: 'eval <cmd>'", () => {
  const match = detect(`eval "${INNER}"`);
  assert.deepEqual(match, { id: "eval", inner: INNER });
});

test("SUR-09 wrapper: 'exec <cmd>'", () => {
  const match = detect(`exec ${INNER}`);
  assert.deepEqual(match, { id: "exec", inner: INNER });
});

test("SUR-09 wrapper: 'nohup <cmd> &'", () => {
  const match = detect(`nohup ${INNER} &`);
  assert.deepEqual(match, { id: "nohup-background", inner: INNER });
});

test("SUR-09 wrapper: 'source <file>' — recognized, but inner content is never statically available", () => {
  const match = detect("source ./script.sh");
  assert.deepEqual(match, { id: "source-dot", inner: undefined });
});

test("SUR-09 wrapper: '. <file>' (source's dot alias) — same as source", () => {
  const match = detect(". ./script.sh");
  assert.deepEqual(match, { id: "source-dot", inner: undefined });
});

test("SUR-09 wrapper: 'env <cmd>'", () => {
  const match = detect(`env ${INNER}`);
  assert.deepEqual(match, { id: "env", inner: INNER });
});

test("red-team, S4 Stage-3 review, Finding 4 (Issue #73): 'xargs <cmd>' is recognized as a wrapper, but its inner content is NEVER statically extractable", () => {
  // xargs appends additional arguments read from stdin at runtime — invisible to any static
  // parse. Resolving the visible prefix as if it were the complete command (S4's original
  // implementation) silently under-reported the true, stdin-extended argument list.
  const match = detect(`xargs ${INNER}`);
  assert.deepEqual(match, { id: "xargs", inner: undefined });
});

test("SUR-09 wrapper: 'at <time> <<EOF ... EOF' — inner extracted from the heredoc body", () => {
  const match = detect(`at now <<EOF\n${INNER}\nEOF`);
  assert.deepEqual(match, { id: "at", inner: INNER });
});

test("SUR-09 wrapper: 'at <time>' with no heredoc — recognized, nothing statically extractable", () => {
  const match = detect("at now");
  assert.deepEqual(match, { id: "at", inner: undefined });
});

test("SUR-09 wrapper: 'crontab -l' — recognized, schedule content is never statically available", () => {
  const match = detect("crontab -l");
  assert.deepEqual(match, { id: "crontab", inner: undefined });
});

// --- criterion 10: indirect-execution-shaped but not matching a recognized wrapper's sub-shape -

test("criterion 10: 'bash -x ...' (bash present, not -c shape) is 'unresolved-shaped'", () => {
  assert.equal(detect(`bash -x ${INNER}`), "unresolved-shaped");
});

test("criterion 10: bare 'nohup' with no trailing '&' is 'unresolved-shaped'", () => {
  assert.equal(detect(`nohup ${INNER}`), "unresolved-shaped");
});

test("criterion 10: bare 'eval' with nothing following is 'unresolved-shaped'", () => {
  assert.equal(detect("eval"), "unresolved-shaped");
});

test("criterion 10: 'env' followed by its own flag (-i) is out of bounded scope, 'unresolved-shaped'", () => {
  assert.equal(detect(`env -i ${INNER}`), "unresolved-shaped");
});

test("criterion 10: 'env' followed by a VAR=value assignment is out of bounded scope, 'unresolved-shaped'", () => {
  assert.equal(detect(`env FOO=bar ${INNER}`), "unresolved-shaped");
});

test("criterion 10: 'xargs' followed by its own flag (-n1) is out of bounded scope, 'unresolved-shaped'", () => {
  assert.equal(detect(`xargs -n1 ${INNER}`), "unresolved-shaped");
});

// --- no match at all ---------------------------------------------------------------------------

test("a non-wrapper tool (kubectl) is not detected as any wrapper", () => {
  assert.equal(detect(INNER), undefined);
});

// --- design-challenger S4 round-1 Finding #5: eval/bash -c inner re-quoting correctness --------

test("Finding #5: eval's extracted inner command has its outer quotes already stripped (ready to re-tokenize)", () => {
  const match = detect('eval "true ; rm -rf /tmp/x"');
  assert.deepEqual(match, { id: "eval", inner: "true ; rm -rf /tmp/x" });
});
