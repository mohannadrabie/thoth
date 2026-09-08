// POL-10 (S6): "The resolved effective policy shall be printable with the origin file and line of
// every rule ... One command answers 'why is this blocked' without reading a script."
//
// Contract locked down by test-writer's RED-CONFIRMED printer.test.ts (see that file's own header
// for the full grammar and every INTERPRETATION CHOICE made) — this file builds to that answer
// key unmodified. `printEffectivePolicy()` NEVER throws: every failure (a bad shipped-defaults/
// project file, `centralSource.read()` itself throwing, malformed/schema-invalid central content)
// is caught and turned into a `PrinterResult` with `exitCode: 1`.
//
// Built on top of loader.ts's `loadEffectivePolicy()` — the SAME pipeline story-implementer's own
// loader/precedence/pin unit tests exercise directly — not a second, parallel implementation of
// the merge/validation logic (architecture-reviewer S6 pre-build finding 1's "one merge core"
// concern, applied one layer up: one load pipeline, one renderer on top of it).
import { loadEffectivePolicy, type LoadFailureReasonKind, type LoadSuccess } from "./loader.ts";
import type { CentralPolicySource } from "./central-source.ts";
import type { PolicyPin } from "./pin.ts";

export interface PrinterInput {
  shippedDefaultsPath: string;
  projectPolicyPath: string;
  centralSource: CentralPolicySource;
}

// Stage-3 round-1 fix-now (2026-09-08), Issue #109 [MED]: this printer answers "why is this
// blocked" from S6's own RESOLVED policy (loadEffectivePolicy) — it does NOT necessarily match what
// hooks/pretooluse-kernel-gate.mjs enforces LIVE today. That hook stays on its own, separate
// loadBootstrapRuleSet() path this story (docs/decisions.md's S6 plan-ratification row, item 3 —
// deliberately not rewired, to avoid opportunistic scope-widening into hook-surface territory).
// Exported so print-cli.ts (and any other consumer) can surface it without duplicating the text.
export const ENFORCEMENT_DISCLOSURE =
  "NOTE: this reflects S6's own resolved policy (loadEffectivePolicy) -- it is not necessarily what hooks/pretooluse-kernel-gate.mjs enforces live today (that hook still reads via its own, separate loadBootstrapRuleSet() path; see docs/decisions.md's S6 plan-ratification row).";

export interface PrinterResult {
  stdout: string;
  exitCode: number;
  /** POL-09 (Issue #111 [MED]): the resolved central-channel pin, when the load succeeded
   * (`undefined` on a fail-closed rejection -- loader.ts never computes one for a rejected load).
   * Deliberately kept OUT of `stdout` rather than appended into that string: test-writer's
   * `printer.test.ts` asserts `stdout` by EXACT string equality across every one of its fixtures
   * (its own locked answer key, authored before this fix-now round existed) -- appending a pin line
   * there would silently break a test this project's own DoD forbids editing. `print-cli.ts` is the
   * real place an operator sees this value, printed as its own trailing line. */
  pin?: PolicyPin | undefined;
  /** Issue #109 [MED]: always populated with `ENFORCEMENT_DISCLOSURE` above -- kept OUT of `stdout`
   * for the identical locked-test reason `pin` is above. */
  disclosure: string;
}

function centralStatusLine(centralStatus: "absent" | "unsupported" | "present" | undefined, centralChannel: string | undefined): string {
  if (centralStatus === undefined) return "central-channel status=read-error";
  if (centralStatus === "present") return `central-channel status=present channel=${centralChannel}`;
  return `central-channel status=${centralStatus}`;
}

function renderRejection(
  reasonKind: LoadFailureReasonKind,
  message: string,
  centralStatus: "absent" | "unsupported" | "present" | undefined,
  centralChannel: string | undefined,
): PrinterResult {
  const stdout = [centralStatusLine(centralStatus, centralChannel), `REJECTED: central policy load failed (${reasonKind}): ${message}`].join(
    "\n",
  );
  return { stdout, exitCode: 1, disclosure: ENFORCEMENT_DISCLOSURE };
}

function renderSuccess(result: LoadSuccess): PrinterResult {
  const lines = [centralStatusLine(result.centralStatus, result.centralChannel)];
  // Issue #108 [MED]: a mandatory-lock collision no longer rejects the whole load (see loader.ts's
  // own header) -- it voids only the offending layer. Named here, attributed to the OFFENDING
  // layer by NAME (red-team finding 3(b): never blamed on "central policy" when central itself was
  // innocent or absent). Every one of test-writer's own printer.test.ts fixtures has ZERO voided
  // layers, so this loop is a strict no-op against every locked assertion in that file.
  for (const v of result.voidedLayers) {
    lines.push(`VOIDED: layer "${v.layer}" rejected in its entirety: rule id "${v.ruleId}" redefines a mandatory rule from an earlier layer`);
  }
  lines.push(`--- resolved rules (${result.merged.rules.length}) ---`);
  const layersByName = new Map(result.layers.map((l) => [l.name, l]));
  for (const rule of result.merged.rules) {
    const layer = layersByName.get(rule.sourceLayer);
    const idxInLayer = layer?.ruleSet.rules.findIndex((r) => r.id === rule.id) ?? -1;
    const line = idxInLayer >= 0 ? (layer?.ruleLines[idxInLayer] ?? -1) : -1;
    const origin = layer?.origin ?? "(unknown)";
    lines.push(`rule id=${rule.id} effect=${rule.effect} layer=${rule.sourceLayer} origin=${origin} line=${line} mandatory=${rule.mandatory ?? false}`);
  }
  return { stdout: lines.join("\n"), exitCode: 0, pin: result.pin, disclosure: ENFORCEMENT_DISCLOSURE };
}

export function printEffectivePolicy(input: PrinterInput): PrinterResult {
  try {
    const result = loadEffectivePolicy(input);
    if (!result.ok) {
      return renderRejection(result.reasonKind, result.message, result.centralStatus, result.centralChannel);
    }
    return renderSuccess(result);
  } catch (err) {
    // Never throw (test-writer's own contract): an unexpected exception anywhere in the pipeline
    // (e.g. a shipped-defaults/project file that cannot be read at all) is caught here and turned
    // into a read-error-shaped rejection, the same uniform failure shape as every other bucket.
    return renderRejection("read-error", (err as Error).message, undefined, undefined);
  }
}
