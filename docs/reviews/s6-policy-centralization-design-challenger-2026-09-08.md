# S6 "Policy Centralization" — Pre-Build Design-Challenger Attack, Round 1

**Target:** `docs/plans/S6-phase1-2026-09-08.md` (Milestone #24). **Tier:** CRITICAL. **Round:** 1 of this artifact (`roundsSinceLastGo`=0, `councilHeld`=false going in). **Reviewer:** design-challenger (Apep). **Date:** 2026-09-08.

**Scope discipline:** per the task brief, the following are already ruled and NOT attacked here: the HKLM channel choice itself (only its *unverified evidentiary basis* is attacked, which the plan already discloses as open), all-three-tiers-real-files, content-authoring-out-of-scope, mandatory-lock strictness (reject outright/unconditionally), mandatory-lock scope (general form, tested only central→project — the *decision* to build/test this way is not attacked; the *residual risk it knowingly accepts* is).

**Framing note, stated up front so the verdict isn't misread:** almost none of the new code this plan describes exists yet (`src/policy/config/**` is entirely unwritten). A pre-build attack on unwritten code cannot demonstrate a runtime BREAK — there is nothing running to break. Every finding below is therefore `derived` by the evidence-tier rule (capped at MED, never a blocking HIGH), several reinforced by `code-traced` facts about code that *does* already exist and that the plan leans on. This is the correct, expected shape for a round-1 pre-build attack on a mostly-unwritten mechanism — it does not mean the attacks are weak, only that none of them can gate on their own. All six route to named proof-tests, per the boundary-crossing carve-out (rule 21) where applicable and per plain good practice otherwise.

---

## Attack A — The real Windows-registry channel can never be executed, by anyone, before merge

**Scenario:** `central-source.ts`'s production reader shells out to `reg query HKLM\SOFTWARE\Policies\Thoth /v CentralPolicyJson`. Two structural facts converge to make this code's *first real execution* happen only after merge, on a machine nobody reviewing it can watch:

1. CI runs exclusively on `ubuntu-latest` — confirmed directly: `.github/workflows/ci.yml:32` and `:138` both say `runs-on: ubuntu-latest`, no Windows runner exists anywhere in the workflow. `HKLM` cannot exist there.
2. This session's own sandboxed Bash tool — the same class of environment `story-implementer` will build in — refused every `reg` invocation I attempted, both a benign read (`reg.exe query ... EnableLUA`) and the write probe the plan itself already disclosed being blocked on ("Permission for this action was denied by the Claude Code auto mode classifier"). This independently reproduces the plan's own §3 disclosure, in a fresh session, with a different query — it isn't a one-off fluke of the implementer's own attempt.

Two separate pieces of code inherit this blind spot:
- **The write-ACL claim** (already disclosed by the plan as unverified) — whether an unelevated process running as the same identity a governed Claude Code session runs under can actually write `HKLM\SOFTWARE\Policies\Thoth`. The plan's own rationale cites "documented default Windows `HKLM\SOFTWARE` ACLs (Administrators=write, Users=read)" but never engages with UAC token-filtering: a local-admin user's *unelevated* processes normally run with a filtered standard-user token, so the operative question is not "what does the Administrators group get" but "does this specific process's token carry it" — a fact that flips depending on whether UAC is enabled, whether the session was ever launched elevated, and whether it's the exact machine class this project is dogfooded on (a developer's own machine, where the developer very plausibly *is* the local admin — this project's own build history is a Claude Code session running on the human's Windows machine throughout S1–S5).
- **The `reg query` stdout-parsing routine** — real `reg.exe query` output is a multi-line, indentation- and column-padded, locale-sensitive tabular format (blank line, key name, then `    <value>    REG_SZ    <data>`), not a bare JSON string. Whatever code turns that into the JSON text the loader hands to `validateRuleSet`/`position-parser.ts` is the single most novel piece of parsing in this story, and per AC7 (`docs/plans/S6-phase1-2026-09-08.md:109`) it is exercised only by "a mocked-`child_process` test of the `reg query` invocation shape" — that tests the *outbound* call (args passed to `execFile`), not the *inbound* stdout-to-JSON extraction. No AC names a test against a real captured `reg.exe` output sample, and per the two facts above, nobody building this story can capture one from inside this project's own tooling to test against.

**A secondary, code-traced correction to the plan's own confidence claim:** §6 says the subprocess diligence is "same diligence this project already applies to `mcp-enumeration.ts`'s subprocess calls." I read `src/policy/tools/mcp-enumeration.ts` in full and grepped it for `execFile|spawn|exec\(|timeout|maxBuffer` — zero matches. That file does no subprocess work at all; it's a pure JSON-object-key extraction function fed already-parsed input from its calling hook. There is no existing subprocess-safety precedent anywhere in this codebase to inherit — `central-source.ts` would be the first shelling-out code in the entire policy layer. The plan's citation is factually wrong, not just optimistic, and its actual effect is to make a genuinely novel risk read as an already-solved one.

**Evidence:** code-traced (`.github/workflows/ci.yml:32,138`; `src/policy/tools/mcp-enumeration.ts` grepped, 0 matches for any subprocess API) + demonstrated (my own two blocked `reg`/`whoami` attempts this session, raw denial text captured above).

**Exposure:** 100% of real deployments of this mechanism will run this code path unexercised-before-merge — basis: counted in code (CI matrix + this project's own sandbox behavior, not an assumption).

**Current defense:** the plan discloses the ACL claim as unverified rather than overclaiming it (a real, credited honesty practice, consistent with this project's history) — but discloses nothing about the *parsing* routine's total lack of a real-output test, and the "same diligence as mcp-enumeration.ts" line actively overstates the precedent.

**Tags:** severity MED (evidence=code-traced but reach=instrument caps at MED and never blocks on its own) · evidence=code-traced · reach=instrument · likelihood=routine (this WILL happen, not might) · undo=runbook-reversible (a human can manually verify post-merge on a real machine).

**Verdict:** UNPROVEN-pending-verification.

**Proof-test / unrun verification:**
1. Commit a **captured, real** `reg.exe query` output sample (run once, by a human, outside any agent sandbox, on this exact machine) as a fixture, and add a unit test for the stdout-extraction routine against that literal fixture string — not just the mocked invocation-shape test AC7 already names.
2. Add a one-line doc comment on `central-source.ts` naming this exact blind spot (CI cannot exercise it; no agent sandbox in this project's history has been able to either) so the next reader doesn't assume AC7 covers more than it does.
3. **Owner:** a human, on a real (non-agent-sandboxed) Windows shell — this is explicitly not something any agent session in this project can currently perform.

---

## Attack B — The fail-closed bucket has more shapes than the AC table names

**Scenario:** §6 states: "central channel present but malformed (bad JSON / fails schema) = loader refuses to produce ANY merged policy." This groups two structurally different failure code paths under one word. I read `src/policy/rule/schema.ts` in full: `validateRuleSet()` **returns** a `ValidationError[]` (data, never throws) for a syntactically-valid-JSON-but-schema-invalid input (e.g. `{"version": 1, "rules": "not-an-array"}` — valid JSON, wrong shape). A `JSON.parse()` failure, by contrast, **throws**. These are two different exceptional paths in the code the loader must write, and AC5 (`docs/plans/S6-phase1-2026-09-08.md:107`) names only one test: "malformed central JSON → whole load rejected" — worded as a parse failure, not a schema failure.

A third state is also under-specified: subprocess failure. §6 names "a bounded timeout" and "an output-size cap" as constraints but never says which bucket a timeout, an `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER` (Node's default `execFileSync` buffer is 1MB; nothing bounds how large an admin can make a `REG_SZ` value), or a non-zero `reg query` exit code lands in. None of these three states — schema-invalid JSON, oversized/timed-out subprocess, non-zero exit — has a named test in AC5's or AC7's phrasing.

The failure mode that matters: if any of these three accidentally take the *"central absent"* code path (zero rules contributed) instead of the *"central malformed"* code path (whole load rejected), the effect is a **silent** security-boundary bypass — an admin believes they deployed a locked-down central policy; the loader silently behaves as if nobody had. That is exactly the "state silently diverges from reality" trust wound this review method ranks above everything else, and it is exactly the shape of bug this project has shipped and caught before (S2 Issue #62, S3 Issues #65/#66 — all "a typed input trusted without an explicit check," the same root-cause class recurring one layer deeper each time per the S5 council's own diagnosis).

**Evidence:** derived (the defect is in unwritten loader code) — reinforced by code-traced fact (`src/policy/rule/schema.ts:71-102`, `validateRuleSet` genuinely is a second, distinct, non-throwing failure path, so unifying it with the throwing JSON.parse path is a real integration step the loader must get right, not a hypothetical).

**Exposure:** unbounded/uncounted (depends on how central content is authored, which is explicitly out of S6's scope) — basis: assumption for exposure, but this is a security-boundary-crossing mechanism (POL-07/POL-09's whole trust hierarchy), which is exempt from the exposure-percentage cap per rule 21's own carve-out.

**Current defense:** none yet — the loader doesn't exist. `schema.ts`'s own discipline (strict unknown-key rejection, structured errors) is solid and SURVIVES on its own; the gap is purely in how the not-yet-written loader is specified to consume it.

**Tags:** severity MED (derived, capped) · evidence=derived · reach=operator (requires an admin-side central deployment mistake, or a large/slow registry value — not a routine end-user action) · likelihood=plausible · undo=reversible in principle (an admin can fix the value) but the divergence is silent, so severity does not downgrade (silent+security-relevant keeps its severity per the calibration rule).

**Verdict:** UNPROVEN.

**Proof-test:** `loader.test.ts` gets three additional named cases beyond AC5's single one: (1) syntactically-valid JSON that fails `validateRuleSet` → same "whole load rejected" outcome as parse failure, asserted byte-for-byte identical in kind (not just "also an error"); (2) an injected `CentralPolicySource` whose `read()` throws a buffer/timeout-shaped error → same rejection, not silently treated as absent; (3) a table test asserting central-absent, central-malformed-JSON, central-schema-invalid, and central-read-error all produce *distinguishable but equally fail-closed* outcomes — none of the three failure shapes collapses into the "absent" (zero-rules, non-rejecting) bucket.

---

## Attack C — General-form mandatory-lock: the untested direction is exactly where this codebase's own bug pattern would hide

**Scenario:** the ruling (already settled, not re-litigated here) builds `mergeLayersWithMandatoryLock` as a genuinely general "any earlier layer's `mandatory: true` rule cannot be redefined by a later layer" mechanism, but tests only the central→project direction. I read `src/policy/rule/precedence.ts` in full: `mergeLayersById`'s existing core iterates layers in declared order and does an unconditional last-wins overwrite; adding lock semantics requires a new check, at write time, of whether the *existing* stored entry for that key was `mandatory`. There are two ways to write that check:

- **Correct/general:** `if (byId.get(key)?.item.mandatory) reject` — works for any layer pair, because it inspects the stored rule's own field, not which layer produced it.
- **Plausible-but-wrong:** `if (byId.get(key)?.sourceLayer === "central") reject` — reads identically correct for the one tested direction (central→project), compiles, passes 100% of the ratified AC1 test suite, and silently does nothing for shipped-defaults→central.

Both implementations are indistinguishable by the tests the plan ratifies (AC1 tests central→project only), and this project has shipped the second, wrong shape before under time pressure in structurally identical form — Issue #65/#66 (S3, "typed field trusted without a check"), Issue #99 (S5, an env var silently overriding a fixture instead of the intended layer-identity check) are both instances of "the check that looks equivalent for the tested case isn't equivalent for the general case."

**Current exposure is honestly 0% today**, and I want to be precise about that rather than overstate it: `shipped-defaults.json` ships as a `rules: []` placeholder per this same plan (content authoring is explicitly out of S6's scope), so there is no real mandatory shipped-defaults rule for a buggy general-form check to fail to protect *yet*. The risk is latent, not live. But it ships now, in this story, while the mandatory-lock code is fresh in review context — the moment a future content-authoring story adds a real mandatory shipped-defaults rule, this exact code path activates with **no review of the precedence mechanism itself scheduled** (that future story's review will focus on the new content, not re-audit S6's already-shipped merge logic).

**Evidence:** derived (no `mergeLayersWithMandatoryLock` code exists yet) — reinforced by code-traced fact (`precedence.ts`'s current generic-by-design shape, and the two-implementations-indistinguishable-by-the-ratified-tests argument, both directly verifiable from the file and the AC table as written).

**Exposure:** ~0% today, basis: counted in code (`shipped-defaults.json` ships empty by explicit scope ruling) — but this is POL-07, a named security/trust mechanism, exempt from the exposure-percentage cap per rule 21.

**Tags:** severity MED · evidence=derived · reach=operator (only reachable once a future story authors real mandatory shipped-defaults content — not reachable by an ordinary user today) · likelihood=plausible (not routine, not a forced operator error — a real, foreseeable implementation choice with this project's own documented history of making it) · undo=irreversible if it ships silently (a security-boundary rule silently overridable by central, discovered only if someone thinks to test the untested direction).

**Verdict:** UNPROVEN. This is the clearest boundary-crossing case in this report — per rule 21's carve-out, it may **not** be discharged to the residual register no matter how low its current exposure reads, precisely because the cap that would otherwise apply (0% exposure, `operator`-only reach) is the kind of cap the carve-out exists to override for security mechanisms.

**Proof-test:** add ONE `precedence.test.ts` case — shipped-defaults marks a rule `mandatory: true`, central attempts to redefine the same id, asserted rejected — as an *internal regression test pinning the general mechanism's correctness*, explicitly distinct from AC1's ratified central→project acceptance criterion (this does not reopen or expand S6's ratified scope; it is additive engineering hygiene closing a boundary-crossing risk the ratified scope already knowingly accepted). Cheapest possible moment to write it: now, while `mergeLayersWithMandatoryLock` is being authored for the first time.

---

## Attack D — Mandatory-lock rejection granularity is unspecified

**Scenario:** distinct from Attack C. When a project rule collides with a mandatory central id, is the **whole project layer** rejected (matching central-malformed's "refuses to produce ANY merged policy" semantics, §6), or is only **that one rule** dropped while the rest of the project layer still loads? AC1's own phrasing (`docs/plans/S6-phase1-2026-09-08.md:103`) — "project redefining a mandatory id → rejected ...; **untouched mandatory id passes through**; non-mandatory override still works normally" — reads as single-rule-scoped rejection (the rest of the project file still applies), which is a materially *weaker* fail-closed posture than central-malformation's whole-layer rejection. Nothing in the plan states this choice explicitly as a decision; it's implied only by a test assertion's incidental wording.

Why this matters: single-rule rejection lets a project author submit N legitimate overrides plus one mandatory-id violation, and if the mechanism silently accepts the N while rejecting only the 1, the author learns nothing is fundamentally wrong with their file — every other override still takes effect, unreviewed by any louder signal. Whole-layer rejection is a stronger deterrent, consistent with the "never silent allow" ethos the strictness ruling (byte-identical still rejected) explicitly invokes to justify itself. I am not asking to relitigate which one is correct — that's a legitimate design call either way — only flagging that the plan currently answers it only by accident, in a test's phrasing, not as a named decision.

**Evidence:** derived (reasoned directly from the plan's own text — no code exists to trace).

**Exposure:** unbounded/uncounted — basis: assumption — but boundary-crossing (POL-07 again), exempt from the percentage cap.

**Tags:** severity MED · evidence=derived · reach=operator · likelihood=plausible · undo=reversible (an operator inspecting the resolved policy printer, per POL-10, could eventually notice) but the ambiguity itself is a spec gap, not a runtime bug, so it isn't scored for silence the same way B/C are.

**Verdict:** UNPROVEN.

**Proof-test:** name the granularity explicitly as its own acceptance criterion (not folded into AC1's existing text), and add a `precedence.test.ts` case with a project layer containing 1 violating rule + 1 valid override, asserting the chosen granularity precisely (either "both rejected, whole layer void" or "only the violator rejected, the valid override still applies" — whichever the Manager/human picks, but picked deliberately, not left implicit).

---

## Attack E — The hand-rolled position-tracking tokenizer inherits a CRLF-class bug this project has already paid for once, in a channel structurally immune to the fix that closed it last time

**Scenario:** `position-parser.ts` is a from-scratch line/column-tracking JSON tokenizer with no dependency, feeding POL-10's entire acceptance bar ("One command answers 'why is this blocked' without reading a script"). Three concrete inputs are realistic, not contrived, and none has a named test:

1. **CRLF line endings.** I read `.gitattributes`: `* text=auto eol=lf` plus explicit per-extension `eol=lf` rules force LF normalization on git checkout — for `.json` files it covers. Both `shipped-defaults.json` and `.thoth/policy.json` are git-tracked and get this protection. **The central tier is not git-tracked at all** — it arrives as a `REG_SZ` registry string, written by whatever tool an admin used (PowerShell `Set-ItemProperty`, `reg add`, a GUI editor, a config-management tool) — none of which are bound by this repo's `.gitattributes`. This is precisely the CRLF class this project was bitten by once already: `.gitattributes`'s own header comment (I read it) names it explicitly — "S4 Stage-3 review, Finding 6 (Issue #75) ... a Windows checkout ... produced a silent split." The fix that closed that gap structurally cannot reach the one input source S6 adds that is genuinely new.
2. **Embedded escaped newlines inside string values.** POL-02's own acceptance text (REQUIREMENTS.md:426, read directly) mandates "multi-line rationale adjacent to the rule" — in valid JSON that can only mean a `rationale` string containing `\n` escape sequences. A hand-rolled tokenizer walking raw characters for line/column tracking must correctly distinguish an escaped `\n` *inside* a string (which must NOT increment its line counter, since JSON strings can't contain a literal newline) from an actual newline *between* tokens (which must). Getting this backwards is a one-character-class mistake with no compiler to catch it.
3. **Non-ASCII rationale text.** Column counting must be internally consistent (UTF-16 code units, since that's what JS string indexing gives you, vs. "visual columns") — not tested by any AC named in the plan.

If any of these drift, the effect is precisely what design-challenger's attack method names as the top-ranked category: state (the reported line number) **silently** diverges from reality, in the one command whose entire job is to be trusted at face value ("why is this blocked" — an operator who trusts a wrong line number edits the wrong rule and concludes the tool lied to them, or worse, edits the wrong rule and ships a still-broken policy believing it's fixed).

**Evidence:** derived (the tokenizer doesn't exist) — reinforced by code-traced facts (`.gitattributes`'s own scope and its own header's citation of this exact bug class; POL-02's acceptance text mandating the exact input shape that stresses this).

**Exposure:** routine — basis: assumption for a precise percentage, but the *triggering input* (multi-line rationale, non-git-tracked central deploy) is spec-mandated normal usage, not an edge case, so likelihood is not in question even though a percentage is.

**Tags:** severity MED (derived, capped) · evidence=derived · reach=operator (POL-10's printer is a CLI a human runs, not an end-user product surface) · likelihood=routine (multi-line rationale is the documented normal case, not a contrived one) · undo=runbook-reversible (an operator could eventually manually diff, but the tool's own answer is wrong in the meantime, silently).

**Verdict:** UNPROVEN.

**Proof-test:** `position-parser.test.ts` (not yet named in the plan's own file list, which only says "Test files for every module above") gets explicit named cases: CRLF-only input parses with correct line numbers; a rule with an embedded `\n` inside its `rationale` string does not perturb subsequent rules' line numbers; a non-ASCII (e.g. accented or emoji) `rationale` value does not perturb subsequent column numbers. `test-writer`'s printer-contract fixture (already dispatched per §7) should include at least one of these three shapes in its 3-layer fixture, not only clean-ASCII/LF content.

---

## Attack F — POL-09's pin can describe different bytes than the rules it's paired with (TOCTOU on the single central read)

**Scenario:** `loadEffectivePolicy()` needs the central source's raw bytes for two separate purposes — merging into the resolved `RuleSet`, and computing the `pin.ts` content-hash reference. The plan's own file list keeps these as separate modules (`loader.ts` orchestrates, `pin.ts` computes the hash) — a natural, easy-to-write implementation calls the injected `CentralPolicySource.read()` twice: once when loading/merging, once when pinning. If the underlying registry value changes between those two calls within a single process invocation (an admin edits `HKLM\SOFTWARE\Policies\Thoth` at an unlucky moment, or two `reg query` calls simply observe two different states because nothing guarantees they're the same call), the printed pin can describe bytes that are **not** the bytes actually merged into the printed rules — the exact failure POL-09 exists to prevent: a reference that's supposed to be "immutable" and traceable actually describes something else.

This is the same "silent divergence" category as Attack B, but at the integrity/audit layer (POL-09) rather than the enforcement layer (POL-07): the printer would show a rule, an origin, a line — and a pin that doesn't actually match any of it, with nothing in the output signaling the mismatch.

**Evidence:** derived — no code exists to trace; the risk follows directly from the plan's own module boundaries (`central-source.ts` reader is injectable and callable from more than one site by construction) plus the general pattern (nothing in the plan states a single-read invariant).

**Exposure:** unbounded, basis: assumption — narrow timing window (an admin editing the exact registry value at the exact moment a `policy:print` invocation is mid-flight), which is why this is tagged `exact-race`, not `plausible`.

**Tags:** severity MED (evidence=derived caps it; likelihood=exact-race also caps it — both apply, neither raises it) · evidence=derived · reach=operator · likelihood=exact-race · undo=irreversible in the moment it happens (the printed pin is wrong and nothing detects it), though the window is narrow.

**Verdict:** UNPROVEN.

**Proof-test:** inject a `CentralPolicySource` test double whose `read()` returns a different string on each successive call; assert `loadEffectivePolicy()` either (a) calls `read()` exactly once per invocation, with that same string threaded through both the merge and the pin computation, or (b) if multiple reads are structurally unavoidable, that the pin is computed over exactly the bytes that were actually merged (not a second, independent read). Cheap to write now, before `loader.ts`/`pin.ts`'s call graph is set.

---

## Frozen set

None — this is round 1 of this artifact; there is no prior design-challenger report on S6 to inherit a frozen set from.

## Things that SURVIVE, stated plainly

- `src/policy/rule/schema.ts`'s strict, explicit `RULE_KEYS`/`RULE_SET_KEYS` allowlist (unknown key = named error, not silent drop) is exactly the POL-06 discipline it claims, and correctly requires — and the plan correctly lists — adding `"mandatory"` to `RULE_KEYS` before any rule using it can validate. No gap here.
- `src/policy/rule/precedence.ts`'s `mergeLayersById` core is genuinely generic today, not name-hardcoded — the risk in Attack C is about how the NEW mandatory-lock check gets written on top of it, not a flaw in the existing shared core itself.
- The plan's own §3 is honest about the one thing it couldn't verify (the write-ACL claim) rather than overclaiming it — a real, credited practice this report builds on rather than restates as new.

## Residual-risk register

None — all six attacks route to named proof-tests above (five via the boundary-crossing carve-out, one — Attack A — as a named unrun verification with an explicit human owner, since `reach=instrument` caps it at MED and it never blocks regardless).

## Unrun verifications

1. **Attack A's item 1**: capture one real `reg.exe query` output sample on a real, non-agent-sandboxed Windows shell and commit it as a fixture. **Owner: human** (no agent session in this project's history — this one included — has been able to run `reg` commands; independently reconfirmed this round).
2. This story's own build task #1 (walking skeleton, per rule 17) is itself the first and most important "unrun verification" in the plan — nothing above changes that recommendation; every finding here becomes a day-1 test alongside it, not a reason to delay it.

## Editorial

- §6's "same diligence this project already applies to `mcp-enumeration.ts`'s subprocess calls" is not merely optimistic phrasing but factually wrong (that file has zero subprocess calls) — worth a one-line correction in the plan text so a future reader doesn't inherit false confidence, though this doesn't change any finding's severity (Attack A already accounts for the substance).

## The single scariest unproven assumption

That the write-ACL claim underlying the entire central-channel trust boundary (§0.4 property 2 — "no credential the governed session holds may reach the policy source," the exact property S6 was chartered to finally satisfy after S5's fixture-based approach was ruled structurally unable to) has never been measured against the actual process identity a governed Claude Code session runs under, on the actual machine class this project is developed on — and that neither this project's CI nor any agent sandbox tried so far (the implementer's, or mine, independently) can measure it. If that claim is wrong on a routine developer setup (local-admin account, UAC disabled or a session ever launched elevated), the entire "central is out of the governed session's write reach" premise collapses back to exactly the in-repo-fixture problem S6 exists to solve, just one layer further from the code that would reveal it.

## Verdict

**go.** No calibrated blocking HIGH exists or could exist against this plan today (all six findings cap at MED — evidence=derived on five, reach=instrument on the sixth — and none can reach `reach=user` since S6 explicitly does not wire anything live this story, per the already-ratified Q2 ruling). Recommendation: build now. Task #1 stays the walking skeleton per rule 17; fold the six proof-tests above into that same build pass while the context for each is still fresh, per this project's own "unrun verification outranks unwritten prose" discipline — none of them require new topology or a mechanism this report hasn't already left to `story-implementer`/`architecture-reviewer` to design.
