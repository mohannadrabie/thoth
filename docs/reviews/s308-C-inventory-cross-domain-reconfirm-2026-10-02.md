# #308 story C — cross-domain re-confirm (Ra), 2026-10-02

Reviewed commit: 31e11c0 (fix delta 60eed7f^..31e11c0). Tier STANDARD. Lane reviewer: app-security (LOWs folded into this delta). Answers docs/reviews/s308-C-inventory-cross-domain-2026-10-02.md (S1 #385, S2 #386, editorial).
📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]
Ran in a detached worktree at 31e11c0 (removed after). No new ADR collision: the delta touches a test, a QA vendoring script, a fixture revert and docs; the whole catalog was read, nothing in the delta moves.

## #385 (S1) — RESOLVED (code-traced + demonstrated)
- `git diff 6cc5d2d 31e11c0 -- docs/qa/s5-central-classification.json` is empty: the fixture is byte-identical to the pre-story file (6cc5d2d); the 8 labels are gone, the notes no longer cite connector-labels.test.ts.
- Re-ran evaluateToolInventory over the assembled real catalog:
  - claude.ai Gmail -> {"classified":[],"unclassified":["claude.ai Gmail"],"haltRequired":true}
  - claude.ai Canva -> haltRequired true
  - playwright -> classified remote-mutating (control)
  A same-named project server is unclassified again, so SessionStart halts (SUR-03).
- N4: the assertion at tool-class.test.ts is the original (`realFixtureProblems(...)` deep-equals `[]`, no knownConnector carve-out); the helper is a plain rejected-list + admitted-count check. Negative control injects "some.dotted", "stray name", "under_score" and requires each to be named in the problems (meaningful: it fails if the helper stops flagging inadmissible names; uses stand-in names, no G19 issue). connector-labels.test.ts deleted; no remaining reference (grep of src, hooks, docs/qa, CHANGELOG).
## #386 (S2) — RESOLVED (demonstrated)
- Mutation in the worktree: deleted the `Monitor:` line from src/policy/tools/builtin-tool-inventory.ts, ran shared-inventory-agreement.test.ts: the REAL "C5(iii): the real SessionStart hook over the real inventory sets no catalog-failure or unclassified halt reason" goes RED (pass 0 / fail 5; C5(i), (ii), the mutant tests also fail because the module no longer loads a complete catalog). Restored with git checkout.
- (iii) now asserts SUR-03-enumeration-failed and SUR-03-unclassified-tool are not set. The new temp-copy seeded mutant passes on the clean tree (clean copy asserted clean first, then mutated and asserted to set the catalog-failure reason).
- C5(i)/(ii) are now honestly commented as location-only checks.
## App-security LOWs
- Monitor added to ADDED_BUILTINS/ARBITRARY_EXEC (classified workspace-mutating at builtin-tool-inventory.ts:110, so not flagged). New AP-12 mutant flips each of Bash, SlashCommand, Task, Monitor to read-only on the REAL built-in layer, with literal names (dropping one from ADDED_BUILTINS cannot silently weaken it); passes, i.e. the flip is flagged.
- Identifier guard BUILTIN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,63}$/ in extractBuiltinNames; new test rejects 9 odd names (space, slash, quote, semicolon, empty, leading dash, newline, `<script>`, 65 chars) and accepts Read/ListMcpResourcesTool/Tool2. Green. (Caveat, not a finding: the guard is an allowlist of letters/digits only; if the vendor ever ships an underscore-bearing built-in the capture refuses loudly, which is the safe direction.)
## Editorial
CHANGELOG line 25 and decisions/plan wording now describe labels as added then dropped, base commit named; consistent with the human ruling. Nothing open.
## Regressions
- `node --test src/policy/tools/shared-inventory-agreement.test.ts src/policy/normalizer/tool-class.test.ts src/qa/arbitrary-exec-classification.test.ts src/qa/vendor-tool-inventory.test.ts` -> tests 48, pass 48, fail 0, skipped 0.
- Full `node --test` in the worktree: tests 1465, pass 1450, fail 15, skipped 0; 14 failures were ERR_MODULE_NOT_FOUND 'typescript' (worktree had no node_modules) and R4 (local-clone hook test, environment). Re-ran the 12 affected files with node_modules junctioned: tests 331, pass 331, fail 0. R4 not re-run (needs a real clone; environmental, not touched by this delta).
- QA-14 `node src/qa/reference-resolver.ts origin/master HEAD`: exit 0; 57 lines, all "[unclassified] bare #N" notes, none broken.
- G19: no connector or real account names in the delta's test/code text (stand-ins only).
## Coverage gaps
None new.
## Verdict
APPROVE. #385 and #386 fixed at 31e11c0. Single next action: merge-handoff for the human (Fixes #385, Fixes #386 in the PR).

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][demonstrated] #385 resolved: fixture byte-identical to 6cc5d2d; evaluateToolInventory halts for "claude.ai Gmail"/"claude.ai Canva"; N4 original assertion restored with a meaningful negative control
2. [CLEAN][demonstrated] #386 resolved: deleting Monitor from the inventory turns the REAL C5(iii) RED (and the temp-copy mutant passes on a clean tree first)
3. [CLEAN][code-traced] Monitor in AP-12 set with a literal-name mutant over the real layer; BUILTIN_IDENTIFIER guard with 9-case rejection test; editorial wording fixed
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=2 code-traced=1 derived=0
checks=48 pass/0 fail/0 skip (4 story files); full suite worktree 1450 pass/15 fail/0 skip, 14 env (no node_modules) -> 12 files re-run 331/0/0, 1 R4 env-only not re-run; QA-14 exit 0
adr=HIT(37, whole catalog)
report=docs/reviews/s308-C-inventory-cross-domain-reconfirm-2026-10-02.md
