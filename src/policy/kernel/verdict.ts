// Pure result type the kernel returns. No standalone .test.ts — pure interface/type declarations
// with zero runtime logic (see rule-types.ts's header comment for the convention this follows);
// `npm run typecheck` is its check. Behavior that PRODUCES a Verdict is tested where it lives
// (kernel.test.ts).

export type VerdictOutcome = "allow" | "deny";

export interface Verdict {
  outcome: VerdictOutcome;
  /** Human-readable reason — always populated, never blank, so a denial is always explainable. */
  reason: string;
  /** The rule id that produced this verdict, when one did (POL-05's fail-closed verdict, and the
   * "no rule matched" fallback, carry no rule id). */
  ruleId?: string;
}
