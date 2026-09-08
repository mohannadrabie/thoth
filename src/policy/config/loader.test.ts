import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { loadEffectivePolicy } from "./loader.ts";
import type { CentralPolicySource, CentralPolicyResult } from "./central-source.ts";

function withTempDir(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "thoth-s6-loader-test-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeRuleSetFile(path: string, ruleSetObj: unknown): void {
  writeFileSync(path, JSON.stringify(ruleSetObj, null, 2), "utf8");
}

function centralSourceReturning(result: CentralPolicyResult): CentralPolicySource {
  return { read: () => result };
}

function centralSourceThrowing(message: string): CentralPolicySource {
  return {
    read: () => {
      throw new Error(message);
    },
  };
}

// --- AC5a: central absent/unsupported -- zero contribution, NOT a rejection ----------------------

test("AC5a: central channel ABSENT -- contributes zero rules, load succeeds, shipped+project resolve normally", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [{ id: "shipped-a", effect: "deny" }] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [{ id: "project-a", effect: "allow" }] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.centralStatus, "absent");
      assert.deepEqual(
        result.merged.rules.map((r) => r.id),
        ["shipped-a", "project-a"],
      );
    }
  });
});

test("AC5a: central channel UNSUPPORTED -- same non-rejecting behavior as absent, but a distinguishable status", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "unsupported" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.centralStatus, "unsupported");
  });
});

// --- AC5b: central present but malformed (two distinct sub-shapes, same fail-closed KIND) ---------

test("AC5b: central present, syntactically INVALID JSON -- whole load rejected, reasonKind=json-parse-error, never falls through to absent", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "present", raw: "{ not valid json", channel: "test:chan" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "json-parse-error");
      assert.equal(result.centralStatus, "present");
      assert.equal(result.centralChannel, "test:chan");
    }
  });
});

test("AC5b: central present, syntactically VALID JSON but fails schema validation -- whole load rejected, reasonKind=schema-invalid, SAME kind of outcome as the parse-error case (structurally identical in kind)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({
        status: "present",
        raw: JSON.stringify({ version: "1.0.0", rules: [{ id: "x", effect: "MAYBE" }] }),
        channel: "test:chan",
      }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "schema-invalid");
      // Both AC5b sub-shapes are "structurally identical in kind" -- same top-level result shape
      // (ok:false, a message, a reasonKind), never a different-shaped outcome for one vs. the other.
      assert.equal(typeof result.message, "string");
    }
  });
});

// --- AC5c: centralSource.read() itself throws ------------------------------------------------------

test("AC5c: centralSource.read() itself THROWS -- whole load rejected, reasonKind=read-error, centralStatus is UNKNOWABLE (never guessed at)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceThrowing("simulated subprocess timeout"),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "read-error");
      assert.equal(result.centralStatus, undefined, "a read-error means the status was never actually learned");
      assert.match(result.message, /simulated subprocess timeout/);
    }
  });
});

// --- table test: all four failure/non-failure states are distinguishable, none collapses into absent

test("table: absent, unsupported, present-valid succeed; malformed-json, schema-invalid, read-error all fail-closed -- none of the three failure shapes collapses into the non-rejecting bucket", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const cases: { label: string; source: CentralPolicySource; expectOk: boolean }[] = [
      { label: "absent", source: centralSourceReturning({ status: "absent" }), expectOk: true },
      { label: "unsupported", source: centralSourceReturning({ status: "unsupported" }), expectOk: true },
      { label: "present-valid", source: centralSourceReturning({ status: "present", raw: '{"version":"1.0.0","rules":[]}', channel: "c" }), expectOk: true },
      { label: "malformed-json", source: centralSourceReturning({ status: "present", raw: "{ bad", channel: "c" }), expectOk: false },
      {
        label: "schema-invalid",
        source: centralSourceReturning({ status: "present", raw: JSON.stringify({ version: "1.0.0", rules: [{ id: "x", effect: "MAYBE" }] }), channel: "c" }),
        expectOk: false,
      },
      { label: "read-error", source: centralSourceThrowing("boom"), expectOk: false },
    ];

    for (const c of cases) {
      const result = loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource: c.source });
      assert.equal(result.ok, c.expectOk, `case "${c.label}": expected ok=${c.expectOk}, got ok=${result.ok}`);
    }
  });
});

// --- AC1/AC9/Issue #108: mandatory-lock violation voids ONLY the offending layer, not the load ----

test("Issue #108: a project layer redefining a mandatory central id voids ONLY the project layer — the load still SUCCEEDS, shipped-defaults+central still resolve, and voidedLayers names the offender", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [{ id: "shipped-baseline", effect: "deny" }] });
    writeRuleSetFile(projectPath, {
      version: "1.0.0",
      rules: [
        { id: "central-mandatory-id", effect: "allow" },
        { id: "project-only-valid", effect: "allow" },
      ],
    });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({
        status: "present",
        raw: JSON.stringify({ version: "1.0.0", rules: [{ id: "central-mandatory-id", effect: "deny", mandatory: true }] }),
        channel: "test:chan",
      }),
    });

    assert.equal(result.ok, true, "the whole load must SUCCEED -- only the offending layer is voided");
    if (result.ok) {
      assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: "central-mandatory-id" }]);
      assert.equal(result.centralStatus, "present");
      const ids = result.merged.rules.map((r) => r.id).sort();
      assert.deepEqual(ids, ["central-mandatory-id", "shipped-baseline"].sort(), "project's ENTIRE contribution (including the otherwise-valid project-only-valid rule) is dropped, but shipped-defaults+central still resolve");
      const mandatory = result.merged.rules.find((r) => r.id === "central-mandatory-id");
      assert.equal(mandatory?.effect, "deny", "central's mandatory definition wins, not project's voided attempt");
      assert.equal(mandatory?.sourceLayer, "central");
    }
  });
});

// --- AC2: single-read invariant ---------------------------------------------------------------------

test("AC2 (design-challenger Attack F): centralSource.read() is called EXACTLY ONCE per invocation, and that ONE returned value feeds BOTH the merge and the pin", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    let callCount = 0;
    const FIRST_RAW = '{"version":"1.0.0","rules":[{"id":"first-read","effect":"deny"}]}';
    const SECOND_RAW = '{"version":"1.0.0","rules":[{"id":"SECOND-read-must-never-be-used","effect":"deny"}]}';
    const responses: CentralPolicyResult[] = [
      { status: "present", raw: FIRST_RAW, channel: "c" },
      { status: "present", raw: SECOND_RAW, channel: "c" },
    ];
    const source: CentralPolicySource = {
      read: () => {
        const r = responses[callCount];
        callCount++;
        if (!r) throw new Error("read() called more times than this test expected");
        return r;
      },
    };

    const first = loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource: source });

    assert.equal(callCount, 1, "loadEffectivePolicy must call centralSource.read() exactly once per invocation");
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.deepEqual(
        first.merged.rules.map((r) => r.id),
        ["first-read"],
        "the merge must reflect the ONE value read, not a later/different read",
      );
      // Recompute what the pin WOULD be over the first response's raw bytes, and confirm it
      // matches -- proving the pin was computed from the SAME single read, not a second one.
      const rehash = createHash("sha256").update(FIRST_RAW, "utf8").digest("hex");
      assert.equal(first.pin.digest, rehash);
    }
  });
});

// --- AC6: real three-tier files, end-to-end -------------------------------------------------------

test("AC6: real shipped-defaults.json + real project.json files + injected fixture central resolve end-to-end", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [{ id: "baseline", effect: "deny", mandatory: true }] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [{ id: "project-only", effect: "allow" }] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "present", raw: '{"version":"1.0.0","rules":[{"id":"central-only","effect":"deny"}]}', channel: "c" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.merged.rules.map((r) => r.id),
        ["baseline", "central-only", "project-only"],
      );
      const baseline = result.merged.rules.find((r) => r.id === "baseline");
      assert.equal(baseline?.mandatory, true);
    }
  });
});
