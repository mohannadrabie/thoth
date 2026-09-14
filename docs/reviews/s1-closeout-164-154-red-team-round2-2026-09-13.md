# Red Team (Sutekh) — `s1-closeout-164-154` round-2 fix-now re-confirm (Issues #170/#171/#172/#173)

- **Date:** 2026-09-13
- **Target:** branch `fix/s1-closeout-164-154` @ `713dbdd` (round-1 base `b9fed71`); diff scope `src/lib/git.ts`, `src/lib/git.test.ts`, `src/qa/marker-corpus-probe.ts`, `src/qa/marker-corpus-probe.test.ts`, `src/qa/continuation-residual-probe.ts`, `src/qa/continuation-residual-probe.test.ts`, `CHANGELOG.md`, `docs/STATE.md`, `docs/.maat-state.json`
- **Tier:** CRITICAL (ratified round-1, unchanged)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **Scope:** targeted re-confirm of the fix-now round, not a fresh full review. Round-1 report: `docs/reviews/s1-closeout-164-154-red-team-2026-09-13.md`.
- **Verdict:** **no-go** — 1 HIGH (demonstrated), 4 MED, 1 LOW, 1 LOW suspicion, 6 attacks survived.

## ADR slice read (attack surface: code correctness, test integrity, failure modes, evidence trail)

From `adrCatalog.adrs` in `docs/.maat-state.json`, filtered to this diff's surface: SE ADR-0005 (testing strategy), ADR-0010 (code quality gates), ADR-0004 (idempotency by default), ADR-0003 (SOLID), ADR-0006 (blast radius control), ADR-0021 (thoth-native architecture). Attack 1 below is an ADR-0005 concern directly (a test that mutates shared state outside its own sandbox); attack 2 is ADR-0005 again (a shipped behavior change with zero pinning tests). ADR fingerprint `83b2e3e` unchanged by this diff.

## Scope shapes I am NOT attacking, and why (stated, not skipped)

Unchanged from round 1 and still honest: no resource apply, no deploy, no migration, no cloud provider, no lock, no credential in this diff's path. Partial-apply, quota, throttling and AZ-degradation attacks would be manufactured noise here. **Concurrency is NOT N/A this round** — the round-2 diff introduces shared-working-tree mutation, and that is attack 1. Hostile lens is re-checked at attack 13.

---

## Attacks, ranked by blast radius

### 1. [ISSUE][HIGH][demonstrated] The #172 regression test writes into the REAL repo working tree — the only test in this repo that does — and fails 6 times out of 6 when two test processes share a checkout. It is a strictly worse version of the #170 flake it shipped alongside.

**Scenario.** This project routinely runs more than one agent against one working tree. It happened during this very review: while my probe runs were in flight, a parallel `cross-domain-reviewer` dropped `docs/reviews/s1-closeout-164-154-cross-domain-round2-2026-09-13.md` into the shared tree and my corpus figure moved from 1025 to 1029 mid-command. Now run `npm test` in two places at once — an IDE test runner plus a terminal, a watch loop, or two agent sessions. Both processes execute `marker-corpus-probe.test.ts`, both write the SAME path `docs/zz-marker-corpus-probe-untracked-regression.md`, and both `unlink` it in `finally`. One deletes the other's file between its `before` and `after` spawns, and the `beforeTotal + 2` arithmetic breaks.

**Current defense, honestly assessed.** None, and the shipped comment claims the opposite. `marker-corpus-probe.test.ts:143-172` writes `resolve(process.cwd(), "docs/zz-marker-corpus-probe-untracked-regression.md")` — a fixed, non-unique path inside the repo — then spawns the probe TWICE (`:151` `before`, `:161` `after`) and asserts an exact arithmetic relation between the two live full-tree walks. That is the identical two-live-subprocess shape Issue #170 was filed against; the round-2 comment at `:105-111` announces that shape has been eliminated ("this test no longer needs two racing walks to prove anything"). It has been eliminated from the *old* test and reintroduced, with a stricter assertion, in the *new* one. The `finally`/`unlink` cleanup is real but does not survive a SIGKILL, and does not help at all against a second process.

Every other file-writing test in this repo sandboxes into an OS temp dir. Measured, not eyeballed:

```
$ grep -rln "mkdtemp" --include=*.test.ts src/
src/policy/config/loader.test.ts
src/qa/fixture-coverage-check.test.ts
src/qa/fixture-isolation-check.test.ts
src/qa/gate-manifest-check.test.ts
src/secret-scan/history-scan.test.ts

$ grep -rn "writeFile" --include=*.test.ts src/     # the one entry NOT under a mkdtemp sandbox
src/qa/marker-corpus-probe.test.ts:156:  await writeFile(scratchAbs, "Fixes #900001 today. See (#900002) for context.\n", "utf8");
```

`marker-corpus-probe.test.ts` is the sole exception.

**Raw evidence — two concurrent loops of the same test file, same checkout, 6 iterations each:**

```
=== X ===
tests 12 | pass 12 | fail 0   <<X-1   ... through X-6, all clean
=== Y ===
FAIL QA-14 marker-corpus-probe (real subprocess, regression): a genuinely untracked, uncommitted,
     scannable file IS now counted - list and content agree on the same tree state (2107.4834ms)
tests 12 | pass 11 | fail 1   <<Y-1
... identical failure at Y-2 (1925ms), Y-3 (1627ms), Y-4 (2322ms), Y-5 (2102ms), Y-6 (1966ms)
```

6 of 6. Issue #170's original symptom was 1 fail / 6 full-suite runs (~17%). This is 100% of the losing process's runs.

**Raw evidence — the working tree really is mutated, and the artifact orphans on an interrupt:**

```
$ node scratchpad/interrupt.mjs   # spawns `node --test <file>`, SIGKILLs it the instant the path appears
OBSERVED: scratch file present in the REPO working tree while `node --test` runs
--- git status --porcelain after the kill ---
?? docs/zz-marker-corpus-probe-untracked-regression.md
orphan still on disk: true
```

And the orphan is not inert — because of this round's own #172 fix, an untracked file now COUNTS:

```
$ node src/qa/marker-corpus-probe.ts --field=total    # with the orphan present
[QA-14 marker-corpus-probe] PASS: total=1025
$ node src/qa/completeness-claim-checker.ts           # with the orphan present
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
exit=0
```

The two fixes compose into a silent skew: a killed test run leaves behind a file containing `Fixes #900001` / `(#900002)`, every later corpus figure taken from that tree is inflated by 2, exit 0, no warning — and QA-15 does not notice.

`Exposure: 100% (6 of 6) of the losing process's runs when two npm test processes share a checkout; 100% of npm test runs mutate the shared repo working tree for ~2s; 100% of SIGKILLed runs during that window leave an orphan that silently inflates the corpus figure, basis: measured`

**Verdict: BREAKS.**

**Named proof-tests required before merge (2):**
1. `marker-corpus-probe.test.ts` -> "QA-14 marker-corpus-probe: the untracked-file regression runs against a throwaway `mkdtemp` git repo, never the live checkout — two concurrent `node --test` processes on one checkout both pass". Fix: `git init` a temp repo (or `git worktree add` into `os.tmpdir()`), run the probe with `cwd` set there. Same shape as the five sandboxed tests already in this repo.
2. If sandboxing is rejected: `marker-corpus-probe.test.ts` -> "the scratch path is unique per process (`process.pid`/`randomUUID`) AND the assertion is a delta computed within a single probe invocation, not across two". A unique path alone fixes the mutual-deletion race but leaves the two-spawn comparison — the #170 shape — intact.

---

### 2. [ISSUE][MED][demonstrated] The #170 fix — the narrowed `readFile` catch, in BOTH files — is pinned by exactly zero tests. Reverting it wholesale leaves the suite byte-identical.

**Scenario.** A future refactor, a merge-conflict resolution, or a well-meaning "simplify this catch" cleanup reverts `if (err.code === "ENOENT") continue; throw err;` back to `catch { continue; }`. CI is green. The Issue is closed. Nothing anywhere records that the narrowing was load-bearing.

**Current defense, honestly assessed.** None. No test in the repo mentions ENOENT at all:

```
$ grep -rn "ENOENT" src/ --include=*.test.ts
(no output)
```

The three new `git.test.ts` tests cover `lsFilesWorkingTree`'s arg shape, submodule filtering and empty output — all against a fake runner. None reaches the catch. `marker-corpus-probe.test.ts`'s new tests cover argv rejection and the untracked-file count. None reaches the catch.

**Raw evidence — full-suite mutation, in a throwaway worktree, reverting BOTH narrowings:**

```
MUTATION APPLIED (both catches reverted to `continue;`)
mutated src/qa/marker-corpus-probe.ts
mutated src/qa/continuation-residual-probe.ts
=== full suite against MUTANT ===
tests 779 | pass 778 | fail 1 | skipped 0
FAIL QA-14 (dogfood): this checker's own source, run against itself, resolves clean

=== UNMUTATED control, same worktree ===
tests 779 | pass 778 | fail 1 | skipped 0
FAIL QA-14 (dogfood): this checker's own source, run against itself, resolves clean
```

Identical. The one failure is the known worktree-only missing-`adr/`-submodule failure, present on both sides (round-1 report, attack 12). The mutant SURVIVES the entire suite. Worktree removed afterwards; main checkout never mutated.

Separately: the root cause #170 was closed on ("a blanket catch silently swallowing a transient I/O error") is not what my attack-1 reproduction shows. The losing process fails because the file is deleted by the other process between the two spawns — a path that is ENOENT, i.e. still silently skipped after this fix. Narrowing the catch does not address the mechanism; removing the two-spawn comparison does, and that was undone by the #172 test. This project's DoD requires tests with the feature and it ships a mutation harness (`npm run qa:mutation-selftest`); a fix that no assertion touches did not meet that bar.

`Exposure: 2 of 2 changed catch sites, 0 tests covering either; a future revert would ship green 100% of the time, basis: measured (full-suite mutation, 779/778/1 identical on both sides)`

**Verdict: BREAKS.**

**Named proof-test required:** `marker-corpus-probe.test.ts` (and its twin) -> "QA-14 collectFullTreeFileTexts: a non-ENOENT read failure propagates instead of being counted as absence — an ENOENT one is skipped". Cheapest honest form: extract the read loop behind an injectable reader, or point the probe at a `mkdtemp` repo containing a directory entry that yields EISDIR (attack 3 supplies a real one for free).

---

### 3. [ISSUE][MED][demonstrated] #170 and #172 compose into a NEW hard crash: an untracked nested git directory is now listed as a file, and the narrowed catch rethrows EISDIR with a stack trace that never names the path.

**Scenario.** Anyone with a nested `.git` inside the checkout runs the probe. Concretely: a reviewer who follows this very task's own instruction — "use `git worktree add` for any second tree you need" — and puts that worktree inside the repo. Or a manual clone of the `adr` repo into a subdir to read it. Or any vendored dependency carrying its own `.git`. `git ls-files --others --exclude-standard` cannot recurse into a nested repo, so it reports the DIRECTORY, with a trailing slash. `shouldScanFile` (`reference-resolver.ts:534-536`) rejects only `*.test.ts`, so `zz-nested/` passes. `readFile("zz-nested/")` throws EISDIR. Before this round the list came from `ls-tree -r`, which yields only blobs — a directory could never appear, and the blanket catch covered everything else anyway.

**Current defense, honestly assessed.** None. The `-s`/mode-`160000` filter handles the *index* half (real submodule gitlinks, correctly) and the shipped comment at `git.ts:146-152` explicitly reasons that "an untracked (`--others`) path can never be a submodule (a submodule is always index-tracked), so it needs no mode check". True, and beside the point — the crash comes from a nested repo that is not a submodule at all.

**Raw evidence** (throwaway worktree at `713dbdd`, shipped code, main tree untouched):

```
$ mkdir zz-nested && cd zz-nested && git init -q . && echo 'See #900031' > note.md && cd ..
$ git ls-files -z --others --exclude-standard | tr '\0' '\n' | grep zz-nested
zz-nested/

$ node src/qa/marker-corpus-probe.ts --field=total ; echo EXIT=$?
node:internal/fs/promises:556
Error: EISDIR: illegal operation on a directory, read
    at async readFileHandle (node:internal/fs/promises:556:24)
    at async collectFullTreeFileTexts (.../src/qa/marker-corpus-probe.ts:170:27)
    at async main (.../src/qa/marker-corpus-probe.ts:193:21)
EXIT=1

$ node src/qa/marker-corpus-probe.ts ; echo EXIT=$?        # default mode crashes too
EXIT=1

$ rm -rf zz-nested && node src/qa/marker-corpus-probe.ts --field=total
[QA-14 marker-corpus-probe] PASS: total=1021
```

The failure is loud, which is the good half — but the message names no path, so the operator gets `EISDIR ... read` and nothing to act on. Note the twin `continuation-residual-probe.ts` is immune *only because* it still has the #175 defect (its list is `ls-tree HEAD`, blobs only). Closing #175 as-is would propagate this crash to it.

`Exposure: 100% of probe invocations in a checkout containing any nested .git directory, in both --field and default mode; 0% in CI (actions/checkout produces a clean tree), basis: measured`

**Verdict: BREAKS** (narrow, but demonstrated and newly introduced by this round).

**Named proof-test required:** `git.test.ts` -> "lsFilesWorkingTree: an `--others` entry ending in `/` (a nested git repo, which `git ls-files` reports as a directory) is excluded from the returned list". One-line fix in `lsFilesWorkingTree`: drop entries ending in `/`. Optionally also widen the probe's skip to `EISDIR`, but excluding non-files at the source is the correct layer.

---

### 4. [ISSUE][MED][demonstrated] Round-1's still-open process finding #174 recurred verbatim: all four round-2 Issues were closed COMPLETED ~9 minutes BEFORE the fixing commit was authored, on a branch that is still unpushed and unreviewed.

**Scenario.** Identical to round 1, which is the point. This review returns no-go. GitHub says #170, #171, #172 and #173 are done, `state_reason: completed`. Milestone S1 rolls them up as closed. Issue #174 — filed hours earlier against exactly this behavior, still OPEN — did not prevent the repeat.

**Current defense, honestly assessed.** None operating. The commit does carry the correct `Closes` mechanism; the manual pre-close pre-empts it, same as before. `CLAUDE.md` Issue Discipline rule 2 is unambiguous: an issue closes only when shipped and verified.

**Raw evidence:**

```
$ git log -1 --format="authored=%aI" 713dbdd
authored=2026-09-13T20:47:12-04:00      (== 2026-09-14T00:47:12Z)

#170 closedAt=2026-09-14T00:38:17Z reason=COMPLETED
#172 closedAt=2026-09-14T00:38:29Z reason=COMPLETED
#173 closedAt=2026-09-14T00:38:40Z reason=COMPLETED
#171 closedAt=2026-09-14T00:38:52Z reason=COMPLETED

$ git branch -r --contains 713dbdd
(empty — unpushed, unmerged, CI never run on it)
```

00:38:17Z precedes 00:47:12Z by 8m 55s. Credit where due: #164 and #154 were correctly left un-re-closed this round ("Manager's call, post-re-review", `docs/STATE.md`) — the lesson was learned for the round-1 issues and not applied to the round-2 ones.

`Exposure: 4 of 4 Issues in this round's scope; 100% of this round's GitHub tracking record, basis: measured (gh closedAt vs git author date)`

**Verdict: BREAKS** (process/traceability, not code).

**Named proof-test required:** none is executable; I say so rather than invent one. This is a state correction and a recurrence. Unlock: `gh issue reopen 170 171 172 173` with a `[red-team]`-prefixed comment, and — because this is a *repeat* of an open finding — a `[red-team]` comment on #174 recording the recurrence rather than a duplicate Issue (CLAUDE.md: comment on the existing one). This repo ships `src/qa/recurring-findings-registry.ts` for exactly this class; registering "issue closed before the fixing commit exists" there is the durable fix.

---

### 5. [ISSUE][MED][demonstrated] The twin's #173-class arg-swallowing is disclosed in CHANGELOG prose but tracked nowhere — and `continuation-residual-probe.test.ts` now actively asserts the silent swallow is correct.

**Scenario.** The next auditor copies `node src/qa/continuation-residual-probe.ts --field=continuation-marked a26e55a` out of `docs/reviews/qa14-marker-redesign-red-team-round5-2026-09-11.md:109` (one of two committed copy-paste sources my round-1 report measured). They get a number, exit 0, no warning, and label it `a26e55a`. This is the exact harm #173 was filed for, in the sibling file, still live — and the fix that exists 30 lines away in the twin is now fenced off by a test asserting `exit 0`.

**Current defense, honestly assessed.** Partial and prose-only. `CHANGELOG.md` does disclose it: "Scoped to `marker-corpus-probe.ts` only, per this round's instructions — `continuation-residual-probe.ts`'s own argv handling is unchanged." That is honest. But there is no Issue and no backlog line, and `CLAUDE.md`'s no-gold-plating rule routes deferred scope to a GitHub Issue (or `docs/backlog.md`), not to a CHANGELOG sentence:

```
$ gh issue list --state all --search "continuation-residual-probe in:title"
#175 OPEN   ... inherits marker-corpus-probe's #172 list/content tree-state mismatch ...
#161 CLOSED ... ref/working-tree content-mismatch bug ...
(no issue for the argv gap)

$ grep -n "continuation-residual-probe" docs/backlog.md
(no output)
```

#175 covers the list/content half only. And `continuation-residual-probe.test.ts:159-168`, rewritten THIS round, now pins the defect:

```js
const result = await realRunner("node", ["src/qa/continuation-residual-probe.ts",
  "--field=continuation-marked", "a26e55a"]);
assert.equal(result.code, 0, `probe must exit 0; stderr: ${result.stderr}`);
```

Live confirmation:

```
$ node src/qa/continuation-residual-probe.ts --field=continuation-marked not-a-ref-at-all ; echo exit=$?
[QA-14 continuation-residual-probe] PASS: continuation-marked=301
exit=0
$ node src/qa/continuation-residual-probe.ts --field=continuation-marked --bogus-flag ; echo exit=$?
[QA-14 continuation-residual-probe] PASS: continuation-marked=301
exit=0
```

`Exposure: ~100% of arg-passing invocations of the twin; 2 committed copy-paste sources measured in round 1, basis: counted in code + measured`

**Verdict: BREAKS** (as a tracking gap around a real, live, MED-class defect; the deferral decision itself is defensible, the absence of an artifact is not).

**Named proof-test required:** none until the Issue exists — this is a tracking correction. Unlock: file the Issue (`bug` + `severity:med` + `qa`, Milestone S1); when it is fixed, `continuation-residual-probe.test.ts` -> "an unrecognized argv token exits non-zero with a message naming it", replacing the current `assert.equal(result.code, 0)`.

---

### 6. [ISSUE][LOW][demonstrated] A duplicated `--field=` is silently first-wins — the same swallow class #173 just closed, one shape smaller.

```
$ node src/qa/marker-corpus-probe.ts --field=total --field=marked ; echo exit=$?
[QA-14 marker-corpus-probe] PASS: total=1021
exit=0
```

`assertKnownArgs` accepts any token starting with `--field=`, so two of them both pass, and `parseMarkerCorpusField` silently resolves the first. A caller building the command programmatically and appending a second `--field` gets a number labelled with the wrong field name, no warning. `Exposure: only invocations passing --field twice; no such call site exists in this repo today (KNOWN_INSTRUMENTS entries pass exactly one), basis: counted in code`. LOW, non-gating, no Issue filed per this project's convention. Fix if the file is touched again: reject more than one `--field=`-prefixed token in the same throw.

---

### 7. [SUSPICION][LOW][demonstrated] Round-1's 773-vs-774 cold-run anomaly did not recur — 8 consecutive clean runs — but is not explained by the #170 fix either.

Seven scripted full-suite runs plus one exploratory run, main checkout at `713dbdd`, serial:

```
run 0 (first of session): tests 779  pass 779  fail 0  cancelled 0  skipped 0
A1..A7:                   tests 779  pass 779  fail 0  cancelled 0  skipped 0   (all seven identical)
```

The test-count delta reconciles exactly: 774 (round 1) + 3 new `git.test.ts` tests + 2 net-new `marker-corpus-probe.test.ts` tests (one replaced 1:1, two added) = 779. No unregistered test. The #170 catch narrowing is not a plausible mechanism for a missing *registration* anyway. **UNPROVEN, not recurring** — I will not convert a one-off that failed to reproduce across 8 further runs into a finding. Settling command if it reappears: `node --test --test-reporter=tap` twice on a cold checkout, diff the emitted test-name sets.

---

### 8. [CLEAN][demonstrated] #172 is genuinely closed — I reran my own round-1 attack shape and the untracked file is now counted, identically to a tracked one.

Throwaway worktree at `713dbdd`, shipped code:

```
=== 0 baseline (clean tree) ===                       total=1021
=== 1 UNTRACKED new file, 3 bare #N ===               total=1024    (?? docs/zz-untracked-probe-file.md)
=== 2 same 3 citations in a TRACKED file instead ===  total=1024
=== 3 GITIGNORED file with 3 citations ===            total=1021
=== 4 restored clean ===                              total=1021
```

Round 1 measured 989 / 989 / 992 — the untracked case was invisible. It now matches the tracked case exactly (1024 == 1024), and the gitignored case is correctly excluded (`--exclude-standard` holds). List and content genuinely come from one tree state. This is the correct structural fix, not a symptom suppression. **SURVIVES.**

---

### 9. [CLEAN][demonstrated] The submodule exclusion does not reintroduce a different miscount.

The `-s` mode filter drops only mode `160000`, the same set `lsTree()` already dropped via `type === "commit"` — so the index half is unchanged in what it yields. Cross-checked empirically against the strongest available control: a `git worktree` has NO populated `adr/` submodule on disk, the main checkout does, and both report the same number.

```
main checkout (adr/ populated):  total=1021
worktree      (adr/ absent):     total=1021
```

Had the gitlink leaked into the list, the two would diverge (or the worktree would ENOENT-skip while the main tree EISDIR-crashed). It does not. The `-z` switch is also a real, unadvertised improvement over `lsTree`'s newline split: `git ls-tree` C-quotes non-ASCII paths, `ls-files -z` does not, so a non-ASCII filename `lsTree` would have mangled is now read correctly. **SURVIVES.**

---

### 10. [CLEAN][demonstrated] #173 genuinely fails loud, and generalizes past the specific strings named in the Issue.

Not just the three strings in the Issue title — I probed the shape space:

```
[not-a-ref-at-all] exit=1  Error: unrecognized argument(s): "not-a-ref-at-all" — this probe only accepts
                           --field=marked|unmarked|total (no positional ref — deleted, Issue #164 — and no other flag)
[HEAD~5]           exit=1  (same message shape)
[--bogus-flag]     exit=1
[a26e55a]          exit=1
[--field]          exit=1     <- bare flag, no `=`; not named in the Issue, still rejected
[-f]               exit=1     <- short flag; not named in the Issue, still rejected
[]  (no args)      exit=0     [QA-14 marker-corpus-probe] PASS: marked=498 unmarked=523 total=1021 ...
[--field=total]    exit=0     [QA-14 marker-corpus-probe] PASS: total=1021
```

The gate is an allowlist (reject any token not prefixed `--field=`), not a denylist of known-bad strings, which is the right construction — a novel bad token is rejected by default. It runs first in `main()`, before any file walk, so it cannot be defeated by I/O ordering. The error names the offending token and the accepted grammar. The pure `assertKnownArgs` unit test is a genuine deterministic companion to the subprocess test, with no I/O. **SURVIVES.** (One residual shape — a duplicated `--field=` — is attack 6.)

---

### 11. [CLEAN][demonstrated] #171 — Milestone #19's description really was patched, and it discloses rather than re-freezes.

`gh api repos/:owner/:repo/milestones/19`:

```
title:       S1 — Protect the baseline
state:       open
updated_at:  2026-09-14T00:38:52Z
description: ... SHIPPED -- commits 2992bfb/366c54d/d3a833f. DISCLOSED RESIDUAL (added 2026-09-13,
             Issue #171): QA-14 (100%-citation-resolution) is a human-accepted, non-blocking
             residual, NOT a completion criterion for this milestone -- comma/list-continuation
             classification gaps (Issue #154) and related unresolved-authority/unclassified
             citations. QA-14 still exits 1 on this repo; run `node src/qa/reference-resolver.ts
             <base> HEAD` for the live, current count rather than trusting a frozen figure here.
```

Real (server-side `updated_at` sits inside the close-out window — not a claim in a commit message), and it does the harder thing correctly: it states the residual exists, states QA-14 still exits 1, and points at the live command **instead of** the stale "143 blocking" figure the Issue title carried. That is precisely the failure mode this story family has been burned by repeatedly. **SURVIVES.**

> Wording note, not a finding: "non-blocking residual" is true in the milestone-criterion sense the next clause spells out, but QA-14 *is* blocking in CI (`.github/workflows/ci.yml:225-231`, no `continue-on-error`). The following sentence ("still exits 1") resolves the ambiguity, so a reader is not misled; a tighter phrasing would be "non-blocking for this milestone's closure; still a red CI step".

---

### 12. [CLEAN][demonstrated] #175 is filed, correctly shaped, and deferring it is the right call — not scope creep avoided at the cost of a hidden inconsistency.

```
#175 OPEN  labels: bug, severity:med, qa   milestone: S1 — Protect the baseline
     "continuation-residual-probe.ts inherits marker-corpus-probe's #172 list/content
      tree-state mismatch — file LIST still HEAD-pinned while CONTENT is working-tree"
```

Disclosed in three places, not one: the Issue, `CHANGELOG.md` ("carries the identical, still-live defect — deliberately not fixed here alongside a differently-scoped Issue; filed separately as Issue #175"), and the shipped code comment at `marker-corpus-probe.ts:150-159`, which names the divergence as deliberate at the exact site where a future reader would otherwise call it an accident. Deferring is correct on the merits and, as attack 3 shows, actively load-bearing right now: the twin's HEAD-pinned list is the only reason it does not inherit the EISDIR crash. Whoever closes #175 must fix attack 3 first or ship the crash to a second instrument. **SURVIVES.**

---

### 13. [CLEAN][code-traced] Hostile lens re-checked — the new working-tree read does not widen the trust boundary.

The weakest link is unchanged and still `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` allowlist (the one place attacker-editable prose becomes an executed subprocess). This diff does not touch it. What the diff does change is that the probe now reads UNTRACKED files — which in a fork-PR threat model means attacker-supplied content reaches `scanReferences`. That content is only regex-scanned into integer counts; it is never `exec`-ed, never interpolated into a git argument (`assertKnownArgs` makes argv strictly `--field=...`), and `stubDeps.issueExists` returns `null` unconditionally, so no network call and no credential is reachable. In CI, `actions/checkout` yields a clean tree, so the untracked set is empty there in the first place. No new reachable capability for a compromised runner. **SURVIVES.**

---

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `src/lib/git.ts:160` — the `--others` half trims each path; the `--cached` half does not. With `-z` there is no trailing newline to strip, so the trim only ever mangles a path with genuine leading/trailing whitespace (into an ENOENT that is then silently skipped). Drop the trim, keep the truthiness filter, and the two halves parse symmetrically.
2. `CHANGELOG.md`, Issue #170 entry — "Root cause: `collectFullTreeFileTexts`'s `readFile` catch was a blanket `catch { continue; }`". My attack-1 reproduction makes the losing process fail through an ENOENT path, which the fix still skips. The catch was a real latent defect worth fixing; calling it the *root cause* of the flake is not supported by the evidence in either report. Prefer "a latent defect found while investigating #170".
3. `src/qa/marker-corpus-probe.test.ts:105-111` — "this test no longer needs two racing walks to prove anything" is true of the sentence's own test and false of the file, since the new #172 test 40 lines below does exactly that. Reword once attack 1 is fixed.
4. `git.test.ts`'s octal-escape note (`\x00` vs `\0` immediately followed by a digit) is a genuinely useful landmine marker. Keep it.

---

## Open findings vs failing tests

6 open findings (attacks 1-6); 4 executable as named failing tests (attack 1 -> 2 tests, attack 2 -> 1, attack 3 -> 1). Attack 4 (issues closed before the fixing commit) and attack 5 (missing tracking artifact for the twin's argv gap) have no executable form: both are state/tracking corrections, and I say so rather than invent a test for them. Attack 6 is LOW and non-gating.

## The single scariest unproven assumption

**That "the fix-now round closed the round-1 findings" was verified by the suite going green — when the suite cannot see two of the three code fixes at all.** The #170 catch narrowing survives a total revert with a byte-identical 779/778/1 (attack 2). The #172 fix is real, but the test that proves it is the single test in this repo that mutates the shared checkout, and it loses 6 out of 6 against a second concurrent runner (attack 1). A green `npm test` is currently evidence that one process ran alone on a clean tree — the one condition this project's own multi-agent workflow does not reliably provide. Round 1's lesson was "a fix that looks complete and is not"; round 2's is "a green suite that proves less than it appears to".

## Verdict and next action

**no-go.** One HIGH backed by demonstrated evidence (attack 1: 6/6 reproducible failure, plus shared-tree mutation, plus an orphan that silently skews the instrument) forces it under the Evidence Policy, and it is not a close call — the fix for a flaky test shipped a deterministically-failing one. The other four MEDs are each a handful of lines or a state correction. The three genuinely-closed findings (#171, #172, #173) are closed well, and that belongs on the record: the #172 fix in particular is the correct structural fix and reproduces under my own independent repro.

**Single next action:** sandbox `marker-corpus-probe.test.ts`'s untracked-file regression into a `mkdtemp` git repo (attack 1, proof-test 1) — it is the only finding that is both blocking and actively corrupting the shared working tree that several agents on this story are using right now.

---

## Tree integrity after my testing

One throwaway `git worktree` created and removed (`git worktree list` shows only `C:/playground/thoth 713dbdd [fix/s1-closeout-164-154]`); the ENOENT mutation was applied only inside that worktree and reverted there before removal; the main checkout is on its BRANCH, not detached HEAD, at `713dbdd`. `git status --porcelain` on the main tree shows only this round's own review artifacts. No source file was modified by this review. The orphan `docs/zz-marker-corpus-probe-untracked-regression.md` I deliberately created in attack 1 was deleted afterwards and verified gone.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] #172 new regression test writes a FIXED path into the REAL repo working tree (only test in the repo not sandboxed in mkdtemp - 5 others are) and still compares TWO live full-tree probe spawns; two concurrent `node --test` processes on one checkout fail it 6/6, worse than the ~17% #170 flake it replaced; SIGKILL mid-run orphans the file, which the #172 fix then silently counts (total 1025 vs 1021, QA-15 still PASS). Defense: finally/unlink only, useless across processes. Exposure: 6 of 6 losing-process runs; 100% of npm test runs mutate the shared tree, basis: measured
2. [ISSUE][MED][demonstrated] the #170 catch-narrowing (both files) is pinned by ZERO tests - full-suite mutation reverting both to blanket-continue gives 779/778/1, byte-identical to the unmutated control in the same worktree; the stated root cause is also not the mechanism my 6/6 repro exercises (that path is ENOENT, still swallowed). Exposure: 2 of 2 catch sites, 0 tests, basis: measured
3. [ISSUE][MED][demonstrated] #170+#172 compose into a NEW crash: `git ls-files --others` reports a nested untracked git repo as `zz-nested/`, shouldScanFile passes it, readFile throws EISDIR and the narrowed catch rethrows - exit 1, raw stack, path never named, in both --field and default mode; pre-fix `ls-tree -r` could never list a directory. Exposure: 100% of invocations in a checkout with any nested .git; 0% in CI, basis: measured
4. [ISSUE][MED][demonstrated] round-1 finding #174 recurred verbatim - #170/#171/#172/#173 all closed COMPLETED 00:38:17-00:38:52Z, 8m55s BEFORE the fixing commit was authored (00:47:12Z), branch still unpushed/unreviewed; #174 is still OPEN and did not prevent it. Credit: #164/#154 correctly left un-re-closed. Exposure: 4 of 4 issues in scope, basis: measured
5. [ISSUE][MED][demonstrated] the twin's #173-class argv-swallowing is disclosed in CHANGELOG prose but has NO Issue and NO backlog line (#175 covers only the list/content half), and continuation-residual-probe.test.ts:159-168 now asserts exit 0 on a stray arg as correct - the defect is pinned, not tracked; live: not-a-ref-at-all and --bogus-flag both exit 0 with continuation-marked=301. Exposure: ~100% of arg-passing invocations of the twin, 2 committed copy-paste sources, basis: counted in code + measured
6. [ISSUE][LOW][demonstrated] duplicated `--field=total --field=marked` is silently first-wins (prints total=1021, exit 0) - assertKnownArgs allowlists any `--field=`-prefixed token, so the swallow class #173 closed survives one shape smaller. Exposure: no such call site in-repo today, basis: counted in code
7. [SUSPICION][LOW][demonstrated] round-1's 773-vs-774 cold-run anomaly did NOT recur - 8 consecutive runs all 779/779, 0 fail, 0 skipped; delta 774->779 reconciles exactly (+3 git.test.ts, +2 net marker-corpus); not explained by the #170 fix, not reproduced, stays non-gating
8. [CLEAN][demonstrated] #172 genuinely closed - my own round-1 repro rerun in a worktree: untracked file 1021->1024, identical to the same 3 citations in a TRACKED file (1024), gitignored correctly excluded (1021); a real structural fix, not symptom suppression
9. [CLEAN][demonstrated] submodule exclusion introduces no new miscount - the mode-160000 filter drops exactly the set lsTree already dropped; main checkout (adr/ populated) and worktree (adr/ absent) both report total=1021; `-z` also fixes lsTree's latent C-quoting bug on non-ASCII paths
10. [CLEAN][demonstrated] #173 fails loud and generalizes beyond the named strings - allowlist not denylist, runs first in main() before any file walk; 6 bad shapes incl. unnamed `--field` and `-f` all exit 1 with a message naming the token; valid forms still exit 0
11. [CLEAN][demonstrated] #171 Milestone #19 really patched (server-side updated_at 2026-09-14T00:38:52Z) and discloses the residual by pointing at the live reference-resolver command instead of re-freezing the stale 143 figure
12. [CLEAN][demonstrated] #175 filed OPEN with bug/severity:med/qa + Milestone S1, disclosed in Issue + CHANGELOG + shipped code comment; deferring is correct and load-bearing - the twin's HEAD-pinned list is the only thing shielding it from attack 3's EISDIR crash
13. [CLEAN][code-traced] hostile lens - reading untracked files does not widen the boundary: content is regex-scanned to integers only, never exec-ed, never reaches a git argument (argv is now strictly --field=), issueExists stubbed to null, no credential; KNOWN_INSTRUMENTS untouched; CI's tree is clean so the untracked set is empty there
counts (CHECKSUM): issues=6 suspicions=1 clean=6
evidence (CHECKSUM): demonstrated=12 code-traced=1 derived=0
checks=node --test full suite 779/779 pass, 0 fail, 0 cancelled, 0 skipped x8 consecutive serial runs (main checkout, 713dbdd); CONCURRENCY: two simultaneous `node --test src/qa/marker-corpus-probe.test.ts` loops on one checkout -> process X 6/6 clean (12/12), process Y 6/6 FAIL (12 tests, 11 pass, 1 fail - the #172 untracked-file regression); MUTATION: both ENOENT narrowings reverted to blanket-continue in a throwaway worktree -> 779 tests/778 pass/1 fail, IDENTICAL to the unmutated control in the same worktree (the 1 fail is the known missing-adr-submodule worktree artifact) - mutant SURVIVES; EISDIR repro: nested untracked git repo -> `git ls-files -z --others` emits `zz-nested/` -> probe exits 1 with an unhandled EISDIR stack in both --field and default mode, clean again after rm; #172 repro (worktree): 1021 baseline / 1024 untracked / 1024 same-citations-tracked / 1021 gitignored / 1021 restored; #173 repro: not-a-ref-at-all, HEAD~5, --bogus-flag, a26e55a, --field, -f all exit 1 with `unrecognized argument(s)`, no-args and --field=total exit 0; twin still exit 0 on not-a-ref-at-all and --bogus-flag (continuation-marked=301); interrupt repro: SIGKILL mid-test leaves `?? docs/zz-marker-corpus-probe-untracked-regression.md`, probe then reports total=1025 and QA-15 still PASSes exit 0; gh: milestone 19 description patched updated_at=2026-09-14T00:38:52Z, issues 170/171/172/173 closedAt 00:38:17-00:38:52Z vs commit authored 00:47:12Z, `git branch -r --contains 713dbdd` empty; grep: 0 tests mention ENOENT, 5 test files use mkdtemp, marker-corpus-probe.test.ts is the only writeFile into the repo tree
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-red-team-round2-2026-09-13.md
HEAD: 713dbdd3dbb3ef1a742b7300f058b980ac7dcb19
