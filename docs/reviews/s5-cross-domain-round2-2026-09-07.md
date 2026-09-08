# Cross-domain re-confirm (round 2): S5 uncommitted diff, fix-now round for round-1 REWORK

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-07 (round 2)
**Scope:** scope=s5, tier=CRITICAL (docs/.maat-state.json). Target: the current uncommitted working-tree diff on top of `1fa39f1` -- `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, `src/policy/tools/builtin-tool-inventory.ts` (edited), plus new files `src/policy/tools/central-classification.ts` (+`.test.ts`), `docs/qa/s5-central-classification.json`, `hooks/sessionstart-tool-enum-fixnow.test.ts`, `hooks/userpromptsubmit-halt-relay-fixnow.test.ts`. This is the fix-now response to round 1's REWORK (red-team no-go, app-security-reviewer/cross-domain-reviewer REWORK) and the human's four-item ruling in docs/decisions.md's 2026-09-07 row.
**Prior report (read in full before this round):** docs/reviews/s5-cross-domain-2026-09-07.md (round 1, REWORK -- Finding 1: SE ADR-0006 scope-creep / zero-acceptance-criteria on KNOWN_CONNECTORS+centralLayer; Finding 2: inaccurate "S6/T5" stopgap framing).
**ADR cache:** node docs/adr-cache.mjs --ensure gives CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT] -- same fingerprint as round 1, fast HIT confirmed. Whole catalog re-read, unfiltered, per this role's standing mandate (PRINCIPLES rule 9), against every file this round's diff touches, not only the two files round 1 covered.
**Parallel lanes this round:** same CRITICAL-tier slot as round 1 -- red-team + app-security-reviewer re-confirm in parallel against this same diff (no round-2 reports from either persisted yet at the time of this report; this report covers only cross-domain ground, per the standing division of labor from round 1).

---

## 1. Finding 1 (round 1: SE ADR-0006 scope-creep + zero-acceptance-criteria on KNOWN_CONNECTORS/centralLayer) -- CLOSED

**Verification, not taken on the receipt's word:**

- docs/decisions.md's 2026-09-07 row ("S5 Stage-3 CRITICAL review round 1...") read in full. Item (1) rules on KNOWN_CONNECTORS (citing Issues #90/#92) and explicitly names the evidentiary basis: "story-implementer's Phase-1 plan investigation confirmed no non-spoofable connector-identity signal exists at this layer (~/.claude.json's only field, claudeAiMcpEverConnected, is a bare display-name array -- no id, no URL, nothing binding a name to a specific server; independently re-derived, not taken on the reviewers' word)." This is a real investigation result, not a bare override -- independently re-confirmed this round by reading src/policy/tools/central-classification.ts:18-22's own header, which states the identical fact and cites the same investigation.
- The human ruling's own two named paths (full removal vs. a disclosed/dated/tested exemption) were both real options, not a rubber stamp -- the human picked the latter with an explicit, stated cost (spoofability accepted knowingly, time-boxed).
- Mapping to a named, ratified criterion, code-traced: the shipped code now maps to the decision row's own two enumerated items, which function as this fix-now round's acceptance criteria (there is no plan-v4 with formally renumbered AC1/AC2 labels -- this is a fix-now round responding to a review REWORK, the same shape as S4's Issue #85 same-turn fix, not a fresh plan revision cycle):
  - Item (1) -> KNOWN_CONNECTORS ships as docs/qa/s5-central-classification.json's knownConnectors array -- a committed fixture (not hand-hardcoded in the hook, confirmed: hooks/sessionstart-tool-enum.mjs no longer defines this array inline, it imports loadCentralClassificationFixture from central-classification.ts), carrying version+expiresOn+ratifiedBy fields, pinned by src/policy/tools/central-classification.test.ts (tests named AC1-a/AC1-b/AC1, confirmed running and passing this session -- see section 5), with the in-code comment (central-classification.ts:22-26) stating plainly the exemption is spoofable-in-principle and stands only on the dated human ratification.
  - Item (2) -> Issue #93 (centralLayer.tools[].class inert) ruled defer-to-S6-backlog, comment-only honesty fix. Confirmed landed: docs/backlog.md's Issue #93 entry, central-classification.ts's header, builtin-tool-inventory.ts's corrected header, and the fixture's own notes[1] field all now say so consistently.
- No previously-untracked artifact remains: gh issue list confirms Issues #90, #92, #93 all filed, linked to Milestone #23, sur-labeled; docs/decisions.md's row and docs/backlog.md's two new entries (section 4 below) exist. The original defect (three self-contained, untracked, unratified mechanisms landed in a CRITICAL sensitive-area file) is cured: tracked, dated, ratified, tested.

**One nuance, not re-opening the finding:** SE ADR-0006's rule text literally reads "MUST NOT widen a change's scope opportunistically... separate PR." This fix landed as a fix-now round within the same continuous diff/branch, not a literally separate PR. Given this project's own established, already-reviewed precedent for same-turn fix-now rounds closing review findings without spinning a distinct PR (e.g. S4's Issue #85, "no new reviewer round needed... mechanical, non-sensitive, small-MED ceremony"), and given the substantive harm ADR-0006's rule guards against (undisclosed, untracked, opportunistic scope-widening) is what's actually cured here -- full disclosure, human ratification, tracked Issues, a dated/tested fixture -- this is read as satisfied in substance. Noting the letter-vs-substance gap for the record, not as a blocking residual: it does not independently justify a REWORK verdict, and is not a "new" finding since round 1 already named the whole mechanism and this is that same mechanism's resolution path playing out.

**Verdict: CLOSED.**

## 2. Finding 2 (round 1: "S6/T5" stopgap-framing inaccurate) -- CLOSED

**Verification, code-traced, direct diff read (not the receipt's claim):**

- git diff HEAD -- hooks/sessionstart-tool-enum.mjs: the old placeholder comment line ("disclosed placeholder pending S6/T5") is gone. The new header states the classification decision plainly without claiming a scheduled S6/T5 successor.
- git diff HEAD -- src/policy/tools/builtin-tool-inventory.ts: the header explicitly self-corrects -- "CORRECTED (S5 Stage-3 CRITICAL review round 1, GitHub Issue #91): this comment previously called the central layer 'currently empty, S6-pending' -- as of this story's own fix-now pass it is populated, and no ratified milestone currently owns building a real central-override CONFIG LOADER (checked directly against every open milestone's gh description); until one does, the fixture above is the only central layer that exists." This matches round 1's own finding almost verbatim and correctly disclaims the false scheduled-successor framing.
- docs/backlog.md's new Issue #93 entry (dated 2026-09-07) independently states the same thing: "not currently scheduled as a named task there, and not built here."
- Issue #91 independently re-verified against the live code (not the fix claim) and closed this round -- see section 6.

**Verdict: CLOSED.**

## 3. Whole-ADR-catalog re-check against ALL five files this round's diff touches

Full 35-ADR catalog (12 devops + 23 software-engineering) re-read against every changed/new file, not only the two round 1 covered:

- **devops ADR-0001-0010**: still NOT APPLICABLE -- no IaC/CDK file in this diff's file set (hooks/*.mjs, src/policy/tools/*.ts, one JSON fixture).
- **SE ADR-0001** (record decisions): process-only, satisfied (central-classification.ts's header cites the ratifying docs/decisions.md row and docs/backlog.md entries directly).
- **SE ADR-0002/0003** (layering/SOLID): central-classification.ts splits pure parse/validate (parseCentralClassificationFixture) from file I/O (loadCentralClassificationFixture) -- the exact DI-friendly shape ADR-0003 asks for ("MUST inject I/O-performing dependencies... MUST NOT instantiate them inside business logic"), independently testable against an in-memory string per its own header comment. No violation; this is the pattern ADR-0003 wants, applied correctly.
- **SE ADR-0004** (idempotency): N/A, no mutating endpoint introduced.
- **SE ADR-0005** (testing strategy -- unit tests for every new/changed behavior): satisfied -- central-classification.test.ts exists and is wired into npm test (confirmed running, section 5).
- **SE ADR-0006** (blast radius control): see section 1 above -- CLOSED, with the one noted nuance (not blocking).
- **SE ADR-0007/0008** (tagging/cost): N/A.
- **SE ADR-0009** (observability -- no secrets in logs): checked directly against the two new files. central-classification.ts's header states plainly it reads only display-name strings, "no connector ID, URL, OAuth scope, or any other identity-binding signal" -- confirmed by reading docs/qa/s5-central-classification.json's actual content (tool names + connector display-name strings only, no credential-shaped fields). No violation.
- **SE ADR-0010** (code quality gates): satisfied -- the fixture and module both carry disclosure comments meeting the "leave touched code at least as clean as found" bar; no lint/type suppression added (confirmed no eslint-disable/ts-ignore in the diff).
- **SE ADR-0011-0015** (data): N/A, no datastore.
- **SE ADR-0016-0020** (porting): N/A, no porting activity.
- **SE ADR-0021 (Thoth-native architecture)** -- re-checked in full against the two NEW files specifically (not assumed clean by extension of round 1's clearance of the hooks):
  - Kernel purity (POL-11): central-classification.ts lives at src/policy/tools/, not src/policy/kernel/ -- confirmed directly: src/qa/kernel-purity-check.ts:210's own KERNEL_ROOT = "src/policy/kernel" constant. Re-ran the real instrument this session: npm run qa:kernel-purity gives PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations (unchanged count from round 1 -- the new file correctly sits outside the boundary, same as the pre-existing builtin-tool-inventory.ts's own readFileSync pattern it mirrors).
  - Single decision path (POL-03): unaffected -- central-classification.ts only supplies data to the pre-existing mergeToolClassificationLayers/evaluateToolInventory call sites; it introduces no new decision path.
  - No @microsoft/agent-governance-* import, no ConfigChange use: confirmed absent from both new files.
  - No rule in ADR-0021 bars a JSON-fixture-backed classification/exemption config loaded by a pure module outside the kernel boundary -- this is not a kernel/normalizer-registry purity violation. No ADR-0021 violation.

**Verdict on this round's ADR collisions: zero new collisions found across all 35 catalog entries against all five touched files.** Full disclosure, not a partial scan.

## 4. Seam check: AC5 reconciliation vs. AC1 runtime expiry -- CLEAN, demonstrated

Traced the interaction directly, then confirmed it against a real, passing test (not just code-reading):

- computeSessionTools() (hooks/sessionstart-tool-enum.mjs) calls isFixtureExpired(fixture) fresh, on every SessionStart run -- it is not cached or read from any prior run's state. When expired, centralLayer = { tools: [] } and knownConnectors = new Set(), so mergeToolClassificationLayers/evaluateToolInventory and the connector filter both compute against the CURRENT (post-expiry) truth for that run, unconditionally.
- reconcileReason() then writes set:true/set:false based on THIS run's freshly-computed inventoryResult.haltRequired / unknownConnectorNames.length > 0 -- it has no notion of "this was previously exempted, leave it be." Prior halt-state content is consulted only to decide whether a currently-inactive condition needs an explicit set:false clear (wasReasonActive), never to decide whether a currently-active condition should stay suppressed. There is no code path by which a stale pre-expiry "exempted" state can mask a post-expiry, now-required halt.
- Demonstrated, not just traced: hooks/sessionstart-tool-enum-fixnow.test.ts's own test "AC1: a connector identity matching a knownConnectors fixture entry is exempted (no halt) when the fixture is not expired, but halts once the fixture has expired" exercises exactly this sequence (active fixture -> no halt; then a synthetic already-expired fixture via the THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH test-injection seam -> halt fires for the same connector name) and is confirmed passing in this session's own npm test run (see section 5). The equivalent tool-classification case ("AC1: the SAME MCP server name reverts to unclassified (halts) once the fixture's expiresOn has passed") is also present and passing.

**Verdict: no cross-mechanism seam gap.** The exact scenario this round's task asked to be checked (fixture expires mid-session-lifetime -> next SessionStart correctly re-flags the newly-unexempted tool/connector) is both structurally sound and empirically demonstrated green.

## 5. npm test -- independent re-run, real count

Command run this session: npm test

Real output tail:
tests 543
suites 0
pass 543
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 14085.8204

Zero load errors (checked the full output for "not ok"/"MODULE_NOT_FOUND"/"Cannot find" -- none). Confirmed the two new fix-now hook test files and central-classification.test.ts actually ran and passed as part of this count (grepped the full output for "AC1:"/"AC5"/"OPS-02 canary" -- all present, all passing), not silently skipped or failing to load. Real, independently-measured count: 543 pass / 0 fail / 0 skipped. This resolves the internal 543-vs-551 discrepancy in the build receipt -- the number this reviewer can stand behind, from a live run this session, is 543/0/0.

## 6. docs/backlog.md new entries (Issues #93, #96) -- honesty check

Both entries read in full:

- Issue #93 entry: states plainly what's built (comment-only disclosure across three files) vs. what's deferred (a real consumer of .class, "S6's job... not currently scheduled as a named task there, and not built here") -- matches the code exactly, no overclaim.
- Issue #96 entry: states the pre-existing (not-introduced-this-pass) nature of the gap, names both candidate fixes and the specific unmeasured assumption blocking each, and correctly routes to a spike-first follow-up per PRINCIPLES rule 18. Matches docs/decisions.md's 2026-09-07 row item (4) exactly.

**Verdict: both entries honest, dated, correctly scoped -- no understatement found.**

## 7. NEW finding this round

### [SUSPICION][LOW][derived] -- the fixture-loader pattern (central-classification.ts + docs/qa/s5-central-classification.json) is a real, working precedent for S6's eventual "real central-override loader" shape, and nobody has yet ruled on whether S6 should keep, generalize, or discard it

**Reasoning (derived, not code-run):** this fix-now round built, for real, a working pattern -- a versioned/dated/expiring JSON config file, loaded by a dedicated pure module, validated, pinned by a regression test -- for exactly the kind of thing CLAUDE.md's "Policy delivery / config surface" sensitive-area bullet describes ("anything that changes how policy is authored or delivered to the enforcement point"). This pattern works, is reviewed (this round), and sets a real precedent. But S6 (Milestone #24, "policy centralization") hasn't been planned yet, and nothing in docs/decisions.md/docs/backlog.md states whether S6 should adopt this exact shape, generalize it, or reject it in favor of something else -- it risks being silently inherited by default simply because it already exists and works, rather than by an explicit S6-planning-time decision. This is exactly the kind of thing this role's task explicitly asked to be flagged either way, not silently approved.

**Why LOW/non-blocking:** no ADR governs this decision today (checked directly, section 3 above -- nothing in the 35-ADR catalog restricts or mandates a config-surface shape at this layer), the pattern itself is disclosed and dated (expires 2026-10-07, forcing a decision point on its own), and S6 hasn't even been scoped yet -- there's no missed deadline or open contradiction to point to, only an open question worth naming before it gets answered by default.

**Minimal fix:** add one line to docs/backlog.md (or S6's eventual intake) naming this pattern explicitly as a candidate/precedent for S6 to rule on -- keep, generalize, or discard -- rather than leaving S6 to discover it exists mid-build with no record that it was ever a deliberate consideration.

## 8. Coverage gaps named

- Same division of labor as round 1: exploitability (spoofability, sticky-halt reconciliation correctness under adversarial input, the new THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH test-injection env var's own security shape) is red-team's/app-security-reviewer's lane -- neither has a persisted round-2 report yet at the time of this pass; not re-litigated here. The env-var test-seam is noted as squarely within their existing, already-reviewed precedent (mirrors CLAUDE_PROJECT_DIR/HOME's own test-injection pattern per the code's own comment) -- not a new cross-domain gap.
- docs/STATE.md's "Next" section is stale (still reads "dispatch S5's Stage 3 review" as a future action, not reflecting round 1's REWORK or this fix-now round) -- bookkeeping staleness, Manager's to correct at handoff, not a reviewer finding.

## 9. Verdict

**APPROVE** (cross-domain lane only -- this does not stand in for red-team/app-security-reviewer's own round-2 re-confirms, which are still pending as of this report). Both round-1 findings are genuinely CLOSED, independently re-verified against the live code and a live test run, not taken on the implementer's receipt. One new LOW, non-blocking, derived suspicion is named for the record. Zero new ADR collisions found across the whole 35-ADR catalog against all five touched files.

**Single next action:** once red-team/app-security-reviewer's own round-2 re-confirms land clean, this story is clear for Stage 4 (verify) from the cross-domain seat.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by blast radius):
1. [CLEAN][code-traced] Round-1 Finding 1 (SE ADR-0006 scope-creep + zero-acceptance-criteria, KNOWN_CONNECTORS/centralLayer) -- CLOSED: human ratification (docs/decisions.md 2026-09-07 row) cites real, independently re-confirmed evidence (no non-spoofable connector-identity signal exists), mechanism now tracked/dated/tested (Issues #90/#92/#93, docs/qa/s5-central-classification.json, central-classification.test.ts). One non-blocking nuance noted: ADR-0006's literal "separate PR" text wasn't followed (same-diff fix-now round, consistent with this project's own S4/Issue #85 precedent) -- substance cured, letter noted only.
2. [CLEAN][code-traced] Round-1 Finding 2 (S6/T5 stopgap-framing inaccuracy) -- CLOSED: hooks/sessionstart-tool-enum.mjs and src/policy/tools/builtin-tool-inventory.ts headers corrected in place, both now state no milestone owns a real central-override loader; Issue #91 independently re-verified and closed.
3. [CLEAN][demonstrated] Seam check (AC5 reconciliation vs. AC1 runtime expiry) -- no stale-masking risk: computeSessionTools() recomputes fixtureExpired every run, reconcileReason() writes against current-run truth only; demonstrated passing via hooks/sessionstart-tool-enum-fixnow.test.ts's own expiry-reversion tests (npm test, this session).
4. [CLEAN][code-traced] Whole 35-ADR catalog re-checked against all 5 files this round's diff touches (2 new: central-classification.ts, docs/qa/s5-central-classification.json) -- zero new collisions; ADR-0021 kernel-purity re-confirmed via a real re-run of npm run qa:kernel-purity (PASS, 4 files, unaffected -- new file correctly sits outside src/policy/kernel/).
5. [CLEAN][derived] docs/backlog.md's Issue #93/#96 entries -- honest, dated, accurately scoped, no understatement found.
6. [SUSPICION][LOW][derived] The new fixture-loader pattern (central-classification.ts + docs/qa/s5-central-classification.json) is a real, working precedent for S6's eventual central-config-loader shape, but no ADR or decision has ruled whether S6 should adopt/generalize/reject it -- flag for S6 intake, not blocking (fixture self-expires 2026-10-07, forcing the question on its own).
counts (checksum): issues=0 suspicions=1 clean=5
evidence (checksum): demonstrated=1 code-traced=4 derived=1
checks=npm test: 543 pass / 0 fail / 0 skipped (real run, this session, independently re-executed); npm run qa:kernel-purity: PASS (4 files, zero violations); node docs/adr-cache.mjs --ensure: CACHE=HIT (fp 83b2e3e, same as round 1)
adr=HIT(35, whole catalog)
report=docs/reviews/s5-cross-domain-round2-2026-09-07.md
