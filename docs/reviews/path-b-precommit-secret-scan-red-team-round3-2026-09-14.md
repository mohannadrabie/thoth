# Red Team (Sutekh) — `path-b-precommit-secret-scan` — ROUND 3 (final targeted re-confirm)

- **Date:** 2026-09-14
- **Scope:** `feat/path-b-precommit-secret-scan`, HEAD `ec11f5c` (round-2 HEAD `a9d68e4`, now rewritten to `c70109b`)
- **Tier:** CRITICAL (CLAUDE.md "Secret scanning / CI gates" + "Evidence / audit trail" sensitive areas)
- **Verdict:** **no-go**
- **Predecessors:** `docs/reviews/path-b-precommit-secret-scan-red-team-2026-09-14.md` (round 1, no-go), `...-round2-2026-09-14.md` (round 2, go)
- **ADR cache:** `HIT` — 35 ADRs reused (`adr/devops:12`, `adr/software-engineering:23`), fp `83b2e3e`, ~17300 tokens saved. Attack-surface slice unchanged: devops ADR-0008 (CI/CD gates & policy-as-code), devops ADR-0009 (secrets in IaC), SE ADR-0003, SE ADR-0004, SE ADR-0006.

> Literal discipline: every AWS-key-shaped fixture value below is written with a deliberate break
> (AKIA + hyphen + suffix) so this file needs no new `aws-access-key-id` allowlist grant. Same
> discipline as round 2.

## Praise first

The history rewrite itself is the cleanest destructive git operation I have audited. I compared all
8 rewritten commits against their pre-rewrite originals: exactly one file differs in exactly the 4
commits that carried the literal, author/committer identity and both timestamps are byte-identical,
commit messages are byte-identical, the `100755` exec bit on `.githooks/pre-commit` and the `160000`
gitlink on `adr` both survived a `--tree-filter` checkout on NTFS (the single most likely corruption
mode), the parent chain is linear and unbroken, and no commit was dropped or reparented. The backup
tag was taken first and still resolves. Mechanically, this was done right.

Issue #193 is genuinely fixed. I re-ran my own exact round-2 attack shape against the current tip and
it is now refused. Issue #194 is fixed and honestly measured. All 3 LOW items landed. The pre-commit
hook is now really installed in the primary checkout and really refuses a real commit — I planted a
secret and watched it die.

## Scorecard (ranked by blast radius)

| # | Attack | Verdict | Severity | Evidence |
|---|---|---|---|---|
| F1 | The branch WAS pushed — rewrite is local-only, GitHub still serves the pre-rewrite blobs | BREAKS | HIGH | demonstrated |
| F2 | `npm test` is RED at HEAD (826/827) while STATE.md + decisions.md both claim 827/827 | BREAKS | HIGH | demonstrated |
| F3 | Self-referential-allowlist class REOPENED on `docs/decisions.md` + `docs/STATE.md` | BREAKS | MED | demonstrated |
| F4 | `refs/original/...` left behind by filter-branch, undisclosed, no named cleanup step | BREAKS | LOW | demonstrated |
| F5 | Two hand-derived completeness claims about the rewrite are factually wrong | BREAKS | LOW | demonstrated |
| F6 | 3 SHA citations in append-only `decisions.md` now dangle from HEAD; no old-to-new map recorded | BREAKS | LOW | demonstrated |
| S1 | Issue #187 POSIX exec-bit e2e still unproven (carried from round 2, unchanged) | UNPROVEN-pending-verification | LOW | code-traced |
| C1 | Rewrite mechanism fidelity — content, metadata, modes, gitlink, parent chain | SURVIVES | — | demonstrated |
| C2 | Issue #193 re-attacked fresh at the current tip with my own round-2 shape | SURVIVES (fixed) | — | demonstrated |
| C3 | Issue #194 — measured claim + PASS-run output volume | SURVIVES (fixed) | — | demonstrated |
| C4 | 3 round-2 LOW items (`rev-parse --git-dir`, BLOCKED unlock, Docker claim) | SURVIVES (fixed) | — | code-traced |
| C5 | Pre-commit hook active in the primary checkout and gates a real commit | SURVIVES | — | demonstrated |
| C6 | `ci.yml` diff vs `master` still empty; typecheck/lint clean; history-scan exit 0; QA-13 PASS | SURVIVES | — | demonstrated |

---

## F1. [HIGH][demonstrated] The branch WAS pushed. The rewrite is local-only, and GitHub is still serving the pre-rewrite blobs by SHA.

**The premise the human approved was false.** `docs/decisions.md:86` (the HARD STOP row the human
ruled on) says the literal sits on *"this same **never-pushed** branch"*. The round-3 `docs/STATE.md`
(commit `fc91d65`) says it outright: *"This branch has never been pushed (confirmed: no upstream
tracking ref), so rewriting is technically safe."* Both are demonstrably wrong.

```
$ git config --get branch.feat/path-b-precommit-secret-scan.remote
origin
$ git config --get branch.feat/path-b-precommit-secret-scan.merge
refs/heads/feat/path-b-precommit-secret-scan        <- an upstream IS configured

$ git ls-remote --heads origin                       # live network call
d22eae83e4871369e9cda4c95e3bc55a8e4d8849	refs/heads/feat/path-b-precommit-secret-scan
64288ff4a0dad2229cb5bcb177cb4a664dc6d451	refs/heads/master

$ git merge-base --is-ancestor origin/feat/path-b-precommit-secret-scan HEAD
NOT-ANCESTOR (push would be REJECTED, needs --force)
```

The remote head `d22eae8` is exactly the pre-rewrite HEAD — the same object the backup tag points at.
GitHub serves the dirty blob today:

```
$ gh api repos/mohannadrabie/thoth/commits/d22eae83e4871369e9cda4c95e3bc55a8e4d8849 --jq .sha
d22eae83e4871369e9cda4c95e3bc55a8e4d8849
$ gh api repos/mohannadrabie/thoth/commits/a9d68e4 --jq .sha
a9d68e436bd0a502a954e15c67fbb4bbd6d41584

$ gh api "repos/mohannadrabie/thoth/contents/docs/qa/secret-scan-allowlist.json?ref=a9d68e4..." \
    --jq .content | base64 -d | grep -c AKIA[A-Z0-9]{16}
3          <- three raw AWS-key-shaped matches, served by GitHub, right now

$ git show c70109b:docs/qa/secret-scan-allowlist.json | grep -c AKIA[A-Z0-9]{16}
0          <- the local rewrite is clean; the remote is not
```

**Three consequences, none disclosed in `STATE.md`, `decisions.md` or `CHANGELOG.md`:**

1. **OSS-01's remediation goal is not met.** The requirement is *"full history shall be scanned for
   secrets ... before the repository is public."* The content the rewrite was authorized to destroy is
   sitting on a real GitHub remote. A local-only rewrite achieves nothing against that requirement.
2. **The branch can no longer be pushed normally.** A plain `git push` is now rejected; landing this
   work requires `git push --force-with-lease`, which CLAUDE.md's "Human-only actions" list names
   explicitly. The stated "Ready for Stage 4/5/5.5" path silently requires a human-only destructive
   operation nobody has been told about.
3. **Force-push alone will not remediate it.** GitHub's own documentation is explicit: *"If you only
   rewrite your history and force push it, the commits with sensitive data may still be accessible
   ... directly via their SHA-1 hashes in cached views on GitHub, and through any pull requests that
   reference them"*, and permanent removal requires contacting GitHub Support to run a server-side gc
   and purge cached views (docs.github.com — "Removing sensitive data from a repository"). One
   mitigation in our favour: no PR exists for this branch yet
   (`gh pr list --head ... --state all` returns `[]`), so nothing has pinned the old SHAs into a PR
   timeline. That window closes the moment a PR is opened.

**Current defense, honestly assessed.** None. The never-pushed premise was asserted, not checked —
one `git ls-remote` would have caught it, and it is the single fact the whole risk calculus rested on.
The backup tag protects against local loss, which was never the risk here.

**Exposure: 100% of the remediation the rewrite was authorized to perform — the content remains on the
public-facing remote and is retrievable by SHA. Basis: measured** (live `git ls-remote` + live GitHub
Contents API fetch returning 3 matches). Security-class, so PRINCIPLES rule 21's narrow-exposure cap
does not apply.

**Named proof-test required (before merge):**
`secret-scan: the remote tip of the current branch carries no blocking secret-shaped match` — an
instrument that resolves `git ls-remote origin <branch>`, fetches that object, and runs `scanHistory`
against it. Today this is asserted by prose; it needs to be a running check, because the failure mode
is precisely "a human wrote never-pushed and nobody ran the command."

**Fix (human-only steps named, per PRINCIPLES rule 2):**
(a) decide whether the synthetic fixture literal warrants remediation at all — it is a fake key, and
GitHub Support explicitly *"won't remove non-sensitive data"*, so the honest answer may be "accept and
record, do not escalate"; (b) whichever way that lands, correct `decisions.md` with a NEW row (it is
append-only) stating that the branch WAS pushed and that the rewrite did not reach the remote; (c) if
the branch is to ship, the human — not an agent — runs `git push --force-with-lease`, and the fact
that a human-only action is required is stated in `STATE.md`'s next-action line.

---

## F2. [HIGH][demonstrated] `npm test` is red at HEAD, and the commit that made it red is the commit that claims it is green.

`docs/STATE.md:4` and `docs/decisions.md:87` — both written by commit `ec11f5c`, the current HEAD —
assert: *"`npm test` **827/827 pass, 0 fail, 0 skipped**"* and
*"`completeness-claim-checker`/`recurring-findings-registry` both PASS"*.

```
$ npm test ; echo "npm-exit=$?"
...
ℹ tests 827
ℹ pass 826
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40933.5271
npm-exit=1

✖ failing tests:
test at src\qa\completeness-claim-checker.test.ts:235:1
✖ QA-15 (Issue #159, end-to-end, real corpus): CHANGELOG.md and docs/STATE.md — the exact two files
  this round corrected — contain ZERO bare claims after this round's own edits (10.9162ms)
  AssertionError [ERR_ASSERTION]: expected no bare claims in docs/STATE.md, found: [...]
```

```
$ node src/qa/completeness-claim-checker.ts ; echo "EXIT=$?"
[QA-15 completeness-claim-checker] FAIL: 1 of 2 file(s) had a failing completeness claim.
  - docs/STATE.md: 2 of 2 numeric completeness claim(s) failed.
  -   NO INSTRUMENT REFERENCE: "... **all 17 commits on the branch got new SHAs** ..." (line 4)
  -   NO INSTRUMENT REFERENCE: "- Backed up first ... all 17 commits on the branch got new SHAs ..." (line 56)
EXIT=1
```

The two flagged sentences are the round-4 close-out's own description of the rewrite. This is the
project's own QA-15 instrument catching a CLAUDE.md hard-rule violation ("No hand-derived
completeness claims") in the very paragraph that asserts everything passed — and the assertion was
written after the verification run, so the edit that made the suite red is the edit that declares it
green. An ordering defect, not a lie; but the artifact on disk is false.

**Current defense.** The instrument exists and works — it is the *claim about it* that is wrong.
`recurring-findings-registry` genuinely passes (`EXIT=0`, 3 classes). `history-scan.ts` genuinely
passes (`EXIT=0`, 0 blocking, 1029 allowlisted). `typecheck` and `lint` are genuinely clean. Exactly
one of the five claimed-green checks is red, and it is the one that grades honesty.

**Exposure: 100% of CI runs on this branch (npm exit 1), and 100% of readers of `STATE.md`'s resume
point, which is the first file every session reads per PRINCIPLES rule 14. Basis: measured.**
Evidence/audit-trail class (a CLAUDE.md sensitive area), so rule 21's cap does not apply. This also
fails the Definition of Done outright: *"tests green in CI with real counts"*.

**Named proof-test required:** none new — `src/qa/completeness-claim-checker.test.ts:235` is already
the failing test. The fix is to make it pass: reword both sentences to the measured figure (F5) with a
`[[completeness: ...]]` marker naming the instrument, then re-run `npm test` and correct the counts in
a **new** `decisions.md` row (append-only; do not edit row 87).

---

## F3. [MED][demonstrated] The self-referential-allowlist class is not closed — it was reopened the same day on two larger, permanent surfaces.

Round 2's Issue #193 fix deleted the whole-file `aws-access-key-id` grant on
`docs/qa/secret-scan-allowlist.json`. Commit `923afcd` then added the same shape of grant to
`docs/decisions.md` and `docs/STATE.md`.

**Attack, run fresh in an isolated `--local --no-hardlinks` clone of HEAD with the real hook installed
(`core.hooksPath=.githooks`). One distinct key-shaped literal, four targets, each from a clean
`git reset --hard ec11f5c`:**

```
### PROBE CONTROL: ordinary file  (control.js)
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (263 allowlisted, not counted).
  - a61e88bc4579 control.js [aws-access-key-id] AWS access key id: AKIA…[REDACTED 20 chars]
SCAN EXIT=1
COMMIT EXIT=1  landed=docs: round-4 close-out — historical-b        <- refused, nothing landed

### PROBE C: allowlist file (re-attack Issue #193, an incident note in a reason field)
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (263 allowlisted, not counted).
  - b9b4b64c0340 docs/qa/secret-scan-allowlist.json [aws-access-key-id] AWS access key id: AKIA…[REDACTED 20 chars]
SCAN EXIT=1
COMMIT EXIT=1  landed=docs: round-4 close-out — historical-b        <- #193 GENUINELY FIXED

### PROBE A: docs/decisions.md (NEW grant)
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (264 allowlisted).
SCAN EXIT=0
COMMIT EXIT=0  landed=rt3 A: decisions.md (NEW grant)               <- LANDED IN HISTORY

### PROBE B: docs/STATE.md (NEW grant)
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (264 allowlisted).
SCAN EXIT=0
COMMIT EXIT=0  landed=rt3 B: STATE.md (NEW grant)                   <- LANDED IN HISTORY
```

(The probe literal was contiguous in the fixture; written in this report as AKIA + hyphen + ZZ4MK9QW7TB3XPLD.)

**Why this is worse than Issue #193, not equivalent.** `docs/qa/secret-scan-allowlist.json` is at
least a CLAUDE.md-named sensitive area that draws a reviewer on every change. `docs/decisions.md` and
`docs/STATE.md` are:
- **append-only by project convention**, so the grant can never be retired without another history rewrite;
- **written by the Manager on every single story**, forever — the surface only grows;
- **exactly where incident and rotation narratives are written.** "We rotated the leaked key AKIA…, see
  the 2026-xx-xx row" is the single most natural sentence in this repo, and it is now invisible to both
  the pre-commit hook and CI's OSS-01 job.

**Why the Issue #193 regression test did not catch it.** `src/secret-scan/history-scan.test.ts:166`:
```ts
const ALLOWLIST_PATH = "docs/qa/secret-scan-allowlist.json";
```
Both #193 guard tests key off that single constant, and `CREDENTIAL_SHAPED_PATTERN_IDS` is used
nowhere else in `src/`. The fix was scoped to one path, so it defends one path. The class recurred on
the very next commit and the suite stayed green.

**Current defense, honestly assessed.** The `reason` fields for both new entries argue the literal is
load-bearing: *"a command's search string can't be described instead of reproduced and still be
copy-pasteable."* That argument is refutable on its own terms — commit `ec11f5c` **did** reword
`docs/STATE.md` so it no longer contains the literal at HEAD (`git grep` for the pattern against
`HEAD -- docs/STATE.md` returns nothing), while keeping the grant. So for `STATE.md` the grant now
covers only a historical blob, with no live text needing it. The same reword was available for
`decisions.md` row 86 before it was committed.

**Exposure: 2 of 312 tracked files blind to the highest-severity pattern in BOTH the pre-commit hook
and CI's full-history scan — and both are files that grow monotonically for the life of the project.
Basis: counted-in-code.** Security-class; rule 21's cap does not apply. Rated MED, matching my round-2
calibration of #193: arming it still requires a human or agent to write a real credential into
narrative prose. The surface is larger and permanent, which is why it should not be carried as a
residual.

**Named proof-test required:**
`secret-scan-allowlist: no entry grants a credential-shaped pattern on ANY project narrative document`
— generalise the #193 guard from one hardcoded `ALLOWLIST_PATH` to a denylist of self-referential
document paths (`docs/qa/secret-scan-allowlist.json`, `docs/STATE.md`, `docs/decisions.md`,
`CHANGELOG.md`, `docs/REVIEW_LOG.md`), so the next recurrence fails a named test instead of a
reviewer's probe. This is the instrument that has been missing for six recurrences.

**Fix:** break the literal in `decisions.md` row 86's quoted sed command exactly the way this report
breaks its own, append a `decisions.md` row saying so, drop both new grants, and generalise the guard
test. The literal is only needed for a command that has already been run — its copy-pasteability was
load-bearing for exactly one execution, which is over.

---

## F4. [LOW][demonstrated] `filter-branch` left `refs/original/...` behind. It is disclosed nowhere, and no step names its removal.

```
$ git for-each-ref refs/original
d22eae83e4871369e9cda4c95e3bc55a8e4d8849 commit	refs/original/refs/heads/feat/path-b-precommit-secret-scan

$ grep -rn "refs/original" docs/ CHANGELOG.md .github/
(no matches)

$ git rev-list backup/path-b-before-history-rewrite --not HEAD | wc -l
8          <- 8 commits reachable only from the backup tag + refs/original
```

`STATE.md` discloses the backup tag and says it is *"kept until this ships"*. It says nothing about
`refs/original`, which `git filter-branch` creates by default and which pins the same 8 commits
independently — so deleting the tag alone does not make them unreachable. Nothing in the pre-merge
checklist names either deletion.

`history-scan.ts`'s scan scope is HEAD-ancestry by disclosed design (`history-scan.ts:7-10`), so
neither ref fails the gate today. That disclosed scope is exactly what makes this worth writing down:
the project deliberately does not look at non-HEAD refs, and this round just created two of them
holding the content it decided must not exist.

**Exposure: 0 blocking matches today (measured: `history-scan.ts` exit 0); 8 commits retained locally
with no named removal step. Basis: measured.** LOW because the retained content is a synthetic fixture
and the refs are local-only — F1 is the finding that matters about remote copies.

**Named residual-register line (not a test):** before merge, run
`git update-ref -d refs/original/refs/heads/feat/path-b-precommit-secret-scan`, then
`git tag -d backup/path-b-before-history-rewrite`, then `git reflog expire --expire=now --all`, then
`git gc --prune=now` — and only after the old-to-new SHA map is recorded (F6).

---

## F5. [LOW][demonstrated] Both hand-derived completeness claims about the rewrite are wrong.

**Claim 1 — "all 17 commits on the branch got new SHAs"** (`STATE.md:4` and `:56`, `decisions.md:87`):
```
pre-rewrite branch commits: 17
SHA-PRESERVED after rewrite: 9
SHA-CHANGED after rewrite:   8
```
Nine commits (`c94e20f` .. `9f0eb1c`) kept their SHAs, because `filter-branch` reproduces an identical
commit object when tree and parent are unchanged. Eight changed (`9e4f34f` .. `fb2bf94`). This is the
sentence QA-15 fails on (F2).

**Claim 2 — "2 EARLIER commits (`4ea1456`, `a9d68e4`)"** (`decisions.md:86`, `STATE.md`):
```
### commits in PRE-rewrite history whose allowlist blob carried the raw literal
a40befd blob=61db5054
2101988 blob=61db5054
a9d68e4 blob=61db5054
4ea1456 blob=1a714ebd
### distinct dirty blobs
DIRTY 1a714ebda7bbc2d40cab0e369887feae1e21d190
DIRTY 61db5054efaab40d5bf2535b447551be52539460
```
**Four** commits carried it, not two (two distinct blobs — the "2 blobs" half of the disclosure is
right, the "2 commits" half is not; the scan's own blob-dedupe is almost certainly where the miscount
came from). The executed command used the `master..HEAD` range, so the fix was complete anyway — but
an auditor verifying the disclosure literally, by checking the two named commits, would have declared
victory with two dirty commits still standing.

**Exposure: 2 of 2 numeric claims in the round-4 close-out are wrong, basis: measured.** LOW because
the underlying operation was correct; the defect is in the record, and the record is what the next
session reads.

**Named proof-test:** the QA-15 failure in F2 already is it. Restating both sentences with the
measured figures and a `[[completeness: ...]]` marker fixes F2 and F5 in one edit.

---

## F6. [LOW][demonstrated] Three SHA citations in the append-only decision log now dangle from HEAD, and the old-to-new mapping is recorded nowhere.

```
$ grep -oE '\b[0-9a-f]{7,40}\b' docs/decisions.md | sort -u | <resolve, test ancestry of HEAD>
ORPHAN-FROM-HEAD: 4ea1456  fix(secret-scan): Stage-3 round-1 fix-now -- #187-#192, cros
ORPHAN-FROM-HEAD: 7779da4  docs: round-3 close-out (CHANGELOG, STATE) + disclosed histo
ORPHAN-FROM-HEAD: a9d68e4  chore(qa): self-caught dogfood fix -- allowlist round-1's ow
```

These resolve today only because the backup tag and `refs/original` keep them alive. `STATE.md` says
the tag is *"kept until this ships"* — so on the day this ships, three citations in the project's
permanent, append-only audit trail become unresolvable. `docs/decisions.md` is evidence under
CLAUDE.md's "Evidence / audit trail" sensitive area; a decision row whose cited commit cannot be
fetched is a claim, not evidence (PRINCIPLES rule 10). My own round-2 report cites `a9d68e4` too, and
reports are immutable by rule 11, so neither file can be edited to fix this.

The Manager disclosed the staleness (*"every commit SHA cited in this file's rows above this one ... is
now stale"*) but recorded no mapping, and the disclosure's own pointer — "the backup tag is the
pointer to the pre-rewrite state" — is the thing scheduled for deletion.

**Exposure: 3 of 3 stale SHA citations, in the one file the project treats as its permanent decision
record. Basis: measured.**

**Named residual-register line:** append one `decisions.md` row carrying the full old-to-new SHA map
(8 pairs, generated by a script, not hand-typed — CLAUDE.md's hand-derived-completeness rule applies)
**before** the backup tag is deleted.

---

## S1. [SUSPICION][LOW][code-traced] Issue #187's POSIX half — carried from round 2, unchanged.

No POSIX runtime is available on this box (docker daemon down; the only WSL distro reports
NOGIT/NONODE). What I can add this round: the exec bit survived the `--tree-filter` rewrite, which was
the new risk.
```
$ git ls-tree <each rewritten commit> .githooks/pre-commit adr
100755 blob .githooks/pre-commit;160000 commit adr;     <- identical in all 8 old/new pairs
```
Settling command unchanged from the round-2 report (section R1).

---

## SURVIVES — the things I attacked hardest and could not break

**C1. Rewrite mechanism fidelity — SURVIVES, comprehensively.** `--tree-filter` checks every tree out
to a working directory and re-hashes it, which on NTFS is the textbook way to silently drop exec bits
and mangle submodule gitlinks. It did neither. All 8 old-to-new pairs:
```
d22eae8 -> fb2bf94   tree-diff: (none)                              META-IDENTICAL  BODY-IDENTICAL
7779da4 -> fc91d65   tree-diff: (none)                              META-IDENTICAL  BODY-IDENTICAL
fcde358 -> b52afc4   tree-diff: (none)                              META-IDENTICAL  BODY-IDENTICAL
f5afd86 -> 593e521   tree-diff: (none)                              META-IDENTICAL  BODY-IDENTICAL
a40befd -> e3316d6   tree-diff: docs/qa/secret-scan-allowlist.json  META-IDENTICAL  BODY-IDENTICAL
2101988 -> 0a94a5f   tree-diff: docs/qa/secret-scan-allowlist.json  META-IDENTICAL  BODY-IDENTICAL
a9d68e4 -> c70109b   tree-diff: docs/qa/secret-scan-allowlist.json  META-IDENTICAL  BODY-IDENTICAL
4ea1456 -> 9e4f34f   tree-diff: docs/qa/secret-scan-allowlist.json  META-IDENTICAL  BODY-IDENTICAL
```
(META = author name/email/date + committer name/email/date + subject; BODY = full message md5.)

Content diffs inspected line by line: every hunk is one dash insertion inside a `reason` string. No
other byte moved.

Modes and gitlinks:
```
$ git ls-tree -r d22eae8 | awk '$1!="100644"' | sort > o ; same for fb2bf94 > n ; diff o n
ALL-SPECIAL-MODES-IDENTICAL (2 entries)     # 100755 .githooks/pre-commit + 160000 adr
```
Parent chain: strictly linear, 19 commits from `ec11f5c` back to `c94e20f` onto `49ff52e`, no merge
commits, no reparenting, no drops (17 pre-rewrite -> 17 rewritten + 2 new). I attacked
partial-rewrite, commit-skipped, and wrong-content-to-wrong-commit; none happened. The
`2>/dev/null || true` in the tree-filter would have silently swallowed a `sed` failure — the content
check above proves it did not need to.

**C2. Issue #193 — SURVIVES (genuinely fixed).** Probe C above: my round-2 attack shape, an
incident-note `reason` field carrying a distinct key-shaped literal, is now FAILed and the commit
refused, with the allowlist file named as the offending path. Guard tests present and correctly shaped
at `history-scan.test.ts:168-220`, including a self-referential mutation-sensitivity proof. The only
criticism is scope (F3), not correctness.

**C3. Issue #194 — SURVIVES (fixed).** `pre-commit-scan.ts:15-25` now states the measured figure and
names PRINCIPLES rule 18 explicitly. PASS-run output is down from 264 lines to 1:
```
run1 exit=0 elapsed_ms=11226 lines=1
run2 exit=0 elapsed_ms=13250 lines=1
run3 exit=0 elapsed_ms=13373 lines=1
```
The header's ~23-25s and my 11.2-13.4s disagree, and the header already discloses both measurements as
session-dependent. That is the honest way to state it.

**C4. The 3 round-2 LOW items — SURVIVES (fixed), code-traced.**
`git-hooks-install.ts:31,38-41,72` now probes with `git rev-parse --git-dir` and says so;
`pre-commit-scan.ts:91` names `git commit --no-verify` as the unlock for a repo with no HEAD (rule 2
satisfied); the Docker `COPY package*.json` claim is corrected to state what is actually guarded, with
the un-fixed half disclosed rather than papered over.

**C5. The hook is genuinely active in the primary checkout — SURVIVES.** Not a config read; a real
commit attempt against the real repo:
```
$ git config --get core.hooksPath
.githooks
$ ls -la .githooks/pre-commit
-rwxr-xr-x 1 ... 1371 Sep 14 16:19 .githooks/pre-commit
$ <plant an AWS-key-shaped literal in rt3-hook-drill.js> && git add && git commit -m "..."
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (263 allowlisted, not counted).
  - 91439704b8e1 rt3-hook-drill.js [aws-access-key-id] AWS access key id: AKIA…[REDACTED 20 chars]
COMMIT EXIT=1
HEAD=ec11f5c docs: round-4 close-out — ...      <- nothing landed
tree-after=0                                     <- fixture removed, working tree clean
```

**C6. The rest of the verification surface — SURVIVES.**
```
$ npm run typecheck   -> clean (tsc --noEmit, no output)
$ npm run lint        -> clean (eslint ., no output)
$ node src/secret-scan/history-scan.ts ; echo EXIT=$?
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1029 allowlisted).
EXIT=0
$ node src/qa/recurring-findings-registry.ts ; echo EXIT=$?
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.
EXIT=0
$ git diff master HEAD -- .github/workflows/ci.yml | wc -l
0                     <- R5's non-CI-scope claim intact through the rewrite
```

---

## Raw checks

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT]

$ npm test                       -> tests 827 / pass 826 / fail 1 / cancelled 0 / skipped 0 / todo 0
                                    npm-exit=1 ; duration_ms 40933.5271
                                    failing: src/qa/completeness-claim-checker.test.ts:235 (QA-15, Issue #159)
$ npm run typecheck              -> clean
$ npm run lint                   -> clean
$ node src/secret-scan/history-scan.ts            -> EXIT=0, PASS, 0 blocking, 1029 allowlisted
$ node src/qa/completeness-claim-checker.ts       -> EXIT=1, FAIL, docs/STATE.md 2 of 2 claims failed
$ node src/qa/recurring-findings-registry.ts      -> EXIT=0, PASS, 3 classes
$ git diff master HEAD -- .github/workflows/ci.yml | wc -l   -> 0
$ git config --get core.hooksPath                 -> .githooks
$ git ls-remote --heads origin                    -> branch present at d22eae8 (PRE-rewrite)
$ gh pr list --head feat/... --state all          -> []
$ gh api .../contents/...?ref=a9d68e4 | base64 -d | grep -c <aws-key regex>   -> 3

ADVERSARIAL FIXTURES BUILT AND RUN THIS PASS (9):
  isolated --local --no-hardlinks clone of HEAD with a real installed hook
  probe CONTROL (ordinary file)                 -> refused, exit 1
  probe C  (allowlist file, #193 re-attack)     -> refused, exit 1   [#193 fixed]
  probe A  (docs/decisions.md)                  -> PASS, COMMITTED   [F3 BREAKS]
  probe B  (docs/STATE.md)                      -> PASS, COMMITTED   [F3 BREAKS]
  live hook drill in the PRIMARY checkout       -> refused, exit 1, tree restored clean
  8-pair old/new commit fidelity comparison (tree + meta + body + modes + gitlink)
  pre-rewrite dirty-blob census (4 commits / 2 distinct blobs)
  live remote reachability + GitHub Contents API blob fetch
```

## Open findings -> failing tests

6 open findings + 1 carried suspicion -> 3 named test cases + 3 residual-register lines + 1 drill.

| # | Named test / residual |
|---|---|
| F1 | (test) `secret-scan: the remote tip of the current branch carries no blocking secret-shaped match` |
| F2 | (test, ALREADY FAILING) `src/qa/completeness-claim-checker.test.ts:235` — QA-15 end-to-end on `docs/STATE.md` |
| F3 | (test) `secret-scan-allowlist: no entry grants a credential-shaped pattern on ANY project narrative document` |
| F4 | (residual) pre-merge cleanup of `refs/original/...` + the backup tag + `gc --prune=now` |
| F5 | (no separate test) fixed by F2's edit — restate both claims with measured figures + a `[[completeness:]]` marker |
| F6 | (residual) append one `decisions.md` row carrying the script-generated 8-pair old-to-new SHA map, BEFORE deleting the backup tag |
| S1 | (drill) POSIX fresh-clone exec-bit e2e — command unchanged from the round-2 report |

Three findings have an executable form. F4 and F6 are ordering/cleanup obligations with no unit-test
shape, F5 collapses into F2's test, and S1 is a drill. Stated plainly rather than padded into fake
tests.

## Editorial (verdict-neutral, plain edits, no re-review)

- `CHANGELOG.md` / `STATE.md` describe the #194 UX fix as "a PASSING run's stdout no longer lists
  every ALLOWLISTED match". True for `pre-commit-scan.ts` (1 line), not for `history-scan.ts`, which
  still prints all 1029 on a PASS. Name the path.
- `history-scan.ts`'s summary still prints "Full history scanned" from the pre-commit path, where the
  scan is one simulated commit's tree. Carried from round 2, unchanged.
- `STATE.md` now carries **two** "Single next action:" lines (`:60` and the older one below it). The
  stale one still says "dispatch Stage-3 review — red-team + app-security-reviewer + cross-domain-reviewer".
  Delete the stale one; PRINCIPLES rule 8 wants exactly one.

---

## Scariest unproven assumption

**That "we checked" and "we wrote that we checked" are the same thing.** The rewrite was authorized on
the sentence *"this branch has never been pushed (confirmed: no upstream tracking ref)"* — a sentence
containing the word *confirmed*, describing a check that one command would have settled and that
returns the opposite answer. The close-out then declared 827/827 green in the same edit that turned the
suite red, and declared "all 17 commits" in a repo whose own QA-15 instrument exists specifically to
reject hand-derived counts. Every one of these is a fact a running instrument settles in under a
second, and every one was written as prose instead. That is the pattern under F1, F2 and F5 — not
three unrelated slips. The #193 fix is the proof it can be done right: it shipped with a guard test,
and that guard test is the only reason #193 is closed today rather than recurring as number seven.

## Verdict: no-go

Two `[HIGH]` findings, both `demonstrated`, force this. F1 is security-class and invalidates the stated
basis of a human-approved destructive operation; F2 is a red test suite under a green claim, which
fails the Definition of Done outright. Neither is a design problem — the control this story built is
sound, #193 and #194 are genuinely fixed, the rewrite mechanism is clean, and the hook now really
guards real commits. What blocks is the record: what the branch says about itself is not what the
branch is.

None of the six findings needs a design round. F2 and F5 are one edit plus a re-run. F3 is a guard-test
generalisation the project has needed for six recurrences. F1 is a human decision (the leaked value is
a synthetic fixture, so "accept and record" may well be the right call) plus one honest `decisions.md`
row. F4 and F6 are pre-merge ordering obligations.

## Single next action

Run `git ls-remote --heads origin` and paste the result into a new `docs/decisions.md` row correcting
the never-pushed premise — then let the human rule on whether the remote's pre-rewrite blobs need
remediation at all, before anything else on this branch moves.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] The branch WAS pushed — `git ls-remote --heads origin` returns `refs/heads/feat/path-b-precommit-secret-scan = d22eae8` (pre-rewrite) with upstream config set, and GitHub's Contents API at `a9d68e4` returns a blob with 3 raw AWS-key-shaped matches; the rewrite the human approved on the stated premise "this same never-pushed branch" (decisions.md:86, STATE.md@fc91d65 "confirmed: no upstream tracking ref") never reached the remote, a plain push is now rejected (needs the human-only `--force-with-lease`), and per docs.github.com force-push alone leaves the objects served by SHA in cached views; defense: none, the premise was asserted not checked. Exposure: 100% of the remediation's stated goal, basis: measured
2. [ISSUE][HIGH][demonstrated] `npm test` is RED at HEAD — 827 tests / 826 pass / 1 fail / 0 skipped, npm exit 1, and `completeness-claim-checker` exits 1 — while `STATE.md:4` and `decisions.md:87`, both written by that same commit `ec11f5c`, claim "827/827 pass, 0 fail, 0 skipped" and "both QA instruments PASS" and declare "Ready for Stage 4/5/5.5"; the failing test is the project's own QA-15 checker firing on the very sentence that makes the claim; fails DoD "tests green in CI with real counts"; defense: the instrument works, the claim about it does not. Exposure: 100% of CI runs on this branch + 100% of readers of the rule-14 first-read file, basis: measured
3. [ISSUE][MED][demonstrated] The self-referential-allowlist class is REOPENED, same day, on two larger permanent surfaces — commit `923afcd` added whole-file `aws-access-key-id` grants on `docs/decisions.md` and `docs/STATE.md`; a distinct key-shaped literal committed clean into BOTH through the real installed hook (PASS, exit 0, landed) while the identical literal in `control.js` AND in the allowlist file were both refused; #193's guard test is hardcoded to one path (`history-scan.test.ts:166`) so the suite stayed green; both files are append-only and Manager-written every story, so the blind spot only grows and cannot be retired without another rewrite; the entries' own "can't be described instead of reproduced" justification is refuted by `ec11f5c` having reworded STATE.md to drop the literal while keeping the grant. Exposure: 2 of 312 tracked files blind to the top-severity pattern in BOTH layers, basis: counted-in-code (security-class, rule 21 cap does not apply)
4. [ISSUE][LOW][demonstrated] `git filter-branch` left `refs/original/refs/heads/feat/path-b-precommit-secret-scan` at `d22eae8`; it is mentioned in no doc, and together with the backup tag it pins 8 commits holding exactly the content the rewrite removed; `STATE.md` names the tag as "kept until this ships" but deleting the tag alone leaves them reachable, and no pre-merge step names either removal; 0 blocking matches today because `history-scan.ts:7-10` scopes to HEAD-ancestry by disclosed design. Exposure: 8 retained commits, 0 blocking matches today, basis: measured
5. [ISSUE][LOW][demonstrated] Both hand-derived completeness claims about the rewrite are wrong — "all 17 commits on the branch got new SHAs" is 8 changed / 9 preserved (measured), and "2 EARLIER commits (`4ea1456`,`a9d68e4`)" is 4 commits (`4ea1456`,`a9d68e4`,`2101988`,`a40befd`) across 2 distinct blobs; the executed `master..HEAD` range covered all four so the fix was complete anyway, but an auditor verifying the disclosure literally would have cleared it with 2 dirty commits standing; violates CLAUDE.md's no-hand-derived-completeness-claims hard rule and is the sentence QA-15 fails on. Exposure: 2 of 2 numeric claims in the round-4 close-out, basis: measured
6. [ISSUE][LOW][demonstrated] Three SHA citations in the append-only `docs/decisions.md` (`4ea1456`, `7779da4`, `a9d68e4`) now resolve only via the backup tag / `refs/original`, both slated for deletion at ship; the audit trail is a CLAUDE.md sensitive area and rule-11 immutability means neither `decisions.md` nor my own round-2 report can be edited to fix them; the Manager disclosed the staleness but recorded no old-to-new SHA map, and pointed at the artifact scheduled for deletion. Exposure: 3 of 3 stale citations in the permanent decision record, basis: measured
7. [SUSPICION][LOW][code-traced] Issue #187's POSIX half still unproven-pending-verification (carried unchanged from round 2 — no POSIX runtime on this box); newly established this round is that the `100755` bit and the `160000` adr gitlink both survived the `--tree-filter` checkout in all 8 old/new commit pairs, which was the new risk the rewrite introduced
8. [CLEAN][demonstrated] Rewrite mechanism fidelity — all 8 old-to-new pairs: only `docs/qa/secret-scan-allowlist.json` differs and only by a dash insertion; author/committer identity + both timestamps + full message body byte-identical; exec bit and submodule gitlink preserved; parent chain strictly linear; 17 pre-rewrite commits -> 17 rewritten, none dropped, none reparented, no wrong-content-to-wrong-commit; the `2>/dev/null || true` that could have swallowed a sed failure demonstrably did not need to
9. [CLEAN][demonstrated] Issue #193 genuinely FIXED at the current tip — my own exact round-2 attack (a distinct key-shaped literal in an incident-note `reason` field) now FAILs naming `docs/qa/secret-scan-allowlist.json` and the commit is refused at exit 1; guard tests present and self-mutation-proving at `history-scan.test.ts:168-220`
10. [CLEAN][demonstrated] Issue #194 FIXED — `pre-commit-scan.ts:15-25` states the measured figure and cites PRINCIPLES rule 18; PASS-run output down from 264 lines to 1; re-measured 11226/13250/13373 ms over 3 warm runs, and the header's own ~23-25s figure is disclosed as a second session-dependent measurement rather than reconciled away
11. [CLEAN][code-traced] All 3 round-2 LOW items landed — `git rev-parse --git-dir` probe (`git-hooks-install.ts:31,38-41,72`), BLOCKED message names `git commit --no-verify` as the unlock (`pre-commit-scan.ts:91`), Docker `COPY package*.json` claim corrected to state what is actually guarded with the unfixed half disclosed
12. [CLEAN][demonstrated] The pre-commit hook is genuinely active in the PRIMARY checkout and gates a real commit — `core.hooksPath=.githooks`, hook mode `-rwxr-xr-x`, planted AWS-key-shaped literal refused at exit 1 naming the file, HEAD unchanged at `ec11f5c`, working tree restored to 0 modified entries
13. [CLEAN][demonstrated] Remaining verification surface holds — typecheck clean, lint clean, `history-scan.ts` exit 0 PASS 0 blocking (1029 allowlisted), `recurring-findings-registry` exit 0 PASS (3 classes), `git diff master HEAD -- .github/workflows/ci.yml` = 0 lines (R5's non-CI-scope claim intact through the rewrite)
counts (CHECKSUM): issues=6 suspicions=1 clean=6
evidence (CHECKSUM): demonstrated=11 code-traced=2 derived=0
checks=npm test 827 tests / 826 pass / 1 fail / 0 skipped (npm exit 1; failing: src/qa/completeness-claim-checker.test.ts:235); typecheck clean; lint clean; history-scan.ts EXIT=0 PASS 0 blocking 1029 allowlisted; completeness-claim-checker.ts EXIT=1 FAIL; recurring-findings-registry.ts EXIT=0 PASS; ci.yml diff vs master = 0 lines; 9 adversarial fixtures incl. 4 clone-isolated hook probes (2 landed a key-shaped literal in history) + 1 live primary-checkout hook drill + an 8-pair commit-fidelity comparison + a live ls-remote/GitHub-API remote-reachability probe
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round3-2026-09-14.md

---

## Addendum (same session, appended per PRINCIPLES rule 11 — original evidence above unaltered)

**Concurrency: a commit landed on this branch while this review was in flight.** The body above grades
HEAD `ec11f5c`, the HEAD I was dispatched against. At 19:54, mid-pass, a parallel
`cross-domain-reviewer`/Manager thread committed `c4d2b33` ("fix(qa): reword bare-claim phrasing
(Issue #195), add missing CHANGELOG round-4 entry (Issue #196)"), which independently found and fixed
my F2. Two reviewers converged on the same defect from opposite directions in the same hour; that is a
point in the process's favour, and it is also exactly the plan-vs-apply drift I attack in other people's
work, so it is recorded rather than quietly absorbed.

Re-verification against the new HEAD `c4d2b33`:

| # | Status at `ec11f5c` | Status at `c4d2b33` | Evidence |
|---|---|---|---|
| F1 | BREAKS HIGH | **STILL BREAKS** | `git ls-remote --heads origin refs/heads/feat/path-b-precommit-secret-scan` -> `d22eae8` (unchanged, pre-rewrite) |
| F2 | BREAKS HIGH | **FIXED** | `npm test` -> tests 827 / pass 827 / fail 0 / skipped 0, npm-exit=0; `completeness-claim-checker.ts` EXIT=0 PASS |
| F3 | BREAKS MED | **STILL BREAKS** | both `aws-access-key-id` grants still present; re-ran the probe — a distinct key-shaped literal appended to `docs/decisions.md` still scans `PASS`, `SCAN EXIT=0` (268 allowlisted) |
| F4 | BREAKS LOW | **STILL BREAKS** | `git for-each-ref refs/original` -> `d22eae8`, unchanged |
| F5 | BREAKS LOW | **GATE PASSES, CLAIM STILL FALSE** | see below |
| F6 | BREAKS LOW | **STILL BREAKS** | `4ea1456`, `7779da4`, `a9d68e4` still ORPHAN-FROM-HEAD |

**F5 deserves its own note, because the fix satisfied the instrument without fixing the fact.** The
bare count was removed — `grep "all 17 commits"` on `STATE.md`/`decisions.md` now returns nothing, and
QA-15 passes. What replaced it is:
```
$ grep -o "every commit[^,;.]*got a new SHA" docs/STATE.md docs/decisions.md
every commit on the branch got a new SHA
every commit on the branch got a new SHA
```
That sentence is still false. Nine of the seventeen pre-rewrite commits (`c94e20f` .. `9f0eb1c`) kept
their SHAs, because `filter-branch` reproduces an identical commit object when tree and parent are
unchanged. The measured figure is 8 changed / 9 preserved. QA-15 checks for *bare numeric* claims, so
dropping the number moves the sentence out of the instrument's reach while leaving the error in place —
a reword past the gate, not through it. `decisions.md`'s "2 EARLIER commits (`4ea1456`, `a9d68e4`)" is
also still present (1 occurrence); it is append-only, so the correct remedy is a new row, not an edit.

**Verdict unchanged: no-go.** F1 is a `demonstrated`, security-class `[HIGH]` and is untouched by
`c4d2b33`. F2 no longer contributes to it. GitHub Issue #198, which I filed for F2, duplicates #195
(filed by `cross-domain-reviewer` minutes earlier, before my duplicate check could see it) and is
closed as a duplicate pointing there.

**Revised single next action:** unchanged in substance — run `git ls-remote --heads origin`, record the
result in a new `docs/decisions.md` row correcting the never-pushed premise, and let the human rule on
whether the remote's pre-rewrite blobs need remediation. Fold the F5 correction (8 changed / 9
preserved, script-generated) into that same row.

---

## Final RECEIPT (post-addendum; supersedes nothing above — the body's receipt graded `ec11f5c`, this one carries the `c4d2b33` status flags)

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] The branch WAS pushed — `git ls-remote --heads origin` returns `refs/heads/feat/path-b-precommit-secret-scan = d22eae8` (pre-rewrite) with upstream config set, and GitHub's Contents API at `a9d68e4` serves a blob with 3 raw AWS-key-shaped matches; the rewrite the human approved on the stated premise "this same never-pushed branch" (decisions.md:86, STATE.md@fc91d65 "confirmed: no upstream tracking ref") never reached the remote, a plain push is now rejected (needs the human-only `--force-with-lease`), and per docs.github.com force-push alone leaves the objects served by SHA in cached views; defense: none, the premise was asserted not checked. STILL OPEN at c4d2b33. Issue #197. Exposure: 100% of the remediation's stated goal, basis: measured
2. [ISSUE][HIGH][demonstrated] `npm test` was RED at the dispatched HEAD `ec11f5c` — 827 tests / 826 pass / 1 fail / 0 skipped, npm exit 1, `completeness-claim-checker` exit 1 — while STATE.md:4 and decisions.md:87, written by that same commit, claimed 827/827 and "both QA instruments PASS"; the failing test was the project's own QA-15 checker firing on the very sentence making the claim. FIXED MID-REVIEW at `c4d2b33` by a concurrent cross-domain-reviewer thread (Issue #195); re-verified 827/827 pass, 0 fail, 0 skipped, QA-15 EXIT=0. My duplicate Issue #198 closed pointing at #195. No longer gating. Exposure: 100% of CI runs on this branch, basis: measured
3. [ISSUE][MED][demonstrated] The self-referential-allowlist class is REOPENED, same day, on two larger permanent surfaces — commit `923afcd` added whole-file `aws-access-key-id` grants on `docs/decisions.md` and `docs/STATE.md`; a distinct key-shaped literal committed clean into BOTH through the real installed hook (PASS, exit 0, landed) while the identical literal in `control.js` AND in the allowlist file were both refused; #193's guard test is hardcoded to one path (`history-scan.test.ts:166`) so the suite stayed green; both files are append-only and Manager-written every story. Re-confirmed STILL OPEN at c4d2b33 (probe scans PASS, 268 allowlisted). Issue #199. Exposure: 2 of 312 tracked files blind to the top-severity pattern in BOTH layers, basis: counted-in-code (security-class, rule 21 cap does not apply)
4. [ISSUE][LOW][demonstrated] `git filter-branch` left `refs/original/refs/heads/feat/path-b-precommit-secret-scan` at `d22eae8`; mentioned in no doc, and together with the backup tag it pins 8 commits holding exactly the content the rewrite removed; deleting the tag alone leaves them reachable, and no pre-merge step names either removal; 0 blocking matches today because `history-scan.ts:7-10` scopes to HEAD-ancestry by disclosed design. STILL OPEN at c4d2b33. Exposure: 8 retained commits, 0 blocking matches today, basis: measured
5. [ISSUE][LOW][demonstrated] Both hand-derived completeness claims about the rewrite are wrong — "all 17 commits on the branch got new SHAs" is 8 changed / 9 preserved (measured), "2 EARLIER commits" is 4 commits across 2 distinct blobs; the `master..HEAD` range covered all four so the fix was complete anyway, but an auditor verifying the disclosure literally would have cleared it with 2 dirty commits standing. PARTIALLY ADDRESSED at c4d2b33: the bare count was dropped so QA-15 now passes, but the replacement sentence "every commit on the branch got a new SHA" is still false and "2 EARLIER commits" is still present — a reword past the gate, not through it. Exposure: 2 of 2 numeric claims in the round-4 close-out, basis: measured
6. [ISSUE][LOW][demonstrated] Three SHA citations in the append-only `docs/decisions.md` (`4ea1456`, `7779da4`, `a9d68e4`) resolve only via the backup tag / `refs/original`, both slated for deletion at ship; audit trail is a CLAUDE.md sensitive area and rule-11 immutability blocks editing them; no old-to-new SHA map recorded. STILL OPEN at c4d2b33. Exposure: 3 of 3 stale citations in the permanent decision record, basis: measured
7. [SUSPICION][LOW][code-traced] Issue #187's POSIX half still unproven-pending-verification (carried unchanged from round 2 — no POSIX runtime on this box); newly established this round is that the `100755` bit and the `160000` adr gitlink both survived the `--tree-filter` checkout in all 8 old/new commit pairs, which was the new risk the rewrite introduced
8. [CLEAN][demonstrated] Rewrite mechanism fidelity — all 8 old-to-new pairs: only `docs/qa/secret-scan-allowlist.json` differs and only by a dash insertion; author/committer identity + both timestamps + full message body byte-identical; exec bit and submodule gitlink preserved; parent chain strictly linear; 17 pre-rewrite commits -> 17 rewritten, none dropped, none reparented; the `2>/dev/null || true` that could have swallowed a sed failure demonstrably did not need to
9. [CLEAN][demonstrated] Issue #193 genuinely FIXED at the current tip — my own exact round-2 attack (a distinct key-shaped literal in an incident-note `reason` field) now FAILs naming `docs/qa/secret-scan-allowlist.json` and the commit is refused at exit 1; guard tests present and self-mutation-proving at `history-scan.test.ts:168-220`. Closed completed with a re-verification comment
10. [CLEAN][demonstrated] Issue #194 FIXED — `pre-commit-scan.ts:15-25` states the measured figure and cites PRINCIPLES rule 18; PASS-run output down from 264 lines to 1; re-measured 11226/13250/13373 ms over 3 warm runs. Closed completed with a re-verification comment
11. [CLEAN][code-traced] All 3 round-2 LOW items landed — `git rev-parse --git-dir` probe (`git-hooks-install.ts:31,38-41,72`), BLOCKED message names `git commit --no-verify` as the unlock (`pre-commit-scan.ts:91`), Docker `COPY package*.json` claim corrected with the unfixed half disclosed
12. [CLEAN][demonstrated] The pre-commit hook is genuinely active in the PRIMARY checkout and gates a real commit — `core.hooksPath=.githooks`, hook mode `-rwxr-xr-x`, planted AWS-key-shaped literal refused at exit 1 naming the file, HEAD unchanged, working tree restored to 0 modified entries
13. [CLEAN][demonstrated] Remaining verification surface holds — typecheck clean, lint clean, `history-scan.ts` exit 0 PASS 0 blocking, `recurring-findings-registry` exit 0 PASS (3 classes), `git diff master HEAD -- .github/workflows/ci.yml` = 0 lines (R5's non-CI-scope claim intact through the rewrite)
counts (CHECKSUM): issues=6 suspicions=1 clean=6
evidence (CHECKSUM): demonstrated=11 code-traced=2 derived=0
checks=at ec11f5c (dispatched HEAD): npm test 827 tests / 826 pass / 1 fail / 0 skipped, npm exit 1 (failing: src/qa/completeness-claim-checker.test.ts:235); at c4d2b33 (landed mid-review): npm test 827 / 827 pass / 0 fail / 0 skipped, npm exit 0, completeness-claim-checker EXIT=0 PASS; typecheck clean; lint clean; history-scan.ts EXIT=0 PASS 0 blocking 1029 allowlisted; recurring-findings-registry.ts EXIT=0 PASS; ci.yml diff vs master = 0 lines; 10 adversarial fixtures incl. 5 clone-isolated hook probes (2 landed a key-shaped literal in history) + 1 live primary-checkout hook drill + an 8-pair commit-fidelity comparison + a live ls-remote/GitHub-API remote-reachability probe
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round3-2026-09-14.md
