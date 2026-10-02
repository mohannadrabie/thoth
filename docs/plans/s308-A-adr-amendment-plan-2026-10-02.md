# Phase 1 plan: #308 story A (AP-7), amend THOTH-ADR-0001 via a new project ADR

Date: 2026-10-02. Author: story-implementer (Ptah). Phase 1 only: nothing built, nothing committed; this file is the only file written.
Branch `s308/activation-2` (from origin/master 35f49e9).
`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog - ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`

## 0. Readiness

READY. The human ruled on 2026-10-02 (decisions row "#308 activation: human rulings", item 1): amend THOTH-ADR-0001. All content is fixed by that row, the Phase 0 plan story A, Q-C (a)-(e) in `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md`, and the later row that dropped connector labels (Issue #385). No blocking question. Three non-blocking confirmations are in section 9.

## 1. ADR review

| ADR | Verdict | Rule this story honors |
|---|---|---|
| SE ADR-0001 (lifecycle) | APPLICABLE | "MUST NOT modify the Decision section of an `Accepted` ADR; write a superseding ADR instead and set the old status to `Superseded by ADR-NNNN`." and "agents MUST NOT self-accept ADRs." |
| THOTH-ADR-0001 | APPLICABLE (the subject) | Rule 1 (scope: "MUST NOT be cited to justify any other allowlist, file, or control"), rule 4 ("MUST NOT hardcode an entry of either list in hooks/ or src/"), rule 5 (path "MUST be recorded in halt-state"), rule 6 (ends when #224 ships). Edited only in its Status bullet. |
| THOTH-ADR-0002 | APPLICABLE (precedent) | Project ADR committed with status `proposed`, same frontmatter shape; the cache serves it. Template for this draft. |
| SE ADR-0021 (INT-07, POL-12, REL-12) | APPLICABLE | INT-07: "No control named in thoth's posture output may rest on an unverified third party's claim about its own behavior". The new ADR keeps `knownConnectors` out of any control claim. |
| SE ADR-0005, ADR-0010 | NOT-APPLICABLE | No test is deleted or replaced by this story (docs only). |
| Remaining SE and all devops ADRs | NOT-APPLICABLE | No infra, API or data surface. |

## 2. Findings on the Manager's mechanism (confirm / challenge)

| Question | Finding |
|---|---|
| New project ADR plus pointer line on ADR-0001 | CONFIRMED. SE ADR-0001 line 41 forbids editing the Decision of an Accepted ADR and names "write a superseding ADR". `/maat:adr-amend`'s project-tier text says "amends in place on the current branch" (the plugin's adr-amend command description, line 2); that sentence is the plugin's convenience wording and an accepted ADR outranks it (PRINCIPLES.md rule 9). A new ADR is the only reading that satisfies both. |
| Is the pointer line allowed? | YES, with a limit. SE ADR-0001 expressly permits setting the old ADR's status line to `Superseded by ADR-NNNN`. This is a partial amendment, so the pointer reads "Accepted; amended in part by THOTH-ADR-0003 (proposed)". Edit is confined to the `- **Status:**` bullet body. Frontmatter `status: accepted` stays (the catalog parses it), as do the Decision, Rules and constraints. A5-check below proves the diff is one hunk in that bullet. |
| Submodule PR, criterion A3 | N/A. THOTH-ADR-0001 lives in `docs/adr/` (project tier, "Lives under docs/adr/, listed in maat.json adr.dir"). No `adr/` submodule PR, no pointer bump. `git submodule status` is unchanged and a check below confirms it. The Phase 0 line "story A is a PR to the adr/ submodule repo" is withdrawn. |
| `maat.json` change for a new file in `docs/adr` | NOT NEEDED. `maat.json` already lists `docs/adr` in `adr.dir`; `docs/adr-cache.mjs` walks each root with `readdirSync` recursively (line 60) and the status line today reads `docs/adr:2`. Expected after build: `docs/adr:3`, 38 ADRs. Checked by the build step. |
| Catalog serves `proposed` like `accepted` (Issue #220, quoted in ADR-0001/0002 Status bullets) | CONSEQUENCE TO FLAG. From the moment 0003 merges, agents reading the catalog see 0003's rules next to 0001's. Draft therefore states precedence explicitly (0003 governs only where it names a rule; all else in 0001 stands) and states that story E (baseline rules) and story J MUST NOT ship before the human accepts 0003 (not merely before it merges). Phase 0's "A merged" gate for E is tightened to "A accepted". |

## 3. Restatement

Draft THOTH-ADR-0003 (status `proposed`) that amends THOTH-ADR-0001 in part so the classification fixture `docs/qa/s5-central-classification.json` may be an official input to the PreToolUse gate, with a one-line pointer on ADR-0001. Agents do not accept it.

## 4. Risk tier

CRITICAL (proposed; Manager ratifies). One line: it widens the scope of a standing security exemption (policy delivery, a named sensitive area), and by PRINCIPLES.md rule 9 the text outranks CLAUDE.md for every later story (E, F, J). Docs-only blast radius, but it is the authority the gate wiring stands on. Reviewers: `architecture-reviewer` (domain, A2 narrowing), `red-team` (adversarial read of the new MUST/MUST NOT text for loopholes), plus `cross-domain-reviewer` (whole catalog, always joins). Per the cap in rule 9 the pair domain+red-team is two; cross-domain does not count.

## 5. Acceptance criteria and checks

Each check is named. `NEW` checks are one-off scripts run in the scratchpad and pasted as raw output into the PR; none is committed (no production behavior to pin).

| # | Criterion | Derived? | Check |
|---|---|---|---|
| A1a | Draft states the fixture is an official gate input (enforcement input for the PreToolUse gate's tool classification) | from ruling 1 | NEW `A1-markers`: script reads the ADR's Decision and Rules and asserts a rule containing "enforcement input" and "PreToolUse" |
| A1b | A label or entry change arrives only through a reviewed PR; the merged diff is the approval | ruling 1 | `A1-markers`: rule containing "pull request" and "merged" |
| A1c | Rule 5 (halt-state path recording) does not bind the write-free gate, binds SessionStart only; reasons stated | ruling 1 | `A1-markers`: rule containing "SessionStart" and "write-free"; Human read of the stated reasons |
| A1d | Tests derive entry names from the fixture at run time (Q-C (e)) | ruling 1 | `A1-markers`: rule containing "at run time" and "test" |
| A1e | The ADR parses: rules block present, `status: proposed`, 38 ADRs, root `docs/adr:3` | | `node docs/adr-cache.mjs --ensure` (surface the line), then NEW `A1-catalog`: read `adrCatalog.adrs`, find `THOTH-ADR-0003`, assert `status == "proposed"`, `rules.length >= 1`, `applicableTo` non-empty |
| A2 | "MUST NOT hardcode an entry" is narrowed, not dropped | derived (Phase 0 A2) | Diff review by `architecture-reviewer`; `A1-markers` asserts the string "MUST NOT hardcode" is in 0003's Rules; the carve-outs are an enumerated closed list (two items) |
| A3 | N/A: no submodule PR, no pointer bump. Replaced by: the `adr/` submodule is untouched | Manager correction | `git submodule status` output identical before and after; `git diff --stat -- adr` empty |
| A4 | Status is `proposed` everywhere; nothing self-accepted | SE ADR-0001 | `A1-markers`: frontmatter `status: proposed` and the Status bullet begins "Proposed"; `git diff` on ADR-0001 contains no `status:` frontmatter line |
| A5 | ADR-0001 edit is a Status-bullet pointer only | derived | NEW `A5-pointer-only`: `git diff -U0 -- docs/adr/thoth-0001-...md` shows exactly one hunk, within the `- **Status:**` bullet; no line from the frontmatter, Decision, Rules, or Residual sections changed |
| A6 | Reconciles the human rulings: connector labels dropped until #381 (so `knownConnectors` is SessionStart-only and not a gate input), and "read freely, protect the gate" (fixture is a deny-protected path once the gate is wired, story F) | derived, load-bearing for reviewers | `A1-markers`: rules containing "knownConnectors" and "#381", and "deny"; `architecture-reviewer` read |
| A7 | New doc citations resolve; no secret-scan hit | project gate | `node src/qa/reference-resolver.ts origin/master HEAD` (QA-14 diff mode, per memory note), and the OSS-01 pre-commit scan at commit time |
| A8 | Review chain complete | | fresh reports in `docs/reviews/` from `architecture-reviewer`, `red-team`, `cross-domain-reviewer` |

## 6. Constraints and sensitive areas

- Sensitive: policy delivery / config surface (the ADR governs it). Reports needed: `architecture-reviewer`, `red-team`, `cross-domain-reviewer`.
- CLAUDE.md hard rules: no gold-plating (no code, no test, no fixture edit, no CLAUDE.md edit); completeness claims come from scripts (the markers and catalog scripts above; no hand-typed "all N rules" in the ADR prose).
- Human-only: acceptance of 0003, merge. The draft says so and the PR skeleton repeats it.
- No `/maat:adr-amend` org-tier steps (submodule branch, 14-day review-back in the submodule) apply. The 14-day review-back date is not set here; ADR-0001's own removal trigger (#224) carries over.

## 7. Plan

Files (exact):

| File | Change |
|---|---|
| `docs/adr/thoth-0003-central-classification-fixture-as-gate-input.md` | NEW. Text in section 8. |
| `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md` | One edit: append to the `- **Status:**` bullet a sentence: "Amended in part by THOTH-ADR-0003 (proposed 2026-10-02): rules 1, 4 and 5 are narrowed or scoped there; read both. Frontmatter status and every rule below stay as accepted." No other line. |
| `docs/decisions.md`, `CHANGELOG.md`, `docs/STATE.md` | Bookkeeping at Phase 2 by the owner of those files (new row: story A drafted, proposed, human acceptance pending; nothing here edits them now). Append-only collision risk with the story B planner: do these last, on merge of origin/master. |

Not touched: `maat.json`, `docs/adr-cache.mjs`, `adr/`, `CLAUDE.md` (its "Policy delivery" bullet cites ADR-0001; whether to add a pointer to 0003 after acceptance is a Manager call, listed in section 9), any code or test.
`docs/.maat-state.json` is rewritten by the cache build (catalog and fingerprint); expect that diff.

Build steps (Phase 2): write the new ADR; make the single Status edit; run `node docs/adr-cache.mjs --ensure` (twice: MISS then HIT); run `A1-markers`, `A1-catalog`, `A5-pointer-only`, the submodule checks, QA-14 diff mode; open the PR skeleton; dispatch the review chain.

Rollout and rollback: no runtime effect (docs). Rollback: revert the commit; ADR-0001 is unchanged apart from one sentence. If the human declines, status becomes `rejected` by the human and story E stays blocked.

## 8. Test-first dispatch check

No new or changed UI flow or API surface; documentation only. `test-writer` is NOT dispatched. Phase 2 may start straight from this plan once the Manager ratifies the tier and the text.

## 9. Questions (none blocking), and spike check

No unmeasured number is in the plan, so no spike (rules 17/18 not triggered). Confirmations for the Manager:

1. Q-C (e): the draft answers "yes, test code counts as code" (tests derive names from the fixture at run time), with the narrowing carve-outs in section 8. Confirm.
2. The 2026-09-19 human ruling (an entry-only PR needs no fresh dated report) is kept, per the 2026-10-02 ruling. Once an entry's `class` drives a gate outcome, that is a weaker control than before; the draft records it as a disclosed residual rather than changing the ruling. Confirm, or ask the human whether allow-granting classes need a report.
3. After acceptance, add a one-line pointer to 0003 in CLAUDE.md's "Policy delivery / config surface" bullet? Outside this story's files; Manager's call.

## 10. Draft ADR text (verbatim, to be written to `docs/adr/thoth-0003-central-classification-fixture-as-gate-input.md`)

````markdown
---
id: THOTH-ADR-0003
title: Amendment to THOTH-ADR-0001 - the central-classification fixture is an input to the PreToolUse gate (docs/qa/s5-central-classification.json)
status: proposed
date: 2026-10-02
applicableTo:
  - security
  - architecture
  - code
constraints:
  security:
    - "The PreToolUse gate MAY read docs/qa/s5-central-classification.json as an enforcement input for its tool classification (the centralLayer.tools list merged into the gate's catalog). This widens THOTH-ADR-0001 rule 1 for that one use of that one file; it MUST NOT be cited to justify any other allowlist, file, or control."
    - "An entry in docs/qa/s5-central-classification.json, including its class label, MUST arrive through a pull request whose diff shows it; the merged diff is the approval (THOTH-ADR-0001 as amended, human ruling 2026-10-02). An entry MUST NOT lower the class of a built-in tool; the catalog loader throws on that and the gate then fails closed."
    - "THOTH-ADR-0001 rule 5 (record the resolved fixture path and source in halt-state) binds the SessionStart hook only. It does not bind the PreToolUse gate, which is write-free and MUST NOT write .thoth/halt-state/. The gate MUST still fail closed (exit 2, fixed-text stderr) when the fixture is missing or malformed, and MUST read the fixture only from its module-relative location, never from a path an environment variable selects."
    - "knownConnectors remains a SessionStart display-name list. Until Issue #381 ships, the gate MUST NOT read connector labels from it, no class label for a claude.ai connector MAY be added to the fixture, and it MUST NOT be described as a security control or as verified identity."
    - "Once the gate is wired, docs/qa/s5-central-classification.json MUST be among the paths the gate's deny rules protect (the 'read freely, protect the gate' baseline, human ruling 2026-10-02; rules owned by #308 story F)."
  code:
    - "Code under hooks/ and src/, test code included, MUST NOT hardcode an entry name of either list in docs/qa/s5-central-classification.json. Tests MUST derive entry names from the fixture at run time. Two carve-outs only: a synthetic name a test writes into its own temporary fixture, and the SUR-04 managed-MCP settings fixture src/policy/fixtures/allowlist-settings.ts."
---

# THOTH-ADR-0003: The central-classification fixture is an input to the PreToolUse gate

- **Status:** Proposed (2026-10-02) by `story-implementer` (Ptah). Agents MUST NOT self-accept (SE ADR-0001); the human accepts or declines at the pull request. The ADR catalog (`docs/adr-cache.mjs`) serves a `proposed` ADR's rules exactly like an accepted one's (Issue #220), so readers check this field, not the catalog. Until the human accepts, #308 stories E, F and J MUST NOT ship.
- **Date:** 2026-10-02
- **Deciders:** `mohannadrabie` ruled "amend THOTH-ADR-0001" on 2026-10-02 (`docs/decisions.md`, row "#308 activation: human rulings", item 1); `story-implementer` drafted this record.
- **Tier:** project (this repository only). Lives under `docs/adr/`, listed in `maat.json` `adr.dir`.
- **Relationship to THOTH-ADR-0001:** amends it in part. ADR-0001's Decision and Rules are not edited (SE ADR-0001: an accepted ADR's decision is never edited); its Status line points here. Where this ADR names a rule, it governs that rule; every other ADR-0001 rule stands unchanged.

# Context

- THOTH-ADR-0001 scopes its exception to one purpose: suppressing the SessionStart (SUR-03) halt for named entries. Its rule 1 forbids citing the exception for any other control. Its residual-risk table calls the classification "inert" (Issue #93): a listed tool's `class` drives no decision.
- That stopped being true. The PreToolUse gate (`hooks/pretooluse-kernel-gate.mjs`) merges `centralLayer.tools` into the catalog it classifies MCP tools with (`src/policy/tools/classification-catalog.ts`, read from `moduleRelativeFixtureLocation()`). A class label can now change a gate outcome.
- ADR-0001 rule 5 requires the resolved fixture path and its source to be recorded in halt-state. The SessionStart hook can do that. The gate cannot: it is write-free (its header and the AC-3h / AC-3 member-write allow-list, which is exactly empty), and `.thoth/halt-state/` is a named sensitive area that sessions can read.
- ADR-0001 rule 4 forbids hardcoding an entry in `hooks/` or `src/`. Whether test code is "code" was open (Q-C (e), `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md`).
- Human rulings, 2026-10-02: the fixture becomes an official gate input; a label change still arrives only through a reviewed PR; rule 5 does not bind the write-free gate; tests derive entry names at run time. Later the same day the human dropped the connector labels until Issue #381, because a label on a connector name let a project MCP server named like it skip the SessionStart halt (Issue #385).

# Decision

- The fixture is an official input to the PreToolUse gate's tool classification. This extends ADR-0001's scope for that use of that file only.
- Review is unchanged: the pull request diff is the approval for an entry or label (ADR-0001 as amended; human ruling 2026-09-19 that an entry-only PR needs no fresh dated report stays in force). A change to the loader or the hooks that read the file still needs a fresh dated report.
- An entry cannot lower a built-in's class: `assembleCatalog` throws, the gate exits 2 with the fixed classification unlock text (#308 story H).
- Rule 5 is scoped, not removed:
  - It binds SessionStart. It records the path and source in halt-state as ADR-0001 requires.
  - It does not bind the gate. The gate has no write access by design, and a write would add a member-write surface to the enforcement point.
  - "Never silent" is met for the gate by blocking: a missing or malformed fixture exits 2 with fixed text. The path needs no record because it is a constant of the shipped module (`moduleRelativeFixtureLocation`), not a value a session can influence.
  - The rest of rule 5 still binds both consumers: the loader throws on malformed input; no environment variable selects the fixture file (Issue #99).
- Rule 4 is narrowed, not dropped:
  - It still forbids hardcoding any entry name of either list in production code under `hooks/` and `src/`.
  - It now also states that test code is code: tests derive entry names from the fixture at run time.
  - Two carve-outs, a closed list: a synthetic name a test writes into its own temporary fixture (it is not an entry of the real lists), and the SUR-04 settings fixture (a different allowlist).
- `knownConnectors` stays a SessionStart display-name list; the gate does not read it and no connector class label exists until Issue #381. Rule 3 of ADR-0001 stands.
- "Read freely, protect the gate": once the gate is wired, the fixture is a protected path in the gate's deny rules (story F). A session cannot write the file; a human changes it through a reviewed PR.
- ADR-0001's removal trigger stands and covers this ADR: when an out-of-repo classification source ships (Issue #224), this ADR and ADR-0001 are superseded together, and this ADR MUST NOT be extended to cover that source.
- ADR-0001's residual row "Inert classification" is superseded by this ADR: `centralLayer.tools[].class` drives the gate's classification of MCP tools.

# Rules for agents

- **MUST** limit the widening to the gate's use of `centralLayer.tools` in `docs/qa/s5-central-classification.json` as an enforcement input for tool classification. **MUST NOT** cite this ADR or ADR-0001 to justify any other allowlist, file, or control.
- **MUST** route every entry and class label through a pull request whose diff shows it; the merged diff is the approval. **MUST NOT** add an entry that lowers a built-in tool's class.
- **MUST** treat ADR-0001 rule 5 as binding SessionStart only. **MUST NOT** make the PreToolUse gate write to `.thoth/halt-state/` or anywhere else. **MUST** keep the gate failing closed (exit 2, fixed-text stderr) on a missing or malformed fixture, reading it only from its module-relative location. **MUST NOT** let any environment variable select the fixture file.
- **MUST NOT** let the gate read `knownConnectors`, and **MUST NOT** add a class label for a claude.ai connector to the fixture, before Issue #381 ships. **MUST NOT** describe `knownConnectors` as a security control or as verified identity.
- **MUST NOT** hardcode an entry name of either list in code under `hooks/` or `src/`; this includes test code. Tests **MUST** derive entry names from the fixture at run time. The only carve-outs are a synthetic name in a test's own temporary fixture and `src/policy/fixtures/allowlist-settings.ts`.
- **MUST** include `docs/qa/s5-central-classification.json` among the paths the gate's deny rules protect before the gate is wired in `.claude/settings.json`.
- **MUST NOT** ship #308 stories E, F or J, or the `.claude/settings.json` PreToolUse entry, before the human accepts this ADR. **MUST NOT** self-accept it.
- **MUST** supersede this ADR together with ADR-0001 when Issue #224's source ships.

# Residual risk (disclosed)

| Residual | Effect |
|---|---|
| A class label now affects a gate outcome, while an entry-only PR still needs no fresh dated report | A reviewer reading only the fixture diff can approve a label that grants a less restrictive class; the diff review is the only control. `master` still has no branch protection or CODEOWNERS (ADR-0001 residual), so this holds by discipline |
| In-repo policy source | Unchanged from ADR-0001: a session with commit access can edit the file; the deny rule (story F) narrows this for a wired gate but is not property 2 of REQUIREMENTS.md §0.4 |
| Gate and SessionStart read the file by different locations (module-relative vs project-relative) | Two copies could disagree if the plugin is installed outside the project; the shared-inventory agreement test (story C) covers this repository only |
| No halt-state record for a gate-side fixture failure | The only trace is stderr text and exit 2 |

- **Owner:** `mohannadrabie`. **Removal trigger:** Issue #224 ships.

# Consequences

## Positive
- The gate can classify MCP tools from one reviewed file; activation (#308) is no longer blocked by a scope gap.
- The no-hardcode rule is precise for tests, so a reviewer has a testable reading.

## Negative
- ADR-0001's accepted text no longer describes the whole rule set alone; readers must read both.
- The standing exception now covers a control that can grant allow, with the same light review.

# Alternatives considered

1. **Edit ADR-0001 in place.** Rejected: SE ADR-0001 forbids editing an accepted ADR's decision.
2. **Amend an org ADR in the `adr/` submodule.** Rejected: the rules are ADR-0001's, a project ADR; no org rule changes.
3. **Make the gate write its path to halt-state.** Rejected: adds a write to the enforcement point and widens a sensitive area for no added security.
4. **Drop rule 4.** Rejected by the human's ruling ("narrowed"): the rule stands for production and test code.

# Compliance verification

- Automated (existing): `src/policy/tools/central-classification.test.ts`; `hooks/sessionstart-tool-enum-fixnow.test.ts`; the gate structure tests (member-write allow-list exactly empty, AC-3h).
- Manual: the single-source query recorded in ADR-0001's "Compliance verification" (non-test hits only); reviewers read each fixture diff. A test that reads entry names from the fixture is checked by review, not by a test that fails on coincidental matches.

# References

- `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md`
- `docs/decisions.md`: 2026-10-02 rows "#308 activation: human rulings" and "#308 stories C and H: connector labels dropped"
- `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` (Q-C)
- `adr/software-engineering/0001-record-architecture-decisions.md`; `adr/software-engineering/0021-thoth-native-architecture.md` (INT-07)
- Issues #93, #99, #224, #381, #385
````

## 11. Next single action

Manager ratifies the tier (CRITICAL) and the draft text, answers section 9 items 1 and 2, then approves Phase 2 for story A. The human accepts 0003 later, outside this story.

Phase 1 only (plan ready, no build). The receipt enum has no plan-ready value; BLOCKED here means "build not started, awaiting Manager ratification", not a defect.

RECEIPT: verdict=BLOCKED criteria="12 mapped/12 total" checks="0/0/0" adr=HIT(37) pr=n/a

## 12. Phase 2 addendum and open items for the human

- Manager rulings applied: tier CRITICAL; test code is code (carve-outs stand); no CLAUDE.md edit.
- Open item for the human at acceptance: confirm or reject the Manager recommendation narrowing the 2026-09-19 ruling (an entry or label that places a tool in a gate-allowed class, or otherwise lowers a gate outcome, needs a fresh dated report in docs/reviews/; other entry-only changes keep the exemption). Written into the ADR Decision, Rules and residual row.
- Open item for the human: accept or decline THOTH-ADR-0003; stories E, F, J and the settings entry wait for that.
- Open item for the human, after acceptance: whether CLAUDE.md's "Policy delivery / config surface" bullet gets a pointer to 0003.
