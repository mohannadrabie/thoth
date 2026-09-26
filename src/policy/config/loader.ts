// POL-08/POL-07/POL-09 (S6): `loadEffectivePolicy()` reads all three policy tiers
// (shipped-defaults, central, project), validates + mandatory-locks + merges them via
// src/policy/rule/precedence.ts's `mergeLayersWithMandatoryLock`, and computes POL-09's pin over
// the EXACT bytes that fed the merge.
//
// Single-read invariant (design-challenger S6 Attack F, AC2): `centralSource.read()` is called
// EXACTLY ONCE per invocation — at the very top of this function, before shipped-defaults/project
// are even touched. The one `CentralPolicyResult` it returns is threaded through both the merge
// (via `centralRuleSet`) and `pin.ts`'s hash computation (via `centralRaw`). No other call site in
// this file (or in pin.ts — see that file's own header) ever calls `.read()` again.
//
// Fail-closed, three named states, each independently reachable (design-challenger S6 Attack B,
// AC5a/b/c):
//   AC5a — central "absent"/"unsupported": contributes ZERO rules, load is NOT rejected.
//   AC5b — central "present" but content invalid: (i) JSON.parse throws, (ii) JSON parses but
//          validateRuleSet() reports schema errors — BOTH land in the same "whole load rejected"
//          bucket, never silently treated as absent.
//   AC5c — centralSource.read() itself throws (simulated subprocess failure/timeout/oversized
//          output) — whole load rejected, distinct reasonKind, never silently treated as absent.
//
// A mandatory-lock collision (AC1/AC9) is NOT a fifth failure shape (Stage-3 round-1 fix-now,
// 2026-09-08, Issue #108 [MED] — see precedence.ts's own header for the full reasoning): it no
// longer voids the whole load, only the OFFENDING layer's own contribution — a project-layer
// collision with a central mandatory rule must never suppress central's (or shipped-defaults')
// rules too, which the original whole-load-rejection behavior did. `LoadSuccess.voidedLayers`
// carries which layer(s), if any, were dropped and why, so printer.ts can name the OFFENDING
// layer directly rather than misattributing it to "central policy load failed" when central itself
// was innocent (or absent).
//
// The SAME "never misattribute to central" bar applies to the FAIL-CLOSED path too, and that half
// was not actually built until this later fix-now round (Stage-3 round-4 residual, Issue #108
// [MED] REOPENED, red-team round 4 — test-writer's amended, RED-CONFIRMED `printer.test.ts`,
// docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md): a project/shipped-defaults parse
// failure previously produced a `LoadFailure` with no layer field at all, so `printer.ts` defaulted
// to the literal string "central" unconditionally — exactly the misattribution this file's own
// comment above already warned against, just not yet closed on this path. `LoadFailure.failedLayer`
// (set on every one of this function's return sites, including the two now-wrapped
// shipped-defaults/project `readFileSync` calls, which previously could throw uncaught) closes it.
import { readFileSync } from "node:fs";
import type { RuleSet } from "../kernel/rule-types.ts";
import { validateRuleSet } from "../rule/schema.ts";
import {
  mergeLayersWithMandatoryLock,
  type InertMandatoryDeclaration,
  type LayerName,
  type MandatoryLockViolation,
  type MergedRuleSet,
  type NamedRuleLayer,
} from "../rule/precedence.ts";
import { findRulePositions, tokenize } from "./position-parser.ts";
import type { CentralPolicyResult, CentralPolicySource } from "./central-source.ts";
import { computePin, type PolicyPin } from "./pin.ts";
import { BOOTSTRAP_DEFAULT_OUTCOME } from "./bootstrap-ruleset.ts";
import type { VerdictOutcome } from "../kernel/verdict.ts";

export interface LoadedLayer {
  name: LayerName;
  ruleSet: RuleSet;
  /** File path for shipped-defaults/project; the channel descriptor string for central. */
  origin: string;
  /** 1-indexed line each `ruleSet.rules[i]` object opens on — index-aligned with `ruleSet.rules`. */
  ruleLines: number[];
}

export type LoadFailureReasonKind = "json-parse-error" | "schema-invalid" | "read-error";

// Stage-3 fix-now (2026-09-08), Issue #108 [MED], test-writer amendment RED-CONFIRMED
// (docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md): the layer that ACTUALLY produced a
// LoadFailure, so printer.ts can name it directly instead of defaulting to "central" regardless of
// the true offender.
export type FailedLayerName = "central" | "shipped-defaults" | "project";

export interface LoadFailure {
  ok: false;
  reasonKind: LoadFailureReasonKind;
  message: string;
  /** Issue #108 fix: the layer whose file/channel actually caused this failure — set on every one
   * of this type's return sites, never left to be inferred/guessed by the caller. */
  failedLayer: FailedLayerName;
  /** The central channel's own status, when known. Absent ONLY for reasonKind "read-error" AND
   * `failedLayer === "central"` — the one failure shape where `centralSource.read()` itself never
   * returned a status at all. When a NON-central layer is the one that failed, central's own
   * (innocent) status is still reported here, never lost. */
  centralStatus?: CentralPolicyResult["status"];
  /** Populated only when `centralStatus === "present"`. */
  centralChannel?: string | undefined;
}

export interface LoadSuccess {
  ok: true;
  layers: LoadedLayer[];
  merged: MergedRuleSet;
  centralStatus: CentralPolicyResult["status"];
  centralChannel?: string | undefined;
  pin: PolicyPin;
  /** Issue #108 [MED]: layer(s) voided by a mandatory-id collision (empty when none). The load
   * still succeeds — every OTHER layer resolves normally. Issue #114 [HIGH] fix (Stage-3 round 3):
   * under the trust-rank check, the only entry this can ever contain today is
   * `{ layer: "project", ... }` — see precedence.ts's TRUST_RANK header for why. */
  voidedLayers: MandatoryLockViolation[];
  /** Issue #114 [HIGH] fix, loud-disclosure condition (Stage-3 round 3): a `mandatory: true`
   * declaration with no real locking force (today: any shipped-defaults/project declaration) is
   * never silently dropped — named here so printer.ts/print-cli.ts can disclose it. */
  inertMandatoryDeclarations: InertMandatoryDeclaration[];
  /** POL-01 (Issue #112): resolved baseline posture, resolved by trust rank -- see
   * precedence.ts's `resolveDefaultOutcome`. Always present on a successful load. */
  defaultOutcome: ResolvedPosture;
}

/** POL-01 (Issue #112): the resolved baseline posture -- what a caller passes as
 * `WorldFacts.defaultOutcome`. `source` names the layer that supplied it, or "bootstrap" when no
 * layer declared one (the code-literal fallback stays "allow"). Not in printer stdout (S7: the
 * printer exposes it as PrinterResult.posture and postureLine, printed by print-cli.ts). Since S7 the
 * kernel-gate hook (hooks/pretooluse-kernel-gate.mjs) passes it as WorldFacts.defaultOutcome instead
 * of a bootstrap constant; that hook is built but NOT WIRED into .claude/settings.json, so nothing
 * is enforced live from it today. */
export interface ResolvedPosture {
  outcome: VerdictOutcome;
  source: LayerName | "bootstrap";
}

export type LoadResult = LoadSuccess | LoadFailure;

export interface LoadEffectivePolicyInput {
  shippedDefaultsPath: string;
  projectPolicyPath: string;
  centralSource: CentralPolicySource;
}

type ParsedLayer = { ruleSet: RuleSet; ruleLines: number[] };
type ParseFailure = { error: "json-parse-error" | "schema-invalid"; message: string };

function parseLayerText(origin: string, text: string): ParsedLayer | ParseFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: "json-parse-error", message: `${origin}: ${(err as Error).message}` };
  }
  const errors = validateRuleSet(parsed, text);
  if (errors.length > 0) {
    return {
      error: "schema-invalid",
      message: `${origin}: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    };
  }
  const ruleSet = parsed as RuleSet;
  const positions = findRulePositions(tokenize(text));
  const ruleLines = ruleSet.rules.map((_, i) => positions[i]?.line ?? -1);
  return { ruleSet, ruleLines };
}

// exactOptionalPropertyTypes: an undeclared posture must be an ABSENT key, never `defaultOutcome: undefined`.
function namedLayer(name: LayerName, ruleSet: RuleSet): NamedRuleLayer {
  const base = { name, version: ruleSet.version, items: ruleSet.rules };
  return ruleSet.defaultOutcome === undefined ? base : { ...base, defaultOutcome: ruleSet.defaultOutcome };
}

function isParseFailure(x: ParsedLayer | ParseFailure): x is ParseFailure {
  return "error" in x;
}

export function loadEffectivePolicy(input: LoadEffectivePolicyInput): LoadResult {
  // --- the ONE central read (single-read invariant, AC2/Attack F) ---
  let centralResult: CentralPolicyResult;
  try {
    centralResult = input.centralSource.read();
  } catch (err) {
    return { ok: false, reasonKind: "read-error", message: (err as Error).message, failedLayer: "central" };
  }

  let centralRuleSet: RuleSet = { version: "0.0.0", rules: [] };
  let centralRuleLines: number[] = [];
  let centralChannel: string | undefined;
  let centralRawForPin: string | undefined;

  if (centralResult.status === "present") {
    centralChannel = centralResult.channel;
    centralRawForPin = centralResult.raw;
    const parsed = parseLayerText(centralResult.channel, centralResult.raw);
    if (isParseFailure(parsed)) {
      return {
        ok: false,
        reasonKind: parsed.error,
        message: parsed.message,
        failedLayer: "central",
        centralStatus: "present",
        centralChannel,
      };
    }
    centralRuleSet = parsed.ruleSet;
    centralRuleLines = parsed.ruleLines;
  }
  // status "absent"/"unsupported": centralRuleSet stays empty, contributes zero rules -- NOT a
  // rejection (AC5a).

  // Issue #108 fix: shipped-defaults/project readFileSync wrapped in try/catch, returning a typed
  // LoadFailure (failedLayer set, central's own already-known status/channel preserved) instead of
  // letting an unhandled exception propagate up to printer.ts's own last-resort catch, which had no
  // way to recover which layer -- or central's own innocent status -- was actually involved.
  let shippedText: string;
  try {
    shippedText = readFileSync(input.shippedDefaultsPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reasonKind: "read-error",
      message: `${input.shippedDefaultsPath}: ${(err as Error).message}`,
      failedLayer: "shipped-defaults",
      centralStatus: centralResult.status,
      centralChannel,
    };
  }
  const shippedParsed = parseLayerText(input.shippedDefaultsPath, shippedText);
  if (isParseFailure(shippedParsed)) {
    return { ok: false, reasonKind: shippedParsed.error, message: shippedParsed.message, failedLayer: "shipped-defaults", centralStatus: centralResult.status, centralChannel };
  }

  let projectText: string;
  try {
    projectText = readFileSync(input.projectPolicyPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reasonKind: "read-error",
      message: `${input.projectPolicyPath}: ${(err as Error).message}`,
      failedLayer: "project",
      centralStatus: centralResult.status,
      centralChannel,
    };
  }
  const projectParsed = parseLayerText(input.projectPolicyPath, projectText);
  if (isParseFailure(projectParsed)) {
    return { ok: false, reasonKind: projectParsed.error, message: projectParsed.message, failedLayer: "project", centralStatus: centralResult.status, centralChannel };
  }

  const namedLayers: NamedRuleLayer[] = [
    namedLayer("shipped-defaults", shippedParsed.ruleSet),
    namedLayer("central", centralRuleSet),
    namedLayer("project", projectParsed.ruleSet),
  ];

  const lockResult = mergeLayersWithMandatoryLock(namedLayers);

  const layers: LoadedLayer[] = [
    { name: "shipped-defaults", ruleSet: shippedParsed.ruleSet, origin: input.shippedDefaultsPath, ruleLines: shippedParsed.ruleLines },
    { name: "central", ruleSet: centralRuleSet, origin: centralChannel ?? `(${centralResult.status})`, ruleLines: centralRuleLines },
    { name: "project", ruleSet: projectParsed.ruleSet, origin: input.projectPolicyPath, ruleLines: projectParsed.ruleLines },
  ];

  // Issue #110 fix: the pin now covers shipped-defaults+central+project bytes, not central alone
  // — `shippedText`/`projectText` are already in hand from the reads above (zero new reads).
  const pin = computePin({
    centralStatus: centralResult.status,
    centralChannel,
    centralRaw: centralRawForPin,
    shippedRaw: shippedText,
    projectRaw: projectText,
  });

  return {
    ok: true,
    layers,
    merged: lockResult.merged,
    centralStatus: centralResult.status,
    centralChannel,
    pin,
    voidedLayers: lockResult.voidedLayers,
    inertMandatoryDeclarations: lockResult.inertMandatoryDeclarations,
    defaultOutcome: lockResult.defaultOutcome ?? { outcome: BOOTSTRAP_DEFAULT_OUTCOME, source: "bootstrap" },
  };
}
