# Issue #361 Phase 1 plan: bring the two remaining hooks into the real typecheck gate (2026-09-30)

ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`
Branch: s7/closeout (no switch, no commit, .maat-state.json untouched).

## Restatement
Annotate `hooks/sessionstart-tool-enum.mjs` (30 diagnostics) and `hooks/userpromptsubmit-halt-relay.mjs` (22) so they typecheck clean under strict+checkJs, add both to `tsconfig.hooks.json` (the `npm run build`/`typecheck` gate), and ratchet the pinned baseline (`src/qa/hook-typecheck-baseline.json`) to empty, with no runtime behavior change.

## Measured today (tsc -p tsconfig.hooks-coverage.json)
52 diagnostics: 40x TS7006 (implicit-any param), 3x TS7031 (destructured binding), 2x TS7053 (index a frozen const by a string key, halt-relay lines 244/260), 6x TS2339 (sessionstart 281/282 payload props; 529/610/615/618 `.stack`/`.message` on a catch var narrowed to `{}`), 1x TS2322 (sessionstart 526, `fixtureLocation` inferred as `{fixturePath: null}`). The earlier reverted attempt (decisions/tsconfig header, "~60") was a wider first look; the measured total is 52 and all are annotation-class. Most are fixable with JSDoc (`@param`, declaration-site `@type`), which is comment-only. Only the catch-variable sites (4) may need a code-level form; see the spike.

## ADR review
No cataloged ADR (37) is APPLICABLE beyond standing rules; none UNCLEAR. CLAUDE.md hard rules apply: no suppression; sensitive-area review report; no hand-derived completeness claims (the "0 diagnostics" and "no runtime change" claims come from running instruments below).

## Acceptance criteria (named checks). (D) = derived.

| AC | Criterion | Named check |
|---|---|---|
| AC-1 | sessionstart-tool-enum.mjs: 0 diagnostics under tsconfig.hooks-coverage.json | `npx tsc -p tsconfig.hooks-coverage.json --noEmit` filtered to that file -> 0; QA-18 `node src/qa/hook-typecheck-coverage-check.ts` passes |
| AC-2 | userpromptsubmit-halt-relay.mjs: same | same, that file |
| AC-3 | tsconfig.hooks.json `include` lists all 3 hooks; regression fails `npm run build` | `npm run build` rc=0; drill N6: temp-drop `evaluateToolInventory`'s 2nd arg in sessionstart-tool-enum.mjs -> `npm run build` rc!=0 (TS2554), restore, confirm with `git diff` that only intended edits remain. Same drill on one required argument in halt-relay |
| AC-4 | baseline empty; QA-18 passes with no excepted hooks | `node src/qa/hook-typecheck-coverage-check.ts --regenerate-baseline` (ratchets down only, script-generated, not hand-edited) -> `pinned: {}`; `npm run qa:hook-typecheck-coverage` green. Two QA test files updated (see Q1) |
| AC-5 | no @ts-ignore/@ts-expect-error/@ts-nocheck; ESLint ban passes | QA-18 suppression scan (same run) + `grep -nE "@ts-(ignore\|expect-error\|nocheck)" hooks/*.mjs` empty + `npm run lint` |
| AC-6 | full suite green, 0 fail 0 skipped; hook tests unedited | `npm test` real counts; `git diff --name-only -- hooks/*.test.ts` empty |
| AC-7 (D, load-bearing) | NO runtime behavior change in either hook | (a) instrument: strip comments from `git show HEAD:<hook>` and the working file via the TypeScript scanner and assert identical token streams; any residual token diff (expected only the catch-variable casts, if the spike needs them) is enumerated by name and reviewed. (b) the hooks' existing tests pass unedited, including the S5 #278 inline-sanitize and issue206 unlock-forgery tests. The halt-relay inline sanitize copy gets zero code-token changes |
| AC-8 (D) | stale comments removed | tsconfig.hooks.json header, tsconfig.hooks-coverage.json header, and hook-typecheck-coverage-check.ts EXCEPTION LIST comment no longer describe the two hooks as excepted; grep for "~60", "pre-existing debt", "not yet fixed" |

## Design
1. JSDoc only on the 52 sites: `@param`/`@returns`, declaration-site `@type` for `payload`, `fixtureLocation` (`{fixtureSource: string, fixturePath: string | null}`) and the frozen label maps (`Readonly<Record<string,string>>`). Zero token changes intended.
2. Spike first (rule 17): the 4 catch-variable sites. Find whether JS can annotate the catch binding via JSDoc; else fall back to a parenthesized JSDoc cast (adds parens, semantically identical). The spike settles this before the rest is annotated; AC-7's allowlist covers only these, each named.
3. Add both hooks to `tsconfig.hooks.json` include; rewrite its header.
4. Regenerate baseline to empty via the script.
5. Order: spike, annotate sessionstart, annotate halt-relay, token-stream check, tsconfig, baseline, QA tests, drills.

## Guard decision (tsconfig.hooks-coverage.json + QA-18)
Keep both; ci.yml unchanged (sensitive area, no need to touch). After this story they are a complementary guard: QA-18 additionally scans for suppressions no compiler can see, and `listProductionHooks` fails CI if a NEW hook under hooks/ is not covered. Removing QA-18 would reopen that gap. Only comments and the baseline JSON change.

## Tests that must change (not hook tests)
`src/qa/hook-typecheck-coverage-check.test.ts` (asserts "baseline: 30"/"22" ~lines 45-46; mutation cases use `PINNED_BASELINES[...]` ~110-160) and `src/qa/hook-typecheck-coverage-check.fixnow.test.ts` (totals 30/22 and key list ~131-139). They encode the debt being paid and must move to the empty-baseline state. See Q1.

## Risk tier
CRITICAL (proposed): both hooks are named enforcement-point sensitive areas and the halt-relay carries the S5 sanitize copy; the risk is a silent enforcement change hidden inside a "types only" diff. Blast radius is contained by the comment-only design plus the token-stream proof, so the Manager may ratify STANDARD if the token diff proves empty or near-empty; I do not lower it myself.

## Sensitive areas touched / reports required
- Policy enforcement / session gates: both hooks edited -> fresh dated report in docs/reviews/ (app-security-reviewer; red-team if CRITICAL ratified) plus cross-domain-reviewer.
- Halt-state directory: writeHaltReason in sessionstart is annotated -> same report.
- CI gates: ci.yml NOT touched; src/qa checker comments and baseline JSON are touched -> code-reviewer.

## Test-first dispatch check
No new/changed UI flow or API surface; no externally observable behavior change (AC-7). `test-writer` NOT dispatched. Red-first artifacts: the updated QA tests (red until baseline regenerated) and the AC-3 drill.

## Rollout / rollback
Commits on the current story branch; rollback = revert, runtime unaffected (comment-only). Merge is human-only.

## Blocking questions
Q1 (needs Manager ack, does not block planning): the two QA test files above assert 30/22 and must be edited. I read AC-6's "existing tests unedited" as the hook tests only. Confirm. Nothing else blocking.
