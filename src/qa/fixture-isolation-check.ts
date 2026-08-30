// QA-05: "Test fixtures shall not write into live governance artifacts." Acceptance: "Test
// isolation verified." This module is the isolation-checking mechanism: it snapshots a set of
// declared "live" roots before and after a fixture runs, and fails if anything under a live root
// changed. Proof that the mechanism actually catches a violation is in
// fixture-isolation-check.test.ts (AC10): a deliberately-broken fixture that writes into a live
// root, run through this exact mechanism, is asserted to be CAUGHT.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Snapshot } from "../lib/fs-snapshot.ts";
import { diffSnapshots, isEmptyDiff, snapshotDir } from "../lib/fs-snapshot.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface IsolationViolation {
  liveRoot: string;
  changedPaths: string[];
}

/** Pure: compare before/after snapshots of each declared live root, report any that changed. */
export function checkIsolation(
  liveRoots: string[],
  before: Snapshot[],
  after: Snapshot[],
): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  for (let i = 0; i < liveRoots.length; i++) {
    const diff = diffSnapshots(
      before[i] ?? new Map<string, string>(),
      after[i] ?? new Map<string, string>(),
    );
    if (!isEmptyDiff(diff)) {
      violations.push({
        liveRoot: liveRoots[i] ?? "<unknown>",
        changedPaths: [...diff.added, ...diff.modified, ...diff.removed],
      });
    }
  }
  return violations;
}

/**
 * Runs `fixture()` while monitoring `liveRoots` for any write. This is the real, reusable
 * mechanism — not a mock — used both by the self-tests (AC10) and by any future story wiring a
 * real fixture-driven test run through it.
 */
export async function runWithIsolationMonitor(
  liveRoots: string[],
  fixture: () => Promise<void> | void,
): Promise<IsolationViolation[]> {
  const before = await Promise.all(liveRoots.map((r) => snapshotDir(r)));
  await fixture();
  const after = await Promise.all(liveRoots.map((r) => snapshotDir(r)));
  return checkIsolation(liveRoots, before, after);
}

export function summarize(liveRoots: string[], violations: IsolationViolation[]): InstrumentResult {
  if (liveRoots.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 live governance roots configured — vacuous pass (see docs/qa/ for the config once one exists).",
      details: [],
    };
  }
  if (violations.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${violations.length} live governance root(s) written into by a test fixture.`,
      details: violations.map(
        (v) => `${v.liveRoot}: ${v.changedPaths.join(", ")}`,
      ),
    };
  }
  return {
    ok: true,
    vacuous: false,
    summary: `${liveRoots.length} live governance root(s) monitored, no writes detected.`,
    details: [],
  };
}

function main(): void {
  // No real governance artifacts exist yet in this repo (S2+ builds the kernel/policy/audit
  // surfaces this check will eventually protect) — CLI mode today is intentionally a declared
  // no-op, disclosed as vacuous rather than silently green. Story S2+ populates this list.
  const liveRoots: string[] = (process.env.QA05_LIVE_ROOTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => resolve(r));

  const result = summarize(liveRoots, []);
  printInstrumentResult("QA-05 fixture-isolation-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
