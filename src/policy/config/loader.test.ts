import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEffectivePolicy } from "./loader.ts";
import { computePin } from "./pin.ts";
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
      assert.equal(result.failedLayer, "central", "Issue #108: a central-layer parse failure must name 'central' as the failed layer");
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
      assert.equal(result.failedLayer, "central", "Issue #108: a central-layer schema failure must name 'central' as the failed layer");
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
      assert.equal(result.failedLayer, "central", "Issue #108: centralSource.read() itself throwing must name 'central' as the failed layer");
    }
  });
});

// --- Stage-3 round-4 residual fix-now (2026-09-08), Issue #108 [MED] REOPENED, test-writer's ------
// amended/RED-CONFIRMED printer.test.ts (docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md):
// `failedLayer` names the layer that ACTUALLY failed on the shipped-defaults/project side too --
// previously untested at the loader level (only printer.test.ts's black-box fixtures exercised the
// real repro; these are story-implementer's own white-box unit tests for the same underlying fix).

test("Issue #108: shipped-defaults present but malformed JSON -- failedLayer='shipped-defaults', central's own (innocent) status is still reported, never lost", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeFileSync(shippedPath, "{ not valid json", "utf8");
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "json-parse-error");
      assert.equal(result.failedLayer, "shipped-defaults");
      assert.equal(result.centralStatus, "absent", "central's own status must still be reported even though a different layer is the true offender");
    }
  });
});

test("Issue #108: project present but fails schema validation -- failedLayer='project', central's own (present, valid) status is still reported, never lost", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeFileSync(projectPath, JSON.stringify({ version: "1.0.0", rules: [{ id: "x", effect: "MAYBE" }] }), "utf8");

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "present", raw: '{"version":"1.0.0","rules":[]}', channel: "c" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "schema-invalid");
      assert.equal(result.failedLayer, "project");
      assert.equal(result.centralStatus, "present");
      assert.equal(result.centralChannel, "c");
    }
  });
});

test("Issue #108: shipped-defaults file cannot be read at all (missing file) -- returns a typed LoadFailure with failedLayer='shipped-defaults' and reasonKind='read-error', NEVER throws (the readFileSync wrapping this round adds)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "does-not-exist-shipped.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "read-error");
      assert.equal(result.failedLayer, "shipped-defaults");
      assert.equal(result.centralStatus, "absent");
      assert.match(result.message, /does-not-exist-shipped\.json/);
    }
  });
});

test("Issue #108: project file cannot be read at all (missing file) -- returns a typed LoadFailure with failedLayer='project' and reasonKind='read-error', NEVER throws, central's own valid load is not blamed", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "does-not-exist-project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "present", raw: '{"version":"1.0.0","rules":[]}', channel: "c" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonKind, "read-error");
      assert.equal(result.failedLayer, "project");
      assert.equal(result.centralStatus, "present");
      assert.match(result.message, /does-not-exist-project\.json/);
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

// --- Stage-3 round-3 fix-now (2026-09-08), Issue #114 [HIGH]: trust-rank, not precedence order -----

test("Issue #114: a git-tracked shipped-defaults.json mandatory declaration can no longer void central end-to-end — red-team's round-2 exploit, closed", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, {
      version: "1.0.0",
      rules: [{ id: "central-deny-prod-exec", effect: "allow", mandatory: true }],
    });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({
        status: "present",
        raw: JSON.stringify({ version: "1.0.0", rules: [{ id: "central-deny-prod-exec", effect: "deny", mandatory: true }] }),
        channel: "test:chan",
      }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.voidedLayers, [], "shipped-defaults' mandatory declaration must have NO force over central -- the exact Issue #114 exploit, now closed");
      const winner = result.merged.rules.find((r) => r.id === "central-deny-prod-exec");
      assert.equal(winner?.effect, "deny", "central's own value must win -- the attacker's shipped-defaults 'allow' never takes effect");
      assert.equal(winner?.sourceLayer, "central");
      assert.deepEqual(result.inertMandatoryDeclarations, [{ layer: "shipped-defaults", ruleId: "central-deny-prod-exec" }]);
    }
  });
});

// --- Stage-3 round-3 fix-now (2026-09-08), Issue #115 [MED]: tokenizer/parser-agreement invariant --

test("Issue #115: a \\uXXXX-escaped duplicate top-level \"rules\" key is rejected end-to-end (whole load fails closed, reasonKind=schema-invalid)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    // Written directly (not via writeRuleSetFile/JSON.stringify, which can't produce a duplicate
    // key) so the raw text carries the escaped-duplicate shape red-team demonstrated.
    writeFileSync(
      projectPath,
      `{
  "version": "1.0.0",
  "rules": [ { "id": "decoy-allow", "effect": "allow" } ],
  "\\u0072ules": [ { "id": "real-deny", "effect": "deny" } ]
}`,
      "utf8",
    );

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, false, "the escaped duplicate must fail the load closed, never silently resolve to the decoy's wrong origin line");
    if (!result.ok) assert.equal(result.reasonKind, "schema-invalid");
  });
});

// --- Stage-3 round-3 re-confirm fix-now (2026-09-08), Issue #119 [MED], red-team-demonstrated -----
// The #115 fix (tokenizer/parser-agreement invariant) was applied to schema.ts's duplicate-key
// scanner but not to position-parser.ts's own top-level-"rules"-key detection: a SINGLE (no
// duplicate at all) unicode-escaped "rules" key passed schema validation, then findRulePositions
// silently found nothing, and every rule's origin line degraded to a -1 sentinel at exit 0/ok:true.

test("Issue #119: a layer whose top-level \"rules\" key is written with a unicode escape (no duplicate — schema validation passes) reports the CORRECT origin line, never resolves at ok:true with ruleLines containing -1", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    // Written directly so the raw text carries the escaped (non-duplicate) "rules" key -- no
    // duplicate top-level key at all, so schema.ts's #115 checks never fire and this layer is
    // accepted; the ONLY question is whether position-parser.ts's own key detection agrees.
    writeFileSync(
      projectPath,
      `{
  "version": "1.0.0",
  "\\u0072ules": [ { "id": "escaped-key-rule", "effect": "deny" } ]
}`,
      "utf8",
    );

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, true, "a single escaped top-level \"rules\" key (no duplicate) is valid per schema and must load successfully");
    if (result.ok) {
      const projectLayer = result.layers.find((l) => l.name === "project");
      assert.ok(projectLayer, "expected a project layer in the load result");
      assert.deepEqual(
        projectLayer?.ruleLines,
        [3],
        "the rule's origin line must be correctly reported (line 3) -- never the -1 sentinel Issue #119 demonstrated",
      );
    }
  });
});

test("Issue #119 backstop: no successfully-loaded layer's ruleLines ever contains the -1 sentinel — plain-ASCII-key case", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [{ id: "a", effect: "deny" }] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [{ id: "b", effect: "allow" }] });

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      for (const layer of result.layers) {
        assert.ok(!layer.ruleLines.includes(-1), `layer "${layer.name}": ruleLines must never contain the -1 sentinel for a successfully-loaded layer; got ${JSON.stringify(layer.ruleLines)}`);
      }
    }
  });
});

test("Issue #119 backstop: no successfully-loaded layer's ruleLines ever contains the -1 sentinel — escaped top-level \"rules\" key case", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeFileSync(projectPath, `{\n  "version": "1.0.0",\n  "\\u0072ules": [ { "id": "x", "effect": "deny" } ]\n}`, "utf8");

    const result = loadEffectivePolicy({
      shippedDefaultsPath: shippedPath,
      projectPolicyPath: projectPath,
      centralSource: centralSourceReturning({ status: "absent" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      for (const layer of result.layers) {
        assert.ok(!layer.ruleLines.includes(-1), `layer "${layer.name}": ruleLines must never contain the -1 sentinel for a successfully-loaded layer; got ${JSON.stringify(layer.ruleLines)}`);
      }
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
      // Recompute what the pin WOULD be over the first response's raw bytes (via the SAME
      // computePin loader.ts itself calls, not a re-implementation of its hashing logic), and
      // confirm it matches -- proving the pin was computed from the SAME single central read, not
      // a second one. Issue #110: the pin now also covers shipped-defaults+project bytes, so the
      // rehash reads those same two on-disk files rather than assuming central alone.
      const rehash = computePin({
        centralStatus: "present",
        centralChannel: "c",
        centralRaw: FIRST_RAW,
        shippedRaw: readFileSync(shippedPath, "utf8"),
        projectRaw: readFileSync(projectPath, "utf8"),
      }).digest;
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

// --- Stage-3 fix-now (2026-09-08), Issue #110: pin covers ALL THREE layers, not central alone ----

test("Issue #110: two effective policies differing ONLY in the PROJECT layer produce DIFFERENT pin digests -- the exact gap this Issue named (REQUIREMENTS.md's own POL-09 text warns against closing on the delivery half alone)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPathA = join(root, "project-a.json");
    const projectPathB = join(root, "project-b.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [] });
    writeRuleSetFile(projectPathA, { version: "1.0.0", rules: [{ id: "a", effect: "allow" }] });
    writeRuleSetFile(projectPathB, { version: "1.0.0", rules: [{ id: "b", effect: "allow" }] });

    const central = centralSourceReturning({ status: "absent" });
    const resultA = loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPathA, centralSource: central });
    const resultB = loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPathB, centralSource: central });

    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);
    if (resultA.ok && resultB.ok) {
      assert.notEqual(resultA.pin.digest, resultB.pin.digest, "Issue #110: two effective policies differing only in the project layer must no longer share one pin digest");
    }
  });
});

test("Issue #110: two effective policies differing ONLY in the SHIPPED-DEFAULTS layer produce DIFFERENT pin digests -- symmetric case completing this Issue's own scope", () => {
  withTempDir((root) => {
    const shippedPathA = join(root, "shipped-a.json");
    const shippedPathB = join(root, "shipped-b.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPathA, { version: "1.0.0", rules: [{ id: "a", effect: "deny" }] });
    writeRuleSetFile(shippedPathB, { version: "1.0.0", rules: [{ id: "b", effect: "deny" }] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [] });

    const central = centralSourceReturning({ status: "absent" });
    const resultA = loadEffectivePolicy({ shippedDefaultsPath: shippedPathA, projectPolicyPath: projectPath, centralSource: central });
    const resultB = loadEffectivePolicy({ shippedDefaultsPath: shippedPathB, projectPolicyPath: projectPath, centralSource: central });

    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);
    if (resultA.ok && resultB.ok) {
      assert.notEqual(resultA.pin.digest, resultB.pin.digest, "Issue #110: two effective policies differing only in the shipped-defaults layer must no longer share one pin digest");
    }
  });
});

test("Issue #110: identical three-layer content still produces an IDENTICAL pin digest -- the fix adds coverage, it does not break reproducibility (POL-09's own 'byte-for-byte reproducible from identical content' bar)", () => {
  withTempDir((root) => {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeRuleSetFile(shippedPath, { version: "1.0.0", rules: [{ id: "a", effect: "deny" }] });
    writeRuleSetFile(projectPath, { version: "1.0.0", rules: [{ id: "b", effect: "allow" }] });

    const central = centralSourceReturning({ status: "present", raw: '{"version":"1.0.0","rules":[]}', channel: "c" });
    const load = () => loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource: central });
    const first = load();
    const second = load();

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) assert.equal(first.pin.digest, second.pin.digest);
  });
});

test("Issue #110: no concatenation-boundary collision -- a (shipped, project) content split that WOULD collide under naive concatenation ('ab'+'' and 'a'+'b' both concatenate to the identical string 'ab') produces a DIFFERENT digest, because each layer's frame is length-prefixed and labeled rather than bare-concatenated", () => {
    const digestA = computePin({ centralStatus: "absent", shippedRaw: "ab", projectRaw: "" }).digest;
    const digestB = computePin({ centralStatus: "absent", shippedRaw: "a", projectRaw: "b" }).digest;
    assert.notEqual(digestA, digestB, "labeled, length-prefixed frames must not let a (shipped='ab', project='') pin collide with a (shipped='a', project='b') pin, even though a naive concatenation of both pairs is the identical 2-byte string 'ab'");
});
