[app-security-reviewer]
🛡️ App Security Reviewer (Horus) — reviewing for exploitable weakness

# App-security review — `fixture-single-source-of-truth` (Issue #217)

- Tier: CRITICAL (Manager-ratified, not re-litigated). Branch `feat/fixture-single-source-of-truth`.
- HEAD: 3dc2a99 vs base 953b078 (`git diff 953b078..3dc2a99`, 16 files).
- ADR cache: `📊 ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] ... [CACHE=HIT]`.
- Applicable ADRs (security lane): SE ADR-0021 INT-07; project-tier THOTH-ADR-0001 (status `proposed`). No security ADR violation found (see F2).
- Out of scope by ruling: "adding a name silently suppresses its halt, no test fails" is the human-accepted consequence. Not reported.

## Verdict: APPROVE-WITH-CONDITIONS

No exploitable weakness introduced. The gate's runtime behavior is unchanged except for the removals the human ruled. Conditions are documentation-level and land on the still-`proposed` ADR.

Single next action: human rewords THOTH-ADR-0001 rules 4 and 5 (F1), then sets its status to `accepted` (F2) in this PR, before merge.

## Findings, ranked by exploitability x impact

### F1 [ISSUE][MED][code-traced] THOTH-ADR-0001 rules 4 and 5 are false or unverifiable as worded; the verification query is not committed
- Evidence:
  - Rule 4 ("No code under hooks/ or src/ MAY re-declare an entry from either list") is contradicted by shipped code: `src/policy/fixtures/allowlist-settings.ts:7` and `:18` declare `"github"` (a SUR-04 managed-MCP fixture). The 2026-09-19 decisions row concedes this ("a different allowlist"), so the ADR's own MUST NOT fails its own check.
  - Rule 5 ("no environment variable MAY choose which fixture file loads") is literally false: `hooks/sessionstart-tool-enum.mjs:283` resolves the fixture from `CLAUDE_PROJECT_DIR`. Probe: with `CLAUDE_PROJECT_DIR` pointing at a temp tree whose fixture lists `Evil Conn`, the connector is suppressed (no halt-state file). The seam is not session-reachable (drilled closed 2026-09-08, `docs/backlog.md:72`, `docs/STATE.md:365`), so the risk is the wording, not an exploit.
  - The ADR compliance-verification section points at a "single-source query recorded in docs/decisions.md's 2026-09-19 row". The row records a description ("14 names, 81 files, zero re-declarations"), not a runnable query. I reproduced 14 names; I could not reproduce 81 (I count 82 non-test files excluding `hooks/test-support`, 84 excluding only `*.test.ts`).
- Enforceability of the six rules:

| Rule | Mechanically enforced? |
|---|---|
| 1 scope | No (citation discipline) |
| 2 PR route | No: `master` has no protection, `rulesets` is `[]`, no CODEOWNERS (verified in F7) |
| 3 no "security control" wording | No instrument; nothing in shipped output currently violates it |
| 4 no re-declaration | No instrument; wording is already violated by `allowlist-settings.ts` |
| 5 loader throws / no env var | Partly: tests `S5-malformed-fixture` and `S5-R2-N1` (the latter covers one env var name only) |
| 6 end at S6 | No (no forcing function, by the human's design) |

- Attack sketch: none. Cost is a reviewer or agent who follows rule 4 literally and reports a false violation, or trusts rule 5 and skips the `CLAUDE_PROJECT_DIR` seam.
- Minimal fix: reword rule 4 to "this SUR-03 allowlist (docs/qa/s5-central-classification.json)" and rule 5 to "no dedicated environment variable; `CLAUDE_PROJECT_DIR` is the one project-root seam and the resolved path is recorded in halt-state". Commit the query as the failing test below.
- Failing test (maps 1:1): `THOTH-ADR-0001 R4: no name from s5-central-classification.json appears in a non-test file under hooks/ or src/ outside an enumerated exemption list`. It fails today on the `github` hits.
- Exposure: not applicable (documentation/enforceability, MED, not HIGH).

### F2 [SUSPICION][MED][derived] Permanent deviation from ADR-0021 INT-07 is in force under a `proposed` ADR
- Evidence: `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:4` has `status: proposed`; the ADR itself allows acceptance "in this PR or a follow-up commit". PRINCIPLES rule 9 ranks only accepted ADRs. Until accepted, the accepted INT-07 is the binding text and the standing exception has no ADR authority.
- Why not a blocker: derived (reasoned from ADR text), so capped at MED. ADR-0021's own text scopes INT-07 to a third-party plugin (REL-12), and the diff adds no posture-output control claim (grep of `src/` and `hooks/` finds `knownConnectors` only in the loader, the hook, and one unlock hint). The human directed the change.
- Minimal fix: the human sets `status: accepted` in this PR, so the exception is never standing under a non-binding ADR.
- No executable form (a human acceptance action); recorded here and in the merge handoff.

### F3 [ISSUE][LOW][code-traced] Connector unlock hint says "a reviewed, committed change" but review is not enforced
- Evidence: `hooks/userpromptsubmit-halt-relay.mjs:103`. The hint still names `docs/qa/s5-central-classification.json` and `knownConnectors` (probe P2 output). `master` is unprotected (F7), so "reviewed" holds by discipline only. The old clause ("fresh human-ratified docs/decisions.md row") was equally unenforced, so this is not a regression.
- Minimal fix (optional): drop "reviewed," or land the backlog item for branch protection/CODEOWNERS on `docs/qa/`.
- No executable form worth building (wording).

### F4 [CLEAN][demonstrated] Hooks diff: no behavior change beyond the ruling
- `git diff` line by line: `sessionstart-tool-enum.mjs` drops `isFixtureExpired`, the expiry branch, and one `reconcileReason`. Exit codes unchanged (SessionStart always 0; relay 2 on block; probe exit codes match). Halt-state top-level keys unchanged: `sessionId, reasons, fixtureSource, fixturePath` (probe P10). Reason-key set is now 3, and the key-parity test (#205) passes.
- `sanitizeDetail` and `quoteNames` intact. Probe P8 with a hostile connector name (embedded double quote, forged `Unrecognized tool:` line, newline, ESC, 300 chars): quote is backslash-escaped, control chars stripped, capped at 200 with `...[truncated]`, and the unlock hint still follows. Prototype-named servers (`constructor`, `toString`, `hasOwnProperty`, `__proto__`) halt.

### F5 [CLEAN][demonstrated] Trust boundary and Issue #99 protection re-verified with my own probes
- Who can change what the gate allows: anyone who can write `<CLAUDE_PROJECT_DIR>/docs/qa/s5-central-classification.json` (in-repo; disclosed residual, REQUIREMENTS section 0.4 property 2). No other channel:
  - P5: with `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH`, `THOTH_FIXTURE_PATH`, `THOTH_CENTRAL_CLASSIFICATION_FIXTURE`, `CLASSIFICATION_FIXTURE_PATH` all pointing at an attacker fixture listing `Evil Conn`, and no project fixture: the connector still halts; `fixtureSource=fallback-default`, `fixturePath=C:\playground\thoth\docs\qa\s5-central-classification.json`.
  - Legacy var with a project fixture present: still halts (`fixtureSource=project-relative`).
  - Fixture entries are exact-match strings: `*`, `.*`, case variants, and trailing-space variants of a listed name do not suppress.
- `S5-R2-N1` and the fixture-source tests are untouched in the diff.

### F6 [CLEAN][demonstrated] Fail-closed on malformed, legacy-field, and oddly-typed fixtures; stale retired halt key
- 11 malformed fixtures each yield `SUR-03-enumeration-failed`, relay exit 2: not JSON, empty, `null`, `[]`, missing `version`, `knownConnectors` as string / mixed types / object-with-length, bad tool class, non-string tool name, `__proto__` key without `knownConnectors`.
- Legacy `expiresOn: "2020-01-01"` plus `ratifiedBy: 5`: loads, ignored, listed connector stays suppressed (P3).
- Stale halt-state carrying `SUR-03-central-fixture-expired: set:true` (P7): SessionStart does not clear it (no owner for the key), the relay blocks (exit 2) with the raw key and the generic "inspect ... halt-state" unlock. Direction is fail-closed and the unlock is actionable. Exposure 0%: grep of the 8 real `.thoth/halt-state/*.json` finds no such key, and the timer never fired (expiry 2026-10-07).

### F7 [CLEAN][demonstrated] THOTH-ADR-0001 residual table is honest on the checkable points
- `gh api repos/mohannadrabie/thoth/branches/master/protection` -> `{"message":"Branch not protected",...,"status":"404"}`; `gh api repos/mohannadrabie/thoth/rulesets` -> `[]`; `gh api .../contents/.github/CODEOWNERS` -> 404; no CODEOWNERS in the working tree.
- `git log -1 83b6af9` -> `83b6af9 update connectors list` (the direct commit the table cites).
- Scope: the exception text confines itself to the two lists of the one file; no code or doc in the diff cites it for anything else. The "scratch-account drill outstanding" claim is supported by `docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md:209,296,413`.

### F8 [CLEAN][demonstrated] Secrets, completeness claims, tests
- `node src/secret-scan/history-scan.ts` -> exit 0 (only pre-existing ALLOWLISTED test fixtures). No secret-shaped literal in the added prose, ADR, decisions row, or CHANGELOG.
- `node src/qa/completeness-claim-checker.ts` -> `PASS: 2 file(s) checked, all completeness claims verified` (its default scope excludes `docs/decisions.md` and the ADR, so those were read by hand; see F1 for the one uncommitted-instrument claim).

## Blockers vs hardening

- Blockers: none.
- Hardening / conditions: F1 (reword rules 4 and 5, commit the query as a test), F2 (human accepts the ADR), F3 (optional wording).

## Open findings vs failing tests

- Open: 2 issues (F1, F3) + 1 suspicion (F2) = 3. Failing tests: 1 (F1). F2 is a human acceptance action and F3 is wording; neither has an executable form.

## Checks run (raw)

- Targeted: `node --test hooks/sessionstart-tool-enum-fixnow.test.ts hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts src/policy/tools/central-classification.test.ts` -> `tests 28 / pass 28 / fail 0 / cancelled 0 / skipped 0`.
- Full: `npm test` -> `tests 869 / pass 869 / fail 0 / cancelled 0 / skipped 0` (matches the CHANGELOG figure).
- Own probes (scratch dir, real hooks spawned against temp trees): 30+ cases, outputs summarized above. No repo source edited; working tree clean after runs.

## Editorial (verdict-neutral, plain edits)

- Decisions row 2026-09-19 (g): "81 files" not reproducible (82 or 84 by my two counts); state the query and its scope.
- `hooks/test-support/fixture-tree.ts:107` still says "SYNTHETIC/expired" (already disclosed in the CHANGELOG as `test-writer` scope).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] docs/adr/thoth-0001 rules 4/5 false or unverifiable as worded (src/policy/fixtures/allowlist-settings.ts:7,18 declares "github"; hooks/sessionstart-tool-enum.mjs:283 resolves via CLAUDE_PROJECT_DIR; query not committed) -- reword; commit the single-source query as a test
2. [SUSPICION][MED][derived] THOTH-ADR-0001 status proposed while the standing exception to INT-07 is already permanent -- human sets accepted in this PR
3. [ISSUE][LOW][code-traced] hooks/userpromptsubmit-halt-relay.mjs:103 hint says "reviewed, committed change"; master has no protection/CODEOWNERS -- drop "reviewed" or land the backlog item
4. [CLEAN][demonstrated] hooks diff: exit codes, halt-state schema, 3-key reason set, sanitizeDetail/quoteNames intact (hostile-name probe P8)
5. [CLEAN][demonstrated] Issue #99: 5 env-var names inert, fixture path recorded in halt-state, entries are exact-match only
6. [CLEAN][demonstrated] fail-closed: 11 malformed fixtures, legacy expiresOn/ratifiedBy ignored, stale retired reason key stays blocking with actionable generic unlock
7. [CLEAN][demonstrated] ADR residual table honest: master unprotected (404), rulesets [], no CODEOWNERS, 83b6af9 real, red-team drill claim sourced
8. [CLEAN][demonstrated] history-scan exit 0, completeness-claim-checker PASS, npm test 869/869/0/0
counts: issues=2 suspicions=1 clean=5
evidence: demonstrated=5 code-traced=2 derived=1
checks="869/0/0"
adr=HIT(36)
report=docs/reviews/fixture-single-source-of-truth-app-security-2026-09-19.md
