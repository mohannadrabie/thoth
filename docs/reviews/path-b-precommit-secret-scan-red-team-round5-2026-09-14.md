# Red Team (Sutekh) — path-b-precommit-secret-scan, round 5 (targeted re-confirm of the F1/F2/F3 fix)

- **Date:** 2026-09-14
- **Tier:** CRITICAL
- **HEAD:** `1378b8bb9d35edceaef2fd5d8882334c6aebb3a8` (branch `feat/path-b-precommit-secret-scan`)
- **Primary target:** the new derived/baselined guard region in `src/secret-scan/history-scan.test.ts:204-401` added by `1378b8b`
- **Verdict:** `go` (the fix holds; three MED residuals, all strictly narrower than round-4's, two LOW)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **Scope note:** a targeted re-confirm of the fix-now that closed round-4's F1/F2/F3, not a fresh sweep of the whole story.

> **Literal discipline (this report is itself in scope).** `docs/reviews/*` carries no allowlist grant for this file, so every attack literal below is described, never reproduced — including the fixture literals named in the code under review, which are referred to by position, never quoted. Each attack literal was generated at runtime inside a throwaway clone as an AWS-key-shaped 20-char value (a 4-char prefix + 16 uppercase alphanumerics) derived from a seed string, written only to a scratch file outside the repo, and deleted with the clone.

---

## 0. Sanity gates (real repo, HEAD 1378b8b, working tree clean)

```
$ npm run typecheck        -> tsc --noEmit -p tsconfig.json   exit=0 (no output)
$ npm run lint             -> eslint .                        exit=0 (no output)
$ npm test
i tests 833
i suites 0
i pass 833
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 36374.6963

$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1172 allowlisted).
history-scan exit=0

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit=0

$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.  exit=0

$ git status --porcelain   -> (empty)
$ git diff origin/master -- .github/workflows/ci.yml | wc -c
0
```

**833 pass / 0 fail / 0 skipped**, up 4 from round-4's 829. `ci.yml` diff vs `origin/master` is empty (0 bytes). Real repo untouched by this review: HEAD still `1378b8b`, working tree clean after every attack (all attacks ran in a `git clone --no-hardlinks` throwaway, deleted at the end).

## 0.1 ADR slice read (attack surface: security, CI gates, testing, suppression lists)

- **SE ADR-0005 (testing)** — `MUST NOT delete or weaken a failing test to make CI pass`. Satisfied: no test weakened; the guard was strengthened and mutation-verified (F6).
- **SE ADR-0010 (quality gates)** — `MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists`. Satisfied at HEAD.
- **DevOps ADR-0008 (CI/CD gates and policy-as-code)** — `MUST NOT suppress a ... finding without an inline justification comment AND a human-approved, time-bound exception`; `MUST NOT ... broaden suppression/ignore lists (ratchet only)`. **This is the ADR the new `REVIEWED_BASELINE` map sits under** — it is a suppression list. See F1: 7 of its 8 keys carry no per-entry justification and nothing mechanically requires one. Flagged, not claimed a hard violation: the map carries a block-level comment, and no accepted ADR names this specific file.

---

## 1. Re-confirming round-4's three live attacks against this HEAD (independently reproduced)

All three re-run in a fresh `git clone --no-hardlinks` of HEAD `1378b8b`, each from a clean `git reset --hard` + `git clean -fd`. At round-4's HEAD all three committed clean through every gate; at this HEAD **all three are caught**, by the same test, with a precise assertion message.

**Attack A — new `CHANGELOG.md` credential grant + a live literal in `CHANGELOG.md`** (round-4 F1's shape):

```
--- staged: CHANGELOG.md, docs/qa/secret-scan-allowlist.json
hook exit=0            (pre-commit-scan.ts PASS -- the real scanner still exempts it, as designed)
history-scan exit=0    (same)
i tests 20  i pass 19  i fail 1  i skipped 0

FAIL OSS-01 allowlist (GitHub Issue #199 reopened + Issue #200, red-team round-4 [MED]x2, regression): ...
  AssertionError [ERR_ASSERTION]: every still-mutable credential-granted file must carry no live
  match beyond its pinned, already-reviewed baseline (GitHub Issue #199/#200):
  CHANGELOG.md (aws-access-key-id): 1 unreviewed occurrence(s) beyond its pinned baseline
```

**Attack B — a NEW `docs/decisions.md` row carrying a live literal, zero allowlist changes** (round-4 F2 / Attack C's shape):

```
hook exit=0
i tests 20  i pass 19  i fail 1  i skipped 0
  AssertionError: ... docs/decisions.md (aws-access-key-id): 1 unreviewed occurrence(s) beyond its pinned baseline
```

**Attack C — a trailing comment literal in the already-granted `src/secret-scan/patterns.test.ts`, zero setup** (round-4 F2 / Attack D's shape — the sharpest, since it needed no allowlist entry at all):

```
hook exit=0
i tests 20  i pass 19  i fail 1  i skipped 0
  AssertionError: ... src/secret-scan/patterns.test.ts (aws-access-key-id): 1 unreviewed occurrence(s) beyond its pinned baseline
```

The build receipt's claim is confirmed, independently. Honest boundary: the *scanner* (hook + CI full-history scan) still passes all three — the guard test is the only thing catching them, exactly as round-4's F4 established and round-4's F6 scoped (CI-only, `ci.yml:194 npm test`; `.githooks/pre-commit` runs `pre-commit-scan.ts` and nothing else, unchanged).

---

## Findings, ranked by blast radius

### F1 — [ISSUE][MED][demonstrated + code-traced] REVIEWED_BASELINE is a suppression surface with *weaker* controls than the allowlist it backstops: a bare 64-hex entry needs no reason, and grant + literal + self-computed hash in one commit passes every gate

**Assumption broken:** that moving the exemption decision from the allowlist into a hashed baseline makes it harder to grant yourself an exemption. It is, mechanically, **easier**.

**Attack D, run live in a throwaway clone of HEAD.** Staged, in ONE commit: (a) a new `{path: "CHANGELOG.md", patternId: "aws-access-key-id", reason: "..."}` allowlist grant, (b) a live AWS-key-shaped literal in `CHANGELOG.md`, (c) a `"CHANGELOG.md::aws-access-key-id": ["<sha256 of that literal>"]` line inserted into `REVIEWED_BASELINE`:

```
--- staged:
CHANGELOG.md
docs/qa/secret-scan-allowlist.json
src/secret-scan/history-scan.test.ts

hook exit=0
history-scan exit=0
i tests 20  i pass 20  i fail 0  i skipped 0
```

Clean, with a live credential literal in the tree.

**Code trace — the asymmetry.** `src/secret-scan/history-scan.ts:143-157` makes the allowlist's `reason` a *mechanically enforced* field: `loadAllowlist` rejects an entry whose `reason` is missing or whitespace-only, with its own regression test at `history-scan.test.ts:86-110`. `REVIEWED_BASELINE` (`history-scan.test.ts:297-312`) has no equivalent: 7 of its 8 keys are bare opaque hex arrays with no per-entry justification (only the mutation-fixture entry at `:303-305` carries one). The map-level comment at `:290-296` says "Bump an entry only alongside a real review" — documentation, not enforcement, the exact wording this repo already burned on once (`history-scan.ts:143-145`: "documentation, not enforcement").

**ADR hook.** DevOps ADR-0008: MUST NOT suppress a finding without an inline justification comment AND a human-approved, time-bound exception in the PR; MUST NOT broaden suppression/ignore lists (ratchet only). A baseline bump is a suppression-list broadening with no per-entry justification required.

**Current defense, honestly assessed — and this matters for the verdict.** This is **not** the old hole with extra ceremony, and the round-4 comparison is not close:

| path | round-4 HEAD (`e785f39`) | this HEAD (`1378b8b`) |
|---|---|---|
| careless paste into an already-granted mutable file | **0 deliberate actions** — committed clean | **caught** (Attacks B, C) |
| careless paste into a newly-granted file | 1 action (add the grant) | **caught** (Attack A) |
| deliberate exemption | 1 action (add the grant) | 3 actions, one requiring an out-of-band sha256 computation, landing an opaque hex diff line in a security test file |

The **accidental** leak class — the one every prior recurrence in this story (#193 -> #199 -> #200) actually was — is now fully closed. The **deliberate** class is not, and no allowlist/suppression design closes it; gitleaks fingerprints, semgrep ignore files, and inline lint-disable comments all share this property and all rest on code review. That is a disclosed, standard residual, not a new self-referential hole.

**BREAKS**, narrowly and specifically: the missing per-entry `reason` on the new suppression surface, which the adjacent allowlist already enforces and this repo already litigated once.

**Named proof-test required (shared with F2):** `OSS-01 baseline integrity: REVIEWED_BASELINE's key set equals deriveMutableCredentialGrants(the real allowlist) exactly, and every baseline entry carries a non-empty per-hash reason`. About 6 lines; changes the baseline value shape from a hash array to a hash+reason array.

**Exposure: ~0% of runs today (0 unjustified bumps have occurred); the surface is 8 baseline keys, 7 of which carry no reason; basis: counted-in-code** (instrument output in F7). Security-class, exempt from PRINCIPLES rule 21's cap. Ranked first because it governs every future exemption on this branch.

---

### F2 — [ISSUE][MED][demonstrated] Surviving mutation: widening IMMUTABLE_REPORT_PREFIX by one token silently drops docs/STATE.md and docs/decisions.md from the checked set, and all tests stay green

**Assumption broken:** that the new positive-control tests pin the *derivation*. They pin that it is derived; nothing pins **what it derives to**.

**Mutation M3, run live in a clone of HEAD.** Changed `history-scan.test.ts:252` from `const IMMUTABLE_REPORT_PREFIX = "docs/reviews/";` to `"docs/"`, then re-planted Attack B (the new `docs/decisions.md` row with a live literal):

```
hook exit=0
i tests 20  i pass 20  i fail 0  i skipped 0

(checked-set size, measured against the real allowlist)
docs/reviews/ -> checked set size 8
docs/         -> checked set size 6
```

Attack B, red two sections above, passes clean again. The whole `docs/` tree leaves the guard. The positive-control test at `:338-348` does not catch this: its fake allowlist's only expected survivor is `CHANGELOG.md`, which is outside `docs/` either way, so the assertion holds under both prefixes.

**Current defense, honestly assessed:** none. M1 (derivation reverted to a hardcoded docs/STATE.md list -> 1 fail) and M2 (unreviewedOccurrenceCount neutered to return 0 -> 2 fails) both die correctly (F6) — the logic is load-bearing. It is the *membership* that is unpinned. This repo already solved exactly this, one directory over: `src/qa/completeness-claim-checker.ts:304-307` exports `DEFAULT_FILES` **specifically** so a regression test can pin its membership (Issue #142: "a hand-typed prose claim about what this array contains is exactly the kind of unverified completeness assertion this same instrument exists to catch; the array itself needs the same discipline"). The same discipline was not applied to the new guard's own exclusion set.

**BREAKS.** Production trigger: the next round that needs a grant on a doc outside `docs/reviews/` (this branch added 6 credential grants in 6 days, 4 of them on docs) and "fixes" it by generalizing the prefix — a one-word diff with a green suite behind it.

**Named proof-test required:** the same test as F1's — asserting key-set equality also kills M3, because under `"docs/"` the derived set is 6 while the baseline has 8 keys.

**Exposure: 2 of 8 checked grants (25%) leave the guard on a one-token edit, and they are the two narrative files this story's recurrences have all landed on; basis: counted-in-code** (instrument output above). Security-class, exempt from rule 21's cap.

---

### F3 — [ISSUE][MED][demonstrated + code-traced] The docs/reviews/* exclusion's stated justification is contradicted by the rule it cites: PRINCIPLES rule 11 explicitly permits an addendum appended to a persisted report, so its bytes are not content-bounded

**Assumption broken:** `history-scan.test.ts:225-228` — "a file under `docs/reviews/`, because PRINCIPLES rule 11 makes a persisted, dated report immutable by construction -- its bytes are content-bounded for the file's whole life, not just until the next edit."

PRINCIPLES rule 11, verbatim (`docs/PRINCIPLES.md:16`): "A persisted report is not edited after the fact — a finding that is later verified, disputed, or overtaken gets an **addendum** (or a follow-up dated report); the original evidence stays verbatim." An addendum appended to the same file is the rule's **first** listed option. The bytes are therefore explicitly *not* bounded — the rule forbids rewriting history, not appending to it. That is the same distinction round-4's F2 already drew for `docs/decisions.md` ("append-only constrains editing old rows, not writing new ones"), applied to the one category this fix carved out on the opposite assumption.

Two further failures of the immutability premise, both verified:

- **No mechanical enforcement anywhere.** A grep for the `docs/reviews/` path literal across `src/`, `.github/`, `hooks/` (*.ts, *.mjs, *.yml) returns only comment/citation references and QA-14 reference-resolver fixtures — no hook, CI step, or test pins a report's content. No `.github/CODEOWNERS` exists.
- **This very story rewrote its own git history** in round-4 (Issue #197, a rewrite of already-pushed commits). "Immutable by convention" was already falsified once on this branch, days ago.

**Attack E, run live in a clone of HEAD.** A NEW report file under `docs/reviews/` containing a live AWS-key-shaped literal, plus its own whole-file grant, with **no** baseline entry:

```
hook exit=0
history-scan exit=0
i tests 20  i pass 20  i fail 0  i skipped 0
```

Clean through every layer. The threat the exclusion does not address is not "the file changes later" — it is **what the file contains when it is first written**, and a new report is written every round by an agent quoting scan evidence.

**Current defense, honestly assessed:** none, by explicit design — and this is the *one* exclusion, named in code, down from round-4's four unbounded categories. Round-4's own F2 table classified `docs/reviews/*` as the only genuinely safe category; this round attacked that classification and it does not hold. It is not a regression: these six grants were equally unguarded at round-4's HEAD.

**BREAKS.** **Named proof-test required:** `OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline at grant time like every other file, not excluded` — delete `IMMUTABLE_REPORT_PREFIX` and pin the 6 existing report grants' literals into `REVIEWED_BASELINE`. The mechanism already handles this shape correctly; only the carve-out prevents it.

**Exposure: 6 of 15 credential grants (40%) sit on docs/reviews/* and are exempt from the new guard entirely; 4 of those 6 were added in the 6 days of this branch — the fastest-growing grant category is the excluded one; basis: counted-in-code** (allowlist enumerated by instrument). Security-class, exempt from rule 21's cap. Related to open Issue #136 (the general "grants suppress future secrets forever" class), not a duplicate: #136 is about the scanner's allowlist semantics; this is about the new guard's exclusion set.

---

### F4 — [ISSUE][LOW][demonstrated] The round-4 F3 closure is partial: the QA-15 self-check is a **vacuous** pass today, catches digit-bearing claims, and misses the word-form claim the guard comment currently contains

**Assumption broken:** "F3 ... closed structurally: this test file's own text runs through QA-15's completeness-claim-checker on every npm test" (commit message).

The wiring is real and load-bearing for the shape it covers, but its current result is vacuous:

```
$ checkCompleteness(readFile("src/secret-scan/history-scan.test.ts"), realRunner)
{ "ok": true, "vacuous": true, "summary": "0 numeric completeness claims found - vacuous pass.", "details": [] }
```

The test at `history-scan.test.ts:394-401` asserts `result.ok === true`, and `ok` is `true` for a vacuous pass. Two mutations, live in a clone:

```
M4 - inject a digit-bearing claim ("all 12 files across 4 exclusion categories") into the comment:
i tests 20  i pass 19  i fail 1
  AssertionError: this file's own text failed QA-15: 1 of 1 numeric completeness claim(s) failed.

M5 - inject a WORD-FORM claim ("every mutable credential-granted file in this repo is covered;
     nothing else qualifies"):
i tests 20  i pass 20  i fail 0
```

M4 proves the wiring is genuine, not decorative. M5 shows the gap — and the gap is not hypothetical: `history-scan.test.ts:225-231` currently reads "Exactly ONE named, in-code exclusion ... Nothing else qualifies", which is precisely a hand-typed exhaustive-enumeration claim, in word form, invisible to this check. This is not a defect in `completeness-claim-checker.ts`, whose header documents its phrase list as "heuristic only ... not claimed exhaustive"; it is the closure claim that overstates.

**BREAKS** as a claim of structural closure. **LOW** — no exploitable path; net improvement over round-4, where the file was not checked at all. **Exposure: 1 file, ~0% of runs; basis: counted-in-code.** Resolves to a residual-register line plus a reword, not a new test.

---

### F5 — [ISSUE][LOW][code-traced] The named-reviewer rule that gives the baseline its security value points at directories that do not exist

`CLAUDE.md` "Sensitive areas" names, for secret scanning: `.github/workflows/ci.yml`, `.gitleaks.toml`, `.gitleaksignore`, `scripts/secret-scan/*`; and for the guard engine `scripts/guard/*`, `src/policy/guard/*`.

```
$ ls scripts/                       -> No such file or directory
$ ls .gitleaks.toml .gitleaksignore -> No such file or directory (both)
$ ls .github/CODEOWNERS             -> No such file or directory
```

The real secret-scan code — and now `REVIEWED_BASELINE`, whose entire security value is "a bump is a reviewed code change" (F1) — lives at `src/secret-scan/`, matched by none of those globs. The rule is inert as written. This repo has burned on this exact glob once already: closed Issue #23, "CI: OSS-01 full-history-scan step references scripts/secret-scan/history-scan.mjs which does not exist" — the CI reference was fixed, the `CLAUDE.md` rule was not.

**Current defense, honestly assessed:** real, but not mechanical — this project's review ceremony is Manager-orchestrated by reading the diff, which is why this very round exists. The risk is a *future standalone* baseline bump on a non-CRITICAL story routing to no named reviewer.

**BREAKS** (an inert rule), **LOW**. **Exposure: 1 rule, 0 runs affected today; basis: counted-in-code.** Fix is a one-line `CLAUDE.md` path correction — no executable form in this repo, so it resolves to a residual-register line.

---

### F6 — [CLEAN][demonstrated] The derivation and baseline logic are genuinely load-bearing — two targeted mutations, each killing the intended test(s)

```
M1 - deriveMutableCredentialGrants() short-circuited to a hardcoded [docs/STATE.md] list
     (i.e. reverted to round-4's defect shape):
     i tests 20  i pass 19  i fail 1
     FAIL "...deriveMutableCredentialGrants includes ANY new file's credential grant -- proving the
           checked set is genuinely derived, not a hardcoded list scoped to docs/STATE.md alone"

M2 - unreviewedOccurrenceCount() neutered to return 0:
     i tests 20  i pass 18  i fail 2
     (the brand-new-grant proof at :350 and the beyond-baseline proof at :367 both die)
```

Neither test is green-by-construction. The F1-class and F2-class proofs each have a real mutation that kills them. SURVIVES.

---

### F7 — [CLEAN][demonstrated] docs/decisions.md is handled correctly under the new model: not re-excluded, non-vacuously checked, and this round's own new row passes clean

Instrument run against the real repo at HEAD (derives the grant set from the real allowlist, cross-checks it against `REVIEWED_BASELINE`'s keys, and re-hashes every live occurrence per file):

```
derived grants: 8 | baseline keys: 8
derived NOT in baseline: []
baseline NOT in derived (stale key): []
src/secret-scan/history-scan.test.ts::aws-access-key-id     | live:11 distinct:3 baseline:3 staleHashes:0
src/secret-scan/patterns.test.ts::aws-access-key-id         | live:1  distinct:1 baseline:1 staleHashes:0
src/secret-scan/patterns.test.ts::github-pat                | live:1  distinct:1 baseline:1 staleHashes:0
src/secret-scan/patterns.test.ts::github-fine-grained-pat   | live:1  distinct:1 baseline:1 staleHashes:0
src/secret-scan/simulated-commit.test.ts::aws-access-key-id | live:12 distinct:1 baseline:1 staleHashes:0
src/secret-scan/pre-commit-scan.test.ts::aws-access-key-id  | live:1  distinct:1 baseline:1 staleHashes:0
docs/STATE.md::aws-access-key-id                            | live:0  distinct:0 baseline:0 staleHashes:0
docs/decisions.md::aws-access-key-id                        | live:2  distinct:1 baseline:1 staleHashes:0
```

Four things this settles, all measured rather than asserted:

- **No blanket filename exclusion for `docs/decisions.md`** — it is in the derived set, and Attack B turns it red. The round-4 fix instruction was followed.
- **The check is non-vacuous for it**: the file really does carry 2 live credential-shaped occurrences (1 distinct), all covered by its single pinned hash. This round's own new `docs/decisions.md` row passes because its literal is the already-reviewed one, not because the file is skipped.
- **`docs/STATE.md` keeps its zero-tolerance empty baseline** (0 live occurrences, 0 baseline entries) — the round-3 property is preserved, not softened by the new mechanism.
- **Zero drift in either direction**: no grant lacks a baseline key, no baseline key lacks a grant, no baseline hash is stale. The map is accurate at HEAD. That it is *currently* exact is what makes F1/F2's proposed key-set assertion a free, immediately-green ratchet.

SURVIVES.

---

### F8 — [CLEAN][code-traced] The guard fails closed on the malformed/adversarial allowlist shapes worth trying; no path-shape bypass of the exclusion

- A grant naming a **nonexistent path** makes `readFile(path)` (`:325`) throw -> the test errors -> red. Fail-closed, if cryptically.
- A **malformed allowlist** makes `JSON.parse` (`:319`) throw -> red. Fail-closed.
- A **path-traversal-shaped** grant (a `docs/reviews/../../` prefix) does skip the guard via `startsWith`, but buys nothing: `partitionAllowlisted` matches the scanner's allowlist by **exact** path+patternId string (`history-scan.test.ts:35-46`), and git never reports such a path, so the real scanner still blocks the literal. No net bypass.
- A leading-`./` or differently-cased `docs/reviews/` path *fails* the `startsWith` check and lands **in** the checked set — strictly stricter, not weaker.
- The guard reads the allowlist with raw `JSON.parse`, not `loadAllowlist`, so reason-less entries the scanner rejects are still *checked* here — again stricter.
- `liveMatchValues` (`:279-282`) builds a fresh `RegExp` per call from the pattern's own source/flags; all `SECRET_PATTERNS` carry the global flag, which `matchAll` requires, so no `lastIndex` carryover and no silent skip. A hypothetical non-global pattern would throw, i.e. fail closed.

SURVIVES.

---

## Findings to failing tests

Open findings: **5**. Named failing tests: **2**. The gap is explained, not hand-waved:

| test | covers |
|---|---|
| `OSS-01 baseline integrity: REVIEWED_BASELINE's key set equals deriveMutableCredentialGrants(the real allowlist) exactly, and every baseline entry carries a non-empty per-hash reason` | F1, F2 |
| `OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline at grant time like every other file, not excluded` | F3 |
| *(no executable form)* | F4 — a comment reword, verified by the already-proven M4-sensitive QA-15 test staying green; residual-register line |
| *(no executable form)* | F5 — a `CLAUDE.md` path correction; residual-register line |

## Praise where it is due

The `unreviewedOccurrenceCount` shape is the right answer to round-4's F2, and hashing rather than storing the literals is the correct instinct — it keeps this file from becoming the next place a secret-shaped string is reproduced, which is exactly what Issue #193 was. The two fixture-backed mutation proofs at `:350` and `:367` both die under real mutations (F6). And the derived-set design genuinely closes the accidental-leak class that recurred three times on this story.

## Scariest unproven assumption

**That the checked set will still contain what it contains today.** The mechanism is correct; its *membership* is pinned by nothing. One token — `"docs/reviews/"` to `"docs/"` — removes the two files every recurrence in this story (#193 -> #199 -> #200) actually landed on, and the suite stays green at 833/833 (F2, demonstrated). Everything else in this fix is checked by an instrument; the one input that decides what the instrument looks at is not.

## Go / no-go

**go.** No `[HIGH]`. The three round-4 attacks are independently confirmed caught; the logic is mutation-verified load-bearing; `docs/decisions.md` is handled correctly and non-vacuously; sanity gates and `ci.yml` are clean. All three MED residuals are strictly narrower than the round-4 findings they replace (unguarded mutable credential-granted files: 5 -> 0), and none is a regression this diff introduced. PRINCIPLES rule 16's stated default applies: build now, every open finding becomes a named failing test. A fifth REWORK on residuals narrower than the ones already accepted at MED would be exactly the cycling rule 16(d) exists to stop.

One thing must not ship silently, same as round-4: **the claim**. The commit message says F3 is "closed structurally"; it is closed for digit-bearing claims only, and the guard's own comment still carries a word-form one (F4). Record the actual scope.

## Single next action

Add the one key-set-equality-plus-reason assertion to `history-scan.test.ts` — about 6 lines, green against HEAD today (F7 measured 8 = 8, zero drift), closing F1 and F2 together.

---

## Editorial (verdict-neutral, plain edits, no re-review)

- `history-scan.test.ts:225-231` — "Exactly ONE named, in-code exclusion ... Nothing else qualifies" is a word-form completeness claim; reword to state the derivation instead of asserting the enumeration (F4's fix).
- `history-scan.test.ts:226-228` — "content-bounded for the file's whole life" misstates PRINCIPLES rule 11, which permits an appended addendum. Reword regardless of whether F3's exclusion is removed.
- `CLAUDE.md` "Sensitive areas" — `scripts/secret-scan/*`, `scripts/guard/*`, `.gitleaks.toml`, `.gitleaksignore` name paths that do not exist in this repo (F5). Point them at `src/secret-scan/*` and the real guard paths.
- `history-scan.test.ts:398` reads its own path as a hardcoded string; `import.meta.filename` would survive a rename. Fail-closed either way, so cosmetic.

---

```
RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] REVIEWED_BASELINE is a suppression list with weaker controls than the allowlist beside it -- 7 of 8 keys are bare hex with no reason (history-scan.test.ts:297-312) while loadAllowlist mechanically rejects a reason-less grant (history-scan.ts:143-157); Attack D (new grant + live literal + self-computed sha256 baseline entry, one commit) went clean: hook exit 0, history-scan exit 0, 20/20 green. Defense honestly assessed: NOT the same hole with ceremony -- the accidental path (0 deliberate actions at round-4 HEAD) is now fully closed; the deliberate path is the standard, disclosed suppression-file residual. DevOps ADR-0008 requires an inline justification per suppression. Exposure: 8 baseline keys, 7 unjustified, 0 bad bumps to date; basis: counted-in-code. Security-class (rule 21 exempt).
2. [ISSUE][MED][demonstrated] Surviving mutation M3: IMMUTABLE_REPORT_PREFIX "docs/reviews/" -> "docs/" drops docs/STATE.md + docs/decisions.md from the checked set (8 -> 6, measured), Attack B passes clean again, 20/20 green -- the positive-control test at :338 cannot see it (its fake allowlist's only survivor is outside docs/ either way). Nothing pins the derived set's membership; in-repo precedent exists and was not applied (DEFAULT_FILES exported at completeness-claim-checker.ts:304-307 for exactly this, Issue #142). Exposure: 2 of 8 checked grants (25%), and they are the two files every recurrence landed on; basis: counted-in-code. Security-class.
3. [ISSUE][MED][demonstrated + code-traced] The docs/reviews/* exclusion's justification is falsified by the rule it cites: history-scan.test.ts:225-228 claims bytes are "content-bounded for the file's whole life" per PRINCIPLES rule 11, but rule 11 (PRINCIPLES.md:16) names an appended ADDENDUM as its first option; report immutability has zero mechanical enforcement (grep over src/, .github/, hooks/: comments only; no CODEOWNERS) and this branch rewrote its own history in round-4 (#197). Attack E (new report + grant + live literal, no baseline) clean through hook, history-scan, 20/20. Not a regression -- equally unguarded at round-4 HEAD, where F2's table wrongly classified this as the one safe category. Exposure: 6 of 15 credential grants (40%) on docs/reviews/*, 4 added in 6 days -- the fastest-growing category is the excluded one; basis: counted-in-code. Security-class. Related to open #136, not a duplicate.
4. [ISSUE][LOW][demonstrated] F3's "closed structurally" overstates: checkCompleteness on this file returns {ok:true, vacuous:true, "0 numeric completeness claims found"} -- M4 (digit-bearing claim injected) correctly goes red, proving the wiring is real; M5 (word-form claim) passes 20/20, and the guard comment at :225-231 currently contains exactly that shape ("Nothing else qualifies"). Not a defect in completeness-claim-checker.ts, whose header documents its phrase list as heuristic. Exposure: 1 file, ~0% of runs; basis: counted-in-code.
5. [ISSUE][LOW][code-traced] The named-reviewer rule the baseline's security rests on is inert: CLAUDE.md's sensitive-area globs name scripts/secret-scan/*, scripts/guard/*, .gitleaks.toml, .gitleaksignore -- none exist (ls: No such file or directory, all four); the real code and REVIEWED_BASELINE live at src/secret-scan/. No CODEOWNERS. Same glob this repo already burned on in closed Issue #23. Defense: ceremony here is Manager-orchestrated by diff-read, so today's risk is 0; the gap bites a future standalone baseline bump. Exposure: 1 rule, 0 runs today; basis: counted-in-code.
6. [CLEAN][demonstrated] Round-4's three live attacks independently re-reproduced at this HEAD and ALL THREE now caught, each by the :314 test with a precise assertion (A: new CHANGELOG grant+literal; B: new docs/decisions.md row, zero allowlist change; C: patterns.test.ts trailing comment, zero setup) -- 19/20 with 1 fail each, where all three were 0-fail clean at e785f39. Build receipt's claim confirmed, not trusted.
7. [CLEAN][demonstrated] Core logic is load-bearing, not green-by-construction: M1 (derivation short-circuited to a hardcoded [docs/STATE.md] list) kills the F1 positive-control test (1 fail); M2 (unreviewedOccurrenceCount -> return 0) kills both baseline proofs (2 fails).
8. [CLEAN][demonstrated] docs/decisions.md handled correctly under the derive-and-baseline model -- in the checked set (Attack B red), NOT blanket-excluded, and non-vacuous (2 live occurrences, 1 distinct, covered by its 1 pinned hash, so this round's own new row passes on content not on a skip); docs/STATE.md keeps its empty zero-tolerance baseline; instrument shows 8 derived grants = 8 baseline keys, zero drift either direction, zero stale hashes.
9. [CLEAN][code-traced] Fails closed on the adversarial shapes worth trying: nonexistent grant path -> readFile throws -> red; malformed allowlist -> JSON.parse throws -> red; a docs/reviews/../../ traversal grant skips the guard but buys nothing (partitionAllowlisted matches exact path strings, so the real scanner still blocks); ./-prefixed or differently-cased paths land IN the set (stricter); raw JSON.parse means reason-less entries are still checked (stricter); fresh per-call RegExp, all patterns carry the global flag, no lastIndex carryover.
counts (CHECKSUM): issues=5 suspicions=0 clean=4
evidence (CHECKSUM): demonstrated=6 code-traced=3 derived=0
checks=npm test 833 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; history-scan.ts exit 0 (PASS, 0 blocking, 1172 allowlisted); completeness-claim-checker PASS (2 files); recurring-findings-registry PASS (3 classes); git status clean; ci.yml diff vs origin/master = 0 bytes; 5 live attacks (A/B/C re-confirms + D baseline-spoof + E docs/reviews) and 5 mutations (M1-M5) in a throwaway clone of 1378b8b; 1 purpose-built baseline-vs-derived audit instrument
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round5-2026-09-14.md
```
