# Phase 1 plan: reject every allow rule that can match a shell redirect record (Issues #338 + #340, one story)

Date: 2026-09-30. Branch: s7/closeout. Author: story-implementer (Ptah). Phase 1 only; nothing built.
`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`

## Restatement
At load, on every layer (central, project, shipped defaults), fail closed on any ALLOW rule keyed on an MCP-shaped target (starts with `mcp/`) that can match a record the shell normalizer emits for a redirect into a directory of that name. Deny rules and filesystem-path allows are unchanged.

## ADR review
Catalog: 37 ADRs. Applicable:
- SE ADR-0005 (locked tests are replaced as an explicit recorded act, never silently edited): APPLICABLE. Governs AC-7. Each pinned "loads" assertion is flipped in place with a REPLACEMENT header and a decisions row (precedent: S7-B G13b, S7-C R2-12).
- SE ADR-0021 (POL-12, open normalizer registry): APPLICABLE as a caveat. The "which verbs can a shell record carry" set is `KNOWN_VERBS`, imported not retyped; the R2-19 / R2-21 drift instruments already guard it (#339).
- Others (devops/IaC, others in SE): NOT-APPLICABLE (no infra; no API/data surface). No UNCLEAR.
CLAUDE.md hard rules honored: no hand-typed completeness claim (AC-5 instrument); sensitive area review report required; no gold-plating.

## Blocking question (1, needs the Manager before Phase 2)
**Q1. Boundary shape (a) as worded rejects the correct allow shape.** "(a) allow with a marker and no other verb on a presentable server target" is exactly what rule-author fact 3 (tool-class-format.ts) tells authors to write, and it can only match a class record (the shell normalizer never emits a marker; R2-12/R2-16 already rely on that). Rejecting it makes it impossible to author any allow on an MCP server, and `src/policy/gate/decide-tool-call.test.ts:117` (`verbs:[WS], targets:["mcp/standin/write_file"]`) is one such rule the ruling would forbid. #338's comment (a) probably meant "marker PLUS a catalog verb" (which does match a redirect record with verb `write`).
Recommended reading (this plan is written to it): reject an allow rule iff (i) some target starts with `mcp/` (bare prefix, server, server/tool, presentable or not) AND (ii) its verbs are absent/empty OR include at least one `KNOWN_VERBS` verb (a verb a normalizer emits). Marker-only (and marker plus stray) allows on any target load if the target is presentable; on an unpresentable target they are already rejected by V2/V3. If the human means the literal reading, the predicate is instead "any allow on an `mcp/` target", and the plan changes only in the flip table (marker-only rows) and the decide-tool-call test.
Everything below is otherwise independent of Q1.

## Acceptance criteria (named test cases)
Tests live in `src/policy/config/rule-reachability.test.ts` (unit + instrument, new IDs R2-22..R2-25) and `loader-reachability.test.ts` (layer loads). IDs are proposals.

| AC | Criterion | Named check |
|---|---|---|
| AC-1 | Every rejected shape fails load on central, project and shipped defaults; message names the layer and carries a layer-aware `Unlock:` (central: policy owner, session cannot repair; file layers: the file edit and the fix) | R2-22 (layer x shape loads through the real loader, reusing `loadOnLayer` and `loaderRejectionProblems`) and R2-15 extended with the new rejection kind |
| AC-2 | #340 shape: allow with `write` (or marker + `write`, or any catalog verb) on each V2/V3 unpresentable target is rejected | R2-22 rows; R2-17 part 3 flipped (see AC-7) |
| AC-3 | #338 shapes: (a') allow, catalog verb(s) with or without a marker, on a presentable server or server/tool target; (c) allow with no verbs / empty verbs on the bare `mcp/` prefix, a presentable server, or server/tool | R2-22 rows |
| AC-4 | Deny rules on every one of those shapes still load | R2-23 (deny mirror of the whole shape matrix; R2-17 part 3's deny assertions kept) |
| AC-5 | The rejected set is checked against the REAL kernel and REAL shell normalizer, enumerated, not hand-typed | R2-24 (enumerating instrument, below) |
| AC-6 | Filesystem-path allows (`src/policy/`, `docs/notes.md`), allow with no targets, marker-only allows on presentable targets, and marker + stray allows keep loading | R2-23 "keeps loading" table (path allows stay under row 83(a)) |
| AC-7 | Locked tests that pin "loads" are replaced explicitly | see "Locked tests" |
| AC-8 | Headers no longer call the shapes residual/benign | R2-25 (scan: the phrases `disclosed residual`, `NOT BENIGN`, `Issue #338`, `Issue #340` as open residual are gone from both headers; positive: header names the reject rule); plus review |

### AC-5 instrument (R2-24), R2-19 style
1. Corpus: `mcpRedirectCalls()` (the existing redirect corpus) plus verb-first shapes built from every `KNOWN_VERBS` verb (as in R2-17 part 1), each run through the REAL `normalize("shell", ...)`; keep records whose target starts with `mcp/`. This is generated, not typed.
2. Rule candidates are generated: verbs in {absent, [], each single catalog verb, each catalog verb + a marker, each marker, marker + stray, stray only}; targets in {bare `mcp/`, every emitted target verbatim, each emitted target's directory prefix ending in `/`, presentable server `mcp/<name>/`, server/tool}; effect allow.
3. Soundness (the load-bearing direction): for every candidate where the REAL `decide` with a deny baseline returns `allow` on a real emitted record, `checkRuleReachability` must return an error. Counts printed.
4. Precision: every rejected candidate is one the predicate explains (no verbs, or a catalog verb, on an `mcp/` target); the instrument can fail (a control rule aimed at another target returns deny; a path allow that the kernel allows against a non-mcp record is not rejected).
5. Comparator-can-fail proof: a mutant predicate (drop the empty-verbs branch, or drop the catalog-verb branch) makes step 3 fail; asserted in-test by running the same comparator over the mutated predicate.
6. Drift: predicate imports `KNOWN_VERBS` and `MCP_TARGET_PREFIX`; R2-8 (no retyped verb/prefix literal) already scans this file and continues to; R2-21 covers registrant drift.

## Locked tests pinning old behavior (verified by reading them)
- **R2-17 part 3** (`rule-reachability.test.ts` ~L500): pins "allow with any single catalog verb on a bad target loads" and "allow with no verbs on a well-formed target / bare `mcp/` loads". APPLIES. Replace: the catalog-verb-on-bad-target loop and the no-verbs-on-`mcp/standin-x/`, `mcp/standin-x/some-tool`, `mcp/` rows flip to rejects; the `src/policy/`, `docs/notes.md` and no-targets rows and the deny rows stay. Explicit REPLACEMENT header comment + decisions row.
- **R2-12** (~L213): matrix dimension `allow` for rows "one legacy verb", "the legacy mutating verbs", "marker plus a legacy verb", "legacy verb plus marker", "marker, stray and a catalog verb", and the CATALOG_VERBS rows flip `allow: false -> true` on BAD_TARGETS. APPLIES (flip only those cells; `deny` column and stray-only/empty-string rows unchanged). The matrix's per-row message "rejected, but a record a normalizer emits can match it" is still true for deny.
- **R2-13** (`loader-reachability.test.ts` ~L184): deny rules authored from emitted records; deny unaffected. DOES NOT apply (verify still green).
- **G13b** (`tool-class-golden.test.ts` ~L105): every "inert" row is a `deny` rule; deny unaffected. DOES NOT apply. Only its header comment (lines ~14-17 mention #329/#338) is refreshed if it names the allow residual; assertions untouched.
- Also check: R2-16 part 1/2 (marker + stray, both effects) unchanged by the Q1 reading; `decide-tool-call.test.ts:117` is marker-only and does not go through the loader (unchanged under the recommended reading; affected under the literal reading, see Q1).
- Build step 0: run the full suite to surface any other test that loads an allow on an `mcp/` target; record each as a REPLACEMENT.

## Migration exposure
R2-10 (run today on this branch): shipped-defaults holds 0 rules, project policy holds 0 rules. No committed policy file can newly fail. Central layer is out of repo, so its exposure cannot be measured here; a newly rejected central rule fails the whole load (S7-B whole-load ruling). The rule-author facts note and the decisions row record a migration note for central rule authors: an allow on an MCP target must carry a class marker and no catalog verb. CHANGELOG notes it.

## Design (minimal)
Files:
1. `src/policy/config/rule-reachability.ts`: add check V4 "allow-redirect-reachable": for `rule.effect === "allow"`, if `verbs` is absent/empty or `verbs.some(v => KNOWN_VERBS.has(v))`, then every `targets[j]` starting with `MCP_TARGET_PREFIX` (including the bare prefix) yields an error at `rules[i].targets[j]`. Existing V2/V3 errors stay; where a target already draws a V2/V3 error for the same rule, emit only one error for that element (V4 message covers it; keep the V2/V3 message when it applies to markers-only scopes). Message names rule id, target, why (matches a shell redirect record, a file write the baseline may deny, so it silently widens allow), and the layer-aware `Unlock:` via existing `unlock()` (fix: add-marker-only verbs, i.e. "use only a class marker verb (one of ...) and no other verb", or "use a filesystem path target"). No new failure kind: joins `schema-invalid`.
2. `tool-class-format.ts`: rewrite rule-author facts 3 and 4 (the allow must carry a marker and no catalog verb, and is enforced) and drop the "not rejected ... Issue #338" text.
3. Header of `rule-reachability.ts`: replace the "NOT rejected" allow items and the "THE SURVIVING SHAPES ARE NOT BENIGN" paragraph with the V4 description; keep the deny-shape residual (#329) text as is (deny loads, only denies more).
4. Tests as above; CHANGELOG, STATE.md, decisions row (explicit replacement of R2-12 cells and R2-17 part 3, SE ADR-0005), docs/backlog untouched.
No schema.ts change (locked). No new module. No hook wiring (gate stays unwired; #308 preconditions text updated to say these two are closed).

## Risk tier (proposed)
**CRITICAL**: it changes policy-delivery config validation (a sensitive area), it is an allow-widening security control, and on the central layer a rejection fails the whole load. Blast radius today is small (0 committed rules, gate unwired) but the tier follows the area, not exposure. Manager ratifies.

## Sensitive areas and reports required
- Policy delivery / config surface (loader-side validation; `rule-reachability.ts` is on the load path) and Guard/policy engine adjacency (kernel is read-only here, not edited).
- Reports (fresh dated, `docs/reviews/`): `app-security-reviewer` (fail-closed and message layer-awareness), `red-team` (try to construct a redirect-matching allow that slips through the predicate: globs, `./mcp/`, case, unicode, prefix patterns), `cross-domain-reviewer` (standing pass), plus `code-reviewer` optional per Manager. `architecture-reviewer` not needed.

## Test-first dispatch check
Does the plan identify a new or changed UI flow or API surface? **No.** The change is an internal load-time validation of a policy config file; no UI, no HTTP/API surface. `test-writer` is not dispatched. Instead, per the "findings arrive as failing tests" and spike rules, the first Phase 2 commits are the failing story-implementer tests (R2-22..R2-25 and the flipped R2-12 / R2-17 part 3 cells) before the V4 code. No unmeasured numbers, so no spike; R2-24's printed counts are measured by the instrument itself.

## Verification plan (Phase 2)
`node --test` full suite with real counts; `tsc`/lint/fmt scripts per package.json; R2-8 and R2-21 stay green; R2-10 re-run printing 0/0; kernel-purity check; QA-14/QA-15 for docs; report every check with pass/fail/skip counts.

## Rollout / rollback
Single PR on this branch (s7/closeout), one commit series, no flag needed (gate unwired). Rollback is a revert of the V4 check plus the restored tests. Central-layer authors get the migration note.

## Non-goals (Issue stays out of the diff)
Marker-only allows with no targets or path-shaped patterns that could match some other emitted record; allow with no targets (match-all) stays loading as before (R2-17 part 3 edge), noted here so it is a conscious backlog item, not a hidden gap; legacy-verb DENY residual #329 unchanged.
