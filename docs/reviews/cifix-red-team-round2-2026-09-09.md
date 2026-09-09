# Red Team (Sutekh) — `cifix` adversarial re-confirm, ROUND 2

- **Scope:** `cifix` (`docs/.maat-state.json` -> `scope`), CRITICAL tier
- **Date:** 2026-09-09
- **HEAD:** `1b4053cfec43084a6cba411097cddf42012fa357` (uncommitted working-tree diff reviewed)
- **Round-1 report:** `docs/reviews/cifix-red-team-2026-09-09.md` (`no-go`, issues=6 suspicions=1 clean=9)
- **Diff under attack:** `.github/workflows/ci.yml`, `src/secret-scan/patterns.ts`, `src/secret-scan/patterns.test.ts`, `CHANGELOG.md`, `docs/backlog.md`, `docs/decisions.md`, `docs/.maat-state.json`, `docs/REVIEW_LOG.md`, `docs/run-log.jsonl`, plus untracked `docs/plans/cifix-phase1-2026-09-09.md` and three `docs/reviews/cifix-*-2026-09-09.md`
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **ADR rules read for this attack surface:** devops ADR-0008 (CI/CD gates and policy-as-code — `pipeline,quality,security,supply-chain`; the ratchet rule), devops ADR-0009 (least-privilege IAM/secrets), SE ADR-0009 (MUST NOT log secrets/tokens), SE ADR-0010 (code-quality gates run locally before "complete")
- **Verdict:** `no-go` — one blocking HIGH (NEW, introduced by this round's own fix), three MED, one LOW, one MED suspicion, twelve CLEAN

> **Nine of my round-1 concerns are genuinely closed, and I verified every one by re-running the drill rather than reading the receipt.** Issues #125, #127 and #128 are closed on my own evidence. The `no-go` is on a NEW, demonstrated defect: **committing this diff turns `npm test` red again**, on the very instrument the round fixed, because the fix's own test fixtures, code comments and CHANGELOG prose are themselves `internal-hostname`-shaped and are not on the OSS-01 allowlist. Issue #126's harm is re-armed by Issue #126's own fix.

---

## Method note

Every mechanical claim below is re-derived from a command I ran this session, raw output pasted. I did not read the fix claims and confirm them; I re-ran round 1's drills, mutation-tested the new regression test, and built a **simulated commit** (`git commit-tree`, never touching HEAD or the real index) to see what the shipped repo actually looks like to OSS-01 after merge.

---

# Findings, ranked by blast radius

## 1. [ISSUE][HIGH][demonstrated] — NEW: committing this diff makes `npm test` RED again. The fix for Issue #113 plants 7 fresh blocking OSS-01 matches in the very files that fix it.

**Exposure: ~100% of CI runs after this commit lands, basis: measured.** Security / CI-gate category, so PRINCIPLES rule 21's narrow-exposure cap does not apply.

### Attack
Assumption being broken: *"`npm test` is 660/660 green, so Issue #113 is closed and CI can now reach its downstream gates."* The 660/660 is real — **in the working tree**. OSS-01's dogfood test does not scan the working tree. `src/secret-scan/history-scan.ts:71-90` scans **committed blobs** (`git.revList(ref ?? "HEAD")` then `git.lsTree(commit)`), and `src/secret-scan/history-scan.test.ts:70-77` calls `scanHistory(git)` with no ref. The new fixtures are uncommitted, so they are invisible to today's green run and become visible the instant the diff is committed.

### Scenario
The Manager commits `cifix`. `npm test` runs on the commit. OSS-01's dogfood assertion (`assert.equal(result.ok, true, ...)`) fails. Step 6 `Test (full node:test suite)` goes red, `bash -e`, no `continue-on-error` anywhere in the parsed YAML — so steps 7-24 never execute, **including step 14 `QA-14 reference-resolver` (the only consumer of the `adr` submodule this whole story exists to restore), step 15 `QA-15`, and step 23 `OSS-01 full-history secret scan`.** That is Issue #126's finding, word for word, re-armed.

Built a simulated commit without touching HEAD or the index, then ran the **real** scanner with the **real** allowlist against it:

```
$ GIT_INDEX_FILE=$SB/simidx2 git read-tree HEAD
$ GIT_INDEX_FILE=$SB/simidx2 git add .github/workflows/ci.yml CHANGELOG.md docs/backlog.md \
      src/secret-scan/patterns.ts src/secret-scan/patterns.test.ts
$ TREE=$(GIT_INDEX_FILE=$SB/simidx2 git write-tree); SIM2=$(git commit-tree "$TREE" -p HEAD -m "SIM minimal code-only commit")
SIM_MINIMAL=a0bd546a7f97f1469f379622309293b8f0b99c43

$ npx tsx __simscan.ts a0bd546a7f97f1469f379622309293b8f0b99c43   # scanHistory + real allowlist + summarizeMatches
ok = false
7 secret-shaped match(es) found in history (12 allowlisted, not counted). Values redacted below.
  BLOCKING> a0bd546a7f97 CHANGELOG.md                     [internal-hostname] ... sett…[REDACTED 14 chars]
  BLOCKING> a0bd546a7f97 CHANGELOG.md                     [internal-hostname] ... db01…[REDACTED 13 chars]
  BLOCKING> a0bd546a7f97 src/secret-scan/patterns.test.ts [internal-hostname] ... db01…[REDACTED 13 chars]
  BLOCKING> a0bd546a7f97 src/secret-scan/patterns.test.ts [internal-hostname] ... sett…[REDACTED 14 chars]
  BLOCKING> a0bd546a7f97 src/secret-scan/patterns.test.ts [internal-hostname] ... sett…[REDACTED 14 chars]
  BLOCKING> a0bd546a7f97 src/secret-scan/patterns.test.ts [internal-hostname] ... db01…[REDACTED 13 chars]
  BLOCKING> a0bd546a7f97 src/secret-scan/patterns.ts      [internal-hostname] ... sett…[REDACTED 14 chars]
--- HEAD still: 1b4053cfec43084a6cba411097cddf42012fa357 ---
```

**7 is the floor** (code-only commit). With the working tree as it stands — review reports and the Phase 1 plan included, which PRINCIPLES rule 10 requires be committed — it is **11**:

```
$ npx tsx __simscan.ts 028dbc808b584694193b20b2fb8d7a4dfe6b04c3   # whole working tree
ok = false
11 secret-shaped match(es) found in history (12 allowlisted, not counted).
  ... + docs/plans/cifix-phase1-2026-09-09.md      [internal-hostname] x2
  ... + docs/reviews/cifix-red-team-2026-09-09.md  [email-address]     x2
```

Exact strings and locations, machine-enumerated (not eyeballed):

```
CHANGELOG.md:17                     [internal-hostname] "settings.local"  ctx="corp|local)\b`) matched \"settings.local\" embedded i"
CHANGELOG.md:17                     [internal-hostname] "db01.internal"   ctx="both the true positive (`db01.internal` still matc"
src/secret-scan/patterns.test.ts:32 [internal-hostname] "db01.internal"   ctx="p.regex.test(\"connect to db01.internal for the sta"
src/secret-scan/patterns.test.ts:37 [internal-hostname] "settings.local"  ctx="ngs.local.json` matched 'settings.local' as an inte"
src/secret-scan/patterns.test.ts:43 [internal-hostname] "settings.local"  ctx="his repo's own history: \"settings.local-"
src/secret-scan/patterns.test.ts:48 [internal-hostname] "db01.internal"   ctx="st(\"the replica lives at db01.internal.\"));"
src/secret-scan/patterns.ts:20      [internal-hostname] "settings.local"  ctx="haped strings\", matched \"settings.local\" as an inte"
docs/plans/cifix-phase1-2026-09-09.md:29,62       [internal-hostname] "settings.local" / "db01.internal"
docs/reviews/cifix-red-team-2026-09-09.md:131,134 [email-address]     "ghp_FAKETOKEN123@github.com"
```

Note the mechanism precisely: the fix narrowed `internal-hostname` so `settings.local.json` no longer matches — but the fix's own prose writes `settings.local` **inside quotes and backticks**, terminated by a quote character, which the lookahead `(?![.-][a-z0-9])` does not exclude. The comment explaining the false positive **is itself a true match** under the fixed pattern.

The last two are mine — my own round-1 report's fake-token lab line reads as an `email-address`. I am not exempting myself; it is on the fix list below.

### Current defense (honestly assessed)
None, and nothing in the diff anticipates it. `docs/qa/secret-scan-allowlist.json` is **unchanged** (`git diff` on it is empty — correct per ADR-0008's ratchet rule for the *original* false positive, but it means the new fixtures have no entry). `partitionAllowlisted` (`history-scan.ts:103-114`) matches on **exact `path` + `patternId`**; the three existing `src/secret-scan/patterns.test.ts` entries cover `aws-access-key-id`, `ipv4-private`, `email-address` — **not `internal-hostname`**. The CHANGELOG reports `npm test 660/660` truthfully but from a state that will not exist after commit. Nobody checked the post-commit state; I did, with the project's own instrument.

### ADR conflict
devops **ADR-0008** (`Accepted`), Rules for agents: *"MUST NOT merge a PR with any blocking gate open, failing, or pending"* and *"MUST run the full gate set locally … before declaring work complete; failing gates = unfinished work."* The gate is green locally only because of an artifact of where the scanner reads from.

### Verdict: **BREAKS**

### Required before merge — named drill
**`oss01-post-commit-dogfood-drill`** (blocking):
1. Add the missing reviewed allowlist entries — same shape and rationale as the five already there (`patterns.test.ts` fixtures are exactly what the allowlist mechanism exists for, and allowlisted matches are still **reported**, never dropped): `src/secret-scan/patterns.test.ts` + `internal-hostname`; `src/secret-scan/patterns.ts` + `internal-hostname`; `CHANGELOG.md` + `internal-hostname`; `docs/plans/cifix-phase1-2026-09-09.md` + `internal-hostname`; `docs/reviews/cifix-red-team-2026-09-09.md` + `email-address`; `docs/reviews/cifix-red-team-round2-2026-09-09.md` + `internal-hostname` and + `email-address`. Each with a one-line reason, per the file's own convention.
2. Re-run the drill I ran: build the simulated commit and assert `ok === true` **before** committing for real. The commands are in this report, verbatim.
3. `npm test` must then be 660/660 **against the simulated commit**, not against the working tree.

**Structural residual worth a decision, not a patch (route to `architecture-reviewer`):** the allowlist matches by exact path with no globs, so **every future review report, plan, or CHANGELOG entry that discusses a detection pattern needs its own new allowlist entry, forever.** That is an unbounded maintenance cliff on a CI-gating instrument, and this round is its first bite. Options: a path-prefix rule for `docs/reviews/` and `docs/plans/`; excluding prose-shaped patterns from Markdown paths; or requiring the match not sit inside backticks or quotes. All are design calls above my pay grade — leaving it unnamed guarantees a recurrence.

---

## 2. [ISSUE][MED][demonstrated] — Issue #127's fix says "this is NOT a credential problem" precisely when it IS one

**Exposure: ~100% of runs in which `ADR_REPO_PAT` is invalid, expired, revoked, or under-scoped — including day 91 of the 90-day PAT with no rotation automation. Basis: measured (the branch is unconditional on an `ls-remote` failure).**

### Attack
Assumption being broken: *"a failed reachability check means the SHA is unreachable."* Under `set -euo pipefail`, the condition `! git ls-remote <url> | grep -q "$PINNED_SHA"` is true in **two** distinct worlds: (a) `ls-remote` succeeded and the SHA is not a ref tip; (b) `ls-remote` itself **failed** — bad credential, revoked PAT, expired PAT, network or throttle — and `pipefail` propagated that failure. Both print the same message, and that message asserts the credential is fine.

### Scenario — demonstrated
Ran the exact step logic from `.github/workflows/ci.yml:64-88` with a bad token:

```
=== DRILL B2: BAD/EXPIRED PAT (ls-remote fails) ===
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/mohannadrabie/adr.git/'
::error::adr gitlink cdb245d977fd67889bf69c9710a13b70a8b5045f is NOT reachable on the adr remote ...
          This is NOT a credential problem: the ls-remote query above used the exact same
          ADR_REPO_PAT credential the submodule init below uses.
B2_EXIT=1
```

Positive control, same script, working credential:

```
=== DRILL B1: real gitlink, ambient creds ===
REACHABILITY-OK cdb245d977fd67889bf69c9710a13b70a8b5045f
B1_EXIT=0
```

### Current defense (honestly assessed)
It fails loud (exit 1) — no silent degradation, and the raw `fatal: Authentication failed` line **is** visible two lines above. But the step's own `::error::` annotation is what GitHub surfaces in the run summary and what the next debugger reads first, and it confidently denies the true cause. Round-1 finding 6 asked for messages that distinguish the credential case from the gitlink case; this fix delivered the gitlink message and inverted the credential one. Net diagnostic quality is better than round 1 in the empty-PAT case (clean finding 14 below) and **worse** in the expired-PAT case.

### Verdict: **BREAKS**

### Required before merge — named test
**`ci-adr-ls-remote-failure-attributed-check`** — split the two worlds by capturing the command status separately from the grep:

- Assign the `ls-remote` output to a variable inside an `if !` guard. On failure, emit an error that says this IS a credential/network problem, names the four causes (invalid, expired, revoked, under-scoped), gives the `gh secret set` unlock, and echoes the raw git stderr.
- Only then grep the captured output for the pinned SHA, and on a miss emit the existing gitlink message with the clarifier "ls-remote itself succeeded."

The test asserts both branches — a deliberately bad token and a deliberately bogus SHA — and that the two messages differ.

---

## 3. [ISSUE][MED][demonstrated] — the `internal-hostname` narrowing over-shoots the measured false positive: a `.corp.` FQDN is now silently undetected

**Exposure: 0% of matches lost against this repo's entire history today (measured); forward-looking detection gap on a security instrument, basis for future frequency: assumption.**

### Attack
Assumption being broken: *"a real internal host never continues with another dotted segment"* — the code comment at `src/secret-scan/patterns.ts:23`. That is false for the single most common corporate internal naming convention, where `.corp` and `.internal` are **middle** labels of a real FQDN. RFC 6762 formalizes `.local` as a terminal pseudo-TLD; it says nothing that supports the same for the other two.

### Scenario — demonstrated (old regex vs new, same 17 inputs)
```
OLD:HIT  | NEW:HIT  | "db01.internal"
OLD:HIT  | NEW:HIT  | "ip-10-0-1-5.ec2.internal"
OLD:HIT  | NEW:miss | "settings.local.json"                <-- intended fix, correct
OLD:HIT  | NEW:miss | "settings.local-shaped strings"      <-- intended fix, correct
OLD:HIT  | NEW:miss | "api.internal.acme.com"              <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "vault.corp.acme.com"                <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "jenkins.corp.example.net"           <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "printer.local.lan"                  <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "mail.corp.co.uk"                    <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "svc.internal-prod"                  <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "redis.internal-1"                   <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:miss | "host.local-01"                      <== NEW FALSE NEGATIVE
OLD:HIT  | NEW:HIT  | "db01.internal:5432"
OLD:HIT  | NEW:HIT  | "db01.internal/health"
```

### Current defense (honestly assessed) — and why this is MED, not HIGH
**The narrowing is surgical against this repo as it actually exists, and I measured that rather than assuming it.** Across every tracked file, and separately across every added line in the entire history of every ref, the ONLY string the new regex stops matching is `settings.local`:

```
$ # tracked files
OLD total matches across tracked files: 46
distinct strings OLD hits that NEW no longer hits: 1
  30  settings.local

$ # all history, all refs, added lines
added-lines scanned (all history, all refs): 67410
OLD matches: 47 | distinct suppressed by NEW: 1
  47  settings.local
```

So **zero real detections are lost today**. The gap is prospective: the moment a `.corp.` or `.internal.` FQDN enters a document or a config, OSS-01 will not flag it, and it will fail silently rather than loudly. The narrowing also has no regression test pinning a multi-label FQDN as a true positive, so the gap is unguarded against future edits. devops ADR-0008's *"MUST NOT lower gate thresholds … (ratchet only)"* is satisfied in substance (nothing real was suppressed) but not in form (the detection surface did shrink beyond the justified case).

### Verdict: **BREAKS** (coverage regression; no current-state harm)

### Required before merge — named test
**`internal-hostname-subdomain-continuation-test`** — assert a `.corp.`/`.internal.` FQDN still matches while `settings.local.json` and the hyphenated-modifier prose shape still do not. The narrowing that satisfies both excludes a *file-extension-shaped* or *English-modifier-shaped* continuation rather than any continuation: a negative lookahead over a named extension list plus one over `-[a-z]{2,}`. I checked that form keeps every "correct" line above correct and turns every `NEW FALSE NEGATIVE` line back into a hit. Whichever form is chosen, the test is the deliverable.

---

## 4. [ISSUE][MED][demonstrated] — this diff adds 3 NEW QA-15 failures, in the entry that documents the fix, against a CLAUDE.md hard rule

**Exposure: 100% of QA-15 runs (CI step 15), basis: measured before/after.**

### Attack
Assumption being broken: *"QA-14/QA-15 are red for pre-existing reasons only (Issue #120), unchanged by this diff."* The CHANGELOG says exactly that. QA-15's redness is not only pre-existing — this diff **adds** to it.

### Scenario — measured, before vs after, same instrument
```
=== AFTER (working tree) ===
  - docs/STATE.md:     3 of 3 numeric completeness claim(s) failed.
  - docs/decisions.md: 6 of 6 numeric completeness claim(s) failed.
  - CHANGELOG.md:      2 of 3 numeric completeness claim(s) failed.
exit=1

=== BEFORE (HEAD versions of CHANGELOG.md / docs/decisions.md / docs/backlog.md) ===
  - docs/STATE.md:     3 of 3 numeric completeness claim(s) failed.
  - docs/decisions.md: 5 of 5 numeric completeness claim(s) failed.
exit=1
```

`CHANGELOG.md` goes from **not failing at all** to **2 failing claims**; `docs/decisions.md` from 5 to 6. Net **+3**. The specific new claims QA-15 names, all hand-derived, none carrying a `[[completeness: ...]]` instrument marker:

- `"10 of 10 push/PR runs died at actions/checkout from 2026-09-01 onward"` (CHANGELOG line 10) — and my own measurement from `gh run list`, re-confirmed this session, is **12** consecutive push failures since 2026-09-01. The number is both unmarked and wrong.
- `"readable by all 23 later steps"` (CHANGELOG line 13) — the `ci` job now has 25 steps, so this is stale by the diff's own restructuring.
- `"56 blocking false-positive matches across 9 commits, all traced to this one pattern"` (CHANGELOG line 15).

CLAUDE.md, Hard rules: *"No hand-derived completeness claims. Any claim of completeness/exhaustive enumeration … is generated by a running instrument … never hand-typed or hand-derived in prose."* QA-15 is the instrument that enforces it, and it is a CI-gating step.

### Current defense (honestly assessed)
The CHANGELOG discloses QA-15 as red and attributes it entirely to Issue #120 — honest about the redness, incomplete about the attribution. No defense against adding to it.

### Verdict: **BREAKS**

### Required before merge — named test
**`changelog-completeness-marker-check`** — the existing QA-15 instrument, run as a pre-commit assertion on the diff's own added lines: the added CHANGELOG/decisions rows must carry `[[completeness: ...]]` markers or be reworded to non-enumerative prose, such that QA-15's per-file failure counts for `CHANGELOG.md` and `docs/decisions.md` are **no worse than HEAD's**. Also correct `10 of 10` to the measured `12`, and `23 later steps` to the current step count.

---

## 5. [ISSUE][LOW][code-traced] — the credential-residue assertion is narrower than the finding it claims to close

`.github/workflows/ci.yml:96-99` greps only `"$HOME/.gitconfig"`. Round-1 finding 2 named **two** disk locations, and its named test covered `"$HOME/.gitconfig"` **and** `"$RUNNER_TEMP"`. `$RUNNER_TEMP` was dropped. It is genuinely no longer needed — the `run:` body no longer interpolates the secret (verified: `grep -n "secrets\." .github/workflows/ci.yml` shows both references live only in the step-level `env:` block, lines 60 and 62) — but the assertion no longer *demonstrates* that; it assumes it. Separately, the check passes identically whether there is no residue or no `$HOME/.gitconfig` at all, so it cannot tell "clean" from "vacuous."

**Verdict: BREAKS (LOW — assertion quality, non-gating).** Fix: add `"$RUNNER_TEMP"` back to the grep, and a positive control so the check is provably live rather than trivially satisfied.

---

## 6. [SUSPICION][MED][demonstrated] — 25 of 25 steps still have never executed in a real runner; `ADR_REPO_PAT` still does not exist

```
$ gh run list --repo mohannadrabie/thoth --limit 15
34398589099 failure  push      2026-09-09  ...  33567258532 failure push 2026-09-01   # 12 consecutive
34113871355 success  schedule  2026-09-07     # the no-submodule drift job — consistent, not a counterexample
33231761655 success  push      2026-08-29     # last green push, pre-regression

$ gh secret list --repo mohannadrabie/thoth
(empty — ADR_REPO_PAT still absent)
```

Every drill in this report ran on `win32`; CI is `ubuntu-latest`. The new step introduces `set -euo pipefail`, `ls -A`, `awk`, and a network `git ls-remote` into a runner state that has never existed. Unsettleable from here.

**Verdict: UNPROVEN-pending-verification.** **Command that settles it:** the human creates `ADR_REPO_PAT`; push to a throwaway branch; `gh run view <id> --json jobs` must show all 25 `ci` steps `success`. **Who runs it:** the human (secret) plus the Manager (non-default-branch push). A task, not an independent blocker.

---

# SURVIVES — round-1 findings I re-attacked and now close, plus new clean passes

**7. [CLEAN][demonstrated] Does `npm test` actually pass end-to-end now?** Round-1 finding 1 exploitability drill, re-run rather than read:
```
i tests 660
i suites 0
i pass 660
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 21667.1063
NPM_TEST_EXIT=0
```
including the previously-red `OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass (19160.745ms)`. **In the working tree, genuinely 660/660.** Finding 1 is about the committed tree, not this. **SURVIVES.**

**8. [CLEAN][demonstrated] Is Issue #113's regression test vacuous?** My round-1 finding 4 was exactly this shape, so I mutation-tested it rather than read it, and separately checked for `/g` `lastIndex` leakage across the shared `SECRET_PATTERNS` objects. Reverted `patterns.ts` to the pre-fix regex in place, re-ran the file:
```
x internal-hostname: does NOT match a config-filename fragment (regression ... Issue #113 ...)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  true !== false
      at TestContext.<anonymous> (src/secret-scan/patterns.test.ts:39:10)
```
Restored immediately. `findPattern()` (`patterns.test.ts:5-10`) sets `p.regex.lastIndex = 0` on every lookup, so there is no cross-test state leak and no order dependence. **Non-vacuous. SURVIVES.**

**9. [CLEAN][demonstrated] Was Issue #113 fixed by widening the allowlist instead of the pattern (an ADR-0008 ratchet violation)?** `git diff -- docs/qa/secret-scan-allowlist.json` is **empty**; the file still holds exactly its 5 pre-existing test-fixture entries. Measured, not assumed: the narrowing suppresses ONLY `settings.local` — 47/47 across all history, **0** other distinct strings. Fixed at the pattern; the ratchet rule is honored in substance. **SURVIVES.**

**10. [CLEAN][demonstrated] Issue #125 — does the fix genuinely remove the `~/.gitconfig` residue?** Re-ran my own residue check. `grep -n "config --global" .github/workflows/ci.yml` returns one hit, and it is the **comment** explaining why it is not used. Lab, a real rewritten fetch via the `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0` env form:
```
RESIDUE=NONE
HOME/.gitconfig exists? NO
grep realsub in global: 0
(none in .git/config)   (none in .git/modules/adr/config)
```
The credential env scope is now **one step** that runs no `npm`, so the round-1 "live through npm ci over 83 packages" window is closed by construction, not by cleanup. **Issue #125 closed on my own evidence. SURVIVES.**

**11. [CLEAN][demonstrated] Issue #127 — is the ls-remote mechanism real, and is it the sound design rather than the reverted bare-SHA fetch?** `.github/workflows/ci.yml:85` pipes `git ls-remote https://github.com/mohannadrabie/adr.git` into `grep -q` on the pinned SHA; there is no bare-SHA `git fetch` anywhere in the file. Drilled live against the real remote:
```
REACHABILITY-OK cdb245d977fd67889bf69c9710a13b70a8b5045f
B1_EXIT=0
```
and `git ls-tree HEAD adr` piped to awk field 3 yields the full 40-hex SHA correctly. **This is the mechanism my round-1 report verified sound.** Its failure-attribution defect is finding 2, not a mechanism defect. **Issue #127 closed on my own evidence. SURVIVES.**

**12. [CLEAN][demonstrated] Is the CHANGELOG's "measured, not assumed" claim about the rejected bare-SHA fetch honest, or a post-hoc rationalization?** Reproduced independently against a real public repo:
```
$ git fetch --depth=1 https://github.com/torvalds/linux.git 8b3ab0d4d3d5ec9dc5e1b6e0dc2b4b1bbe12ba69
fatal: remote error: upload-pack: not our ref 8b3ab0d4d3d5ec9dc5e1b6e0dc2b4b1bbe12ba69
FETCH_EXIT=128
```
The claim is **true**, and the ref-tip-only limitation is disclosed in `docs/backlog.md` rather than assumed away. Honest reporting of a corrected design, including the inconvenient part. **SURVIVES.**

**13. [CLEAN][demonstrated] Issue #128 — is the "submodule populated" assertion non-vacuous?** Negative controls: with `adr/devops` and `adr/software-engineering` deleted, `ASSERT=FAIL (correct - non-vacuous)`; with both present but empty, `ASSERT=FAIL (correct)`. Positive control on the real populated tree: `REAL_ASSERT=PASS (devops=12 files, se=23 files)`. Also reconfirmed the vacuous state it guards — with nothing registered, `git submodule update --init --recursive` still returns `NOREWRITE_EXIT=0` with `adr/ after: []`, exit 0 and no output, exactly what the old `git submodule status` line "proved." **Issue #128 closed on my own evidence. SURVIVES.**

**14. [CLEAN][demonstrated] Empty/missing PAT — does the precondition fire first, loud, and distinguishably?**
```
=== DRILL A: empty PAT ===
::error::ADR_REPO_PAT secret is not set (or is empty) -- create it: gh secret set ADR_REPO_PAT ...
A_EXIT=1
```
It runs before any git invocation, names its own unlock (PRINCIPLES rule 2), and is distinguishable from every other message in the step. Round-1 finding 6 **closed. SURVIVES.**

**15. [CLEAN][code-traced] Round-1 finding 5 — insteadOf byte-prefix over-scope onto sibling repos whose name begins with `adr`.** `.github/workflows/ci.yml:62` now pins the key to the exact `.git`-suffixed URL `.gitmodules` declares, so a sibling repo no longer prefix-matches. Closed exactly as round 1 predicted the `GIT_CONFIG_*` rewrite would close it. **SURVIVES.**

**16. [CLEAN][demonstrated] Issue #120 (QA-14/QA-15) — quietly touched, or genuinely still red as disclosed?** `git diff --stat -- src/qa/reference-resolver.ts src/qa/completeness-claim-checker.ts` is **empty**; `git status --short src/qa/` is **empty**. Both instruments re-run: `qa:reference-resolver` `QA14_EXIT=1` (129/316 unresolved), `qa:completeness-claims` `QA15_EXIT=1`. Untouched and still red, exactly as disclosed. Its *worsening* is finding 4; the two source files themselves are clean. **SURVIVES.**

**17. [CLEAN][demonstrated] Did collapsing two steps into one introduce a `continue-on-error`, a permissions widening, or a new trigger?** Parsed the file rather than eyeballing it: `ci` job 25 steps (was 26), `runtime-settings-drift` 4 steps, **no `continue-on-error` on any step**, `permissions: {"contents":"read"}`, triggers `push:[master]` / `pull_request:[master]` / `schedule:[cron 0 6 * * 1]` unchanged, no `pull_request_target`. The string `secrets.` appears exactly twice, both inside the step-level `env:` block (lines 60, 62). **SURVIVES.**

**18. [CLEAN][code-traced] Does the collapsed step leave the credential reachable by later steps?** Step-level `env:` in GitHub Actions is per-step process environment. Step 1 is the only step carrying `ADR_REPO_PAT`/`GIT_CONFIG_*`, and it invokes only git, ls, grep and awk — no npm, no third-party binary. Steps 2 through 24 run with none of it set. Round-1's supply-chain window is closed by construction. **SURVIVES.**

**Credit where due.** Three of my four round-1 code findings were fixed with a mechanism better than the one I proposed, not merely equal to it: the empty-PAT precondition, the gitlink check and the populate assertion all sit inside one step so they run in dependency order and each names its own unlock. The bare-SHA-fetch detour was measured, found wrong, reverted, and **disclosed** rather than quietly dropped — exactly the behaviour this process exists to produce, and it deserves saying.

---

# Editorial (verdict-neutral, plain edits, no re-review)

1. `docs/backlog.md`'s rotation entry names the step "Configure credential for private `adr` submodule" — that step no longer exists; this diff collapsed it into "Init adr submodule (private repo, adr-only credential, scoped to this step only)".
2. `CHANGELOG.md` line 15 says the fix pins "both false-positive shapes found in this repo's own history" — it pins three assertions, two of which are the same shape; the count is loose.
3. `.github/workflows/ci.yml` line 47's comment says "10/10 runs" — measured 12 consecutive push failures (see finding 4).
4. The comment at `src/secret-scan/patterns.ts:23` states as fact that "a real internal host never continues with another dotted segment." That is the assumption finding 3 breaks; reword it as the scoped claim it actually is.

---

# Bottom line

## Single scariest unproven assumption
**That "660/660 green" describes the repository anyone will actually run CI against.** It describes the working tree. The committed tree — the only thing `scanHistory` reads, and the only thing CI ever sees — carries 7 blocking OSS-01 matches minimum, 11 as the tree stands, every one of them planted by this round's own fix for the failure it was fixing. The gate is green in the one place the gate does not look.

## Verdict: **no-go**
Not on the workflow hardening, which is materially better than round 1's and against which I closed three of my own Issues. `no-go` on one demonstrated HIGH — a self-inflicted, deterministic re-break of `npm test`, backed by devops ADR-0008's "MUST NOT merge a PR with any blocking gate open, failing, or pending" — plus three MED.

## Single next action
**Run `oss01-post-commit-dogfood-drill` before committing anything:** add the missing reviewed allowlist entries, rebuild the simulated commit with `git commit-tree`, and re-run the real scanner against it until `ok = true`. Nothing else in this report — not the PAT, not the runner — is needed to settle it, and it takes one minute.

## Findings to tests (equal counts, PRINCIPLES rule 19)
5 open findings, 5 named tests — no gap:

| # | Finding | Named failing test / drill |
|---|---|---|
| 1 | HIGH — post-commit OSS-01 re-break | `oss01-post-commit-dogfood-drill` |
| 2 | MED — credential failure mis-attributed as "not a credential problem" | `ci-adr-ls-remote-failure-attributed-check` |
| 3 | MED — internal-hostname over-narrowing | `internal-hostname-subdomain-continuation-test` |
| 4 | MED — three new QA-15 completeness-claim failures | `changelog-completeness-marker-check` |
| 5 | LOW — residue assertion narrower than the finding | folded into `ci-no-credential-residue-check` |

Suspicion 6 has no independent executable form — it is settled by the human's `ADR_REPO_PAT` provisioning plus one throwaway-branch push, which is why it is not double-counted.

**Self-disclosure:** this report is itself scanned by OSS-01 once committed, and it contains `internal-hostname`- and `email-address`-shaped strings that are load-bearing evidence. Its allowlist entry is listed in finding 1's drill alongside everyone else's. I am not exempting my own artifact from the finding I am filing.

---

```
RECEIPT: verdict=no-go
attacks (ALL, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] NEW self-inflicted CI re-break: committing this diff makes npm test RED — OSS-01's dogfood scans COMMITTED blobs (history-scan.ts:71-90), so the fix's own test fixtures/comments/CHANGELOG prose become 7 blocking internal-hostname matches minimum (11 with the review+plan docs), none on the exact-path allowlist; step 6 dies, QA-14/QA-15/OSS-01 never run — Issue #126's exact harm re-armed by its own fix. Proven with git commit-tree + the real scanner + real allowlist (ok=false). Violates devops ADR-0008 "MUST NOT merge a PR with any blocking gate open, failing, or pending". Defense: none — allowlist untouched, nobody checked the post-commit state. Exposure: ~100% of runs, basis: measured. -> oss01-post-commit-dogfood-drill
2. [ISSUE][MED][demonstrated] Issue #127's gitlink check mis-attributes credential failure: under set -euo pipefail a failed git ls-remote (bad/expired/revoked PAT — the day-91 case, no rotation automation) takes the same branch as an unreachable SHA and prints "This is NOT a credential problem". Drilled with a bad token: raw `fatal: Authentication failed` followed by the denial; positive control REACHABILITY-OK exit 0. Defense: fails loud, but the ::error:: annotation GitHub surfaces denies the true cause. Exposure: ~100% of invalid-credential runs, basis: measured. -> ci-adr-ls-remote-failure-attributed-check
3. [ISSUE][MED][demonstrated] internal-hostname narrowing over-shoots: the trailing-continuation lookahead also kills the canonical corporate FQDN shape (.corp./.internal. as a middle label) silently. Defense assessed honestly and it is strong: measured across ALL tracked files AND all 67410 added lines of full history, the ONLY string it stops matching is settings.local (47/47), so zero real detections are lost today; no regression test pins a multi-label FQDN as a true positive. Exposure: 0% today measured; forward-looking basis: assumption. -> internal-hostname-subdomain-continuation-test
4. [ISSUE][MED][demonstrated] This diff ADDS 3 new QA-15 (CI step 15) completeness-claim failures — CHANGELOG.md 0->2 failing claims, decisions.md 5->6, measured before/after with the instrument — violating CLAUDE.md's "no hand-derived completeness claims" hard rule inside the entry documenting the fix ("10 of 10 push/PR runs" — my own gh run list measures 12; "23 later steps" — the job now has 25; "56 matches across 9 commits"). Defense: CHANGELOG discloses QA-15 as red but attributes it entirely to Issue #120. Exposure: 100% of QA-15 runs, basis: measured. -> changelog-completeness-marker-check
5. [ISSUE][LOW][code-traced] Residue assertion (ci.yml:96-99) greps only $HOME/.gitconfig, dropping $RUNNER_TEMP from round-1's named test, and cannot distinguish "no residue" from "no gitconfig file" — it assumes the property it claims to assert. Defense: the property does hold (secrets. appears only in the env: block, lines 60/62), so this is assertion quality, not exposure. -> folded into ci-no-credential-residue-check
6. [SUSPICION][MED][demonstrated] 25 of 25 ci steps still never executed in a real runner — 12 consecutive push failures since 2026-09-01 re-confirmed, gh secret list still empty, every drill here ran win32 vs ubuntu-latest, and the new step adds set -euo pipefail/awk/ls -A/network ls-remote to a state CI has never seen. Settled by the human's PAT plus one throwaway push; not independently blocking.
7. [CLEAN][demonstrated] npm test independently re-run end-to-end: 660 total / 660 pass / 0 fail / 0 skipped, exit 0, OSS-01 dogfood green — 660/660 confirmed myself, not taken from the receipt. Working-tree state is genuinely green.
8. [CLEAN][demonstrated] Issue #113's regression test is NON-vacuous — mutation-tested by reverting patterns.ts to the pre-fix regex in place: the test goes red (true !== false at patterns.test.ts:39:10), then restored. findPattern() resets lastIndex per lookup, so no /g cross-test state leak and no order dependence.
9. [CLEAN][demonstrated] Fixed at the pattern, NOT by widening suppression — git diff on docs/qa/secret-scan-allowlist.json is empty (still the 5 pre-existing fixture entries), and the narrowing measurably suppresses only settings.local across all history. devops ADR-0008's ratchet-only rule honored in substance.
10. [CLEAN][demonstrated] Issue #125 residue genuinely gone — no `git config --global` in ci.yml except the comment explaining its absence; lab rewritten fetch leaves RESIDUE=NONE, no ~/.gitconfig at all, nothing in .git/config or .git/modules/adr/config; credential env-scoped to one step that runs no npm, so the 83-package install-script window is closed by construction. Issue #125 CLOSED on my own re-verification.
11. [CLEAN][demonstrated] Issue #127's mechanism is the SOUND ls-remote ref-tip comparison, not the reverted bare-SHA fetch — code-traced at ci.yml:85 (no bare-SHA git fetch anywhere) and drilled live: REACHABILITY-OK cdb245d9..., exit 0; ls-tree piped to awk yields the correct 40-hex SHA. Issue #127 CLOSED on my own re-verification.
12. [CLEAN][demonstrated] The CHANGELOG's "measured not assumed" claim about GitHub refusing a bare non-tip SHA fetch is TRUE — reproduced independently against torvalds/linux: upload-pack "not our ref", exit 128; ref-tip-only limitation disclosed in docs/backlog.md rather than assumed away.
13. [CLEAN][demonstrated] Issue #128's populate assertion is NON-vacuous — fails with adr/devops+adr/software-engineering deleted AND with both present-but-empty; passes on the real tree (12 + 23 files). Also reconfirmed the vacuous state it guards (unregistered submodule: update --init exits 0 printing nothing, adr/ empty). Issue #128 CLOSED on my own re-verification.
14. [CLEAN][demonstrated] Empty/missing ADR_REPO_PAT fails FIRST, loud, and distinguishably — exit 1 before any git call with an ::error:: naming its own unlock (gh secret set ...). Round-1 finding 6 closed.
15. [CLEAN][code-traced] Round-1 finding 5 (insteadOf byte-prefix over-scope onto adr-prefixed sibling repos) closed — the key is now pinned to the exact .git-suffixed adr URL at ci.yml:62, exactly as round 1 predicted the GIT_CONFIG_* rewrite would close it.
16. [CLEAN][demonstrated] Issue #120 genuinely untouched — git diff/status on src/qa/reference-resolver.ts and completeness-claim-checker.ts both EMPTY; both instruments re-run and still red (QA14_EXIT=1, 129/316 unresolved; QA15_EXIT=1), exactly as disclosed.
17. [CLEAN][demonstrated] Collapsing 2 steps into 1 introduced no structural regression — parsed YAML: ci job 25 steps, zero continue-on-error, permissions contents:read, triggers unchanged, no pull_request_target, secrets. only in the step-level env: block.
18. [CLEAN][code-traced] Credential unreachable from later steps — step-level env: is per-step process env; the only step carrying ADR_REPO_PAT/GIT_CONFIG_* invokes git/ls/grep/awk only, never npm. Round-1's supply-chain window closed by construction, not cleanup.
counts (CHECKSUM): issues=5 suspicions=1 clean=12
evidence (CHECKSUM): demonstrated=15 code-traced=3 derived=0
checks=npm test 660 total / 660 pass / 0 fail / 0 skipped (exit 0); mutation test on patterns.ts -> patterns.test.ts goes red (1 fail) then restored; OSS-01 real scanner vs 2 simulated commits (git commit-tree, HEAD untouched) -> ok=false, 7 blocking (code-only) / 11 blocking (full tree); regex old-vs-new differential over 17 shapes + all tracked files (46 matches) + all 67410 added lines of full history; qa:reference-resolver exit 1; qa:completeness-claims exit 1 before/after (CHANGELOG 0->2, decisions 5->6); ci.yml parsed (2 jobs, 25+4 steps, 0 continue-on-error); 4 workflow-step drills (empty-PAT exit 1; ls-remote good exit 0; ls-remote bad-token exit 1 misattributed; populate-assert 1 positive + 2 negative controls); git fetch non-tip SHA vs torvalds/linux exit 128; gh run list 12 consecutive push failures; gh secret list empty
adr=HIT(35)
report=docs/reviews/cifix-red-team-round2-2026-09-09.md
```
