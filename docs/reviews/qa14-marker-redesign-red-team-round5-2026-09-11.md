# Red Team (Sutekh) — `qa14-marker-redesign` ROUND 5 final re-confirm (council-ratified path)

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `f966a7b`, repo `mohannadrabie/thoth`, CRITICAL tier
- **Mandate:** verify the four council-ratified items landed correctly and *structurally*; answer whether the numeric-claim-drift class is now closed.
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]` — no ADR governs QA-instrument internals or CI-gate blocking semantics (same conclusion as all 5 prior passes; re-confirmed against `adrCatalog.adrs`, not re-derived).
- **Reading order followed:** `docs/decisions.md` row 70 (Path-Forward Brief, in full) then row 71 (round-4 build close-out, in full) then the three council reports in full, then the live code at `f966a7b`.

## File-state integrity

```
git rev-parse HEAD      -> f966a7bc24222a8e1018fd2cbb1a9ba918846a12
git status --porcelain  -> (empty, before and after every check below)
sha256sum (start == end)
  5139fe97...4d44c9  src/qa/reference-resolver.ts
  e35d27b0...b63982  src/qa/continuation-residual-probe.ts
  c2c090e6...183429  CHANGELOG.md
  5cf6af6f...8dac460  docs/STATE.md
```
One temporary `git worktree` at `a26e55a` was created in the session scratchpad for the A/B below and removed (`git worktree list` -> single entry, working tree clean, hashes unchanged).

## Gates, run by me at `f966a7b`

```
npm run typecheck   -> clean, exit 0
npm run lint        -> clean, exit 0
npm test            -> tests 755 | pass 755 | fail 0 | cancelled 0 | skipped 0 | todo 0 (20.2s)
node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit=0
```

---

# Findings, ranked by blast radius

## 1. [ISSUE][MED][demonstrated] The round-4 close-out froze the new instrument's output into BOTH permanently-rescanned files — and it was already wrong at the commit that published it

The commit that exists to end frozen-count drift froze two counts, non-struck, in the two files QA-15 permanently rescans:

```
CHANGELOG.md:70   "...on this repo's current full tree, producing `continuation-marked=273 continuation-residual=3`."
CHANGELOG.md:76   "...`continuation-residual=3`, cross-checked against ... full-tree mode's own 3 matching `#000` failures."
docs/STATE.md:11  "Real cost measured: ~59s / 121 `gh` calls, `continuation-marked=273 continuation-residual=3` at this round's own tree state."

sed -n '70p' CHANGELOG.md | grep -c "~~"   -> 0   (non-struck)
sed -n '11p' docs/STATE.md | grep -c "~~"  -> 0   (non-struck)
```

Measured by me at `f966a7b`, clean tree, using the shipped instrument:

```
node src/qa/continuation-residual-probe.ts --field=continuation-marked
[QA-14 continuation-residual-probe] PASS: continuation-marked=281

node src/qa/continuation-residual-probe.ts --field=continuation-residual
[QA-14 continuation-residual-probe] PASS: continuation-residual=5
  - continuation-marked=281
  - distinct issue numbers queried=121
real 0m43.116s
```

**281/5, not 273/3.** Worse than stale: `273` reproduces at *no committed tree state at all*. I computed the true counts directly from git object content:

```
TRUE content@a26e55a, filelist@a26e55a : {"n":271,"files":222}
worktree content,     filelist@a26e55a : {"n":273,"files":222}
TRUE content@HEAD,    filelist@HEAD    : {"n":281,"files":227}
```

`273` is the hybrid the probe produces when the file list comes from one ref and the content from a different working tree (finding 2) — the exact thing `impact-analyst` called "a number describing a tree state that never existed" when pricing Candidate B, and the exact reason the council rejected that candidate.

**Why the number moved 3 -> 5:** I enumerated every residual citation independently (pure classification plus the two known-nonexistent issue numbers `#000`/`#9999`, no `gh`):

```
continuation  #000   docs/REVIEW_LOG.md
continuation  #000   docs/decisions.md
continuation  #000   docs/reviews/qa14-marker-redesign-impact-analyst-2026-09-11.md      <- committed BY f966a7b
continuation  #000   docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md
continuation  #9999  docs/reviews/qa14-marker-redesign-red-team-round4-2026-09-11.md     <- committed BY f966a7b
```

Exactly 5 — matching the instrument independently, via a different code path. Two of the five are review reports the round-4 commit itself added to the tree. **The act of committing the round's own artifacts moved the number that same commit publishes.** This is the self-referential-corpus mechanism every council seat named, occurring live, on this round's own headline figure.

**The build violated a rule it wrote in the same commit.** `src/qa/continuation-residual-probe.ts:46-48`:

> "Registered in `KNOWN_INSTRUMENTS` as a real, callable, ON-DEMAND instrument only — prose may point at the command, never freeze its output as a frozen count"

**QA-15 is blind to it** — `node src/qa/completeness-claim-checker.ts` PASSes clean at HEAD with both lines live (my own run, above), and I confirmed the miss directly against the shipped heuristic (finding 3).

Exposure: 2 of 2 QA-15 `DEFAULT_FILES` carry a live, non-struck figure that reproduces at no committed tree state; basis: measured (own instrument run plus own git-object recomputation). Reach: operator. Irreversibility: reversible — two strikethrough edits. Silence: high — the gate passes.

**Verdict: BREAKS (MED).** Proof-test required: `qa15: no non-struck instrument-output figure (continuation-marked=N / continuation-residual=N) survives in CHANGELOG.md or docs/STATE.md` — extend `BARE_CLAIM_PHRASES` with the `identifier=N` shape, which is the shape this project now actually writes, and strike the two live lines.

## 2. [ISSUE][MED][demonstrated] The ref/working-tree content-mismatch bug the council rejected Candidate B over is reproduced verbatim in the new instrument

`src/qa/continuation-residual-probe.ts:155-168` takes the **file list** from the passed `ref` and reads **content** from the working tree:

```ts
const resolved = await resolveChangedFiles(git, "0000...0", ref);   // file list <- ref
...
fileTexts.set(file, await readFile(file, "utf8"));                  // content   <- working tree
```

and `main()` accepts a positional ref (line 175): `const ref = argv.find((a) => !a.startsWith("--")) ?? "HEAD";`

Demonstrated, not reasoned:

```
node src/qa/continuation-residual-probe.ts --field=continuation-marked a26e55a
[QA-14 continuation-residual-probe] PASS: continuation-marked=273        <- probe's answer for a26e55a
TRUE content@a26e55a, filelist@a26e55a : 271                             <- reality at a26e55a
```

The council's ratified verdict (`docs/.maat-state.json`, `councilVerdict`) rejects Candidate B *because* it "activates a dormant ref/content-mismatch bug in marker-corpus-probe.ts". The build did not adopt Candidate B — but it copied the defective enumeration pattern into the new file, so the defect now exists in **two** instruments instead of one, in the one the prose points at. It is also the direct mechanism behind finding 1's `273`.

Exposure: 100% of invocations passing any non-default ref (basis: demonstrated, unconditional); 0 CI consumers today (measured — no reference to the probe in `.github/workflows/ci.yml`). Reach: instrument. Silence: total — it prints PASS and a plausible number.

**Verdict: BREAKS (MED).** Proof-test required: `continuation-residual-probe: a non-HEAD ref reads that ref's CONTENT, not the working tree's` — commit a known citation, mutate the working-tree copy, assert the ref-scoped count is unchanged. Cheapest honest alternative: delete the positional-ref argument and document the probe as working-tree-only.

## 3. [ISSUE][MED][demonstrated] Issue #159's fix narrows the class; it does not close it — and it misses the live instance sitting in the file today

I ran the shipped `findBareClaims` directly against 12 constructed strings. Raw result:

```
CAUGHT  | (b)  reintroduced exact historical stale claim  ("10/400 real occurrences, 5 distinct blocking gate failures")
CAUGHT  | (b2) fresh N/M occurrences claim                ("The residual is 7/533 real occurrences at HEAD.")
CAUGHT  | (b3) fresh distinct-failures claim              ("Measured 12/900, 4 distinct blocking gate failures this round.")
MISSED  | (c)  legit test count                           ("npm test 755/755 pass, 0 fail, 0 skipped")        <- correct
MISSED  | (c2) legit coverage                             ("43/45 pass, 17/17 green")                         <- correct
MISSED  | (d)  THE LIVE CHANGELOG.md:70 FIGURE AT HEAD    ("continuation-marked=273 continuation-residual=3")
MISSED  | (d2) THE LIVE docs/STATE.md:11 FIGURE AT HEAD
MISSED  | (d3) plausible next phrasing                    ("3 out of 445 continuation-marked citations")
MISSED  | (d4) plausible next phrasing                    ("3/281 continuation-marked citations fail real existence")
MISSED  | (d5) plausible next phrasing                    ("exactly 5 residual instances tree-wide")
CAUGHT  | (e)  strikethrough smuggling                    ("10/400 real ~~occurrences~~, 5 distinct blocking...")
CAUGHT  | (e2) struck old plus live new on one line       ("~~10/400 real occurrences~~ now 7/533 real occurrences")
```

The two new patterns are anchored to the words `occurrences` and `distinct ... failures|leaks` — the two literal shapes of the *historical* defect. The project's *current* way of writing this number (`identifier=N`, the instrument's own output format, introduced by this same commit) is not covered, and neither is `N out of M` (the existing `\b\d+\s+of\s+\d+\b` requires `of` adjacent to the digits; `3 out of 445` does not match).

This is not a criticism of the council's narrowness trade — impact-analyst's 112-hit measurement makes a blanket pattern indefensible, and (c)/(c2) confirm zero false positives on legitimate test-count reporting. It is the honest answer to the load-bearing question: **the heuristic now catches the last defect, not the next one.**

Exposure: 4 of 4 plausible next-phrasing shapes tested were missed, including the 2 already live in the tree at HEAD; basis: measured. Reach: instrument/operator.

**Verdict: BREAKS (MED).** Proof-test required: `qa15: a bare "identifier=N" instrument-output figure in a DEFAULT_FILES member is flagged unless struck or marker-backed` — the shape the project actually writes now, zero overlap with the 112 legitimate N/M test counts, and it would have caught finding 1 automatically.

## 4. [ISSUE][LOW][demonstrated] `--field=continuation-residual` is registered as a callable instrument but breaks the "last integer in stdout" contract the marker mechanism depends on

`KNOWN_INSTRUMENTS` gained `qa14-continuation-residual-probe-residual` (`completeness-claim-checker.ts:66-67`). The checker resolves a marker's actual value with `lastInteger(res.stdout)` (`completeness-claim-checker.ts:159-163, 176`). The residual field prints detail lines *after* its summary:

```
[QA-14 continuation-residual-probe] PASS: continuation-residual=5
  - continuation-marked=281
  - distinct issue numbers queried=121

all ints: [ '14', '5', '281', '121' ]  -> lastInteger = 121
```

A future `[[completeness: cmd="qa14-continuation-residual-probe-residual" expect=5]]` marker would compare **121** (the gh-call count) against 5. The three `marker-corpus-probe --field` entries and `--field=continuation-marked` all satisfy the contract (lastInteger -> 281, verified). The architecture council's design sketch step 2 explicitly asked for "the same last-integer-in-stdout, nothing-else discipline".

Exposure: 0 consumers today (measured — no marker references either new instrument, finding 8); 100% of any future marker wired to this field. Fails loud if wired, so silence is low — hence LOW, not MED. Fix: move the two detail lines behind the non-field summary mode, as `--field=continuation-marked` already does.

---

# What genuinely landed — clean findings

## 5. [CLEAN][demonstrated] `markedVia` is a genuinely pure additive change — 3,695 citations, zero behavioral differences

A/B of the shipped classifier at `a26e55a` (temporary worktree) against `f966a7b`, over the identical current corpus, comparing every emitted `Citation` field-by-field with `markedVia` stripped:

```
A/B over 228 files, 3695 citations compared (markedVia stripped): differences=0
```

No verdict, kind, reason, ordering or count changed for any already-classified citation. The "pure additive" claim is true, demonstrated rather than asserted.

## 6. [CLEAN][demonstrated] `markedVia` plumbs end-to-end, including through `resolveIssueCitations`'s two-pass wiring

`resolveIssueCitations` (`reference-resolver.ts:674-683`) builds its result by re-running `scanReferences` in pass 2, so `markedVia` survives to the consumer — not a type declaration with no reader. Proven end-to-end: my independent enumeration (the 5 continuation-marked citations failing real existence, listed in finding 1) matches the gh-backed instrument's `continuation-residual=5` exactly, via a different code path. The 13 `kind: "issue"` citations carrying no `markedVia` are all cross-repo `owner/repo#N` shapes, exactly as the field's own doc comment states (enumerated mechanically, not eyeballed).

## 7. [CLEAN][code-traced] The numerator genuinely REUSES `resolveIssueCitations` — no second bespoke gh path (the council's explicit condition)

`computeContinuationResidual` (`continuation-residual-probe.ts:125-150`) calls `resolveIssueCitations(fileTexts, baseDeps, repoSlug, runner, maxDistinctIssues)` and filters its output. The file contains no `child_process` import, no gh invocation and no second cache — the only `Runner` is `realRunner`, passed *into* the shared function. The cap propagates unchanged (`capExceeded` -> exit 1, fail-loud). Pinned by a real test: "(numerator): REUSES resolveIssueCitations's own QA14_MAX_ISSUES cap — zero gh calls once exceeded". `resolveIssueCitations` itself is byte-identical: `git diff a26e55a f966a7b -- src/qa/reference-resolver.ts` touches only the `Citation` type, `classifyBareHashMatch`'s return values, `scanReferences`'s two record sites, and comments.

## 8. [CLEAN][demonstrated] Registered, callable, and genuinely non-blocking

Both fields run and exit 0 (outputs in findings 1 and 4). A tree-wide enumeration of live completeness markers shows none binds either new instrument — the only live numeric marker remains `qa-mutation-shell expect=53`; the remaining hits are doc-template placeholders and test fixtures.

## 9. [CLEAN][code-traced] Fail-closed without gh credentials — the numerator inflates, it never silently zeroes

`verifyLocalIssue` (`reference-resolver.ts:259-268`) maps `issueExists(n) === null` to `unresolved-authority` ("cannot verify — fails closed"). A credential-less or rate-limited run therefore reports a residual approaching the full denominator (an obviously-wrong large number), never a false `continuation-residual=0`. The hostile case I went looking for — an operator without gh writing "residual is zero" into prose — does not exist.

## 10. [CLEAN][demonstrated] The mechanical sweep's named locations are genuinely corrected, struck through, not deleted — and my own fresh whole-tree grep finds no further live instance

```
grep -rnoE "[0-9]+/[0-9]+ (real )?occurrences|[0-9]+ distinct blocking|10/400|0/316|6/427|23/270|marked=[0-9]+ unmarked=[0-9]+" \
  --include="*.md" --include="*.ts" --include="*.json" --include="*.mjs" --include="*.yml" . \
  | grep -v node_modules | grep -v "^./docs/reviews/" | grep -v "^./docs/decisions.md"
```

Every `10/400`-shaped hit in `CHANGELOG.md` (15, 35, 46, 62) and `docs/STATE.md` (12, 34, 47) is either inside a struck span with a dated "CORRECTED 2026-09-11 (round-4 fix-now)" annotation, or a quoted historical reference inside such an annotation — verified by reading each line, not by counting hits. Remaining hits live in `docs/reviews/*` and `docs/REVIEW_LOG.md` (dated, point-in-time, exempt by this project's own convention), `docs/plans/*` (dated), `docs/decisions.md` (append-only), and `completeness-claim-checker.{ts,test.ts}` (the patterns and their fixtures). **The 4th-time sweep of the OLD figure is real.** It is finding 1's NEW figure that recurs, not this one.

## 11. [CLEAN][demonstrated] Issue #159's fix works within its own scope, with zero false positives on the real corpus

QA-15 PASS at HEAD (no new false positives on the live 112-hit N/M corpus); 3 of 3 constructed stale N/M claims caught; 2 of 2 legitimate test-count shapes correctly ignored; 2 of 2 strikethrough-smuggling attempts still caught — `stripStrikethrough` uses a non-greedy per-span replace, so a partially-struck line keeps its live half exposed. I tried to abuse it and could not. Raw table in finding 3.

## 12. [CLEAN][demonstrated] Gates are real and green at HEAD

typecheck clean, lint clean, `npm test` 755 pass / 0 fail / 0 skipped / 0 todo, QA-15 PASS. Skipped is genuinely zero, read from the raw summary, not inferred.

## 13. [CLEAN][demonstrated] The measured-cost claim holds

`distinct issue numbers queried=121` — exactly the claimed 121 gh calls, well under the 300 cap. Wall-clock 43.1s against the claimed "approx 59s"; wall-clock varies with network and the claim was not presented as an invariant. design-challenger's O3 unproven assumption is genuinely settled.

## 14. [CLEAN][code-traced] No ADR governs this surface

35-ADR catalog re-read on the security/state/concurrency/failure-mode slice; devops ADR-0008's gate stack (Gitleaks/Semgrep/Trivy/Cosign/cdk-nag/ZAP) and SE ADR-0010's ratchet surfaces (coverage thresholds, tests, lint ignores) do not reach a non-blocking QA instrument. Sixth independent confirmation, unchanged.

---

# The single scariest unproven assumption

**That building the instrument closes the class.** It does not, and this round proves it with the cleanest possible example: the instrument was built exactly as the council specified, it works, I used it to detect the drift in 43 seconds — and the very commit that shipped it re-froze its output into both permanently-rescanned files, in violation of a rule written 40 lines away in that same commit, under a gate that passed clean.

The class is not "someone typed a wrong number". The class is **an exact count, written into a file that a future commit rescans, with nothing mechanical that objects.** The council closed the *measurement* half — genuinely (findings 5 through 9). It did not close the *writing* half, because the guard it added (finding 3) is anchored to the phrasing of the last defect rather than to the shape of a frozen count. Until a mechanical check objects to the shapes `identifier=N` / `N of M` / `N out of M` living unstruck in `CHANGELOG.md`/`docs/STATE.md` without marker backing, the next round writes the next number and the gate stays green.

# Is this a new residual or the same class recurring?

**The same class, recurring — round 5 of 5.** Round 1 froze `0/316`. Round 2 froze `10/400`. Round 3 fabricated `434/455/889`. Round 4 missed 2 of 3 locations. Round 5 (this build) struck all the old figures correctly *and froze `273/3`*, a number describing no committed tree. Findings 2 and 4 are new, different residuals and would be normal/acceptable on their own. Finding 1 is not.

# Go / no-go

**no-go — and per `docs/decisions.md` row 70's own pre-commitment ("a second stall on this same shape after this round would be an automatic hard stop, not a round 5"), this routes to the human as a decision, not to story-implementer as round 6.**

Stated fairly, because the human is the one deciding: this build is genuinely the best of the five. All four ratified items landed; three landed cleanly and completely (findings 5 through 11). The remaining defect is **two strikethrough edits and one regex** — smaller than any prior round's. A reasonable human ruling is "strike the two lines, add the identifier=N pattern, ship, and stop reviewing this file". What I cannot do is call it clean: the drift class produced a live instance in the shipping commit, under a passing gate, which is precisely the tripwire the council pre-committed to escalating on.

**Single next action:** human ruling on `docs/decisions.md` row 70's hard-stop clause. If the ruling is "correct and ship", the minimal correct correction is: strike `CHANGELOG.md:70`/`:76` and `docs/STATE.md:11`'s frozen figures (pointing at the command instead, per the probe's own header rule), add the instrument-output-shaped pattern to `BARE_CLAIM_PHRASES` so finding 1 cannot recur silently, and either fix or delete `continuation-residual-probe.ts`'s positional ref argument.

# Open findings -> failing tests

| Finding | Named failing test | Executable? |
|---|---|---|
| 1 | `qa15: no non-struck "identifier=N" instrument-output figure survives in CHANGELOG.md/docs/STATE.md` | Yes |
| 2 | `continuation-residual-probe: a non-HEAD ref reads that ref's CONTENT, not the working tree's` | Yes |
| 3 | same test as finding 1 (finding 1 is the live instance; finding 3 is the gap that let it through) | Yes |
| 4 | `continuation-residual-probe: --field=continuation-residual emits ONLY that number (lastInteger === residual)` | Yes |

Open findings = 4; distinct failing tests = 3 — findings 1 and 3 share one test, since the same mechanical guard closes both. Stated, not hidden.

# Editorial (verdict-neutral, no re-review)

- `CHANGELOG.md:70` says "on this repo's current full tree" — "current" is a forward-reading word on a point-in-time measurement; the file's own round-3 convention is to date such figures or omit them.
- `docs/STATE.md:11` says "at this round's own tree state", but the figure was measured against the pre-commit working tree, not the round's commit. The qualifier is present but not true.
- `docs/decisions.md` row 71's cross-check sentence ("continuation-residual=3 exactly matches 3 [unresolved-authority] #000 lines") describes a coincidence, not an invariant: the gate's `#000`/`#9999` detail lines include directly-marked citations too (4 plus 4 at HEAD, against residual 5). Append-only, so noted here for the record rather than actioned.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Round-4's own close-out froze `continuation-marked=273 continuation-residual=3` non-struck into CHANGELOG.md:70/:76 and docs/STATE.md:11; the live instrument at that same clean commit reports 281/5, and 273 reproduces at NO committed tree state (true a26e55a=271, true HEAD=281) — a live recurrence of the drift class, caused by the round's own review reports landing in the corpus, under a QA-15 that PASSes clean, violating the rule written 40 lines away in the same commit (continuation-residual-probe.ts:46-48).
2. [ISSUE][MED][demonstrated] The ref/working-tree content-mismatch bug the council rejected Candidate B over is reproduced verbatim in the new instrument (continuation-residual-probe.ts:155-168 plus the positional ref at :175): probe@a26e55a=273 against true a26e55a=271 — the same defect now in two instruments instead of one, and the mechanism that produced finding 1's number. 100% of non-default-ref invocations; 0 CI consumers today.
3. [ISSUE][MED][demonstrated] Issue #159's two patterns are anchored to the LAST defect's phrasing, not to the shape of a frozen count: 4 of 4 plausible next phrasings missed by findBareClaims, including the 2 figures live in the tree right now; 3 of 3 historical-shape claims correctly caught and 2 of 2 legitimate test counts correctly ignored — the class is narrowed, not closed.
4. [ISSUE][LOW][demonstrated] `qa14-continuation-residual-probe-residual` is in KNOWN_INSTRUMENTS but its stdout's last integer is 121 (the gh-call count), not 5 — a future marker wired to it would assert the wrong quantity; breaks the "last integer in stdout, nothing else" discipline the council's own design sketch step 2 named. 0 consumers today, fails loud if wired.
5. [CLEAN][demonstrated] markedVia is genuinely pure-additive: A/B of the a26e55a and f966a7b classifiers over 228 files / 3695 citations, every field compared with markedVia stripped -> differences=0.
6. [CLEAN][demonstrated] markedVia plumbs end-to-end through resolveIssueCitations's pass-2 re-scan — my independent enumeration of the 5 continuation-marked residual citations matches the gh-backed instrument's continuation-residual=5 via a different code path; the 13 markedVia-less issue citations are all cross-repo shapes, exactly as documented.
7. [CLEAN][code-traced] The numerator genuinely REUSES resolveIssueCitations (the council's explicit condition): no child_process, no gh spawn, no second cache in the new file; cap propagates and fails loud; pinned by a real cap-reuse test; resolveIssueCitations itself byte-unchanged.
8. [CLEAN][demonstrated] Registered, callable and genuinely non-blocking — both fields run exit 0, and a tree-wide marker enumeration shows no completeness marker binds either new instrument (qa-mutation-shell expect=53 remains the only live numeric marker).
9. [CLEAN][code-traced] Fail-closed without gh credentials: verifyLocalIssue's null -> unresolved-authority makes a credential-less run inflate the residual toward the denominator, never silently report 0.
10. [CLEAN][demonstrated] The mechanical sweep of the OLD figure is real this 4th time: every 10/400-shaped hit in CHANGELOG.md/docs/STATE.md is struck through with a dated CORRECTED annotation or quoted inside one; my own fresh whole-tree grep finds no further live instance outside dated/append-only files.
11. [CLEAN][demonstrated] Issue #159's fix works within its scope with zero false positives: QA-15 PASS on the real 112-hit corpus, 3/3 constructed stale N/M claims caught, 2/2 legitimate test counts ignored, 2/2 strikethrough-smuggling attempts still caught.
12. [CLEAN][demonstrated] Gates real and green at f966a7b: typecheck clean, lint clean, npm test 755 pass / 0 fail / 0 skipped / 0 todo, QA-15 PASS exit 0.
13. [CLEAN][demonstrated] The cost claim holds: distinct issue numbers queried=121 exactly as claimed, 43.1s wall-clock (against "approx 59s", network-variable), well under the 300-call cap — design-challenger's O3 genuinely settled.
14. [CLEAN][code-traced] No ADR governs this surface — 35-ADR catalog re-read on the security/state/failure-mode slice; ADR-0008's gate stack and ADR-0010's ratchet surfaces do not reach a non-blocking QA instrument.
counts (CHECKSUM): issues=4 suspicions=0 clean=10
evidence (CHECKSUM): demonstrated=11 code-traced=3 derived=0
checks=npm run typecheck clean exit 0; npm run lint clean exit 0; npm test tests 755 pass 755 fail 0 skipped 0 todo 0; node src/qa/completeness-claim-checker.ts PASS 2 files exit 0; continuation-residual-probe --field=continuation-marked -> 281 (0.26s); --field=continuation-residual -> 5, continuation-marked=281, distinct gh queries=121 (43.1s); --field=continuation-marked a26e55a -> 273 against true-content 271; node src/qa/reference-resolver.ts 0000..0 HEAD -> FAIL 296 of 3695 exit 1; A/B classifier a26e55a-vs-HEAD over 228 files / 3695 citations -> 0 differences; independent residual enumeration -> 5 citations, matching; findBareClaims over 12 constructed strings -> 5 caught / 7 missed as tabulated; whole-tree stale-figure grep; git status clean and sha256 unchanged before/after
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-round5-2026-09-11.md
