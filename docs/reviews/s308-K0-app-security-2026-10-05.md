# s308-K0 app-security review, round 1 (Horus) - 2026-10-05

[app-security-reviewer] Scope: #308 story K stage 0 (refs #442), HEAD 79f0b44, CRITICAL tier. Diff: `git diff origin/master...79f0b44`.
📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]
ADR: no applicable-domain ADR standard (authn/input/secrets/deps/data exposure) is violated by this diff; no ADR blocker.

Verdict: APPROVE-WITH-CONDITIONS. No exploitable weakness in the stage 0 tooling itself; one MED gap (the certifiers are not protected paths) to close in the K wiring step.

## Findings (ranked)
1. [MED][code-traced] The files that generate and certify the gate text are NOT in protectedPaths(): src/qa/k-settings-merge.ts, k3-edit-deny-covers-fixture.ts, k5-pretooluse-entry-uses-launcher.ts, k-readiness.ts and the proposal docs/plans/s308-K-proposed-entry-2026-10-05.json (the source of truth K5 and the merge compare against). Evidence: node probe over protectedPaths(cwd).all (111 entries) printed false for all five (true for src/qa/protected-path-list.ts). The plan (line 100) names K3/K5 as guard-adjacent sensitive. Attack: once K is wired, the Edit denies cover settings but a session can Edit k5/k3/the proposal to weaken what future verification certifies. Fix: add the five paths to the protected list (regenerate fixture/shipped defaults) before or in the K wiring commit. Exposure: 5 of 5 new certifier/proposal files unprotected, basis: counted in code. Test: protected-path-list "K certifiers are protected paths" (failing today). MED not HIGH: settings.json, launcher and gate are themselves protected, and nothing is wired yet.
2. [LOW][demonstrated] --out=<path> / --write with --settings=<path> write anywhere, follow symlinks, no protected-path refusal. Ran `node src/qa/k-settings-merge.ts --out=README.tmpvictim.md` -> exit 0, file created in repo root (removed). Post-wiring the Bash gate is the control; hardening: refuse protected targets other than the settings file for --write, refuse symlinks.
3. [LOW][code-traced] k-readiness spawns gh without --repo and inherits env (realExec): GH_REPO/GH_HOST in the human's environment redirects the k-blocker query to another repo with an empty k-blocker label -> PASS. Needs local env control; hardening: pin --repo from origin, or print the resolved repo in the row.
4. [LOW][code-traced] Terminal-escape injection: k-blocker issue titles and script stderr are printed raw (formatRows/firstLines, 200-char truncation only). Needs triage rights to label; hardening: strip C0/ESC bytes.
5. [LOW][code-traced] K1/K4 rows are self-attested text in docs/decisions.md; K1 requires exactly Y, K4 accepts ^Y\b. Align K4 to exact Y. Trust model, not new.
6. [LOW][demonstrated] Duplicate JSON keys in settings: JSON.parse keeps the last; ran merge on a file with two "hooks" keys -> first silently dropped. Benign. __proto__/constructor keys: demonstrated NOT exploitable (own properties, no pollution).

## Verified sound
- C1 [code-traced] No shell:true, no string command: spawnSync(cmd, [...args]) with fixed argv; assertReadOnly allow-list (gh issue|label list, git merge-base|rev-parse, node src/qa/<name>.ts, no slashes/..). Issue titles/branch names/decisions.md never reach argv; FIX_BRANCHES is a constant.
- C2 [demonstrated] Fail-closed: injected exec with status null (gh missing), truncated JSON, null stdout, signal-killed script all -> FAIL ("gh is not available", "non-JSON", "exited null"). Uncaught exceptions exit 1. exitCodeForRows is 1 on an empty row set.
- C3 [code-traced] Read-only holds: of the 7 existing invoked scripts none writes without --write (only protected-path-list.ts:515-516, and readiness passes no flags); the 3 absent scripts report MISSING. gate-latency-budget spawns the real gate locally, no write.
- C4 [demonstrated] Preflight output about ~/.kube/config prints only the finding (FINDING kubeconfig exec | <path> | a kubeconfig exec ... block runs a program), no secret material; readiness shows at most 3 lines x 200 chars.
- C5 [code-traced] Merge: conflicting/duplicate gate entry throws; idempotent; malformed shapes throw; K5 byte-compares command/matcher/timeout with exactly-one-entry; K3 refuses a vacuous pass.
- C6 [code-traced] Runbook rollback: git checkout --, git revert + push with explicit "never force-push", or deleting the entry; nothing weakens protection beyond the intended unwire.

## Disclosed items judged
Failing-first only for steps 2-3, FIX_BRANCHES hand constant, R4 EBUSY, #455, #435/#437: none above LOW for security; accepted as disclosed.

## Blockers vs hardening
Blockers: none. Condition (fix-now or in the K wiring commit): finding 1. Hardening: 2-6.
Next action: add the five paths to protectedPaths() before the K wiring commit.

HEAD: 79f0b44

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] protected-path-list.ts - k-settings-merge/k3/k5/k-readiness + K proposal-entry JSON not protected paths (probe false x5); add them. Exposure: 5/5 files unprotected, basis: counted in code
2. [ISSUE][LOW][demonstrated] k-settings-merge.ts main - --out/--write target unrestricted, follows symlinks
3. [SUSPICION][LOW][code-traced] k-readiness.ts realExec - gh without --repo, GH_REPO/GH_HOST can redirect blocker query
4. [ISSUE][LOW][code-traced] k-readiness.ts formatRows/firstLines - raw Issue titles/stderr, ANSI injection
5. [ISSUE][LOW][code-traced] k-readiness.ts k4Row - ^Y\b vs K1 exact Y; decisions.md self-attested
6. [ISSUE][LOW][demonstrated] k-settings-merge.ts - duplicate settings keys silently dropped (proto keys not exploitable)
7. [CLEAN][code-traced] no shell/argv injection; allow-listed read-only runner
8. [CLEAN][demonstrated] fail-closed on gh missing/non-JSON/truncated/signal
9. [CLEAN][code-traced] no invoked qa:* script writes without --write
10. [CLEAN][demonstrated] kube preflight prints finding only, no secret material
11. [CLEAN][code-traced] merge conflict/idempotence and K3/K5 strictness
12. [CLEAN][code-traced] runbook rollback safe, no force-push
counts: issues=5 suspicions=1 clean=6
evidence: demonstrated=4 code-traced=8 derived=0
checks="n/a"
adr=HIT(38)
report=docs/reviews/s308-K0-app-security-2026-10-05.md
