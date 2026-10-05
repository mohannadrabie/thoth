# Cross-domain review: #428 gate-side bare-binary trust check (S7, CRITICAL)

Date 2026-10-05. Reviewer: cross-domain-reviewer (Ra). Diff: git diff 6b0384f s7/knockout-428 (20 files, head 7de62c3). Whole ADR catalog read (38 ADRs, ADR cache HIT [CACHE=HIT]), not a domain slice.

## Lanes and ground covered
red-team (docs/reviews/s428-red-team-2026-10-05.md, go, 2 MED + 1 suspicion) and app-security (docs/reviews/s428-app-security-2026-10-05.md, APPROVE, 2 LOW) ran in parallel. They covered the internal logic of the check, fail-closed wiring, the collector, pins, generated deny rules, Program Files writability, EACCES over-deny, and AC-2/TRUST-15 on CI (as unproven). Not re-listed here.

## Cross-domain ADR verdict (whole catalog)
- ADR-0021 (kernel purity, one Action record, POL-11): HOLDS. bare-binary-trust.ts is under src/policy/gate/ and imports no node:* module; the kernel is untouched; the check runs only after a kernel allow and can only turn allow into deny. Full node --test in my merged worktree shows no purity failure.
- ADR-0021 same kernel artifact, identical verdicts on identical input (POL-03): see S2 (LOW, derived).
- SE ADR-0004 idempotency: HOLDS (read-only, no cache).
- SE ADR-0005 testing, ADR-0010 quality: HOLDS; instruments generate the completeness claims (TRUST-4 walks the exported sets; TRUST-15 and 15c derive from the real login shell; the protected-path-list generator passes).
- THOTH-ADR-0001/0003: NOT TRIGGERED. No docs/qa/s5-central-classification.json edit; the mcp route returns an empty binary list and retypes no tool name.
- DevOps ADRs 0001-0010: not applicable, no infra in the diff.
- No ADR collision. No BLOCKER.

## Seam findings

### S1 [ISSUE][MED][code-traced] A hand-off between #409 and #428 is dropped: nobody owns shell-profile PATH edits
- #409 plan (branch s7/knockout-409, docs/plans/s409-git-rg-lever-seal-plan-2026-10-05.md line 86) and its preflight (src/qa/git-rg-lever-preflight.ts line 54, R1) say session-writable ~/.bashrc, ~/.profile etc. are "routed to the #428 story".
- #428 header in src/policy/gate/bare-binary-trust.ts (residual b) and the decision row say the opposite: PATH edits to the rc files of the user "are outside this check"; the #428 plan (line 76) rejects protecting the directories through the F list.
- #429 (its plan line 38) protects .claude/* and ~/.claude/* only. No story, deny rule or K release-gate line covers ~/.bashrc, ~/.profile, ~/.bash_profile.
- Interaction that fails: a session edits ~/.bashrc (through the Edit/Write tool, which the gate does not route) to prepend a planted directory; the next session shell resolves kubectl there; the #428 scan sees only the gate own PATH plus HOME/bin and HOME/.local/bin, so the plant is invisible. The #428 scenario is reopened one step removed. Not a #428 code defect: a ledger defect between three stories, live at K.
- Domains in tension: #409 (lever seal), #428 (PATH trust), #429 and F (protected write list).
- Minimal fix: either add the profile files to F namedPaths() via #429 (plus the generator --write), or state in the K proposal and decisions that K ships with profile-file PATH edits as a named human-accepted residual, and change #409 R1 from "routed to #428" to that. No code in #428.
- Failing test (1:1): F1-shell-profile-files-protected-or-residual-owned (assert each of ~/.bashrc ~/.profile ~/.bash_profile ~/.bash_login is in PATHS.named, or that the K proposal residual list names them). To be written with #429.
- Exposure: MED, not HIGH, so not blocking-class. Reach is every session once K is wired and a session can write home-directory files; basis assumption, so the recommendation is decide ownership, not block.

### S2 [SUSPICION][LOW][derived] Verdict parity (POL-03) is not stated for the new refusal
decideToolCall is the only caller today, so the startup and pipeline gates do not yet exist to diverge. When the pipeline gate lands, the same Action record gets allow there and a host-dependent binary-trust deny here. Pre-kernel refusals already diverge the same way, so this matches precedent; it needs one sentence in the S12 plan. No action now.

### S3 [SUSPICION][MED][derived] CI: AC-2 and the real-hook tests on ubuntu-latest are UNPROVEN-pending-verification (already named by red-team 3; one new fact)
New evidence: hooks/test-support/gate-sandbox.ts (PATH_TRUST_PIN comment) states "CI has no kubectl". AC-2 (hooks/pretooluse-kernel-gate.test.ts line 93, unmodified) and src/qa/gate-fail-open-probe.ts line 133 run the REAL hook, unsandboxed, with kubectl get. If that comment is true, no-trusted-hit denies and AC-2 goes red on ubuntu-latest (it expects exit 0, empty stdout); if the runner image carries kubectl in a root-owned /usr/local/bin it passes. Locally (Windows, kubectl from Docker under Program Files) the whole suite passes. I cannot run Linux here. Settling step, by anyone with push access: push s7/knockout-428 and read the ci job npm test result for AC-2, TRUST-13 and TRUST-15.

## Seams checked and sound
- C1 [CLEAN][demonstrated] #428 vs E0: READONLY_COMMAND_NAMES is covered by an instrument, not prose (TRUST-4 walks the three exported sets; TRUST-4b walks every accepted corpus command collected names and asserts none outside the sets). Real hook, real PATH: ls -la is a silent allow; a planted ls denies (TRUST-13).
- C2 [CLEAN][demonstrated] #428 vs #409 merge: in a scratch worktree, merging s7/knockout-409 into the #428 head auto-merges shipped-defaults.json and the K settings proposal; only CHANGELOG.md and docs/decisions.md conflict (additive, routine). Then node src/qa/protected-path-list.ts prints: PASS, 58 protected paths, committed rules and proposal match the generator. Either merge order works.
- C3 [CLEAN][code-traced] #428 vs #429: Monitor and RemoteTrigger routed means the matcher includes them and the gate refuses every tool name outside Bash and mcp__* before any route is looked up (ROUTES has two rows). They never reach invokedBinaries. TRUST-16 pins ROUTES.length equal to 2, so adding a ROUTES row (the only way an empty-list invokedBinaries could be copied onto a tool that runs a shell string) fails a test by design. The #429 branch so far changes no routing file.
- C4 [CLEAN][demonstrated] #428 vs K launcher: hooks/launch-gate.sh runs env -i with PATH forwarded, then node. I ran the real launcher from sh with the real hook: kubectl get and ls -la exit 0 with empty stdout (allowed); env -i PATH node shows SYSTEMROOT and windir supplied by MSYS and a 28-entry PATH starting with the login-profile entry the check scans. The adapter reads exactly that PATH. Windows only; the POSIX launcher path was not run.
- C5 [CLEAN][demonstrated] OPS-03 latency: 15 runs each of the real hook. Base 6b0384f: delete p50 304 ms, get 330, ls 322. #428 head: delete 374, get 334, ls 259. Within noise; ceiling 2000 ms.
- C6 [CLEAN][code-traced] CHANGELOG and decisions counts re-derived from code: nine POSIX roots, Windows folder + System32 + three subfolders, two new generated deny rules, builtins eval exec source and dot. RED commit fef3158 exists.
- Full suite in the merged scratch tree: three failures, all environmental or mine: QA-14 dogfood (adr submodule absent in a bare worktree), R4 fresh-clone (EBUSY on Windows temp rmdir), S409-residuals-listed (my own checkout of ours for CHANGELOG dropped text of #409). No #428 test failed.

## Coverage gaps
- G1 [SUSPICION][LOW][demonstrated] The OPS-03 corpus (src/qa/gate-latency-budget-check.ts) is all deny-shaped commands plus a delete baseline, so the new allow-path scan (one readdir per PATH directory per call) is not measured by the instrument. My manual run (C5) shows no regression; adding a kubectl get to the corpus is optional.
- Mechanical anchor edits (shell-detector-mutants, path-scaling sweep) are covered by their own instruments. Docs-only edits are covered by the generator check (C2).

## Editorial
None found.

## Verdict
APPROVE-WITH-CONDITIONS. No ADR collision, no blocking seam. Conditions: (1) decide the owner of shell-profile PATH edits (S1) before K; (2) CI result for AC-2, TRUST-13 and TRUST-15 on ubuntu-latest before merge (S3, UNPROVEN-pending-verification).

Single next action: push the branch and read the ubuntu-latest ci job for AC-2; in parallel add the S1 line to the #429 plan or the K residual list.

Findings become tests: 1 open ISSUE (S1) with failing test F1-shell-profile-files-protected-or-residual-owned (to be written with #429). S2, S3 and G1 are suspicions; the executable form of S3 is the existing AC-2 test on CI.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked):
1. [ISSUE][MED][code-traced] #409 R1 routed to #428 vs bare-binary-trust.ts residual (b) disclaiming rc-file PATH edits; #429 protects only ~/.claude: no owner for ~/.bashrc and ~/.profile. Fix: add to F namedPaths via #429 or name as K residual.
2. [SUSPICION][MED][derived] AC-2 (unmodified, real hook, real kubectl) and fail-open probe on ubuntu-latest unproven; gate-sandbox.ts comment says CI has no kubectl. Settle: push and read CI.
3. [SUSPICION][LOW][derived] POL-03 verdict parity for binary-trust unstated; no second gate exists yet.
4. [SUSPICION][LOW][demonstrated] OPS-03 corpus never exercises the allow-path scan; manual p50 330 vs 304 ms base, ceiling 2000.
5. [CLEAN][demonstrated] E0 names covered by instrument (TRUST-4/4b), real-hook plant denies.
6. [CLEAN][demonstrated] #409 merge: JSON auto-merges, protected-path-list PASS 58 paths.
7. [CLEAN][code-traced] #429 Monitor/RemoteTrigger refused before routing; ROUTES.length 2 pin.
8. [CLEAN][demonstrated] K launcher env -i: real launcher run allows, SYSTEMROOT/windir/PATH present.
9. [CLEAN][code-traced] CHANGELOG/decisions counts match code; ADR catalog: no collision.
counts: issues=1 suspicions=3 clean=5
evidence: demonstrated=4 code-traced=3 derived=2
checks=node --test (merged scratch tree, full): 3 fail (QA-14 no adr submodule, R4 EBUSY, S409-residuals from my own merge resolution), 0 in #428 tests; protected-path-list PASS 58; latency 15 runs x3 each
adr=HIT(38, whole catalog)
report=docs/reviews/s428-cross-domain-2026-10-05.md
