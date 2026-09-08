# S5 fix-now condition re-confirm -- fixtureSource/fixturePath diagnostic
**app-security-reviewer (Horus) -- 2026-09-07**

**Scope:** narrow, purely-additive diagnostic fix closing the one council condition round 3's
patch left unfulfilled: record which central-classification fixture path actually resolved
(project-relative primary vs. module-adjacent DEFAULT_FIXTURE_PATH fallback) into the halt-state
file, per impact-analyst's and architecture-reviewer's SAFE-TO-PATCH/APPROVE-WITH-CONDITIONS
verdicts (docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md,
docs/reviews/s5-central-classification-architecture-council-2026-09-07.md).

**Tier:** CRITICAL (sensitive area, Milestone #23) -- proportionate ceremony: a targeted re-confirm
of one narrow diff, not a fresh full attack pass on the whole mechanism (already covered across 3
rounds + council).

## ADR compliance
node docs/adr-cache.mjs --ensure -> "ADR cache HIT: reused 35 ADR(s) [adr/devops:12,
adr/software-engineering:23] ... [CACHE=HIT]".

Applicable-domain ADRs read from the shared catalog (authn/authz, input handling, secrets,
dependencies, data exposure): ADR-0021 ("Thoth-native architecture") is the only one whose rules
bear on this diff's surface (halt-state hook code). Its audit-log rule ("hash-chained ... atomic
write ... at a location outside the governed session's write reach") governs hooks/audit-log.mjs
specifically, not .thoth/halt-state/ -- a distinct, ephemeral, session-diagnostic mechanism this
diff touches; unchanged write discipline (writeFileSync, not atomic temp+rename) pre-dates this
diff and is out of this narrow review's scope. ADR-0016/0018/0019/0020 govern the M1.5 porting
story specifically and do not apply to this hook code. No applicable ADR is violated by this diff.

## What I verified

### 1. Full diff read
Read hooks/sessionstart-tool-enum.mjs (full file, 501 lines), src/policy/tools/central-classification.ts
(full file, new/untracked -- git diff shows nothing for it because it was never committed; read
directly instead), and hooks/sessionstart-tool-enum-fixnow.test.ts (full file, 443 lines) in full.
userpromptsubmit-halt-relay.mjs's relevant piece (inspectHaltState, hooks/userpromptsubmit-halt-relay.mjs:47-64)
was traced directly rather than taken on the CHANGELOG's word.

The new production surface is small and isolable:
- central-classification.ts:63 -- exported DEFAULT_FIXTURE_PATH, module-adjacent, derived from
  import.meta.url, never from an env var.
- sessionstart-tool-enum.mjs:267-272 (resolveFixtureLocation) -- checks existsSync on
  <projectDir>/docs/qa/s5-central-classification.json; returns fixtureSource:"project-relative" +
  that path, or fixtureSource:"fallback-default" + DEFAULT_FIXTURE_PATH. Pure, non-throwing,
  resolved once before stdin is even read (line ~406-413), so it survives an enumeration exception.
- sessionstart-tool-enum.mjs:168-184 (writeHaltReason) -- stamps payload.fixtureSource/
  payload.fixturePath at the top level, only inside the branch that already builds payload for a
  write that is happening anyway.

### 2. Additive-and-tolerated schema check (code-traced, not assumed)
hooks/userpromptsubmit-halt-relay.mjs:47-64's inspectHaltState(haltState) reads haltState.reasons
only -- it never inspects, iterates, or rejects on any other top-level key. fixtureSource/
fixturePath are therefore inert to it by construction: an unknown top-level key neither breaks
validation nor is echoed anywhere. Confirmed by direct execution (not just reading), see section 3
below -- a live halt-state file carrying both new fields, in both a clean-relay and an active-block
case, produces byte-identical relay behavior/messages to a file without them.

### 3. Independent verification, run myself (not the shipped test alone)

Vanilla-session repro (own, independent of the shipped test):
  CLAUDE_PROJECT_DIR pointed at an empty isolated tree /tmp/horus-vanilla-check
  sessionstart-tool-enum.mjs run against a SessionStart payload -> exit code 0
  ls /tmp/horus-vanilla-check/.thoth/halt-state/ -> "No such file or directory"
    (AC-4 holds: NO file at all, own repro, independent of the shipped test)
  userpromptsubmit-halt-relay.mjs run against the same session -> exit code 0

Forced-halt repro against an isolated tree with NO fixture of its own (exercising the fallback
path):
  CLAUDE_PROJECT_DIR=/tmp/horus-unclassified-check, one unclassified MCP server declared
  sessionstart-tool-enum.mjs -> exit 0, halt-state file written:
    sessionId: horus-fallback-check
    reasons.SUR-03-unclassified-tool.set: true, detail: "unclassified: totally-unreviewed-attacker-server"
    fixtureSource: "fallback-default"
    fixturePath: "C:\playground\thoth\docs\qa\s5-central-classification.json"
  userpromptsubmit-halt-relay.mjs -> exit 2, message:
    "thoth halt: session horus-fallback-check blocked -- SUR-03-unclassified-tool: unclassified:
    totally-unreviewed-attacker-server (unlock: ...)"

Confirmed: fixtureSource/fixturePath never appear in the relay's stderr line or JSON systemMessage
-- the relay's output is byte-identical in shape to a halt-state file without those fields. The
block itself (exit 2, correct reason text) is unaffected either way, matching the claim.

### 4. CLAUDE_PROJECT_DIR / path-traversal / data-exposure check
Traced resolveFixtureLocation(): the recorded fixturePath is either (a) join(projectDir(),
"docs","qa","s5-central-classification.json") -- a literal, hardcoded suffix appended to whatever
CLAUDE_PROJECT_DIR (or cwd()) already is, or (b) DEFAULT_FIXTURE_PATH, anchored to
central-classification.ts's own import.meta.url -- never influenced by any environment variable.
There is no attacker-controlled path segment concatenated anywhere (no "../" from untrusted input)
-- the only variable is the base (CLAUDE_PROJECT_DIR), which is exactly the same variable
haltStatePath() itself already uses to decide where the halt-state file is written, pre-existing
and unchanged by this diff. Recording it therefore reveals nothing an operator/attacker who already
controls CLAUDE_PROJECT_DIR doesn't already know -- it is an echo of a value already in play, not a
new derived secret or a path that can escape to a location outside what CLAUDE_PROJECT_DIR already
grants.

Demonstrated directly: set CLAUDE_PROJECT_DIR to a traversal-shaped-but-equivalent string
("$TARGET/../horus-traversal-target") pointing at an isolated tree with an unclassified server
declared -- the resulting halt-state file recorded fixtureSource:"fallback-default" and
fixturePath pointing at this repo's own real committed fixture (C:\playground\thoth\docs\qa\
s5-central-classification.json), never anywhere outside the granted tree; the fallback path is
immune by construction since it's derived from the module's own real disk location, never from the
redirected CLAUDE_PROJECT_DIR.

Tie to red-team's open R5 (docs/reviews/s5-fixnow-round3-red-team-2026-09-07.md:148-174,
UNPROVEN-pending-verification, "the hook still records nowhere which fixture path it resolved -- so
if the override is reachable, it is as silent as N1 was"). This patch is exactly R5's own named
settling ingredient ("the fix being to ... record the resolved path in the halt-state file") for the
PARTIAL case: if CLAUDE_PROJECT_DIR redirection is ever reachable in production AND the redirected
fixture still results in some halt firing (e.g. a partial exemption that leaves something else
unclassified), the resulting halt-state file's fixtureSource:"project-relative" plus an unexpected
fixturePath is now a visible forensic trace where none existed before.

It does NOT close the worst-case leg of R5: red-team's own demonstrated attack
(docs/reviews/s5-fixnow-round3-red-team-2026-09-07.md:155-158, "E3 ... NO HALT FILE -- both
unreviewed entities EXEMPTED") is a FULL exemption bypass -- nothing halts, so under AC-4's own
unmodified "no file at all when nothing is active" contract, no halt-state file is ever written and
fixtureSource/fixturePath are never recorded in that exact scenario either. This is not a defect
introduced by this patch (AC-4's contract is explicit, long-standing, and out of this story's scope
to change) -- but it means the R5 suspicion is NOT fully closed by this diagnostic, only partially:
closed for the "partial mismatch, some halt still fires" sub-case, unchanged (as concerning as
before, not worse) for the "full silent bypass" sub-case. Confirmed by direct reasoning plus the
code trace above; not independently re-executed against a live production CLAUDE_PROJECT_DIR
override since R5 itself remains UNPROVEN pending the operator drill red-team already named. The
field makes the suspicion no worse, and meaningfully better for one sub-case; it does not fully
resolve it, and nobody should later cite this patch as having closed R5 outright.

### 5. Regression check against prior-round-closed findings
Reviewed the diff for removal or weakening of any prior control: none found. loadCentralClassificationFixture,
isFixtureExpired, parseCentralClassificationFixture (Issues #90/#98/#99/#100 fixes) all present,
unchanged in logic -- only DEFAULT_FIXTURE_PATH gained an export keyword. inspectHaltState
(Issue #95 fix), sanitizeDetail/UNLOCK_HINTS (Issues #97/#94), reconcileReason's UNKNOWN_SESSION_ID
additive-only branch (Issue #96 escalation fix) are all untouched by this diff -- diff/direct read
confirms the new code only adds an optional fixtureLocation parameter threaded through existing
call sites, never removes or narrows an existing check. hooks/test-support/fixture-tree.ts's diff
is test-support-only (writeCentralClassificationFixture), no production surface.

### 6. Independent test run
npm test, independently re-run:
  tests 550, pass 550, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 15707.4356
Matches the build receipt's claimed 550/0/0 exactly -- independently re-run, not taken on faith.

Isolated re-run of just the new/changed test file (npx tsx --test hooks/sessionstart-tool-enum-fixnow.test.ts):
  13 tests, 13 pass, 0 fail
including the three new fixture-source tests (project-relative, fallback-default, and the explicit
"AC-4 unregressed by fixtureSource/fixturePath recording" test) -- all green.

## Findings

1. [CLEAN][demonstrated] fixtureSource/fixturePath are genuinely additive and inert to
   inspectHaltState's schema validation -- traced (hooks/userpromptsubmit-halt-relay.mjs:47-64)
   and directly demonstrated (relay run against live halt-state files carrying the new fields, both
   clean and active-block cases, byte-identical relay behavior).
2. [CLEAN][demonstrated] AC-4 (vanilla, fully-classified session -> no halt-state file at all) is
   genuinely unregressed -- independently reproduced outside the shipped test suite (own vanilla
   session repro, CLAUDE_PROJECT_DIR pointed at an empty isolated tree, exit 0, no
   .thoth/halt-state/ directory created at all) in addition to the shipped test passing.
3. [CLEAN][code-traced] The recorded fixturePath cannot leak anything beyond what
   CLAUDE_PROJECT_DIR/cwd() already exposes elsewhere in this same file (haltStatePath already uses
   the identical base) -- no attacker-controlled path segment is concatenated, and the fallback leg
   is anchored to the module's own import.meta.url, immune to any env var.
4. [ISSUE][LOW][code-traced] The diagnostic only records a fixture-path trace on runs that already
   write a halt-state file (by design, to preserve AC-4). Red-team's round-3 R5 finding's
   worst-case demonstrated attack (a CLAUDE_PROJECT_DIR-redirected fixture that exempts everything,
   producing a clean no-halt session) leaves zero halt-state file, so this diagnostic records
   nothing in that exact scenario -- R5 remains only partially addressed by this patch, not closed.
   Not a regression (this is AC-4's own unmodified, in-scope contract, not a defect this patch
   introduced), but it should not be characterized as having closed R5's silence gap outright.
   Minimal fix / next step: none required for this patch to ship -- carry this nuance forward
   explicitly into the pre-activation CLAUDE_PROJECT_DIR precedence drill red-team already named
   (docs/reviews/s5-fixnow-round3-red-team-2026-09-07.md:174), so whoever runs that drill knows a
   full-exemption bypass would still be silent even with this patch in place. Exposure: 0% against
   today's deployment (PreToolUse is unwired, per red-team's own R5 note); unquantified at
   production activation, basis: assumption -- this caps the finding at LOW and it does not gate.
   No GitHub Issue filed (LOW-severity issues are not filed per this project's Issue Discipline).
5. [CLEAN][code-traced] No prior-round-closed finding (Issues #90/#94/#95/#96/#97/#98/#99/#100/#101)
   is reintroduced or weakened by this diff -- every fix's logic is unchanged; only an optional
   fixtureLocation parameter is threaded through existing call sites additively.
6. [CLEAN][demonstrated] npm test independently re-run: 550/0/0, matching the build receipt
   exactly. The new/changed test file (hooks/sessionstart-tool-enum-fixnow.test.ts), 13 tests,
   independently re-run in isolation: 13/0/0, including the three fixture-source-specific tests.

## Verdict

APPROVE. This is a narrow, purely-additive diagnostic fix. It correctly fulfills the council's
fix-now condition for the sub-case where it can (a halt still fires, and the resolved fixture path
is now visible), does not regress AC-4 or any prior-round-closed finding, is genuinely inert to the
relay's schema validation, and does not widen the still-open, already-tracked CLAUDE_PROJECT_DIR
UNPROVEN-pending-verification suspicion (red-team R5) in any way -- if anything it narrows it for
one sub-case. The one residual note (finding 4) is LOW, non-blocking, and is a
scope/nomenclature clarification for the follow-up drill, not a defect in this patch.

Single next action: none required to ship this patch. Carry finding 4's nuance into red-team's
already-scheduled pre-activation CLAUDE_PROJECT_DIR precedence drill so the drill's write-up
correctly states this diagnostic closes R5 only for the partial-mismatch sub-case, not the
full-exemption-bypass sub-case.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:47-64 -- inspectHaltState reads only .reasons, new top-level fixtureSource/fixturePath fields are inert to schema validation, confirmed by direct execution against live halt-state files.
2. [CLEAN][demonstrated] hooks/sessionstart-tool-enum.mjs (own independent repro, CLAUDE_PROJECT_DIR pointed at an empty isolated tree) -- AC-4 vanilla-no-file contract genuinely unregressed, exit 0 and no .thoth/halt-state/ directory created at all.
3. [CLEAN][code-traced] hooks/sessionstart-tool-enum.mjs:267-272 (resolveFixtureLocation) + src/policy/tools/central-classification.ts:63 (DEFAULT_FIXTURE_PATH) -- recorded fixturePath cannot leak beyond what CLAUDE_PROJECT_DIR/cwd() already exposes elsewhere in this file; no attacker-controlled path segment concatenated; fallback leg immune via import.meta.url.
4. [ISSUE][LOW][code-traced] hooks/sessionstart-tool-enum.mjs:160-184 -- fixtureSource/fixturePath only recorded on runs that already write a halt-state file (by AC-4 design), so red-team R5's worst-case full-exemption-bypass attack (zero halt fires) still leaves zero forensic trace; patch closes R5's silence gap only for the partial-mismatch sub-case, not fully -- minimal fix: none needed to ship, just carry the nuance into red-team's already-scheduled CLAUDE_PROJECT_DIR precedence drill.
5. [CLEAN][code-traced] full diff review -- no prior-round-closed finding (Issues #90/#94/#95/#96/#97/#98/#99/#100/#101) reintroduced or weakened; new fixtureLocation parameter threaded through existing call sites purely additively.
6. [CLEAN][demonstrated] npm test independently re-run -- 550/0/0, matches build receipt exactly; isolated re-run of hooks/sessionstart-tool-enum-fixnow.test.ts -- 13/0/0, including all 3 new fixture-source tests.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=3 derived=0
checks="550/0/0|n/a"
adr=HIT(35)
report=docs/reviews/s5-fixnow-fixturesource-app-security-2026-09-07.md
