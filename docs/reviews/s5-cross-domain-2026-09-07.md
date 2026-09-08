# Cross-domain review: S5 uncommitted diff (hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-07
**Scope:** scope=s5, tier=CRITICAL (docs/.maat-state.json), Milestone #23 "Deny-by-default + hook wiring." Target: the current uncommitted working-tree diff to hooks/sessionstart-tool-enum.mjs (KNOWN_CONNECTORS allowlist + populated centralLayer) and hooks/userpromptsubmit-halt-relay.mjs (blockWithMessage() + the just-applied EPIPE fix).
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) - [CACHE=HIT]. Whole catalog read, unfiltered, per this role's standing mandate (PRINCIPLES rule 9).
**Parallel lanes this round:** red-team (adversarial/attack-surface) + app-security-reviewer (authz/injection/deps), per docs/STATE.md's "Next #1" and the S5 plan's own "Reviewers" section. architecture-reviewer already ran pre-build (round 1/2 + council seat) against the plan, not this specific uncommitted diff - its prior APPROVE does not cover the new code below, which post-dates it.

---

## 1. Which ground the parallel lanes cover

- red-team: exploitability/bypass of KNOWN_CONNECTORS, the halt mechanism, the EPIPE fix's edge behavior under adversarial pipe conditions.
- app-security-reviewer: authz/injection/deps - whether the new code introduces an injectable/escalatable path.
- Neither lane's charter (by design) checks: (a) whole-ADR-catalog collisions outside security-tagged ADRs, (b) build-vs-ratified-plan drift / acceptance-criterion mapping, (c) whether a change's own existence - not its exploitability - conflicts with an architectural rule, (d) doc/comment accuracy against actual ratified milestone scope. That is this pass's job (PRINCIPLES rule 9), and this report covers only that ground - it does not re-litigate exploitability or authz, which the parallel lanes own.

## 2. ADR-state disclosure (whole catalog, 35 ADRs, both domain folders)

Checked every accepted ADR in adr/devops (12) and adr/software-engineering (23) against the diff's changed files, not against the other reviewers' findings.

- **devops ADR-0001-0010**: all applicableTo scoped to iac/cdk/cost/pipeline/etc. hooks/*.mjs is application/session-gate code, not IaC. **NOT APPLICABLE** - no collision, confirmed by direct read of each applicableTo array, not assumed.
- **SE ADR-0001** (Record architecture decisions): process-only, satisfied.
- **SE ADR-0002/0003** (layering, SOLID): hooks are the documented impure shell, outside src/'s layered boundary. **NOT APPLICABLE**.
- **SE ADR-0004/0005** (idempotency, testing strategy): no new mutating endpoint added. ADR-0005's "MUST write unit tests for every new/changed behavior" is relevant background for finding 1 (no test exists for either new mechanism).
- **SE ADR-0006 (Blast radius control) - VIOLATION. See Finding 1.** applicableTo: architecture, reliability, cloud - no security tag, so this ADR sits outside app-security-reviewer's typical security-tagged slice and isn't red-team's adversarial focus either. Exactly the seam this role exists to catch.
- **SE ADR-0007/0008** (tagging, cost tracking): not applicable to hook scripts.
- **SE ADR-0009** (observability): "MUST NOT log secrets..." checked directly - blockWithMessage's message text only ever carries tool/connector names (per mcp-enumeration.ts's own names-only contract, S5-shipped and unchanged by this diff). **No violation found.**
- **SE ADR-0010** (code quality/maintainability gates): its own text cites ADR-0006 directly - reinforcing citation, not a second independent violation.
- **SE ADR-0011-0015** (data): not applicable, no datastore involved.
- **SE ADR-0016-0020** (governance-plugin porting): not applicable - no porting activity in this diff.
- **SE ADR-0021 (Thoth-native architecture) - no new violation.** Re-checked every rule in full against the new lines specifically (not just the plan's own prior ADR Review, which pre-dates this diff):
  - Kernel purity (POL-11), single decision path (POL-03), no ConfigChange use, no @microsoft/agent-governance-* import: all still true - the new code is entirely inside the hook's own impure-shell computation, never touches src/policy/kernel/**.
  - No rule in ADR-0021 explicitly bars a hardcoded classification allowlist inside a SessionStart hook script - the kernel/normalizer-registry purity boundary is not crossed by KNOWN_CONNECTORS or the populated centralLayer. **This is not an ADR-0021 violation** - the defect is a plan/process one (Finding 1), not an architectural-boundary one.

**Verdict on ADR collisions: one confirmed (SE ADR-0006), everything else checked clean or not applicable.** Full disclosure, not a partial scan: all 35 catalog entries were read against this diff's actual changed lines.

## 3. Findings

### Finding 1 - [ISSUE][HIGH][code-traced] - SE ADR-0006 scope-creep violation; KNOWN_CONNECTORS contradicts this file's own invariant and the ratified plan's own acceptance criterion, weakening Milestone #23's "deny-by-default" goal

**Evidence, code-traced:**

- hooks/sessionstart-tool-enum.mjs:60-66 (pre-existing, unmodified by this diff) states plainly: "a claude.ai account connector is ALWAYS reported under this distinct reason key" (UNCLASSIFIED_CONNECTOR_REASON_KEY).
- hooks/sessionstart-tool-enum.mjs:77-85 (new, this diff) defines KNOWN_CONNECTORS, a 7-entry hardcoded allowlist.
- hooks/sessionstart-tool-enum.mjs:236-240 (new, this diff): unknownConnectorNames = connectorNames.filter(name => !KNOWN_CONNECTORS.has(name)); the halt reason is written only if unknownConnectorNames.length > 0. A connector on the allowlist therefore never appears in the halt reason and never triggers the halt - directly falsifying the file's own "ALWAYS" claim two lines above it, now stale and self-contradicting within the same file.
- docs/plans/S5-phase1-2026-09-06.md:198 (ratified v3, the ONLY plan on record for this file), acceptance criterion 16(b): a claude.ai-connector-shaped name is asserted "absent from the tool-schema enumeration ... while present in the connector-identity halt condition." The ratified plan specifies no allowlist/exemption mechanism at all - every connector identity was to remain part of the halt condition, unconditionally.
- hooks/sessionstart-tool-enum.test.ts:61-68 (test-writer's own black-box tests, RED-confirmed then GREEN, unmodified): explicitly declines to test the connector-vs-tool-schema distinction because it "is not pinned down anywhere in the plan text" - test-writer flagged this exact question back for a later review pass rather than guessing. This IS that pass, and the answer the shipped code gives (a silent, hand-authored exemption) is not what the ratified plan specified.
- No plan revision (v4) exists for this change. git log / docs/decisions.md / docs/backlog.md / gh issue list all confirm zero tracked artifact exists for KNOWN_CONNECTORS, the populated centralLayer, or blockWithMessage() - no Issue, no decisions.md row, no backlog entry, no CHANGELOG entry, no criterion in the 24-item ratified list maps to any of the three. Checked directly (grep across docs/decisions.md, docs/backlog.md, CHANGELOG.md; gh issue list --search for KNOWN_CONNECTORS/centralLayer/blockWithMessage/scope-creep - no hits).
- SE ADR-0006 (Accepted), rule text, verbatim: MUST NOT widen a change's scope opportunistically (the "while I'm here" refactor case); separate PR. SE ADR-0010 (Accepted) cites this same rule directly. Three self-contained, untracked mechanisms landed inside a CRITICAL-tier, sensitive-area file (CLAUDE.md's "Policy enforcement / session gates") outside the ratified plan and outside the tracked-Issue/no-gold-plating discipline CLAUDE.md itself requires.

**Why this is a cross-domain finding, not a duplicate of red-team/app-security:** neither lane's charter reads the whole ADR catalog or checks build-vs-plan conformance; SE ADR-0006 is tagged architecture, reliability, cloud (no security tag), so it sits outside app-security-reviewer's typical ADR slice, and it is not an attack scenario red-team would frame. The mere existence of an unreviewed, untested, unratified exemption mechanism on the project's own "deny-by-default" milestone is the defect here - independent of whether it is exploitable (red-team's question) or authz-broken (app-security's question).

**Exposure:** ~100% of sessions run under this operator's own account while any of the 7 named connectors stays connected - the filter is a deterministic Set.has() check, not probabilistic. Basis: counted in code (not assumption). This is a security-relevant finding (weakens a fail-closed halt on a named CLAUDE.md sensitive area) - exempt from PRINCIPLES rule 21's narrow-exposure cap regardless of the percentage.

**Minimal fix (name the unlock, PRINCIPLES rule 2):**
1. Preferred: remove KNOWN_CONNECTORS and its filter from this diff (restore the unconditional "any connector identity halts" behavior the file's own header comment and the ratified plan's C16(b) already specify); keep centralLayer's populated array and blockWithMessage() only if each gets its own one-line docs/decisions.md ruling + backlog/Issue entry before this diff is called reviewed, since neither is presently tracked either.
2. Alternative, if the team wants to keep the connector allowlist: write a plan revision (v4) adding a named acceptance criterion for it, get it ratified, add a test-writer or unit test pinning the exemption's exact behavior (the gap sessionstart-tool-enum.test.ts:61-68 already names), and file the tracked Issue CLAUDE.md's "no gold-plating" rule requires - all before, not after, this diff is merged.

Either path is acceptable; landing exactly as-is, self-reviewed only by the same person who wrote it, is not.

**Cross-reference:** app-security-reviewer independently filed GitHub Issue #90 for this same code location (docs/reviews/s5-halt-hooks-app-security-2026-09-07.md), from a spoofability/exploitability angle (the display-name string has no binding to a verified connector identity). This finding is filed as a comment on Issue #90, not a duplicate Issue, per this project's dedup convention -- but the two angles are non-overlapping and both must close before this line is clean: app-security's fix (binding the match to a non-spoofable identity) would NOT by itself close this finding, since the exemption mechanism would still be unratified, untested-by-plan, and still contradict the ratified plan's own C16(b) (which specifies no exemption mechanism at all, spoofable or not). The two findings' recommended minimal fixes converge on the same immediate action (remove the allowlist) but diverge on what a durable fix would need to satisfy both.

---

### Finding 2 - [ISSUE][MED][code-traced] - "STOPGAP pending S6/T5" framing is not accurate against this project's own ratified scope

**Evidence, code-traced:**

- hooks/sessionstart-tool-enum.mjs:67 and :195-197: the new centralLayer comment frames the hardcoded 6-server array as a "disclosed stopgap pending S6/T5's real central-override loader."
- docs/STATE.md:41: T5 already shipped - "T5 (tool-classification catalog) extends POL-08's mergeLayers two-tier shape (shipped + central, central wins)" - this was S3's own scope, shipped and reviewed. T5 is not a future deliverable; it is the existing mechanism this diff's data populates.
- gh api repos/:owner/:repo/milestones (run this session): Milestone #24 ("policy centralization")'s actual description is "POL-07, POL-09 (pinning/stamping half only), POL-10. T10 (delivery format) reopened here." No mention of a central classification-config loader for centralLayer's data. No ratified milestone currently owns building the "real" replacement this comment promises.

**Effect:** the comment reads as though a scheduled future story will retire this hardcoded array. On the record checked this session, nothing is actually scheduled to do that - the "stopgap" may in practice be indefinite, which is a materially different disclosure than what the comment states.

**Minimal fix:** correct the comment to state the actual, currently-true situation - no milestone presently owns a real central classification-config loader - and file a docs/backlog.md entry (or a GitHub Issue) tracking that gap explicitly, rather than attributing it to "S6/T5" as though it were already scheduled.

---

### Confirmed clean - [CLEAN][code-traced] - EPIPE fail-open regression (debugger-found) is genuinely fixed in this diff

Not a new finding (already named by the debugger; PRINCIPLES's own redundancy discipline applies) - verified independently by direct code read, not taken on the debug report's word:

- hooks/userpromptsubmit-halt-relay.mjs: all four writeSync call sites (two inside blockWithMessage(), two inlined in the top-level main().catch() handler) are each individually wrapped in their own try/catch that swallows the error, and process.exit(2) is the unconditional last statement on every path - exactly the debugger's own proposed fix, applied. This closes the fail-open-to-exit-1 regression the debugger reproduced 3 out of 3 times.
- One cosmetic item the debugger already flagged (stale docstring claiming a hookSpecificOutput.permissionDecisionReason write that the code doesn't actually perform) is still present and still cosmetic - not re-listed here as its own finding, per the redundancy rule; already tracked in the debug report.

### Coverage gaps named

- Plan-conformance / acceptance-criterion mapping for this specific diff: no reviewer's lane structurally re-checks this - that is this pass's own job (Finding 1), now covered, not a silent gap.
- CHANGELOG.md / docs/STATE.md drift: neither file mentions the three new mechanisms at all. Direct consequence of Finding 1, folded into its fix rather than double-counted.
- Provenance note (not scored, editorial): the code comment's self-review claim is dated 2026-09-08, one day ahead of the actual date this diff was authored/reviewed (2026-09-07). Trivial date slip, verdict-neutral.
- Everything else in the diff (describeActiveReasons(), the JSON hookSpecificOutput.systemMessage shape, the malformed/anyReasonSet branches) is exploitability/authz territory - correctly red-team's and app-security-reviewer's lane, not re-litigated here.

## 4. Verdict

**REWORK.** Finding 1 is a genuine, code-traced ADR violation (SE ADR-0006) on a named CLAUDE.md sensitive-area file, security-relevant (weakens deny-by-default), and per this role's own charter an ADR collision is never waived - fix it or run /maat:adr-amend. Finding 2 is MED and should be fixed in the same pass since it touches the same lines.

**Single next action:** story-implementer reverts KNOWN_CONNECTORS (or gets it properly ratified per Finding 1's alternative path) and corrects the centralLayer "S6/T5" comment per Finding 2, before this diff proceeds to red-team/app-security-reviewer's own sign-off being treated as sufficient for merge.

---

RECEIPT: verdict=REWORK
findings (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] hooks/sessionstart-tool-enum.mjs:60-66,77-85,236-240 vs docs/plans/S5-phase1-2026-09-06.md:198 (C16b) - KNOWN_CONNECTORS allowlist contradicts this file's own "ALWAYS reported" invariant + the ratified plan's own criterion, violates SE ADR-0006 (scope creep, untracked); weakens Milestone #23's deny-by-default goal. Exposure: ~100% of sessions with any of the 7 listed connectors connected, basis: counted in code. Fix: revert the allowlist or get it plan-ratified + tested + tracked before merge.
2. [ISSUE][MED][code-traced] hooks/sessionstart-tool-enum.mjs:67,195-197 vs docs/STATE.md:41 + Milestone #24's actual gh description - "pending S6/T5" framing is inaccurate: T5 already shipped (S3), no milestone owns a real central-override loader. Fix: correct the comment, file the real gap as a backlog/Issue entry.
3. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs - debugger-found EPIPE fail-open regression genuinely fixed: all 4 writeSync call sites wrapped in try/catch, exit(2) unconditional. Verified independently by direct code read, not re-listed as a new finding (already named by debugger).
4. [CLEAN][code-traced] Whole 35-ADR catalog checked against diff's changed files outside red-team/app-security's lanes - no other collision found; devops ADRs are IaC-scoped/not applicable to hooks/*.mjs; ADR-0021 re-checked in full against the new lines specifically, no kernel/normalizer-purity boundary crossed.
counts (checksum): issues=2 suspicions=0 clean=2
evidence (checksum): demonstrated=0 code-traced=4 derived=0
checks=npm test: 513 pass / 0 fail / 0 skipped (real run, this session); node docs/adr-cache.mjs --ensure: CACHE=HIT
adr=HIT(35, whole catalog)
report=docs/reviews/s5-cross-domain-2026-09-07.md
