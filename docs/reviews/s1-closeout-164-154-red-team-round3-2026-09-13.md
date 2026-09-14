# Red Team (Sutekh) — `s1-closeout-164-154` round-3 fix-now re-confirm (Issues #176/#177/#178/#179)

- **Date:** 2026-09-13
- **Target:** branch `fix/s1-closeout-164-154` @ `c2408ba` (round-2 base `713dbdd`); diff scope `src/lib/git.ts`, `src/lib/git.test.ts`, `src/qa/marker-corpus-probe.ts`, `src/qa/marker-corpus-probe.test.ts`, `src/qa/continuation-residual-probe.ts`, `src/qa/continuation-residual-probe.test.ts`, `CHANGELOG.md`, `docs/STATE.md`, `docs/decisions.md`, `docs/.maat-state.json`, `docs/REVIEW_LOG.md`
- **Tier:** CRITICAL (ratified round-1, unchanged)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **Scope:** targeted re-confirm of round 3, plus the explicitly-requested hunt for anything NEW this round introduced. Prior reports: `docs/reviews/s1-closeout-164-154-red-team-2026-09-13.md`, `docs/reviews/s1-closeout-164-154-red-team-round2-2026-09-13.md`.
- **Verdict:** **no-go** — 1 HIGH (demonstrated), 2 MED, 1 LOW, 1 LOW suspicion, 7 attacks survived.

## Headline, up front, because it is not the shape the round expected

**Three of the four claimed fixes are real and I verified every one of them myself, independently, by mutation.** #176 survived 48 concurrent runs (4x the claimed load). #177 and #178 each go red under my own hand-applied mutations, in both files. #179's deferral is honestly disclosed in all four places. #174's premature-closure defect did **not** recur a third time.

**And round 3 still introduced a fresh defect — the fourth consecutive round to do so.** It broke a blocking CI gate in one of this project's own named sensitive areas, and the round's "785/785 pass, 0 fail" verification could not have seen it, because the verification ran *before* the commit existed and the gate only reads committed history. `docs/reviews/s1-closeout-164-154-cross-domain-round3-2026-09-13.md` found the same defect independently and filed Issue #180 while I was working; my attack adds the mechanism and a second, separately-wired CI step that also fails.

## ADR slice read (attack surface: code correctness, test integrity, failure modes, evidence trail, CI gates)

From `adrCatalog.adrs` in `docs/.maat-state.json`, filtered to this diff's surface: SE ADR-0005 (testing strategy), ADR-0010 (code quality gates), ADR-0004 (idempotency by default), ADR-0003 (SOLID), ADR-0006 (blast radius control), ADR-0021 (thoth-native architecture). Attack 1 is an ADR-0010 concern directly (a shipped commit that reds a standing quality gate). Attack 4 is ADR-0005 again (a shipped behavior change with zero pinning tests) — the same class as #177, which this round closed. ADR fingerprint `83b2e3e` unchanged by this diff.

## Scope shapes I am NOT attacking, and why (stated, not skipped)

Unchanged and still honest: no resource apply, no deploy, no migration, no cloud provider, no distributed lock, no credential in this diff's path. Partial-apply, quota, throttling and AZ-degradation attacks would be manufactured noise here. Concurrency is attacked directly (attack 5). Hostile lens re-checked at attack 12.

---

## Attacks, ranked by blast radius

### 1. [ISSUE][HIGH][demonstrated] Round 3's own test fixture reds a blocking CI gate — and the gate reads committed history, so the round's pre-commit verification was structurally blind to it. Exit 0 at the parent commit, exit 1 at this one.

**Scenario.** The branch is pushed. CI runs. Step `npm test` (`.github/workflows/ci.yml:194`) fails on `OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass`. Two steps later, the standalone `OSS-01 full-history secret scan` (`ci.yml:257-258`, `node src/secret-scan/history-scan.ts`) fails too. Nothing merges. The CHANGELOG, `docs/STATE.md` and the commit message all say `785/785 pass, 0 fail, 0 skipped, confirmed across 10 consecutive full-suite runs`.

Root cause: #176's fix added `withIsolatedGitRepo()` to `src/qa/marker-corpus-probe.test.ts`, copying the fixture shape from `src/secret-scan/history-scan.test.ts` — **including the literal reserved-domain committer address** — but not the path-scoped allowlist entry that literal already required. `docs/qa/secret-scan-allowlist.json` keys on `path` + `patternId`; the existing entry covers `src/secret-scan/history-scan.test.ts` only.

```
$ git diff 713dbdd c2408ba -- src/qa/marker-corpus-probe.test.ts | grep "user.email"
+    await run("config", "user.email", "<reserved-test-domain address>");

$ grep -rn "user.email" --include=*.test.ts src/
src/qa/marker-corpus-probe.test.ts:29     <- NEW this round, NOT allowlisted
src/secret-scan/history-scan.test.ts:130  <- allowlisted
src/secret-scan/history-scan.test.ts:176  <- allowlisted

# email-address entries in docs/qa/secret-scan-allowlist.json:
{"path": "src/secret-scan/history-scan.test.ts", "patternId": "email-address", "reason": "a fixed
 reserved-test-domain address, used only to configure a throwaway temp git repository's committer
 identity for the duration of one test. Not a real person's address."}
 ... (no entry for src/qa/marker-corpus-probe.test.ts)
```

**Current defense, honestly assessed.** None. The gate is working exactly as designed and is telling the truth; what failed is the verification loop around it.

**Raw evidence — the live suite on the main checkout, on its branch, at `c2408ba`:**

```
$ node --test --test-reporter=tap
not ok 775 - OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
# tests 785
# pass 784
# fail 1
# cancelled 0
# skipped 0
# todo 0

  AssertionError: expected a clean pass, got: 1 secret-shaped match(es) found in history
  (356 allowlisted, not counted). Values redacted below.
  c2408bae3c06 src/qa/marker-corpus-probe.test.ts [email-address] an email address
  (possible personal data): test...[REDACTED 16 chars]
```

The claimed figure is `785/785 pass, 0 fail`. The measured figure is `785/784/1`.

**Raw evidence — the second, separately-wired CI step fails too (not just the dogfood test):**

```
$ node src/secret-scan/history-scan.ts >/dev/null 2>&1 ; echo $?
1
```

**Raw evidence — exit 0 at the parent, exit 1 here. This is new, not inherited:**

```
$ (worktree @ 713dbdd)  node src/secret-scan/history-scan.ts >/dev/null 2>&1 ; echo $?
0
$ (main tree @ c2408ba) node src/secret-scan/history-scan.ts >/dev/null 2>&1 ; echo $?
1
```

**Raw evidence — the mechanism, which is the part worth keeping.** I put the *identical* round-3 source content into a worktree at `713dbdd` as **uncommitted working-tree edits**, and re-ran the gate:

```
$ git checkout --detach 713dbdd && git checkout c2408ba -- src/ CHANGELOG.md
$ git status --porcelain
M  CHANGELOG.md
M  src/lib/git.test.ts
M  src/lib/git.ts
M  src/qa/continuation-residual-probe.test.ts
M  src/qa/continuation-residual-probe.ts
M  src/qa/marker-corpus-probe.test.ts
M  src/qa/marker-corpus-probe.ts
$ grep -c "<the reserved-domain literal>" src/qa/marker-corpus-probe.test.ts
1
$ node src/secret-scan/history-scan.ts >/dev/null 2>&1 ; echo $?
0
```

Same bytes on disk. **Uncommitted: exit 0. Committed: exit 1.** OSS-01 scans git *history*; the string only becomes visible to it at the moment of commit. So the round's verification was not sloppy — it was run against a tree state in which the defect was structurally invisible, and every re-run of it (10 consecutive full-suite runs) would have agreed. Note also that the scanner's own output attributes the match to commit `c2408bae3c06`, which is what makes the forward fix non-trivial: deleting the line in a *new* commit does not clear the historical one.

> **Note on this report's own evidence hygiene:** I have deliberately NOT quoted the offending literal verbatim anywhere above. `docs/reviews/` is scanned by the same gate, and quoting it here would create a second unallowlisted match in a second path — which is precisely how Issue #131's round propagated. The string is fully identified by `src/qa/marker-corpus-probe.test.ts:29` and by the existing allowlist entry's own `reason` text.

This class has fired before in this repo, with the same shape and the same lesson already written down:

```
$ gh issue list --state all --search "secret-scan OR OSS-01 in:title"
#131 CLOSED  cifix: committing the Issue #113 fix re-breaks npm test — the fix's own test
             fixtures and prose are 7 blocking OSS-01 internal-hostname matches
#180 OPEN    s1-closeout-164-154 round-3 fix-now broke OSS-01 dogfood gate: new
             marker-corpus-probe.test.ts email-address match has no allowlist entry
```

And `CHANGELOG.md`'s own qa14-marker-redesign round-2 entry already states the lesson verbatim: *"re-measuring post-commit, not just pre-commit, is now this round's own disclosed lesson."* It was written down and not applied.

`Exposure: 100% of CI runs on this branch (2 of 2 independently-wired blocking steps — ci.yml:194 npm test, ci.yml:257 history-scan); 100% of local npm test runs at this commit, basis: measured`

**Verdict: BREAKS.**

**Named proof-test required before merge (1, plus a state correction):**
1. `src/secret-scan/history-scan.test.ts` (or `docs/qa/secret-scan-allowlist.json`'s own structural test) -> *"every `git config user.email` literal used by a `mkdtemp` fixture in any `*.test.ts` has a matching path-scoped `email-address` allowlist entry"* — a completeness instrument rather than a one-off entry, since this is the second occurrence of the class. The cheap unblocking fix is the one-entry allowlist addition (precedent is verbatim); the instrument is what stops the third.
2. State correction: Issue #180 is filed and correct — I commented on it rather than duplicating. `#176`/`#177`/`#178` are currently CLOSED-completed against a commit whose gate is red; the CHANGELOG/STATE `785/785` figure needs correcting to what is actually measurable.

**Honest scoping of severity.** The literal is an RFC 2606 reserved-domain address and is not a real secret; there is **no security exposure here**. The HIGH is entirely "a blocking gate is red at the tip of a branch being presented as shippable, and the round's own evidence says otherwise."

---

### 2. [ISSUE][MED][demonstrated] QA-13's own registry convention obliges a row on the *second* occurrence of a class, same turn. This is the second occurrence (#131 -> #180) and the registry still has one row, about something else.

**Scenario.** This round closes, #180 gets its allowlist entry, and the next story that adds a `mkdtemp` git fixture — or quotes a hostname, or a token shape, in a committed test or report — reds OSS-01 again. There is nothing to catch it, because the mechanism this repo built for exactly this (`docs/qa/recurring-findings-registry.md`, validated by `src/qa/recurring-findings-registry.ts`) was not fed.

**Current defense, honestly assessed.** The mechanism exists, runs, and passes — vacuously, for this class:

```
$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 1 recurring finding class(es) logged, all structurally valid.

$ cat docs/qa/recurring-findings-registry.md   # the one row:
| silent pass on invalid/zero-SHA diff ref | 2026-08-25 GH issue 18 ... | 2026-08-30 ... |
  QA-02 diff-fixture-check; QA-14 reference-resolver |
```

The file's own convention, quoted from itself: *"**Second occurrence.** The same underlying class (not the same finding restated) recurs in a different story or review. Whoever notices the recurrence adds a row to the table below, **same turn**, with both occurrences cited."* and *"Promotion is mandatory before the third story ships."*

The class is *"a fix round's own committed artifacts (test fixtures or report prose) red a gate that only reads committed state, so the round's pre-commit verification cannot see it."* First seen 2026-09-09 (Issue #131, cifix). Second seen 2026-09-13 (Issue #180, this round). That is a `pending lint` row that is owed now, and attack 1's proof-test 1 is its promotion.

I am not adding the row myself — a reviewer editing `docs/qa/` is outside my lane, and the registry is an evidence artifact whose provenance matters. It is filed and named instead.

`Exposure: 2 of 2 occurrences of this class unlogged; the registry is 1 row against a story family that has now produced 4 consecutive fix-rounds each introducing a fresh defect, basis: measured (instrument output + gh issue list)`

**Verdict: BREAKS** (process/durability, not code).

**Named proof-test required:** none is executable until the row exists — `src/qa/recurring-findings-registry.ts` validates *shape*, not *completeness*, and I will not invent a test for a state correction. Unlock: add the `pending lint` row citing #131 and #180, then promote it with attack 1's proof-test 1.

---

### 3. [ISSUE][MED][demonstrated] The #172 fix makes the published corpus figure a function of whatever untracked scratch files happen to be in the tree. I watched it move 1087 -> 1106 -> 1110 during this review, silently, exit 0.

**Scenario.** This is my round-2 attack-1 orphan prediction, except nobody had to SIGKILL anything — it happened on its own, in this working tree, during this review, because this project runs several agents against one checkout. A reviewer redirects `npm test` output to a file in the repo root, or drops a scratch log; it is untracked-but-not-gitignored; `lsFilesWorkingTree()` lists it (`--exclude-standard` only drops *ignored* files); `shouldScanFile` accepts it (it rejects `*.test.ts` and nothing else); every `#N` inside it becomes a citation. Anyone who then publishes "the corpus is N" publishes a number containing another agent's log output.

**Current defense, honestly assessed.** None, and #176 did not address this half. #176 fixed the *test* (it no longer writes into the repo tree — that is real and it survives, attack 5). It did not change the *instrument's* susceptibility to files it did not create. Round 2's own decision to remove the three `expect=N` markers from `CHANGELOG.md` means QA-15 no longer cross-checks the figure either, so nothing anywhere flags the drift.

**Raw evidence — measured live on the main checkout at `c2408ba`, with a concurrent reviewer's scratch output present:**

```
$ git status --porcelain
?? .scratch_test_out.txt            <- 163,582 bytes of `npm test` output, sitting in the repo root

$ git ls-files -z --others --exclude-standard | tr '\0' '\n' | grep scratch_test
.scratch_test_out.txt               <- the probe's own file list includes it

$ node src/qa/marker-corpus-probe.ts --field=total       # with the stray file
[QA-14 marker-corpus-probe] PASS: total=1106
$ mv .scratch_test_out.txt <scratchpad>/ && node src/qa/marker-corpus-probe.ts --field=total
[QA-14 marker-corpus-probe] PASS: total=1087             # without it
$ mv <scratchpad>/.scratch_test_out.txt .                # restored, not deleted
```

**19 citations — approx 1.7% — from one stray log file, with no warning and exit 0.** Minutes later, with a concurrent reviewer's further scratch files present:

```
$ git ls-files -z --others --exclude-standard | tr '\0' '\n'
.scratch_concurrency.txt
.scratch_loopA_1.txt ... .scratch_loopA_6.txt
.scratch_test_out.txt
docs/reviews/s1-closeout-164-154-cross-domain-round3-2026-09-13.md
$ node src/qa/marker-corpus-probe.ts --field=total
[QA-14 marker-corpus-probe] PASS: total=1110
```

**Fairness note, stated plainly:** none of those scratch files came from the round-3 *diff*, and the agent that created them cleaned them up afterwards (the tree is clean again as I write). I am not attributing the litter to `story-implementer`. The finding is not "someone left a file" — it is that the instrument's headline number is silently determined by transient, uncommitted content that no gate checks, in a repo whose own workflow guarantees such content exists. Round 2's report predicted this mechanism under a SIGKILL; round 3 shipped without it, and it fired on its own.

`Exposure: measured 19 citations (approx 1.7%) from one stray file, and a live 1087->1110 spread within one review session; 0% in CI (actions/checkout yields a clean tree), 100% of local/agent-run measurements in a shared checkout, basis: measured`

**Verdict: BREAKS** (silent, unbounded, and it hits exactly the figure this story exists to publish).

**Named proof-test required:** `marker-corpus-probe.test.ts` -> *"the probe's own output distinguishes the tracked-corpus figure from the untracked contribution — an untracked file in the `mkdtemp` fixture is counted AND reported as such (e.g. `total=N (U untracked)`), never folded silently into one integer"*. `withIsolatedGitRepo` already provides the fixture; this is an assertion on the existing #172 test plus a line of output. A cheaper partial mitigation that is *not* a substitute: `.gitignore` a `.scratch*` / `zz-*` convention, which fixes today's litter but not the class.

---

### 4. [ISSUE][LOW][demonstrated] The twin's half of the #176 `resolve(repoRoot, ...)` fix is pinned by zero tests — a full-suite mutation reverting only it is byte-identical. That is precisely the #177 defect, recurring inside the round that closed #177.

The CHANGELOG says the latent `repoRoot` bug was fixed *"in both this file and its twin, `continuation-residual-probe.ts`"*. Both halves shipped; only one is proven.

```
MUTANT 4: ONLY continuation-residual-probe.ts's `resolve(repoRoot, f)` reverted to `trackedFiles`
$ node --test --test-reporter=tap "src/**/*.test.ts"
# tests 741 | # pass 739 | # fail 2      (both known worktree-only failures)

UNMUTATED CONTROL, same worktree, same command
$ node --test --test-reporter=tap "src/**/*.test.ts"
# tests 741 | # pass 739 | # fail 2
```

Identical. The mutant survives. (By contrast, reverting the *marker* file's half kills two tests — attack 7.) The reason this is LOW and not MED: `main()` is the only caller and it passes `process.cwd()` as `repoRoot`, so `resolve(process.cwd(), f)` is a provable no-op today, and `collectFullTreeFileTexts` is still module-private in the twin, so no external caller can pass anything else.

`Exposure: 0% of runs today — 1 of 1 caller passes process.cwd(); the risk is entirely forward-looking, basis: counted in code`

LOW, non-gating, no Issue filed per this project's convention. Fix when the file is next touched: export the twin's `collectFullTreeFileTexts` and give it the same isolated-fixture test the marker file now has, or drop the unused half of the change.

---

### 5. [CLEAN][demonstrated] #176 is genuinely fixed. I ran my own round-2 attack at 4x the claimed load — 48 concurrent runs on one checkout — and it did not flinch.

The claim was 12 concurrent runs. I ran four simultaneous loops, 12 iterations each, all against the same live checkout, with the full-suite and probe runs of this review competing for the same disk and CPU:

```
$ loop.sh A 12 &  loop.sh B 12 &  loop.sh C 12 &  loop.sh D 12 &
  # each iteration: node --test --test-reporter=tap marker-corpus-probe.test.ts
  #                 continuation-residual-probe.test.ts git.test.ts

[A-1] # tests 41 | # pass 41 | # fail 0
... (48 lines, A-1..A-12, B-1..B-12, C-1..C-12, D-1..D-12, all identical)

$ cat [ABCD].log | grep -c "^\["          # runs completed
48
$ cat [ABCD].log | grep "^\[" | grep -v "# fail 0"   # any run with a nonzero fail count
(no output)
```

48 of 48 clean. Round 2's identical shape produced 6 failures out of 6 in the losing process. The structural reason it holds is that the new test has nothing left to race on:

```
$ grep -rln "mkdtemp" --include=*.test.ts src/
src/policy/config/loader.test.ts
src/qa/fixture-coverage-check.test.ts
src/qa/fixture-isolation-check.test.ts
src/qa/gate-manifest-check.test.ts
src/qa/marker-corpus-probe.test.ts     <- was the sole exception in round 2; now the 6th member
src/secret-scan/history-scan.test.ts

$ git status --porcelain     # after 48 concurrent runs
(no probe-authored file in the repo tree)
```

No fixed repo path, no live CLI subprocess of the probe, no cross-process comparison — the assertion is a delta computed inside one in-process call against a throwaway `mkdtemp` repo. **SURVIVES**, and it is the right structural fix, not a timeout bump.

---

### 6. [CLEAN][demonstrated] #177's mutation claim holds under my own hand — both files — and the injectable seam is genuinely wired into the real path, proven with a REAL error, not the test's fake reader.

First, the mutation, applied by me in a throwaway worktree, reverting *both* narrowings to a blanket `continue;`:

```
MUT1 patched src/qa/marker-corpus-probe.ts sites: 1
MUT1 patched src/qa/continuation-residual-probe.ts sites: 1
$ node --test --test-reporter=tap marker-corpus-probe.test.ts continuation-residual-probe.test.ts
not ok 10 - QA-14 continuation-residual-probe (Issue #177, mutation-proving): a non-ENOENT read
          failure propagates instead of being silently swallowed
not ok 29 - QA-14 marker-corpus-probe (Issue #177, mutation-proving): a non-ENOENT read failure
          propagates instead of being silently swallowed
# tests 31 | # pass 29 | # fail 2
```

Round 2's identical mutation killed **zero** tests. Now it kills one per file. The claim is exactly true.

Second — the part the task asked me to distrust. The seam is `readFileImpl` with a default, and the default is what every real caller gets:

```ts
// marker-corpus-probe.ts:212-213
const workingTreeFiles = await git.lsFilesWorkingTree();
return readFileTexts(workingTreeFiles.map((f) => resolve(repoRoot, f)));   // no 2nd arg -> real readFile
```

So I drove a **genuine fs error through the default reader**, no fake anywhere:

```
$ node -e "import('.../marker-corpus-probe.ts').then(m => m.readFileTexts(['C:/playground/thoth/docs']))"
RESULT: threw, code=EISDIR — real non-ENOENT propagates through default reader
ENOENT via default reader -> map size 0 (0 = correctly skipped)
```

A real EISDIR from the real `fs/promises` readFile propagates; a real ENOENT is still skipped. The test's fake reader is a convenience, not the only thing the narrowing protects. **SURVIVES.**

---

### 7. [CLEAN][demonstrated] #178's mutation claim holds too, and I enumerated the shape space rather than taking "trailing slash" on faith.

The mutation, applied by me — the trailing-slash filter removed, nothing else:

```
MUT2 patched: trailing-slash filter removed
$ node --test --test-reporter=tap src/lib/git.test.ts src/qa/marker-corpus-probe.test.ts
not ok 9  - lsFilesWorkingTree (regression, Issue #178): an --others entry ending in '/' ... excluded
not ok 25 - QA-14 marker-corpus-probe (Issue #178, regression): a nested untracked git repository
          no longer crashes the probe
# tests 25 | # pass 23 | # fail 2
```

Both layers pinned — the unit test on `lsFilesWorkingTree` *and* the end-to-end probe test. And separately, the `resolve(repoRoot,...)` half of #176 is pinned for this file:

```
MUT3: `resolve(repoRoot, f)` removed from both files
not ok 28 - QA-14 marker-corpus-probe (Issue #172 regression, isolated): ...
not ok 31 - QA-14 marker-corpus-probe (Issue #178, regression): ...
# tests 31 | # pass 29 | # fail 2
```

On completeness of the `/` detection — I built the shapes and asked git directly, rather than reasoning about it:

```
fixture: empty dir, all-gitignored dir, nested git repo, NTFS junction, plain untracked files
$ git ls-files -z --others --exclude-standard | tr '\0' '\n'
.gitignore
junc/f.md          <- junction: git RECURSES, emits real files, no directory entry
nested/            <- nested repo: the ONE trailing-slash shape
realdir2/f.md
(empty dir: not emitted at all;  all-ignored dir: not emitted at all)
```

On this platform, a nested repo is the only `--others` shape that yields a directory entry, and the filter catches it. **SURVIVES.** (One shape I could not build here is attack 9.)

---

### 8. [CLEAN][demonstrated] #179's deferral is disclosed honestly in all four places, the Issue is correctly shaped, and no test anywhere still asserts the bad behavior as correct.

```
$ grep -c "179" src/qa/continuation-residual-probe.test.ts CHANGELOG.md docs/STATE.md docs/decisions.md
src/qa/continuation-residual-probe.test.ts:5
CHANGELOG.md:1
docs/STATE.md:2
docs/decisions.md:1

$ gh issue view 179
#179 OPEN  labels: bug, severity:med, qa   milestone: S1 — Protect the baseline
  "continuation-residual-probe.ts still silently swallows stray positional args and unknown flags
   (the #173 defect) — untracked in any Issue or backlog line, and its own test now pins exit 0 as correct"
```

The test's title and assertion message both changed from a contract to a disclosure — `"(KNOWN GAP, tracked in Issue #179 — not a contract): a stray positional argument is currently silently ignored"` and `"probe currently exits 0 even for a stray argument (Issue #179, open)"` — and the comment above it names the replacement test a future fix must write. I checked the whole file for any other `exit 0` assertion that could re-pin the gap:

```
$ grep -n "code, 0" src/qa/continuation-residual-probe.test.ts
182:  assert.equal(fieldRun.code, 0, ...)    <- a VALID --field invocation; should exit 0
222:  assert.equal(result.code, 0, "probe currently exits 0 even for a stray argument (Issue #179, open)")
```

The defect itself is of course still live, as disclosed:

```
$ node src/qa/continuation-residual-probe.ts --field=continuation-marked not-a-ref-at-all ; echo exit=$?
[QA-14 continuation-residual-probe] PASS: continuation-marked=314
exit=0
```

Deferring it was the right call given this round's demonstrated risk budget, and it is tracked rather than buried. **SURVIVES.**

---

### 9. [SUSPICION][LOW][demonstrated-negative] A POSIX symlink-to-a-directory is the one `--others` shape I could not build on this machine, and it would slip past the `/` filter into the same EISDIR crash.

`git ls-files --others` does not follow symlinks — a symlink is a blob to git, so a symlink pointing at a directory is emitted as a plain path with **no** trailing slash. Node's `readFile`, by contrast, *does* follow it, and lands on a directory: EISDIR, rethrown by the (correct) narrowed catch, with no path in the message. Same class as #178, different shape.

I could not demonstrate it — Windows refuses symlink creation without privilege, and MSYS `ln -s` silently copies the directory instead:

```
$ node -e "require('fs').symlinkSync('realdir','linkdir','dir')"
(EPERM — no symlink created)
$ ln -s realdir linkdir && git ls-files -z --others --exclude-standard | tr '\0' '\n'
linkdir/inside.md     <- a real copied directory, not a symlink; git recursed. Not the case under test.
```

So I am not converting an unbuildable hypothesis into a finding. **UNPROVEN**, LOW, non-gating — and honestly, the blast radius is small even if true: CI's `actions/checkout` yields a clean tree so the untracked set is empty there, and a *gitignored* symlink is excluded anyway.

**Settling command, for whoever is on Linux/macOS** (30 seconds, no fixture to build):
```
cd $(mktemp -d) && git init -q . && mkdir real && echo 'See #1' > real/f.md && ln -s real link \
  && git ls-files -z --others --exclude-standard | tr '\0' '\n'
# if `link` appears WITHOUT a trailing slash, the gap is real; extend lsFilesWorkingTree's
# filter to lstat-and-drop non-regular-files, or widen the probe's skip to EISDIR.
```

---

### 10. [CLEAN][demonstrated] #174's class did NOT recur a third time. The ordering is fixed — the closures now postdate the commit.

Checked myself, exactly as asked:

```
$ git log -1 --format="authored=%aI" c2408ba
authored=2026-09-13T21:51:17-04:00            (== 2026-09-14T01:51:17Z)

#170 closedAt=2026-09-14T01:51:55Z  COMPLETED   (+38s)
#171 closedAt=2026-09-14T01:52:03Z  COMPLETED   (+46s)
#172 closedAt=2026-09-14T01:52:12Z  COMPLETED   (+55s)
#173 closedAt=2026-09-14T01:52:20Z  COMPLETED   (+63s)
#176 closedAt=2026-09-14T01:52:32Z  COMPLETED   (+75s)
#177 closedAt=2026-09-14T01:52:40Z  COMPLETED   (+83s)
#178 closedAt=2026-09-14T01:52:50Z  COMPLETED   (+93s)
#174 state=OPEN        #179 state=OPEN
```

Round 2's figure was **-8m55s** (closed *before* the fix was authored); round 3's is **+38s to +93s**. The specific defect #174 names is closed, and that belongs on the record — this is the one process finding across three rounds that actually got better. **SURVIVES** as filed.

Residual worth one sentence, not a finding: the closures still precede review and merge (`git branch -r --contains c2408ba` is empty — unpushed), so `CLAUDE.md` Issue Discipline rule 2's *"shipped and verified"* bar is not yet met in the strict sense. Since this review returns no-go and attack 1 lands on code closed under #176, #176/#177/#178 will need reopening regardless. I flag that as a consequence of attack 1, not as a fresh instance of #174.

---

### 11. [CLEAN][demonstrated] The absolute-path map keys introduced this round are behavior-neutral — I checked every consumer with an instrument rather than eyeballing it.

`collectFullTreeFileTexts` now keys `fileTexts` by absolute path (`resolve(repoRoot, f)`) instead of repo-relative. That could plausibly have broken path-shaped logic, and on Windows the keys are backslash-separated, which would break any `/`-based matching. It does not, because nothing reads the keys:

```
$ grep -n "fileTexts" src/qa/reference-resolver.ts src/qa/marker-corpus-probe.ts src/qa/continuation-residual-probe.ts
reference-resolver.ts:698:   for (const text of fileTexts.values())
reference-resolver.ts:724:   for (const text of fileTexts.values())
marker-corpus-probe.ts:138:  for (const text of fileTexts.values())
marker-corpus-probe.ts:148:  ... filesScanned: fileTexts.size
continuation-residual-probe.ts:102: for (const text of fileTexts.values())
continuation-residual-probe.ts:108: ... filesScanned: fileTexts.size
(every consumer: .values() or .size — no key is ever read)

$ sed -n '534,536p' src/qa/reference-resolver.ts
export function shouldScanFile(repoRelativePath: string): boolean {
  return !repoRelativePath.endsWith(".test.ts");
}
```

`shouldScanFile` is a bare `endsWith` — an absolute path still ends in `.test.ts`, so the exclusion survives. I also confirmed a non-ASCII filename still round-trips through `realRunner`'s `latin1` default and gets scanned, rather than silently ENOENT-skipping:

```
$ node probe.mjs <fixture containing a non-ASCII .md filename>
files scanned: [ 'ascii.md', 'plain-two.md', '<non-ASCII>.md' ]
stats: {"marked":3,"unmarked":2,"total":5,"filesScanned":3}
```

`npm run typecheck` and `npm run lint` are both clean. **SURVIVES.** (Editorial 1 notes the now-misleading parameter name.)

---

### 12. [CLEAN][code-traced] Hostile lens re-checked — this round does not widen the trust boundary, and the one new capability is a test-only export.

The weakest link is unchanged: `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` allowlist, the single place where attacker-editable prose becomes an executed subprocess. This diff does not touch it. What is new is that `collectFullTreeFileTexts` and `readFileTexts` are now `export`ed from `marker-corpus-probe.ts`. Both are pure-read: they shell out to `git ls-files` with a fixed argv (no caller-controlled token reaches a git argument — `assertKnownArgs` still gates `main()` to `--field=...` only), and their output is regex-scanned into integers. `readFileTexts`'s new `readFileImpl` parameter is a reader injection point, not a writer, and is unreachable from any CLI surface. `stubDeps.issueExists` still returns `null` unconditionally — no network, no credential. A compromised CI runner gains nothing it did not already have. **SURVIVES.**

---

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `src/qa/reference-resolver.ts:534` — the parameter is now named `repoRelativePath` but both probes call it with an absolute path. Rename to `filePath`, or document that only the suffix is significant. Harmless today (attack 11), misleading to the next reader.
2. `src/lib/git.ts:163` — round 2's editorial item 1 is still open and the round-3 comment sits directly on top of it: the `--others` half `.trim()`s each path, the `--cached` half does not. With `-z` there is no newline to strip, so the trim only ever mangles a path with genuine leading/trailing whitespace into a silently-skipped ENOENT. Drop the trim; keep `length > 0 && !endsWith("/")`.
3. `src/qa/continuation-residual-probe.test.ts:222` — the #179 known-gap test passes green, so `node --test` reports `# todo 0` and the gap is invisible in the suite summary. `test(..., { todo: true }, ...)` would surface it as `# todo 1` without failing CI, and would stop the test from having to be *replaced* when #179 is fixed. Genuinely optional; the prose disclosure already meets the bar the round was asked to meet.
4. `CHANGELOG.md:33` — `785/785 pass, 0 fail, 0 skipped` needs correcting to the measurable figure once attack 1 is resolved; likewise `docs/STATE.md`. The `153 -> 153 blocking (of 4038 -> 4061 total)` figures in the same paragraph are point-in-time and already stale (I measure a different total), which is fine for a dated entry but reads as a live claim.
5. `src/qa/marker-corpus-probe.test.ts:276-281` — the `withIsolatedGitRepo` doc comment says *"the other five mkdtemp-sandboxed test files"*; with this file added the instrument now reports six. A hand-typed count in a file that gets rescanned — exactly the class `CLAUDE.md`'s no-hand-derived-completeness rule covers. Either drop the number or cite the grep.

---

## Open findings vs failing tests

4 open findings (attacks 1-4). **2 are executable as named failing tests** (attack 1 -> 1 completeness instrument; attack 3 -> 1 test on the existing `mkdtemp` fixture). **2 have no executable form and I say so rather than invent one:** attack 2 is a registry-row state correction (the validator checks shape, not completeness, and building a completeness checker for a two-row file would be ceremony without safety gain), and attack 4 is LOW/non-gating with 0% exposure today — its "test" is simply the twin's own isolated-fixture test, owed whenever that file is next touched. Attack 9 is UNPROVEN with a named settling command, not a finding.

## The single scariest unproven assumption

**That a fix round can verify itself against the tree state it is holding, when this repo's gates read the tree state it is about to create.** Round 3 ran its verification ten times, at eight different concurrency levels, and every single run was green and *correct* — the defect it missed does not exist until `git commit` returns. OSS-01 reads history; QA-14's corpus reads the working tree including untracked files; the two disagree about what "the repo" means, and nothing in the loop re-measures after the commit exists. Round 1's lesson was "a fix that looks complete and is not". Round 2's was "a green suite that proves less than it appears to". Round 3's is "a green suite that was measuring a tree that no longer exists" — and this repo had already written that lesson down, in `CHANGELOG.md`, after the cifix round, in those words.

That is also why I am not recommending a round 4. Three rounds have each fixed their findings correctly and each introduced a fresh defect, and the pattern is now clearly in the *loop*, not in any individual fix. PRINCIPLES rule 16(c)'s council trigger exists for exactly this.

## Verdict and next action

**no-go.** One HIGH backed by demonstrated evidence (attack 1: two independently-wired blocking CI steps red, exit 0 at the parent commit and exit 1 here, independently corroborated by `cross-domain-reviewer` as Issue #180) forces it under the Evidence Policy. It is also, genuinely, a small fix.

And the record should say the rest plainly: **the round-3 fixes themselves are good.** #176 took my own attack at four times the load and did not move; #177 and #178 both die under mutations I applied myself, in both files; the #177 seam is wired into the real path and propagates a real EISDIR, not just a fake one; #179's deferral is disclosed in four places with the Issue correctly shaped; and #174's premature-closure defect — flagged twice and never fixed — finally did not recur. Seven attacks survived. The blocker is not the work; it is the verification loop around it.

**Single next action:** add the `src/qa/marker-corpus-probe.test.ts` x `email-address` entry to `docs/qa/secret-scan-allowlist.json`, then **re-run `node src/secret-scan/history-scan.ts` and `npm test` against the resulting commit, not against the working tree** — the whole point of attack 1 is that the second half of that sentence is the part that keeps getting skipped.

---

## Tree integrity after my testing

One throwaway `git worktree` created and removed (`git worktree list` shows only `C:/playground/thoth c2408ba [fix/s1-closeout-164-154]`); all four mutations were applied only inside that worktree and reverted there before removal; the main checkout is on its **branch**, never a detached HEAD, at `c2408ba`. No source file in the main checkout was modified by this review. The one repo-tree file I moved (`.scratch_test_out.txt`, another agent's artifact) was moved to the session scratchpad for a single measurement and moved back, not deleted. All other fixtures live under the session scratchpad, outside the repo. `git status --porcelain` on the main tree shows only this round's own review artifacts.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] round-3's own #176 test fixture added a reserved-domain committer email to src/qa/marker-corpus-probe.test.ts:29 with no path-scoped allowlist entry, reddening TWO independently-wired blocking CI steps (ci.yml:194 `npm test` -> 785/784/1 on OSS-01 dogfood; ci.yml:257 `node src/secret-scan/history-scan.ts` -> exit 1); exit 0 at parent 713dbdd, exit 1 at c2408ba; PROVEN MECHANISM: identical bytes as uncommitted worktree edits exit 0, committed exit 1 — OSS-01 reads history, so the round's 10 pre-commit verification runs were structurally blind; claimed "785/785 pass, 0 fail" is false. Defense: none; gate working as designed. Recurrence of Issue #131's class. Corroborated independently by cross-domain (Issue #180, already filed — commented, not duplicated). Exposure: 100% of CI runs, 2 of 2 blocking steps, basis: measured
2. [ISSUE][MED][demonstrated] QA-13's own registry convention requires a `pending lint` row on the SECOND occurrence, same turn, and promotion before the third story ships; this is the second (#131 2026-09-09 -> #180 2026-09-13) and `node src/qa/recurring-findings-registry.ts` reports 1 row, about an unrelated class. Defense: mechanism exists, runs, passes vacuously — validates shape not completeness. No executable test; state correction. Exposure: 2 of 2 occurrences unlogged, basis: measured
3. [ISSUE][MED][demonstrated] the #172 untracked-file counting makes the published corpus figure a function of transient untracked scratch files — measured LIVE this session: total=1106 with one stray 163KB `npm test` log in the repo root, 1087 without (19 citations, ~1.7%), then 1110 as a concurrent agent added more; silent, exit 0, and round 2 removed the `expect=N` markers so QA-15 no longer cross-checks. #176 fixed the TEST's tree-writing, not the INSTRUMENT's susceptibility; undisclosed. Exposure: 1087->1110 spread within one session; 0% in CI, basis: measured
4. [ISSUE][LOW][demonstrated] the twin's half of the #176 `resolve(repoRoot,...)` fix is pinned by ZERO tests — full-suite mutation reverting only continuation-residual-probe.ts's half is byte-identical (741/739/2 both sides), the exact #177 defect recurring inside the round that closed #177; LOW because main() is the only caller and passes process.cwd(), so it is a provable no-op today. Exposure: 0% of runs, 1 of 1 caller, basis: counted in code
5. [CLEAN][demonstrated] #176 genuinely fixed — I ran my own round-2 repro at 4x the claimed load: FOUR concurrent `node --test` loops x12 iterations = 48 runs on one checkout, 48/48 clean (41/41 pass every run, zero fails), vs round 2's 6/6 failures; marker-corpus-probe.test.ts is now the 6th mkdtemp-sandboxed file and no test writes into the repo tree at all
6. [CLEAN][demonstrated] #177's mutation claim holds under my own hand in BOTH files (blanket-catch revert -> 31 tests/29 pass/2 fail, one new #177 test red per file; round 2's identical mutation killed zero), AND the seam is wired into the real path — a REAL EISDIR through the DEFAULT fs/promises reader propagates, a REAL ENOENT still skips, no fake reader involved
7. [CLEAN][demonstrated] #178's mutation claim holds (filter removed -> 2 tests red, unit + end-to-end), the #176 resolve() half is pinned for the marker file (2 tests red), and I enumerated the `--others` shape space myself: nested repo is the ONLY trailing-slash shape on this platform (empty dir and all-ignored dir emit nothing; an NTFS junction is recursed into as real files)
8. [CLEAN][demonstrated] #179's deferral honestly disclosed in all four places (test comment x5, CHANGELOG, STATE.md x2, decisions.md), Issue #179 OPEN with bug/severity:med/qa + Milestone S1, test title and assertion message both reworded from contract to disclosure; no bad-behavior-asserted-as-correct assertion remains anywhere in the file (the only other `code, 0` is a valid --field invocation); defect still live and correctly so: `--field=continuation-marked not-a-ref-at-all` -> continuation-marked=314, exit 0
9. [SUSPICION][LOW][demonstrated-negative] a POSIX symlink-to-directory would slip past the `/` filter into the same EISDIR class (git emits it with no trailing slash, node's readFile follows it) — could NOT build it here (Windows symlinkSync EPERM; MSYS `ln -s` copies the dir instead, git then recursed), so it stays UNPROVEN rather than manufactured; named settling command in the report; 0% in CI regardless
10. [CLEAN][demonstrated] #174's premature-closure class did NOT recur a 3rd time — commit c2408ba authored 2026-09-14T01:51:17Z, #170/#171/#172/#173/#176/#177/#178 closedAt 01:51:55Z-01:52:50Z, i.e. +38s to +93s AFTER the commit, versus round 2's -8m55s BEFORE it; #174 and #179 correctly left OPEN
11. [CLEAN][demonstrated] the new absolute-path map keys are behavior-neutral — grep instrument over all three consumers shows every one uses `.values()`/`.size` and never reads a key; `shouldScanFile` is a bare `endsWith(".test.ts")` so absolute/backslash paths still filter correctly; a non-ASCII filename still round-trips through realRunner's latin1 default and is scanned (3 files/total=5), not silently ENOENT-skipped; typecheck + lint clean
12. [CLEAN][code-traced] hostile lens — no widened boundary: the two new exports are pure-read, argv to git stays fixed, `readFileImpl` is a reader injection unreachable from any CLI surface, `issueExists` still stubbed to null, KNOWN_INSTRUMENTS untouched
counts (CHECKSUM): issues=4 suspicions=1 clean=7
evidence (CHECKSUM): demonstrated=11 code-traced=1 derived=0
checks=MAIN CHECKOUT @c2408ba `node --test`: 785 tests / 784 pass / 1 FAIL / 0 cancelled / 0 skipped / 0 todo (fail = OSS-01 dogfood, attack 1); `node src/secret-scan/history-scan.ts` exit=1 (attack 1) vs exit=0 in a worktree @713dbdd; SAME BYTES as uncommitted worktree edits on 713dbdd -> exit=0 (pre/post-commit mechanism); `npm run typecheck` clean, `npm run lint` clean; CONCURRENCY: 4 simultaneous `node --test` loops x12 iterations = 48 runs on one shared checkout, 48/48 clean at 41/41 pass, 0 fail (round 2's shape was 6/6 fail); MUTATION 1 (both ENOENT narrowings -> blanket catch): 31 tests/29 pass/2 fail, one new #177 test red per file; MUTATION 2 (trailing-slash filter removed): 25/23/2, both #178 tests red; MUTATION 3 (resolve(repoRoot) removed, both files): 31/29/2, both marker-file tests red; MUTATION 4 (ONLY the twin's resolve() reverted, full suite): 741 tests/739 pass/2 fail == IDENTICAL to the unmutated control in the same worktree, mutant SURVIVES; REAL-ERROR seam check: readFileTexts(['<a directory>']) via the DEFAULT fs/promises reader throws EISDIR, ENOENT via the same default reader -> map size 0; CORPUS DRIFT measured live: total=1106 with a stray untracked 163KB log present, 1087 with it moved aside, 1110 minutes later with a concurrent agent's scratch files; `node src/qa/recurring-findings-registry.ts` PASS 1 class logged; gh: #170/#171/#172/#173/#176/#177/#178 closedAt +38s..+93s AFTER commit c2408ba's author date, #174/#179 OPEN, #180 already filed by cross-domain (no duplicate created); `git branch -r --contains c2408ba` empty; ls-files --others shape enumeration: nested repo -> `nested/`, junction -> recursed, empty dir -> nothing, all-ignored dir -> nothing; symlink-to-dir NOT testable on this platform (EPERM)
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-red-team-round3-2026-09-13.md
HEAD: c2408bae3c06ff652c676af114a42698c9745d9f
