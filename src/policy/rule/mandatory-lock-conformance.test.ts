// Stage-3 round-3 fix-now (2026-09-08), Issue #114 [HIGH] — build task #1, per the council's own GO
// condition 4 (docs/reviews/s6-policy-centralization-council-impact-analyst-2026-09-08.md,
// "Structural findings" #1; docs/reviews/s6-policy-centralization-council-trust-model-architecture-
// 2026-09-08.md's own finding 3): a real, CI-gating, EXHAUSTIVE layer-pair conformance matrix for
// `mergeLayersWithMandatoryLock`'s trust-rank check — a genuine instrument, not hand-derived prose,
// per CLAUDE.md's "no hand-derived completeness claims" hard rule.
//
// Why this file exists, named plainly: "a general-looking mechanism, wrong dimension, correct only
// for the tested cells" has now shipped in this codebase FOUR times before this fix (Issues #65/#66,
// #99, #114) and a FIFTH time in the same review round (#115, a different function, same shape). No
// standing instrument caught any of them before a reviewer did, by hand, one round later. This file
// is that standing instrument for `mergeLayersWithMandatoryLock` specifically: every layer-pair
// combination this function's trust-rank check can ever be asked to adjudicate is exercised here,
// mechanically enumerated from the SAME `TRUST_RANK` table the implementation uses (imported, never
// hand-copied — see precedence.ts's own export comment for why a second, hand-typed copy here would
// reintroduce exactly the class of bug this file exists to prevent), so a future 4th layer or a
// future trust-rank change cannot silently leave one cell unverified.
//
// Two layers of proof, deliberately not just one:
//   1. SELF-CONSISTENCY (Part A) — derived from `TRUST_RANK` itself: proves the CHECK inside
//      `mergeLayersWithMandatoryLock` is faithful to the trust table for every ordered pair the
//      fixed walk order (shipped-defaults, central, project) can ever produce. This catches "the
//      check drifted from the table" bugs.
//   2. GROUND TRUTH (Part B) — hand-written, small, human-reviewable, independent of `TRUST_RANK`'s
//      own values: proves the three REAL layers behave the way POL-07/section 0.4 property 2
//      actually require (central protected, peers not). This catches "the table itself has the
//      wrong values" bugs that Part A alone could never catch (since Part A's expectations move
//      WITH the table).
// Part C covers same-layer duplicate ids (the "same-layer duplicates" cell this task explicitly
// names). Part D proves central's un-voidability holds across every mandatory-flag combination on a
// single 3-way collision, not just the pairwise cases Parts A/B already cover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLayersWithMandatoryLock, TRUST_RANK, type LayerName, type NamedRuleLayer } from "./precedence.ts";
import type { Rule } from "../kernel/rule-types.ts";

const PRECEDENCE_ORDER: readonly LayerName[] = ["shipped-defaults", "central", "project"];

function rule(id: string, effect: "allow" | "deny", mandatory?: boolean): Rule {
  return mandatory === undefined ? { id, effect } : { id, effect, mandatory };
}

function layer(name: LayerName, items: readonly Rule[]): NamedRuleLayer {
  return { name, version: "1.0.0", items };
}

/** Builds a 3-layer call where ONLY `declaring` has a mandatory rule (id `SHARED_ID`) and ONLY
 * `colliding` redefines that same id (non-mandatory) -- every other layer is empty. `declaring` and
 * `colliding` must both come from PRECEDENCE_ORDER, `declaring` strictly before `colliding`. */
const SHARED_ID = "conformance-shared-id";
function buildPairwiseCall(declaring: LayerName, colliding: LayerName): NamedRuleLayer[] {
  return PRECEDENCE_ORDER.map((name) => {
    if (name === declaring) return layer(name, [rule(SHARED_ID, "deny", true)]);
    if (name === colliding) return layer(name, [rule(SHARED_ID, "allow")]);
    return layer(name, []);
  });
}

// --- Part A: self-consistency, mechanically derived from TRUST_RANK (never hand-copied) ----------

const forwardPairs: { declaring: LayerName; colliding: LayerName }[] = [];
for (let i = 0; i < PRECEDENCE_ORDER.length; i++) {
  for (let j = i + 1; j < PRECEDENCE_ORDER.length; j++) {
    const declaring = PRECEDENCE_ORDER[i];
    const colliding = PRECEDENCE_ORDER[j];
    if (declaring && colliding) forwardPairs.push({ declaring, colliding });
  }
}

// Sanity on the enumeration itself. Stage-3 round-3 re-confirm fix-now (2026-09-08), Issue #118
// [MED], red-team round-3-demonstrated: this test previously asserted a HARD-CODED length (3) and
// a hard-coded three-name pair list -- so when red-team added a 4th layer to LayerName+TRUST_RANK
// (the way a future story would), PRECEDENCE_ORDER above (a plain `readonly LayerName[]`, not
// exhaustiveness-checked by the compiler) silently stayed at 3 names, this self-check kept passing
// because it was checking the SAME hard-coded 3 against itself, and Part B's "central can NEVER be
// voided" assertion silently narrowed to only the pairs it knew about even though the new layer
// made central voidable -- the exact defect this whole file exists to prevent, recurring one level
// up, in the file's own guard against itself. Fixed per red-team's own suggested proof-test: derive
// the expectation from `TRUST_RANK` (the SAME source of truth Part A's per-pair expectations
// already use, never a second hand-typed copy) instead of a hard-coded list, so a future 4th layer
// added to TRUST_RANK without updating PRECEDENCE_ORDER turns this file red instead of silently
// covering half the matrix.
test("mandatory-lock conformance (self-check): PRECEDENCE_ORDER's domain equals TRUST_RANK's own key set, and the forward-pair count is n(n-1)/2 for n = Object.keys(TRUST_RANK).length — never a hard-coded 3", () => {
  const trustRankLayers = Object.keys(TRUST_RANK);
  assert.deepEqual(
    new Set(PRECEDENCE_ORDER),
    new Set(trustRankLayers),
    "PRECEDENCE_ORDER must enumerate EXACTLY the layers TRUST_RANK knows about -- a layer present in one but not the other means this matrix is either testing a layer that doesn't exist or silently skipping one that does",
  );
  const n = trustRankLayers.length;
  assert.equal(
    forwardPairs.length,
    (n * (n - 1)) / 2,
    `expected n(n-1)/2 = ${(n * (n - 1)) / 2} forward pairs for n = ${n} layers (derived from TRUST_RANK, not hard-coded)`,
  );
});

for (const { declaring, colliding } of forwardPairs) {
  const expectVoided = TRUST_RANK[declaring] > TRUST_RANK[colliding];

  test(`mandatory-lock conformance (Part A, derived from TRUST_RANK): ${declaring} declares mandatory, ${colliding} attempts to redefine -> ${expectVoided ? "VOIDED" : "NOT voided"} (rank ${TRUST_RANK[declaring]} ${expectVoided ? ">" : "<="} rank ${TRUST_RANK[colliding]})`, () => {
    const result = mergeLayersWithMandatoryLock(buildPairwiseCall(declaring, colliding));

    if (expectVoided) {
      assert.deepEqual(result.voidedLayers, [{ layer: colliding, ruleId: SHARED_ID }]);
      const winner = result.merged.rules.find((r) => r.id === SHARED_ID);
      assert.equal(winner?.sourceLayer, declaring, "the declaring (more-trusted) layer's value must survive");
    } else {
      assert.deepEqual(result.voidedLayers, [], "a declaring layer with rank <= the colliding layer's rank has no locking force");
      const winner = result.merged.rules.find((r) => r.id === SHARED_ID);
      assert.equal(winner?.sourceLayer, colliding, "the colliding (later-walked) layer's value wins normally, same as any non-mandatory override");
    }

    // Loud-disclosure conformance: the declaring layer's mandatory:true is reported as inert iff no
    // OTHER layer in TRUST_RANK ranks strictly lower than it -- checked here structurally, not
    // re-derived by hand, for every pair this matrix covers.
    const declaringHasLockingForce = Object.values(TRUST_RANK).some((r) => r < TRUST_RANK[declaring]);
    if (declaringHasLockingForce) {
      assert.deepEqual(result.inertMandatoryDeclarations, [], "a declaring layer with real locking force is never disclosed as inert");
    } else {
      assert.deepEqual(result.inertMandatoryDeclarations, [{ layer: declaring, ruleId: SHARED_ID }]);
    }
  });
}

// --- Part B: ground truth, hand-written and independent of TRUST_RANK's own values -----------------
// (catches "the table itself has the wrong values" -- Part A alone cannot, since its expectations
// move WITH the table.)

test("mandatory-lock conformance (Part B, ground truth): shipped-defaults's mandatory declaration can NEVER void central — the exact Issue #114 exploit direction", () => {
  const result = mergeLayersWithMandatoryLock(buildPairwiseCall("shipped-defaults", "central"));
  assert.deepEqual(result.voidedLayers, [], "central must never be silenced by a git-tracked shipped-defaults edit");
});

test("mandatory-lock conformance (Part B, ground truth): shipped-defaults's mandatory declaration can NEVER void project — peers, never lock each other", () => {
  const result = mergeLayersWithMandatoryLock(buildPairwiseCall("shipped-defaults", "project"));
  assert.deepEqual(result.voidedLayers, []);
});

test("mandatory-lock conformance (Part B, ground truth): central's mandatory declaration DOES void project — the one real, intended locking relationship POL-07 protects", () => {
  const result = mergeLayersWithMandatoryLock(buildPairwiseCall("central", "project"));
  assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: SHARED_ID }]);
});

test("mandatory-lock conformance (Part B, ground truth): central can NEVER appear in voidedLayers, for ANY forward pair", () => {
  for (const { declaring, colliding } of forwardPairs) {
    const result = mergeLayersWithMandatoryLock(buildPairwiseCall(declaring, colliding));
    assert.ok(
      !result.voidedLayers.some((v) => v.layer === "central"),
      `central must never be voided (case: ${declaring} declares, ${colliding} collides)`,
    );
  }
});

// --- Part C: same-layer duplicates (the cell this task explicitly names) ---------------------------
// Schema validation (schema.ts's validateRuleSet) rejects a duplicate rule id within one layer's own
// document BEFORE mergeLayersWithMandatoryLock is ever called with real loader.ts input — but this
// function does not itself assume that invariant; it operates on whatever `NamedRuleLayer[]` a
// caller passes. Proven here directly: a layer whose own `items` array already contains two rules
// sharing one id degrades to `mergeLayersById`'s own last-item-wins-within-a-layer behavior (the
// same Map-based accumulation `mergeLayers` itself already relies on), never a crash and never an
// artificial self-collision against the layer's OWN mandatory declaration.

for (const name of PRECEDENCE_ORDER) {
  test(`mandatory-lock conformance (Part C, same-layer duplicate): two rules sharing one id within a single ${name} layer -- last item wins, no crash, no self-collision`, () => {
    const layers: NamedRuleLayer[] = PRECEDENCE_ORDER.map((n) =>
      n === name ? layer(n, [rule("dup-id", "deny", true), rule("dup-id", "allow", false)]) : layer(n, []),
    );
    const result = mergeLayersWithMandatoryLock(layers);
    assert.deepEqual(result.voidedLayers, [], "a layer's own internal duplicate is never treated as a cross-layer lock violation");
    const winner = result.merged.rules.find((r) => r.id === "dup-id");
    assert.equal(winner?.effect, "allow", "the LAST item within the layer wins, matching mergeLayersById's own accumulation order");
    assert.equal(winner?.sourceLayer, name);
  });
}

// --- Part D: central's un-voidability across every mandatory-flag combination on one 3-way collision

test("mandatory-lock conformance (Part D): central is NEVER voided, across all 8 mandatory-flag combinations of a single id declared in all three layers at once", () => {
  for (let bits = 0; bits < 8; bits++) {
    const shippedMandatory = (bits & 1) !== 0;
    const centralMandatory = (bits & 2) !== 0;
    const projectMandatory = (bits & 4) !== 0;
    const layers: NamedRuleLayer[] = [
      layer("shipped-defaults", [rule(SHARED_ID, "deny", shippedMandatory)]),
      layer("central", [rule(SHARED_ID, "allow", centralMandatory)]),
      layer("project", [rule(SHARED_ID, "deny", projectMandatory)]),
    ];
    const result = mergeLayersWithMandatoryLock(layers);
    assert.ok(
      !result.voidedLayers.some((v) => v.layer === "central"),
      `central must never be voided (bits=${bits}: shipped=${shippedMandatory} central=${centralMandatory} project=${projectMandatory})`,
    );
  }
});

// ====================================================================================================
// Issue #112 -- `defaultOutcome` (the baseline posture) resolved through the SAME trust rank the lock
// check above uses (test-writer, 2026-09-24, written BEFORE the production change; the implementer
// does not edit these hunks -- a test believed wrong is flagged back, never edited).
//
// Rulings encoded (Manager, Phase 1 plan s6-policy-residuals-112-124, section 4):
//   D1 -- no separate "mandatory" flag for the posture. Central's declaration is locked against
//         lower-trust layers implicitly, by TRUST_RANK (central is the only rank-1 layer).
//   D2 -- a lower-trust layer (one whose rank is strictly below the layer currently holding the
//         posture) may change it only by TIGHTENING allow -> deny. A relaxing declaration is ignored
//         (the layer is NOT voided). Peers (same rank) override each other, exactly as their rules do.
//   D3 -- the result is `MandatoryLockResult.defaultOutcome?: { outcome, source: LayerName }`,
//         undefined when no accepted layer declares one. The bootstrap "allow" fallback is applied by
//         the LOADER, never here (src/policy/rule/ must not import src/policy/config/).
//
// Interface these tests specify (does not exist yet -- expected RED at HEAD, for that reason only):
//   NamedRuleLayer.defaultOutcome?: VerdictOutcome
//   MandatoryLockResult.defaultOutcome?: { outcome: VerdictOutcome; source: LayerName }
// ====================================================================================================

type PostureOutcome = "allow" | "deny";
type ExpectedPosture = { outcome: PostureOutcome; source: LayerName };
const POSTURE_OUTCOMES: readonly PostureOutcome[] = ["allow", "deny"];

/** A layer carrying an optional declared posture. Conditional spread: exactOptionalPropertyTypes is
 * on, so an absent declaration must be an absent key, never `defaultOutcome: undefined`. */
function postureLayer(name: LayerName, defaultOutcome: PostureOutcome | undefined, items: readonly Rule[] = []): NamedRuleLayer {
  return defaultOutcome === undefined ? layer(name, items) : { ...layer(name, items), defaultOutcome };
}

/** A 3-layer call where only the layers named in `declared` declare a posture, no rules anywhere. */
function postureCall(declared: Partial<Record<LayerName, PostureOutcome>>): NamedRuleLayer[] {
  return PRECEDENCE_ORDER.map((name) => postureLayer(name, declared[name]));
}

/** Expectation for two layers that BOTH declare, `earlier` walked before `later`, derived from the
 * same TRUST_RANK the implementation uses (never a second hand-typed table). */
function expectedPosture(earlier: LayerName, earlierOut: PostureOutcome, later: LayerName, laterOut: PostureOutcome): ExpectedPosture {
  if (TRUST_RANK[later] >= TRUST_RANK[earlier]) return { outcome: laterOut, source: later };
  if (earlierOut === "allow" && laterOut === "deny") return { outcome: "deny", source: later };
  return { outcome: earlierOut, source: earlier };
}

// --- Part E (B6): every ordered layer pair x every (declared, declared) outcome pair, enumerated ----
// mechanically from TRUST_RANK / forwardPairs, so a future 4th layer cannot leave a cell unchecked.

const postureMatrixCells: { earlier: LayerName; later: LayerName; earlierOut: PostureOutcome; laterOut: PostureOutcome }[] = [];
for (const { declaring: earlier, colliding: later } of forwardPairs) {
  for (const earlierOut of POSTURE_OUTCOMES) {
    for (const laterOut of POSTURE_OUTCOMES) postureMatrixCells.push({ earlier, later, earlierOut, laterOut });
  }
}

// B6 (Issue #112): enumeration self-check -- the cell count is derived, not hand-typed.
test("mandatory-lock conformance (Part E self-check, Issue #112 B6): the defaultOutcome matrix has one cell per forward layer pair per (declared, declared) outcome pair, derived from TRUST_RANK", () => {
  const n = Object.keys(TRUST_RANK).length;
  assert.equal(postureMatrixCells.length, ((n * (n - 1)) / 2) * POSTURE_OUTCOMES.length ** 2);
});

for (const { earlier, later, earlierOut, laterOut } of postureMatrixCells) {
  const expected = expectedPosture(earlier, earlierOut, later, laterOut);
  const rel = TRUST_RANK[later] >= TRUST_RANK[earlier] ? "later layer overrides" : "lower-trust later layer, tighten-only";
  // B6 (Issue #112)
  test(`mandatory-lock conformance (Part E, Issue #112 B6, derived from TRUST_RANK): ${earlier}=${earlierOut} then ${later}=${laterOut} (${rel}) -> ${expected.outcome} from ${expected.source}`, () => {
    const result = mergeLayersWithMandatoryLock(postureCall({ [earlier]: earlierOut, [later]: laterOut }));
    assert.deepEqual(result.defaultOutcome, expected);
    assert.deepEqual(result.voidedLayers, [], "a declared posture never voids a layer -- only a mandatory-id collision does");
  });
}

// --- Part F (B7, B8): ground truth, hand-written and independent of TRUST_RANK's own values ---------

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): central deny, project allow -> deny from central -- a project layer can NEVER relax central's posture", () => {
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ central: "deny", project: "allow" })).defaultOutcome, { outcome: "deny", source: "central" });
});

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): central allow, project deny -> deny from project -- a lower-trust layer MAY tighten (D2)", () => {
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ central: "allow", project: "deny" })).defaultOutcome, { outcome: "deny", source: "project" });
});

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): central deny, project deny -> deny from central -- a redundant lower-trust declaration changes nothing", () => {
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ central: "deny", project: "deny" })).defaultOutcome, { outcome: "deny", source: "central" });
});

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): shipped-defaults deny, central allow -> allow from central -- central outranks the git-tracked shipped layer, so its posture stands", () => {
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "deny", central: "allow" })).defaultOutcome, { outcome: "allow", source: "central" });
});

// B7 (Issue #112) -- D2's disclosed peer behavior, asserted so it cannot change silently.
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): shipped-defaults deny, project allow -> allow from project -- PEERS (same rank) override each other, exactly as their rules already do (disclosed residual, D2)", () => {
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "deny", project: "allow" })).defaultOutcome, { outcome: "allow", source: "project" });
});

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): no accepted layer declares a posture -> defaultOutcome is undefined (the bootstrap fallback is the loader's job, never this function's)", () => {
  assert.equal(mergeLayersWithMandatoryLock(postureCall({})).defaultOutcome, undefined);
});

// B7 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): a single declaring layer is adopted with itself as the source, for each layer and each outcome", () => {
  for (const name of PRECEDENCE_ORDER) {
    for (const outcome of POSTURE_OUTCOMES) {
      assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ [name]: outcome })).defaultOutcome, { outcome, source: name }, `${name} alone declaring ${outcome}`);
    }
  }
});

// B7 (Issue #112): three-layer chains, hand-computed.
test("mandatory-lock conformance (Part F, Issue #112 B7 ground truth): three-layer chains resolve as the trust model says", () => {
  // central's deny survives a project allow that follows a shipped allow.
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "allow", central: "deny", project: "allow" })).defaultOutcome, { outcome: "deny", source: "central" });
  // central allow, then project tightens to deny: the tightening wins over a shipped deny that preceded central.
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "deny", central: "allow", project: "deny" })).defaultOutcome, { outcome: "deny", source: "project" });
  // no central posture: shipped allow then project deny -> peers, project overrides.
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "allow", project: "deny" })).defaultOutcome, { outcome: "deny", source: "project" });
  // no central posture: shipped deny alone stands when project is silent.
  assert.deepEqual(mergeLayersWithMandatoryLock(postureCall({ "shipped-defaults": "deny" })).defaultOutcome, { outcome: "deny", source: "shipped-defaults" });
});

// --- B8: a layer voided by a mandatory-id collision contributes NOTHING, its posture included -------

/** central holds a mandatory rule `SHARED_ID`; project redefines it (so project is voided) and also
 * declares `projectPosture`. `centralPosture` is central's own declaration, if any. */
function voidedProjectCall(centralPosture: PostureOutcome | undefined, projectPosture: PostureOutcome, projectCollides: boolean): NamedRuleLayer[] {
  return [
    layer("shipped-defaults", []),
    postureLayer("central", centralPosture, [rule(SHARED_ID, "deny", true)]),
    postureLayer("project", projectPosture, [rule(projectCollides ? SHARED_ID : "project-only-id", "allow")]),
  ];
}

// B8 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B8): a project layer voided by a mandatory-id collision does not tighten central's posture (its declaration is ignored with the rest of its content)", () => {
  const result = mergeLayersWithMandatoryLock(voidedProjectCall("allow", "deny", true));
  assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: SHARED_ID }]);
  assert.deepEqual(result.defaultOutcome, { outcome: "allow", source: "central" });
});

// B8 (Issue #112)
test("mandatory-lock conformance (Part F, Issue #112 B8): a voided project layer's posture alone never becomes the result -- with no other declaration the result is undefined", () => {
  const result = mergeLayersWithMandatoryLock(voidedProjectCall(undefined, "deny", true));
  assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: SHARED_ID }]);
  assert.equal(result.defaultOutcome, undefined);
});

// B8 (Issue #112): the control -- identical except the project layer does NOT collide, so it is
// accepted and its tightening counts. Proves the two tests above are decided by the void, not by
// something else in the fixture.
test("mandatory-lock conformance (Part F, Issue #112 B8 control): the same project posture, without a collision, IS accepted -- so the void is what suppressed it above", () => {
  const result = mergeLayersWithMandatoryLock(voidedProjectCall(undefined, "deny", false));
  assert.deepEqual(result.voidedLayers, []);
  assert.deepEqual(result.defaultOutcome, { outcome: "deny", source: "project" });
});
