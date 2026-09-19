---
id: THOTH-ADR-0001
title: Standing exception to ADR-0021 INT-07 for the central-classification fixture (docs/qa/s5-central-classification.json)
status: accepted
date: 2026-09-19
applicableTo:
  - security
  - architecture
  - code
constraints:
  security:
    - "The exception covers only the knownConnectors and centralLayer.tools lists in docs/qa/s5-central-classification.json; it MUST NOT be cited to justify any other allowlist, file, or control."
    - "An entry in docs/qa/s5-central-classification.json MUST arrive through a pull request whose diff shows the entry; the entry's presence in the merged file is its approval, and no separate decisions row, pin test, or expiry date is required or permitted to substitute for that review. A pull request that only adds or removes an entry in that file does not need a fresh dated review report in docs/reviews (human ruling 2026-09-19); a pull request that changes the loader or the hooks that read the file still does."
    - "knownConnectors MUST NOT be described in any message, document, or posture output as a security control or as verified identity; it is a display-name string match against a name the connector supplies about itself."
    - "Code under hooks/ and src/ MUST NOT hardcode an entry of either list for this allowlist; the hooks load the entries from docs/qa/s5-central-classification.json at runtime. The SUR-04 managed-MCP settings fixture in src/policy/fixtures/allowlist-settings.ts is a different allowlist, not a re-declaration."
    - "The fixture loader MUST throw on malformed input. The fixture path MUST resolve only from the project root (CLAUDE_PROJECT_DIR, or the hook's working directory when it is unset) plus docs/qa/s5-central-classification.json, or from the module-adjacent DEFAULT_FIXTURE_PATH; no environment variable MAY select an arbitrary fixture file (GitHub Issue #99), and the resolved path and its source MUST be recorded in halt-state."
    - "This exception MUST end, and this ADR MUST be superseded, when an out-of-repo source for tool and connector classification ships (owned by GitHub Issue #224); until that ships the exception is standing, and it MUST NOT be extended to cover that source."
  code:
    - "The one-time, human-directed removal of the exact-pin and expiry tests (AC1-a, AC1-b, AC1-c, S5-R2-N2, S5-R2-N3, the isFixtureExpired tests, the expiresOn and ratifiedBy tests) is a human-approved exception to SE ADR-0010 (MUST NOT delete tests); it MUST NOT be cited to delete any other test."
---

# THOTH-ADR-0001: Standing exception to ADR-0021 INT-07 for the central-classification fixture

- **Status:** Accepted (2026-09-19), by `mohannadrabie` (the human), in session, before the PR carrying this ADR merges. Proposed by `story-implementer` (Ptah); agents MUST NOT self-accept (SE ADR-0001), and the status edit was made by the Manager on the human's explicit instruction. The exception binds from acceptance (PRINCIPLES.md rule 9, SE ADR-0001). The ADR catalog (`docs/adr-cache.mjs`) serves a `proposed` ADR's rules exactly like an accepted one's (Issue #220), so readers check this field, not the catalog.
- **Date:** 2026-09-19
- **Deciders:** `story-implementer` (Ptah), proposed; `mohannadrabie`, directed the mechanism and the ADR path on 2026-09-19.
- **Tier:** project (this repository only). Lives under `docs/adr/`, listed in `maat.json` `adr.dir`.
- **Relationship to ADR-0021:** narrows the reach of INT-07 for one named file. Does not edit, amend, or supersede ADR-0021 (SE ADR-0001: an accepted ADR's decision is never edited). Where this ADR and ADR-0021 disagree about that file, the more specific one governs (PRINCIPLES.md rule 9).

# Context

- `hooks/sessionstart-tool-enum.mjs` halts a session (SUR-03) on any unclassified MCP server or claude.ai connector. Two lists in `docs/qa/s5-central-classification.json` suppress that halt for named entries: `centralLayer.tools` (locally declared MCP servers) and `knownConnectors` (claude.ai connector display names).
- ADR-0021 INT-07, verbatim (the frontmatter constraint; the "Rules for agents" line words it differently):

  > No control named in thoth's posture output may rest on an unverified third party's claim about its own behavior; where thoth can verify a third party's gate directly, it MUST do so and record its own independent verdict (INT-07).

- `knownConnectors` rests on a claim the connector makes about itself. `~/.claude.json` carries a bare display-name array (`claudeAiMcpEverConnected`) with no connector ID, URL, or scope, so nothing at this layer can verify the name (Issue #90; `src/policy/tools/mcp-enumeration.ts`).
- ADR-0021's own text scopes INT-07 to a third-party plugin installed alongside thoth (REL-12). Earlier reviews (`red-team`, `app-security-reviewer`, `cross-domain-reviewer`) and the human's 2026-09-07 ruling treated the allowlist as an INT-07 gap. This ADR takes the conservative reading and records a scoped exception. It does not rely on the narrow reading.
- The 2026-09-07 exception was time-boxed (`expiresOn` 2026-10-07), pinned by exact-content tests, and tied to a decisions row per edit. The human ruled on 2026-09-18 and 2026-09-19 to remove the timer and the pins ("remove the timer, remove the pinned list, the json is the single source of truth"; Issue #217). The exception is now standing, so it belongs in an ADR, not a decisions row (PRINCIPLES.md rule 9).

# Decision

- `docs/qa/s5-central-classification.json` is the single source of truth for both lists. Entries apply until removed. There is no expiry date and no pin test.
- The pull request diff of that file is the review. An entry's presence in the merged file is its approval.
- Human ruling, 2026-09-19: a pull request that only adds or removes an entry in that file does not need a fresh dated review report in `docs/reviews/`. A pull request that changes the loader (`src/policy/tools/central-classification.ts`) or the hooks that read the file still does. The matching sentence is added to the "Policy delivery / config surface" bullet in `CLAUDE.md`.
- The loader's malformed-input rejection and the Issue #99 protection (no environment variable selects the fixture file; the resolved path is recorded in halt-state) stay in force.
- One-time exception to SE ADR-0010: the exact-pin and expiry tests are deleted on the human's directive (rule 7 below).
- Scope: this file only. Any other allowlist that suppresses a SUR-03 halt needs its own decision.

# Rules for agents

- **MUST** treat the exception as covering only the `knownConnectors` and `centralLayer.tools` lists in `docs/qa/s5-central-classification.json`; **MUST NOT** cite it to justify any other allowlist, file, or control.
- **MUST** route every entry through a pull request whose diff shows it; the merged entry is the approval. **MUST NOT** require, or accept as a substitute, a separate decisions row, a pin test, or an expiry date. A pull request that only adds or removes an entry in that file **MUST NOT** be held for a fresh dated review report (human ruling 2026-09-19); a pull request that changes the loader or the hooks that read the file still needs one.
- **MUST NOT** describe `knownConnectors` in any message, document, or posture output as a security control or as verified identity.
- **MUST NOT** hardcode an entry of either list in `hooks/` or `src/` for this allowlist; the hooks load the entries from the JSON at runtime. `src/policy/fixtures/allowlist-settings.ts` declares `github` for a different allowlist (SUR-04 managed-MCP settings); that is not a re-declaration.
- **MUST** keep the loader throwing on malformed input. **MUST** keep the fixture path resolving only from the project root plus `docs/qa/s5-central-classification.json`, or from `DEFAULT_FIXTURE_PATH` (`hooks/sessionstart-tool-enum.mjs`, `resolveFixtureLocation`), recording the resolved path and source in halt-state. The project root is `CLAUDE_PROJECT_DIR`, or the hook's working directory when it is unset (`projectDir()`, `hooks/sessionstart-tool-enum.mjs` lines 111-113). **MUST NOT** let any environment variable select an arbitrary fixture file (Issue #99). `CLAUDE_PROJECT_DIR` is the project-root seam every hook already uses, not a fixture selector.
- **MUST** end the exception and supersede this ADR when an out-of-repo source for tool and connector classification ships. Issue #224 owns that source; until it ships the exception is standing. **MUST NOT** extend the exception to cover that source.
- **MUST** treat the removal of `AC1-a`, `AC1-b`, `AC1-c`, `S5-R2-N2`, `S5-R2-N3`, the `isFixtureExpired` tests, and the `expiresOn` and `ratifiedBy` tests as a one-time, human-approved exception to SE ADR-0010 line 47 ("MUST NOT ... delete tests"); **MUST NOT** cite it to delete any other test. Authority: the human's directive (Issue #217). No failing test was deleted. The replacements are stronger: `red-team` planted 9 production mutations and all 9 were killed (8 by the new tests, 1 by the existing generic-hint tests), and two base-tree vacuity proofs showed the old `/class/` assertion and the old "not expired" test passed with the parser broken (`docs/reviews/fixture-single-source-of-truth-red-team-2026-09-19.md`, A4, A5 and A9; the 9th mutation, `M9`, is in A9). SE ADR-0005 ("MUST NOT delete or weaken a failing test to make CI pass") is not violated: none of the deleted tests was failing.

**How rules 4 and 5 are checked.** They are verified at review time by the single-source query recorded in `docs/decisions.md`'s 2026-09-19 row. No test enforces them. A test that fails whenever a name from the JSON coincidentally appears elsewhere under `src/` (the word `github` already does) would re-add the friction the human removed.

# Residual risk (disclosed, accepted by the human)

| Residual | Evidence | Effect |
|---|---|---|
| Display-name spoofability | Issue #90; `red-team` could not demonstrate the spoof (a scratch-account drill is still outstanding) but proved the missing verification | A connector renamed, or a new connector named like an entry, defeats the exemption completely |
| In-repo policy source | `docs/backlog.md` line 47 (architecture council, 2026-09-07); REQUIREMENTS.md §0.4 property 2, "Session cannot write it" | A session with commit access can add an entry; this fixture cannot satisfy property 2 however the loader is hardened |
| No mechanical tripwire | The exact-pin test that caught direct commit `83b6af9` (Issue #215) is removed by this decision | Adding a name silently suppresses its SUR-03 halt at the next SessionStart; no test fails |
| No forcing function | Timer removed | Nothing resurfaces the exception on a date; the removal trigger is Issue #224 |
| Unenforced review premise | `master` has no branch protection or ruleset and there is no CODEOWNERS (`gh api` read, 2026-09-18) | "The PR diff is the review" holds by discipline, not by enforcement; hardening is a backlog item, not part of this decision |
| Inert classification | Issue #93 | `centralLayer.tools[].class` drives no decision today; listing a tool only removes it from the halt set |

- **Owner:** `mohannadrabie`.
- **Removal trigger:** an out-of-repo source for tool and connector classification ships. Issue #224 owns it. It is not a deliverable of S6 or Milestone #24 (that milestone's scope excludes it; `src/policy/tools/builtin-tool-inventory.ts` says no ratified milestone owns a central-override config loader). Until Issue #224 ships, the exception is standing.

# Consequences

## Positive
- One file to edit and one place to review; no second artifact to keep in step with it.
- No date on which every session with a listed connector halts.
- A fixture-entry-only PR does not wait for a review report.

## Negative
- The INT-07 gap is standing until Issue #224 ships, not time-boxed.
- The exact-content pins, the expiry tests (including `S5-R2-N3`), and the `ratifiedBy` tests were deleted on the human's directive (rule 7).

# Alternatives considered

1. **Amend ADR-0021 in the shared `adr` submodule.** Rejected for now: a separate PR in a second repo, a submodule pointer bump, and a thoth-only carve-out in the shared standards repo. Revisit if a reviewer holds that a project ADR cannot narrow an org-tier MUST NOT.
2. **Decisions row only.** Rejected: a permanent deviation from an accepted ADR is an architecture decision; PRINCIPLES.md rule 9 keeps those in ADRs.
3. **Keep the timer, drop only the pins.** Rejected by the human's directive.

# Compliance verification

- Automated: `src/policy/tools/central-classification.test.ts` (loader rejects malformed input, accepts a fixture with no `expiresOn` or `ratifiedBy`); `hooks/sessionstart-tool-enum-fixnow.test.ts` (`S5-R2-N1`: the removed environment variable is inert; `S5-timer-removed`; `S5-malformed-fixture`; listed vs unlisted entries). These cover the loader, the timer, and one environment variable name; they do not cover rules 4 and 5 as a whole.
- Manual: reviewers read the fixture diff in each PR that touches `docs/qa/s5-central-classification.json`. For rules 4 and 5 they run the single-source query below (names read from the JSON at run time, searched in non-test `hooks/` and `src/`, excluding `hooks/test-support`) and read the result; the query is also recorded in `docs/decisions.md`'s 2026-09-19 row.

```bash
node -e "const fs=require('fs'),p=require('path'),fx=JSON.parse(fs.readFileSync('docs/qa/s5-central-classification.json','utf8')),names=[...fx.centralLayer.tools.map(t=>t.name),...fx.knownConnectors],qs=[String.fromCharCode(34),String.fromCharCode(39)],hits=[],walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){if(e.name!=='node_modules'&&e.name!=='test-support')walk(f)}else if(['.mjs','.ts','.js'].some(x=>e.name.endsWith(x))&&!e.name.includes('.test.')){const t=fs.readFileSync(f,'utf8');for(const n of names)for(const q of qs)if(t.includes(q+n+q))hits.push(f+' '+q+n+q)}}};walk('hooks');walk('src');console.log(names.length+' names, quoted-literal hits: '+hits.length);hits.forEach(h=>console.log(h))"
```

- Expected output: the only hit is `src/policy/fixtures/allowlist-settings.ts` (`github`, the different SUR-04 allowlist). Any other hit is a re-declaration to investigate.
- Evidence location: `docs/qa/s5-central-classification.json`; `docs/decisions.md` 2026-09-19 row; Issues #90, #93, #99, #217, #224.

# References

- `docs/decisions.md`: 2026-09-07 rows (original time-boxed exception; Issue #99 fix), 2026-09-18 row (direction), 2026-09-19 row (this decision)
- `docs/backlog.md` line 47; REQUIREMENTS.md §0.4
- `adr/software-engineering/0021-thoth-native-architecture.md` (INT-07)
- `docs/reviews/fixture-single-source-of-truth-{red-team,app-security,cross-domain}-2026-09-19.md`
