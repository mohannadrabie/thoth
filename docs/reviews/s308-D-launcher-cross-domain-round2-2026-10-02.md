# #308 story D (AP-13 launcher): cross-domain re-confirm, round 2 (delta 911e518..561227b)

[cross-domain-reviewer] Ra. Tier CRITICAL. Lanes: app-security (round 2 report present), red-team round 2 (parallel). ADR cache: 📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] (fp 702b16a) [CACHE=HIT]. Whole catalog read.

## Round-1 items
- #401 MED: CARRIED. K5 `K-pretooluse-entry-uses-launcher` (plan line ~168) names all five mutants (bare node, `|| true`, `; exit 0`, echo, bash for sh) and requires byte-for-byte equality incl. interpreter word. Carried as a plan row; the check does not exist yet (K is held), so #401 stays open until K ships. Correct state.
- LOW 2: CARRIED as J6a (times `sh "<launcher>" "<gate>"` against the 2000 ms ceiling).
- LOW 3: CARRIED as F1b (names hooks/launch-gate.sh and src/qa/gate-launcher-pin-check.ts).
- Linux CI: CONFIRMED. `gh run view 37087817419 --log`: `# tests 1870 / # pass 1867 / # fail 0 / # skipped 3`; job "Lint, typecheck, test, QA/OSS instruments" success. Skips are the three win32-only tests named in the brief (I did not enumerate skip names from the log; count matches).

## Local runs (this machine, win32)
`node --experimental-strip-types --test src/qa/gate-launcher.test.ts src/policy/config/hook-import-pins.test.ts` -> tests 76, pass 76, fail 0, skipped 0 (win32 tests ran).
sha256(hooks/launch-gate.sh) = 6c7525336c7ed11f2ce92840d5d81304bd4fc5fc554d8f4f0ec365744b01b5d5 = PINNED_SHA256 in gate-launcher-pin-check.ts (pin matches the edited shim).

## Cross-domain ADR verdict (delta)
- SE ADR-0005 (locked-test edits as a recorded act): the header-sentence reword is recorded in the new decisions row item (3) with reason (sweep proves "non-empty truncation exits 2"); D5 test regex updated in the same commit. Compliant. The row says "none" for reviewer and "Y (pre-approved)"; consistent with the prior row's form.
- AC-3j-4 (hook-import-pins.test.ts:344, pins on src/policy/config/central-source.ts:108 `env.SystemRoot || env.windir || "C:\Windows"`): pins READ sites in the gate's import graph, not what the launcher supplies; the launcher change touches no gate-graph source, so the pin is unaffected (76/76 above).
- THOTH-ADR-0003 (proposed, not accepted): launcher is a protected path via F1a/F1b; the pin file named by F1b. No new collision.
- F/J/K plan rows: consistent with decisions row; no contradiction.
- No new ADR collision.

## Seam findings
1. [SUSPICION][LOW][derived] central-source.ts:108 + hooks/launch-gate.sh: the launcher now depends on the MSYS runtime supplying SystemRoot/windir to the env -i child; if it ever does not (non-Git-Bash sh, or a future MSYS change), the gate silently falls to the hardcoded `C:\Windows` and runs the reg.exe lookup from there (fails to the wrong root on a non-standard Windows install, not fail-open). Evidence is the measured S10 on one machine/one Git Bash. Settling test already exists (`D2-systemroot-from-runtime`, win32 CI is not run; Linux CI skips it). Residual: no Windows CI runner proves it; name it in the residual register. Not blocking.
2. [CLEAN] Git Bash dependence is already a disclosed precondition (decisions row item 5); the new reliance is the same class. Backstop System32 check retained.

## Editorial
- docs/plans/s308-D-launcher-plan-2026-10-02.md lines 45 and 129 still say the allow-list preserves SYSTEMROOT/windir; superseded by the new decisions row (old text is append-only history, so annotate rather than edit if desired).
- Test title D5-header-names-launcher still says "empty or truncated launcher exits 0"; the asserted header sentence is now narrower.

## Coverage gaps
None new. Windows-only behavior (D2-systemroot-from-runtime) has no CI runner: intentionally accepted, covered by local run above.

## Verdict
APPROVE-WITH-CONDITIONS: K5 must land with K (carries #401, which stays open); keep LOW suspicion 1 in the residual register. Single next action: proceed to K with K5 and its five mutants as the first failing tests.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][LOW][derived] central-source.ts:108 / hooks/launch-gate.sh: relies on MSYS supplying SystemRoot; no Windows CI runner; residual-register line
2. [CLEAN][code-traced] #401/K5, J6a, F1b carry the round-1 items; K5 has five mutants
3. [CLEAN][demonstrated] Linux CI run 37087817419: 1870 tests, 1867 pass, 0 fail, 3 skipped
4. [CLEAN][demonstrated] SE ADR-0005 recorded act, AC-3j-4 pins (76/76 local), pin hash matches shim, THOTH-ADR-0003 consistent
counts: issues=0 suspicions=1 clean=3
evidence: demonstrated=2 code-traced=1 derived=1
checks=node --test gate-launcher+hook-import-pins: 76 pass / 0 fail / 0 skip; gh run log: 1870/1867/0/3
adr=HIT(38, whole catalog)
report=docs/reviews/s308-D-launcher-cross-domain-round2-2026-10-02.md
