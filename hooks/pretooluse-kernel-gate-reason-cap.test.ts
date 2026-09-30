// End-to-end proof for Issue #326: the POL-05 deny reason reflected untrusted command text
// unbounded (about 32 KB out for 16 KB in, about 1 MB for 524 KB in). The reflected text is now
// capped per unresolved entry in src/policy/kernel/kernel.ts (pol05Rule) with a visible marker.
// These tests run the REAL shipped hook through the registry-pinned copy-tree sandbox (same
// pattern as pretooluse-kernel-gate-sanitize.test.ts) and pin the maximum stdout size.
//
// story-implementer's own tests, written FIRST (red) per the approved Phase 1 plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateSandbox, denyReason, describeRun, wasPolicyDenied, type GateRun } from "./test-support/gate-sandbox.ts";

// Pinned maximum hook stdout, in bytes, for a POL-05 deny of ANY input size.
// Derivation (measured, spike rule 17): BEFORE the fix, stdout was 14294 bytes for a 15 KB span,
// 449654 for 487 KB, 54869 for the 64 KB escape-heavy case, 22298 for a two-entry 31 KB case
// (linear in input). AFTER the fix each reflected entry is at most 512 UTF-16 units plus the marker
// (about 40); the terminal sanitizer strips control bytes first, so the worst JSON expansion left
// is a 3-byte BMP character (3x) or a quote/backslash (2x): about 1.7 KB per entry, two entries
// (verb, resource) plus fixed text and JSON framing. 4096 bytes bounds that with headroom.
const MAX_STDOUT = 4096;

function assertDenied(run: GateRun, what: string): void {
  assert.ok(wasPolicyDenied(run), `${what}: expected a strict policy DENY; got ${describeRun(run)}`);
}

function stdoutBytes(run: GateRun): number {
  return Buffer.byteLength(run.stdout, "utf8");
}

const spanOf = (chars: number): string => `'${"line of text\n".repeat(Math.ceil(chars / 14)).slice(0, chars)}'`;

test("AC-326-1: 16 KB newline-span deny is bounded, valid JSON, deny", () => {
  const sb = createGateSandbox();
  const run = sb.bash(`kubectl ${spanOf(16 * 1024)}`);
  assert.equal(run.code, 0, `exit 0 expected; got ${describeRun(run)}`);
  assertDenied(run, "16 KB span");
  JSON.parse(run.stdout);
  assert.equal(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.ok(stdoutBytes(run) < MAX_STDOUT, `stdout ${stdoutBytes(run)} bytes must be under ${MAX_STDOUT}`);
});

test("AC-326-2: 524 KB input yields stdout within a constant of the 16 KB case", () => {
  const sb = createGateSandbox();
  const small = sb.bash(`kubectl ${spanOf(16 * 1024)}`);
  const big = sb.bash(`kubectl ${spanOf(524 * 1024)}`);
  assertDenied(big, "524 KB span");
  assert.ok(stdoutBytes(big) < MAX_STDOUT, `stdout ${stdoutBytes(big)} bytes must be under ${MAX_STDOUT}`);
  assert.ok(
    Math.abs(stdoutBytes(big) - stdoutBytes(small)) < 256,
    `stdout must not grow with input size: 16 KB -> ${stdoutBytes(small)}, 524 KB -> ${stdoutBytes(big)}`,
  );
});

test("AC-326-3: maximal-expansion input stays under the pinned max stdout", () => {
  const sb = createGateSandbox();
  // Control characters (6 bytes each once JSON-escaped) plus quotes/backslashes inside a newline span.
  const nasty = "\u0001\u0002\u001f\"\\€\n";
  const cmd = `'${nasty.repeat(Math.ceil((64 * 1024) / nasty.length))}'`;
  const run = sb.bash(`kubectl ${cmd}`);
  assertDenied(run, "escape-heavy span");
  assert.ok(stdoutBytes(run) < MAX_STDOUT, `escape-heavy stdout ${stdoutBytes(run)} bytes must be under ${MAX_STDOUT}`);
  // Two reflected entries at once (bad verb AND a malformed 3-segment resource token), both huge.
  const two = sb.bash(`kubectl ${cmd} 'a/b/${nasty.repeat(4000)}'`);
  assertDenied(two, "two-entry escape-heavy span");
  assert.ok(stdoutBytes(two) < MAX_STDOUT, `two-entry stdout ${stdoutBytes(two)} bytes must be under ${MAX_STDOUT}`);
});

test("AC-326-5: never blank, never allow, at 1 / 16K / 524K", () => {
  for (const size of [1, 16 * 1024, 524 * 1024]) {
    const sb = createGateSandbox();
    const run = sb.bash(`kubectl ${spanOf(size)}`);
    assert.equal(run.code, 0, `size ${size}: ${describeRun(run)}`);
    assertDenied(run, `size ${size}`);
    assert.ok(denyReason(run).trim().length > 0, `size ${size}: reason must not be blank`);
  }
});

test("AC-326-4: the reason carries the marker with the true original length, through the real hook", () => {
  const sb = createGateSandbox();
  const run = sb.bash(`kubectl ${spanOf(16 * 1024)}`);
  assertDenied(run, "16 KB span");
  assert.match(denyReason(run), /\[truncated, \d+ characters in all\]/, "truncation must be visible");
});

test("AC-326-8: hostile bytes inside a capped span are still sanitized on real stdout", () => {
  const sb = createGateSandbox();
  const run = sb.bash(`kubectl '\u001b[31mFORGED\u0000\u009b[2J\n${"x".repeat(2000)}'`);
  assertDenied(run, "hostile capped span");
  const reason = denyReason(run);
  assert.ok(!reason.includes("\u001b"), "no raw ESC byte may reach stdout");
  assert.ok(!reason.includes("\u0000"), "no raw NUL byte may reach stdout");
  assert.ok(!reason.includes("\u009b"), "no raw CSI byte may reach stdout");
});
