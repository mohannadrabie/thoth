# s308 story G runbook: infra-security review (Wadjet), 2026-10-02

HEAD: 30786930cbb5f18450cf2f0141558f74eabb0845 (branch s308/activation; story commit 462bf95). Tier STANDARD (ratified, not re-litigated).
ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`. No applicable security-domain ADR standard is violated by this docs-only diff.
Scope: docs/runbooks/policy-load-recovery.md, docs/reviews/s308-G-preflight-evidence-2026-10-02.md, AP-6 row, CHANGELOG. Docs only; nothing executable changed.

## Verdict: APPROVE-WITH-CONDITIONS (no blockers; two doc hardening items, derived, cap MED)

## Findings (ranked)

1. [SUSPICION][MED][derived] Runbook `reg add ... /d "<minified-policy-json>"` (runbook lines 47-52). Minified JSON is full of double quotes. Inside `"..."` in cmd they must be escaped (`\"`), and `%`, `&`, `|` need care (`%%` in a .bat). A locked-out operator pasting the JSON as-is writes a truncated/mangled value, gets `json-parse-error` x `central` again, and stays locked out (or writes a different-but-valid policy than intended: the X-12 case). Not run (a write is out of lane and human-only). Fix: add one sentence plus a worked example of the escaping, and tell the operator to run `reg query` afterwards and diff against the intended JSON. Settling test: a human with an elevated shell writes a sample JSON to a scratch HKCU key and reads it back.
   Attack sketch: none (availability/misdirection, not exposure).
2. [SUSPICION][MED][derived] "Remove it" / `reg delete` offered as an equal repair (table rows 29-31, lines 54-66) with no warning that deleting the value drops all central rules: load succeeds with zero central rules and the machine falls back to shipped-defaults/project/bootstrap posture (evidence file shows `posture: allow (source: bootstrap)`, 0 rules). That is a fail-open for every session on the machine, reached by an elevated human, so within authority, but the runbook does not say it, nor require the central policy owner's sign-off or a record. Fix: prefer "write corrected value" first; for removal add "removes all central rules; machine falls to <posture>; record who/why; restore the owner's policy afterwards".
3. [ISSUE][LOW][code-traced] Runbook line 13/12 describes a live fail-closed deny, but the evidence file line 31 shows the kernel gate hook is not wired into .claude/settings.json today, so no such deny occurs yet. An operator looking for it is mildly misdirected. Fix: one line "applies once the gate is wired (#308 activation)".
4. [ISSUE][LOW][code-traced] Lines 103: "the shell classifier and the OS ACL refuse it" is stated absolutely; central-source.ts:60-78 records it as demonstrated in one session only (UAC-filtered token, classifier refusal). Soften to "refused in the measured session"; keep the human-only label (it is correct).
5. [SUSPICION][LOW][derived] Runbook never states the key's ACL must stay admin-write-only. Not a widening instruction (no ACL commands, no non-admin-writable advice), but a one-line "do not grant Users/Authenticated Users write on HKLM\SOFTWARE\Policies\Thoth" would prevent a well-meant "fix" of an access-denied by loosening it.
6. [CLEAN][demonstrated] Read-only claim proven. `grep -nE "writeFile|appendFile|mkdir|unlink|rename|writeSync|createWriteStream" print-cli.ts printer.ts loader.ts central-source.ts pin.ts` returned no matches (rc=1). Only I/O: `readFileSync` (loader.ts:39) and `execFileSync(resolveSystemRegExePath(), ["query", ...])` (central-source.ts:276,317: argv `query` only, absolute system path, no shell). print-cli.ts writes only to stdout. Evidence file's before/after `git status` and `reg query` are identical.
7. [CLEAN][code-traced] Every `reg add`/`reg delete` is labelled human-only, elevated, out of session (line 41 callout and per-block comments), with a "What a session must not do" section. No step is runnable from a session as advised; none loosens ACLs; none advises a non-admin-writable key.
8. [CLEAN][code-traced] Evidence file contains no secrets: no registry value (key absent), no usernames or paths beyond repo-relative, only a sha256 pin of an empty policy and a timestamp. "Do not paste secrets" placeholder is present.

## BLOCKERS vs hardening
- Blockers: none.
- Hardening (fix as plain edits, no re-review needed): findings 1, 2, 3, 4, 5.

Failing-test mapping: findings 1, 2, 5 resolve to the human provisioning rehearsal (command in 1), not an automated test; 3 and 4 are wording edits with no executable form. No Issue filed: no [ISSUE] at HIGH/MED.

## Editorial
- Line 12-13 "names no rule" vs table's `Unlock:` clause note on row 30: consistent only if the clause is not a rule; fine.

Next action: edit the runbook for findings 1 and 2 (escaping example, removal warning), then ship.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][derived] runbook:47-52 `reg add /d "<json>"` shows no quote/%/& escaping; pasted minified JSON mangles, operator stays locked out. Add escaped example plus read-back diff.
2. [SUSPICION][MED][derived] runbook:29-31,54-66 removal offered as equal repair without warning it drops all central rules (fail-open to bootstrap allow); prefer corrected value, require owner record.
3. [ISSUE][LOW][code-traced] runbook:12-13 describes a live deny but evidence:31 shows the gate is not wired today; add a one-line caveat.
4. [ISSUE][LOW][code-traced] runbook:103 asserts classifier+ACL refusal absolutely; central-source.ts:60-78 shows one measured session; soften.
5. [SUSPICION][LOW][derived] runbook lacks "do not loosen the key ACL" line.
6. [CLEAN][demonstrated] read path is read-only: write-call grep rc=1 over the 5 files; reg invoked with `query` only; before/after status identical.
7. [CLEAN][code-traced] all reg add/delete are labelled human-only/elevated/out-of-session; no ACL loosening advised.
8. [CLEAN][code-traced] evidence file has no secrets or sensitive data.
counts: issues=2 suspicions=3 clean=3
evidence: demonstrated=1 code-traced=4 derived=3
checks="1/0/0" (write-call grep, rc=1 = no match, as expected; nothing else runnable)
adr=HIT(37)
report=docs/reviews/s308-G-runbook-infra-security-2026-10-02.md
