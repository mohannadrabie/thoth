# Red Team (Sutekh) — round 2 RE-CONFIRM: s7b-policy-authoring-safety fix-now delta

- Date: 2026-09-26
- Scope: the fix-now delta for Issues #305 and #306 and the round-1 findings #328 to #333, branch `feat/s7b-policy-authoring-safety`, delta `79bf28b..b8457e6`
- Round-1 report: `docs/reviews/s7b-policy-authoring-safety-red-team-2026-09-26.md`
- Verdict: **go** (no HIGH; three MED and one LOW open, all records accuracy or instrument strength, all with zero measured exposure today)
- ADR cache: `ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]`
- ADRs read for this attack surface: SE ADR-0021 (kernel purity, the normalizer registry, POL-05 fail-closed, a normalizer never returns a verdict), SE ADR-0002 (the dependency rule across module boundaries), SE ADR-0005 (nothing deleted or weakened in a replaced test), SE ADR-0006 (blast-radius control), THOTH-ADR-0001 (the standing fixture exception and its one-anchor rule 5).

## What I ran

All work was done in an isolated worktree at the delta tip with the ADR submodule initialised and a junction to the shared dependency tree. The junction and every probe module were removed afterwards and the working tree verified clean.

- Full suite: **tests 1489, pass 1489, fail 0, skipped 0, todo 0** (run with the four probe modules of finding 1 present in the scanned tree).
- The five delta test files together: **tests 36, pass 36, fail 0, skipped 0**.
- Typecheck clean and lint clean, both with the probe modules present.
- The kernel-purity gate PASS (4 kernel files, zero violations); the normalizer-registry-purity gate PASS; the completeness-claim gate PASS (2 files checked).
- Six mutants spot-applied one at a time and reverted through a scratch runner.
- A run-time probe over the real normalizer registry, the real loader and the real kernel: **2274 Action records** built from the repo's own golden call corpus (56 exported call objects), the redirect corpus in `src/policy/fixtures/mcp-redirect-commands.ts`, every verb the catalog in `src/policy/normalizer/action-catalog.ts` knows composed against seven second-segment shapes under the MCP target prefix, and every class-normalizer shape over 17 server names, 5 tool names and 9 class values including prototype keys and non-strings.

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The single-funnel instrument (R1-6b, Issue #332) passes green with four production modules reading the classification fixture outside the funnel, and two of those shapes sit outside the residual the records disclose

Exposure: ~0% of runs, basis: counted in code — the shipped tree contains no such module today, and the catalog port declared in `src/policy/gate/decide-tool-call.ts` has exactly one production implementation, in `hooks/pretooluse-kernel-gate.mjs`, which calls the funnel.

Scenario. A later story wants the committed classification fixture for something narrow — a diagnostic, a second gate, a report — and reads it directly rather than through the assemble function in `src/policy/tools/classification-catalog.ts`. The built-in-class guard of Issue #305 lives only inside that funnel, so a catalog built outside it is unguarded. R1-6b exists to make that impossible to land quietly.

I authored six candidate shapes as real production modules inside the scanned tree and ran the real instrument over them. Two were caught: a re-export barrel, flagged on the importer and symbol legs, so the chain is caught at its first link even though the module that actually reads the file is itself invisible to every leg; and a dynamic import written with a template literal and no substitution, flagged on the importer leg. Four were not caught on any leg:

- a module-loading helper built from the standard library, aliased to a short local name, invoked with a specifier assembled from string pieces, with the wanted export reached by a computed property name;
- **the same helper invoked with a plain, unsplit literal path to the fixture** — it needs no read primitive and no parse call, so the path-literal leg's companion condition never fires, and the specifier is a literal, so the unresolvable-specifier leg never fires either;
- a read through the promise-based file-handle API with the file name assembled from string pieces;
- a synchronous read with the file name assembled from string pieces.

With all four present the instrument printed `importers ["src/policy/tools/classification-catalog.ts"]`, `path readers ["src/policy/tools/central-classification.ts","src/qa/gate-fail-open-probe.ts"]`, `export holders ["src/policy/tools/central-classification.ts","src/policy/tools/classification-catalog.ts"]`, `unresolvable imports []`, and passed. Typecheck, lint and the whole 1489-test suite were green at the same time, and the second shape above was confirmed to actually read the committed fixture at run time: it returned the fixture's four top-level keys.

Current defense, honestly assessed. R1-6b is a real improvement on the symbol scan it supplements: four legs, a run-time export enumeration, specifier resolution against the importing file, and a self-test proving seven synthetic bypasses each fail the leg built for them. Its weakness is structural rather than accidental: two of the four legs are keyed on token spellings — the names of the file-read primitives, and the two literal spellings of a module-loading call — so any loading call whose spelling the scan does not enumerate is invisible. The decisions addendum discloses one residual, a path literal split across string pieces, which covers the third and fourth shapes but not the first two, and the second shape needs no splitting at all.

Verdict: **BREAKS** — the instrument's stated property, not the guard itself; no unguarded catalog exists today.

Proof test required before merge: `R1-6d loader-helper-and-alias-legs`. Extend the R1-6b self-test corpus with (a) a module whose only fixture access is the standard-library module-loading helper invoked on a plain literal path ending in the fixture file name, and (b) a module whose loading call is that helper aliased and invoked on a non-literal specifier; add a leg that flags any production use of that helper at all, since the funnel needs none; assert both synthetic modules fail their leg. Then widen the disclosed residual in `docs/decisions.md` from the split literal to the token-spelling class.

### 2. [ISSUE][MED][demonstrated] H1's gating opened a false negative the records explicitly deny: a verb list mixing a class marker with a verb no normalizer emits escapes V2 and V3 and is provably inert

Exposure: ~0% of loads, basis: counted in code — the committed shipped-defaults and project policy files hold no rule under the MCP target prefix (R2-10 reads and prints their counts), and the gate is unwired pending Issue #308.

Scenario. An operator writes a class-marker deny and leaves a stray empty element in the verb list, or mistypes one legacy verb beside the marker. Because the list is then not all markers, the all-markers predicate in `src/policy/config/rule-reachability.ts` returns false, V2 and V3 are skipped entirely, and a server target with no trailing slash or a server segment the runtime never presents loads clean. The kernel requires the record's verbs to intersect the rule's, so such a rule can only ever match a class record, and the target it carries is one no class record can have. The rule denies nothing, silently. That is exactly PT-12's shapes b and d.

Measured through the real loader and the real kernel: a deny rule whose verbs are a class marker plus an empty string, with a server target ending in a slash whose segment contains an underscore, loads on the project layer and on the central layer (`ok=true merged-rules=1`) and matches **0** records in the probe corpus. The same holds for a class marker plus a near-miss legacy verb, and for a class marker plus an empty string with a server target that has no trailing slash. Against the pre-delta copy of the same module, extracted from `79bf28b`, all three were rejected. The all-markers variant of the first shape is still rejected, so the loss is precisely the mixed-list case.

Current defense, honestly assessed. The narrowing itself is right and well tested: R2-12 pins the verb-set matrix and R2-13 proves every text-normalizer target under the prefix stays authorable. What is wrong is the justification the records give for the width of the skip. The module header in `src/policy/config/rule-reachability.ts` states that a rule with no verbs, a legacy verb or a mix can match and is never rejected by V2 or V3, and the new `docs/decisions.md` addendum states the same. For a mix containing a verb no normalizer emits, it cannot. The claim is hand-derived and the counter-example is one line of authored policy.

Verdict: **BREAKS** — the reachability claim in the records, and a narrow real coverage loss behind it.

Proof test required before merge: `R2-16 mixed-verb-lists-that-cannot-match`. For each of an empty-string verb, a near-miss legacy verb and a marker-free near-miss verb, assert that a rule pairing it with a class marker and a V2 or V3 target (i) loads through the real loader on all three layers, and (ii) matches zero records over the drift corpus R2-6 already builds. Then either extend the skip condition to ignore verbs no normalizer can emit, or correct both records to say a mix is reachable only when one of its verbs is one a normalizer emits.

### 3. [ISSUE][MED][demonstrated] The accepted cost is recorded as inert; for an allow rule the same shape is a silent widening

Exposure: ~0% of loads, basis: counted in code — no allow rule under the MCP target prefix exists in either committed policy file, and the gate is unwired.

Scenario. An operator wants to allow one MCP server's read-only tools and writes the server's declared spelling (the one with a space, a dot or an underscore) instead of the sanitized runtime spelling, or omits the marker verb. Before the delta the check rejected that rule loudly on every layer. After it, the rule loads. It cannot match a class record, because the runtime never presents that server segment — but the target namespace under the MCP prefix is shared with the text normalizer, so the rule does match a real record: a redirect into a directory of that name. Under a deny-by-default posture the effect is to **allow** a filesystem write the baseline would otherwise deny.

Measured: an allow rule with no verbs and a server target ending in a slash whose segment contains an underscore loads through the real loader on the project and central layers, and the kernel's decision function returns `allow` for two records the real text normalizer emitted for redirects under that path. The same holds with a single legacy verb in place of the empty verb list. Against the pre-delta copy of the module, both were rejected.

Current defense, honestly assessed. Rule-author fact 3 in `src/policy/normalizer/tool-class-format.ts` already warns that an allow rule keyed on identity must also carry the marker verb, so the hazard itself is named. What is not named is that the delta removed the mechanism that used to catch the mistyped variant of it, and the sentence that does describe the trade calls the result inert. For a deny rule that is true. For an allow rule it is the opposite of true.

Verdict: **BREAKS** — the accepted-cost wording, and an allow-path widening that is now silent where it used to be loud.

Proof test required before merge: `R2-17 allow-rule-on-an-unpresentable-server-widens`. Author an allow rule with no verbs on a server target the runtime cannot present, assert the loader accepts it, and assert the kernel's decision function with a deny baseline returns `allow` for a record the real text normalizer emits for that path. Then correct the accepted-cost sentence in `src/policy/config/rule-reachability.ts` and the `docs/decisions.md` addendum to say inert as a deny, widening as an allow, and add the allow shape to Issue #308's precondition list.

### 4. [SUSPICION][MED][code-traced] Nothing pins that every catalog reaching the kernel path comes from the funnel, only that nobody else reads the fixture or names the merge

The gate module in `src/policy/gate/decide-tool-call.ts` takes the catalog as a port. R1-6 asserts that only `src/policy/rule/precedence.ts` and `src/policy/tools/classification-catalog.ts` name the merge; R1-6b asserts that only `src/policy/tools/central-classification.ts`, the funnel and one reviewed copy-only probe reach the fixture. A production module that builds a catalog object by hand — from a runtime enumeration, a cache, a second fixture — needs neither the merge nor the fixture, so it satisfies both instruments while handing the kernel a catalog the Issue #305 guard never saw. Today there is exactly one production implementation of the port and it calls the funnel, so nothing is wrong; the gap is that the claim "the guard applies to both hooks" rests on that being true rather than on an instrument saying so.

Verdict: **UNPROVEN-pending-verification**. Settling check: a new `R1-6c one-catalog-source` that enumerates at run time every production implementation of the gate's catalog port and every production expression typed as the merged classification set, and asserts each resolves to the assemble function. `story-implementer` can run it; I did not author it because it needs a design choice about how a catalog source declares itself.

### 5. [ISSUE][LOW][demonstrated] The aggregate loader failure message has no cap on the number of joined errors, and the layer-aware unlock made each error roughly twice as long — this corrects my own round-1 "messages bounded" line

Exposure: ~0% of loads, basis: counted in code — zero rules under the MCP prefix in either committed policy file. Loud rather than silent, and fully reversible.

`src/policy/config/loader.ts` joins every reachability error into one message. Each error is bounded per value (JSON-quoted author text, capped at 80 characters) but the count is not bounded, and the layer-aware unlock clause added roughly 90 to 130 characters per error. Measured: 500 rules each carrying two unreachable targets produce 1000 errors in 3.2 ms, a 390572-character loader message, and 408040 characters of single-line output from the real printer in `src/policy/config/printer.ts`. The gate never sees this, because its refusal carries layer and kind only (Issues #124 and #294), so the blast radius is the operator print surface and any transcript that captures it.

My round-1 report's finding 8 said messages were bounded by the JSON quoting, the 80-character value cap and the five-offender cap. That was correct per value and per guard message and wrong about the loader aggregate. I am recording the correction here rather than leaving the earlier CLEAN standing. No Issue filed, LOW: route to the residual register with the activation story.

Verdict: **BREAKS** at LOW. Named check if it is taken up: `R2-18 aggregate-message-cap` — assert the loader's joined message stays under a named ceiling for a layer with more unreachable elements than the ceiling allows, naming the first N and counting the rest, the shape the guard's five-offender cap already uses.

### 6. [CLEAN][demonstrated] H1 soundness: no emitter anywhere produces a record that a marker-only rule rejected by V2 or V3 could match

This was the central question of the re-confirm. Enumerated emitters: the registration function has exactly three production call sites (`src/policy/normalizer/shell.ts`, `src/policy/normalizer/structured-cluster.ts`, `src/policy/normalizer/tool-class.ts`), the registry resolved all three at run time, and `src/policy/gate/tool-routing.ts` admits only two of them — the text normalizer for Bash, the class normalizer for MCP tool names. `hooks/sessionstart-tool-enum.mjs` builds no Action record at all: zero occurrences of the record type or of a verbs field. Results over 2274 records:

- records carrying a class-marker verb, by toolType: `{"tool-class":240}` — **0** from the text normalizer and **0** from the cluster normalizer, including inputs whose verb token is literally a marker, a redirect whose target is a marker, and a cluster call whose verb field is set to one;
- catalog verbs equal to a marker: **none**;
- marker-only rules the check rejects that the real kernel still matches on a real emitted record: **0**, both through the rule matcher and through the whole decision function, for deny and allow effects and all three markers;
- distinct targets actually emitted on class records: **40**; falsely rejected under marker-only verbs: **0**; and the prefix, exact and bare-prefix rule forms authored for each of those 40: **0** falsely rejected;
- text-normalizer records whose target lands under the MCP target prefix: **108** across **53** distinct targets, none reachable by a marker-only rule and all authorable with a legacy verb or with no verb.

The property holds for a structural reason rather than a lucky corpus. The only path to a marker verb is the class normalizer, and it emits a target only after the server segment has been resolved by exact lookup in an index whose keys are filtered by the very pattern V3 tests, with the tool segment separated by the very delimiter V2 requires. The server-name pattern is a non-global regular expression, so no match-position state can be carried between the index build and the check.

Verdict: **SURVIVES**.

### 7. [CLEAN][demonstrated] H3: the entry, both classes and the whole unlock clause survive the real relay cut in every worst case I could build

Both constants were read from the production hook sources rather than retyped: the relay's detail cap is 200 characters and the SessionStart detail prefix is 44 characters. The built-in inventory holds 19 tools, of which 11 can be lowered; the longest lowerable name is 12 characters. Applying the relay's own control- and separator-stripping and its compatibility folding and then its cut, for one offender, for the five longest lowerable names, and for all 11 lowerable names with a 104-character fixture path, the visible window always ended inside the sentence that follows the unlock clause, and nothing from the required set — the quoted entry, the built-in class, the entry class, the unlock label and both named actions — was missing in any scenario. The fixture path was last and cut in all three. The relay relays only the reason key and the detail, both through the same sanitizer, and never the fixture path or its source, so there is no path or terminal-control leak on that channel. The entry name in the message is by construction a built-in inventory name and the class is one the fixture parser has already validated, so neither is fixture-authored free text.

Verdict: **SURVIVES**.

### 8. [CLEAN][demonstrated] H4: the rank lookup fails closed for every hostile class I could supply, on either side, and stays fast

Against a remote-mutating built-in, 16 of 17 hostile string classes threw and only the exact matching class passed — including prototype keys, case variants, a leading or trailing space, the empty string, and the numeral spellings of the ranks. All 11 non-string classes threw: undefined, null, three numbers, not-a-number, two booleans, an object, an array and a symbol. An unknown class on the **built-in** side paired with the highest entry class also threw, which is the direction a zero-default fallback would have missed. A built-in named like a prototype key was handled correctly, because the lookup is a map rather than an object. Performance: 200000 central entries with no lowering in 9.5 ms; 200000 lowering entries in 15.3 ms with the error message bounded at 469 characters by the five-offender cap.

Verdict: **SURVIVES**.

### 9. [CLEAN][demonstrated] H6: every rejection kind on every layer names an unlock, the central text names no file, and hostile author text stays escaped and capped

Across all three rejection kinds and five source shapes: every message carried an unlock clause; the central layer named the out-of-session owner in all three kinds and named no file **even when a file was wrongly supplied alongside the central layer**; the file-backed layers named their own file, and the project layer with no file fell back to naming the layer rather than printing an undefined value. A rule id carrying a newline, an escape character, a NUL byte and 300 padding characters produced a 323-character message with no raw control character of any kind and a result that survives a JSON round trip; the 80-character cap escapes a split surrogate pair rather than emitting a raw lone surrogate. A 400-character unreachable target produced a 423-character message.

Verdict: **SURVIVES**.

### 10. [CLEAN][demonstrated] The empty and absent verbs treatment is right

`src/policy/rule/schema.ts` validates verbs as a string array only, so both an absent verbs key and an empty array are schema-valid; the kernel treats both as matching every verb; and the check treats both as reachable. That is correct, and not merely by argument: a deny rule with no verbs on a server target the runtime cannot present loaded through the real loader and then matched two records the real text normalizer emitted, so the reachable reading is the true one. The reading recorded in `docs/decisions.md`, that a rule with no verbs is not every-verb-is-a-marker and is therefore reachable, matches the behaviour.

Verdict: **SURVIVES**.

### 11. [CLEAN][demonstrated] Mutation run: six mutants, six kills, each by the test built for it

Applied one at a time to the real production modules, the five delta test files run after each, then reverted; the working tree was verified clean afterwards.

| Mutant | Killed by |
| --- | --- |
| drop the at-least-one-verb condition in the all-markers predicate | R2-12 |
| change the all-markers predicate from every to some | R2-13, R2-12 |
| give the central layer the file-edit unlock text | R2-15 |
| make an unknown class rank lowest instead of not-a-number | R1-12 |
| rewrite the guard comparison so not-a-number fails open | R1-12 |
| put the fixture path first in the guard message | R1-11, R1-11c, R1-7 |

Verdict: **SURVIVES**.

## Out-of-scope observation (not part of this delta, no Issue)

The cluster normalizer in `src/policy/normalizer/structured-cluster.ts` throws a type error when handed a call object with no verb field — 129 of my probe inputs hit it. Its two siblings both state and test the opposite contract, that a normalizer never throws on malformed input. It is not reachable from the gate, because `src/policy/gate/tool-routing.ts` admits only Bash and MCP tool names, and it is untouched by this delta. Noted so it is not rediscovered as new.

## Scariest unproven assumption

That the single funnel is the only way a classification catalog can reach the kernel. The guard of Issue #305 lives inside the funnel and nowhere else, and both instruments that defend the funnel key on a symptom of bypassing it — reading the fixture, naming the merge — rather than on the property itself, that every catalog handed to the gate came from the assemble function. I demonstrated four modules that read the fixture with every gate green, and finding 4 names the shape that needs no fixture read at all. Nothing exploits it today; at activation (Issue #308) it is the one place where a green suite would not mean what it says.

## Go / no-go and the single next action

**go.** No HIGH. The three MED findings are records accuracy and instrument strength with zero measured exposure today, and the gate is unwired. The guard, the reachability check, the message order, the rank hardening and the layer-aware unlock all held under every attack I could build, and all six mutants died.

Single next action: fix finding 1 — add the loader-helper legs to R1-6b and widen the disclosed residual from a split path literal to the token-spelling class — because that instrument is what every later story will trust when it touches the fixture.

## Open findings and failing tests

Open findings: 4 (findings 1, 2, 3 and 5). Named failing tests they map to: 4 — `R1-6d loader-helper-and-alias-legs`, `R2-16 mixed-verb-lists-that-cannot-match`, `R2-17 allow-rule-on-an-unpresentable-server-widens`, `R2-18 aggregate-message-cap`. Finding 4 is a suspicion and carries a settling check rather than an open finding, so the two numbers agree.

## Editorial (verdict-neutral, plain edits, no re-review)

1. The module header in `src/policy/config/rule-reachability.ts` and the `docs/decisions.md` addendum both say a mixed verb list can match a text-normalizer record. True only when one of the mixed verbs is one a normalizer emits (finding 2).
2. The same header's accepted-cost sentence calls the shapes that now load inert. True for a deny, false for an allow (finding 3).
3. The disclosed R1-6b residual in `docs/decisions.md` names only a split path literal; the wider class is any module-loading or file-reading call whose token spelling the scan does not enumerate (finding 1).

## Issues filed this round

- Finding 1 is the same defect as the already-open Issue #332, so it was recorded as a comment on that Issue rather than filed again.
- Finding 2 filed as Issue #334 (bug, severity:med, pol, milestone S7).
- Finding 3 filed as Issue #335 (bug, severity:med, pol, milestone S7).
- Finding 4 is a suspicion and finding 5 is LOW, so neither spawns an Issue; both are routed to the residual register with the activation story, Issue #308.

---

```
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] Single-funnel instrument R1-6b (Issue #332) passes green with four production modules reading the classification fixture outside the funnel; two of those shapes are outside the one residual the records disclose; full suite 1489/1489, typecheck and lint green with them present, and one of them reads the fixture at run time.
2. [ISSUE][MED][demonstrated] H1's all-markers gate skips V2 and V3 for a verb list mixing a class marker with a verb no normalizer emits (empty string, near-miss legacy verb); the real loader accepts it on all three layers and it matches 0 of 2274 real records, while the module header and the decisions addendum both assert a mix is reachable; pre-delta these were rejected.
3. [ISSUE][MED][demonstrated] The accepted cost is recorded as inert, but an allow rule with no verbs or a legacy verb on a server target the runtime cannot present loads and makes the kernel return allow for a real text-normalizer redirect record under that path; loud rejection before the delta, silent widening after.
4. [SUSPICION][MED][code-traced] No instrument pins that every catalog reaching the kernel comes from the assemble function; a hand-built catalog needs no fixture read and no merge, so R1-6 and R1-6b both stay green; one production port implementation exists today and it does call the funnel.
5. [ISSUE][LOW][demonstrated] The loader joins every reachability error with no count cap and the layer-aware unlock roughly doubled each error, so 500 mistyped rules give a 390572-character loader message and 408040 characters of single-line printer output; corrects my own round-1 "messages bounded" CLEAN line.
6. [CLEAN][demonstrated] H1 soundness holds: three registered emitters enumerated, only the class normalizer emits a marker verb (0 from the other two, including a verb token that is literally a marker), no catalog verb equals a marker, 0 marker-only rules rejected-but-matchable over 2274 records, 0 false rejections across 40 emitted class targets and their prefix/exact/bare-prefix forms; SessionStart builds no records and the gate routes two toolTypes.
7. [CLEAN][demonstrated] H3 relay cut holds for one, five and all eleven lowerable offenders with a 104-character fixture path: entry, both classes and the whole unlock clause visible, path last and always cut, no path or terminal-control leak on the relay channel; both constants read from the production hook sources.
8. [CLEAN][demonstrated] H4 rank hardening fails closed for 16 of 17 hostile string classes, all 11 non-string classes, an unknown built-in class with the highest entry class, and a prototype-key name; 200000 entries in 9.5 to 15.3 ms with the message bounded at 469 characters.
9. [CLEAN][demonstrated] H6 layer-aware unlock: every kind on every layer names an unlock, central names the out-of-session owner and no file even when one is wrongly supplied, hostile rule ids stay JSON-quoted, 80-character capped, control-character free and JSON round-trip safe.
10. [CLEAN][demonstrated] Empty and absent verbs: schema-valid, kernel treats both as match-every-verb, check treats both as reachable, and a no-verbs rule on an unpresentable server target really does match a real text-normalizer record, so the recorded reading is correct.
11. [CLEAN][demonstrated] Mutation run: six mutants applied and reverted, six killed, each by the test built for it (R2-12, R2-13, R2-15, R1-12 twice, R1-11/R1-11c/R1-7).
counts (CHECKSUM): issues=4 suspicions=1 clean=6
evidence (CHECKSUM): demonstrated=10 code-traced=1 derived=0
checks=full suite tests 1489 pass 1489 fail 0 skipped 0 todo 0; five delta test files tests 36 pass 36 fail 0 skipped 0; typecheck clean; lint clean; kernel-purity PASS, normalizer-registry-purity PASS, completeness-claim PASS; 6 of 6 mutants killed, working tree clean after revert
adr=HIT(37)
report=docs/reviews/s7b-policy-authoring-safety-red-team-round2-2026-09-26.md
```
