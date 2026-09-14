# Design Challenger — Stop Brief — `s1-closeout-164-154` (Issues #164/#154 + #170-#182)

**Role:** design-challenger (Apep), Stop Brief mode — PRINCIPLES rule 16(c) trigger (3 consecutive REWORK-class Stage-3 rounds).
**Date:** 2026-09-13
**Branch/commit under brief:** `fix/s1-closeout-164-154` @ `6393d16` (on top of `master` @ `ad196c5`). Confirmed via `git diff c2408ba 6393d16 --stat`: the only changes since round-3's code commit (`c2408ba`) are `docs/.maat-state.json`, `docs/REVIEW_LOG.md`, `docs/decisions.md`, and the 3 round-3 review reports — **no source file has changed since round 3's code-reviewer/cross-domain/red-team reports were written.** Their evidence is current.
**Tier:** CRITICAL (ratified). `humanRulingRequired: false` at time of this brief — proceeding is in scope.
**Mandate:** state what is proven, what is open, what has never been run. No new attacks. No fix proposals. No path recommendation beyond the required default.

Inputs read in full: `docs/STATE.md` (tail), `docs/decisions.md` (2026-09-13 rows, the full `s1-closeout-164-154` note in `docs/.maat-state.json`), and all 9 dated reports in `docs/reviews/s1-closeout-164-154-*.md` (code-reviewer R1/R2/R3, cross-domain-reviewer R1/R2/R3, red-team R1/R2/R3).

---

## 1. What is PROVEN safe right now, at `6393d16`

"Proven" here means: independently re-confirmed by **at least two of the three reviewer lanes**, using real mutation, live re-measurement, or repeated concurrent/load re-execution — not a receipt taken on faith. Each line below names the evidence.

| # | What's proven | Evidence (≥2 independent reviewers) |
|---|---|---|
| 1 | **Issue #164** — `ref` param deletion; `collectFullTreeFileTexts` now matches the shipped twin's shape; zero real callers ever passed a non-default ref | code-reviewer R1: **demonstrated** — mutation reintroducing the old ref-wiring flips the new test red (989→951), reverted clean. red-team R1: **demonstrated** — identical mutation, same result (attack 6); zero-callers claim independently re-verified stronger than claimed (attack 7). cross-domain R1: **code-traced** clean (Finding 3). |
| 2 | **Issue #154** — verify-and-close scope discipline held (no code touched in `reference-resolver.ts`); re-measurement (`continuation-marked=293`, `continuation-residual=5`, ~1.7%) is honest, not stale | code-reviewer R1: **demonstrated** — live re-run of both commands. red-team R1: **demonstrated** — same commands re-run independently (attack 9), plus blob-SHA identity check on `reference-resolver.ts` across the range (attack 8). cross-domain R1: **code-traced** clean (Finding 4). |
| 3 | **Issue #171** — Milestone #19's stale "SHIPPED" description corrected to disclose the QA-14 residual | cross-domain R2: **demonstrated** — live `gh api` read of the corrected text. red-team R2: **demonstrated** — independent live `gh api` read, same text, server-side `updated_at` inside the close-out window (attack 11). |
| 4 | **Issue #173** — `assertKnownArgs()` fail-loud on any non-`--field=` token, `marker-corpus-probe.ts` | red-team R2: **demonstrated** — enumerated 8 shapes including two not named in the Issue title (`--field` bare, `-f`), all correctly rejected (attack 10). code-reviewer R2/R3: **code-traced** clean. |
| 5 | **Issue #170→#176** — the flaky untracked-file regression test, rewritten to an `mkdtemp`-isolated, in-process assertion | red-team R3: **demonstrated** — 48 concurrent runs (4× the load that broke round-2's version 6/6) at 48/48 clean (attack 5). code-reviewer R3: **demonstrated + code-traced** — confirmed the in-process assertion is not narrower in what it proves; the CLI/argv contract stays covered by two other single-spawn tests in the same file (Finding 2). |
| 6 | **Issue #177** — `readFile` catch narrowed to ENOENT-only, now mutation-pinned in **both** `marker-corpus-probe.ts` and `continuation-residual-probe.ts` | red-team R3: **demonstrated** — reverting both narrowings kills one test per file (31/29/2); separately drove a **real** EISDIR through the **default** (non-fake) reader to prove the seam is load-bearing, not test-only (attack 6). code-reviewer R3: **code-traced** clean (Finding 5). *(Round 2's red-team had found this exact gap unpinned — attack 2, demonstrated — so this line is a genuine close, not a repeat of an old claim.)* |
| 7 | **Issue #178** — nested-untracked-git-repo (`EISDIR`) crash fixed at the source layer (`lsFilesWorkingTree`'s trailing-slash filter) | red-team R3: **demonstrated** — mutation removal kills 2 tests (unit + end-to-end); independently enumerated the `--others` shape space on this platform and confirmed a nested repo is the only trailing-slash-yielding shape (empty dir / all-ignored dir / NTFS junction all behave differently) (attack 7). code-reviewer R3: **demonstrated + code-traced** clean (Finding 6). |
| 8 | **Issue #179** — twin's stray-argument-swallowing gap is honestly disclosed as a known gap, not a contract (test title/assertion reworded, no lingering assertion anywhere pins the bad behavior as correct) | code-reviewer R3: **code-traced** clean (Finding 7). red-team R3: **demonstrated** — grepped every `code, 0` assertion in the file to confirm none still pins the gap as correct (attack 8). |
| 9 | **#172's underlying parity mechanism** (list and content now read from the *same* tree state — the structural fix, distinct from the test-flakiness question already covered at row 5) | red-team R2: **demonstrated** — untracked file now counted identically to a tracked one (1024==1024), gitignored correctly excluded (attack 8). red-team R3: **demonstrated** — reconfirmed sound under 48 concurrent runs (attack 5). |

**Not on this list, deliberately:** the CI-gate claim ("785/785 pass, 0 fail") is **not** proven — it is actively false at `6393d16` (see §2, Issue #180). The corpus-figure's stability against untracked scratch-file litter is **not** proven — it is actively disproven (§2, Issue #182).

---

## 2. What is genuinely OPEN right now

| Issue | Severity (as filed) | Evidence tier | Status at `6393d16` |
|---|---|---|---|
| **#180** | HIGH | demonstrated (3 independent reviewers: cross-domain R3, code-reviewer R3, red-team R3 — all reproduced deterministically, 8/8 + 5/5 + 2/2 runs) | **OPEN, unfixed.** `src/qa/marker-corpus-probe.test.ts:29`'s new `withIsolatedGitRepo()` fixture commits a `test@example.com` literal with no matching `docs/qa/secret-scan-allowlist.json` entry (the sibling file `history-scan.test.ts` has the identical literal, already allowlisted). Breaks OSS-01 (`npm test` → 784/785) and the standalone `history-scan.ts` CI step. Root cause is fully understood; minimal fix is a one-line allowlist entry mirroring an exact existing precedent. No code change since `c2408ba` — confirmed unfixed. |
| **#181** | MED | demonstrated (red-team R3 attack 2) | **OPEN, unfixed.** `docs/qa/recurring-findings-registry.md` has 1 row (an unrelated class); the registry's own convention requires a row on the **second occurrence** of a class, same turn — this is the second occurrence of "a fix round's own committed artifacts red a gate that reads only committed state" (first: Issue #131, 2026-09-09; second: Issue #180, 2026-09-13). `node src/qa/recurring-findings-registry.ts` passes vacuously (validates shape, not completeness). |
| **#182** | MED | demonstrated (red-team R3 attack 3, live during the review session) | **OPEN, unfixed.** The published corpus total is a function of whatever untracked-but-not-gitignored scratch files sit in the working tree at measurement time: measured live drift `1087 → 1106 → 1110` within one session (19 citations, ~1.7%, from one stray 163KB test-output file alone), silent, exit 0. Round 2 removed the `expect=N` markers from `CHANGELOG.md`, so QA-15 (`completeness-claim-checker.ts`) no longer cross-checks the figure either — nothing anywhere flags the drift. |

**Other findings any report flagged that are not yet actioned (real, but not filed as GitHub Issues, per this project's own LOW/non-gating convention, and explicitly disclosed rather than silently dropped each round):**
- Floating/duplicated Issue-#164/#172/#176 explanatory comment block in `marker-corpus-probe.ts` — flagged 3 consecutive rounds by code-reviewer (R1 LOW, R2 LOW "grew instead of shrank," R3 LOW "still open, disclosed"). Cosmetic, non-blocking.
- `lsFilesWorkingTree()` cached/others path-trim asymmetry, `src/lib/git.ts` — flagged R2 and R3 by code-reviewer (LOW, code-traced) and independently by red-team R2/R3 editorial notes. Cosmetic, no real repo path affected today.
- `shouldScanFile(repoRelativePath)` in `reference-resolver.ts:534` now sometimes receives an absolute path from both probes — code-reviewer R3 Finding 4 (LOW, code-traced): no functional bug (suffix check is prefix-invariant), stale parameter name only.
- `readFileTexts` duplicated verbatim across the two probe files rather than hoisted — cross-domain R3 (LOW, **derived** — a DRY judgment call, explicitly not gating).
- The twin's half of the `resolve(repoRoot, …)` fix (part of #176/#178) is pinned by **zero** tests — red-team R3 attack 4 (LOW, demonstrated: mutation reverting only the twin's half is byte-identical, 741/739/2 both sides). 0% exposure today because the only caller passes `process.cwd()`; purely forward-looking risk. No Issue filed, per project convention for a 0%-today, code-counted exposure.
- A POSIX symlink-to-directory shape that would slip past the `#178` trailing-slash filter into the same EISDIR class — red-team R3 attack 9, **UNPROVEN** (could not be built on this Windows environment; named settling command given for Linux/macOS). Non-gating.
- A duplicated `--field=` token silently resolves first-wins — red-team R2 attack 6 (LOW, demonstrated, 0 real call sites today). Non-gating, no Issue filed by convention.
- The 773-vs-774 first-run test-count anomaly (red-team R1 attack 4) — reconfirmed **not recurring** across 8 further runs in round 2 (red-team R2 attack 7) and the delta fully reconciles against known test additions. **Resolved by non-recurrence**, not an open item.

Nothing else in any of the 9 reports is left unaccounted for: every CLEAN, ISSUE, and SUSPICION line across all three rounds' RECEIPTs maps to either the Frozen set (§1), an open Issue (#180/#181/#182), or one of the disclosed-non-gating residuals above.

---

## 3. What has NEVER been run, across all 3 rounds

Two standing classes of check are absent from every round's own verification step, and both are exactly what produced this story's repeating "the fix-now round closes the reviewer's findings and introduces a fresh one" pattern:

**A. Post-commit re-verification against what the gate actually reads.** Every round's "785/785, 0 fail" (or 774/774, or 779/779) claim was measured **before** the fix-now commit existed, against a *working-tree* state. `OSS-01`'s dogfood scan reads **committed git history**, not the working tree — red-team R3 proved this directly: identical bytes as *uncommitted* worktree edits on the parent commit exit 0; the same bytes *committed* exit 1 (attack 1's "PROVEN MECHANISM" section, `s1-closeout-164-154-red-team-round3-2026-09-13.md:88-106`). No round's own Definition-of-Done check has ever included "re-run the gate against the actual commit that will ship, not the tree that produced it." Round 3's red-team names this explicitly as the reason it is *not* recommending a round 4: "the pattern is now clearly in the loop, not in any individual fix" (same report, "single scariest unproven assumption" section).

**B. A standing check that a round's own new committed content doesn't collide with the secret-scan allowlist, run *before* the round claims a pass.** This is the concrete form of (A) for this specific defect class, and it is the **second occurrence** of exactly this shape (Issue #131, 2026-09-09, on `cifix`; Issue #180, 2026-09-13, here) — see Issue #181 above. The mechanism this repo built for exactly this situation (`src/qa/recurring-findings-registry.ts` / `docs/qa/recurring-findings-registry.md`) exists, runs, and passes — because nobody has fed it the row. Had it been fed after the first occurrence, its own stated convention ("promotion is mandatory before the third story ships") would have forced a completeness instrument into existence before this round shipped its second fixture with an unallowlisted literal.

A third, narrower, gap worth naming distinctly from A/B: **no round's verification has ever measured the corpus-total instrument's own sensitivity to non-repo-authored working-tree content** (untracked scratch files from a concurrent agent or a stray log redirect). Round 2's red-team *predicted* this mechanism under a SIGKILL orphan scenario; round 3's red-team caught it firing on its own, unforced, mid-session (Issue #182). Nothing in any round's Definition-of-Done checklist — across all 3 rounds — has ever included a step that asks "what happens to this instrument's published figure if the working tree isn't exactly what the diff produced?" This is not a hypothetical: it is this project's own standing multi-agent workflow (visible in this very brief-gathering session, where a concurrent reviewer's report file was itself present in `git status --porcelain` mid-round).

**If either A/B or the corpus-sensitivity check had existed as a standing pre-fix-now gate, it would have caught the round-2 AND round-3 new-defect pattern before a reviewer had to find it by hand** — round 2's new defect (Issue #172's flaky test/orphan-file interaction, itself later found to have a *second*, non-flakiness-related failure mode in round 3 as Issue #182) and round 3's new defect (Issue #180) are both, at root, instances of "this round's own verification measured a tree state its own commit does not preserve."

---

## 4. Is there a calibrated BLOCKING HIGH?

**No — and the reason is structural to this domain, not a close call.**

Applying the council's own four-prong HIGH test (evidence ∈ {demonstrated, code-traced} AND reach=user with a named entry point AND likelihood ∈ {routine, plausible} AND effect ∈ {money wrong, data lost, state silently diverging, security boundary bypassed}):

- **Issue #180** (the only reviewer-tagged HIGH still open): evidence is demonstrated (✓), likelihood is routine (✓ — every CI run). It fails on the other two prongs simultaneously:
  - **Reach:** this is internal QA/dev tooling — a git-history secret-scanning gate and a corpus-counting instrument, both consumed only by this project's own CI pipeline and its own maintainers/agents. There is no external product user who invokes `marker-corpus-probe.ts` or reads OSS-01's output; there is no route from a real user's action to this code path. `reach=user` cannot be supported with a named user-facing entry point (the design-challenger framework's own required proof for that tag) — the honest tag is `reach=operator` (a human/CI-pipeline-run context) at best, `reach=instrument` at worst (it *is* a QA instrument catching its own test fixture).
  - **Effect:** the gate is failing **loudly** — that is the defense mechanism working exactly as designed (per code-reviewer R3: "the gate is working exactly as designed and is telling the truth; what failed is the verification loop around it"). This is the opposite of "state silently diverging from reality" — a loud, blocking, 100%-reproducible CI failure is the textbook *correct* outcome of a real secret-scan gate encountering an unallowlisted literal. There is no money, no user data, and (per red-team R3's own explicit scoping) "the literal is an RFC 2606 reserved-domain address... there is no security exposure here."

- **Issue #181/#182** are both MED as filed, both `reach=operator`/`instrument` for the same domain reason (internal QA registry hygiene; a QA instrument's own corpus figure), and neither is money/data/security. #182 is the closest thing to a "silent divergence" pattern (an unwarned, drifting published number) but the number in question is an internal QA metric about this repo's own citation corpus, not a user-facing or financial figure, and its drift is fully explained and bounded to environments where the tree holds transient untracked content (0% in CI, where `actions/checkout` always yields a clean tree).

**This changes what a blocking HIGH can even look like in this domain, and it's worth saying explicitly rather than leaving it implicit:** an internal QA/dev-tooling story with no external user-facing surface and no money/data path structurally cannot produce a design-challenger-calibrated HIGH under the reach=user and money/data/silent-divergence prongs — not because the findings aren't real (they are, and #180 correctly gates *merge* under this project's own `CLAUDE.md`/ADR-0008 rules), but because those two prongs are asking a question ("does this reach a real product user, silently, with money or data on the line") that this class of change cannot answer yes to. Reviewer-severity HIGH (used correctly by all three lanes to gate Stage-3 approval) and design-challenger-calibrated HIGH (used to force a council no-go) are different scales measuring different things; conflating them here would manufacture a finding this council's own criteria were not built to catch.

**Verdict: no calibrated blocking HIGH exists.** #180 is real, demonstrated, code-traced, and un-fixed — it correctly blocks *this branch's own merge* under this project's standing rules — but it does not meet this council's bar for a HIGH that would force a no-go recommendation from this brief.

---

## Frozen set (carries forward; re-opening requires new evidence, not re-derivation)

Issues #164, #154, #171, #173, #170/#176 (combined), #177, #178, #179, and #172's list/content parity mechanism (distinct from #182's corpus-stability question) — see the table in §1 for the specific reviewer(s) and evidence tier behind each.

## Residual-risk register (non-blocking, MED/LOW, for the Manager's routing)

| Item | Trigger | Exposure |
|---|---|---|
| #180 (HIGH by reviewer severity, not council-calibrated) | Any `npm test` / CI run at or after `c2408ba` | 100% of runs, measured |
| #181 | Next story that introduces a fixture/prose collision with a committed-state gate, unregistered | 2 of 2 occurrences of this class unlogged, measured |
| #182 | Any measurement of the corpus total taken while untracked-but-not-gitignored scratch content sits in the tree | Measured live 1087→1110 in one session; 0% in CI |
| Twin's unpinned `resolve(repoRoot,…)` half | Only if the twin's `collectFullTreeFileTexts` is ever exported/exposed to a second caller | 0% today, 1 of 1 caller passes `process.cwd()` |
| Symlink-to-directory EISDIR gap | A checkout containing a POSIX symlink to a directory | UNPROVEN on this platform; 0% in CI regardless |
| Floating comment block / git.ts trim asymmetry / stale param name / readFileTexts duplication | Cosmetic only | N/A |

## Unrun verifications

1. **Re-run `npm test` and `node src/secret-scan/history-scan.ts` against the actual commit that will ship (post-`docs/qa/secret-scan-allowlist.json` fix), not the working tree that produced it** — named by red-team R3 as the single most important unrun step; command: `node --test --test-reporter=tap` and `node src/secret-scan/history-scan.ts`, owner: whoever applies the #180 fix, before claiming any pass count.
2. **Feed `docs/qa/recurring-findings-registry.md`** with the #131→#180 row, then re-run `node src/qa/recurring-findings-registry.ts` to confirm it validates — owner: per the registry's own convention, whoever notices the recurrence (already named in this brief); not gated on new code.
3. **A completeness/stability instrument for the corpus total against untracked content** has never been written or run in any form — no command exists yet to name as "run this to settle it"; this is itself the gap (§3).

## Candidate paths (no mechanism design — for architect/impact-analyst pricing)

1. **Small fix-now, no round 4 dispatch:** apply the #180 allowlist entry, file/promote the #181 registry row, and file #182's disclosure (or fix) as a mechanical, low-risk change-set; re-verify post-commit per Unrun Verification 1; skip a full 4th adversarial round given the mechanism is understood and narrowly scoped.
2. **Fix-now plus one standing gate:** do (1), and additionally stand up a lightweight pre-commit or CI check answering "does this diff's own new committed content collide with the secret-scan allowlist" — closing the class named in §3 before it recurs a third time.
3. **Descope #182 to a disclosed residual, ship #180/#181 only:** treat the corpus-stability-against-scratch-files finding as an accepted, monitored residual (it is 0% in CI and only manifests in local/shared-checkout multi-agent sessions) rather than a blocking fix, given this is internal tooling with no user-facing or money/data surface.

## The single scariest unproven assumption

That a green verification run, however many times repeated, proves anything about the commit that ships — when this repo's own gates (OSS-01) read committed history and this story's own instrument (the corpus probe) reads working-tree content including whatever a concurrent process leaves behind. Every round's confidence was earned honestly against the tree it measured; the tree it measured was never quite the tree that shipped.

## Recommendation

Per this brief's own mandate: **build now** on the two mechanically-understood, low-risk items (#180, #181), with Unrun Verification 1 run for real against the actual post-fix commit before any pass-count claim is repeated; #182 is a genuine open MED that the architect/impact-analyst should price for fix-vs-residual, but nothing here rises to a calibrated HIGH that would force another adversarial round.

---

RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius — status reflects this brief's calibration of existing 3-round evidence, not a new attack):
1. [CLEAN][demonstrated] Issue #164 fix (ref-param deletion) — proven by 3 independent reviewers across R1, mutation-tested (989→951 on revert), zero real callers ever passed a ref.
2. [CLEAN][demonstrated] Issue #154 (verify-and-close scope + honest re-measurement) — proven by 3 reviewers, live re-measurement reproduced (1.7%), reference-resolver.ts blob-identical across the range.
3. [ISSUE][MED][demonstrated][operator/routine/reversible] Issue #180 — unallowlisted test@example.com literal in marker-corpus-probe.test.ts:29 breaks OSS-01 (784/785) and history-scan.ts; reviewer-tagged HIGH but fails council's reach=user and silent-divergence prongs (internal tooling, loud failure by design) — real, unfixed at 6393d16, mechanically simple fix. Exposure: 100% of CI runs, measured.
4. [ISSUE][MED][demonstrated][operator/routine/runbook-reversible] Issue #181 — QA-13 recurring-findings-registry owed a row on this class's 2nd occurrence (#131→#180); registry validates shape not completeness, passes vacuously. Exposure: 2 of 2 occurrences unlogged, measured.
5. [ISSUE][MED][demonstrated][operator/routine/reversible] Issue #182 — published corpus total drifts (1087→1106→1110, measured live) with untracked-but-not-gitignored scratch files in the tree, silent, exit 0; 0% in CI, 100% in shared local/multi-agent checkouts. Exposure: measured live spread within one session.
6. [CLEAN][demonstrated] Issue #171 (Milestone #19 description correction) — confirmed via 2 independent live gh api reads, discloses the QA-14 residual honestly.
7. [CLEAN][demonstrated] Issue #173 (assertKnownArgs fail-loud) — enumerated 8 argv shapes including 2 unnamed in the original Issue, all correctly rejected.
8. [CLEAN][demonstrated] Issue #170→#176 (flaky untracked-file test rewritten to mkdtemp isolation) — proven flake-free at 4x the load that broke its predecessor (48/48 clean), test equivalence to old CLI-subprocess coverage confirmed.
9. [CLEAN][demonstrated] Issue #177 (ENOENT-only catch, mutation-pinned both files) — real EISDIR driven through the default (non-fake) reader to prove the seam is load-bearing; this closes a gap red-team itself had found unpinned one round earlier.
10. [CLEAN][demonstrated] Issue #178 (EISDIR/nested-repo trailing-slash filter) — mutation kills both unit and end-to-end tests; --others shape space enumerated directly on this platform.
11. [CLEAN][code-traced] Issue #179 (twin's argv-swallowing gap, honestly deferred) — no assertion anywhere still pins the bad behavior as correct; test title/message reworded from contract to disclosure.
12. [CLEAN][demonstrated] #172's list/content tree-state parity mechanism (distinct from #182's corpus-stability question) — untracked file counted identically to tracked, reconfirmed sound under 48 concurrent runs.
13. [ISSUE][LOW][code-traced] Cosmetic residuals disclosed but unfixed across 3 rounds: floating duplicate comment block (marker-corpus-probe.ts), git.ts cached/others trim asymmetry, stale shouldScanFile param name, readFileTexts cross-file duplication (derived/DRY) — none gating, all explicitly disclosed each round rather than silently dropped.
14. [SUSPICION][LOW][demonstrated] Twin's resolve(repoRoot,…) half unpinned by any test — 0% exposure today (1 of 1 caller passes process.cwd()), no Issue filed per project convention.
15. [SUSPICION][LOW][demonstrated-negative] Symlink-to-directory EISDIR gap — could not be built/tested on this Windows environment; named settling command for Linux/macOS; 0% in CI regardless.
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=4 suspicions=2 clean=9
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=14 code-traced=2 derived=0
round=4 (Stop Brief, per rule 16(c) — not a 4th attack round) roundsSinceLastGo=0 frozen=9 residuals=6 unrun=3 editorial=0
checks=n/a (Stop Brief mode — no new commands run; all evidence cited from the 9 persisted round-1/2/3 reports plus a git diff confirming no code change since c2408ba)
adr=HIT(35) — no new ADR collision found by any of the 3 rounds' own whole-catalog passes (cross-domain-reviewer); ADR-0008 (devops, CI gates) is the one actively engaged by Issue #180, correctly, per the gate's own design.
report=docs/reviews/s1-closeout-164-154-design-challenger-stopbrief-2026-09-13.md
