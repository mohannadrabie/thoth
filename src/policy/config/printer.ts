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
import { loadEffectivePolicy, type FailedLayerName, type LoadFailureReasonKind, type LoadSuccess, type ResolvedPosture } from "./loader.ts";
import type { CentralPolicySource } from "./central-source.ts";
import type { PolicyPin } from "./pin.ts";

export interface PrinterInput {
  shippedDefaultsPath: string;
  projectPolicyPath: string;
  centralSource: CentralPolicySource;
}

// Stage-3 round-1 fix-now (2026-09-08), Issue #109 [MED], REWRITTEN by S7 (2026-09-26): this printer
// answers "why is this blocked" from the RESOLVED policy (loadEffectivePolicy). Since S7 the kernel-gate
// hook reads the SAME loader (rules and the resolved posture, Issue #288), but that hook is NOT WIRED
// into .claude/settings.json (no PreToolUse entry), so nothing is enforced live from this policy today.
// This literal must stay TRUE: printer.test.ts AC-P5 derives the wiring state from .claude/settings.json
// and requires this text to equal the matching literal EXACTLY, so wiring the hook (activation) forces
// a deliberate update here. Exported so print-cli.ts (and any other consumer) can surface it without
// duplicating the text.
export const ENFORCEMENT_DISCLOSURE =
  "NOTE: this reflects S6's own resolved policy (loadEffectivePolicy). hooks/pretooluse-kernel-gate.mjs reads the same loader but is not wired into .claude/settings.json (no PreToolUse entry), so nothing is enforced live from this policy today.";

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
  /** Issue #114 [HIGH] fix, loud-disclosure condition (Stage-3 round 3, 2026-09-08 council ruling,
   * Path B): a `mandatory: true` declaration with no real locking force (today: any
   * shipped-defaults/project declaration -- see precedence.ts's TRUST_RANK header) is reported
   * here, never silently dropped. Kept OUT of `stdout` for the identical locked-test reason `pin`
   * and `disclosure` are above -- empty on a fail-closed rejection (no lock result to report). */
  inertMandatoryDeclarations: readonly { layer: string; ruleId: string }[];
  /** R4 / Issue #288 precondition 1 (S7): the loader's resolved baseline posture and the layer that
   * supplied it (`LoadSuccess.defaultOutcome`), or `undefined` on a fail-closed rejection (no
   * posture is resolved). Kept OUT of `stdout` for the identical locked-test reason `pin` and
   * `disclosure` are above. */
  posture?: ResolvedPosture | undefined;
  /** The one-line operator rendering of `posture`, printed by print-cli.ts. Names the SOURCE and never
   * claims more than the merge does: a lower-trust layer's ALLOW RULE can still allow what a central
   * posture denies (Issue #288 precondition 2, printer.test.ts AC-P7). */
  postureLine: string;
}

const POSTURE_LINE_REJECTED = "posture: unresolved (policy load rejected)";

/** printer.test.ts AC-P2 pins these strings exactly. */
export function renderPostureLine(posture: ResolvedPosture): string {
  if (posture.source === "bootstrap") return `posture: ${posture.outcome} (source: bootstrap; no layer declared a posture)`;
  if (posture.source === "central") return `posture: ${posture.outcome} (source: central; rules from lower-trust layers can still allow)`;
  return `posture: ${posture.outcome} (source: ${posture.source}; in-repo layer, not centrally enforced; rules from other layers can still allow)`;
}

function centralStatusLine(centralStatus: "absent" | "unsupported" | "present" | undefined, centralChannel: string | undefined): string {
  if (centralStatus === undefined) return "central-channel status=read-error";
  if (centralStatus === "present") return `central-channel status=present channel=${centralChannel}`;
  return `central-channel status=${centralStatus}`;
}

// Issue #108 [MED] fix (Stage-3 round-4 residual, test-writer's amended/RED-CONFIRMED
// printer.test.ts): `failedLayer` names WHICHEVER layer actually produced the failure — never
// hardcoded to "central" regardless of the true offender. See loader.ts's own header for the full
// history of why this half of the fix landed separately from the mandatory-lock (voidedLayers) half.
function renderRejection(
  reasonKind: LoadFailureReasonKind,
  message: string,
  failedLayer: FailedLayerName,
  centralStatus: "absent" | "unsupported" | "present" | undefined,
  centralChannel: string | undefined,
): PrinterResult {
  const stdout = [centralStatusLine(centralStatus, centralChannel), `REJECTED: ${failedLayer} policy load failed (${reasonKind}): ${message}`].join(
    "\n",
  );
  return { stdout, exitCode: 1, disclosure: ENFORCEMENT_DISCLOSURE, inertMandatoryDeclarations: [], posture: undefined, postureLine: POSTURE_LINE_REJECTED };
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
  return {
    stdout: lines.join("\n"),
    exitCode: 0,
    pin: result.pin,
    disclosure: ENFORCEMENT_DISCLOSURE,
    inertMandatoryDeclarations: result.inertMandatoryDeclarations,
    posture: result.defaultOutcome,
    postureLine: renderPostureLine(result.defaultOutcome),
  };
}

export function printEffectivePolicy(input: PrinterInput): PrinterResult {
  try {
    const result = loadEffectivePolicy(input);
    if (!result.ok) {
      return renderRejection(result.reasonKind, result.message, result.failedLayer, result.centralStatus, result.centralChannel);
    }
    return renderSuccess(result);
  } catch (err) {
    // Never throw (test-writer's own contract): a genuinely unexpected exception outside every
    // named failure shape loader.ts itself already catches (Issue #108 fix: shipped-defaults/
    // project readFileSync and centralSource.read() are now all wrapped there) is caught here as a
    // last resort and turned into a read-error-shaped rejection. `failedLayer` defaults to
    // "central" in this backstop only, since the true origin is genuinely unknown at this point —
    // every NAMED failure shape (the common case) is already attributed correctly by loader.ts.
    return renderRejection("read-error", (err as Error).message, "central", undefined, undefined);
  }
}
