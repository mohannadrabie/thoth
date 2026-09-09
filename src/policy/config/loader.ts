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

export interface LoadedLayer {
  name: LayerName;
  ruleSet: RuleSet;
  /** File path for shipped-defaults/project; the channel descriptor string for central. */
  origin: string;
  /** 1-indexed line each `ruleSet.rules[i]` object opens on — index-aligned with `ruleSet.rules`. */
  ruleLines: number[];
}

export type LoadFailureReasonKind = "json-parse-error" | "schema-invalid" | "read-error";

export interface LoadFailure {
  ok: false;
  reasonKind: LoadFailureReasonKind;
  message: string;
  /** The central channel's own status, when known. Absent ONLY for reasonKind "read-error" — the
   * one failure shape where `centralSource.read()` itself never returned a status at all. */
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

function isParseFailure(x: ParsedLayer | ParseFailure): x is ParseFailure {
  return "error" in x;
}

export function loadEffectivePolicy(input: LoadEffectivePolicyInput): LoadResult {
  // --- the ONE central read (single-read invariant, AC2/Attack F) ---
  let centralResult: CentralPolicyResult;
  try {
    centralResult = input.centralSource.read();
  } catch (err) {
    return { ok: false, reasonKind: "read-error", message: (err as Error).message };
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
        centralStatus: "present",
        centralChannel,
      };
    }
    centralRuleSet = parsed.ruleSet;
    centralRuleLines = parsed.ruleLines;
  }
  // status "absent"/"unsupported": centralRuleSet stays empty, contributes zero rules -- NOT a
  // rejection (AC5a).

  const shippedText = readFileSync(input.shippedDefaultsPath, "utf8");
  const shippedParsed = parseLayerText(input.shippedDefaultsPath, shippedText);
  if (isParseFailure(shippedParsed)) {
    return { ok: false, reasonKind: shippedParsed.error, message: shippedParsed.message, centralStatus: centralResult.status, centralChannel };
  }

  const projectText = readFileSync(input.projectPolicyPath, "utf8");
  const projectParsed = parseLayerText(input.projectPolicyPath, projectText);
  if (isParseFailure(projectParsed)) {
    return { ok: false, reasonKind: projectParsed.error, message: projectParsed.message, centralStatus: centralResult.status, centralChannel };
  }

  const namedLayers: NamedRuleLayer[] = [
    { name: "shipped-defaults", version: shippedParsed.ruleSet.version, items: shippedParsed.ruleSet.rules },
    { name: "central", version: centralRuleSet.version, items: centralRuleSet.rules },
    { name: "project", version: projectParsed.ruleSet.version, items: projectParsed.ruleSet.rules },
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
  };
}
