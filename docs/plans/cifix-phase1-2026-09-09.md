# `cifix` fix-now round — Phase 1 plan (reconstructed)

**Scope:** `docs/.maat-state.json` → `scope: "cifix"`, tier **CRITICAL** (unchanged from the original `cifix` Phase 1 ratification — `.github/workflows/ci.yml` is a CLAUDE.md-named sensitive area, "Secret scanning / CI gates," regardless of which fix path is chosen).

**Trigger:** Stage-3 round 1 (`docs/reviews/cifix-{red-team,infra-security,cross-domain}-2026-09-09.md`) — `red-team` no-go, `infra-security-reviewer`/`cross-domain-reviewer` both APPROVE-WITH-CONDITIONS. Human ruled (`docs/decisions.md`, 2026-09-09 "Stage-3 round 1" row): widen scope to also fix Issue #113, on top of the 4 contained MED fix-now items from the reviews.

> **Housekeeping note:** this file is a same-day reconstruction of the Phase 1 planning already conducted (ADR review, risk-tier confirmation, blocking-question ruling, constraints, verification plan) earlier this build turn, persisted per `cross-domain-reviewer`'s LOW finding 2 (`docs/reviews/cifix-cross-domain-2026-09-09.md`) — every prior story in this project has a persisted plan file; `cifix`'s fix-now round did not, until now.

## 0. Readiness

No material fact is missing or ambiguous for this round. All open questions were already ruled by the human in `docs/decisions.md`'s 2026-09-09 rows: the CI security-posture choice (Option (a), `ADR_REPO_PAT`), the original `cifix` Phase 1 blocking questions (PAT scope/expiration/AC4 diagnostic), and this round's scope-widening ruling (fix Issue #113 too, leave Issue #120 out).

## 1. ADR Review (mandatory gate)

`node docs/adr-cache.mjs --ensure` re-run this session: **`📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`** — matches every reviewer's own cache line this round; no rebuild needed.

Per-ADR verdict, restricting to what this round's diff (`.github/workflows/ci.yml`, `src/secret-scan/patterns.ts`+test, `docs/backlog.md`, `CHANGELOG.md`) actually touches:

- **devops ADR-0008 (CI/CD gates and policy-as-code, Accepted)** — **APPLICABLE.** Quoted rule: *"MUST NOT merge a PR with any blocking gate open, failing, or pending."* This is the exact rule red-team's HIGH finding cited: restoring the submodule checkout alone does not restore a green `npm test` gate (Issue #113 was failing it deterministically), so merging the checkout fix alone would violate this MUST. Also: *"MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)"* — directly constrains HOW Issue #113 may be fixed: not by widening the OSS-01 allowlist (a suppression-list broadening), but by fixing the pattern's own precision (see plan §6).
- **devops ADR-0009 (least-privilege IAM and secrets)** — **NOT-APPLICABLE** (literal scope: AWS IAM/Secrets Manager; no AWS resource touched by a GitHub Actions repo secret). Its *spirit* (secrets vaulted/referenced, never inlined; least-privilege scope) is satisfied by the already-ratified `ADR_REPO_PAT` shape (fine-grained, single-repo, read-only, 90-day expiry) — confirmed by `infra-security-reviewer`'s prior round; unchanged by this round's fixes.
- **SE ADR-0009 (monitoring/observability)** — **APPLICABLE**, narrowly. Quoted rule: *"MUST NOT log secrets, tokens, passwords, or personal data."* Directly bears on Issue #125's fix (the `ADR_REPO_PAT` must never land in `~/.gitconfig`, a log-adjacent disk artifact, nor in the rendered `run:` script body) — satisfied by construction (`GIT_CONFIG_*` env-var form, never `--global`), with a same-step assertion that re-confirms it rather than trusting the mechanism.
- **SE ADR-0010 (code quality/maintainability gates)** — **APPLICABLE.** Same MUST as devops ADR-0008 ("run the full local equivalent of CI gates before declaring work complete; failing gates = unfinished work") applied to this repo's own non-CDK code (the `patterns.ts` fix, the workflow YAML itself). Satisfied: `npm run typecheck`/`npm run lint`/`npm test` all re-run and reported with real counts (§7 below), not claimed.
- All other ADRs in the 35-entry catalog (CDK/IaC-specific devops ADR-0001–0007/0010; SE data/architecture/testing ADRs 0001–0007/0011–0021) — **NOT-APPLICABLE.** This round touches no AWS resource, no application domain/data model, no kernel/normalizer/policy surface. Checked against the full catalog (not assumed), consistent with `cross-domain-reviewer`'s own prior-round whole-catalog pass.

No ADR is UNCLEAR. No blocking question arises from this step.

## 2. Story restatement + acceptance criteria

**One sentence:** Land the four contained MED fix-now items from Stage-3 round 1 (Issues #125/#127/#128, plus red-team's un-filed LOW empty-PAT-precheck finding) inside the already-reviewed `cifix` diff, and separately fix the pre-existing, deterministic Issue #113 (`internal-hostname` pattern false-positiving on `settings.local`-shaped strings) so a real, human-triggered CI run can get past `npm test` (ci.yml step) and actually reach QA-14/OSS-01 downstream — while leaving Issue #120 (QA-14/QA-15's own real, separately-tracked failures) deliberately unfixed and disclosed.

**Acceptance criteria (numbered, testable):**
1. `ADR_REPO_PAT` never touches disk (`~/.gitconfig` or the rendered `run:` script body) at any point in the "Init adr submodule" step — verified by a same-step assertion, not just claimed. **(Issue #125)**
2. An empty/missing `ADR_REPO_PAT` fails the step immediately, by name, distinguishably from a gitlink-reachability failure or a bad-credential failure. **(red-team's un-filed LOW finding)**
3. The `adr` gitlink's pinned SHA is checked for remote reachability before the submodule fetch is attempted, with an error message that explicitly rules out "credential problem" as the cause. **DERIVED, load-bearing** — the exact mechanism (ref-tip `ls-remote` comparison vs. an arbitrary-SHA fetch) was not specified by the review report as a single unambiguous implementation; resolved by direct measurement this round (see §6) rather than guessed. **(Issue #127)**
4. `git submodule status`'s vacuous-pass gap is closed: the step asserts non-empty content under both `adr/devops` and `adr/software-engineering` after `git submodule update --init --recursive`, failing loud if either is empty. **(Issue #128)**
5. `npm test` passes 0-fail, 0-skip against the full, real repo history (not a narrowed/skipped OSS-01 run) — the root cause of Issue #113's `internal-hostname` false positive is fixed at the pattern level (regex precision), never by widening `docs/qa/secret-scan-allowlist.json` (would violate devops ADR-0008's ratchet-only rule). **(Issue #113)**
6. `npm run typecheck`/`npm run lint` stay clean. **(DoD)**
7. CHANGELOG reflects the widened scope and the real, current fix state (not the prior "AC3/AC4/AC5 not yet verifiable" language, now stale) — including an explicit disclosure that the very next real CI run (once the human provisions `ADR_REPO_PAT`) will likely still fail at QA-14/QA-15 (Issue #120), not at Checkout. **(cross-domain-reviewer's APPROVE-WITH-CONDITIONS condition)**
8. Issue #120 stays untouched (`src/qa/reference-resolver.ts`/`src/qa/completeness-claim-checker.ts`'s own logic not edited) — verified by keeping the diff confined to the files this plan names.

## 3. Risk tier

**CRITICAL** — unchanged from the original `cifix` ratification. Justification: `.github/workflows/ci.yml` is a CLAUDE.md-named sensitive area ("Secret scanning / CI gates") independent of which specific fix lands; this round's diff still touches that file plus the OSS-01 secret-scan pattern catalog directly. Persisted at `docs/.maat-state.json` (`scope: "cifix"`, `tier: "CRITICAL"`) — reused by `/maat:review`/`/maat:verify`, not re-derived.

## 4. Blocking questions

None outstanding — all three of the original `cifix` Phase 1 blocking questions and this round's scope-widening question were already ruled by the human (`docs/decisions.md`, 2026-09-09 rows). One design-level question surfaced and resolved without needing to escalate: **which mechanism proves gitlink-reachability (AC3) without producing a false failure on a legitimate non-tip pin?** Resolved by direct measurement (§6), not a guess — see the disclosed, non-blocking residual left in `docs/backlog.md`.

## 5. Constraints

- **devops ADR-0008**, ratchet-only rule — Issue #113 must not be fixed by broadening `docs/qa/secret-scan-allowlist.json`; the fix must be to the `internal-hostname` pattern's own precision.
- **CLAUDE.md sensitive area** — `.github/workflows/ci.yml` — `infra-security-reviewer`/`red-team`/`cross-domain-reviewer` reports already fresh and dated (2026-09-09); this round's changes stay inside the same reviewed shape (env-scoped credential, no `--global`), not a new mechanism requiring a fresh pre-build review round.
- **PRINCIPLES rule 18** (numbers measured, not assumed) — governs the gitlink-reachability mechanism choice directly (§6).
- **CLAUDE.md hard rule** — no hand-derived completeness claims: the "0 blocking secret-shaped matches" claim in OSS-01's own output is instrument-generated, not hand-typed; this plan does not add a new hand-derived completeness claim anywhere.
- Issue #120's files (`src/qa/reference-resolver.ts`, `src/qa/completeness-claim-checker.ts`) are out of bounds for this round — human-ruled, explicit.

## 6. Plan

**Files touched:**
- `.github/workflows/ci.yml` — collapse the "Configure credential" + "Init adr submodule" steps into one (`Init adr submodule (private repo, adr-only credential, scoped to this step only)`), scoped via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` env vars (never `git config --global`), with four ordered checks inside: PAT-presence precheck → gitlink-reachability check → submodule init → populated-content assertion → credential-residue assertion.
- `src/secret-scan/patterns.ts` — narrow the `internal-hostname` regex so a matched suffix must terminate the dotted name (negative lookahead excluding a trailing `.<alnum>` or `-<alnum>` continuation), closing the `settings.local.json` / `settings.local-shaped` false-positive class at the root, per the same "final segment must look real" precedent already used for `email-address` in this file.
- `src/secret-scan/patterns.test.ts` — regression tests pinning both the true-positive (`db01.internal` still matches) and the two false-positive shapes found in this repo's own history (`.json`-extension, `-shaped`-modifier).
- `docs/backlog.md` — disclose the gitlink-reachability check's known ref-tip-only limitation (measured, not assumed away).
- `CHANGELOG.md` — rewritten `cifix` entry reflecting all fixes + the Issue #120 downstream disclosure.
- `docs/plans/cifix-phase1-2026-09-09.md` — this file.

**Design decision requiring a spike (PRINCIPLES rule 17/18):** the gitlink-reachability check (AC3) initially planned to fetch the exact pinned SHA directly (`git fetch <url> <sha>`), on the assumption that GitHub supports fetching any commit reachable in a repo the credential can read. **Measured directly against a real public GitHub repo** (`torvalds/linux`, fetching a known old non-tip commit) — **the assumption was FALSE**: GitHub's server refuses with `fatal: remote error: upload-pack: not our ref` (exit 128) without `uploadpack.allowReachableSHA1InWant`, not enabled here. Corrected to `git ls-remote <url> | grep -q "$PINNED_SHA"` (ref-tip comparison) — the same mechanism `red-team`'s own report independently verified working against this exact repo/SHA. Disclosed limitation (a legitimate non-tip pin would misreport) recorded in `docs/backlog.md` rather than silently assumed away; confirmed non-live today by checking this repo's own gitlink-bump history (every bump has pinned `adr`'s branch tip at acceptance time).

**Verification plan (criterion → check):**
| # | Criterion | Check |
|---|---|---|
| 1 | PAT never touches disk | same-step `grep -rq "x-access-token" "$HOME/.gitconfig"` assertion, must find nothing |
| 2 | Empty/missing PAT fails fast, by name | `[ -z "${ADR_REPO_PAT:-}" ]` precheck, first in the script |
| 3 | Gitlink reachability checked, credential-failure ruled out in the message | `git ls-remote` + `grep`, dedicated `::error::` text |
| 4 | `adr/devops`/`adr/software-engineering` non-empty asserted | `ls -A` non-empty check on both paths |
| 5 | `npm test` 0-fail/0-skip | real `npm test` run, raw counts reported (§7) |
| 6 | typecheck/lint clean | real `npm run typecheck`/`npm run lint` runs |
| 7 | CHANGELOG accurate + Issue #120 disclosed | manual read-back against the actual fix state |
| 8 | Issue #120 files untouched | `git diff --stat` confined to the named file set |

**Rollout/rollback:** no runtime rollout — this is CI configuration + a scanner pattern. Rollback is a plain `git revert` of this diff; no migration, no data, no external state. `ADR_REPO_PAT` provisioning itself stays a separate, human-only action (unaffected by this round).

**Reviewers this tier requires:** `red-team` + the relevant domain reviewer(s) (`infra-security-reviewer` for the CI/secrets surface) + `cross-domain-reviewer` (standing, every tier above TRIVIAL) — re-confirmation round, same cast as Stage-3 round 1, per this project's established convention (each closes its own prior finding by re-running its own repro against the fixed code, not by trusting this report).

## 7. Test-first dispatch check

**Does this plan identify a new or changed UI flow or API surface? No.** This round is CI-workflow configuration (a YAML pipeline definition) plus an internal secret-scanning regex fix — no user-facing UI flow, no API contract, nothing `test-writer` black-box-tests. Per CLAUDE.md's STANDARD-tier reviewer table and the ship.md workflow-loop description, `test-writer` is not dispatched; this stays covered by `story-implementer`'s own unit tests (the `patterns.test.ts` regression cases) and the CI workflow's own real-command verification, unchanged. Phase 2 (build) proceeds directly from this plan.

---

## Closing note (appended 2026-09-09, post-round-3, before commit)

This plan predates — and, by design (PRINCIPLES rule 11, a persisted plan is not rewritten), never describes — everything that happened after Stage-3 round 1's own fix-now landed. Recorded here once, briefly, per `cross-domain-reviewer`'s round-3 suggestion (`docs/reviews/cifix-cross-domain-round3-2026-09-09.md`, finding 5/"Single next action" item 2), so a reader relying on this file alone knows where to look next rather than mistaking it for the story's final shape:

1. **Stage-3 round 2** (`docs/reviews/cifix-{red-team,infra-security,cross-domain}-round2-2026-09-09.md`) found the round-1 fix-now, once staged, re-broke `npm test` via OSS-01's own dogfood scan (new review-report/CHANGELOG/decisions.md prose containing unallowlisted pattern-shaped exemplars) — a structural scaling question, not a one-off bug.
2. That triggered a **design council** (rule 16(c), two consecutive `red-team` no-go rounds): `docs/reviews/cifix-{design-challenger-stopbrief,architecture,impact-analyst-council}-2026-09-09.md`, verdict **GO on Path A** (a mechanical, scoped allowlist patch covering this diff's own new strings) — **Path B** (a standing pre-commit dogfood check, zero new exemption-grant surface) ratified in principle but explicitly deferred to `docs/backlog.md` as its own future STANDARD-tier story, not part of `cifix`. Also folded in as fix-now: Issues #129 (GitHub fine-grained-PAT pattern), #130 (Issue #113's own over-broad narrowing, corrected with a true-positive regression test; #133 closed as a duplicate), #131 (the round-2 self-break itself), #132 (ls-remote credential/network-vs-gitlink-reachability message split), #134 (three new completeness-claim-count errors in this diff's own prose).
3. **Stage-3 round 3** (`docs/reviews/cifix-{red-team,infra-security,cross-domain}-round3-2026-09-09.md`) re-confirmed Path A's fixes hold, then surfaced one new HIGH (`red-team`, GitHub Issue #136 — the allowlist's exact-`path`+`patternId` join exempts a pattern in a file *forever*, not just this diff's strings; sharpest on 3 entries in `src/secret-scan/patterns.test.ts` that now permanently blind OSS-01 to credential patterns in that file) plus smaller MED/LOW items (Issue #135 — `github-fine-grained-pat` false-positiving on snake_case PAT-handling prose; the allowlist loader's reason-enforcement gap; a further completeness-claim miscount, the third recurrence of Issue #134's own defect class). **Human ruling: ship `cifix` with Issue #136 accepted as-is** (the residual folds into the already-deferred Path B follow-on, not a `cifix` blocker); the smaller round-3 items landed as a same-turn mechanical fix-now (no fresh review round — small/contained), documented in `CHANGELOG.md`'s item 10 and `docs/backlog.md`'s dedicated Issue #136 line.
4. The allowlist grew from this plan's original 5 entries to 22 across rounds 2–3, tracked and re-verified at every round via a real `git commit-tree` simulation of the actual diff-to-be-committed (never a stale or hand-simulated count) — the final such re-run, against the complete final tree including every round-3 artifact, is this story's own last build step before commit.

**Final shape, in one line:** Path A shipped as ratified; Path B is real future work, named and backlogged, not silently dropped; Issue #136's residual is a disclosed, human-accepted cost of Path A, not an unexamined gap.
