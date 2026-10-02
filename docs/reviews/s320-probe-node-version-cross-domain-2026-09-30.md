# Cross-domain review — #320 (s320-probe-node-version), STANDARD, 678d932^..be8633b — 2026-09-30

[cross-domain-reviewer] Ra. ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]` — whole catalog, unfiltered.

Lanes: STANDARD; code-reviewer (cr320 worktree) covers correctness/tests. Diff = src/qa/gate-fail-open-probe.ts, its test, CHANGELOG.md. No hook, policy, CI, schema or API file touched.

## ADR verdict
No accepted ADR in any domain (devops, software-engineering, docs/adr) is engaged by a QA probe table + test + changelog edit; no collision. Kernel/hook/CI untouched.

## Seam checks
- Consumers of RECORDED_DECISIONS: grep across src/docs/scripts/hooks/.github shows only gate-fail-open-probe.ts (its own header, line 247 row lookup for stdout row) and its test. No printer, evidence report or AP-13 precondition reads `expect` as the single outcome. G9's `expect==="BLOCKS" => no ap` rule is keyed on `expect` (kept PROCEEDS), so unaffected. [CLEAN][code-traced]
- #308 (open, AP-13 activation): consumes the row only as "residual, owned by launcher". Behaviour for the launcher fix is unchanged: on Node 24.15 the fault still fail-opens, so the launcher mapping is still required. STATE.md:215 and hook header line 60 list SYSTEMROOT among "recorded, not fixed" fail-open faults; still true on 24.15, so no edit needed, at most a one-line note on #308 that the row may fail closed on 22.18. [SUSPICION][LOW][derived] — not filed.
- CHANGELOG claims (QA-15): "only systemroot sets alsoAccepts" — matches A20's loop over RECORDED_DECISIONS (instrument-backed). "Verified on Node 24.15 only" — true: host `node --version` v24.15.0. "Node 22.18 => BLOCKS" is taken from the human ruling, not re-measured here (I ran only 24.15); it is stated as recorded fact of the ruling, so acceptable. [CLEAN][demonstrated]
- CI pin vs claim: ci.yml:190,297 pins node 22.18.0 but on ubuntu-latest (lines 32, 288); the row is `platform: "win32"`, so CI never probes it and the BLOCKS branch is exercised only via A21's predicate. CHANGELOG discloses this ("predicate test, not a live 22.18 run"); no claim overreaches. The win32 probe runs only on the developer host. [CLEAN][code-traced]
- Expected-PROCEEDS list now derives from the observed outcome rather than platform, so a row observed BLOCKS is not required in the list; a third outcome still fails G9 (A21). On non-win32 the row is absent from observed => not listed. Consistent. [CLEAN][code-traced]

## Coverage gap
The live 22.18 BLOCKS path has no runner (no Windows CI). Intentionally low-risk (BLOCKS is the safe direction); noted, not a finding.

## Verdict: APPROVE
Next action: none blocking; optionally comment on #308 that the systemroot row may fail closed on Node 22.18.

checks: `node --test src/qa/gate-fail-open-probe.test.ts` (tree at be8633b src content, Node v24.15.0): tests 14, pass 14, fail 0, skipped 0.
Worktree ../thoth-cd320 created and removed. Editorial: none.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][derived] STATE.md:215 / hook header:60 / #308 describe the SYSTEMROOT fault as fail-open; on Node 22.18 it now fails closed — optional one-line note on #308, no fix required
2. [CLEAN][code-traced] RECORDED_DECISIONS has no other consumer assuming a single expected outcome (grep src/docs/scripts/hooks/.github)
3. [CLEAN][demonstrated] CHANGELOG claims match: only-one-row alsoAccepts (A20 loop), 24.15-only verification (host v24.15.0, 14/14)
4. [CLEAN][code-traced] CI pins 22.18.0 on ubuntu; row is win32-only so CI never probes it; disclosed in CHANGELOG
5. [CLEAN][code-traced] expectedProceeds derives from observed outcome; third outcome still fails G9
counts: issues=0 suspicions=1 clean=4
evidence: demonstrated=1 code-traced=3 derived=1
checks=node --test gate-fail-open-probe.test.ts: 14 pass / 0 fail / 0 skipped (Node 24.15.0)
adr=HIT(37, whole catalog)
report=docs/reviews/s320-probe-node-version-cross-domain-2026-09-30.md
