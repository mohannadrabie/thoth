// POL-08: "Precedence shall be: shipped defaults, then central policy, then project." Acceptance:
// "Deterministic, documented, inspectable."
//
// This module lives OUTSIDE the kernel purity boundary (src/policy/kernel/**, enforced by
// src/qa/kernel-purity-check.ts) — merging three named layers into one resolved RuleSet is a
// data-preparation step the kernel CONSUMES (via WorldFacts.rules, see
// src/policy/kernel/kernel.ts's decide()), not something the kernel does itself (POL-11: the
// kernel never merges layers or reads a config file). No real config-file loader here either —
// S2 operates on in-memory RuleSet values only; S6 owns loading real layers from disk
// (docs/decisions.md's 2026-09-01 S2 row).
//
// S3 (docs/decisions.md, 2026-09-01 S3-intake row, point 1): SUR-03's tool-classification catalog
// is "built by extending this file's mergeLayers shape, not reinventing it." `mergeLayers` itself
// is UNCHANGED below — same signature, same behavior, same tests still pass — its three-layer
// merge-by-id logic is factored into the generic `mergeLayersById` core, which
// `mergeToolClassificationLayers` (two-tier: shipped + central, per the T5 ruling) also calls.
import type { Rule, RuleSet } from "../kernel/rule-types.ts";
import type {
  MergedToolClassification,
  MergedToolClassificationSet,
  ToolClassificationEntry,
  ToolClassificationSet,
} from "../tools/classification.ts";

export type LayerName = "shipped-defaults" | "central" | "project";

export interface MergedRule extends Rule {
  /** Which layer's definition won for this rule id — POL-08's "inspectable". */
  sourceLayer: LayerName;
}

export interface MergedRuleSet {
  /** The effective configuration's version — see mergeLayers' doc comment for how it resolves. */
  version: string;
  rules: MergedRule[];
}

/**
 * Generic last-layer-wins-by-key merge, shared by `mergeLayers` (POL-08, three-tier, keyed by
 * `Rule.id`) and `mergeToolClassificationLayers` (SUR-03/T5, two-tier, keyed by
 * `ToolClassificationEntry.name`). `keyOf` is the only thing that varies between the two callers —
 * the merge algorithm itself (later layer overrides, first-appearance order preserved) is written
 * exactly once here.
 */
function mergeLayersById<T>(
  layers: readonly { name: LayerName; items: readonly T[] }[],
  keyOf: (item: T) => string,
): { order: string[]; byId: Map<string, { item: T; sourceLayer: LayerName }> } {
  const byId = new Map<string, { item: T; sourceLayer: LayerName }>();
  const order: string[] = [];
  for (const layer of layers) {
    for (const item of layer.items) {
      const key = keyOf(item);
      if (!byId.has(key)) order.push(key);
      byId.set(key, { item, sourceLayer: layer.name });
    }
  }
  return { order, byId };
}

// --- S6: POL-07 mandatory-lock (general form) -----------------------------------------------
//
// `mergeLayersWithMandatoryLock` is `mergeLayers`'s post-S6 sibling: the SAME precedence order,
// but a rule id an earlier layer marked `mandatory: true` can never be redefined by a later layer
// — rejected outright, unconditionally, even for a byte-identical redefinition (docs/decisions.md,
// 2026-09-08 S6 plan-ratification row, Q1: "no field-by-field diff logic, matching ADR-0021's
// 'never silent allow' ethos").
//
// `mergeLayers` itself stays UNTOUCHED below — same signature, same behavior, same tests still
// pass. Its only call sites today are its own test (precedence.test.ts) plus two out-of-scope
// tests (kernel.test.ts, normalizer/registry.test.ts) — migrating those is scope-widening beyond
// S6 (SE ADR-0006). Once loader.ts (S6) wires `mergeLayersWithMandatoryLock` as the live POL-08
// path, `mergeLayers` has ZERO production callers and exists only as a tested reference shape for
// the plain (non-locking) merge semantics — not deprecated, not removed, just no longer the real
// path. A future reader should not mistake it for the real merge.
//
// Composition (architecture-reviewer S6 pre-build finding 1, folded into plan v2 §8): this is a
// literal call to the SAME shared `mergeLayersById` core `mergeLayers` itself uses, wrapped in a
// validation pass — never a second, hand-rolled iterate-layers-track-winner loop that reimplements
// POL-08's precedence logic independently. One merge core, one lock-check pass around it.
//
// General by construction, not by convention (design-challenger S6 Attack C /
// docs/decisions.md's 2026-09-08 row: "add the shipped-defaults→central regression test now, not
// backlogged"): the lock check inspects the STORED RULE's OWN `mandatory` field — never which
// LAYER produced it. This is deliberate: this codebase has shipped the opposite, "looks equivalent
// for the tested case, isn't equivalent for the general case" bug shape more than once (Issues
// #65/#66, #99) — a check written as `sourceLayer === "central"` would pass every central→project
// test here and silently do nothing for shipped-defaults→central. That shape is structurally
// impossible to write with the check below, because the check below never references a layer name
// at all, only the `mandatory` boolean already recorded against an id.
//
// === Stage-3 round-3 fix-now (2026-09-08), Issue #114 [HIGH] — TRUST RANK, distinct from PRECEDENCE
// ORDER (`/maat:council` ruling, Path B: docs/reviews/s6-policy-centralization-{design-challenger-
// council-stopbrief,council-trust-model-architecture,council-impact-analyst}-2026-09-08.md; ratified
// in docs/decisions.md's 2026-09-08 "council convened on S6's mandatory-lock trust-model flaw" row) ===
//
// Round 2's red-team found that the check above — "an EARLIER-ACCEPTED layer's mandatory id may not
// be redefined by a LATER layer" — silently conflated two DIFFERENT orderings that happen to
// coincide for the one direction this project's tests originally exercised (central → project) and
// diverge for the one that matters: `shipped-defaults` is EARLIEST in POL-08's declared PRECEDENCE
// order, but it is a git-tracked, session-writable, in-repo file — the LEAST trusted layer, not the
// most. `central` is the one out-of-repo, administrator-ACL-protected tier (REQUIREMENTS.md:225).
// Walking layers in precedence order and letting "earlier-accepted" double as "may lock" let a
// shipped-defaults edit void the ENTIRE central layer at exit 0 (Issue #114) — the exact "a change
// under review alters the policy that judges it" inversion this whole story exists to close.
//
// TRUST_RANK below is that SECOND, independent ordering. `central` is trusted (rank 1);
// `shipped-defaults` and `project` are PEERS (rank 0 each) — both git-tracked, both in-repo,
// neither administrator-ACL-protected, and nothing in REQUIREMENTS.md distinguishes their trust
// today. A layer's `mandatory: true` declaration may only void a LATER-walked layer whose trust
// rank is STRICTLY LOWER than the declaring layer's own rank — never merely "walked earlier".
// Because `TRUST_RANK` is a `Record<LayerName, ...>` (a mapped type over the same union
// `NamedRuleLayer.name` already uses), a future 4th layer is a COMPILE ERROR here until this table
// is updated — the same "structurally impossible to write wrong for an untested layer" property the
// precedence-based check above already claimed for ITS axis, now also held for the trust axis,
// which is the one axis that check never actually had.
//
// Consequence, stated explicitly because it is easy to miss: given the fixed walk order
// (shipped-defaults, then central, then project) and this rank table, the ONLY collision that can
// EVER produce a voided layer is central's mandatory id colliding with project's redefinition
// (rank 1 > rank 0). `shipped-defaults` is walked first, so nothing ever precedes it to lock
// against; `shipped-defaults` and `project` are peers, so neither can ever lock the other; and
// `central` — the layer Issue #114 protects — can now NEVER be voided by anything, structurally,
// not merely "not observed to be voided by the current fixtures".
//
// Loud disclosure, not a silent no-op (the council's own GO condition): a layer whose `mandatory:
// true` declaration has NO locking force against any OTHER layer in `TRUST_RANK` (today:
// `shipped-defaults` and `project`, both rank 0, with no rank-lower peer to lock) is never silently
// dropped — it still resolves normally in the merge, but `inertMandatoryDeclarations` names it, so
// an operator/printer can surface "declared mandatory, but not authoritative" rather than letting a
// policy author wrongly assume a protection that was never real (this is exactly what protects
// test-writer's locked `printer-shipped-defaults.json` fixture: that fixture's shipped-defaults
// `mandatory: true` rule has NO id collision anywhere in its fixture set, so it never exercises the
// lock-check branch at all — Path B changes nothing about how a non-colliding rule resolves or
// prints, only what a COLLIDING one does).
//
// Resolving the one sub-case the ratifying task explicitly flagged as needing a stated, justified
// answer rather than a guess: **does a shipped-defaults `mandatory: true` rule lock the PROJECT
// layer?** No — shipped-defaults (rank 0) and project (rank 0) are PEERS, and a lock requires the
// declaring layer's rank to be STRICTLY greater than the colliding layer's rank; equal ranks never
// satisfy "strictly greater". This is not a gap in the trust model, it is what "peers" means. Textual
// support: POL-07 (REQUIREMENTS.md:431) names only "the central policy source" as the layer able to
// mark a rule mandatory with real force; the council's Path B ruling (over Path A, "central-only")
// keeps the general any-layer-MAY-DECLARE-mandatory mechanism POL-07's own 2026-09-08 plan-
// ratification Q2 ruling already ordered built (so `shipped-defaults`/`project` may still WRITE
// `mandatory: true` without a schema error), while making the actual LOCKING FORCE track POL-07's
// central-only intent exactly, because central is the only layer with a lower-ranked peer to lock
// today. A shipped-defaults-declared lock is therefore always disclosed as inert, never able to
// void project, and never able to void central either (central outranks it) — matching
// `printer-shipped-defaults.json`'s own committed rationale text ("no downstream layer can silently
// relax it") exactly for the one relationship that fixture actually tests (central/project reading
// this rule), while being honest that shipped-defaults' own claim on ITS peer (project) was never
// real force to begin with, now surfaced rather than left ambiguous.

// Exported (not just internal) so `mandatory-lock-conformance.test.ts` (Stage-3 round-3 fix-now,
// build task #1, per the council's own GO condition 4) can derive its exhaustive layer-pair matrix
// MECHANICALLY from the same source of truth the implementation uses — CLAUDE.md's own "no
// hand-derived completeness claims" rule, applied to this table itself: a hand-copied second table
// living inside the test file could drift from this one silently, which is the exact "looks general,
// isn't" bug shape (Issues #65/#66/#99/#114) this whole trust-rank mechanism exists to close.
export const TRUST_RANK: Record<LayerName, number> = {
  "shipped-defaults": 0,
  central: 1,
  project: 0,
};

/** True if some OTHER layer in `TRUST_RANK` ranks strictly lower than `layerName` — i.e. this
 * layer's `mandatory: true` declarations can ever have real locking force against anything. */
function hasLockingForce(layerName: LayerName): boolean {
  const ownRank = TRUST_RANK[layerName];
  return Object.values(TRUST_RANK).some((rank) => rank < ownRank);
}

export interface NamedRuleLayer {
  name: LayerName;
  version: string;
  items: readonly Rule[];
}

export interface MandatoryLockViolation {
  layer: LayerName;
  ruleId: string;
}

/** Issue #114 [HIGH] fix, loud-disclosure condition: a `mandatory: true` declaration that can never
 * have real locking force (today: any `shipped-defaults`/`project` declaration — see TRUST_RANK's
 * own header comment) is never silently dropped. It still resolves normally in the merge; this just
 * names it, so a caller (loader.ts/printer.ts) can disclose "declared mandatory, not authoritative"
 * rather than leaving an operator to wrongly assume a protection that was never real. */
export interface InertMandatoryDeclaration {
  layer: LayerName;
  ruleId: string;
}

export interface MandatoryLockResult {
  merged: MergedRuleSet;
  /** Stage-3 round-1 fix-now (2026-09-08), Issue #108 [MED]: layers rejected in their entirety due
   * to a mandatory-id collision — empty when every layer cleared the lock check. See this
   * function's own header for why this is no longer a whole-CALL failure. Stage-3 round-3 fix-now
   * (2026-09-08), Issue #114 [HIGH]: under the trust-rank check, the ONLY entry this can ever
   * contain today is `{ layer: "project", ... }` — see TRUST_RANK's own header for why. */
  voidedLayers: MandatoryLockViolation[];
  /** Issue #114 [HIGH] fix, loud-disclosure condition — see `InertMandatoryDeclaration`'s own doc
   * comment. Empty when every `mandatory: true` declaration in this call had real locking force. */
  inertMandatoryDeclarations: InertMandatoryDeclaration[];
}

/**
 * POL-07: general any-layer-locks-later-layers mandatory-key locking. Walks `layers` in the given
 * (declared precedence) order. For each layer, checks every one of its rules against the set of
 * ids locked by an earlier-accepted layer's `mandatory: true` rule — but (Stage-3 round-3 fix-now,
 * Issue #114 [HIGH], see TRUST_RANK's own header comment above) only when that DECLARING layer's
 * TRUST rank is strictly greater than the COLLIDING layer's own rank. "Walked earlier" and "may
 * lock" are no longer the same fact.
 *
 * === Stage-3 round-1 fix-now (2026-09-08), Issue #108 [MED], red-team-demonstrated ===
 *
 * Originally, the FIRST collision found voided the ENTIRE call (every layer, including earlier,
 * non-conflicting ones) — which meant the LEAST-trusted layer (`project`, an in-repo file every
 * change under review can edit) could suppress the MOST-trusted layer's mandatory rules too, simply
 * by colliding with them. That inverted the trust direction POL-07 exists to protect. Per the
 * already-ratified AC9 text ("a project layer ... is rejected in its ENTIRETY") — whole-LAYER
 * granularity, never whole-LOAD — the fix scopes the rejection to the layer that ATTEMPTED the
 * collision: that one layer's entire contribution is dropped (none of its rules merge, and none of
 * its own `mandatory: true` rules lock anything for a still-later layer, since the layer's content
 * is treated as never having happened), while every EARLIER-ACCEPTED layer (and any LATER layer
 * that doesn't itself collide) still resolves normally. `voidedLayers` reports which layer(s) were
 * dropped and which rule id triggered it, so the caller (loader.ts/printer.ts) can attribute the
 * rejection to the OFFENDING layer by name — never to "central policy" when central itself was
 * innocent (or absent) and `project` was the one that collided (red-team finding 3(b)).
 *
 * Only ACCEPTED layers feed the actual merge, run via `mergeLayersById`, unchanged from
 * `mergeLayers`'s own core, so a rule id present in only one accepted layer, first-appearance
 * ordering, and last-write-wins-by-value all behave identically to `mergeLayers` for the
 * non-conflicting case.
 *
 * === KNOWN LIMITATION (red-team finding 11, LOW, S6 Stage-3 round-1 · 2026-09-08 — documented,
 * not fixed this round; see docs/backlog.md's matching entry) ===
 * This lock protects a rule **id**, never an **effect**. A mandatory `allow` rule is silently
 * neutralized by ANY later-layer `deny` rule that targets the same verbs/targets under a
 * DIFFERENT id — the check above never fires (the ids don't collide), and `kernel.ts`'s
 * pre-existing (S2, unchanged) deny-wins-among-matched-rules semantics resolves the actual
 * decision to deny regardless of which layer's rule is "mandatory". The mirror case is safe: a
 * mandatory `deny` rule cannot be flipped by a shadowing `allow` this way, because deny already
 * wins ties. POL-07's own acceptance text ("downstream configuration cannot relax it") is
 * satisfied on its literal terms — this is a real, disclosed gap in what "cannot relax" covers,
 * not a violation of what it says. A central admin relying on a mandatory `allow` as a
 * break-glass exception should know it can be silently shadowed by an unrelated `deny` id.
 */
export function mergeLayersWithMandatoryLock(layers: readonly NamedRuleLayer[]): MandatoryLockResult {
  // id -> which layer currently DECLARES `mandatory: true` on it (the most-recently-accepted
  // declarant in walk order — a later, non-colliding redefinition by a layer with equal-or-lower
  // trust than the CURRENT declarant simply overwrites the map entry, exactly like it overwrites
  // the merged value itself; see TRUST_RANK's header for why that is correct, not a gap).
  const lockDeclaredBy = new Map<string, LayerName>();
  const voidedLayers: MandatoryLockViolation[] = [];
  const inertMandatoryDeclarations: InertMandatoryDeclaration[] = [];
  const acceptedLayers: NamedRuleLayer[] = [];

  for (const layer of layers) {
    const collision = layer.items.find((rule) => {
      const declaringLayer = lockDeclaredBy.get(rule.id);
      return declaringLayer !== undefined && TRUST_RANK[declaringLayer] > TRUST_RANK[layer.name];
    });
    if (collision) {
      voidedLayers.push({ layer: layer.name, ruleId: collision.id });
      continue; // this layer's ENTIRE contribution is dropped -- not merged, does not lock anything
    }
    acceptedLayers.push(layer);
    for (const rule of layer.items) {
      if (rule.mandatory) {
        lockDeclaredBy.set(rule.id, layer.name);
        if (!hasLockingForce(layer.name)) {
          inertMandatoryDeclarations.push({ layer: layer.name, ruleId: rule.id });
        }
      }
    }
  }

  const { order, byId } = mergeLayersById(acceptedLayers, (rule) => rule.id);
  const rules: MergedRule[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) rules.push({ ...entry.item, sourceLayer: entry.sourceLayer });
  }

  // Same version-resolution rule as `mergeLayers`: the LAST ACCEPTED layer (in declared order)
  // that actually contributes at least one rule wins the version; falls back to the first
  // (declared, not just accepted) layer's version when every accepted layer is empty.
  let version = layers[0]?.version ?? "0.0.0";
  for (const layer of acceptedLayers) {
    if (layer.items.length > 0) version = layer.version;
  }

  return { merged: { version, rules }, voidedLayers, inertMandatoryDeclarations };
}

/**
 * POST-S6 DISPOSITION (kept, not removed — see the block comment above `mergeLayersWithMandatoryLock`
 * for the full reasoning): once S6's `loader.ts` wires `mergeLayersWithMandatoryLock` as the live
 * POL-08 merge path, this function has ZERO production callers left — its only remaining call
 * sites are its own test (precedence.test.ts) plus two out-of-scope tests (kernel.test.ts,
 * normalizer/registry.test.ts). It is not deprecated or scheduled for deletion; it exists purely
 * as a tested reference shape for the plain (non-mandatory-locking) merge semantics. Do not mistake
 * it for the real, live merge path.
 *
 * Deterministic three-layer merge, in the exact precedence order POL-08 names: `shippedDefaults`
 * applies first, `central` next (overriding any rule id it also defines), `project` last
 * (overriding both). A rule id present in only one layer passes through unchanged, tagged with
 * that layer's name. Rule order in the output follows first-appearance order across the three
 * layers (shipped-defaults, then central, then project) — deterministic and stable regardless of
 * which layer's VALUE ultimately won.
 *
 * `version` resolves to `project`'s version when `project` defines any rule, else `central`'s,
 * else `shippedDefaults`'s — the effective configuration's version is the version of whichever
 * layer actually has the final say over at least one rule.
 */
export function mergeLayers(shippedDefaults: RuleSet, central: RuleSet, project: RuleSet): MergedRuleSet {
  const layers: { name: LayerName; items: readonly Rule[] }[] = [
    { name: "shipped-defaults", items: shippedDefaults.rules },
    { name: "central", items: central.rules },
    { name: "project", items: project.rules },
  ];

  const { order, byId } = mergeLayersById(layers, (rule) => rule.id);

  const version =
    project.rules.length > 0 ? project.version : central.rules.length > 0 ? central.version : shippedDefaults.version;

  const rules: MergedRule[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) rules.push({ ...entry.item, sourceLayer: entry.sourceLayer });
  }

  return { version, rules };
}

/**
 * SUR-03 / T5: two-tier tool-classification merge — shipped defaults, then central (overriding
 * any tool name it also defines). No `project` layer: the 2026-09-01 S3-intake ruling names this
 * catalog "shipped defaults + central override, central wins" only, unlike POL-08's three-tier
 * rule precedence. `version` resolves to `central`'s version when `central` classifies any tool,
 * else `shippedDefaults`'s — same resolution rule as `mergeLayers`, one tier shorter.
 */
export function mergeToolClassificationLayers(
  shippedDefaults: ToolClassificationSet,
  central: ToolClassificationSet,
): MergedToolClassificationSet {
  const layers: { name: LayerName; items: readonly ToolClassificationEntry[] }[] = [
    { name: "shipped-defaults", items: shippedDefaults.tools },
    { name: "central", items: central.tools },
  ];

  const { order, byId } = mergeLayersById(layers, (entry) => entry.name);

  const version = central.tools.length > 0 ? central.version : shippedDefaults.version;

  const tools: MergedToolClassification[] = [];
  for (const name of order) {
    const entry = byId.get(name);
    if (entry) tools.push({ ...entry.item, sourceLayer: entry.sourceLayer });
  }

  return { version, tools };
}
