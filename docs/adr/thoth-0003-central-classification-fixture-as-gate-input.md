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
    - "Precedence: this ADR replaces the sentence of THOTH-ADR-0001 rule 2 (and the matching sentence of its security constraint 2) that begins 'A pull request that only adds or removes an entry in that file MUST NOT be held for a fresh dated review report', as restated in the next constraint; it replaces THOTH-ADR-0001's residual row 'Inert classification'; it scopes THOTH-ADR-0001 rule 5 as stated below; it extends THOTH-ADR-0001 rule 4 to test code. Every other THOTH-ADR-0001 rule stands unchanged, and where the two disagree on those points this ADR governs."
    - "Every entry in docs/qa/s5-central-classification.json, including its class label, MUST arrive through a pull request whose diff shows it; the merged diff is the approval (human ruling 2026-10-02). Every entry ADDITION, and every label change that can change the gate's outcome for some call, MUST also arrive with a fresh dated review report in docs/reviews/; a removal keeps the 2026-09-19 exemption (Manager recommendation narrowing the human's 2026-09-19 ruling; confirmed or rejected by the human at acceptance). Under the current posture (rules [] and fallback allow) every addition is allow-granting. An entry MUST NOT lower the class of a built-in tool; the catalog loader throws on that and the gate then fails closed."
    - "THOTH-ADR-0001 rule 5 (record the resolved fixture path and source in halt-state) binds the SessionStart hook only. It does not bind the PreToolUse gate, which is write-free and MUST NOT write .thoth/halt-state/. The gate MUST still fail closed (exit 2, fixed-text stderr) when the fixture is missing or malformed, and MUST read the fixture only from its module-relative location, never from a path an environment variable selects."
    - "knownConnectors remains a SessionStart display-name list. Until Issue #381 ships, the gate MUST NOT read connector labels from it, no class label for a claude.ai connector MAY be added to the fixture, and it MUST NOT be described as a security control or as verified identity."
    - "Before the gate is wired in .claude/settings.json, docs/qa/s5-central-classification.json MUST be protected on every session write path: Bash and mcp__ calls by the gate's deny rules (story F), and the built-in file-editing tools (Edit, Write, MultiEdit, NotebookEdit) by a permissions.deny Edit(...) entry in .claude/settings.json, which ships with story K under the human's approval. The gate does not route the built-in file tools, so its deny rules cannot protect that path."
    - "Story F's protected-path list MUST name the fixture explicitly (it is read with readFileSync, not imported, so an import-graph scan cannot produce it), and a mutant test that removes the fixture's deny rule MUST fail."
    - "Hold: #308 stories E, F, J and K, and the .claude/settings.json PreToolUse entry, MUST NOT ship before the human accepts THOTH-ADR-0003; an agent MUST NOT self-accept it."
  code:
    - "Code under hooks/ and src/, test code included, MUST NOT hardcode an entry of either list in docs/qa/s5-central-classification.json as an entry of this allowlist; a test that asserts fixture behavior (a name is listed, classified or suppressed) MUST derive the name from the fixture at run time. Not violations: an unrelated use of the same string, a synthetic name in a test's own temporary fixture, and the SUR-04 settings fixture src/policy/fixtures/allowlist-settings.ts."
---

# THOTH-ADR-0003: The central-classification fixture is an input to the PreToolUse gate

- **Status:** Proposed (2026-10-02) by `story-implementer` (Ptah). Agents MUST NOT self-accept (SE ADR-0001); the human accepts or declines at the pull request. The ADR catalog (`docs/adr-cache.mjs`) serves a `proposed` ADR's rules exactly like an accepted one's (Issue #220), so readers check this field, not the catalog. Until the human accepts, #308 stories E, F, J and K MUST NOT ship (also a catalog-served constraint above). If the human declines, the pointer sentence on ADR-0001's Status bullet is reverted in the same change.
- **Date:** 2026-10-02
- **Deciders:** `mohannadrabie` ruled "amend THOTH-ADR-0001" on 2026-10-02 (`docs/decisions.md`, row "#308 activation: human rulings", item 1); `story-implementer` drafted this record.
- **Tier:** project (this repository only). Lives under `docs/adr/`, listed in `maat.json` `adr.dir`.
- **Relationship to THOTH-ADR-0001:** amends it in part. ADR-0001's Decision and Rules are not edited (SE ADR-0001: an accepted ADR's decision is never edited); its Status line points here. The exact displacements are in the "Precedence" constraint and the Decision below; every other ADR-0001 rule stands unchanged.
- **Status vocabulary:** SE ADR-0001 defines only `Superseded by ADR-NNNN`. "Amended in part by" is a project convention used because no org status covers a partial amendment; the human may instead ask for an org amendment of that vocabulary.

# Context

- THOTH-ADR-0001 scopes its exception to one purpose: suppressing the SessionStart (SUR-03) halt for named entries. Its rule 1 forbids citing the exception for any other control. Its residual-risk table calls the classification "inert" (Issue #93): a listed tool's `class` drives no decision.
- That stopped being true. The PreToolUse gate (`hooks/pretooluse-kernel-gate.mjs`) merges `centralLayer.tools` into the catalog it classifies MCP tools with (`src/policy/tools/classification-catalog.ts`, read from `moduleRelativeFixtureLocation()`). A class label can now change a gate outcome.
- ADR-0001 rule 5 requires the resolved fixture path and its source to be recorded in halt-state. The SessionStart hook can do that. The gate cannot: it is write-free (G18 in `src/policy/gate/gate-structure.test.ts` bans file-write APIs in the hook and `src/policy/gate/*`), and `.thoth/halt-state/` is a named sensitive area that sessions can read.
- ADR-0001 rule 4 forbids hardcoding an entry in `hooks/` or `src/` "for this allowlist". Whether test code is "code" was open (Q-C (e), `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md`).
- Under the current posture both `src/policy/config/shipped-defaults.json` and `.thoth/policy.json` carry `rules: []` and the fallback outcome is `allow` (`BOOTSTRAP_DEFAULT_OUTCOME`). An unlisted MCP server is denied only because its source is opaque (POL-05); a listed server, in any class, resolves to the default outcome, allow.
- The gate routes only `Bash` and `mcp__*` names (`src/policy/gate/tool-routing.ts`); it refuses every other tool name. Its deny rules therefore cannot see the built-in file-editing tools.
- Human rulings, 2026-10-02: the fixture becomes an official gate input; a label change still arrives only through a reviewed PR; rule 5 does not bind the write-free gate; tests derive entry names at run time. Later the same day the human dropped the connector labels until Issue #381, because a label on a connector name let a project MCP server named like it skip the SessionStart halt (Issue #385).

# Decision

- The fixture is an official input to the PreToolUse gate's tool classification. This extends ADR-0001's scope for that use of that file only.
- The pull request diff is the approval for an entry or label (human ruling 2026-10-02). A change to the loader or the hooks that read the file still needs a fresh dated report.
- **Manager recommendation narrowing the human's 2026-09-19 ruling; confirmed or rejected by the human at acceptance:** the 2026-09-19 ruling (an entry-only PR needs no fresh dated report) no longer carries over for additions.
  - Every entry addition, and every label change that can change the gate's outcome for some call, needs a fresh dated review report in `docs/reviews/`. A removal keeps the exemption (it can only turn a listed server back into an opaque, denied one).
  - Under the current posture every addition is allow-granting: it turns the POL-05 opaque-source deny of an unlisted server into the default outcome, allow. The class name (`remote-mutating` included) does not change that.
  - `CLAUDE.md`'s "Policy delivery / config surface" sentence still exempts additions until the human edits it after acceptance; this ADR outranks it (PRINCIPLES.md rule 9) once accepted.
- An entry cannot lower a built-in's class: `assembleCatalog` throws, the gate exits 2 with the fixed classification unlock text (#308 story H).
- Rule 5 is scoped, not removed:
  - It binds SessionStart. It records the path and source in halt-state as ADR-0001 requires.
  - It does not bind the gate. The gate has no write access by design, and a write would add a write surface to the enforcement point.
  - "Never silent" is met for the gate by blocking: a missing or malformed fixture exits 2 with fixed text. The path needs no record because it is a constant of the shipped module (`moduleRelativeFixtureLocation`), not a value a session can influence.
  - The rest of rule 5 still binds both consumers: the loader throws on malformed input; no environment variable selects the fixture file (Issue #99).
- Rule 4 keeps ADR-0001's text, including "for this allowlist", and adds one clarification: test code is code. A test that asserts fixture behavior derives the name from the fixture at run time. Not violations: an unrelated use of the same string, a synthetic name in a test's own temporary fixture, and the SUR-04 settings fixture (a different allowlist).
  - Conformance triage of the existing sites (query: every quoted literal of the fixture's names under `hooks/` and `src/`, tests included; reviewers' scans found 6 files). None is a violation, so no test is edited and no follow-up is needed for story E:

    | Site | Use | Violation? |
    |---|---|---|
    | `src/qa/vendor-tool-inventory.test.ts:84` (`claude.ai Gmail`) | a synthetic init event fed to the scrubber; never asserted against the fixture | No |
    | `src/policy/tools/mcp-enumeration.test.ts:62,96` (`github`) | a synthetic `.mcp.json` fed to `extractMcpServerNames`; asserts name extraction, not classification | No |
    | `src/policy/verification/allowlist.test.ts:48` (`github`) | the SUR-04 managed-MCP allowlist | No (a different allowlist) |
    | `src/secret-scan/history-scan.test.ts:727`, `src/secret-scan/patterns.test.ts:78` (`github`) | the `github_pat_` token prefix | No (unrelated string) |
    | `src/policy/fixtures/allowlist-settings.ts` (`github`) | the SUR-04 settings fixture | No (named carve-out) |

  - A site that later asserts what the fixture lists or classifies with a hardcoded name is a violation and goes to story E's review.
- INT-07 (SE ADR-0021): the gate classifies by server name, a string the project's `.mcp.json` chooses. It is not verified identity. ADR-0001's INT-07 exception, justified for suppressing a halt, is extended here to a path that can grant allow, on the same conservative reading: the exception stays bounded by ADR-0001 rule 3 and by the reviewed-PR control, and the name spoofability is disclosed in the residual table, not hidden.
- `knownConnectors` stays a SessionStart display-name list; the gate does not read it and no connector class label exists until Issue #381. Rule 3 of ADR-0001 stands.
- "Read freely, protect the gate": before the gate is wired, the fixture is protected on every session write path.
  - Bash and `mcp__` calls: the gate's deny rules (story F).
  - Built-in file tools (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`): a `permissions.deny` `Edit(...)` entry in `.claude/settings.json` (Claude Code applies Edit rules to all built-in tools that edit files). It ships with story K under the human's approval. The gate cannot cover this path because it refuses every tool name other than `Bash` and `mcp__*`.
  - Story F's protected list names the fixture explicitly, since the fixture is read, not imported; a mutant test that drops its deny rule must fail.
  - Neither mechanism alone makes the file unwritable by a session. Both together close the session write paths this ADR knows of; a human changes the file through a reviewed PR.
- ADR-0001's removal trigger stands and covers this ADR: when an out-of-repo classification source ships (Issue #224), this ADR and ADR-0001 are superseded together, and this ADR MUST NOT be extended to cover that source.
- ADR-0001's residual row "Inert classification" is superseded by this ADR: `centralLayer.tools[].class` drives the gate's classification of MCP tools.

# Rules for agents

- **MUST** limit the widening to the gate's use of `centralLayer.tools` in `docs/qa/s5-central-classification.json` as an enforcement input for tool classification. **MUST NOT** cite this ADR or ADR-0001 to justify any other allowlist, file, or control.
- **MUST** treat this ADR as replacing the sentence of ADR-0001 rule 2 that begins "A pull request that only adds or removes an entry in that file MUST NOT be held for a fresh dated review report", and as replacing ADR-0001's residual row "Inert classification"; every other ADR-0001 rule stands. Where the two disagree on those points, this ADR governs.
- **MUST** route every entry and class label through a pull request whose diff shows it; the merged diff is the approval. **MUST** attach a fresh dated review report in `docs/reviews/` for every entry addition and every label change that can change the gate's outcome for some call (Manager recommendation pending the human's confirmation at acceptance); a removal keeps the 2026-09-19 exemption. **MUST NOT** add an entry that lowers a built-in tool's class.
- **MUST** treat ADR-0001 rule 5 as binding SessionStart only. **MUST NOT** make the PreToolUse gate write to `.thoth/halt-state/` or anywhere else. **MUST** keep the gate failing closed (exit 2, fixed-text stderr) on a missing or malformed fixture, reading it only from its module-relative location. **MUST NOT** let any environment variable select the fixture file.
- **MUST NOT** let the gate read `knownConnectors`, and **MUST NOT** add a class label for a claude.ai connector to the fixture, before Issue #381 ships. **MUST NOT** describe `knownConnectors` as a security control or as verified identity.
- **MUST NOT** hardcode an entry of either list as an entry of this allowlist in code under `hooks/` or `src/`; this includes test code. A test that asserts fixture behavior **MUST** derive the name from the fixture at run time. Not violations: an unrelated use of the same string, a synthetic name in a test's own temporary fixture, and `src/policy/fixtures/allowlist-settings.ts`.
- **MUST** protect `docs/qa/s5-central-classification.json` on every session write path before the gate is wired in `.claude/settings.json`: the gate's deny rules for Bash and `mcp__` calls (story F), and a `permissions.deny` `Edit(...)` entry for the built-in file tools (ships with story K under the human's approval). **MUST NOT** state or imply that the gate's deny rules alone make the file unwritable.
- **MUST** name the fixture explicitly in story F's protected-path list, and **MUST** include a mutant test that removes the fixture's deny rule and fails.
- **MUST NOT** ship #308 stories E, F, J or K, or the `.claude/settings.json` PreToolUse entry, before the human accepts this ADR. **MUST NOT** self-accept it.
- **MUST** supersede this ADR together with ADR-0001 when Issue #224's source ships.

# Residual risk (disclosed)

| Residual | Effect |
|---|---|
| Same-session content tampering | The gate reads the fixture on every call, so a well-formed in-session edit (for example adding a server entry) takes effect on the next gate call. Nothing records it: the gate writes nothing, and SessionStart records the path and source once, with no content hash. The two protections above (gate deny rules, `permissions.deny` `Edit(...)`) are the only controls, and they are not yet in place |
| Name spoofability (INT-07) | The gate classifies by server name, which the project's `.mcp.json` chooses, so a server named like an entry inherits its class. Under default allow, nothing but the deny rules of stories E and F stops it. ADR-0001's display-name row, now on a path that grants allow |
| The reviewed-PR trigger rests on a Manager recommendation | Until the human confirms it, ADR-0001's exemption for additions stands in `CLAUDE.md`; `master` has no branch protection or CODEOWNERS (ADR-0001 residual), so the review holds by discipline |
| In-repo policy source | Unchanged from ADR-0001: a session with commit access can edit the file; the protections above narrow this for a wired gate but are not property 2 of REQUIREMENTS.md §0.4 |
| Gate and SessionStart read the file by different locations (module-relative vs project-relative) | Two copies could disagree if the plugin is installed outside the project; the shared-inventory agreement test (story C) covers this repository only |
| No halt-state record for a gate-side fixture failure | The only trace is stderr text and exit 2 |

- **Owner:** `mohannadrabie`. **Removal trigger:** Issue #224 ships.

# Consequences

## Positive
- The gate can classify MCP tools from one reviewed file; activation (#308) is no longer blocked by a scope gap.
- The no-hardcode rule has a testable reading for tests, with the existing sites triaged.

## Negative
- ADR-0001's accepted text no longer describes the whole rule set alone; readers must read both.
- The standing exception now covers a control that can grant allow; every addition carries a heavier review (pending the human's confirmation) and the fixture needs two protections, one of which waits for story K.

# Alternatives considered

1. **Edit ADR-0001 in place.** Rejected: SE ADR-0001 forbids editing an accepted ADR's decision.
2. **Amend an org ADR in the `adr/` submodule.** Rejected: the rules are ADR-0001's, a project ADR; no org rule changes.
3. **Make the gate write its path to halt-state.** Rejected: adds a write to the enforcement point and widens a sensitive area for no added security.
4. **Drop rule 4.** Rejected by the human's ruling: the rule stands for production and test code.
5. **Route the built-in file tools through the gate.** Rejected here: it widens the gate's routing, a change to a named sensitive surface that this ADR does not need; the `permissions.deny` entry covers the path.

# Compliance verification

- Automated (existing): `src/policy/tools/central-classification.test.ts`; `hooks/sessionstart-tool-enum-fixnow.test.ts`; `src/policy/gate/gate-structure.test.ts` (G18, no file-write API in the gate; G19, test files derive fixture names for the files it lists).
- Required at story F (not yet built): the protected-path list names the fixture explicitly, and a mutant test that deletes the fixture's deny rule fails (`F3-mutant-drop-fixture-deny`).
- Manual: the single-source query recorded in ADR-0001's "Compliance verification" (non-test hits only); the conformance triage above for tests; reviewers read each fixture diff and check the report requirement for additions.

# References

- `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md`
- `docs/decisions.md`: 2026-10-02 rows "#308 activation: human rulings" and "#308 stories C and H: connector labels dropped"
- `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` (Q-C)
- `adr/software-engineering/0001-record-architecture-decisions.md`; `adr/software-engineering/0021-thoth-native-architecture.md` (INT-07, POL-05)
- Issues #93, #99, #224, #381, #385, #390 to #395
