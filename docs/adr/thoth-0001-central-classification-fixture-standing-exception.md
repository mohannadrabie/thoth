---
id: THOTH-ADR-0001
title: Standing exception to ADR-0021 INT-07 for the central-classification fixture (docs/qa/s5-central-classification.json)
status: proposed
date: 2026-09-19
applicableTo:
  - security
  - architecture
constraints:
  security:
    - "The exception covers only the knownConnectors and centralLayer.tools lists in docs/qa/s5-central-classification.json; it MUST NOT be cited to justify any other allowlist, file, or control."
    - "An entry in docs/qa/s5-central-classification.json MUST arrive through a pull request whose diff shows the entry; the entry's presence in the merged file is its approval, and no separate decisions row, pin test, or expiry date is required or permitted to substitute for that review."
    - "knownConnectors MUST NOT be described in any message, document, or posture output as a security control or as verified identity; it is a display-name string match against a name the connector supplies about itself."
    - "No code under hooks/ or src/ MAY re-declare an entry from either list; docs/qa/s5-central-classification.json is the only place either list is edited."
    - "The fixture loader MUST throw on malformed input, and no environment variable MAY choose which fixture file loads (GitHub Issue #99)."
    - "This exception MUST end, and this ADR MUST be superseded, when an out-of-repo policy source for tool and connector classification ships (S6, Milestone #24); it MUST NOT be extended to cover that source."
---

# THOTH-ADR-0001: Standing exception to ADR-0021 INT-07 for the central-classification fixture

- **Status:** Proposed (2026-09-19). Agents MUST NOT self-accept (SE ADR-0001); the human accepts by changing the status to `accepted` in this PR or a follow-up commit.
- **Date:** 2026-09-19
- **Deciders:** `story-implementer` (Ptah), proposed; `mohannadrabie`, directed the mechanism and the ADR path on 2026-09-19.
- **Tier:** project (this repository only). Lives under `docs/adr/`, listed in `maat.json` `adr.dir`.
- **Relationship to ADR-0021:** narrows the reach of INT-07 for one named file. Does not edit, amend, or supersede ADR-0021 (SE ADR-0001: an accepted ADR's decision is never edited). Where this ADR and ADR-0021 disagree about that file, the more specific one governs (PRINCIPLES.md rule 9).

# Context

- `hooks/sessionstart-tool-enum.mjs` halts a session (SUR-03) on any unclassified MCP server or claude.ai connector. Two lists in `docs/qa/s5-central-classification.json` suppress that halt for named entries: `centralLayer.tools` (locally declared MCP servers) and `knownConnectors` (claude.ai connector display names).
- ADR-0021 INT-07, verbatim:

  > No control named in thoth's posture output may rest on an unverified third party's claim about its own behavior; where thoth can verify a third party's gate directly, it MUST do so and record its own independent verdict (INT-07).

- `knownConnectors` rests on a claim the connector makes about itself. `~/.claude.json` carries a bare display-name array (`claudeAiMcpEverConnected`) with no connector ID, URL, or scope, so nothing at this layer can verify the name (Issue #90; `src/policy/tools/mcp-enumeration.ts`).
- ADR-0021's own text scopes INT-07 to a third-party plugin installed alongside thoth (REL-12). Earlier reviews (`red-team`, `app-security-reviewer`, `cross-domain-reviewer`) and the human's 2026-09-07 ruling treated the allowlist as an INT-07 gap. This ADR takes the conservative reading and records a scoped exception. It does not rely on the narrow reading.
- The 2026-09-07 exception was time-boxed (`expiresOn` 2026-10-07), pinned by exact-content tests, and tied to a decisions row per edit. The human ruled on 2026-09-18 and 2026-09-19 to remove the timer and the pins ("remove the timer, remove the pinned list, the json is the single source of truth"; Issue #217). The exception is now standing, so it belongs in an ADR, not a decisions row (PRINCIPLES.md rule 9).

# Decision

- `docs/qa/s5-central-classification.json` is the single source of truth for both lists. Entries apply until removed. There is no expiry date and no pin test.
- The pull request diff of that file is the review. An entry's presence in the merged file is its approval.
- The loader's malformed-input rejection and the Issue #99 protection (no environment variable chooses the fixture; the resolved path is recorded in halt-state) stay in force.
- Scope: this file only. Any other allowlist that suppresses a SUR-03 halt needs its own decision.

# Rules for agents

- **MUST** treat the exception as covering only the `knownConnectors` and `centralLayer.tools` lists in `docs/qa/s5-central-classification.json`; **MUST NOT** cite it to justify any other allowlist, file, or control.
- **MUST** route every entry through a pull request whose diff shows it; the merged entry is the approval. **MUST NOT** require, or accept as a substitute, a separate decisions row, a pin test, or an expiry date.
- **MUST NOT** describe `knownConnectors` in any message, document, or posture output as a security control or as verified identity.
- **MUST NOT** re-declare an entry from either list in code under `hooks/` or `src/`.
- **MUST** keep the loader throwing on malformed input, and **MUST NOT** let any environment variable choose which fixture file loads (Issue #99).
- **MUST** supersede this ADR and end the exception when an out-of-repo policy source for tool and connector classification ships (S6, Milestone #24); **MUST NOT** extend the exception to cover that source.

# Residual risk (disclosed, accepted by the human)

| Residual | Evidence | Effect |
|---|---|---|
| Display-name spoofability | Issue #90; `red-team` could not demonstrate the spoof (a scratch-account drill is still outstanding) but proved the missing verification | A connector renamed, or a new connector named like an entry, defeats the exemption completely |
| In-repo policy source | `docs/backlog.md` line 47 (architecture council, 2026-09-07); REQUIREMENTS.md §0.4 property 2, "Session cannot write it" | A session with commit access can add an entry; this fixture cannot satisfy property 2 however the loader is hardened |
| No mechanical tripwire | The exact-pin test that caught direct commit `83b6af9` (Issue #215) is removed by this decision | Adding a name silently suppresses its SUR-03 halt at the next SessionStart; no test fails |
| No forcing function | Timer removed | Nothing resurfaces the exception on a date; the removal trigger is S6 |
| Unenforced review premise | `master` has no branch protection or ruleset and there is no CODEOWNERS (`gh api` read, 2026-09-18) | "The PR diff is the review" holds by discipline, not by enforcement; hardening is a backlog item, not part of this decision |
| Inert classification | Issue #93 | `centralLayer.tools[].class` drives no decision today; listing a tool only removes it from the halt set |

- **Owner:** `mohannadrabie`.
- **Removal trigger:** S6 ships an out-of-repo policy source for tool and connector classification.

# Consequences

## Positive
- One file to edit and one place to review; no second artifact to keep in step with it.
- No date on which every session with a listed connector halts.

## Negative
- The INT-07 gap is permanent until S6 rather than time-boxed.
- The exact-content pins, the expiry tests, and the `ratifiedBy` tests were deleted on the human's directive. SE ADR-0010 ("MUST NOT ... delete tests") and SE ADR-0005 ("MUST NOT delete or weaken a failing test to make CI pass") are read as not violated: no deleted test was failing, and the removal is the approved change, not a way to get green. The PR states the directive as the human-approved exception.

# Alternatives considered

1. **Amend ADR-0021 in the shared `adr` submodule.** Rejected for now: a separate PR in a second repo, a submodule pointer bump, and a thoth-only carve-out in the shared standards repo. Revisit if a reviewer holds that a project ADR cannot narrow an org-tier MUST NOT.
2. **Decisions row only.** Rejected: a permanent deviation from an accepted ADR is an architecture decision; PRINCIPLES.md rule 9 keeps those in ADRs.
3. **Keep the timer, drop only the pins.** Rejected by the human's directive.

# Compliance verification

- Automated: `src/policy/tools/central-classification.test.ts` (loader rejects malformed input, accepts a fixture with no `expiresOn` or `ratifiedBy`); `hooks/sessionstart-tool-enum-fixnow.test.ts` (`S5-R2-N1`: environment variable inert; `S5-timer-removed`; `S5-malformed-fixture`; listed vs unlisted entries).
- Manual: reviewers read the fixture diff in each PR that touches `docs/qa/s5-central-classification.json`, and run the single-source query (names read from the JSON, searched in non-test `hooks/` and `src/`) recorded in `docs/decisions.md`'s 2026-09-19 row.
- Evidence location: `docs/qa/s5-central-classification.json`; `docs/decisions.md` 2026-09-19 row; Issues #90, #93, #99, #217.

# References

- `docs/decisions.md`: 2026-09-07 rows (original time-boxed exception; Issue #99 fix), 2026-09-18 row (direction), 2026-09-19 row (this decision)
- `docs/backlog.md` line 47; REQUIREMENTS.md §0.4
- `adr/software-engineering/0021-thoth-native-architecture.md` (INT-07)
