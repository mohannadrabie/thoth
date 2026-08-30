// Shared CLI reporting shape for every QA/OSS instrument, so "0 items found" is disclosed the
// same, loud way everywhere instead of each script inventing its own silent-pass wording.
export interface InstrumentResult {
  ok: boolean;
  /** True when `ok` is true only because there was nothing real to check yet. */
  vacuous: boolean;
  summary: string;
  details: string[];
}

export function printInstrumentResult(name: string, result: InstrumentResult): void {
  const tag = result.ok ? (result.vacuous ? "VACUOUS-PASS" : "PASS") : "FAIL";
  console.log(`[${name}] ${tag}: ${result.summary}`);
  for (const d of result.details) console.log(`  - ${d}`);
  if (result.vacuous) {
    console.log(
      `[${name}] NOTE: vacuous pass — no real content exists yet for this check to act on. ` +
        `This is disclosed, not silent; it is not evidence the mechanism works. See this ` +
        `instrument's own self-tests (node --test) for that proof.`,
    );
  }
}

export function exitCodeFor(result: InstrumentResult): number {
  return result.ok ? 0 : 1;
}
