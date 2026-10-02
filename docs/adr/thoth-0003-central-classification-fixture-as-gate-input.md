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
    - "An entry in docs/qa/s5-central-classification.json, including its class label, MUST arrive through a pull request whose diff shows it; the merged diff is the approval (THOTH-ADR-0001 as amended, human ruling 2026-10-02). An entry or label change that places a tool in a class the PreToolUse gate allows, or otherwise lowers a gate outcome, MUST also arrive with a fresh dated review report in docs/reviews/ (Manager recommendation narrowing the human's 2026-09-19 ruling; confirmed or rejected by the human at acceptance); every other entry-only change keeps the 2026-09-19 exemption. An entry MUST NOT lower the class of a built-in tool; the catalog loader throws on that and the gate then fails closed."
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
- The pull request diff is the approval for an entry or label (ADR-0001 as amended, human ruling 2026-10-02). A change to the loader or the hooks that read the file still needs a fresh dated report.
- **Manager recommendation narrowing the human's 2026-09-19 ruling; confirmed or rejected by the human at acceptance:** the 2026-09-19 ruling (an entry-only PR needs no fresh dated report) no longer carries over unchanged. An entry or label change that places a tool in a class the gate allows, or otherwise lowers a gate outcome, needs a fresh dated review report in `docs/reviews/`. Every other entry-only change keeps the exemption. Reason: a class label now changes a gate outcome, which it did not when the exemption was granted.
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
- **MUST** route every entry and class label through a pull request whose diff shows it; the merged diff is the approval. **MUST** attach a fresh dated review report in `docs/reviews/` when an entry or label places a tool in a class the gate allows or otherwise lowers a gate outcome (Manager recommendation pending the human's confirmation at acceptance); every other entry-only change keeps the 2026-09-19 exemption. **MUST NOT** add an entry that lowers a built-in tool's class.
- **MUST** treat ADR-0001 rule 5 as binding SessionStart only. **MUST NOT** make the PreToolUse gate write to `.thoth/halt-state/` or anywhere else. **MUST** keep the gate failing closed (exit 2, fixed-text stderr) on a missing or malformed fixture, reading it only from its module-relative location. **MUST NOT** let any environment variable select the fixture file.
- **MUST NOT** let the gate read `knownConnectors`, and **MUST NOT** add a class label for a claude.ai connector to the fixture, before Issue #381 ships. **MUST NOT** describe `knownConnectors` as a security control or as verified identity.
- **MUST NOT** hardcode an entry name of either list in code under `hooks/` or `src/`; this includes test code. Tests **MUST** derive entry names from the fixture at run time. The only carve-outs are a synthetic name in a test's own temporary fixture and `src/policy/fixtures/allowlist-settings.ts`.
- **MUST** include `docs/qa/s5-central-classification.json` among the paths the gate's deny rules protect before the gate is wired in `.claude/settings.json`.
- **MUST NOT** ship #308 stories E, F or J, or the `.claude/settings.json` PreToolUse entry, before the human accepts this ADR. **MUST NOT** self-accept it.
- **MUST** supersede this ADR together with ADR-0001 when Issue #224's source ships.

# Residual risk (disclosed)

| Residual | Effect |
|---|---|
| A class label now affects a gate outcome; only a label that allows or lowers an outcome needs a fresh dated report | Any other entry change is approved by diff review alone, and the line between the two kinds is judged by the reviewer. `master` still has no branch protection or CODEOWNERS (ADR-0001 residual), so this holds by discipline |
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
- The standing exception now covers a control that can grant allow; allow-granting changes carry a heavier review, the rest keep the light one.

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
