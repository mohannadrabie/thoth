# Phase 1 plan: S7 activation, wire the PreToolUse gate (Issue #308)

Date: 2026-09-30. Author: story-implementer (Ptah). Phase 1 only. Nothing wired, built, committed or edited outside this file.
Read from a detached worktree at 2d02d69 (branch `s7/closeout` tip; six close-out items are in-flight there, see status column).
`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`

## 0. Headline

Activation is NOT ready. Nothing in the last step (the settings.json entry) should be touched until the NOT MET rows below are closed. Derived counts (from the tables in section 2, counted by the instrument in section 6, not typed): see the count line at the end of section 2.

The AC-3j premise is partly stale: the hook does NOT use `catalog.projectDir()`. The AST scan (section 3) finds seven namespace.member pairs, none of them `projectDir`. But the scan surfaced a real env read the pair pin does not cover: `central.defaultCentralPolicySource` reaches `resolveSystemRegExePath` which reads `SystemRoot`/`windir` (central-source.ts:107-109). Design in section 3 pins both layers.

## 1. ADR review

Catalog 37 ADRs. Applicable:
- THOTH-ADR-0001 (fixture standing exception): APPLICABLE + UNCLEAR. Rules: "MUST NOT be cited to justify any other allowlist, file, or control", "MUST NOT hardcode an entry of either list in hooks/ or src/". The fixture becoming an enforcement input (AP-7) is outside its stated scope; human ruling plus amendment via `/maat:adr-amend` is a blocking question (Q1).
- SE ADR-0021 (POL-12 open normalizer registry, INT-07): APPLICABLE. Governs AP-3 and the "class emits verbs" instruments.
- SE ADR-0005 (locked tests replaced as an explicit recorded act): APPLICABLE to AP-1 / #338 / #340 flips.
- Others (devops/IaC, remaining SE): NOT-APPLICABLE (no infra, no API/data surface).

## 2. Precondition table

### 2a. AP-1 to AP-14 (verbatim from `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` section 14, quoted, condensed only by "..." where a row is long; issue body of #308 confirms the list is AP-1..AP-14)

Status key: MET (evidence run or cited); IN-FLIGHT (fixed on s7/closeout, unmerged); NOT MET.

| # | Precondition (verbatim) | Status | Evidence |
|---|---|---|---|
| AP-1 | "baseline allow content (shell, tools, path rules); nothing denies by class from shipped data until then. ENTRY tests, all three must be green before any rule ships: PT-1 ..., PT-2 ..., and PT-12 ... Issue #306 stays open and is cited here" | NOT MET | `src/policy/config/shipped-defaults.json` is `{"version":"0.0.0-s6-placeholder","rules":[]}`; `.thoth/policy.json` is `rules: []`. PT-12 shapes are pinned (`loader-reachability.test.ts` R2-5; #306 CLOSED). PT-1/PT-2 exist only as design shapes (re-expressed as N9, N9b, H11, H11b per plan U-4); they become ENTRY tests only against real shipped rules, which do not exist. Also carries #329 (CLOSED). |
| AP-2 | "refresh the vendored inventory; classify 23 runtime built-ins including `ToolSearch`" | NOT MET | `docs/qa/tool-inventory.json` capturedAt 2026-09-06; `grep -c ToolSearch` = 0 in the inventory and in `docs/qa/s5-central-classification.json`. Re-vendor is a human/reviewed action (gate-matcher-drift note). |
| AP-3 | "ruling on the 8 `knownConnectors` (unclassified, so denied at the gate)" | NOT MET | 8 entries live in the fixture; no ruling row found. HUMAN ruling (ADR-0021 INT-07 / THOTH-ADR-0001 scope). |
| AP-4 | "matcher choice and regex semantics (`Bash` and `mcp__.*`), matcher-drift check update" | NOT MET | `node src/qa/gate-matcher-drift-check.ts` PASS today (19 names), but no matcher decision recorded and no entry exists to check. Derived by the last wiring step. |
| AP-5 | "the entry with `timeout` 60; rerun the 4 qa checks; measure on the real runtime" | NOT MET | `qa:gate-latency-budget` PASS p99 293.89 ms (this run, Node 24.15, spawns the real hook); no entry exists; real-runtime measurement needs a live Claude Code session (HUMAN/live). |
| AP-6 | "decisions row for S5 criterion 12" | NOT MET | `grep -i "criterion 12" docs/decisions.md` finds no row. Manager writes the row; nothing to build. |
| AP-7 | "Q-C ruling and ADR amendment" | NOT MET | THOTH-ADR-0001 (accepted 2026-09-19) has no S7 amendment; `git log` on it ends at b5322c5. HUMAN ruling + `/maat:adr-amend`. |
| AP-8 | "SessionStart and gate agree on one inventory (G14 ...; the inventory refresh is AP-2)" | NOT MET (blocked by AP-2) | G14 shared-module code exists (`classification-catalog.ts`); agreement on a refreshed inventory cannot be shown until AP-2. |
| AP-9 | "recovery when the policy load fails: every gated call denies ... state the out-of-session repair step. Named trigger (Issue #309 ...) ... C12 pins it" | PARTLY MET | C12 exists (`src/policy/config/central-source.test.ts`); #309 CLOSED as accepted. The runbook (out-of-session repair: write `CentralPolicyJson` or remove the key) is a doc, not yet written. |
| AP-10 | "deny rules protecting `.thoth/policy.json`, `shipped-defaults.json` and the fixture ..., AND the gate's own code ... and the settings files ... Checked-list activation test: `activation-preconditions: every path that decides or wires the gate is matched by a deny rule in the activation policy (list generated from the hook import graph)`" | NOT MET | No such test exists (`grep activation-preconditions` over src, hooks, docs/qa: no hit) and no deny rules ship. Blocked by AP-1 (rules must exist). |
| AP-11 | "what Q-B means under `permission_mode` bypass, where 'emit nothing' proceeds without a prompt" | NOT MET | Ruling not found. HUMAN/Manager ruling; may need a live measurement. |
| AP-12 | "no arbitrary-execution tool (PowerShell, Skill, Workflow, CronCreate, RemoteTrigger) may be classifiable read-only; checked mechanically over the inventory" | NOT MET | No mechanical check found (grep `arbitrary-exec`, `AP-12` in tests: none). Build as an instrument. |
| AP-13 | "Issue #303 ... Fix at activation: a launcher that turns any launch failure into exit 2, and a write-error listener" | PARTLY MET / NOT MET | #303 CLOSED via PR #327 (merged 2026-09-27): module-load and stdout-write faults now exit 2 in the hook. Launcher part NOT MET: five launcher-owned faults still PROCEEDS (probe rows), and per #308's 2026-09-30 comment SYSTEMROOT-nonexistent still fails open on Node 24.15 (this machine). `node --test src/qa/gate-fail-open-probe.test.ts`: 14/14 pass, the pass records the PROCEEDS rows, it does not close them. No launcher exists. |
| AP-14 | "Issue #304 ... the planned 60 s entry timeout is crossed near 205 KB" | MET (with a read-back) | #304 and #321 CLOSED, PR #327 merged. `node --test` over `hooks/*.test.*` plus `gate-path-scaling-sweep`, `gate-latency-budget-check`, `gate-matcher-drift-check` tests: 185 tests, 185 pass, 0 fail, 0 skipped (this run). #308 comment says: read real-hook wall-clock on the first CI run of PR #327 (a read-back, not re-verified here). |

### 2b. Preconditions added by comments on #308 (verbatim/quoted, each dated)

| ID | Source (date) | Precondition | Status | Evidence |
|---|---|---|---|---|
| X-1 | red-team 2026-09-26 (1) | proof-test C12 plus an AP-9 line for the non-English half-provisioned central key (#309) | MET (C12) ; AP-9 runbook see AP-9 | C12 in `central-source.test.ts`; #309 CLOSED. |
| X-2 | red-team (2) | gate-fail-open-probe row `stdout-closed-before-write` expecting BLOCKS | MET on Windows only | PR #327: dropped stdout write exits 2, probed on Windows; Linux unmeasured; reach in a real session unproven (comment 2026-09-26 21:59). |
| X-3 | red-team (3) | "settle X-2 (which characters the runtime sanitizes, with a scratch claude session) and, if the runtime does not sanitize tool names, add test N13" | N13 MET; X-2 settle NOT MET | N13 test present (`src/policy/normalizer/tool-class.test.ts:270`, tool segment is `[A-Za-z0-9_-]` only). Runtime sanitization measurement needs a live claude session (HUMAN/live). |
| X-4 | Manager 2026-09-26 14:37 | three LOW hardening notes: `assertHookOutcome` requires a reason string; `envWith` drops `NODE_OPTIONS` case-insensitively; up to 512 escaped chars of a tool name in the deny reason | 512-cap IN-FLIGHT (#326, #375); other two NOT MET (LOW, optional) | commits 616a140, 61a87c9, 81d6b84, 2d02d69 on s7/closeout. |
| X-5 | Manager 2026-09-26 16:36 | #312 policy-derived text sanitized in the kernel verdict reason | MET | #312 CLOSED; `hooks/pretooluse-kernel-gate-sanitize.test.ts` is in the 185 pass run. |
| X-6 | Manager 16:36 / re-home | #288 remaining items bind activation (hook consumes `defaultOutcome` as a live path; ignored-relaxation disclosure) | Live path: satisfied BY the wiring itself (AC-H5, `hooks/pretooluse-kernel-gate-classification.test.ts:150`, passes; #288 comment 2026-09-26 16:52). Ignored-relaxation disclosure: NOT MET (no code found by grep) | see Q4 whether it truly binds. |
| X-7 | Manager 16:36 | #107: real non-English reg.exe host still unrun; review-back backstop 2026-10-24 | NOT MET, HUMAN | #107 OPEN; last comment 2026-09-30: "Stays blocked; the calendar backstop of 2026-10-24 stands." |
| X-8 | 2026-09-26 21:59 (AP-13 narrowing) | the launcher form "maps every exit other than 0 and 2 to 2" closes five faults; does not close a tampered in-graph module that exits 0; "Whether a settings env block reaches hooks is still unmeasured" | NOT MET | see AP-13; env-block reach is HUMAN/live. |
| X-9 | 2026-09-26 21:59 | #326 (deny reason reflects command text up to about 2x its length; reader buffer behavior unproven) | IN-FLIGHT | commits 616a140, 61a87c9 (cap 512), 81d6b84 + 2d02d69 (#375 pins cap 512 and worst cases). #326 and #375 still OPEN until s7/closeout merges. "Reader buffer behavior" is a live-session unknown (HUMAN/live). |
| X-10 | 2026-09-26 22:03 | AP-9 runbook item (out-of-session repair) | NOT MET (doc) | see AP-9. |
| X-11 | 2026-09-26 23:54 (S7-B) | gate-side unlock wording for a lowering fixture entry and a schema-invalid rule | NOT MET | hook `UNLOCK` const (hooks/pretooluse-kernel-gate.mjs:87) says "a human must repair the gate hook" for the fail-closed catch path; `grep` finds no per-failure-kind unlock in `render-hook-output.ts`. Decision needed on wording (Q3). |
| X-12 | 23:54 | blast radius of a schema-valid central-layer typo (#333) | MET as a disclosure | #333 CLOSED; unlock stays out-of-session by the central policy owner. Fold into the AP-9 runbook. |
| X-13 | 23:54 | shape c disclosure on the print surface (#329, AP-1) | MET | #329 CLOSED. |
| X-14 | 2026-09-27 01:30 | #335 allow-rule widening decide reject/disclose | MET | #335 CLOSED (PR #342), and #334 CLOSED. |
| X-15 | 01:30 | R1-6c one-catalog-source: "settle with an instrument that enumerates catalog sources" | NOT MET | see section 5 step S4; #332 CLOSED, #355 CLOSED with residual re-homed here. |
| X-16 | 01:30 | R1-6b instrument is a labelled heuristic (#332) | Disclosed (CLOSED) | see X-17. |
| X-17 | 2026-09-30 04:04 (#355) | shapes 3 and 4 (promise file-handle read; sync read via assembled file name) are NOT caught by the name-based instrument; "Any activation-time runtime check of the catalog source (R1-6c) should state whether it covers these shapes" | NOT MET (a statement owed) | Ruled disclose-not-chase. The S4 instrument must state coverage explicitly (section 5). |
| X-18 | 01:30 | aggregate loader failure message length uncapped (~390 KB); "loud and reversible, the gate never sees it" | Accepted, no action | recorded. |
| X-19 | 2026-09-27 05:21 / 05:42 | resolve #338, #339, #340 before wiring | #339 MET (CLOSED); #338 and #340 IN-FLIGHT | plan `docs/plans/s338-340-allow-redirect-reject-phase1-2026-09-30.md` exists; #338 and #340 OPEN; no build commit for them appears in `git log origin/master..HEAD` (not built yet on the branch). Treated as IN-FLIGHT per the task, but NOT yet built. |
| X-20 | 2026-09-30 03:28 | "add AC-3j: pin the namespace.member pairs the hook uses from its six imports" | NOT MET | design in section 3. |
| X-21 | 2026-09-30 04:46 (#320) | SYSTEMROOT-nonexistent: still fails open on Node 24.15, hook denies on 22.18; "the launcher fix is still an activation precondition"; probe row accepts either outcome | probe row MET (A20/A21, commits 678d932, 783df05, be9633b); launcher NOT MET | #320 stays OPEN until s7/closeout merges. |
| X-22 | scope of this task | #361 hooks typecheck (renderHookOutput's required sanitize parameter build-time force) and #374 | IN-FLIGHT | commits 13e055f, fd1558f, eb0b2d2, 46a1069, 20effa5, 1c10aee, c0755bb; #361 and #374 OPEN until merge. |

Count line (from the instrument, section 6): the table rows above are AP-1..AP-14 (14) plus X-1..X-22 (22). The status tally is produced by the script at plan-approval time; do not trust a hand count. (Hand tally of AP rows for orientation only: 1 MET, 2 partly MET, 11 NOT MET.)

Reading of the "all met" claim: NOT true. No claim of completeness is made; the tally must be regenerated after each item lands.

## 3. AC-3j design: pin the namespace.member pairs

Instrument (run this session, AST over `hooks/pretooluse-kernel-gate.mjs`, `Promise.all` destructure positions mapped to `import()` specifiers, then every property/element access whose object is one of those bindings):

```
NAMESPACES: gate=decide-tool-call.ts render=render-hook-output.ts loader=config/loader.ts
            central=config/central-source.ts catalog=tools/classification-catalog.ts sanitizeMod=config/sanitize.ts
PAIRS (7):  catalog.assembleCatalog  catalog.moduleRelativeFixtureLocation  central.defaultCentralPolicySource
            gate.decideToolCall  loader.loadEffectivePolicy  render.renderHookOutput  sanitizeMod.sanitizeForTerminal
BARE (a namespace used other than as the object of a dotted member access): none
COMPUTED (namespace[expr]): none
```

Finding vs the #308 comment: the hook does not call `catalog.projectDir()`. That function is used only by the SessionStart hook's own local copy (hooks/sessionstart-tool-enum.mjs:206). `classification-catalog.ts:55` `projectDir` is exported and unused by the gate; the seven pairs above are the truth. The comment's example is stale, its concern is not: env reads inside imported exports are invisible to AC-3.

Transitive env-read instrument (regex over the 23-module import graph of the six imports, comments excluded): only three hits.
- `central-source.ts:107` `resolveSystemRegExePath(env = process.env)` reads `SystemRoot` / `windir`, reachable via `central.defaultCentralPolicySource` on win32. Environment-controlled path to `reg.exe`: an attacker who controls env picks which binary answers for the registry (and see #320: this is exactly the SYSTEMROOT fault).
- `central-source.ts:307` `platform = process.platform` default (not env).
- `classification-catalog.ts:55` `projectDir` default `process.env` (exported, not reachable from the seven pairs; the pin must prove that by construction).

Design (style of AC-3: pinned allow-sets, deny-by-default, positive and negative controls), tests in `src/policy/config/sanitize.test.ts` next to AC-3 (or a sibling file if the Manager prefers; the AC-3 helpers `parseWithChecker` etc. are private there):

| AC | Named check | What it pins |
|---|---|---|
| AC-3j-1 | `AC-3j: the namespace.member pairs the real hook uses from its pinned imports are EXACTLY the pinned allow-set` | The seven pairs above, derived by the AST scan inside the test from the real hook (not typed from the comment). Deny-by-default: a new pair or a new import namespace fails until added in a reviewed change. |
| AC-3j-2 | `AC-3j: no namespace is used bare, aliased, destructured, spread or accessed by computed key` | closes the vehicles that hide a pair (`const {projectDir} = catalog`, `catalog["projectDir"]`, `const c = catalog; c.x`, `render[k]`). |
| AC-3j-3 | `AC-3j: every pinned pair resolves to an export of the named module, and no pair is projectDir or another env reader` | reads the module export list via the same TypeScript checker; the env-reader set below is the negative list. |
| AC-3j-4 | `AC-3j: env reads reachable from the pinned pairs are EXACTLY the pinned allow-set {central-source.ts resolveSystemRegExePath: SystemRoot, windir}` | transitive scan over the import graph (23 modules today) for `process.env`, `process.cwd`, `process.argv`, `child_process`; deny-by-default. This is the layer the comment asked about ("env reads made inside imported module exports"). The one allowed read is disclosed, with a recorded rationale referencing #320 and X-8. |
| AC-3j-5 | Synthetic controls (fail-first) | for each of: a new pair `catalog.projectDir`, a bare `catalog`, an alias, a computed access, a seventh import, a new env read in a graph module: the scan flags it. Positive control: the seven real pairs and the one allowed env read are not flagged. |

Honest limit to state in the test header: AC-3j-4 is a source scan (tokens over 23 modules), not a runtime proof; a read through an assembled name or a dynamic import inside the graph is the same disclosed-not-chased class as #355 shapes 3/4. Tier CRITICAL, sensitive-area (policy enforcement, session gate) review needed.

Decision needed (Q2): AC-3j-4 goes beyond the literal words of the #308 comment ("pin the namespace.member pairs"). Recommended: include it, because the pair pin alone does not answer the finding it came from.

## 4. Independence of open S7 issues from #308

- #93 (S5: centralLayer class never read): blocked BY #308 (its body states it stays open until #308 lands). Closes with #308.
- #288: remaining item "hook consuming defaultOutcome as a live path" is satisfied by the wiring and closes with #308 (the ignored-relaxation disclosure is separate, see Q4; it does not need the hook wired to be built).
- #107: NOT blocked by #308 and does not block the wiring code, but it binds activation (X-7) with the 2026-10-24 backstop. Independent, human-gated.

## 5. Plan for the remaining items (ordered; each AC maps to a named check)

Order: cheap pins and doc rulings first, then content and launcher, then the last approval-gated wiring.

| Step | Item | Acceptance criteria to named checks | Human action? |
|---|---|---|---|
| S0 | Merge s7/closeout (#361 #326 #320 #374 #375 and #338/#340 once built) | Full `npm test` counts, `qa:*` scripts, reports fresh in `docs/reviews/` | No (merge is human-only) |
| S1 | AC-3j (section 3) | AC-3j-1..5, written failing first | No |
| S2 | #338 + #340 build (existing plan) | R2-22..R2-25 per that plan; blocked on its Q1 | No (Manager Q1) |
| S3 | AP-12 instrument (no arbitrary-exec tool classifiable read-only, over the inventory) | new `qa`-style test, failing first against a seeded mutant (mutate a classification and see it flagged) | No |
| S4 | R1-6c catalog-source instrument | enumerate every catalog reaching the kernel, assert each came from `assembleCatalog`; header states coverage vs #355 shapes 3/4 (not covered by design, exposure measured by real-tree scan) | No |
| S5 | AP-2 refresh inventory, AP-3 connector ruling, AP-8 agreement test | re-vendored `tool-inventory.json`; `qa:gate-matcher-drift` PASS; a shared-inventory test | YES: re-vendor is a human/reviewed action; AP-3 is a human ruling. Activation MUST wait. |
| S6 | AP-7 ruling + `/maat:adr-amend` | ADR amendment merged | YES, MUST wait |
| S7 | AP-1 baseline allow content with PT-1, PT-2, PT-12 green first (failing first against real shipped rules), including the N9/H11 shapes re-run against them | named tests; #306/#329 cited | Rules content needs Manager/human ratification of what is allowed |
| S8 | AP-10 deny rules + generated-list test `activation-preconditions` | list generated from the import graph; test fails when any path is unmatched (seeded mutant) | No; depends on S7 |
| S9 | AP-11 ruling (bypass mode), AP-6 decisions row, X-11 gate-side unlock wording decision, AP-9 runbook | doc/decision rows; X-11 wording pinned by a render test | Rulings by Manager/human |
| S10 | AP-13 launcher: one command form mapping every exit other than 0 and 2 to 2 (Windows-capable; the repo shell is Git Bash/PowerShell) | probe rows: interpreter-off-PATH, NODE_OPTIONS bad flag, SYSTEMROOT nonexistent (Node 24), unparseable script, memory exhaustion each flip to BLOCKS; `gate-command-path-check` still resolves the script path | Live measurement that a settings env block reaches hooks: YES, HUMAN/live. Launcher can be built and probed without it; activation must not claim env-block behavior. |
| S11 | AP-4, AP-5 the entry: matcher `Bash` and `mcp__.*`, `timeout` 60; measure on the real runtime | rerun the four qa checks (`gate-command-path`, `gate-matcher-drift`, `gate-manifest`, `gate-latency-budget`) | Real-runtime measurement: HUMAN/live; X-3 (which characters runtime sanitizes) also live |
| S12 (LAST, separately approved) | Add the `.claude/settings.json` PreToolUse entry | full regression: all checks above green, reports fresh, human approval recorded | Human approval; the change is a sensitive-area edit to a protected settings file |

Can activation proceed without the human items? No, for: AP-7 (ruling), AP-3, AP-2 (re-vendor), AP-11, and the live `timeout` 60 measurement (AP-5). The #107 sample: activation code and tests can proceed; wiring in a non-English environment must wait for the sample or the 2026-10-24 backstop review. Default deny with a fully repairable runbook (AP-9) is the accepted fail-closed direction, so a Windows-English-only activation is defensible only if the human explicitly rules that (Q5).

## 6. Instruments used, to regenerate rather than trust

- Import-namespace pairs: AST scan (TypeScript `createSourceFile` over the hook; script kept in the session scratchpad, not committed; AC-3j-1 will contain the production version).
- Env-read graph scan: regex over the transitive relative-import graph rooted at the six imports (23 modules).
- The precondition list: extracted from the issue text and the plan section 14 table above by quotation. The status tally must be produced by a script over section 2 rows at approval time (not built in Phase 1; step S0 owns it).

Evidence commands run this session (worktree at 2d02d69): `node --test src/qa/gate-fail-open-probe.test.ts` 14 pass, 0 fail, 0 skipped; `node --test hooks/*.test.* src/qa/gate-path-scaling-sweep.test.ts src/qa/gate-latency-budget-check.test.ts src/qa/gate-matcher-drift-check.test.ts` 185 pass, 0 fail, 0 skipped; `node src/qa/gate-latency-budget-check.ts` PASS p99 293.89 ms; `node src/qa/gate-matcher-drift-check.ts` PASS 19 names. Not run: full `npm test`, live-session probes.

## 7. Risk tier

CRITICAL. Wiring the hook into `.claude/settings.json` is a policy-enforcement / session-gate change (named sensitive area), it changes every gated call of every session (fail-closed on error, so an error denies every Bash and mcp call), and the launcher and settings file are themselves protected control surfaces. The Manager ratifies.

## 8. Sensitive areas and required reports

- Policy enforcement / session gates (`hooks/pretooluse-kernel-gate.mjs`, `.claude/settings.json` entry), guard/policy engine (`src/policy/gate/*`), policy delivery (shipped defaults), secret/CI gates if `.github/workflows/ci.yml` gains a step, evidence trail not touched.
- Reports required, fresh, in `docs/reviews/`: `red-team` (adversarial) for the wiring plus AP-13 launcher; `app-security-reviewer` (env reads, launcher, deny rules); `architecture-reviewer` (AP-7 / ADR-0001, AP-1 content); `cross-domain-reviewer` (whole catalog); `code-reviewer` for AC-3j and instruments. Infra reviewers not applicable.
- Human-only: merge to master, settings.json entry approval, ADR amendment.

## 9. Test-first dispatch check

New or changed UI flow or API surface: NO for the AC-3j, AP-12 and R1-6c instruments (internal, no externally observable behavior). The final step (S12) changes the observable behavior of the hook in a live session, but there is no UI flow or API surface as `test-writer` defines it; the acceptance evidence is the probe rows, the qa checks and a live-session measurement. So `test-writer` is not dispatched; `story-implementer` writes failing tests first, per the "findings arrive as failing tests" rule. Manager may overrule if it reads the launcher (S10) as an API surface.

## 10. Spike before shape (rules 17, 18)

Numbers not yet measured (each is a spike that must run before its step is final): (a) whether a settings env block reaches hooks (live); (b) which characters the runtime sanitizes in tool names (live); (c) real-runtime wall clock at `timeout` 60 (live); (d) launcher behavior of the exit-code mapping on Windows Node 24 with SYSTEMROOT nonexistent (local, buildable); (e) bypass-mode behavior (live). S10 begins with (d) as a walking skeleton.

## 11. Blocking questions (max 5, ranked by build impact)

1. AP-7 / THOTH-ADR-0001: do you rule that the fixture may act as an enforcement control and that halt-state recording by a write-free gate is acceptable, and approve an `/maat:adr-amend`? (Blocks S6, S7, and activation.)
2. AC-3j scope: include the transitive env-read pin (AC-3j-4) which flags the one existing `SystemRoot`/`windir` read, or only the literal pair pin? Recommended: include.
3. X-11: what should the gate-side unlock text say for a lowering fixture entry and for a schema-invalid rule, given the gate's fixed text must carry no path or stack? (Blocks S9.)
4. Does the #288 "ignored-relaxation disclosure" truly bind activation, or is it independent polish? (No code found for it.)
5. Is a Windows-English-only activation acceptable while #107's real non-English sample is unrun (backstop 2026-10-24), or must the wiring wait for the sample?

## 12. Next single action

Approve this plan (and answer Q1 and Q2), and approve S1 (AC-3j, failing tests first) as the first Phase 2 step. Nothing is wired; S12 needs its own approval.

RECEIPT: verdict=BLOCKED criteria="0 mapped/0 total" checks="0/0/0" adr=HIT(37) pr=n/a
