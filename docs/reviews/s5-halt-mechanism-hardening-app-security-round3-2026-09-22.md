# App Security Review - Round 3 - fix/s5-halt-mechanism-hardening (Issue 277, architectural redesign)

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-22
Commit reviewed: df81dbf on fix/s5-halt-mechanism-hardening (checked out detached in an isolated worktree)
Prior report: docs/reviews/s5-halt-mechanism-hardening-app-security-round2-2026-09-22.md - round-2 verdict REWORK (Finding 5 / Issue 277)
Tier: CRITICAL (named sensitive area - policy enforcement / session gates, CLAUDE.md)
ADR cache: HIT (2 ADRs cataloged, docs/adr). Neither THOTH-ADR-0001 nor THOTH-ADR-0002 applies to hooks/userpromptsubmit-halt-relay.mjs. No applicable ADRs found for this diff.

## Summary of the round

Rounds 1-3 each tried to detect a forged "(unlock: ...)" parenthetical in untrusted text (escape parens, then NFKC-widen, then neutralize the literal unlock: token) and each round's reviewers found a new evasion shape. This round (round 4 of the underlying mechanism, my round 3 of review) deletes the whole detection approach: the trusted unlock instructions are now built exclusively from code-controlled strings and placed unconditionally on the message's first physical line; untrusted text is relegated to later lines behind a fixed banner, separated by a real newline that untrusted text can never contain (stripped by the pre-existing diagnosticSanitize control-character strip). I re-verified this claim against the shipped code and tests, ran an independent adversarial probe against pieces the shipped suite does not cover, and re-confirmed rounds 1-2's closed findings are untouched.

## Task 1 - Does the redesign close the CLASS of Issue 277, not just the tested instances?

Yes - code-traced, and reasoned from the architecture, not from re-running the old regex.

Round 2's defect was structural to the approach: neutralizeUnlockToken was a literal-substring matcher trying to enumerate every way "unlock:" can be spelled in Unicode - a race that cannot be won (finite regex vs. Unicode's effectively unlimited confusable/invisible repertoire). The round-4 fix does not enumerate anything; it removes the need to.

Traced (hooks/userpromptsubmit-halt-relay.mjs:190-193, composeFullMessage):

composeFullMessage returns trustedLine unchanged when there are no diagnostic lines; otherwise it returns the array [trustedLine, DIAGNOSTIC_BANNER, ...diagnosticLines] joined with a single real newline character (Array.prototype.join(String.fromCharCode(10)) in the shipped source, written literally as a newline-character string literal) -- the join call itself is the only place a newline is ever inserted, and it never derives that newline from any argument.

trustedLine is built by composeTrustedSummary/trustedReasonLabel/trustedUnlockHint (hooks/userpromptsubmit-halt-relay.mjs:235-254,412-415) exclusively from FRIENDLY_LABELS, UNLOCK_HINTS, and this file's own literal text - key is used only as an Object.hasOwn property-lookup, never interpolated; index/activeReasons.length are the file's own loop counters. No third-party string reaches trustedLine under any payload shape, by construction - this is a stronger claim than "no known bypass," and it generalizes to variants round 2 never tested (e.g. a ninth or tenth confusable script, RTL homoglyphs, future Unicode additions) because there is no matching logic left to defeat.

The join boundary is real: diagnosticSanitize (hooks/userpromptsubmit-halt-relay.mjs:162-175) strips ASCII control characters (0x00-0x1F, 0x7F) before any third-party text reaches this file, which includes the newline byte 0x0A. A value with no newline cannot introduce one - this is a fact about the value's content, not a claim about what the value contains, so it holds for every payload, not just the ones in the test suite.

Independent confirmation, not just re-reading the design: I ran the full new test suite (42/42 pass, see Test evidence) covering both round-2-demonstrated bypasses (zero-width U+200B mid-token, and, going further than what round 2 itself demonstrated, U+00AD, U+2060, Cyrillic/Greek homoglyphs, and two colon lookalikes) plus the full production path (hostile claude.ai connector name into the real sessionstart-tool-enum.mjs writer into the real relay). All land on the diagnostic line, never the trusted line. I additionally reasoned about, and probed, shapes outside that list (see Task 3) to test whether the architecture, not just the enumerated test cases, holds.

Verdict: the round-2 vulnerability class (literal-substring token detection defeated by Unicode) is closed by construction, not by patching each demonstrated instance.

## Task 2 - Round-1 Finding 1 (env var) and Finding 2 (Issue 274) re-verification

Untouched. hooks/sessionstart-tool-enum.mjs is byte-identical between e04dde0 (the commit my round-2 report reviewed) and df81dbf (this round) - confirmed by "git diff e04dde0..df81dbf --stat -- hooks/sessionstart-tool-enum.mjs" returning empty. This round's diff touches only hooks/userpromptsubmit-halt-relay.mjs, its own test files, CHANGELOG.md, and docs/run-log.jsonl (confirmed via git show --stat df81dbf). resolveFallbackSessionId() reading CLAUDE_CODE_SESSION_ID (Finding 1 / Issue 96) and reconcileReason's sessionIdFromStdin-gated collision guard (Finding 2 / Issue 274) are both in the untouched file - nothing in this round's diff can have regressed either. No re-verification of the underlying logic was needed beyond confirming the file is unchanged; I confirmed it via a real diff command, not by assumption.

## Task 3 - Standard app-security re-pass: new injection surface from the restructured composition?

### CLEAN, code-traced: No new dependency, no secrets, no shell/eval/deserialization, no new endpoint/authz surface

"git diff e04dde0..df81dbf -- package.json package-lock.json" returns empty. Pure string-composition refactor inside two existing hook files; no new I/O, no new trust boundary crossed.

### CLEAN, code-traced: sessionId interpolation into the trusted line is safe by construction, not by omission

blockWithMessage (hooks/userpromptsubmit-halt-relay.mjs:379) interpolates sessionId directly into trustedLine: the template literal reads "thoth halt: session <sessionId> blocked -- <trustedSummary>". This is the one place the "trusted line never interpolates third-party text" claim needs scrutiny, since sessionId can originate from the env fallback (host-provided, same trust tier as before, see round-2 Finding 2 discussion) rather than purely this file's own literals. Traced: every value that reaches sessionId is gated by isValidSessionId (the pattern letters, digits, dot, underscore, hyphen only, 1 to 128 characters, hooks/userpromptsubmit-halt-relay.mjs:311) before use. That charset excludes colon, both parentheses, and all whitespace - so even in the already-established, pre-existing, not-new-to-this-diff trust-boundary scenario where an env-resolved or stdin-resolved session id is attacker-influenced, it structurally cannot spell an "(unlock:" parenthetical or any colon-based forgery. This isn't a new gap and isn't newly introduced by this round, it's the same interpolation point that existed before round 4, but it is worth naming explicitly since Task 3 asked about the restructured composition specifically: this seam is closed by the pre-existing shape gate, not by the round-4 redesign itself, and the redesign does not weaken it.

### SUSPICION, MED, code-traced: diagnosticSanitize strips ASCII control characters and the newline byte specifically, but not Unicode format or bidi-control characters (Cf category) or C1 controls (0x80 to 0x9F) - confined to the already-disclaimed diagnostic region, not demonstrated to cross the trusted/diagnostic boundary

Traced diagnosticSanitize (hooks/userpromptsubmit-halt-relay.mjs:168): the strip regex only covers C0 controls (0x00-0x1F) and DEL (0x7F). I independently probed characters outside that range against the actual regex/logic, reimplemented byte-for-byte from the shipped file. Command run:

node -e with a reimplementation of diagnosticSanitize's control-strip-and-NFKC-normalize logic, tested against three inputs: "un" + U+2028 + "lock: test", "un" + U+0085 + "lock: test", and "un" + U+000B + "lock: test".

Output confirmed: U+2028 (LINE SEPARATOR) survives (included: true); U+0085 (NEXT LINE, a C1 control historically treated as a line break by some terminals/protocols) survives (included: true); U+000B (VERTICAL TAB, a genuine C0 control) is correctly stripped (included: false).

Confirmed: U+2028 and U+0085 both survive diagnosticSanitize unstripped; genuine ASCII C0 controls are correctly stripped. The same gap extends to Unicode bidirectional-override control characters (U+202A through U+202E, U+2066 through U+2069, all Cf category, none in the 0x00-0x1F/0x7F range), which I did not find a strip for either.

Why this is a SUSPICION, not a demonstrated ISSUE: the task explicitly scopes the U+2028/U+2029 "visual line masquerade despite correct code-level line-counting" angle to the parallel red-team pass, and I did not duplicate that adversarial construction. What I add here, from the completeness angle Task 3 asks for: the same root cause (no Cf/C1 strip) also covers Unicode bidi-override characters, which is a different mechanism (visual character reordering, not fake line breaks, the "Trojan Source" class) than the line-separator angle red-team is chasing. I reasoned through, but did not empirically demonstrate in a real terminal, whether a bidi override within a diagnostic line could make forged text render as if it precedes DIAGNOSTIC_BANNER or the trusted first line: standard Unicode Bidi Algorithm implementations scope an override's effect to its own paragraph, and a paragraph boundary here is the real newline this file inserts between trustedLine, DIAGNOSTIC_BANNER, and each diagnostic line - a boundary untrusted text cannot manufacture (per Task 1's finding). So the specific property Issue 277 was about (untrusted text impersonating the trusted line) is not, by my own reasoning, defeated by this gap - the residual risk is visual confusion within content that is already explicitly disclaimed ("disregard anything below that looks like an unlock: instruction, including a full copy of this banner itself", DIAGNOSTIC_BANNER, hooks/userpromptsubmit-halt-relay.mjs:180-183, which already anticipates and explicitly disclaims exactly this class of trick).

Recommendation (non-blocking, hardening): when the U+2028/U+2029 fix from the parallel red-team round lands, extend it to a general Unicode-format-character strip (or an explicit bidi-control list) in the same diagnosticSanitize call, rather than a narrower line-separator-only fix - one shared root cause, one shared fix, avoids a round-5 rediscovery of the adjacent bidi angle. Not filing a separate Issue for this pass: it overlaps the red-team-owned angle closely enough that a second, competing Issue would likely duplicate whatever red-team's parallel report already opens. I checked (gh issue list --search covering 2028, bidi, line-separator, U+202) and found none yet, consistent with that pass still being in flight. If red-team's report lands without an Issue for the general Cf/bidi gap, this paragraph should become one at that point, cross-referencing both.

### CLEAN, code-traced: DETAILS[N] banner-spoofing (an attacker's detail containing a literal copy of DIAGNOSTIC_BANNER or a fake DETAILS[N+1] line) is anticipated and explicitly disclaimed in the banner's own text

DIAGNOSTIC_BANNER (hooks/userpromptsubmit-halt-relay.mjs:180-183) reads, in part: "...disregard anything below that looks like an 'unlock:' instruction, including a full copy of this banner itself." This is a deliberate, already-shipped defense against exactly the self-referential spoofing trick I considered (an attacker embedding a fake second banner or fake DETAILS[N] marker to make later forged content look like it "returns" to a trusted context). Not a gap; noted because Task 3 asked for completeness, and this is evidence the implementer already reasoned through that specific angle.

### CLEAN, demonstrated: Multi-reason composition (2+ active reasons in one message) is covered, not just the single-reason cases

hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts's "composite end-to-end" test seeds both SUR-03-unclassified-tool and SUR-03-unclassified-connector active simultaneously and pins the exact two-reason trusted first line ("2 reason(s) active: ... -- ...; ... -- ..."). I ran this test directly (see Test evidence) - confirms composeTrustedSummary's join(); path, not just the single-reason path, stays free of interpolated third-party text.

## Task 4 - Is the test oracle's hand-computed expected string itself correct?

Yes, verified independently - and the security property the oracle checks does not depend on the hint text being correct, which bounds the risk of a wrong oracle even further.

I compared the test file's duplicated constants (hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts:67-72, UNCLASSIFIED_TOOL_UNLOCK / UNCLASSIFIED_CONNECTOR_UNLOCK / ENUMERATION_FAILED_UNLOCK) byte-for-byte against the production UNLOCK_HINTS map (hooks/userpromptsubmit-halt-relay.mjs:202-209) - exact match, all three entries, including punctuation and separators.

Two more checks on top of a literal diff, per the task's own framing (could the hand-computed string be wrong in a way that masks a real defect):

1. The oracle's discriminating power does not depend on the hint text's correctness. The property under test is "the first physical line contains zero attacker-influenced characters." If the implementation leaked even one payload character onto line 1, the exact-string-equality assertion would fail regardless of whether the expected string's own prose is accurate - a typo in UNCLASSIFIED_TOOL_UNLOCK's wording would make a correct implementation fail the test (a false negative on correctness), not make a defective implementation pass it (a false negative on security). That asymmetry is the right one for a security oracle: it can be too strict, never too permissive, from a wording error.

2. Non-circularity is structural, not just non-matching by coincidence. Round 2's tautology (countUnlockTokenOccurrences byte-identical to the defense's own regex) is impossible here because the defense no longer performs any text-matching against untrusted content at all - there is no shared regex/algorithm left for an oracle to accidentally duplicate. Exact string equality against a fully-enumerated literal is about as far from "the same matching logic as the defense" as a test can get.

One coverage gap worth naming (editorial, not a defect): the oracle's copy-paste duplication means a genuine future typo in UNLOCK_HINTS' prose (e.g. a wrong file path in the unlock instructions) would need its own separate check - this test suite doesn't cross-check the content of the hint against reality (e.g. that docs/qa/s5-central-classification.json is still the right file to point at), only that untrusted text never displaces it. That's out of scope for this task's oracle question specifically (it's a documentation-accuracy concern, not a security one) - noted, not gating.

## Test evidence

npm test: tests 1063, pass 1062, fail 1, skipped 0. The 1 failure is src/qa/reference-resolver.test.ts:121 ("QA-14 (dogfood)... resolves clean"), an unresolved citation "ADR-0021" - pre-existing, environment-specific (adr/ submodule not initialized in this worktree), the same artifact rounds 1-2 both hit. CHANGELOG's claim of "0 fail" reflects a worktree WITH the submodule initialized, not a discrepancy in the diff itself.

npm run typecheck: tsc --noEmit -p tsconfig.json - clean, no output.

npm run lint: eslint . - clean, exit 0.

node --test against hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts, hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts, hooks/userpromptsubmit-halt-relay-fixnow.test.ts, hooks/sessionstart-tool-enum-session-id-fallback.test.ts: tests 42, pass 42, fail 0, skipped 0.

git diff e04dde0..df81dbf -- package.json package-lock.json: empty.

git diff e04dde0..df81dbf --stat -- hooks/sessionstart-tool-enum.mjs: empty (file byte-identical, Findings 1/2 unregressed by construction).

Independent Cf/C1-character probe (Task 3, diagnosticSanitize reimplemented byte-for-byte from the shipped file): see Task 3 above for the full description and output.

## Verdict

APPROVE.

Issue 277 (both the zero-width-character and homoglyph bypasses I demonstrated in round 2) is closed - not patched instance-by-instance, but closed as a class: the detection-based approach that created the whole bug family is deleted, replaced with a positional guarantee that holds for any payload shape by construction, independently re-verified against 42 passing tests (including the exact two round-2 PoCs re-run against the new code) and my own reasoning about variants outside the shipped test list. Round-1 Findings 1 and 2 are provably unregressed - the file they live in is byte-identical to the commit I already cleared. The new test oracle is sound: non-circular by construction (no shared matching logic left to be circular with) and its security-relevant assertion does not depend on the correctness of the hand-duplicated hint prose. One MED suspicion (Cf/C1 characters, including bidi-override controls, are not stripped by diagnosticSanitize) is real at the code level but, by my own reasoning, confined to the already-disclaimed diagnostic region rather than defeating the trusted/diagnostic line separation itself - not demonstrated as an exploit, and closely adjacent to the angle the parallel red-team pass owns this round. It does not gate.

## Next action

No blocking work. When the parallel red-team pass's U+2028/U+2029 finding (if any) lands a fix to diagnosticSanitize, widen it to a general Unicode-format-character strip (covering bidi-override controls too) rather than a narrower line-separator-only patch, per the Task 3 suspicion above - one shared fix for one shared root cause. Issue 277 closed (see comment). No new Issue filed this round.

---
RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [SUSPICION][MED][code-traced] hooks/userpromptsubmit-halt-relay.mjs:168 -- diagnosticSanitize's control-character strip does not cover Unicode format/bidi-control characters (Cf category, e.g. U+202A-U+202E) or C1 controls (0x80-0x9F, e.g. U+0085 NEL); confirmed by direct probe against the shipped regex logic. Confined to the already-disclaimed diagnostic region by my own reasoning (real newline paragraph boundaries scope bidi overrides in standard implementations, and untrusted text still cannot produce that boundary) -- not demonstrated to defeat the trusted-first-line guarantee Issue #277 was about. Overlaps the parallel red-team pass's U+2028/U+2029 angle (same root cause); recommend one shared fix when that lands rather than a separate Issue now.
2. [CLEAN][code-traced] Issue #277 (round-2 Finding 5) is closed as a CLASS, not per-instance: the trusted first line (hooks/userpromptsubmit-halt-relay.mjs:190-193,235-254,412-415) is built exclusively from code-controlled strings with no interpolation of any third-party value under any payload shape, by construction -- not "no known bypass" but "no matching logic left to bypass". Reasoned independently of the shipped test list, then confirmed via the shipped suite (42/42 incl. both round-2-demonstrated PoCs re-run against the new code, plus 5 additional shapes and the full production path).
3. [CLEAN][code-traced] Round-1 Finding 1 (env var, Issue #96) and Finding 2 (Issue #274, provenance guard) are provably unregressed -- hooks/sessionstart-tool-enum.mjs is byte-identical between e04dde0 (my already-cleared round-2 commit) and df81dbf (this round); this round's diff never touches that file.
4. [CLEAN][code-traced] sessionId interpolation into the trusted line (hooks/userpromptsubmit-halt-relay.mjs:379) is safe by construction: isValidSessionId's charset excludes colon, parentheses, and whitespace, so it structurally cannot forge a parenthetical/colon-based unlock instruction even in the pre-existing (not new to this round) scenario where the value is env-resolved.
5. [CLEAN][code-traced] DIAGNOSTIC_BANNER's own text (hooks/userpromptsubmit-halt-relay.mjs:180-183) already anticipates and disclaims self-referential spoofing (a forged copy of the banner itself, or a fake DETAILS[N] marker) -- a deliberate defense, not a gap.
6. [CLEAN][demonstrated] Multi-reason (2+ active reasons in one message) composition is covered by the shipped "composite end-to-end" test, not just single-reason cases -- ran it directly, passes.
7. [CLEAN][demonstrated] Test oracle (exact string equality of the first physical line) verified non-circular by construction (no shared matching logic left in the defense to be circular with) and its security-relevant assertion does not depend on the hand-duplicated hint text being wording-accurate -- a wrong hint would fail a correct implementation's test (false negative on correctness), never pass a defective one (never a false negative on security).
8. [CLEAN][demonstrated] No new dependency (package.json/lockfile diff empty), no secrets, no shell/eval/deserialization, no new endpoint/authz surface.
9. [CLEAN][demonstrated] Full suite 1062/1063 pass in this worktree; the 1 failure is the same pre-existing, diff-unrelated environment artifact as rounds 1-2 (uninitialized adr/ submodule) -- CHANGELOG's "0 fail" reflects a worktree with the submodule initialized. typecheck and lint both clean.
counts (checksum): issues=0 suspicions=1 clean=8
evidence (checksum): demonstrated=4 code-traced=5 derived=0
checks="1062/1/0 (1 fail pre-existing/env-unrelated, see finding 9); 42/0/0 on the new+adjacent regression files; typecheck clean; lint clean"
adr=HIT(2 live; neither applicable to this diff)
report=docs/reviews/s5-halt-mechanism-hardening-app-security-round3-2026-09-22.md
