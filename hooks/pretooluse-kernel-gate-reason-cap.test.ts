// End-to-end proof for Issue #326: the POL-05 deny reason reflected untrusted command text
// unbounded (about 32 KB out for 16 KB in, about 1 MB for 524 KB in). The reflected text is now
// capped per unresolved entry in src/policy/kernel/kernel.ts (pol05Rule) with a visible marker.
// These tests run the REAL shipped hook through the registry-pinned copy-tree sandbox (same
// pattern as pretooluse-kernel-gate-sanitize.test.ts) and pin the maximum stdout size.
//
// story-implementer's own tests, written FIRST (red) per the approved Phase 1 plan.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createGateSandbox, denyReason, describeRun, wasPolicyDenied, type GateRun } from "./test-support/gate-sandbox.ts";

// Pinned maximum hook stdout, in bytes, for a POL-05 deny of ANY input size.
// Derivation (measured, spike rule 17): BEFORE the fix, stdout was 14294 bytes for a 15 KB span,
// 449654 for 487 KB, 54869 for the 64 KB escape-heavy case, 22298 for a two-entry 31 KB case
// (linear in input). AFTER the fix each reflected entry is at most 512 UTF-16 units plus the marker
// (about 45). The terminal sanitizer strips control bytes first, so the worst JSON expansion left is
// a LONE SURROGATE (JSON.stringify escapes each as a 6-byte \u-escape; a 3-byte BMP character stays
// 3 bytes, a quote/backslash 2x). Worst case: two entries (verb, resource) x (512 x 6 + 45) = 6234,
// plus about 700 bytes of fixed reason text and JSON framing = about 6.9 KB (measured 6254 for the
// two-entry lone-surrogate input). 7168 (7 KiB) bounds that with headroom and stays well under the
// runtime's documented 10,000-character hook-output cap. Tighter 3-byte bound: MAX_STDOUT_3BYTE below.
const MAX_STDOUT = 7168;

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


// ---- Round 2 (Issue #375): pin 512 itself, real worst cases, cap-constant parity ----
// Tighter bound for 3-byte BMP characters (raw in JSON, 3 B each): 2 entries x (512*3 + ~45 marker)
// = about 3.2 KB plus about 150 B envelope. A cap of 750 gives 4718 B, so 4096 kills it.
const MAX_STDOUT_3BYTE = 4096;
const EURO = "€";

test("AC-326-3b: two entries of ~64K 3-byte characters each stay under the 3-byte bound", () => {
  const sb = createGateSandbox();
  const big = EURO.repeat(64 * 1024);
  const run = sb.bash(`kubectl '${big}' 'a/b/${big}'`);
  assertDenied(run, "two-entry 3-byte span");
  assert.ok(stdoutBytes(run) < MAX_STDOUT_3BYTE, `stdout ${stdoutBytes(run)} bytes must be under ${MAX_STDOUT_3BYTE}`);
});

test("AC-326-4b: the reason never carries 513 consecutive original characters (pins cap at 512)", () => {
  const sb = createGateSandbox();
  const total = 64 * 1024;
  const run = sb.bash(`kubectl '${EURO.repeat(total)}'`);
  assertDenied(run, "3-byte span");
  const reason = denyReason(run);
  // The reflected entry is a short leading fragment, the span, then a trailing quote (past the cap).
  // The marker states the entry's true length N, so leading = N - total - 1, and exactly
  // 512 - leading euro characters must survive the cap.
  const marker = /\[truncated, (\d+) characters in all\]/.exec(reason);
  assert.ok(marker, "truncation marker must be present");
  const leading = Number(marker[1]) - total - 1;
  const longest = Math.max(...(reason.match(/€+/g) ?? [""]).map((r) => r.length));
  assert.equal(longest, 512 - leading, `exactly ${512 - leading} original characters must be reflected (cap 512); got ${longest}`);
  assert.ok(!reason.includes(EURO.repeat(513)), "513 consecutive original characters must not be reflected");
});

test("AC-326-3c: two entries of lone surrogates (6 B each once JSON-escaped) stay under MAX_STDOUT", () => {
  const sb = createGateSandbox();
  const lone = "\ud800".repeat(64 * 1024);
  const run = sb.bash(`kubectl '${lone}' 'a/b/${lone}'`);
  assertDenied(run, "two-entry lone-surrogate span");
  assert.ok(stdoutBytes(run) < MAX_STDOUT, `stdout ${stdoutBytes(run)} bytes must be under ${MAX_STDOUT}`);
});

test("AC-326-9: the two 512 cap constants (gate REASON_NAME_CAP, kernel UNRESOLVED_FRAGMENT_CAP) stay equal", () => {
  // Source-scrape: the kernel must keep zero imports (qa:kernel-purity), so neither value is exported.
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");
  const gate = /const REASON_NAME_CAP = (\d+);/.exec(read("../src/policy/gate/decide-tool-call.ts"));
  const kernel = /const UNRESOLVED_FRAGMENT_CAP = (\d+);/.exec(read("../src/policy/kernel/kernel.ts"));
  assert.ok(gate && kernel, "both cap constants must be found by the scrape");
  assert.equal(gate[1], kernel[1], "the two caps must be equal");
  assert.equal(Number(kernel[1]), 512);
});
