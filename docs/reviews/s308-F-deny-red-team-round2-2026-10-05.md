# Red Team (Sutekh) — #308 story F ROUND 2 re-confirm (deny rules / gate self-protection)

- Scope: delta 9e238c5..4ad9f87 — 2a24f1e (E conditions #412/#413/#414), 6dba729 (F conditions #415-#420), 4ad9f87 (plain require-factory name). CRITICAL tier. HELD behind THOTH-ADR-0003.
- Date: 2026-10-05. HEAD: 4ad9f87. ADR cache: HIT (38 ADRs; full catalog via adr submodule junction).
- State: the gate is UNWIRED — .claude/settings.json has only SessionStart + UserPromptSubmit entries, no PreToolUse gate entry (confirmed this run). Nothing is enforced live today, so every live-exposure figure below is ~0%. Per the Manager calibration, a DEMONSTRATED self-protection bypass is not LOW even when unwired; exposure is stated separately.
- Method: ran the real hook against ~30 crafted binary/wrapper forms in a detached 4ad9f87 worktree; ran the F/E conditions tests (18/18 pass); ran the generator (PASS, 45 paths); code-traced specifierOf, detectWrapper, normalizeToolToken, canonicalizePathTarget/pathFormIssue; verified parent-dir and protected-path coverage programmatically (both unmatched lists empty); demonstrated two planted-binary executions and one kubeconfig exec-plugin execution by real file-write side effect.

## Findings (ranked by blast radius)

### 1. [ISSUE][HIGH][demonstrated+code-traced] F9 (#420) fix is INCOMPLETE: the wrapper dispatch keeps the identical binary blindness F9 closed for the kubectl shape
shell.ts:472 computes toolToken = normalizeToolToken(tokens[0]), and normalizeToolToken (shell-scanner.ts:576-578) STRIPS the path and lowercases. That stripped basename is what detectWrapper (shell.ts:473) dispatches on. The F9 binary check (RESOLVABLE_BINARIES.has(binaryToken), shell.ts:351) runs only in resolveKubectlShape on the RAW tokens[0] — the wrapper leg never gets it. So a PATH-qualified or basename-colliding wrapper binary matches a trusted wrapper and its inner command resolves clean, while the OS executes the attacker binary.

Demonstrated (real hook, ALLOW) and confirmed by actual execution in a scratch dir:
- ./scratch/sh -c "kubectl get pods/x --context=c" => ALLOW; running ./scratch/sh wrote PWNED-sh (the planted binary ran, not the real shell).
- ./scratch/env kubectl get pods/x --context=c => ALLOW; running ./scratch/env wrote PWNED-env.
- Same ALLOW for ./scratch/bash -c, /tmp/evil/env kubectl, ./scratch/exec kubectl, ./scratch/eval kubectl, ./scratch/nohup kubectl ... ampersand.

This is the same class #420 names (any other binary is unresolved, fail-closed direction — decisions row 2026-10-05). That contract is FALSE for the six wrapper binaries (bash, sh, env, exec, eval, nohup). F9 closed the kubectl-shape leg and left the wrapper leg open.

- Exposure: ~0% of live calls today, basis: counted-in-code (no PreToolUse gate entry in settings.json; gate unwired). Class: a clean-resolve that authorizes an arbitrary planted binary — identical to #420, which the Manager ruled HIGH regardless of unwired state.
- Proof-test before activation (named): add a wrapper-binary mutant to shell.test.ts / the F closed-set suite: a path-qualified wrapper binary (./dir/sh -c inner, and the five other wrappers) MUST be unresolved, not resolve the inner command. Fix: apply the F9 bare-lowercase gate to the wrapper leg too — detectWrapper must see the RAW tokens[0], or resolveWrapperMatch must reject a path-qualified/non-bare wrapper binary. Routed to #420 (fix incomplete) — do not re-file.

### 2. [ISSUE][MED][demonstrated] The one trusted binary (kubectl) is an arbitrary-code / exfil primitive via its own flags — instance of #409
kubectl get pods/x --context=c --kubeconfig=./scratch/k.yaml => ALLOW. scanFlags extracts only --context; --kubeconfig, --server, --token are invisible to the record, so the call resolves as a clean READ. A kubeconfig with an exec credential plugin runs on use: running that exact allowed command wrote PWNED-kubeconfig (the plugin node -e executed). --server and --token are allowed the same way (exfil / SSRF surface).
- Kubectl instance of the already-filed #409 (git/rg resolve to read but execute code via config/env helpers). Pre-existing S3/S4 flag-handling, NOT introduced by the F delta.
- Exposure: ~0% live today (unwired), basis: counted-in-code. Routed to #409 (comment), owned by E0/#408 activation preconditions — do not re-file.
- Proof-test: pin a vocabulary of safe kubectl flags; any unlisted flag (--kubeconfig, --server, --token, --as) marks the record unresolved.

### 3. [SUSPICION][MED][code-traced] #418 import walk fails OPEN on member-access / NewExpression load forms (not throw)
specifierOf (protected-path-list.ts:60-76) follows: static import, export-from, dynamic import of a literal, bare require of a literal, createRequire(url) invoked on the spot with a literal; and THROWS on a non-literal require, a stored createRequire, a computed dynamic import (verified by the #418 test, activation-preconditions.test.ts:130-131). But a callee that is a property access or a new expression returns undefined and is SILENTLY SKIPPED, never thrown: module.require of a path, process.mainModule.require, new Worker(new URL(rel, import.meta.url)), import.meta.resolve. Of these, new Worker(path) is the one genuinely reachable in the ESM closure; the module and require globals do not exist under ESM. A future hook module that spawns a Worker by path would leave that file unprotected with every gate green.
- Exposure: ~0% today, basis: counted-in-code — grep across the 45-file production closure (hooks and src/policy, excluding tests) finds zero uses of new Worker / module.require / process.mainModule / import.meta.resolve. Latent completeness gap, same posture as round-1 Finding 1, and the same disclosed token-spelling-heuristic residual class as #332.
- Proof-test before activation: extend the F3 add-import mutant with a new Worker(new URL(...)) form — the walk must follow it or fail closed (throw). No new Issue (disclosed-residual class; fold into the #418/F3 mutant at activation).

### 4. [SUSPICION][LOW][demonstrated] #416 canonicalizer residual: NTFS 8.3 short names (disclosed)
canonicalizePathTarget of hooks~1/pretoo~1.mjs returns hooks~1/pretoo~1.mjs unchanged — not flagged, not equal to the real rule target. On a volume with 8.3 generation enabled this under-matches a real file. Explicitly disclosed in the function header (Does NOT do: expand 8.3 short names) and in the Q2 narrowing (fail-closed only while POL-05 denies first). Unicode lookalikes are not folded either, but NTFS does not fold them to the ASCII name, so a lookalike write does not reach the protected file (under-reach, not a bypass). No action beyond the existing disclosure.

### 5. [CLEAN][demonstrated] F9 core closed-set gate holds for every non-wrapper form
Real hook, all DENY via POL-05: node get pods/x, KUBECTL, kubectl.exe, ./kubectl, command kubectl, FOO=1 kubectl, PATH-prefixed kubectl, ANSI-C quoted kubectl, hex-escaped kubectl; alias-then-kubectl and function-redefined kubectl both deny on the chain-operator scan; exec -a kubectl ./evil denies on the 2-target cap. Only the bare lowercase kubectl resolves (unchanged). 18/18 conditions tests pass.

### 6. [CLEAN][demonstrated] #416 handled forms: trailing dot-slash, trailing dot/space, ADS, drive-relative, extended-length prefix
hooks/. and file/. collapse to the canonical path (match); trailing-space + case fold to the match; ADS (::$DATA), drive-relative (c:hooks/...), and the extended-length prefix all FLAGGED by pathFormIssue (colon segment) -> unresolved -> POL-05 denies. A space-only segment folds away.

### 7. [CLEAN][demonstrated] #419 wired-hook walk covers the real settings and fails closed
wiredHookScripts reads the two commands actually wired (sessionstart-tool-enum.mjs, userpromptsubmit-halt-relay.mjs), and their full import closure — including src/policy/tools/mcp-enumeration.ts and docs/qa/tool-inventory.json — is on the 45-path protected list. A wired command naming no CLAUDE_PROJECT_DIR script throws (activation-preconditions.test.ts:213, confirmed).

### 8. [CLEAN][demonstrated] #415 parent rules: every parent covered, move/delete denied
unmatchedParentDirs empty and unmatchedPaths empty over the generated rule set. 15 parent dirs (.claude, .thoth, docs, docs/qa, hooks, src, src/policy and subdirs, src/qa, ~/.claude) each get a move/delete/rename deny; repo-root and ~ correctly excluded. Through the hook, a move/delete via a non-resolvable binary (rm/mv) denies via POL-05 regardless.

## Raw evidence
- Hook probes (unwired, default-allow): ./scratch/sh -c kubectl ALLOW (PWNED-sh written), ./scratch/env kubectl ALLOW (PWNED-env written), kubectl --kubeconfig=./scratch/k.yaml ALLOW (PWNED-kubeconfig written by the exec plugin); node get, ./kubectl, command kubectl, FOO=1 kubectl all DENY.
- Conditions tests: node --test activation-preconditions + shell-binary-closed-set + path-canonical -> tests 18, pass 18, fail 0, skipped 0.
- Generator: node src/qa/protected-path-list.ts -> PASS, 45 protected paths; wired hooks + closure + mcp-enumeration + tool-inventory present; unmatchedParentDirs empty, unmatchedPaths empty.
- Canonicalizer pure-function probe: trailing dot/space collapse and match; ADS/drive/extended-length FLAGGED; 8.3 short name unchanged (residual).
- Closure grep: 0 uses of new Worker / module.require / process.mainModule / import.meta.resolve in hooks and src/policy (excluding tests).

## Scariest unproven assumption + go/no-go
Scariest: F9 (#420) is believed to make any other binary unresolved and fail-closed, but the wrapper dispatch (detectWrapper on a path-stripped basename) still resolves a path-qualified wrapper binary as clean while the OS runs the planted binary — DEMONSTRATED. The #420 fix closed one of two symmetric legs. Combined with Finding 2 (#409: the one trusted binary executes code via --kubeconfig), the premise that a resolved kubectl read is safe does not hold.

Verdict: no-go on the F9 fix completeness (one demonstrated HIGH self-protection bypass). The STORY remains HELD behind THOTH-ADR-0003, so nothing ships live; live exposure is ~0% today. The deny mechanism, #415/#416/#419, and the F9 closed-set for non-wrapper forms all SURVIVE intact.

Single next action: fold the wrapper-binary gate into F9 (apply the bare-lowercase RAW tokens[0] check to the wrapper leg), with a path-qualified-wrapper mutant that must fail today — then re-confirm.

RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated+code-traced] F9/#420 fix incomplete — wrapper dispatch resolves a path-qualified wrapper binary as ALLOW while executing the planted binary (PWNED-sh/PWNED-env written). Exposure: ~0% of live calls today, basis: counted-in-code (gate unwired). Routed to #420.
2. [ISSUE][MED][demonstrated] Trusted kubectl read executes code/exfil via --kubeconfig exec-plugin / --server / --token, invisible to the record (PWNED-kubeconfig written). Pre-existing S4, instance of #409. Exposure ~0% (unwired).
3. [SUSPICION][MED][code-traced] #418 import walk fails OPEN (skips, not throws) on member-access/new Worker(path) load forms; new Worker is the reachable one. 0 production closure uses — latent, disclosed-residual class #332.
4. [SUSPICION][LOW][demonstrated] #416 residual: NTFS 8.3 short names not expanded — disclosed in the header, FS-feature-dependent under-match.
5. [CLEAN][demonstrated] F9 closed-set holds for every non-wrapper form.
6. [CLEAN][demonstrated] #416 handled forms canonicalize-and-match or flag-unresolved.
7. [CLEAN][demonstrated] #419 wired-hook walk covers the real settings two hooks + closure; unparseable command throws.
8. [CLEAN][demonstrated] #415 parent rules: unmatchedParentDirs empty and unmatchedPaths empty.
counts: issues=2 suspicions=2 clean=4
evidence: demonstrated=7 code-traced=1 derived=0
checks=18/0/0 (conditions tests) + generator PASS (45 paths) + ~30 hook probes + 3 real-execution demonstrations + coverage/canonicalizer probes
adr=HIT(38)
report=docs/reviews/s308-F-deny-red-team-round2-2026-10-05.md
HEAD: 4ad9f87
