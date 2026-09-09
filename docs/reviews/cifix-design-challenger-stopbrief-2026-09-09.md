# cifix — Design Council Stop Brief (Apep, design-challenger)

**Mode:** Stop Brief (PRINCIPLES rule 16(c) — 2 consecutive non-clean Stage-3 rounds on `cifix`, both `red-team` `no-go`, no intervening clean/conditional-clean verdict from `red-team` specifically). I do not write a fix. I state what is proven, what is open, what has never been run, and grade the three candidate paths the Manager handed me.

**Scope:** `docs/.maat-state.json` → `scope: "cifix"`, tier **CRITICAL**. `humanRulingRequired: false` — clear to open this round. `reviewRoundsSinceClean: 2`.

**Read, in order:** `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, the 35-ADR catalog (fp `83b2e3e`, `adr/devops:12` + `adr/software-engineering:23`), `docs/reviews/cifix-{red-team,red-team-round2,infra-security,infra-security-round2,cross-domain,cross-domain-round2}-2026-09-09.md`, `docs/decisions.md`'s 2026-09-09 rows, `docs/plans/cifix-phase1-2026-09-09.md`, the live diff (`.github/workflows/ci.yml`, `src/secret-scan/patterns.ts`+`.test.ts`, `docs/qa/secret-scan-allowlist.json`, `docs/backlog.md`, `CHANGELOG.md`).

**Independent re-verification this session (not taken on any prior report's word):**
- `git status --short` — everything from round 2's diff is still uncommitted working tree; nothing has landed since red-team round 2. `gh secret list --repo mohannadrabie/thoth` — still empty; `ADR_REPO_PAT` still does not exist.
- `node --experimental-transform-types --test` — reproduced 660/660 pass, 0 fail, 0 skipped, in the **working tree**, matching every prior report's claim.
- Ran the `internal-hostname` regex directly against the current working-tree files (not `git commit-tree`, a simpler direct check): `src/secret-scan/patterns.ts` → 1 match (`settings.local`), `src/secret-scan/patterns.test.ts` → 4 matches (`db01.internal` x2, `settings.local` x2), `CHANGELOG.md` → 2 matches (`settings.local`, `db01.internal`). `docs/qa/secret-scan-allowlist.json` confirmed still exactly 5 entries — none for these three paths. This independently corroborates red-team round 2's `git commit-tree` simulation (`ok=false`) without relying on their script.
- Confirmed `.github/workflows/ci.yml:100` still reads `"This is NOT a credential problem"` unconditionally on any `ls-remote` failure branch — Issue #132 (the message-misattribution finding) is unfixed in the current tree.
- `gh issue view` on #113/#120/#125/#126/#127/#128/#129/#130/#131/#132/#133/#134 — states confirmed as below. Found **#130 and #133 are duplicate filings of the same defect** (infra-security-reviewer round 2 finding 3 and red-team round 2 finding 3, both "internal-hostname over-narrowing drops real FQDNs"), filed independently without a duplicate check — a CLAUDE.md Issue Discipline process gap, editorial, not a design defect, noted below.

**ADR cache:** 📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp `83b2e3e`) [CACHE=HIT]

---

## 1. PROVEN / OPEN / NEVER RUN

### PROVEN (frozen — do not re-litigate without new evidence)
| # | Claim | Evidence |
|---|---|---|
| P1 | The submodule-checkout credential mechanism (`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, step-scoped, never `--global`) is genuinely credential-safe. | Demonstrated independently by **both** `red-team` round 2 and `infra-security-reviewer` round 2: zero `~/.gitconfig` residue (positive control on the old `--global` pattern proves the assertion is load-bearing, not decorative), step-scope isolation confirmed in a fresh subshell, no `$GITHUB_ENV`/argv/debug-flag leak path found by either reviewer attacking independently. **Issue #125 CLOSED.** |
| P2 | The gitlink-reachability mechanism itself (ref-tip `git ls-remote` comparison) is sound. | Demonstrated live against the real `mohannadrabie/adr` remote by both red-team rounds; the rejected alternative (bare-SHA `git fetch`) was measured wrong against `torvalds/linux` (exit 128) and correctly abandoned, disclosed rather than hidden. **Issue #127 CLOSED** (the mechanism — its *message wording* for a credential-failure sub-case is a separate, still-open finding, Issue #132, see below). |
| P3 | The populated-content assertion is non-vacuous. | Positive control (12+23 real files) and two negative controls (deleted / present-but-empty) both behave correctly, reproduced independently by both reviewers. **Issue #128 CLOSED.** |
| P4 | No `GITHUB_TOKEN` widening, no fork-PR secret exposure, no cross-job/runner-reuse leak. | Code-traced by red-team (`permissions: contents: read` unchanged, no `pull_request_target`, repo confirmed PRIVATE and not a fork, `--local` vs `--global` `extraheader` scoping traced through `actions/checkout`'s own source). Independently re-confirmed clean both rounds. |
| P5 | Issue #113's own original defect (false-positive on `settings.local`-shaped strings) is fixed **at the pattern**, not by widening the allowlist. | `git diff --stat -- docs/qa/secret-scan-allowlist.json` empty (re-confirmed this session); mutation-tested by reverting the regex in place (test goes red, restored) by both red-team and infra-security independently; measured across all 242 tracked files and 67,410 added lines of full history that the narrowing suppresses **only** `settings.local` (47/47) — zero real detections lost. **Not yet reflected on GitHub — Issue #113 is still OPEN** because nothing has been committed yet (this is expected, not a discrepancy).

### OPEN (genuinely unresolved — need a decision or a fix before this scope ships)
| # | Issue | What it is | Severity/evidence |
|---|---|---|---|
| O1 | **#131 / #126** | Committing the diff **as currently staged** re-breaks `npm test`: OSS-01 scans committed blobs, not the working tree, and the fix's own fixtures/comments/CHANGELOG prose contain unallowlisted `internal-hostname`-shaped strings. Independently reproduced this session (see above) and by red-team's `git commit-tree` simulation (`ok=false`, 7-11 blocking matches). Issue #27's substance (QA-14/OSS-01 never executing) would remain unchanged even after a real commit. | demonstrated, code-traced |
| O2 | **#132** | `ls-remote` failure message asserts "This is NOT a credential problem" unconditionally — including on the branch where `ls-remote` itself failed because of a bad/expired/revoked PAT, which **is** a credential problem. Confirmed still present at `ci.yml:100`. | demonstrated |
| O3 | **#130 / #133** (duplicate filing, same defect) | Issue #113's fix narrows too far: a blanket lookahead disqualifies *any* dot/hyphen continuation, silently dropping real multi-label internal FQDNs (`host.corp.contoso.com`-shaped). Measured 0% real loss today across full history; no regression test guards the true-positive class going forward. | demonstrated, code-traced; exposure 0% measured today |
| O4 | **#129** | `github-pat` pattern (`gh[pousr]_...`) does not match GitHub's fine-grained PAT format (`github_pat_...`) — the exact format `ADR_REPO_PAT` itself uses. Defense-in-depth backstop gap only; the primary defense (P1, never touches disk) already covers the credential under normal operation. | demonstrated, code-traced; requires a compound failure to matter |
| O5 | **#134** | This diff's own CHANGELOG/decisions.md prose adds 3 new unmarked numeric completeness claims (violates CLAUDE.md's hard rule), including two that are simply **wrong**: "10 of 10 push/PR runs" (measured 12), "readable by all 23 later steps" (the job now has 25 steps). Worsens the pre-existing, already-tracked Issue #120 QA-15 failure rather than staying neutral to it. | demonstrated (measured before/after with the actual instrument) |
| O6 | **Structural, no Issue number — the design question this brief exists to answer** | OSS-01's allowlist is exact-path-only. Every future PR/report/plan that must legitimately cite or exemplify a secret-shaped string needs its own permanent entry, forever. This has already bitten twice inside one round: this round's own new fixtures/comments/CHANGELOG (O1), and red-team's own two persisted reports (self-disclosed in round 2 — the fake-token lab line, the internal-hostname examples throughout). | derived (a maintenance-burden projection, not a live defect) |
| O7 | Process, editorial | #130 and #133 are duplicate filings of the identical finding — CLAUDE.md's Issue Discipline "duplicate check first" rule was not followed by one of the two filing reviewers. Non-blocking, does not affect verdict; comment-and-close-one is the correct mechanical fix, not a re-review. |

### NEVER RUN
| # | What | Status |
|---|---|---|
| N1 | A real CI job execution on `ubuntu-latest` with a real `ADR_REPO_PAT` secret. | `gh secret list` confirmed empty this session. Zero evidence on Linux-vs-Windows path assumptions, whether `npm ci` succeeds on the runner, or how QA-01/QA-05/QA-16/OSS-01 behave with `adr/` populated for the first time in this job's history. Every local repro in every report (mine included) ran on `win32`. |
| N2 | The end-to-end drill named by red-team across both rounds (`ci-green-end-to-end-drill` / `oss01-post-commit-dogfood-drill`). | Not executed. This is the only thing that can legitimately close Issue #27. |
| N3 | Issue #120 (QA-14/QA-15 unconditionally red, `issueExists: () => null` hardcoded) | Confirmed still red this session (both instruments re-run, exit 1). Already tracked, explicitly out of `cifix`'s scope by human ruling, correctly disclosed in the CHANGELOG per `cross-domain-reviewer`'s condition. **Will make the first real CI run fail even after O1-O5 above are all fixed** — expected, not a regression, not this scope's problem to solve. |

---

## 2. Candidate paths — residual register + never-run, per path

### Path A — mechanical patch (allowlist entries + re-verify), no architecture change
**Action:** add allowlist entries for `patterns.ts`/`patterns.test.ts`/`CHANGELOG.md` (+ the two already-committed-when-this-lands `docs/reviews/cifix-red-team*.md` reports, self-disclosed by red-team as needing the same treatment); re-run the `git commit-tree` simulation until `ok=true`. Bundle in the same commit: O2's message fix, O3's narrower lookahead + the named true-positive regression test both reviewers already specified, O4's one new pattern + test, O5's two numeric corrections. None of these require new topology — every fix is a one-line/one-pattern/one-message change against a mechanism already twice-reviewed.

**Residual register after Path A ships:**
- **O6 (allowlist scaling)** — explicitly NOT closed by this path; accepted as an ongoing cost. Trigger: the next PR/report/plan that needs to cite an example secret-shaped string. MED, derived, reach=operator, likelihood=routine, undo=reversible (each future occurrence is just another allowlist line in a normal PR). Not boundary-crossing (a maintenance-burden question, not a security bypass) — legitimately residual-register eligible.
- Issue #120 (N3) stays open, disclosed, unaffected by path choice.

**Never run after Path A:** N1/N2 unchanged — provisioning `ADR_REPO_PAT` and running the real drill is orthogonal to which path is chosen.

**My verdict: SURVIVES**, evidence=demonstrated (I independently reproduced the break this session; every fix is a pattern already used elsewhere in this same file — allowlist entries with a one-line reason, negative-lookahead narrowing, pattern-catalog additions — not a novel mechanism). No open calibrated blocking HIGH stands against Path A once O1 lands (see §3's recalibration).

### Path B — scanner-level exemption marker (in-file convention, checked at scan time)
This is new topology on a **security-enforcing scanner** — a comment/fence convention that suppresses detection at scan time is itself a new trust surface on the one mechanism whose entire job is to catch things people didn't mean to expose. The marker becomes a candidate bypass vector by construction: wrap a real secret in the marker and, depending on design, OSS-01 might not flag it. That is exactly the shape of decision PRINCIPLES rule 15 and my own lane discipline route to `architecture-reviewer`, not to a Stop Brief verdict.

**Residual register if built (open questions an architecture pass must answer, not designed here):**
- Does the marker require the same reviewer-visible ceremony as a committed allowlist line, or does it let a contributor self-exempt with no second pair of eyes?
- Is the marker's scope character-range-bound or whole-file — how much real-secret surface could a wrapped comment hide?
- Does a marked match still get **reported** (the current allowlist design explicitly still reports allowlisted matches, never silently drops them) or does the marker suppress reporting entirely — a materially different security posture.

**Never run:** the mechanism has zero real-world exercise; N1/N2 still apply on top.

**My verdict: UNPROVEN** — no code exists to attack. Grading a design nobody has written is exactly what PRINCIPLES rule 11 warns against (a HIGH against code that doesn't exist is unprovable, not a blocker). **Routed to `architecture-reviewer`** if this project wants to pursue it later; not a blocker to shipping Path A now, and I do not bless or reject its shape here.

### Path C — keep examples out of scanned content (obfuscate/synthesize)
No architecture change, but two problems I can verify directly rather than assume:
1. **Doesn't scale better than Path A.** It substitutes a manual "remember to obfuscate" convention for a manual "remember to allowlist" one — and unlike Path A's allowlist (a committed, reviewable, greppable list that a CI-gating instrument itself checks), Path C's compliance is invisible: nothing in this repo checks whether a new doc/fixture actually obfuscated its example strings. A future author who forgets reproduces exactly O1's break, with no mechanism to catch it before commit.
2. **Doesn't apply retroactively.** Red-team's own two persisted reports already contain real, non-obfuscated example strings, and this project's Issue Discipline treats a report as append-only/never rewritten after creation. Path C cannot un-write what's already committed — those two reports still need Path A's allowlist mechanism regardless of which path wins going forward.

**My verdict: SURVIVES-BUT-WEAKER-THAN-A** for new content only; does not obsolete Path A even if adopted. Evidence=derived (a policy-choice trade-off, nothing to run) — capped at MED by construction either way, not a blocker. Could be layered on top of Path A later as a style preference for *new* fixtures; never a substitute for it.

---

## 3. Verdicts, and whether an open calibrated blocking HIGH remains

- **Path A: SURVIVES**, contingent on O1 (the self-inflicted OSS-01 re-break) being fixed before any commit — mandatory, not optional, see the ADR-MUST route below. O2/O3/O4/O5 are cheap, already fully specified by two independent reviewers, and should ride the same commit, though none of them individually forces that (see boundary-crossing check below).
- **Path B: UNPROVEN**, routed to `architecture-reviewer`, not gating Path A.
- **Path C: SURVIVES-weaker**, non-blocking style option, never a replacement for Path A.

**Adversarial self-check on red-team's own HIGH tag (PRINCIPLES rule 11):** red-team round 2 tagged O1 `[HIGH]`. Under design-challenger's calibration, HIGH requires `reach=user` with a named entry point — "a real user hits it through the product." `cifix` is CI/build tooling: the actor who triggers O1 is an engineer or agent **committing code**, not an end user of a shipped product surface. That is `reach=operator`, not `reach=user`. Separately: O1's failure is **loud** (CI goes red, blocks merge — the opposite of a silent divergence) and `undo=reversible` (a plain `git revert`, no data or migration at stake) — `undo=reversible` downgrades one level unless the failure is silent, and this one is not. Both facts independently cap O1 at **MED** under my rubric, not HIGH.

**This recalibration does not mean O1 is safe to ship as-is.** Devops **ADR-0008**'s MUST — *"MUST NOT merge a PR with any blocking gate open, failing, or pending"* — is violated the instant this diff is committed uncorrected, and an Accepted ADR's MUST outranks my own severity calibration (PRINCIPLES rule 9; my own instructions: "A design that violates an Accepted ADR's MUST is a BREAK"). **Verdict: BREAKS, via the ADR-MUST route, independent of the severity tag** — O1 must be fixed before any commit, full stop; this is not a residual-register candidate under any path.

**Net: no OPEN calibrated blocking HIGH exists under my rubric on any path.** The one thing that must happen before Path A ships is not a design-challenger HIGH — it's an ADR-0008 MUST, and it's already fully specified (add the allowlist entries, re-run the simulation to `ok=true`).

**Boundary-crossing check (O2/O3/O4/O5):** none of these bypasses or weakens an actual security boundary today — P1 (the credential-handling primary control) is proven sound independent of all four; O3/O4 are defense-in-depth **backstop** misses on a scanner whose primary job (never touching disk) already covers the live credential; O2 is a diagnostic-message-quality issue on a check that already fails loud (no silent degradation); O5 is document hygiene. None is forced to the mandatory-proof-test carve-out — all four legitimately CAN residual-register. Recommending they ride Path A's same commit anyway because they're free (already named, already scoped by two independent reviewers), not because they're required to.

---

## 4. Frozen set

Do not re-litigate without new evidence (a test run, a measurement, a code change):
- **P1** — the `GIT_CONFIG_*` env-var credential-scoping mechanism. Proven credential-safe by two independent reviewers across two rounds.
- **P2** — the `ls-remote` ref-tip gitlink-reachability mechanism (its *logic*, not its message wording — the message is O2, open).
- **P3** — the populated-content assertion, proven non-vacuous with positive and negative controls.
- **P4** — no `GITHUB_TOKEN` widening, no fork-PR path, no cross-job leak.
- **P5** — Issue #113's own original false-positive defect, fixed at the pattern level, ratchet rule honored, non-vacuous.

---

## Editorial (verdict-neutral)
1. Issues #130 and #133 are duplicate filings of the same defect (O7 above) — comment cross-linking one to the other and closing the duplicate is a plain housekeeping action, not a re-review.
2. CHANGELOG's "23 later steps" (O5) is stale even independent of the numeric-claim rule — the `ci` job has 25 steps today (`Init adr submodule` collapsed 2 steps into 1, but 2 QA/OSS steps were added since the line was written).

---

## Single scariest unproven assumption
That fixing O1 (the allowlist) is the end of the story. It is not: Issue #120 (N3) guarantees the **first real CI run**, even after every item in this brief is closed, will still go red — at QA-14/QA-15, not at Checkout, not at OSS-01. That is already disclosed and already out of scope, but it means "green CI" is not the correct near-term success criterion for `cifix` itself; "reaches OSS-01 and passes it" is. Conflating the two on the next status update would recreate exactly the kind of overclaim this whole `cifix` thread exists to correct.

## Recommendation
**Build now — Path A.** Fix O1 before any commit (ADR-0008-gated, mandatory). Bundle O2/O3/O4/O5 into the same commit since they are already fully specified and cheap (all four are named, scoped, one-line-to-one-pattern fixes from two independent reviewers — no new review round needed to know what to write). Then run N1/N2 (the human provisions `ADR_REPO_PAT`, pushes to a throwaway branch, confirms via `gh run view` that Checkout → Init adr submodule → npm test → OSS-01 all report `success`, while expecting QA-14/QA-15 to still fail per Issue #120). Route Path B (the scanner-marker idea) to `architecture-reviewer` as a future backlog item — not a blocker. Do not adopt Path C as a replacement for Path A; it may layer on top for new fixtures going forward, at the human/team's discretion.

No calibrated HIGH is open. The Manager's call: whether O1-O5 land as one more fix-now commit under this same `cifix` scope (my recommendation) or whether council convening itself counts as the "round" that resets `reviewRoundsSinceClean` before a fresh `red-team`/`infra-security-reviewer` re-confirm — that procedural choice is the Manager's, not mine.

---

```
RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated/operator/routine/reversible][~100% of commits of this diff as staged] O1/#131/#126: committing this diff as currently staged re-breaks npm test (OSS-01 scans committed blobs; fixtures/comments/CHANGELOG contain unallowlisted internal-hostname strings) -- independently reproduced this session via direct regex test against the working tree; recalibrated from red-team's HIGH tag to MED under design-challenger's reach/undo rules (reach=operator not user, fails loud not silently, git-revertible), but verdict is still BREAKS via devops ADR-0008's MUST ("no merge with a blocking gate failing") -- fix is mandatory before any commit regardless of severity tag.
2. [ISSUE][MED][demonstrated/operator/plausible/reversible][100% of expired/revoked-PAT runs] O2/#132: ls-remote failure message asserts "This is NOT a credential problem" even when ls-remote itself failed on a bad/expired/revoked PAT -- confirmed still present at ci.yml:100. Defense: fails loud (raw git error visible 2 lines above), but the surfaced ::error:: denies the true cause.
3. [ISSUE][MED][demonstrated/instrument/plausible/reversible][0% measured exposure today] O3/#130+#133 (duplicate filing): Issue #113's fix over-narrows, silently drops real multi-label internal FQDNs; measured 0/immeasurable real loss across full history today, no regression test guards the true-positive class. Defense: the FP-suppression case itself is proven correct and narrow (only settings.local suppressed, measured).
4. [ISSUE][MED][demonstrated/instrument/operator-error/reversible][compound-failure required] O4/#129: github-pat pattern misses the fine-grained PAT format ADR_REPO_PAT itself uses. Defense: primary control (P1, credential never touches disk) already covers it under normal operation -- this is a defense-in-depth backstop gap only.
5. [ISSUE][LOW][demonstrated/instrument/routine/reversible][100% of this diff's own CHANGELOG entry] O5/#134: this diff's own CHANGELOG/decisions.md prose adds 3 new unmarked numeric completeness claims, two of them simply wrong (10 vs measured 12; 23 vs actual 25 steps) -- worsens the already-tracked Issue #120 QA-15 failure. Defense: none; cheap, mechanical fix.
6. [SUSPICION][MED][derived/operator/routine/reversible][unbounded, basis: assumption -- projected recurrence] O6: OSS-01's allowlist is exact-path-only -- every future PR/report/plan citing an example secret-shaped string needs its own permanent entry forever; already bit twice this round (this round's own fixtures, red-team's own 2 reports). Not itself a live defect -- a design question, routed as candidate paths A/B/C in this brief, not a blocking finding.
7. [CLEAN][demonstrated] P1 -- GIT_CONFIG_* credential-scoping mechanism proven credential-safe by 2 independent reviewers, 2 rounds: zero .gitconfig residue, positive control fires on the old vulnerable pattern, step-scope isolation confirmed in a fresh subshell. Issue #125 CLOSED.
8. [CLEAN][demonstrated] P2 -- ls-remote ref-tip gitlink-reachability mechanism (the logic, not the message) sound: drilled live against the real adr remote by both red-team rounds; the rejected bare-SHA-fetch alternative was measured wrong against torvalds/linux and correctly abandoned. Issue #127 CLOSED.
9. [CLEAN][demonstrated] P3 -- populated-content assertion non-vacuous: 1 positive control (12+23 real files) + 2 negative controls (deleted / present-but-empty), reproduced independently by both reviewers. Issue #128 CLOSED.
10. [CLEAN][code-traced] P4 -- no GITHUB_TOKEN widening, no fork-PR secret path, no cross-job/runner-reuse leak -- traced through actions/checkout's own --local vs --global extraheader scoping, confirmed clean both rounds.
11. [CLEAN][demonstrated] P5 -- Issue #113's own original false-positive defect fixed at the pattern (not the allowlist): git diff on the allowlist file empty, mutation-tested (revert regex in place -> test goes red), measured across 242 tracked files + 67410 added lines of full history that only `settings.local` is suppressed (47/47) -- zero real detections lost. Not yet reflected on GitHub only because nothing is committed yet (expected).
12. [CLEAN][demonstrated] N3/Issue #120 (QA-14/QA-15 unconditionally red) independently re-confirmed still red this session, correctly disclosed in CHANGELOG per cross-domain's condition, explicitly out of cifix's scope by human ruling -- will make the FIRST real CI run fail regardless of anything in this brief, expected not a regression.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=5 suspicions=1 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=10 code-traced=1 derived=1
round=3 roundsSinceLastGo=1 frozen=5 residuals=5 unrun=3 editorial=2
checks=npm test 660/660/0/0 (independently re-run, exit 0); direct internal-hostname regex test against working-tree patterns.ts/patterns.test.ts/CHANGELOG.md -> 1/4/2 unallowlisted matches (corroborates red-team's commit-tree ok=false independently); git status confirms nothing committed since round 2; gh secret list still empty; ci.yml:100 message confirmed still present (O2 unfixed); allowlist file confirmed still 5 entries (O1 unfixed); gh issue view on 12 issue numbers cross-checked, #130/#133 found duplicate
adr=HIT(35)
report=docs/reviews/cifix-design-challenger-stopbrief-2026-09-09.md
```
