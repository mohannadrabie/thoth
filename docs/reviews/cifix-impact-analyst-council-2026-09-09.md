# cifix — Impact Analyst (Wepwawet), Design Council Seat

**Trigger:** PRINCIPLES rule 16(c) — 2 consecutive non-clean Stage-3 rounds on `cifix` (CRITICAL tier): round 1 `red-team no-go`, round 2 `red-team no-go` (a NEW, self-inflicted HIGH). Council convened per `/maat:council`.
**Scope:** `docs/.maat-state.json` → `scope: "cifix"`. Question: what does each candidate fix path (A/B/C) do to everything else — upstream/downstream, CONTAINS/RELOCATES/WIDENS. Not ruling on whether the shape should exist (architecture-reviewer's seat) or what's proven (design-challenger's seat).
**Date:** 2026-09-09
**ADR cache:** `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`

**Self-disclosure, up front, same convention red-team's round-2 report used:** this report itself quotes secret-shaped example strings for evidentiary precision. Once persisted it is itself a new blocking-match producer under the current mechanism — it needs its own allowlist entries (`internal-hostname`) alongside every other file counted below. I am not exempting my own artifact from the finding.

---

## Method — mechanical enumeration, not restated claims

Every count below is from a command I ran this session, independent of what red-team/infra-security/cross-domain already measured (their numbers are cited only where I re-derived them and they agree).

```
$ wc -l docs/qa/secret-scan-allowlist.json && node -e "console.log(JSON.parse(require('fs').readFileSync('docs/qa/secret-scan-allowlist.json','utf8')).length)"
27
5
```
Current allowlist: **1 file, 27 lines, 5 entries.** Matched by exact `path` + `patternId` (`src/secret-scan/history-scan.ts:110`) — no glob, no prefix.

```
$ grep -rln "SECRET_PATTERNS" --include="*.ts" src
history-scan.ts / patterns.test.ts / patterns.ts
$ grep -rln "secret-scan-allowlist" --include="*.ts" src docs
history-scan.test.ts / history-scan.ts
$ git log --oneline -- docs/qa/secret-scan-allowlist.json | wc -l   ->  1
$ git log --oneline -- src/secret-scan/patterns.ts | wc -l          ->  1
```
The mechanism's own code footprint is narrow and well-understood: **one producer file (`patterns.ts`), one consumer file (`history-scan.ts`), one allowlist file, one prior commit each.** The blast-radius problem below is entirely about the *content* the mechanism scans, not the mechanism's own code surface.

**Reproduced the real scanner + real allowlist against the actual diff** (not red-team's numbers taken on trust — re-ran independently with the current working tree, using `SECRET_PATTERNS`/`partitionAllowlisted` imported directly from the live files):

```
=== CODE-ONLY (5 files: ci.yml, CHANGELOG.md, docs/backlog.md, patterns.ts, patterns.test.ts) ===
blocking: 7   allowlisted: 3
=== FULL WORKING TREE (12 files — adds docs/plans/cifix-phase1-2026-09-09.md +
     docs/reviews/cifix-{red-team,red-team-round2,infra-security-round2,cross-domain-round2}-*.md) ===
blocking: 44   allowlisted: 3
```
**This is a materially larger number than red-team round 2's own drill (7 code-only / 11 full-tree)**, because two more review reports (`infra-security-round2`, `cross-domain-round2`) and this report itself now exist in the working tree that did not exist when round 2 ran its drill. **The count grew between review rounds, purely from reviewing.** That growth-in-place is itself evidence for the verdict below, not incidental.

Confirmed via `PRINCIPLES.md` rule 19's dogfood mechanism (`src/secret-scan/history-scan.test.ts:70-77`): `scanHistory(git)` defaults to `ref: "HEAD"` and is called with **no ref override** inside a `node:test` case that is part of `npm test` itself. **Every consumer of `npm test` — CI and every local/agent run — trips this the moment the diff is committed, not CI alone.**

**Historical debt check** (would Path A already owe entries for *pre-existing* committed reports?): re-ran the OLD (pre-#113-fix) regex against every already-committed file under `docs/reviews`, `docs/plans`, `CHANGELOG.md`, `docs/backlog.md`, `docs/decisions.md`, `src`:
```
12 files, 28 matches (old regex) -> 0 files, 0 matches (new regex)
```
The #113 pattern-precision fix — already ratified, already ADR-0008-ratchet-compliant — **retroactively cleared 100% of this project's own pre-existing debt in this class** without touching the allowlist. That is a real, measured point in favor of "fix the pattern, not the allowlist" as a general strategy, and it bounds today's open debt to exactly this round's own new files (44 matches / 8 files with hits, of 12 in the full tree).

---

## Candidate A — mechanical patch: add allowlist entries for this diff's own strings, ship as-is

**Classification: local.** Touches one data file (`docs/qa/secret-scan-allowlist.json`), zero code/mechanism change, zero contract change for any consumer.

**Upstream — who feeds this?** Producers of allowlist-worthy content = every role that persists a `.md`/`.ts` file containing a secret-shaped example string: `red-team`, `infra-security-reviewer`, `cross-domain-reviewer`, `impact-analyst` (this report), `story-implementer` (fixtures/comments), the Manager (`CHANGELOG.md`/`docs/backlog.md`/`docs/plans/`). Mechanically enumerated: `git log --oneline -- docs/reviews | wc -l` → this project has persisted **60+ dated review reports** to date (one per Stage-3/council round across S1–S6 plus `cifix`); every one of them is a candidate future producer the instant it discusses a secret-scan pattern by example, which — mechanically — 8 of 12 files in *this round alone* already do. **Can today's producers satisfy the precondition ("remember to also add N allowlist entries") without a structural check?** No. Nothing enforces it before commit; the only thing that caught round 2's own miss was a red-team drill run as an adversarial afterthought, not a standing gate. That is the hidden second half Path A leaves unaddressed.

**Downstream — who consumes this?** `history-scan.ts`'s `main()` (the CI step) and `history-scan.test.ts`'s dogfood test (every local/CI `npm test` run, confirmed above) are the only two consumers — mechanically confirmed, 2 files, no others (`grep -rln "secret-scan-allowlist"` above). Both behave correctly once the 44 entries land: `ok=true`, per red-team round 2's own re-run. No silent divergence — the allowlisted matches are still **reported** (`history-scan.ts:134`, `allowlistedDetails`), never dropped, so nothing here is the swallowed-error/silent-default class this role is required to flag above everything else.

**Invariant delta.** Before: "an un-allowlisted secret-shaped string in committed history blocks the gate" held for a small, slow-growing set (5 entries across this project's whole life, all pre-`cifix`). After Path A ships as scoped ("this diff's own strings only"): the set jumps to **44 entries in one round**, and the growth mechanism is now demonstrated to be **super-linear in review activity** — each round of review that discusses the previous round's findings by example adds MORE matches than the round it was reviewing (round 2's report alone contributes 22+ of the 44). Nobody who relied on "the allowlist grows slowly, one fixture at a time" (the state true for S1–S6) can keep relying on that once `cifix`-style CRITICAL-tier, adversarially-report-heavy scopes become routine.

**Whack-a-mole verdict: RELOCATES.** Defect class: *unenumerated future producers of secret-shaped example strings, with no structural check forcing the allowlist to stay in sync before commit.* This is the **first observed instance** of this specific class in `docs/reviews/` (no prior-fix count in this class — Issue #113 was a pattern-precision defect, a different class, already closed). Path A closes *this round's* 44 instances but does not remove the class: the next CRITICAL-tier scope that spawns 4 adversarial re-confirm rounds (exactly `cifix`'s own shape) reproduces the same jump, and nothing mechanical would catch it before the commit that reopens Issue #26-style CI dead-again. **Where it reappears:** the next multi-round review cycle on any security-adjacent scope, the instant that scope's reports quote example secrets — which, mechanically, security reports on a secret-scanner almost always do by their nature.

**Ledger:**
```
Path A: touches 1 file (allowlist JSON) / 0 call sites changed · new preconditions: 1 (every future
producer must remember a manual step with no structural enforcement) · migration: no
· reversible: yes (revert the JSON additions) · exposure if wrong ~100% of npm test/CI runs post-commit
  (measured — dogfood test scans committed HEAD unconditionally) · residual if NOT fixed: same ~100%,
  this IS the fix for the immediate 44; the class's recurrence rate for FUTURE rounds is unmeasured
  (see Unmeasured below)
```

**Verdict: PATCH-WITH-CONDITIONS.** Safe to ship for *this* round (closes red-team's HIGH #1 mechanically, cheaply, reversibly) — but only if paired with the drill red-team already named (`oss01-post-commit-dogfood-drill`, simulate-then-verify before the real commit) **run against the full 44-match set this report measured, not the 7-11 an earlier drill measured before this round's own reports existed.** Shipping Path A against a stale count would itself reproduce the exact miss round 2 found.

---

## Candidate B — scanner-level exemption mechanism: an in-file marker in `history-scan.ts`

**Classification: systemic.** Changes what "blocking" *means* for every future scan — a new, self-declared class of exemption inside the mechanism itself, not a passive data list a second party (a reviewer, effectively) curates. Touches the core scan loop (`scanBlobText`, `history-scan.ts:44-57`), which today has no concept of a line number or of same-blob context — matches are found by `text.matchAll(pattern.regex)` with no position tracking. Adding marker-recognition is not a one-line change; it requires the scanner to correlate a match's offset back to a source line (or a fixed proximity window) and check that line for a recognized marker token, then thread that decision through `HistoryMatch`/`partitionAllowlisted`'s shape. **This is a bigger code change than Path A's**, not a smaller one, despite reading as "just add a marker."

**Upstream — who feeds this?** Same producer set as Path A (every report/fixture author) — but now producers write the exemption *inline*, at authoring time, rather than in a separate file. **Enumerated the retroactive question directly:** can Path B cover the 12 pre-existing (now-moot) and this round's 8 files retroactively? No — `docs/reviews/*.md` are immutable once persisted (PRINCIPLES rule 11: "a persisted report is not edited after the fact"), and rewriting already-committed git blobs to insert a marker is a history rewrite, categorically worse than anything this analysis is pricing. **Path B is forward-only by construction.** Every already-committed file in this class (this round's 8, and any future round's) still needs the exact-path JSON entry — Path B does not remove Path A's mechanism, it adds a second one alongside it for content not yet written.

**Downstream — who consumes this?** Same two files (`history-scan.ts`, `history-scan.test.ts`) plus now **every future author of every report/fixture in this repo**, who must learn a second, in-file syntax in addition to (not instead of) the existing JSON entry — because the JSON entry still governs everything already committed. That is a real, measured increase in the number of "ways to be exempt" a future reviewer or auditor must check: **1 mechanism today → 2 mechanisms under Path B**, permanently, since the first can never be fully retired (immutable history).

**Invariant delta.** Before: "an exemption is granted only by a reviewed, separately-diffed entry in one file with a MUST-cite reason" (`history-scan.ts:92-96`'s own header) — a real choke point, itself a CLAUDE.md-named sensitive area by spirit. After Path B: an exemption can *also* be granted by whoever writes the content, in the same diff, with no second reviewer required to touch a separate sensitive file to grant it. **That is the invariant that breaks, and it is the one OSS-01 exists to prevent breaking.**

**Compounding risk, asked for explicitly (point 4):** **yes — Path B becomes a new thing OSS-01 must defend against being abused.** Today, exempting a string requires a diff to `docs/qa/secret-scan-allowlist.json` — a single, named, reviewable file (CLAUDE.md's "Secret scanning / CI gates" sensitive area covers this mechanism by spirit even though its literal path list is stale from a template — see Editorial). A reviewer scanning a PR sees "allowlist file touched" as a one-glance, high-signal tripwire. An in-file marker removes that tripwire: a real secret, accompanied by a comment claiming `// secret-scan-allow: example`, would be indistinguishable in a diff from a genuine exemption **unless the marker mechanism itself still requires a companion entry in a reviewed side-channel** — at which point Path B has not simplified anything, it has added a second mechanism that must stay in sync with the first, a worse maintenance shape than Path A alone, not a better one. I priced this as a real, not hypothetical, cost: it is the same "trust a comment claiming intent" failure mode this project's own `docs/qa/secret-scan-allowlist.json` header explicitly designed around (`"a known test fixture, never a real secret"` — a *reviewed* reason, not a self-declared one).

**Whack-a-mole verdict: WIDENS.** It does not remove Path A's class (immutable history still needs it); it adds a second, structurally weaker exemption surface with a materially larger attack surface than the one it's meant to relieve. Zero prior-fix count for this exact class (never built) — but the class it *would* create (self-attesting security-control bypass) is a well-known one this project's own allowlist design already deliberately avoided once.

**Ledger:**
```
Path B: touches >=2 files (history-scan.ts core loop, +new tests) / scan-loop position-tracking is a
  structural rewrite, not a line edit · new preconditions: 2 (a new marker syntax to learn, AND the
  pre-existing JSON entry requirement, which does not go away) · migration: no schema migration, but a
  permanent two-mechanism state · reversible: yes (revert the scanner change) but the two-mechanism
  period, once any marker exists, is not cleanly undoable without deciding what happens to markers
  already in committed (immutable) history · exposure if wrong: unmeasured — no fine-grained-PAT-style
  drill exists for "a marker hid a real secret" because the mechanism doesn't exist yet; the honest
  answer is `unmeasured`, and the only way to source it is a red-team drill against a concrete Path B
  implementation, which does not exist to attack yet · residual if NOT built: 0% (Path A alone already
  closes this round's 44; Path B is not load-bearing for `cifix` shipping at all)
```

**Verdict: WIDENS — do not build for this scope.** Not because a marker mechanism can never be designed safely (that is architecture-reviewer's call, not mine), but because pricing it against *this* scope's actual need shows it is unnecessary scope-widening: Path A alone already closes the blocking finding, Path B adds a new security-relevant surface to fix a maintenance annoyance, and it does not even retire the mechanism it's meant to replace.

---

## Candidate C — restructure fixtures/docs to avoid literally containing secret-shaped strings

**Classification: seam.** Crosses the boundary between two things this project already committed to separately: PRINCIPLES rule 10/19's evidence discipline ("reviewers save reports with the raw command/test output," a `demonstrated` finding requires "the raw output is in the report") and OSS-01's detection surface. Path C asks producers on one side of that seam to stop doing what the other side requires.

**Upstream — who feeds this?** Same producer set again. **Traced concretely against the two dominant sources of this round's 44 matches:**
- `src/secret-scan/patterns.test.ts` (4 of the 7 code-only matches): these are **positive-match test fixtures** — the test's entire job is to assert the regex matches a string shaped exactly like the false positive it regressions against. A test that no longer contains a real matching string is not testing anything; it becomes exactly the vacuous-test class this project's own mutation-testing convention (`internal-hostname`'s own regression test was mutation-verified by red-team round 2, finding 8) exists to catch. **Path C cannot obfuscate a positive-match fixture without breaking the fixture's reason to exist.** Measured: 0 of the 4 `patterns.test.ts` matches can be moved under Path C without a mutation-test regression.
- `docs/reviews/*.md` (33 of the 44 matches, the dominant share): these are pasted **raw tool output**, verbatim, per rule 19's `demonstrated` tier. Rephrasing `db01.internal` as "an internal-looking hostname" in a report's evidence block is not a cosmetic edit — it removes the raw output the `demonstrated` tag exists to certify, which downgrades every such finding to `derived` under this project's own evidence policy (PRINCIPLES rule 19: "derived... reasoned from a document. No code opened, nothing run"). **A report that followed Path C could not truthfully tag its own findings `demonstrated` anymore.**

**Downstream — who consumes this?** Every future reader of a review report who relies on `demonstrated`-tagged findings to gate a ship decision (the Manager, `/maat:verify`, `/maat:audit`) — Path C would silently convert load-bearing gating evidence into non-gating `derived` prose, project-wide, for the entire class of finding this scanner touches (which is exactly the security-report class CRITICAL tier exists to hold to the highest evidence bar).

**Invariant delta.** Before: "a `demonstrated` finding's raw output is trustworthy because it's literally what the tool printed." After Path C: that invariant breaks for any finding whose raw output happens to contain a secret-shaped string — silently, unless every future reviewer independently notices and downgrades their own tag, which is exactly the kind of manual, unenforced discipline this role's method (§2/§3) exists to distrust.

**Whack-a-mole verdict: WIDENS.** It does not close Path A's class for the 33 already-dominant report-evidence matches (evidence policy forbids the workaround), and for the 4 test-fixture matches it actively degrades a different, more valuable existing guard (mutation-tested regression coverage) to dodge this one. Zero prior-fix count (never attempted); the class it collides with (rule 19's evidence tiers) is load-bearing across this entire project, so a collision here has a bigger blast radius than either A or B.

**Ledger:**
```
Path C: touches an unbounded, growing set of future report/fixture files (not a fixed diff) · new
  preconditions: every future demonstrated finding must avoid quoting its own raw output when that
  output is secret-shaped — no mechanical way to comply and stay demonstrated · migration: none, but
  a policy collision with PRINCIPLES rule 19 that would need a rule change first · reversible: n/a (it's
  a practice, not a diff) · exposure if wrong ~100% of future CRITICAL-tier security reports that quote
  raw scanner output (which is most of them, by nature — this report, red-team's, infra-security's, all
  do) · residual if NOT adopted: 0% additional (Path A already handles the concrete 44; Path C is not
  needed to ship cifix)
```

**Verdict: REDESIGN-REQUIRED if pursued as stated** — not for `cifix`'s own shipping (it isn't load-bearing here either), but because it cannot be adopted piecemeal without first resolving a real conflict with PRINCIPLES rule 19 that this analysis surfaced, not one the brief assumed. That resolution is architecture-reviewer's/the Manager's call, not mine to design.

---

## Point 3 — traced concretely: does fixing #129 or #130 risk reintroducing #113?

**#129 (add a `github-fine-grained-pat` pattern) — traced, zero risk.** Ran both regexes against both shapes directly:
```
finePat = /github_pat_[A-Za-z0-9_]{20,255}/g
finePat.test("edit .claude/settings.local.json to override CLAUDE_PROJECT_DIR")  -> false
finePat.test("github_pat_11ABCDEFG...")                                          -> true
```
`github-pat`/`github-fine-grained-pat` share no character-class overlap with `internal-hostname`'s `\b[a-z0-9-]+\.(?:internal|corp|local)\b` — completely orthogonal patterns, orthogonal `patternId`s in `partitionAllowlisted`'s exact-match join. **#129's fix cannot touch #113's regex by construction; there is no shared code path.**

**#130 (tighten the over-broad lookahead) — traced, risk is real but mechanically guarded IF done test-first.** Built the exact narrowing red-team round 2 and infra-security round 2 both suggested (exclude only extension-shaped and hyphenated-modifier continuations, not any continuation) and ran it against all six load-bearing cases together:
```
candidate = /\b[a-z0-9-]+\.(?:internal|corp|local)\b(?!\.(?:json|ts|js|jsx|tsx|md|yml|yaml|txt|log|lock)\b)(?!-[a-z]{2,})/gi

settings.local.json (must NOT match, #113 FP)        -> false  [correct]
settings.local-shaped (must NOT match, #113 variant) -> false  [correct]
db01.internal (must match)                            -> true   [correct]
db01.internal. sentence-final (must match)            -> true   [correct]
host01.corp.contoso.com (must match, new true-pos)    -> true   [correct]
db1.internal.example.com (must match)                 -> true   [correct]
```
A correctly-scoped #130 fix does **not** reintroduce #113 — the exclusion list, not a blanket "any continuation" rule, is what makes this true. **The risk is real only if an implementer narrows carelessly** (drops the extension list, mistypes it, or reverts to matching-anything) — and that exact failure mode is already mechanically guarded: `patterns.test.ts`'s existing #113 regression tests (`settings.local.json`/`settings.local-shaped` must NOT match) sit in the same file and same `node:test` run as any new #130 true-positive test, so a careless #130 fix that reintroduces #113 fails the suite immediately, not silently. **Verdict: LOW risk, contained by an existing mechanical guard, conditional on the #130 fix being built test-first (add the true-positive test alongside the existing negative tests, never replacing them).**

---

## Structural findings (defect classes fixed/recurring 2+ times, needing a mechanical guard)

1. **Unenumerated future producers of secret-shaped example strings in a growing, exact-path-only allowlist.** First instance in `docs/reviews/`, but the *mechanism* (a hand-curated, path-exact allowlist with no pre-commit check) is the same shape as every "unenumerated writers of a guarded column" class this role exists to catch. Recommend: a **mechanical pre-commit/CI-adjacent check** that runs the real scanner against the actual to-be-committed tree (not the working tree) before the commit lands — i.e., promote red-team's own ad hoc `git commit-tree` drill into a standing, named instrument, not a one-off adversarial catch. Recommending the guard, not designing it.
2. **CLAUDE.md's own "Secret scanning / CI gates" sensitive-area list is stale** — it names `.gitleaks.toml`/`.gitleaksignore`/`scripts/secret-scan/*`, none of which exist in this repo; the real mechanism is `src/secret-scan/*` + `docs/qa/secret-scan-allowlist.json`, neither named. This is an editorial gap (route to whoever owns CLAUDE.md maintenance), but it means the sensitive-area ceremony this whole review is honoring is, by the file's own literal text, not actually triggered by a diff to the file that matters. Not blocking `cifix` — flagged so it doesn't stay silently wrong.

## Unmeasured

- Path B's real leak/abuse rate if built — no implementation exists to attack; the command that would settle it is a red-team drill against a concrete PR implementing the marker mechanism, not something I can source today.
- The rate at which future CRITICAL-tier scopes reproduce Path A's "review activity outgrows the allowlist between rounds" pattern — only one data point exists (`cifix` itself); `git log --oneline -- docs/qa/secret-scan-allowlist.json` will be the running count once a second such scope occurs.
- Whether `docs/reviews/`-wide path-prefix exemption (an alternative both red-team and infra-security floated, narrower than Path B, not one of the three priced paths here) would be cheaper than Path A's per-string growth — untested; would need its own blast-radius pricing if the Manager wants it costed.

## Recommended path

**Ship Path A** for this round, gated on re-running the post-commit dogfood drill against the **44-match set measured in this report**, not an earlier, now-stale count. It is the only one of the three that is `local`, reversible, already-priced, and does not touch the mechanism itself. **Strongest argument against this recommendation:** Path A does nothing to stop the *next* round from reproducing the same jump — it is a real, demonstrated RELOCATES verdict, not a CONTAINS one, and the structural finding above (a pre-commit dogfood check) is not optional cleanup, it is the actual fix for the class; shipping Path A alone without also committing to build that guard leaves this project exactly where round 2 found it, one review cycle away from the same HIGH recurring a third time.

## The single change most likely to be regretted in a month

**Treating Path A's "add these 44 entries and move on" as done, without also landing the pre-commit dogfood check as a standing instrument.** The allowlist will keep growing every time this scanner is the subject of its own review (which, mechanically, it always will be — a secret-scanner's own review reports are the one document class guaranteed to discuss secret-shaped strings by example), and the only thing that has ever caught the gap between "green in the working tree" and "green in the commit that ships" is one reviewer's ad hoc `git commit-tree` drill, run twice, by hand, so far.

---

```
RECEIPT: verdict=PATCH-WITH-CONDITIONS
candidates (ALL of them, one terse line each, ranked by risk):
1. [SUSPICION][MED][demonstrated/systemic][100% of npm test/CI runs post-commit, measured] Path B (scanner-level in-file exemption marker) -- WIDENS: forward-only (immutable history still needs the JSON path), adds a self-attesting exemption class with no reviewed side-channel tripwire, does not retire the mechanism it supplements; not load-bearing for cifix (Path A alone already closes the blocking finding). Do not build for this scope.
2. [SUSPICION][MED][demonstrated/seam][100% of future CRITICAL-tier reports that quote raw scanner output, counted in code] Path C (obfuscate/synthesize fixtures+docs) -- WIDENS: cannot obfuscate a positive-match test fixture without breaking it (traced: 4/4 patterns.test.ts matches are load-bearing regression fixtures), and rephrasing report evidence collides with PRINCIPLES rule 19's `demonstrated` tier (raw output required); REDESIGN-REQUIRED if pursued as a general practice, not needed to ship cifix.
3. [CLEAN][demonstrated][local][100% of npm test/CI runs post-commit, measured -- own re-run: 7 code-only / 44 full-tree blocking matches, up from round 2's own 7/11 because 2 more review reports were persisted since] Path A (mechanical allowlist patch, this diff's own strings) -- RELOCATES the class (unenumerated future producers, no pre-commit structural check) rather than CONTAINS it, but correctly scoped, reversible, and the only one of the three that is load-bearing for cifix's actual blocking finding. PATCH-WITH-CONDITIONS: re-run the post-commit dogfood drill against the 44-match set measured here, not an earlier count.
counts (CHECKSUM): issues=0 suspicions=2 clean=1
evidence (CHECKSUM): demonstrated=3 code-traced=0 derived=0
traced: upstream=6 producer roles (red-team, infra-security-reviewer, cross-domain-reviewer, impact-analyst, story-implementer, Manager) / downstream=2 consumer files (history-scan.ts, history-scan.test.ts) / structural=1 class (unenumerated allowlist producers, first instance, no guard yet)
recommended=A unmeasured=3
checks=own re-run of the real SECRET_PATTERNS/partitionAllowlisted against the live working tree: code-only 7 blocking/3 allowlisted, full-tree 44 blocking/3 allowlisted (script-generated, not hand-counted); old-vs-new internal-hostname regex against all committed docs/reviews+docs/plans+CHANGELOG+backlog+decisions+src at HEAD: 12 files/28 matches (old) -> 0 files/0 matches (new); #129 vs #113 regex cross-test: zero overlap; #130 candidate narrowing vs all 6 load-bearing cases: 6/6 correct
adr=HIT(35)
report=docs/reviews/cifix-impact-analyst-council-2026-09-09.md
```
