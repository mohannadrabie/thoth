import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithIsolationMonitor, summarize } from "./fixture-isolation-check.ts";

test("QA-05: 0 live roots configured -> vacuous pass, disclosed", () => {
  const result = summarize([], []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-05: violations present -> FAIL naming the root and the changed paths", () => {
  const result = summarize(
    ["/fake/live/root"],
    [{ liveRoot: "/fake/live/root", changedPaths: ["evil.txt"] }],
  );
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /evil\.txt/);
});

test("QA-05 (AC10): a well-behaved fixture that only writes into its own sandbox is NOT flagged", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa05-good-"));
  const live = join(root, "live-governance-artifacts");
  const sandbox = join(root, "sandbox");
  await mkdir(live, { recursive: true });
  await mkdir(sandbox, { recursive: true });
  try {
    const violations = await runWithIsolationMonitor([live], async () => {
      // A correctly-isolated fixture: writes only inside its own sandbox.
      await writeFile(join(sandbox, "output.json"), JSON.stringify({ ok: true }));
    });
    assert.deepEqual(violations, [], "a fixture that stays inside its sandbox must not be flagged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("QA-05 (AC10): a deliberately-broken fixture that writes into a live governance path IS caught", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa05-broken-"));
  const live = join(root, "live-governance-artifacts");
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "real-policy.json"), JSON.stringify({ id: "POL-REAL" }));
  try {
    // The deliberately-broken fixture: a test fixture that (incorrectly) writes straight into a
    // live governance path instead of its own sandbox — exactly the QA-05 violation this
    // instrument exists to catch.
    const brokenFixture = async () => {
      await writeFile(join(live, "real-policy.json"), JSON.stringify({ id: "POL-REAL", tampered: true }));
    };

    const violations = await runWithIsolationMonitor([live], brokenFixture);

    assert.equal(violations.length, 1, "the isolation monitor must catch the live-path write");
    assert.equal(violations[0]?.liveRoot, live);
    assert.deepEqual(violations[0]?.changedPaths, ["real-policy.json"]);

    const result = summarize([live], violations);
    assert.equal(result.ok, false, "a caught violation must fail the gate, not just be logged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
