# test-writer report: s7-kernel-gate-classification (2026-09-26)

Persisted by the Manager from the test-writer's hand-back message. The test-writer was told not to write under `docs/reviews/`, so this file is the Manager's verbatim copy of its report, with the harness framing removed. HEAD when the tests were written: e233de4.

ADR cache: HIT, 37 ADRs, fingerprint 13c1476.

## Verdict: RED-CONFIRMED

19 of 21 new tests are red for the right reason. 2 are declared GREEN-ALREADY. Among the locked tests only AC-2 went red, as the plan predicts. No BLOCKED items.

## Files

Created:
- `hooks/pretooluse-kernel-gate-classification.test.ts` (H1 to H13 and H11b, 14 tests)
- `hooks/test-support/gate-sandbox.ts` (registry-pinned copy-tree sandbox and strict outcome helpers)
- `src/policy/config/print-cli.test.ts` (P6)

Changed, additive or comment/assertion-scoped:
- `src/policy/config/printer.test.ts`: 171 lines added, 0 removed. P1 to P5 and P7 appended.
- `hooks/pretooluse-kernel-gate.test.ts` (25 added, 21 removed): the AC-2 assertion swap (the `notEqual(decision, undefined)` assertion replaced by an empty-stdout assertion, per ruling Q-B), the bootstrap-outcome header comment, the AC-2 NOTE comment, and the AC-19 section comment. AC-1, AC-6 and the three AC-19 test bodies are untouched.

## Discovery

- UI framework: not applicable (no UI surface).
- Backend framework: node:test, `.test.ts`, `node --test`, TypeScript via type stripping. The existing helper `hooks/test-support/spawn-hook.ts` was reused. No second framework introduced.
- `tsconfig` includes `src/**` only, so typecheck and lint cover the two src test files and not the hooks tests. Typecheck and lint exit 0 on both.

## Per-test red reasons (real repo, hook not yet built)

Every red failure is a missing-behavior assertion. None is a typo, bad import or harness bug; the sandbox copy runs the old hook and returns real JSON.

| Test | Red because (assertion message, abridged) |
|---|---|
| AC-H1 | an `mcp__` call: expected silent allow; got the old deny JSON "only evaluates Bash calls" |
| AC-H3 | deny reason is the old "only evaluates Bash" refusal, not the kernel's POL-05 |
| AC-H4 | first control case (stand-in `docs` admitted) gets the old non-Bash deny, not a silent allow |
| AC-H5 | Bash `kubectl get` under project `defaultOutcome: deny`: got an allow JSON (posture not read) |
| AC-H6 | Bash under a corrupt project policy: got an allow JSON (loader not consulted) |
| AC-H7 | deny reason is not the project rule's rationale (the class rule is not evaluated) |
| AC-H8 | Bash delete baseline: got an allow JSON, not silence (Q-B absent) |
| AC-H10 | "Q-B: a kernel allow must emit NOTHING"; got the allow JSON |
| AC-H11 | genuine `mcp__docs__x` control: got the non-Bash deny, not silence |
| AC-H11b | same as H11 |
| AC-H12 | deny reason is not the rule's rationale (MCP calls are not classified) |
| AC-H13 | "hook must import its gate function(s) from src/policy/gate/decide-tool-call.ts; no such import found" |
| AC-P1 | `posture` undefined; expected `{deny, shipped-defaults}` |
| AC-P2 | `postureLine` undefined (central row) |
| AC-P3 | `postureLine` undefined at the first rejection site |
| AC-P4 | "the new surface must exist (postureLine is a string)"; stdout itself is unchanged |
| AC-P5 | "disclosure must equal the UNWIRED literal exactly"; the old text differs |
| AC-P6 | expected exactly one `posture:` line on stdout; got 0 |
| AC-P7 | `posture` undefined; expected `{deny, central}` |
| AC-2 (locked, amended) | "Q-B: a kernel allow must emit NOTHING"; the old hook emits an allow JSON |

## GREEN-ALREADY (2, true today, listed separately)

- AC-H2: `Edit` is denied strictly. The old hook already refuses every non-Bash name.
- AC-H9: a missing or non-string `tool_name` is denied strictly. Same reason.

Both complement locked AC-19 and stay as regression guards.

## Counts

- New tests written: 21 (H 14, P 7), plus 1 locked test amended (AC-2).
- Red: 19 new, plus AC-2. Total failing in the four touched files: 20 of 45.
- GREEN-ALREADY: 2.
- Pre-existing pass, unchanged: 9 of 10 locked hook tests, 14 of 14 existing printer tests, 27 of 27 SessionStart tests, and the halt-relay hook tests (43).
- Acceptance-criteria mapping (script, not hand-typed): the plan's TW ids are H1 to H13, H11b and P1 to P7, 21 ids. All 21 tagged; missing, unknown and duplicated are all empty. Mapped 21 of 21.
- Positive and negative split by primary subject (the test-writer's own classification): UI 0/0, API 11 positive and 10 negative.
- Hardcoded-name scan of the new files and added lines against all 14 fixture names (read at run time): 0 hits.

## Do the tests fail when the property is false?

Mutation drills on a plan-faithful prototype kept outside the repo (scratchpad, no production file touched). On the prototype all 14 H, all 7 P and all 10 locked hook tests pass. That shows the tests are satisfiable and the H13 harness works.

| Mutant | Red set | Versus plan prediction |
|---|---|---|
| M1 one marker for every class | H7, H12 | H7 as predicted |
| M2 committed first entry flipped | H7 | as predicted |
| M3 hook rehardcodes bootstrap | H5, H11 | as predicted |
| M4 load failure returns allow | H6 | as predicted |
| M5 markers added to KNOWN_VERBS | H11b (H11 stays green) | as predicted |
| M6 Bash routed through tool-class | H5, H8, H10, H13 | superset |
| M7 prefix or longest-match lookup | H4 | plan expected H4 green; exactness cases were added, so H4 also kills it. N3b stays the formal killer. |
| Hook always silent | 12 H red | strict helper works |
| Hook always throws | all 14 H red | strict helper works |
| Fixture follows `CLAUDE_PROJECT_DIR` | H12 | |
| Allow emits an allow JSON (Q-B violated) | H1, H4, H5, H7, H8, H10, H11, H11b, H12, H13 | |
| Load failure echoes the raw loader message | H6 | |
| Deny rendered as exit 2 (crash-as-deny) | 11 H red | |
| Ask outcome rendered silent | H13 | |
| Built-ins allowed by fixture class | H8 | |
| Rules dropped from the merge | H7, H11, H11b, H12 | |

Printer mutants:

| Mutant | Red set |
|---|---|
| Posture line appended to stdout | P4 (and the locked printer tests) |
| Central line without the lower-trust clause | P2, P7 |
| Wrong source reported | P1, P7 |
| Rejection carries a posture | P1, P3 |
| Disclosure claims live enforcement | P5 |
| CLI prints no line, or two | P6 |
| In-repo line claims central enforcement | P2 |
| First declarer reported instead of the winning layer | P1 |

Strengthenings made after the drills:
- H6 originally survived "echo the raw loader message". The corrupt policy is now a canary string, so the parser's message echoes it. H6 also asserts the reason omits the sandbox path.
- P1 gained the two peer cases (shipped deny then project allow gives allow from project; shipped allow then project deny gives deny from project).

## Decisions and plan defects for the Manager and implementer

1. **H3 and H4 "reason names the unresolved cause" cannot be asserted.** The kernel's `pol05Rule` tests `source === "opaque"` first and returns the fixed reason "POL-05: mutating action's source is opaque". The cause in `unresolved` never reaches the reason under the plan's record shape. The tests assert the deny is a POL-05 kernel deny (not the pre-kernel refusal) and assert no cause wording. The plan needs either the cause surfaced in the gate reason, or the phrase dropped from H3 and H4.
2. **P5 literals are the test-writer's wording.** The plan says "both literals in the test" but never words them. `UNWIRED_LITERAL` is what `ENFORCEMENT_DISCLOSURE` must equal exactly while `.claude/settings.json` has no PreToolUse entry for the gate script; `WIRED_LITERAL` is for the wired state. Both are in the P5 test body. The Manager should ratify or reword them.
3. **P2 template extension.** The plan spells one representative per row. The in-repo template was applied to both `shipped-defaults` and `project`, with outcome and layer substituted, and `project allow` is also tested. Central is tested with deny only.
4. **H13 interface is derived, not defined.** The plan does not define the gate module's export name or result shape. The test reads the export names from the hook's own import line from `src/policy/gate/decide-tool-call.ts` at run time. It renames the real module to a `.real.ts` file and installs a shape-agnostic wrapper that mutates the real result: allow becomes ask, undefined, null, an unknown kind, and a refusal with its `reason` keys removed. A marker file proves each mutation applied. Implementer contract: the hook must named-import its gate function(s) from that exact path, and the refusal result must carry a `reason` key. Otherwise H13 fails with a message naming the gap. Confirmed working on the prototype.
5. **Sandbox deviations from a straight copy.** The copy's project policy and shipped-defaults are written as empty rule sets, so a later story shipping baseline content cannot silently change the H expectations. The registry pin overwrites both the `defaultCentralPolicySource` export line and the `createWindowsRegistryCentralPolicySource` factory. The helper throws loudly if either anchor is missing. This constrains the #107 additive change to `central-source.ts`: keep the default export on one `export const defaultCentralPolicySource` line, and keep the `export function createWindowsRegistryCentralPolicySource(` declaration.
6. **H7 pins the committed class.** It uses the committed fixture unmodified in its first half and hardcodes the marker `tool-class:remote-mutating`. Otherwise M2 would survive. If the first committed entry is ever legitimately reclassified, this answer key must be re-derived on purpose.
7. **AC-2's title is stale.** Its parenthetical "depends on bootstrap-ruleset.ts's undetermined defaultOutcome" is left as is. Editing a title would rename a locked test and exceeds "touch nothing else".
8. **Host dependence.** P6 (the real registry reader runs) and the locked hook tests stay host-dependent, as plan item R-6 records. H1 to H13 are host-independent through the pin.
9. **Cost.** The H suite takes about 3.7 s, roughly 130 ms per spawn.
10. **Prototype scope.** The prototype validates the tests only. The implementer's own N, G, C and M-drill evidence (X-3) remains theirs.

## RECEIPT

RECEIPT: verdict=RED-CONFIRMED
scope=API (hook black-box plus printer/CLI surface; no UI)
discovery: ui-framework=n/a api-framework=found: node:test (.test.ts, `node --test`, type stripping)
tests="0/0/11/10" mapped to 21/21 acceptance criteria (grep-counted from AC tags, not hand-typed)
red-run: checks="19/21" failed of new tests (2 declared GREEN-ALREADY: AC-H2, AC-H9; 0 unexpectedly passing; plus locked AC-2 red as planned; 25 pre-existing/GREEN-ALREADY pass in the 4 touched files)
adr=HIT(37)
report=persisted by the Manager at docs/reviews/s7-kernel-gate-classification-test-writer-2026-09-26.md

## Manager verification (appended, PRINCIPLES rule 11: the report above is unchanged)

- Re-ran the four touched test files: 45 tests, 25 pass, 20 fail (19 new plus amended AC-2). Matches the receipt.
- Re-ran the four SessionStart hook test files: 27 of 27 pass.
- Diff scope: only the two locked-test files, `printer.test.ts`, and three new files changed. The AC-2 diff is a comment block, one NOTE block and one assertion swap.
- Rulings on items 1 to 8: see the plan-amendment message to the implementer. Item 2 (P5 literals) ratified as worded.
