# Red-team re-confirm (round 2): s326-deny-reason-cap (Issues #326 / #375), 2026-09-30

[red-team] Sutekh. Tier CRITICAL (ratified). Delta 569ac7f..2d02d69 on s7/closeout:
- 81d6b84: failing-first tests AC-326-3b, -3c, -4b, -9.
- 2d02d69: MAX_STDOUT 4096 -> 7168 with a new derivation, plus CHANGELOG.

All mutants and probes ran in an isolated detached worktree (C:/playground/thoth-rt326b at 2d02d69, with node_modules and adr junctioned read-only). The junctions were unlinked and the worktree removed at the end. The main tree was touched only to write this file and the REVIEW_LOG row.

ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`
ADRs on the attack surface: SE ADR-0021 (kernel purity, POL-05), SE ADR-0006 (blast radius), ADR-0016 (self-protection). No ADR names the deny-reason size.

## Verdict: GO. #375 is closed by this delta.

- Every cap-drift mutant from round 1 is now killed, and so are four more.
- 7168 is a sound bound. The worst input I could build reaches 6258 bytes: the 1M-unit two-entry lone-surrogate case, where the only extra growth is the marker's digits. That leaves 910 bytes of headroom, and 7168 sits under the 10,000-character runtime limit.
- AC-326-9 kills a drift in either constant on its own.
- No pre-existing assertion was weakened.
- kernel.ts is byte-identical between 569ac7f and 2d02d69.
- No new findings. Four editorial notes.

## Attacks (ranked by exposure x irreversibility x silence)

### 1. [CLEAN][demonstrated] Cap drift sweep: all mutants killed
Mutants were applied to src/policy/kernel/kernel.ts and src/policy/gate/decide-tool-call.ts. Each was run against hooks/pretooluse-kernel-gate-reason-cap.test.ts plus src/policy/kernel/kernel.test.ts (37 tests), then restored.
```
HEAD (no mutant):                   pass 37 fail 0 skipped 0
kernel cap 511:                     pass 33 fail 4 skipped 0  [AC-326-4b, AC-326-9, AC-326-6, AC-326-4]
kernel cap 513:                     pass 35 fail 2 skipped 0  [AC-326-4b, AC-326-9]
kernel cap 600:                     pass 34 fail 3 skipped 0  [AC-326-4b, AC-326-3c, AC-326-9]
kernel cap 700:                     pass 33 fail 4 skipped 0  [AC-326-3b, AC-326-4b, AC-326-3c, AC-326-9]
kernel cap 750:                     pass 33 fail 4 skipped 0  [AC-326-3b, AC-326-4b, AC-326-3c, AC-326-9]
kernel cap 800:                     pass 33 fail 4 skipped 0  [AC-326-3b, AC-326-4b, AC-326-3c, AC-326-9]
kernel cap 1024:                    pass 32 fail 5 skipped 0  [AC-326-3b, -3c, -4, -4b, -9]
kernel cap 2048:                    pass 32 fail 5 skipped 0  [AC-326-3b, -3c, -4, -4b, -9]
cap removed (return text always):   pass 29 fail 8 skipped 0  [AC-326-1, -2, -3, -4 hook, -3b, -4b, -3c, -4 unit]
slice literal 600, const kept 512:  pass 35 fail 2 skipped 0  [AC-326-4b, AC-326-3c]
```
- Cap 513 is now killed by a behavioural test (AC-326-4b), not only by the source scrape.
- Round 1's survivors (513, 600, 700, 750, 800) are all dead.
- A mutant that bypasses the constant by hard-coding the slice to 600 is also killed, by behaviour.

### 2. [CLEAN][demonstrated] 7168 is a sound bound
**Scenario.** An attacker looks for any input that pushes deny stdout past 7168 bytes, or past the runtime's 10,000-character limit.

**Code-traced ceiling:**
- Only two `unresolved` entries can carry attacker-sized text: src/policy/normalizer/shell.ts:365 (verb) and :369 (resource). The resource entry is one join, so it is one entry no matter how many tokens there are.
- The other push sites hold fixed text: :146/:148/:150 (operators), :304 (pushed once, then returns an empty list) and :371.
- structured-cluster.ts:22 builds a single-entry record, and the gate does not route to it.
- The gate's tool_name reflection is JSON-escaped before the cap (decide-tool-call.ts `bounded(JSON.stringify(toolName))`), so it is at most about 7 bytes per 6 units: 825 B measured.
- The terminal sanitizer (src/policy/config/sanitize.ts:24) strips Cc/Zl/Zp and never expands text.
- JSON.stringify's widest escape is 6 bytes, for a lone surrogate.
- The ceiling is therefore 2 x (512 units, with an ASCII prefix inside the cap, at up to 6 B each) + 2 markers + framing.

**Dynamic sweep.** 18 shapes through the real hook via gate-sandbox, using the probe hooks/rt326b-probe.test.ts (worktree only, deleted):
```
2-entry lone 64K                                     code=0 decision=deny bytes=6254 chars=6252
2-entry lone 1M (marker digits)                      code=0 decision=deny bytes=6258 chars=6256
2-entry low-surrogate 64K                            code=0 decision=deny bytes=6254 chars=6252
2-entry reversed pair (lone+lone)                    code=0 decision=deny bytes=2320 chars=1334
verb lone + resource euro                            code=0 decision=deny bytes=4784 chars=3802
2-entry lone, no quotes, many resource tokens        code=0 decision=deny bytes=6224 chars=6222
2-entry lone + --context lone                        code=0 decision=deny bytes=3241 chars=3239
2-entry lone + -n lone                               code=0 decision=deny bytes=3234 chars=3232
bash -c inner 2-entry lone                           code=0 decision=deny bytes=6254 chars=6252
nested wrappers 2-entry lone                         code=0 decision=deny bytes=3211 chars=3209
chain lone                                           code=0 decision=deny bytes=235 chars=233
subst lone                                           code=0 decision=deny bytes=234 chars=232
redirect 2 targets lone                              code=0 decision=deny bytes=283 chars=279
tool_name unroutable lone                            code=0 decision=deny bytes=825 chars=825
tool_name unroutable ctrl (JSON.stringify pre-escape) code=0 decision=deny bytes=825 chars=825
tool_name nonstring lone obj                         code=0 decision=deny bytes=814 chars=814
mcp lone names                                       code=0 decision=deny bytes=182 chars=180
session_id lone                                      code=0 decision=deny bytes=6254 chars=6252
MAX bytes over all shapes: 6258
tests 1  pass 1  fail 0  skipped 0
```
- Every output parsed as valid JSON with decision "deny", and every run exited 0.
- Going from 64K to 1M units adds 4 bytes (marker digits). A 10x larger input adds about 1 more byte.
- The runtime limit per https://code.claude.com/docs/en/hooks is 10,000 characters for additionalContext, systemMessage, initialUserMessage and plain stdout, and has no setting to raise it. 6258 bytes is at most 6258 characters, so the output stays under the limit whichever reading applies.

### 3. [CLEAN][demonstrated] AC-326-9 parity is meaningful, and kernel purity holds
```
gate REASON_NAME_CAP 600 only:      pass 36 fail 1 skipped 0  [AC-326-9]
gate REASON_NAME_CAP 511 only:      pass 36 fail 1 skipped 0  [AC-326-9]
both caps 600:                      pass 34 fail 3 skipped 0  [AC-326-4b, AC-326-3c, AC-326-9]
kernel cap 513 (gate kept):         AC-326-9 fails (attack 1)
```
- A drift in either constant alone is caught only by AC-326-9, so the test carries weight.
- A matched drift is caught by the ===512 pin and by behaviour.
- The scrape reads through new URL(..., import.meta.url), so it does not depend on cwd. A renamed or reformatted constant fails loudly (assert.ok on both matches), and nothing is skipped.
- The kernel gains no import.
- node src/qa/kernel-purity-check.ts: "PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations."

### 4. [CLEAN][demonstrated] No test was weakened compared with round 1
- git diff 81d6b84 2d02d69 on the reason-cap test file changes only the MAX_STDOUT comment and constant.
- The first 23 assert lines of the file are identical at 569ac7f and at 2d02d69: diff of the grep output was empty, printing "PRE-EXISTING ASSERT LINES IDENTICAL". The file went from 23 to 34 assert lines.
- src/policy/kernel/kernel.test.ts is untouched (the src/policy diff is empty).
- Raising MAX_STDOUT from 4096 to 7168 does relax the upper bound in AC-326-1, -2 and -3. I checked whether that costs any kill power by running the same mutants with MAX_STDOUT set back to 4096:
```
entry reflected twice, MAX 7168:    pass 33 fail 4 skipped 0  [AC-326-3b, -3c, -4, -6]
entry reflected twice, MAX 4096:    pass 33 fail 4 skipped 0  [AC-326-3b, -3c, -4, -6]   (same kill set)
HEAD kernel, MAX 4096:              pass 36 fail 1 skipped 0  [AC-326-3c]  (confirms 3c was red under 81d6b84's 4096)
```
- The 3-byte case keeps its old 4096 bound through MAX_STDOUT_3BYTE.
- The relaxation matches what the round-1 finding asked for. It cost no kill power in any mutant I tried.
- The #312 guard suites (pretooluse-kernel-gate-sanitize, pretooluse-kernel-gate, sanitize, gate-structure, render-hook-output) are unchanged: tests 146 pass 146 fail 0 skipped 0.

### 5. [CLEAN][code-traced] kernel.ts is unchanged, and the entry count is bounded
- git diff --name-only 569ac7f 2d02d69 -- src/policy returns nothing, so the whole src/policy tree is byte-identical, kernel.ts included.
- The only src/ changes in the range are in src/qa (from the #320/#374 stories), which is outside this surface.
- The number of unresolved entries is bounded: shell.ts:304 pushes once and returns, and :365, :367/:369 and :371 each push at most once. That gives at most 4 entries, and at most 2 of them carry attacker text.

## Findings to tests
Open findings: 0. Failing tests: 0. #375's named tests (AC-326-3b, -4b, -3c) exist, pass at HEAD, and kill the round-1 survivors. #375 can close. Closing is the Manager's call; I have not closed it.

## Scariest unproven assumption
Unchanged from round 1: that the live Claude Code runtime delivers a deny stdout of about 6.3 KB to its decision parser intact. The documented limit (10,000 characters) covers it, but no live session has measured it, because the hook is not wired (#308).

A structural residual to watch: the per-entry cap does not bound how many entries there are. A future normalizer push site that reflects untrusted text would add about 3 KB per entry. A third entry would still fit under 10,000; a fourth would not. Only a test covering that shape would notice. This is not a finding today: there is no such site, and the count is bounded by the code cited in attack 5.

## Next action
Close #375 (Manager) with a reference to 2d02d69. No further rework on #326.

## Editorial
- Reason-cap test header, derivation. "(512 x 6 + 45) = 6234, plus about 700 bytes of fixed reason text" overstates the framing:
  - The entry prefixes ("command verb", "command resource" plus the a/b/ lead) are ASCII and sit inside the 512 units.
  - So the real per-entry cost is about 3.0 KB, and the framing is about 210 B, which matches the measured 6254.
  - The error is on the safe side.
- Same header and CHANGELOG say "the runtime's documented 10,000-character hook-output cap". The doc lists additionalContext, systemMessage, initialUserMessage and plain stdout; permissionDecisionReason in JSON output is not named. The bound holds under either reading, so tighten the wording rather than the number.
- My round-1 report gave "6252 bytes" for the two-entry lone-surrogate case. 6252 is the character count; the byte count is 6254, because the reason's em dash is 3 bytes. The CHANGELOG's 6254 is the correct byte figure.
- AC-326-3's title still says "maximal-expansion" (carried over from round 1); the payload is not maximal.

RECEIPT: verdict=go
attacks:
1. [CLEAN][demonstrated] Cap drift sweep: kernel cap 511/513/600/700/750/800/1024/2048, cap removed, slice-literal 600 all killed (513 by behavioural AC-326-4b, not only the scrape); round-1 survivors dead; #375 closed by this delta
2. [CLEAN][demonstrated] 7168 is sound: 18-shape real-hook lone-surrogate/3-byte sweep max 6258 B (1M-unit two-entry, marker digits the only growth), all valid JSON deny exit 0; code-traced ceiling of 2 attacker entries x 512 units x 6 B; under the documented 10,000-char runtime cap
3. [CLEAN][demonstrated] AC-326-9 parity meaningful: gate-only drift (600, 511) killed only by AC-326-9; matched drift killed by the ===512 pin plus behaviour; scrape fails loudly on rename; kernel-purity PASS (0 imports)
4. [CLEAN][demonstrated] No test weakened: pre-existing 23 assert lines identical, kernel.test.ts untouched; MAX_STDOUT relaxation loses no kill power (dup-entry mutant same kill set at 4096 and 7168); #312 guards 146/0/0
5. [CLEAN][code-traced] kernel.ts unchanged (src/policy diff 569ac7f..2d02d69 empty); unresolved entry count bounded at 4 (shell.ts:304 push-once-return, :365/:369/:371), at most 2 attacker-sized
counts: issues=0 suspicions=0 clean=5
evidence: demonstrated=4 code-traced=1 derived=0
checks=HEAD 37/0/0; mutants 15 run, 15 killed, 0 survived; probe sweep 1/0/0 (max 6258 B); #312 guards 146/0/0; kernel-purity PASS
adr=HIT(37)
report=docs/reviews/s326-deny-reason-cap-red-team-round2-2026-09-30.md
