# Red Team (Sutekh) — s1-229-qa14-red, round 2 (targeted re-confirm)

Date: 2026-09-21. Branch `fix/s1-229-qa14-red`, HEAD 997e69d. Delta under review: eae5451..997e69d
(`src/qa`, `docs/decisions.md`, `CHANGELOG.md`). Tier CRITICAL (ratified). Verdict: **go**.

ADR cache line printed this pass:
`ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ~18300 tokens saved this pass (fp b588a48) [CACHE=HIT]`

Round 1 report: `docs/reviews/s1-229-qa14-red-red-team-2026-09-21.md`. Round-1 record: the newest row of
`docs/decisions.md`. Build evidence for this round: section 13 of
`docs/plans/s1-229-qa14-red-build-report-2026-09-21.md`.

## Method

A throwaway git repository in the session scratchpad, seeded from the working tree (`src`, `docs`,
`adr/devops`, `adr/software-engineering`, `CHANGELOG.md`, `package.json`, `tsconfig.json`), driven
through the **real entry point** `node src/qa/reference-resolver.ts <base> <head>`. Two pure-function
probes import the shipped modules directly. Five mutation runs were applied to the throwaway copy of
`src/qa/reference-scope.ts` only. The repository under review was never modified; `git status --porcelain`
was clean before and after (the only file I add is this report).

The payload in every laundering attack is a **malformed ADR id (two digits where four are required)**:
it fails offline, with no issue-tracker credential, so every exit code is deterministic. Control
established first: one fresh bad line appended to `CHANGELOG.md` gives
`FAIL: 1 of 1 citation(s) failed to resolve`, exit 1, naming `CHANGELOG.md`. Every result below is
measured against that control. Raw tool output containing example citations is summarized, per the
brief; commands, exit codes and counts are given verbatim.

---

## 1. Round-1 findings re-run against HEAD

### Issue #253 — rename WITH an edit into an append-only path. **CLOSED, demonstrated.**

| Step | Round 1 (eae5451) | Round 2 (997e69d) |
|---|---|---|
| 81-line document under a non-record path, one malformed ADR id | exit 1, named the source path | exit 1, named the source path |
| Same file moved under `docs/reviews/` with its header line reworded, one commit | **exit 0** (vacuous pass) | **exit 1**, the failure named the destination under `docs/reviews/` |

`git diff --name-status -M` confirmed git detected the move as a rename at 98% similarity (a rename
with an edit), which is the shape that defeated round 1. The whole moved body is now scanned.

### Issue #254 — moving a failing citation from a living doc into an append-only record. **CLOSED, demonstrated.**

| Step | Round 1 | Round 2 |
|---|---|---|
| Living document holding one malformed ADR id | exit 1, named the living document | exit 1, named the living document |
| Same line deleted from it and appended verbatim to `CHANGELOG.md`, one commit (`--numstat`: 1 add to `CHANGELOG.md`, 1 removal from the living doc) | **exit 0** | **exit 1**, `FAIL: 1 of 1`, the failure named `CHANGELOG.md` |

Both round-1 issues are demonstrably closed at HEAD. Both are closed on GitHub this turn with the
evidence above.

---

## 2. Attacks on the NEW code

### 2a. The base-existence check (`makeExistsAtBase`, `ScanTextDeps.existsAtBase`)

All through the real entry point unless marked.

| Attack | Outcome |
|---|---|
| Merge-base vs base-tip: a path the base branch gained **after** the branch point, then a rename-with-an-edit onto that path on the feature branch | **exit 1**, whole-file. `git cat-file -e` confirmed the path exists at the base tip and NOT at the merge base; the code asks the merge base, which is the three-dot diff's own old side. Base-tip semantics would have kept the exemption |
| A **copy** (not a rename) of a failing document into `docs/reviews/` | exit 1, named the copy |
| A rename **onto an existing** append-only path (forced move onto `CHANGELOG.md`, plus an edit) | exit 1, named `CHANGELOG.md`. Git reports this as delete + modify, never a rename pair, so every line of the moved body is an added line |
| Delete and recreate an append-only record in one diff | exit 1, named `CHANGELOG.md` |
| Routine append to a record that exists at the merge base | exit 0, the record's own pre-existing bad row not re-checked — scoping still works, the fix is not a blanket revert |
| Runner rejects (probe on `buildScanTexts` and `makeExistsAtBase`): `existsAtBase` rejecting with an `Error`, rejecting with a non-`Error`, throwing synchronously, resolving `undefined` | **all four produce a whole-file scan.** The payload survived into the scan text in every case |
| `git merge-base` exits non-zero / returns empty stdout; `git cat-file -e` exits non-zero | all read as absent, so whole-file. A shallow clone therefore goes loudly red, never silently green |
| Path holding a space, a leading dash, a single quote, a dollar sign — routine append | exit 0, correctly scoped (git's trailing tab after such a header path is handled) |
| Same odd-named path, rename WITH an edit into it | exit 1, whole-file, destination named |
| Option / revision injection into the git argument | Not reachable. The argument is always the single token merge-base-sha, colon, path, so it can never begin with a dash. Argv captured for seven hostile paths (leading dash, space, colon, a path spelled as a git option, a percent-encoded traversal, a ref name, empty): every one arrived as one argument, prefixed by the SHA, no shell |
| Colon inside a filename | Not testable on this Windows checkout (illegal filename). Code-traced: git resolves a rev-colon-path spec at the first colon, and the first colon is always the one the code inserts. Not claimed as verified |
| Zero-SHA sentinel | Full-tree fallback; `existsAtBase` is never consulted (the full-tree flag short-circuits before the diff is read). Round-1 result unchanged: exit 1, loud |
| Merge-base call count under 50 concurrent paths | 1. The promise is memoized, and a rejected memo is re-awaited and re-caught per path — no unhandled rejection |

### 2b. The new licence rule (only a removal from an append-only record this run scans licenses an add)

| Attack | Outcome |
|---|---|
| Two-hop laundering in one PR: living doc to record A in commit 1, record A to record B in commit 2 | **exit 1**, named record B. CI's three-dot range collapses both hops into one diff whose only removal is from the living document, which licenses nothing |
| Removal from a record the same diff **deletes** | exit 1, the added copy checked |
| Removal from a record the same diff **renames away** (with the line dropped in the same move) | exit 1; the added copy was checked against `CHANGELOG.md`, and the renamed-away record — a path absent at the merge base — was itself scanned whole (85 of 162 citations failed, all of them its own historical rows) |
| Multiset abuse across two records: one removal from the decision log, two identical adds to `CHANGELOG.md` | exit 1, `FAIL: 1 of 1` — exactly one add licensed, the other checked |
| Rename a living doc to a **new** record path while also adding its removed line to `CHANGELOG.md` | exit 1, named `CHANGELOG.md` — the removal is keyed to the living old path and licenses nothing |
| Record renamed away **and** recreated at the same path, its removed old row added to `CHANGELOG.md` | exit 0 for that line. Within the invariant below: the line existed at the merge base inside an append-only record |
| A move between two different append-only records, single copy (the by-design case) | exit 0 — exempt, as designed |
| An internal move **inside one** record (an old row removed and re-inserted elsewhere in the same file) | exit 0 — also exempt. See Editorial 1: the decision row says "from another append-only record", which is narrower than the code |

**Why the by-design move is not exploitable, stated as an invariant.** A licence exists only where the
diff carries a removed line, and a removed line only exists for content present on the diff's old side.
The licence is further gated on that old-side path being (i) an append-only record and (ii) present in
the head-side scannable map, that is, still on disk. So every exempt added line is a line that
**already sat at the merge base inside an append-only record**. Text that is new to the repository can
never be exempted by a move. I attacked that invariant seven ways above — re-keying a removal through a
rename, through a delete, through a delete-and-recreate, through a living-doc source, through a second
hop — and did not break it. I am not claiming the enumeration is exhaustive; I am claiming I could not
break it in seven attempts and that the invariant follows from the two gate conditions in the shipped
`moveLicences`.

### 2c. The canonical-format mirror cut (parse, compare, cut, re-serialize)

Probe against the shipped `stripAdrCatalog`, 20 shapes.

**Hiding attempts** (does authored text survive the cut?):

| Shape | Result |
|---|---|
| Authored note nested **inside** an object-valued mirror at the root | Cut — hidden. By design; see the assessment below |
| Authored note inside a mirror object on the nested-snapshot chain | Cut — hidden. Same class |
| Mirror key under an unrelated parent key | Returned whole, nothing cut |
| A chain key inside an **array** | Returned whole, nothing cut |
| A chain key whose value is an array of objects carrying mirrors | Returned whole, nothing cut |
| Mirror key valued as a string / an array / null, with an authored sibling | Returned whole in all three, nothing cut |
| Chain depth 3 with an authored note at the deepest level, outside the catalogs | Catalogs cut, the note survived |

**Non-canonical spellings** (must be scanned whole):

| Shape | Returned whole? |
|---|---|
| Duplicate mirror keys in one object | Yes — **round-1 suspicion 5 is closed**; the tokenizer cut both, the new cut returns the file whole |
| Mirror key spelled with a unicode escape (first char, and last char) | Yes — nothing cut, payload survives |
| Tab indentation | Yes |
| Four-space indentation | Yes |
| Minified | Yes |
| JSON with a comment | Yes |
| Trailing comma / BOM prefix | Yes |
| Two trailing newlines | Yes |
| CRLF throughout, otherwise canonical | **No** — accepted and cut |
| One CR line mixed into an otherwise LF file | **No** — accepted and cut |
| One trailing newline | **No** — accepted and cut |

The three accepted-and-cut rows are the documented normalization (CRLF and one trailing newline aside)
and are benign: because the returned text is the re-serialization of the parse, and the parse was
proved lossless by the equality check, the only text that can be lost is what sits inside a cut mirror
object. That is the one hiding place, and it is the design.

**Assessment of the one hiding place.** Text inside an object-valued mirror at the root or on the
chain is dropped unconditionally. The safety argument is that the mirror is a generated cache whose
source of truth is the ADR files, and those files are scanned when they change. That argument holds
for the two in-repo ADR documents under `docs/adr/` (ordinary scanned Markdown). For the ADR submodule
folders the source lives in another repository and is out of this gate's reach either way, so the cut
removes nothing this gate would otherwise have checked. A hand edit that plants prose inside the
mirror would hide it until the cache is regenerated — that is the residual, it is narrow, and the file
is machine-written.

**Cost.** Round 1 measured the tokenizer as growing with depth times file size. Re-measured on the
shipped parse-and-compare cut, best-of-run wall clock:

| Input | Round 1 (tokenizer) | Round 2 (shipped) |
|---|---|---|
| Real `docs/.maat-state.json` (about 208 KB, chain depth 17) | 22.7 ms | **0.8 ms** |
| Synthetic depth 68 | 806 ms at 2.9 MB | **4.4 ms at 1.5 MB; 17.8 ms at 7.1 MB** |
| Synthetic depth 136 | 4.8 s at 9.6 MB | **11.9 ms at 4.4 MB** |

Time now tracks file size and is flat in chain depth. **The depth-times-size cost is gone** — round-1
suspicion 4 is closed, and the depth-40 / 1 MB re-measure threshold it suggested is no longer needed.

### 2d. The new stderr NOTE when the diff cannot be read

Forced with an external-diff environment variable pointed at a nonexistent tool, which breaks
`git diff` but not `git diff --name-only`:

- Control, same commit, normal run: exit 0, scoped, the record's pre-existing bad row not re-checked.
- With the diff broken: exit **1**, `FAIL: 157 of 319`, the record's pre-existing bad row reported, and
  exactly one `NOTE: cannot read the diff (...), so append-only records are scanned whole.` line on
  stderr. No crash, no pass, no duplicate notes.

Whole-file fallback confirmed by the citation count jumping from 0 to 319.

---

## 3. Findings

### 3.1 [ISSUE][LOW][demonstrated] The mirror cut can throw instead of falling back, on a deeply nested but valid state file

**Scenario.** `docs/.maat-state.json` is valid JSON but nested thousands of levels deep. `JSON.parse`
succeeds (V8's parser is iterative); the canonical-equality comparison then calls `JSON.stringify`,
which is recursive, and it throws a call-stack RangeError. That call sits **outside** the `try` that
guards the parse, at `src/qa/reference-scope.ts:221`, so the throw escapes `stripAdrCatalog`, escapes
`buildScanTexts`, and kills the run.

**Demonstrated.** Isolated: at depth 20000, `JSON.parse` returns normally and `JSON.stringify` throws.
Through the real entry point, with the state file replaced by a valid 20000-deep object: exit 1, no
QA-14 result line at all, a raw stack trace naming `src/qa/reference-scope.ts:221`. Threshold
measured: depth 1000 returns whole; depth 10000 and above throws.

**Current defense, honestly assessed.** The exit code is 1, so nothing passes — the gate does not fail
open. But the function's own doc comment says anything other than a canonical file, unparseable input
included, is returned whole, and the module header lists unparseable JSON among the
fail-closed-to-whole-file cases. Neither is true for this input: it is fail-closed by accident of the
exit code, not by the documented fallback, and the operator sees a stack trace instead of a QA-14
verdict.

**Exposure: ~0% of runs, basis: measured.** The real state file is about 208 KB with a chain depth of
17 and a total nesting depth in the low twenties; the throw needs roughly three orders of magnitude
more. The chain grows one level per story. There is no path from the writing tool to this shape, only
a hand edit or a corrupted file.

**Named proof-test / fix.** One-line fix: move the equality comparison and the final re-serialization
inside the existing `try`, returning the input text on any throw. Named test in
`src/qa/reference-scope.test.ts`: "a valid but pathologically nested .maat-state.json is scanned
whole, not thrown on" — build a 20000-deep object, assert `stripAdrCatalog` returns its input
unchanged. LOW severity: it does not gate, and no GitHub Issue is filed for it per this project's
severity rule.

### 3.2 Round-1 findings, status at HEAD

| Round-1 finding | Status now |
|---|---|
| 1. Rename with an edit into an append-only path (Issue #253) | **Closed, demonstrated** (section 1) |
| 2. Move rule launders a failing citation (Issue #254) | **Closed, demonstrated** (section 1) |
| 3. Pre-existing: an unresolvable non-zero base ref is a vacuous pass | Unchanged, still pre-existing, still not widened. `src/lib/git.ts` has an empty diff for this round. Not a finding for this story |
| 4. Mirror cut grew with depth times file size | **Closed, demonstrated** — parse-and-compare is flat in depth, 0.8 ms on the real file |
| 5. Duplicate mirror keys both cut | **Closed, demonstrated** — a duplicate key now makes the whole file non-canonical, so it is scanned whole |
| 6. Symlink under an append-only directory | **Still UNPROVEN-pending-verification.** Same Windows checkout, same limitation. Settling command unchanged: on Linux or with symlinks enabled, create a real symlink under `docs/reviews/` pointing at a document holding a bad example, commit, run the entry point against the previous commit, confirm exit 1. I did not verify it and do not claim it breaks |

---

## 4. Mutation re-verification (mine, not the build report's)

Throwaway copy of the module, one edit at a time, full suite each run
(`node --test src/qa/reference-scope.test.ts`). Baseline: **tests 61, pass 61, fail 0, skipped 0**.

| Mutation | Build report claim | My full-suite result |
|---|---|---|
| **A1** — every append-only record scoped, base-existence ignored | 7 red (5 rename-with-edit, base-absent unit, failing-check unit) | **pass 54, fail 7** — exactly those seven, by name. Confirmed |
| **A3** — existence result inverted | 6 red (5 rename tests, base-absent unit) | **pass 43, fail 18.** All six named tests are red, plus twelve more (the routine-append test, the addendum test, the archive-sweep test, the multiset test, the same-token test, the unattributable-path test). The mutant is killed harder than claimed. See Editorial 3: the table's counts are relative to a per-row named subset the table does not name |
| **M7** — removal-source restriction dropped | 10 red (4 build laundering tests, 5 living-source tests, the deleted-record test) | **pass 51, fail 10** — exactly those ten, by name. Confirmed |
| **X1** — the pending-break flag dropped (a mutant that SURVIVED at eae5451) | 1 red, the licensed-line-between test | **pass 60, fail 1** — that test, alone. Confirmed killed |
| **C1** — canonical-equality check dropped | 1 red, the non-canonical test | **pass 60, fail 1** — "a file that is not the canonical two-space serialization of its parse is scanned whole", alone. Confirmed |

Four of five claims reproduce exactly. The fifth (A3) under-states its own kill count.

---

## 5. Round-1 editorial items and the decision row

**Editorial items from round 1 — all three corrected.** Verified by search against the shipped module:

| Round-1 item | Status |
|---|---|
| The claim that the removal-source restriction "closes" the laundering path overclaimed | Gone (0 occurrences of that phrase). Replaced by what the rule does plus an explicit "Residual:" sentence naming the already-in-the-repository case |
| The fail-closed list named a pure rename but not a rename WITH an edit | Corrected. The list now names "an append-only path that is absent at the base, which covers a rename WITH an edit", and adds "a base-existence check that fails" |
| "a file this run scans" misleading as a safety argument | Corrected (0 occurrences). The header now says "an append-only record that this run scans" |

**Decision row (f), "what QA-14 no longer checks", tested clause by clause against the real entry point:**

| Clause | Test | Result |
|---|---|---|
| In a record that exists at the merge base: a line the diff does not touch | Routine append to a record holding a pre-existing bad row | TRUE — exit 0, the old row not re-checked |
| A line moved verbatim from another append-only record | One removal from the decision log, one identical add to `CHANGELOG.md` | TRUE — exit 0 |
| In `docs/.maat-state.json`, when canonical: the mirror at the root and along the nested-snapshot chain | 20-shape probe (section 2c) | TRUE — and only then; every non-canonical spelling is scanned whole |
| "Nothing a diff adds is exempt" | Nine laundering shapes plus the invariant argument in section 2b | TRUE in the sense that matters — no line new to the repository was exempted in any attack. See Editorial 1 and 2 for the two wording defects |

The row is now a true description of the shipped code, with the two wording defects below.

## Editorial (verdict-neutral, fix as plain edits or a correcting row, no re-review)

1. Decision row (f) says a move is licensed "from **another** append-only record". The shipped rule
   also licenses a move **within one** record — demonstrated: an old row removed from the decision log
   and re-inserted elsewhere in the same file exits 0. The CHANGELOG entry already has the correct
   spelling ("an added line identical to a line the same diff removes from an append-only record").
   `docs/decisions.md` is append-only, so this is a correcting sentence in the next row, not an edit.
2. Same row: "Nothing a diff adds is exempt" sits immediately after a list of two classes of added
   lines that *are* exempt, so read standalone it contradicts its own paragraph. The CHANGELOG's
   phrasing — "Every other line a diff adds is checked" — is the one to copy.
3. Build report section 13.5's mutation table gives per-row red counts against a per-row named test
   subset that the table does not identify. A full-suite run reproduces four of five rows exactly and
   gives 18 red for A3 against the table's 6. Nothing is wrong with the mutants; the column needs a
   one-line note saying the counts are subset-relative, or the subset named per row.
4. The size pin recorded in decision row (h) is tighter than the row implies: the highest line of
   `src/qa/reference-scope.ts` cited by an immutable report is 327, and the file is 328 lines. One
   line of margin. The one-line fix in finding 3.1 moves two lines inside a `try` and does not shrink
   the file, but any other edit should be checked against that number.

## What I did not verify

- Symlink handling under an append-only directory (round-1 finding 6) — same Windows checkout, same
  named settling command. Not claimed either way.
- A path containing a colon through `makeExistsAtBase` — illegal filename on this platform;
  code-traced only.
- The diff-text and base-existence calls executing inside a real GitHub Actions checkout. No CI run
  has exercised them (the branch is unmerged). Both fail to whole-file, so the failure mode is loud.
- Behaviour under a non-default git prefix or colour setting — code-traced to the whole-file branch in
  round 1, not re-run here.
- `npm test`, lint and typecheck as a whole. I ran only `src/qa/reference-scope.test.ts` (61/61) plus
  the five mutation runs; I did not re-run the resolver's own 85-test suite, which has an empty diff
  for this round.
- Whether any historically moved line carried a failing citation — round 1's unmeasured harm rate.
  Moot now: the laundering shape it described exits 1.

## Scariest unproven assumption, and the call

The scariest unproven assumption is **that a licence can only ever come from text that already sat in
the repository.** Everything the move rule exempts rests on it, it is not asserted anywhere as an
invariant, and no single test names it. I attacked it seven ways and could not break it, and it
follows from the two conditions in the shipped `moveLicences` — but it is load-bearing and implicit.
The cheap hardening is a one-sentence invariant in the module header plus one test named for it, not a
code change.

**Go.** Both round-1 issues are demonstrably closed through the real entry point; the two fixes did not
blunt the mechanism (routine appends are still scoped, the real diff-mode run is still green at exit
0); the new base-existence check uses the merge base, is fail-closed on every failure mode I could
induce, and offers no argument-injection surface; the mirror swap closed two round-1 suspicions and
made the cut roughly 25 times faster on the real file; and four of the five mutation claims I chose to
doubt reproduce exactly, with the fifth under-stating itself. The single new finding is LOW, has no
production trigger, and exits 1 anyway. Open findings 1, failing tests 1 — the named test in 3.1.

## Receipt

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][LOW][demonstrated] A valid but ~20000-deep docs/.maat-state.json makes the canonical-equality JSON.stringify at src/qa/reference-scope.ts:221 throw a call-stack RangeError outside the guarding try; the run dies with a stack trace and no verdict line instead of the documented whole-file fallback. Exit is still 1, so nothing passes. Exposure: ~0% of runs, basis: measured (real file is depth ~17 plus a few, the throw needs ~10000).
2. [CLEAN][demonstrated] Issue #253 re-run at HEAD: rename WITH an edit into docs/reviews/, same payload as round 1 — round 1 exit 0, now exit 1 naming the destination. Closed.
3. [CLEAN][demonstrated] Issue #254 re-run at HEAD: failing citation deleted from a living doc and pasted verbatim into CHANGELOG.md — round 1 exit 0, now exit 1 naming CHANGELOG.md. Closed.
4. [CLEAN][demonstrated] Merge-base vs base-tip: a path the base branch gained after the branch point, targeted by a rename-with-an-edit, is scanned whole (exit 1); base-tip semantics would have exempted it.
5. [CLEAN][demonstrated] A copy (not a rename) into an append-only path is scanned whole, exit 1.
6. [CLEAN][demonstrated] A rename onto an existing append-only path (with an edit) is a delete plus modify to git, every moved line is added text, exit 1.
7. [CLEAN][demonstrated] Delete-and-recreate of an append-only record in one diff: exit 1.
8. [CLEAN][demonstrated] A routine append to a record that exists at the merge base is still scoped, exit 0 — the fix did not blanket-revert the feature.
9. [CLEAN][demonstrated] existsAtBase rejecting (Error, non-Error), throwing synchronously, or resolving undefined: all four fall back to whole-file.
10. [CLEAN][demonstrated] git merge-base non-zero or empty, git cat-file non-zero: all read as absent, whole-file; a shallow clone goes loudly red, never silently green.
11. [CLEAN][demonstrated] No option or revision injection: the git argument is one token starting with the merge-base SHA; argv captured for seven hostile paths (leading dash, space, colon, a git-option spelling, a percent-encoded traversal, a ref name, empty).
12. [CLEAN][demonstrated] Paths with a space, a leading dash, a quote and a dollar sign scope correctly on a routine append and fail closed on a rename-with-edit.
13. [CLEAN][code-traced] Zero-SHA: the full-tree flag short-circuits before the diff is read, so existsAtBase is never consulted; round-1's loud exit-1 result unchanged.
14. [CLEAN][demonstrated] Merge base resolved once for 50 concurrent paths; a rejected memo is re-caught per path, no unhandled rejection.
15. [CLEAN][demonstrated] Two-hop laundering (living doc to record A to record B) in one PR: the three-dot range collapses it to a living-doc removal, which licenses nothing. Exit 1.
16. [CLEAN][demonstrated] Removal from a record the same diff deletes licenses nothing, exit 1.
17. [CLEAN][demonstrated] Removal from a record the same diff renames away licenses nothing, exit 1; the renamed-away record is itself scanned whole.
18. [CLEAN][demonstrated] Multiset across two records: one removal, two identical adds, FAIL: 1 of 1 — exactly one licensed.
19. [CLEAN][demonstrated] Renaming a living doc to a new record path does not re-key its removals into a licence, exit 1.
20. [CLEAN][demonstrated] The by-design move between two records (and, undocumented, within one record) exits 0; not exploitable — every exempt line must have existed at the merge base inside an append-only record, an invariant I attacked seven ways without breaking.
21. [CLEAN][demonstrated] Mirror cut, hiding battery: a mirror key under an unrelated parent, a chain key inside an array, a chain key valued as an array of objects, a mirror valued as a string/array/null, and an authored note three levels down the chain — none cut, all scanned.
22. [CLEAN][demonstrated] Non-canonical battery: duplicate keys, unicode-escaped key spelling (first and last char), tab indentation, four-space indentation, minified, a comment, a trailing comma, a BOM, two trailing newlines — all returned whole. Round-1 suspicion 5 and the escaped-key gap are closed.
23. [CLEAN][demonstrated] The three accepted normalizations (CRLF throughout, one mixed CR line, one trailing newline) are cut, and are benign: the output is the re-serialization of a parse proved lossless, so only text inside a cut mirror object can be lost.
24. [CLEAN][demonstrated] Depth-times-size cost is gone: real state file 22.7 ms to 0.8 ms; synthetic depth 68 806 ms to 4.4 ms; depth 136 4.8 s to 11.9 ms. Flat in depth. Round-1 suspicion 4 closed.
25. [CLEAN][demonstrated] The stderr NOTE path: a forced external-diff failure gives exit 1, FAIL: 157 of 319, exactly one NOTE line, whole-file fallback confirmed by the citation count jumping from 0 to 319. No crash, no pass.
26. [CLEAN][demonstrated] Mutation A1 re-verified by me: pass 54, fail 7 — exactly the seven named tests.
27. [CLEAN][demonstrated] Mutation M7 re-verified by me: pass 51, fail 10 — exactly the ten named tests.
28. [CLEAN][demonstrated] Mutation X1 (a mutant that survived at eae5451) re-verified: pass 60, fail 1 — the named test, alone. Killed.
29. [CLEAN][demonstrated] Mutation C1 re-verified: pass 60, fail 1 — the named non-canonical test, alone.
30. [CLEAN][demonstrated] Mutation A3 re-verified: pass 43, fail 18 — all six named tests red plus twelve more. Killed harder than claimed; the table's counts are subset-relative (Editorial 3).
31. [CLEAN][demonstrated] All three round-1 editorial items corrected in the module header (0 occurrences of each retired phrase; the fail-closed list now names the rename-with-an-edit and the failing base-existence check).
32. [CLEAN][demonstrated] Decision row (f) tested clause by clause against the real entry point: every clause is TRUE of the shipped code. Two wording defects recorded as Editorial 1 and 2.
33. [SUSPICION][LOW][demonstrated] Symlink under an append-only directory: still UNPROVEN-pending-verification on this Windows checkout; named settling command carried forward from round 1.
34. [SUSPICION][MED][code-traced] Pre-existing and untouched: an unresolvable non-zero base ref is a vacuous pass at exit 0 in main(). Empty diff for this round, not widened, not reachable through the current CI wiring. Carried forward, not a finding for this story.
counts (a CHECKSUM): issues=1 suspicions=2 clean=31
evidence (a CHECKSUM): demonstrated=32 code-traced=2 derived=0
checks=node --test src/qa/reference-scope.test.ts -> tests 61, pass 61, fail 0, skipped 0; mutation A1 -> pass 54, fail 7, skipped 0; A3 -> pass 43, fail 18, skipped 0; M7 -> pass 51, fail 10, skipped 0; X1 -> pass 60, fail 1, skipped 0; C1 -> pass 60, fail 1, skipped 0; node src/qa/reference-resolver.ts master HEAD (real repo) -> exit 0, PASS, 0 failed; about 25 real entry-point runs in a throwaway git repository; 2 pure-function probes (20 mirror shapes, 19 base-existence shapes)
adr=HIT(37)
report=docs/reviews/s1-229-qa14-red-red-team-round2-2026-09-21.md
