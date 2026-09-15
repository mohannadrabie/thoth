import { test } from "node:test";
import assert from "node:assert/strict";
import { realRunner } from "./exec.ts";

test("realRunner: exit code and stdout are surfaced for a passing command", async () => {
  const res = await realRunner("node", ["-e", "console.log('hi')"]);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /hi/);
});

test("realRunner: non-zero exit is surfaced, not thrown", async () => {
  const res = await realRunner("node", ["-e", "process.exit(3)"]);
  assert.equal(res.code, 3);
});

test("realRunner: strips NODE_TEST_CONTEXT so a nested `node --test` subprocess reports for real " +
  "(regression: without this, a nested run silently exits 0 with empty stdout when the caller " +
  "itself is running under node --test — see src/qa/mutation-harness.ts)", async () => {
  const res = await realRunner("node", ["-e", "console.log(process.env.NODE_TEST_CONTEXT ?? 'unset')"]);
  assert.equal(res.stdout.trim(), "unset");
});

test("realRunner: opts.env is merged OVER the real process.env for this one call only, never mutates the parent process's own env (Path B)", async () => {
  const before = process.env.THOTH_TEST_ENV_PROBE;
  const res = await realRunner("node", ["-e", "console.log(process.env.THOTH_TEST_ENV_PROBE)"], {
    env: { THOTH_TEST_ENV_PROBE: "injected-value" },
  });
  assert.equal(res.stdout.trim(), "injected-value", "the override must reach the subprocess");
  assert.equal(process.env.THOTH_TEST_ENV_PROBE, before, "the parent process's own env must be untouched");
});

test("realRunner: opts.env does not drop the rest of the inherited environment (e.g. PATH stays usable)", async () => {
  const res = await realRunner("node", ["-e", "console.log(typeof process.env.PATH)"], {
    env: { THOTH_TEST_ENV_PROBE: "x" },
  });
  assert.equal(res.stdout.trim(), "string", "an unrelated override must not wipe out the rest of process.env");
});
