[app-security-reviewer]
Horus, App Security Reviewer: reviewing for exploitable weakness

# S7-B policy-authoring-safety: app-security review (2026-09-26)

Scope: Issues #305 (R1) and #306 (R2), branch feat/s7b-policy-authoring-safety at f663d6b, diff base fix/s7a-gate-hook-robustness (three-dot). Tier CRITICAL. The gate hook is UNWIRED (activation Issue #308), so live exposure of every finding below is 0% today.
ADR cache: 37 ADRs cataloged (adr/devops 12, adr/software-engineering 23, docs/adr 2), CACHE=HIT. Applicable to my domain: THOTH-ADR-0001 rules 1, 2, 4 (no hardcode), 5; SE ADR-0021 (one decision path); SE ADR-0005 (no weakening of tests). No violation found (details below).
Worktree: detached at f663d6b, adr submodule initialised, every mutant reverted, temporary copies of node_modules removed.

## Verdict: APPROVE-WITH-CONDITIONS

R1 closes #305 with no hole I could open. R2 closes #306 for the three ruled shapes. One MED (false positive, Issue #328, not blocking, message wording fix) and two LOW residuals that the plan already recorded. No blocker.

## Runs (all in my worktree)

- Full suite: `node --test` 1479 tests, 1479 pass, 0 fail, 0 skipped, 0 cancelled (Node v24.15.0; CI pins Node 22.18).
- `tsc --noEmit -p tsconfig.json` exit 0. `eslint src/policy/config src/policy/tools src/policy/normalizer hooks` exit 0.
- New and touched test files alone: 37 tests, 37 pass, 0 fail, 0 skipped.
- Mutation testing (each applied by sed, run, then that one file restored from the index; working tree clean afterward):

| # | Mutant | Result |
|---|---|---|
| M1 | guard call removed from assembleCatalog | 8 of 16 hook and catalog tests red (R1-1, R1-2, R1-3, R1-3b, R1-5, R1-7, AC-R1-8 case 1 and 2) |
| M2a | comparison weakened to <= (rejects same-class) | 3 red |
| M2b | comparison shifted (rank minus 1) | 8 red |
| M3 | guard checks only the entry that wins the merge | 1 red (R1-3 order independence) |
| M10 | guard exception swallowed in assembleCatalog | 3 red (hook level, both hooks) |
| M4 | V1 dropped | 7 red (R2-1, R2-1b, R2-5, R2-5b, R2-5c, R2-9, G13b) |
| M5 | V2 dropped | 4 red (R2-2, R2-5, R2-5b, G13b) |
| M6 | V3 dropped | 3 red (R2-3, R2-5, G13b) |
| M7 | reachability called before the schema | 1 red (R2-11 schema-first) |
| M8 | reachability skipped for the project layer | 5 red |
| M9 | verbs checked for the first element only | 3 red (per-element) |
| M11 | message quoting made raw | 1 red (R2-9 printer) |

Twelve of twelve mutants killed. No survivor.

## Axis findings

### R1 (#305): a central entry cannot lower a built-in tool class

- Guard placement: src/policy/tools/classification-catalog.ts assembleCatalog runs assertNoBuiltinClassLowering after the fixture load and before mergeToolClassificationLayers, on the merge own key (exact name). Every central entry is checked, not only the winner (M3 proves the order-independence test bites).
- Single funnel: production readers of the fixture, by grep of src/ and hooks/ (tests excluded) and by the run-time instrument R1-6 (101 production files scanned): the fixture loader and the merge are named only in classification-catalog.ts and their own definitions; hooks/pretooluse-kernel-gate.mjs and hooks/sessionstart-tool-enum.mjs both call assembleCatalog. src/qa/gate-fail-open-probe.ts only copies the fixture file into a scratch tree; the halt-relay text only names the file in an unlock hint.
- Fail closed, gate path: the throw propagates out of the loadCatalog port to the hook catch, which prints one fixed line plus the error type (letters only, here the bare type Error) and exits 2. No entry name, class, or path is on that channel. Ran: AC-R1-8 case 1 and 2 (every lowering pair) green, and M10 makes them red. A Bash call does not load the catalog, so a lowering entry does not affect it (unchanged).
- Fail closed, SessionStart path: the throw lands in main catch, which writes SUR-03-enumeration-failed with the resolved fixture path and source (THOTH-ADR-0001 rule 5, never silent). The detail carries the entry name, but by construction only a name equal to a vendored built-in inventory name (letters only), never free fixture text; the relay applies its own sanitizer. Ran: R1-7 green.
- MCP server name that sanitizes into a built-in name: every built-in name is letters only. A declared server name that the runtime rewrites to contain an underscore is not admitted to the server index at all, so it can neither collide nor be classified. The only collision is a server literally named like a built-in (the recorded, accepted cost); a name differing in case is a different key on both sides. The guard adds nothing worse than the recorded cost. A raising or same-class entry for a built-in name is allowed and only changes what the merged catalog reports for that built-in, which no gate decision reads (the gate evaluates only Bash and mcp__ names).
- Availability: a lowering entry makes every gated MCP call exit 2 and halts SessionStart. Whoever can write that fixture could already do the same with malformed JSON (existing loader throw), so this is not new capability.
- ADR: no hardcoded entry name in src/ or hooks/ production code (grep of the six committed server names and eight connector names returns only the SUR-04 allowlist fixture that THOTH-ADR-0001 rule 4 names as a different allowlist); G19 covers the new test files (green). This PR changes the loader path, so this dated report is the review the ADR requires. SE ADR-0021: the guard is a load-time validator, not a second decision path.

### R2 (#306): unreachable rule shapes are a load error

- Ordering and attribution: parseLayerText runs the check only after validateRuleSet passes, reports under the existing schema-invalid kind, and the failing layer is attributed as for any schema error (R2-5 on all three layers; M7 and M8 bite).
- Per-element semantics confirmed (M9). Shape c (legacy verbs plus MCP target) still loads and never matches a class record; unchanged.
- Availability lever: NOT new capability. A project layer that fails schema validation, has malformed JSON, or is missing already fails the whole load (src/policy/config/loader.ts read-error, json-parse-error and schema-invalid returns; those lines are unchanged in the diff). The change widens which shapes trip it and adds the check to all three layers. Effect for a central or shipped rule set authored out of repo: a previously silent inert rule now fails every gated call after activation; recorded as migration exposure (R2-10: shipped-defaults and project policy hold 0 rules today, both still load).
- Message content: author text goes through JSON quoting and an 80 character bound. JSON quoting leaves C1 controls and the Unicode line separator raw, but every consumer of the loader message either sanitizes it (printer.ts sanitizeForTerminal; R2-9 runs a hostile target with an escape sequence and a line separator and asserts two lines and no control character) or discards it (the gate hook returns layer and kind only). Nothing to fix.
- A schema-invalid shape never throws out of the check (R2-11, mutant M7).

Residual false negatives (inert shapes that still load), demonstrated with the real check:
- A glob tool segment (a target ending in a star) or a tool segment with a space loads and never matches (a pattern without a trailing slash matches exactly). Already recorded in docs/backlog.md as a future V4.
- Case or whitespace variants of a marker verb (upper-case prefix, leading space) do not start with the exact prefix, so V1 does not see them. Recorded in the plan section 10 as out of scope.
- A marker verb paired with a non-MCP target can never match a class record. Not covered, not recorded (very unlikely authoring shape).

### ADR and locked-file claims

- Untouched, by the three-dot diff: src/policy/rule/precedence.ts, src/policy/rule/schema.ts, src/policy/kernel, src/policy/gate/decide-tool-call.ts, both hook scripts, docs/qa (the fixture itself). Only gate-structure.test.ts (six added lines listing the new test files for G19) and tool-class-golden.test.ts (G13b) changed among existing tests.
- G13b: every prior assertion is retained (schema 0 errors, kernel non-match, identity-keyed deny survives a flip, marker-paired deny follows it, controls); only wording changed and loader assertions were added. It was passing before, so SE ADR-0005 (do not delete or weaken a failing test) is not engaged; the decisions row records it for human reading.
- No locked key or ADR-locked line was edited.

## Findings, ranked (exploitability x impact)

1. [ISSUE][MED][demonstrated] Issue #328. src/policy/config/rule-reachability.ts checkTarget (V2 and V3): a deny rule whose target is a relative path under a directory named mcp (for example a redirect to a file in that directory with a dot or underscore in the second segment) is rejected as "can never match". Evidence, run with the real normalizer, kernel and check: the shell record for a write redirect to such a path carries the raw path as its target; the kernel returns deny for the rule; the check returns 2 errors saying it can never match. Effect: one legitimate rule fails the whole layer, so every gated call is denied, with a message that is factually wrong and an unlock that does not apply. Attack sketch: none needed (author foot-gun; whoever can write the policy file could already fail it with malformed JSON). Exposure: ~0% of runs today, basis: counted in code (gate unwired; shipped and project rule counts read as 0 by R2-10). The decisions row accepts the forged-target consequence but not this class, and the golden-corpus assertion R2-6 cannot see it (its corpus holds no such target). Minimal fix: reword the V2 and V3 messages so they say the target cannot match an MCP tool record and name the redirect-path case with its workaround, and record the class in the decisions row; or scope the check. Failing test (one): a loader-reachability case asserting the rejection message for such a target does not claim the rule can never match.
2. [ISSUE][LOW][demonstrated] Tool segment not checked: a glob or inadmissible tool segment under a valid server prefix loads and never matches. Recorded in the backlog as V4. No Issue filed (LOW).
3. [ISSUE][LOW][demonstrated] V1 keys on the exact prefix: upper-case or leading-space marker verbs load and never match. Recorded, out of scope in the plan. No Issue filed (LOW).
4. [SUSPICION][LOW][code-traced] src/policy/tools/classification-catalog.ts assertNoBuiltinClassLowering: an entry class outside the rank table gives an undefined rank and the comparison is false, so the guard passes it. Unreachable today: the fixture parser rejects any class outside the table and the server index re-checks. Hardening: write the test as not (rank >= built-in rank).
5. [CLEAN][demonstrated] R1 guard closes #305: 5 mutants killed (M1, M2a, M2b, M3, M10); one funnel confirmed by grep and by R1-6.
6. [CLEAN][demonstrated] Fail closed in both paths, no name, class or path on the gate channel (AC-R1-8, R1-7 green; M10 red).
7. [CLEAN][demonstrated] R2 closes #306 for shapes a, b, d on all three layers; 7 mutants killed (M4 to M9, M11); schema-first ordering.
8. [CLEAN][code-traced] Availability lever is existing behavior, widened in shape only; message sanitized at every sink.
9. [CLEAN][code-traced] No MCP name sanitization path collides with a built-in beyond the recorded literal-name cost.
10. [CLEAN][demonstrated] Locked files and answer keys untouched (three-dot diff); G13b keeps every assertion; no hardcoded fixture entry in src or hooks; typecheck and lint clean; suite 1479 of 1479.

## BLOCKERS vs hardening

Blockers: none. Hardening: finding 1 (fix-now recommended: one message edit and one test), 2, 3, 4.

Open findings 4 (1 MED, 2 LOW issues, 1 LOW suspicion); failing tests 1. The difference: findings 2 and 3 are ruled out of scope and recorded in the backlog and plan, finding 4 is unreachable today; none has an executable form worth a red test now.

## Single next action

Reword the V2 and V3 messages for Issue #328 (or record the class in the decisions row), then proceed to merge handoff. No Issue is closed by this review; the Manager closes on merge.

## Editorial

None.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/policy/config/rule-reachability.ts checkTarget: a deny rule on a relative redirect path under a directory named mcp matches in the kernel but is rejected as "can never match", failing the whole layer with a wrong message (Issue #328); reword messages or scope the check; Exposure: ~0% of runs today, basis: counted in code
2. [ISSUE][LOW][demonstrated] rule-reachability.ts: a glob or inadmissible tool segment under a valid server prefix loads and never matches (backlog V4, no Issue)
3. [ISSUE][LOW][demonstrated] rule-reachability.ts checkVerb: upper-case or leading-space marker verbs are not seen by V1 and load inert (plan out of scope, no Issue)
4. [SUSPICION][LOW][code-traced] classification-catalog.ts assertNoBuiltinClassLowering: an unknown class has undefined rank and passes the guard; unreachable via the parser; use not (rank >= built-in rank)
5. [CLEAN][demonstrated] R1 guard closes #305: mutants M1, M2a, M2b, M3, M10 all killed; single funnel by grep and R1-6
6. [CLEAN][demonstrated] lowering entry fails closed in SessionStart (halt with resolved path) and in the gate (exit 2, fixed line, no name, class or path); AC-R1-8 and R1-7 green
7. [CLEAN][demonstrated] R2 closes #306 for shapes a, b, d on all three layers, per-element, schema-first; mutants M4 to M9 and M11 all killed
8. [CLEAN][code-traced] availability lever is pre-existing schema-invalid behavior widened in shape only; loader message sanitized at printer, discarded at gate
9. [CLEAN][code-traced] no MCP name sanitization collision with a built-in beyond the recorded literal-name accepted cost
10. [CLEAN][demonstrated] precedence.ts, schema.ts, kernel, hooks and fixture untouched; G13b keeps every assertion; no hardcoded fixture entry; tsc and eslint clean; suite 1479 of 1479
counts: issues=3 suspicions=1 clean=6
evidence: demonstrated=7 code-traced=3 derived=0
checks="1479/0/0"
adr=HIT(37)
report=docs/reviews/s7b-policy-authoring-safety-app-security-2026-09-26.md
