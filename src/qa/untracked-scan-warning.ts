// GitHub Issue #182: both QA-14 probes (marker-corpus-probe.ts and continuation-residual-probe.ts)
// take their file list from `git ls-files --cached --others --exclude-standard`, so an untracked,
// not-gitignored scratch file inside the working tree changes the number they publish, and the
// number then drifts from one session to the next with nothing on screen saying why.
//
// Human ruling (2026-09-19): the number and stdout are NOT changed. The probe warns on stderr instead
// — it names how many untracked files the scan reads and lists up to `UNTRACKED_WARNING_PATH_CAP` of
// them. stdout stays exactly the single machine-checked figure `completeness-claim-checker.ts` reads.
//
// One shared implementation so the two probes cannot drift. The untracked set is read here, through
// an injected `Runner`, rather than by adding a method to `src/lib/git.ts`: that file is shared with
// the secret scan and the QA-14 resolver, and this needs only the `--others` half of what
// `GitOps.lsFilesWorkingTree()` already reads (same git arguments and exclusions, plus the probes' own `shouldScanFile` filter).
import type { Runner } from "../lib/exec.ts";
import { shouldScanFile } from "./reference-resolver.ts";

/** How many untracked paths the warning lists before it says "and N more". */
export const UNTRACKED_WARNING_PATH_CAP = 10;

/**
 * The warning text, or `null` when no untracked scannable file is in the scan. Only entries the
 * probes' own reader would scan count: a trailing-slash entry is git's report of an untracked nested
 * repository (a directory, never read), and `shouldScanFile` skips `*.test.ts`. A non-zero git exit
 * throws — a failed read must not turn into "no warning".
 */
export async function untrackedScanWarning(runner: Runner, repoRoot: string): Promise<string | null> {
  const res = await runner("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.code !== 0) {
    throw new Error(`git ls-files -z --others --exclude-standard failed (exit ${res.code}): ${res.stderr}`);
  }
  const untracked = res.stdout.split("\0").filter((p) => p.length > 0 && !p.endsWith("/") && shouldScanFile(p));
  if (untracked.length === 0) return null;

  const listed = untracked.slice(0, UNTRACKED_WARNING_PATH_CAP).map((p) => `  - ${p}`);
  const omitted = untracked.length - UNTRACKED_WARNING_PATH_CAP;
  if (omitted > 0) listed.push(`  ... and ${omitted} more`);
  return [
    `WARNING: ${untracked.length} untracked file(s) are inside the counted number, so it changes when scratch files come and go:`,
    ...listed,
    "Commit, delete, or .gitignore them for a reproducible number. (The count itself is unchanged.)",
  ].join("\n");
}

/** Writes the warning once through `write` (the caller passes its stderr sink), or writes nothing. */
export async function warnIfUntrackedScannable(
  runner: Runner,
  repoRoot: string,
  write: (message: string) => void,
): Promise<void> {
  const warning = await untrackedScanWarning(runner, repoRoot);
  if (warning !== null) write(warning);
}
