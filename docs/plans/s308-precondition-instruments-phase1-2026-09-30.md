# Addendum: #308 precondition instruments (S1, S3, S4)

Date: 2026-09-30. Author: story-implementer (Ptah). Parent plan: `docs/plans/s308-activation-phase1-2026-09-30.md` sections 3 and 5; ruling Q2 (AC-3j includes AC-3j-4) in `docs/decisions.md`, 2026-09-30 "#308 activation".
ADR cache: HIT (37 ADRs). No ADR is applicable to test-only instruments (no rule to quote). Tier STANDARD (Manager-ratified). No production code changes; `test-writer` not dispatched (no UI or API surface).

## AC to named test

| AC | Test file | Named test(s) |
|---|---|---|
| AC-3j-1 pair pin | `src/policy/config/hook-import-pins.test.ts` | "AC-3j-1: the namespace.member pairs ... EXACTLY the pinned allow-set" |
| AC-3j-2 no evasion | same | "AC-3j-2: no namespace is used bare, aliased, ..." |
| AC-3j-3 exports exist, no env-reader pair | same | "AC-3j-3: every pinned pair resolves to an export ..." |
| AC-3j-4 transitive env-read pin | same | "AC-3j-4: env reads reachable ... EXACTLY the pinned allow-set"; "graph is fully resolved"; "nothing in the graph references projectDir" |
| AC-3j-5 controls | same | "AC-3j-5 ..." (positive control, new pair, 9 namespace evasions, seventh import, second destructure, 10 env-read shapes, graph-level control, bare-package import) |
| AP-12 (S3) | `src/qa/arbitrary-exec-classification.test.ts` | "AP-12: no arbitrary-execution tool ... classifiable read-only"; "AP-12: an inventory that gains an AP-12 name without a classification throws"; seeded mutants (Bash read-only, real merge with a lowering Task entry, each AP-12 name as a read-only fixture entry, case, unknown class); positive control |
| R1-6c (S4) | `src/qa/catalog-single-source.test.ts` | "R1-6c: every catalog definition site, call site, `catalog` writer and type holder ... pinned"; "R1-6c: the hook's loadCatalog is exactly the assembleCatalog funnel"; positive control; 10 implementation mutants; enumeration mutants |

## Design notes

- AC-3j-4 pin is module-level over the relative-import graph rooted at the hook's six imports. It also pins `classification-catalog.ts projectDir` (env and cwd reads), which the hook's pairs cannot reach; a separate test proves nothing in the graph references `projectDir`. The plan text named only the `SystemRoot`/`windir` read; the `projectDir` entries are the true disclosed addition the scan surfaced. The `child_process` import entry is NOT an addition: the activation plan's AC-3j-4 row already listed `child_process` among the scanned tokens, and the scan simply pinned the one existing import. (Round-2 correction of an earlier overstatement that called both "additions".) Round 2 also keys sites by occurrence count and adds ambient code-eval routes and node:fs/net built-ins; see the header of `src/policy/config/hook-import-pins.test.ts`.
- The env-reader function names used by AC-3j-3 are derived from the AC-3j-4 scan, not typed.
- AP-12: the vendored inventory has none of the five named tools (AP-2 re-vendor pending), so the real assertion covers the arbitrary-execution built-ins present (`Bash`, `SlashCommand`, `Task`, added by this instrument as a tightening) and pins that a re-vendored name without a classification throws.
- R1-6c: coverage versus #355 shapes 3 and 4 is stated in the file header: not covered by design; exposure measured by the R1-6b real-tree scan.
- Failing-first: each pin was proven able to fail against a seeded mutant of the real files (reverted): results in the build receipt.
