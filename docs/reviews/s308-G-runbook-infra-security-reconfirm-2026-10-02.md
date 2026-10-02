# s308 story G runbook: infra-security re-confirm (Wadjet), 2026-10-02

Reviewed commit: 82adbe3628093e08334173e4afea4b436238467b (delta only; branch s308/activation). Tier STANDARD.
📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]. No applicable security ADR violated by this docs-only delta.

## Verdict: REWORK (one defect, one-line fix; all five prior findings resolved in intent)

## Prior findings
| # | Status |
|---|---|
| 1 MED reg add escaping | Resolved in text: `\"` escaping, `%%` in .bat, operator-char caveat, worked example, read-back. Escaping is correct for cmd + reg.exe argv parsing. BUT the commands carry a new defect (N1). |
| 2 MED removal consequence | Resolved: "drops ALL central rules ... fail-open for the whole machine", recorded owner decision required; table rows demoted removal. |
| 3 LOW gate-not-wired | Resolved: activation-status callout. |
| 4 LOW absolute classifier claim | Resolved: "one session's configuration, not a guarantee". |
| 5 LOW ACL line | Resolved: "Do not loosen the key's ACL" (twice). |

## New findings (ranked)
1. [ISSUE][MED][code-traced] N1: registry-path backslashes were stripped in the NEW commands in the committed blob. `git show 82adbe3:docs/runbooks/policy-load-recovery.md | grep -n Thoth` shows lines 66,67,69 `'HKLM:SOFTWAREPoliciesThoth'`, lines 77,79,91 `"HKLMSOFTWAREPoliciesThoth"` (unchanged lines 25,54,98,120,136 keep `\`). Effect: PowerShell `Test-Path` is false, `New-Item -Force` creates a stray key `HKLM:\SOFTWAREPoliciesThoth`, writes the value there, and the read-back prints `MATCH`: a silent false success while the real `HKLM\SOFTWARE\Policies\Thoth` is unchanged and the gate stays failing closed. reg.exe forms error on an invalid key name (loud). Exposure: ~100% of operators following the preferred repair, basis: counted in code (3 PS lines, 3 reg lines). Fix: restore `\` in those six lines (`'HKLM:\SOFTWARE\Policies\Thoth'`, `"HKLM\SOFTWARE\Policies\Thoth"`) and have the read-back read the same real path. Test: a doc lint `grep -nE 'HKLM:?SOFTWARE' docs/runbooks/policy-load-recovery.md` must return no match (currently 6). Attack sketch: none (availability and false assurance, admin-only).
2. [SUSPICION][LOW][derived] The PS example reads `.central-policy.min.json` from the current directory; prose says keep it outside the repo, but the path is relative and no cleanup is advised. A policy file left in a user-writable folder is tamper-prone between write and repair. Suggest an owner-controlled absolute path and delete after verifying. Not a new exposure introduced by commands (no ACL change, no execution-policy bypass advice, no temp path).
3. [CLEAN][code-traced] PS repair logic otherwise correct: `Get-Content -Raw ... .Trim()`, `Set-ItemProperty -Type String` writes REG_SZ, `-ceq` is case-sensitive exact compare, `Compare-Object` on mismatch. HKLM write needs elevation, stated ("human, elevated, out of session"); a session's UAC-filtered token cannot write it (central-source.ts header, one measured session; runbook "must not do" section keeps the rule regardless).
4. [CLEAN][code-traced] No new exposure: no ACL commands, no execution-policy bypass, no world-writable temp path, no secrets, all write blocks labelled human-only; removal blocks labelled recorded-decision.
5. [CLEAN][code-traced] `reg add` fallback escaping correct for cmd: `\"` for reg.exe, `%%` in .bat, warning about `& | < >` after an escaped quote is accurate (quote parity flips on `\"`).

## Not run
Nothing executable and a registry write is human-only. Settling check for N1 is the grep above (read-only, runnable by anyone).

## Blockers vs hardening
- Blocker: N1 (silent false-success of the sole preferred repair; counted in code).
- Hardening: finding 2.

Open findings 2 / failing tests 1 (N1 grep lint); finding 2 is wording-only, no executable form.

Next action: restore the six backslashes (plain edit), then re-grep; no further review needed after the grep is empty.

RECEIPT: verdict=REWORK
findings:
1. [ISSUE][MED][code-traced] runbook:66,67,69,77,79,91 (blob 82adbe3): registry-path backslashes stripped; PS repair writes stray HKLM:\SOFTWAREPoliciesThoth and prints MATCH (false success); restore `\`.
2. [SUSPICION][LOW][derived] runbook PS example uses relative `.central-policy.min.json`; advise owner-controlled absolute path and delete after verify.
3. [CLEAN][code-traced] PS repair logic (-ceq, REG_SZ, elevation stated, human-only) correct.
4. [CLEAN][code-traced] no new exposure (no ACL change, no execution-policy bypass, no temp path, no secrets).
5. [CLEAN][code-traced] reg add escaping correct for cmd (\", %%, operator caveat).
counts: issues=1 suspicions=1 clean=3
evidence: demonstrated=0 code-traced=4 derived=1
checks="n/a" (git show blob grep only; nothing runnable)
adr=HIT(37)
report=docs/reviews/s308-G-runbook-infra-security-reconfirm-2026-10-02.md
