// G22 (S7 fix-now, app-security finding 4, "AC-6b"): the hook's exit-2 stderr must not leak absolute
// paths or parser text. story-implementer's own test, written failing first; it uses the
// test-writer's sandbox helper WITHOUT editing it. The hook must stay non-empty on stderr (locked
// AC-6 needs that) but print only a fixed message plus the error NAME.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGateSandbox, describeRun } from "./test-support/gate-sandbox.ts";

function assertRedacted(run: { code: number | null; stdout: string; stderr: string }, root: string, what: string): void {
  assert.equal(run.code, 2, `${what}: expected exit 2; got ${describeRun(run)}`);
  assert.equal(run.stdout, "", `${what}: no stdout on exit 2`);
  assert.ok(run.stderr.trim().length > 0, `${what}: stderr must stay non-empty (the locked AC-6 needs a disclosed failure)`);
  assert.match(run.stderr, /internal exception, fail-closed \(exit 2\)/, `${what}: fixed message`);
  assert.ok(!/[\\/]/.test(run.stderr), `${what}: stderr must contain no path separator; got ${JSON.stringify(run.stderr)}`);
  assert.ok(!run.stderr.includes(root), `${what}: stderr must not carry the tree root`);
  assert.ok(!/\n\s+at /.test(run.stderr), `${what}: no stack frames`);
  assert.ok(!/Unexpected|Expected|position|JSON|token/i.test(run.stderr), `${what}: no parser text; got ${JSON.stringify(run.stderr)}`);
  assert.match(run.stderr, /(Error|SyntaxError|TypeError)\n$/, `${what}: ends with the error name only`);
}

test("G22: exit-2 stderr is a fixed message plus the error name: invalid JSON stdin, empty stdin, and a malformed classification fixture reached through an MCP call carry no path, no stack frame and no parser text", () => {
  const sb = createGateSandbox();
  assertRedacted(sb.run("{ this is not json at all"), sb.root, "invalid JSON stdin");
  assertRedacted(sb.run(""), sb.root, "empty stdin");
  fs.writeFileSync(sb.fixturePath, "{ \"version\": \"v\", CANARY-BROKEN-FIXTURE", "utf8");
  const run = sb.mcp("standin", "x");
  assertRedacted(run, sb.root, "malformed fixture through an MCP call");
  assert.ok(!run.stderr.includes("CANARY"), "the fixture's bytes never reach stderr");
});
