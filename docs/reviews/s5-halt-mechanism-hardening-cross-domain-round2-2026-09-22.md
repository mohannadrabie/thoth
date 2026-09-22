# Cross-domain review, round 2 -- s5-halt-mechanism-hardening (Issues #96, #206, #274, #276)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-22
**Scope:** fix/s5-halt-mechanism-hardening, HEAD e04dde0, delta from round-1's 4240ca5 (round-1 report: docs/reviews/s5-halt-mechanism-hardening-cross-domain-2026-09-22.md, verdict APPROVE-WITH-CONDITIONS)
**Tier:** CRITICAL (Policy enforcement / session gates sensitive area)
**Trigger:** commit e04dde0 fixes red-team's 2 HIGH + 2 MED and app-security-reviewer's REWORK from round 1 (env-var name, cross-session guard, unlock-forgery structural fix, reason-key sanitization) plus adds a new isValidSessionId() path-shape gate.

## My round-1 condition -- status

Round 1's one condition was "re-run the closed CLAUDE_PROJECT_DIR precedence drill naming CLAUDE_SESSION_ID." Superseded, not merely renamed-and-reapplied -- for two independent reasons, both checked directly against this round's code, not taken on the task brief's word:

1. The variable itself no longer exists on this runtime under the old name (confirmed independently in round 1's own report via CLI-binary string search, and now confirmed by round 3's own live measurement -- a real claude -p session with a diagnostic SessionStart hook dumping process.env, output read directly). The premise my round-1 drill would have tested (does a settings.local.json override win against the host-injected value) is moot for a variable that was never being read in the first place.
2. More importantly: this round's sessionIdFromStdin provenance redesign makes the answer to "can CLAUDE_CODE_SESSION_ID be spoofed via settings.local.json" irrelevant to the original fail-open concern. Even if an attacker's override DID win, an env-resolved session id (spoofed or genuine) is now structurally barred from ever reconciling another session's halt to set:false (hooks/sessionstart-tool-enum.mjs:330, the !sessionIdFromStdin gate) -- it can only ever additively set:true. My round-1 concern was specifically about the fail-OPEN direction (silently clearing someone else's active halt); that direction is now closed by construction regardless of env-var spoofability. A residual, disclosed, lower-severity concern remains (a spoofed env var naming a real other session could cause a spurious set:true write against that session -- a cross-session nuisance/DoS shape, not a control bypass) -- the code's own comments name this trade-off explicitly (hooks/sessionstart-tool-enum.mjs:308-317) as the deliberate safe direction. Not re-litigated here: narrow, disclosed, LOW by construction (fail-closed direction only), not new to this round.

## ADR verdict -- whole catalog re-check against the NEW code shape

node docs/adr-cache.mjs --ensure: submodule was uninitialized in this fresh worktree (same as round 1); ran git submodule update --init --recursive, re-ran: "ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp fba42fe771484cfdc25de940ff1369ad90252887) [CACHE=HIT]" -- same fingerprint as round 1 (no ADR changes since). Full catalog read, not a domain slice.

- File set unchanged from round 1: git diff origin/master...HEAD --name-only still lists exactly the same 2 hook files + 4 test files + CHANGELOG + 3 review reports -- no new domain (no IaC, DB, API, UI) entered scope this round. Every devops ADR and every SE ADR my round-1 pass ruled NOT-APPLICABLE for lack of a matching surface remains NOT-APPLICABLE; re-checked, not just carried over.
- SE ADR-0021 INT-07 -- the one ADR both lanes actually argued about this story. app-security-reviewer's round-1 report cited INT-07 ("no control ... may rest on an unverified third party's claim about its own behavior ... where thoth can verify directly, it MUST") as the BLOCKER framing for the wrong-env-var-name defect. My own round-1 report read INT-07 narrower -- the ADR's own "Consequences" section states INT-07 "remains live for the one case it still covers" (REL-12, a third-party governance plugin installed alongside thoth), not a runtime primitive the hook process itself runs on. Both readings are defensible from the ADR text; I don't referee which was "correct" because it's moot now either way: this round's fix satisfies INT-07 under EITHER reading -- the variable name is now confirmed by direct measurement (a real hook subprocess, not a documentation citation), which is exactly what INT-07 (read broadly) and PRINCIPLES rule 18 (read literally -- "the spike that measures it runs first") both require. No open ADR-0021 collision.
- SE ADR-0005 (testing strategy, "MUST NOT delete or weaken a failing test"): checked the diffs of all 4 touched test files (sessionstart-tool-enum-session-id-fallback.test.ts, sessionstart-tool-enum-fixnow.test.ts, userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts, userpromptsubmit-halt-relay-friendly-labels.test.ts) line by line. Every change is a rename (env var), a strengthened oracle (paren-count -> token-count, because red-team named the old oracle "part of the defect"), a determinism fix (explicit CLAUDE_CODE_SESSION_ID: "" override so ambient pollution from a real Claude-Code-spawned dev/CI shell can't flake the test -- see finding 2 below), or new test cases. No assertion was deleted or loosened. No collision.
- No devops ADR collision (still two standalone Node CLI scripts, no IaC/CDK/pipeline/cost/tagging surface).

ADR verdict: no collision.

## Item 2 -- independent npm test / typecheck / lint re-run

Checked out e04dde0 detached (branch name in use by the primary checkout) in this isolated worktree and ran the suite fresh:
```
tests 1058
pass 1058
fail 0
cancelled 0
skipped 0
todo 0
```
Matches the implementer's own claim (1058/1058, after the Manager's stray-worktree-directory cleanup -- the CHANGELOG's own committed text still says "1057 pass ... 1 fail," attributed to that now-resolved environmental artifact; my clean re-run confirms the artifact is gone, not that the CHANGELOG is wrong about what happened at authoring time -- Editorial, not a defect, see below).
npm run typecheck -- clean, no output. npm run lint -- clean, no output. [CLEAN][demonstrated]

## Item 3 -- test quality on the NEW tests, verified by mutation, not by reading alone

Per PRINCIPLES rule 19, I don't take "non-vacuous" on the implementer's word -- I reverted the fix and watched the exact named test fail, then restored.

(a) F2 provenance test (sessionstart-tool-enum-session-id-fallback.test.ts, "Issue #274 / red-team F2: an env-resolved session id naming a DIFFERENT, currently-active live session..."). Mutated hooks/sessionstart-tool-enum.mjs:330 from "if (!sessionIdFromStdin)" back to round-2's literal check, "if (sessionId === UNKNOWN_SESSION_ID)":
```
$ node --test hooks/sessionstart-tool-enum-session-id-fallback.test.ts
tests 6 / pass 5 / fail 1
Issue #274 / red-team F2: ... AssertionError: expected the victim's genuinely-active halt to remain
  set:true after a colliding env-resolved invocation; got {"SUR-03-unclassified-tool":{"set":false,...}}
  false !== true
```
File restored (git checkout -- hooks/sessionstart-tool-enum.mjs). Exactly the new test failed, exactly the way the fix's own reasoning predicts -- the provenance guard is genuinely load-bearing, not vacuous. [CLEAN][demonstrated]

(b) F4 reason-key sanitization test (userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts, "Issue #276 / red-team F4: a hostile reason KEY..."). Mutated both fallback sites in hooks/userpromptsubmit-halt-relay.mjs (lines 208, 232) from sanitizeDetail(reasonKey) back to bare reasonKey:
```
$ node --test hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts
tests 9 / pass 8 / fail 1
Issue #276 / red-team F4: ... AssertionError: expected no raw ANSI escape byte (0x1B) in the
  rendered message; got: "...ok\u001b[32mSAFE\u001b[0m (unlock: none needed...)..."
```
File restored. The 8 other tests in the same file (including the 4 new F3 evasion-shape cases and the 4 pre-existing/updated cases) stayed green under this specific mutation -- confirms the F4 test isolates exactly the reason-key defense, not incidentally riding on something else. [CLEAN][demonstrated]

(c) F3 evasion-shape tests -- read, not mutated (time-bounded to "at least two" per the task brief; (a) and (b) above are the mutation-verified pair). Inspected the 4-case table (RED_TEAM_F3_EVASION_CASES: fullwidth parens, small-form parens, square brackets, no-bracket dash shape) against neutralizeUnlockToken's regex (/unlock\s*:/gi, applied after .normalize("NFKC")). Each case's own assertion comment states plainly "the round-2 escapeParens-only fix left this exact shape at 2" -- traceable to the round-2 diff I read directly (escapeParens only ever touched ASCII "(" and ")", never touched these 4 shapes) -- so these are non-vacuous by construction, confirmed by reading, not merely trusted. [CLEAN][code-traced]

## Item 4 -- seam check: isValidSessionId consistency across BOTH duplicated hook files

Verified consistent, not just textually identical:
```
$ grep -n "haltStatePath\|isValidSessionId\|sessionId =" hooks/sessionstart-tool-enum.mjs hooks/userpromptsubmit-halt-relay.mjs
```
confirms both files define an identical isValidSessionId(id) (^[A-Za-z0-9._-]{1,128}$), both gate resolveFallbackSessionId()'s env-derived value through it before returning (else falls to the literal), and both gate the stdin-derived value through it before it can become sessionId (else falls to resolveFallbackSessionId()'s result). haltStatePath() is byte-identical in both files (join(projectDir(), ".thoth", "halt-state", session-id.json)). Every path into sessionId in both files passes through isValidSessionId before reaching haltStatePath's join() -- no bypass in either file. [CLEAN][code-traced]

Live drill, not just regex-reading (this defense has no dedicated unit/regression test in the diff -- see finding 1 below -- so I built one myself rather than trust the regex alone): ran both hook scripts directly against a hostile session_id: "../../../../evil-marker".
```
$ CLAUDE_PROJECT_DIR=<scratch>/.scratch-traversal-check CLAUDE_CODE_SESSION_ID="" \
  node hooks/sessionstart-tool-enum.mjs < stdin.json
EXIT:0
$ find <scratch>/.thoth -type f
.scratch-traversal-check/.thoth/halt-state/unknown-session.json   # correctly rejected, fell to the safe fallback bucket; no file escaped the intended directory
```
Same drill against hooks/userpromptsubmit-halt-relay.mjs (seeded unknown-session.json with an active reason, hostile session_id on stdin): exit 2, correctly found and blocked on the fallback bucket -- the traversal-shaped id never reached haltStatePath as a live value on either side. Scratch fixtures removed after (rm -rf, confirmed via git status --short). [CLEAN][demonstrated] -- both files' gate genuinely holds, on live execution, not only on reading the regex.

## Finding 1 -- [SUSPICION][LOW][demonstrated+code-traced] the path-traversal defense (isValidSessionId) has no committed regression test pinning it

grep -rln "isValidSessionId" hooks/*.test.ts returns nothing -- no test file references the function directly, and no test in the diff exercises a /, backslash, or ..-shaped session_id/env value. The mechanism works TODAY (demonstrated live above, on both hook files), but nothing in the committed suite would catch a future refactor that silently narrows or removes this gate -- CLAUDE.md's "no hand-derived completeness claims" instrument-discipline exists for exactly this shape of unpinned claim ("gates BOTH the stdin-derived id... and the env-derived id," hooks/userpromptsubmit-halt-relay.mjs:283-286's own comment). Not itself a live vulnerability (red-team's own round-1 framing, carried into this round's CHANGELOG entry, already called this "a latent path-traversal surface... unproven-but-cheap-to-close" -- defense-in-depth, not a demonstrated exploit path before this fix). Fix: one named test per hook file, session_id containing /, backslash, and .., asserting the write lands in the intended .thoth/halt-state/ directory (or the safe fallback bucket) and never outside it -- the exact shape of the live drill above, committed instead of ad hoc.
Exposure: ~0% today (no live exploit path existed before or after; this is a regression-pinning gap, not an active gap), basis: measured (my own live drill found no bypass).

## Finding 2 -- [CLEAN][code-traced] ambient-env-pollution risk in the test suite, correctly neutralized where it matters

Round 3 corrected the fallback env var from a name that never exists (CLAUDE_SESSION_ID) to one that genuinely does (CLAUDE_CODE_SESSION_ID) -- which means a test run INSIDE a real Claude-Code-spawned shell (this project's own dev loop, npm test from a live session) now has a REAL ambient value available that earlier rounds' tests never had to account for. hooks/test-support/spawn-hook.ts's runHook spawns with env: { ...process.env, ...envOverrides } -- ambient inherits unless explicitly overridden. Checked: the ONLY two test files that assume the "no env fallback available" double-failure path (sessionstart-tool-enum-session-id-fallback.test.ts, sessionstart-tool-enum-fixnow.test.ts) both now force CLAUDE_CODE_SESSION_ID: "" explicitly (confirmed via grep -n "unknown-session\|UNKNOWN_SESSION_ID" hooks/*.test.ts -- exactly these two files reference the literal bucket, and both patch the env). No other test file depends on the degraded-stdin fallback path, so no other file needed the same treatment. My own full-suite run (1058/1058) executed inside this actual Claude-Code worktree session (a real CLAUDE_CODE_SESSION_ID genuinely present in my own ambient environment, confirmed in round 1's own report) is itself a live corroboration that this neutralization is complete -- a live pollution bug would have shown up as a flake in exactly these two files, and didn't. [CLEAN][demonstrated]

## Item 5 -- doc staleness (Issue #96 references), now doubly wrong

Confirmed both locations flagged in round 1 are unedited by this diff and are now MORE wrong than in round 1, not just still-stale:

- docs/backlog.md:25 -- still reads "Deliberately not fixed this pass -- ruled defer, spike-first" for Issue #96. Round 1 this was stale-but-arguably-still-true-in-spirit (the round-2 fix was a no-op, so #96 genuinely wasn't fixed yet). As of e04dde0, #96 IS genuinely fixed (measured, not cited) -- this entry is now an outright false claim, not merely an overtaken one.
- docs/STATE.md:457 -- still lists "Issue #96 (a pre-existing, narrow malformed-stdin fail-open -- deferred, spike-first)" in its "still open, not blocking today" resume-point list, AND (unrelated to #96 specifically, same paragraph) line 461 still tells a reader to "run the five-minute CLAUDE_PROJECT_DIR precedence drill... whenever convenient," even though line 384 of the SAME file already records that drill as closed 2026-09-08. A reader landing on STATE.md's resume point today hits three stale claims in one section (the #96 status, and the same drill-status contradiction I flagged round 1, now joined by the fact that the drill in question was never about CLAUDE_SESSION_ID/CLAUDE_CODE_SESSION_ID at all -- it's the CLAUDE_PROJECT_DIR one, a separate closed item this same paragraph conflates with the open #96 line next to it).

Routed to Editorial per this reviewer's own evidence policy (prose staleness, not a code defect) -- no code change, no re-review needed. Manager's close-out (already owning this per the task brief) should now word Issue #96's entry as CLOSED/fixed-and-verified, not merely delete the stale "deferred" line.

## Editorial (uncounted, verdict-neutral)

- CHANGELOG.md's committed text (1057 pass ... 1 fail) is accurate to what the implementer observed at authoring time (a real, disclosed, now-resolved environmental artifact) but reads stale next to my own clean 1058/1058 re-run -- not a defect in the entry itself (it discloses the cause honestly), just worth the Manager confirming CI shows 1058/1058 too before treating the story as done.

## Coverage gaps named

- Red-team and app-security-reviewer have not yet independently re-confirmed their own round-1 findings at this round-2 commit. No round-2 dated report exists yet from either lane (docs/reviews/ has only their round-1 reports, both dated 2026-09-22 against 4240ca5). My own verification here (mutation-tests on 2 of the 3 named new-test families, a live path-traversal drill against both hook files, full-suite/typecheck/lint re-run, whole-ADR-catalog re-check) is real, executed evidence that the specific fixes work -- but it is explicitly NOT adversarial PoC construction against the new structural design (NFKC-normalization-based token neutralization, the provenance-based trust boolean) the way red-team's round-1 pass was against the round-2 code. That lane is unclaimed for this round. This project's own CRITICAL-tier convention (CLAUDE.md: "red-team (adversarial) + the relevant domain reviewer(s)") implies both should re-confirm before this story is treated as shippable -- naming this plainly rather than assuming it will happen.
- No infra, API contract, data schema, or UI surface is touched by this diff (same file set as round 1) -- infra-security-reviewer/api-reviewer/data-reviewer/usability-reviewer's lanes still have nothing to cover here. Checked, not a silent gap.

## Verdict

APPROVE (cross-domain lane only -- see coverage gap above on the outstanding red-team/app-security round-2 re-confirm). No blocking [ISSUE] found in this lane. Round 1's one condition is resolved/superseded, explained above rather than merely asserted. One new [SUSPICION][LOW] (Finding 1, unpinned path-traversal regression test) -- demonstrated not to be currently exploitable, but worth a named test before the next refactor of this code touches it.

Single next action: dispatch red-team and app-security-reviewer for their own round-2 re-confirmation against e04dde0 (their own named findings from round 1, adversarially re-attacked against the NEW structural defenses specifically -- NFKC-normalization bypass attempts, provenance-boolean edge cases) before this story is treated as shippable at CRITICAL tier; in the same pass, land Finding 1's named traversal-regression test and let the Manager's close-out correct docs/backlog.md:25 and docs/STATE.md:457 per Item 5 above.

---

## RECEIPT

RECEIPT: verdict=APPROVE
findings (ranked by blast radius, status legend: ISSUE=confirmed / SUSPICION=unconfirmed / CLEAN=checked, sound):
1. [SUSPICION][LOW][demonstrated] hooks/sessionstart-tool-enum.mjs + hooks/userpromptsubmit-halt-relay.mjs isValidSessionId -- the new path-shape gate genuinely works (live drill on both files, hostile ../../../../evil-marker correctly rejected, no traversal, no file escaped the intended directory) but has no committed regression test pinning it (grep confirms zero references in hooks/*.test.ts); fix: one named test per hook file. Exposure: ~0% today (measured, no live bypass found), basis: measured.
2. [CLEAN][demonstrated] F2 provenance guard (Issue #274 / red-team F2) -- mutated !sessionIdFromStdin back to round-2's literal check, exactly the new cross-session test fails red (victim's set:true flips to false), confirms genuinely load-bearing, restored after.
3. [CLEAN][demonstrated] F4 reason-key sanitization (Issue #276 / red-team F4) -- mutated both sanitizeDetail(reasonKey) call sites back to bare reasonKey, exactly the new hostile-key test fails red (raw ANSI byte present), the other 8 tests in the same file stay green, restored after.
4. [CLEAN][code-traced] F3 evasion-shape tests (4 cases: fullwidth/small-form parens, square brackets, no-bracket dash) -- verified non-vacuous by reading the round-2 escapeParens diff directly (ASCII-only, none of these 4 shapes were ever touched by it).
5. [CLEAN][code-traced+demonstrated] isValidSessionId consistency across both duplicated hook files -- grep confirms identical function + consistent gating of both stdin- and env-derived paths in both files; live drill on both files confirms the gate holds under execution, not only on paper.
6. [CLEAN][demonstrated] ambient-env-pollution risk (a real CLAUDE_CODE_SESSION_ID now exists in a live Claude-Code dev shell, unlike the never-real CLAUDE_SESSION_ID) -- the only 2 test files exposed to it both explicitly force it empty; my own full-suite run executed inside a real Claude-Code session (genuine ambient var present) passed 1058/1058, live corroboration of completeness.
7. [CLEAN][code-traced] whole 37-ADR catalog re-checked against the new code shape (provenance model, NFKC normalization) -- same fingerprint as round 1 (no ADR changes), same file set (no new domain entered scope), no collision; ADR-0021 INT-07's app-security-vs-cross-domain reading disagreement from round 1 is now moot either way (the fix now measures directly regardless of which reading governs).
8. [CLEAN][code-traced] SE ADR-0005 (no test deletion/weakening) -- all 4 touched test file diffs read line-by-line; every change is a rename, a strengthened oracle, a determinism fix, or new cases; no assertion deleted or loosened.
9. [CLEAN][demonstrated] npm test independently re-run: 1058/1058 pass, 0 fail, 0 skipped; typecheck and lint both clean.
10. [CLEAN][code-traced] my own round-1 condition (re-run the CLAUDE_SESSION_ID-named precedence drill) is superseded, not just renamed -- the provenance redesign makes the drill's answer irrelevant to the original fail-open concern regardless of outcome, explained in the report body, not asserted.
11. [CLEAN][code-traced] doc staleness (docs/backlog.md:25, docs/STATE.md:457) -- both still unedited by this diff, both now doubly wrong (Issue #96 is genuinely fixed now, not just still-attempted); Editorial/Manager-owned, unchanged severity from round 1.
counts (checksum): issues=0 suspicions=1 clean=10
evidence (checksum, must total counts): demonstrated=6 code-traced=8 derived=0
checks=npm test 1058 pass/0 fail/0 skipped/1058 total; npm run typecheck clean; npm run lint clean; 2 mutation drills (F2 guard reverted: 1/6 expected test fails red; F4 sanitize reverted: 1/9 expected test fails red), both files restored via git checkout --; 2 live path-traversal drills (sessionstart + relay hooks, hostile ../../../../evil-marker session_id, both correctly rejected and fell to the safe unknown-session bucket, scratch fixtures removed)
adr=HIT(37, whole catalog)
report=docs/reviews/s5-halt-mechanism-hardening-cross-domain-round2-2026-09-22.md
