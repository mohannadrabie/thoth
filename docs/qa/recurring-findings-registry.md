# Recurring Findings Registry

QA-13: "A finding class that has recurred shall be promoted into a lint before it can recur
again." **A class that has been found twice is a lint before the third story ships; promotion is
a required task at that ship-close, not a backlog item.**

**Build form (human-ratified, `docs/decisions.md` 2026-08-30):** a registry file plus this
documented convention, not an automated classifier that detects recurrence from review-report
prose. This repository has zero review history to detect recurrence from — an automated
classifier would have nothing to learn from and is deferred to `docs/backlog.md` for when real
review history exists.

## Convention

1. **First occurrence.** A reviewer (or the Manager) finds a defect class for the first time.
   Nothing is logged here yet — it's a normal finding in its own `docs/reviews/` report.
2. **Second occurrence.** The *same underlying class* (not the same finding restated) recurs in a
   different story or review. Whoever notices the recurrence adds a row to the table below, same
   turn, with both occurrences cited.
3. **Promotion is mandatory before the third story ships.** The row's `Status` moves from `pending
   lint` to the name of the check/lint that now catches it (a QA-14–style pipeline gate, an ESLint
   rule, a structural test — whichever fits the class), with the commit/PR that added it. A row
   stuck at `pending lint` when a third story in that area is about to ship is itself a QA-13
   violation — flag it, don't ship past it silently.
4. **Never delete a row.** A promoted class stays in the table as a record of what closed it; if
   it recurs after promotion (the lint has a gap), reopen it with a `RECURRED AFTER PROMOTION` note
   rather than starting a new row.

## Structural contract (validated by `src/qa/recurring-findings-registry.ts`)

Each entry below is a table row with exactly these columns, in order:

| Column | Required | Shape |
|---|---|---|
| Class | Y | short imperative name, e.g. "fabricated authority citation" |
| First seen | Y | `YYYY-MM-DD` + a citation (`docs/reviews/<file>.md`, `Issue #N`, or `path:line`) |
| Second seen | Y once recurred | `YYYY-MM-DD` + a citation, same shape as above |
| Status | Y | `pending lint` \| the enforcing check's name (e.g. `QA-14 reference-resolver`) |

A malformed row (missing a required column, an unparseable date, a `Status` that is neither
`pending lint` nor a non-empty check name) fails `src/qa/recurring-findings-registry.ts`'s
structural validator — the registry itself has to stay trustworthy for the convention above to
mean anything.

## Registry

| Class | First seen | Second seen | Status |
|---|---|---|---|
| silent pass on invalid/zero-SHA diff ref | 2026-08-25 GH issue 18 (original deferral explicitly predicted this exact fallback gap: "needs its own fallback handling to avoid trading this bug for a worse one") | 2026-08-30 docs/reviews/s1-protect-the-baseline-cross-domain-2026-08-30.md | QA-02 diff-fixture-check; QA-14 reference-resolver (both now fall back to a full-tree scan via resolveChangedFiles in src/lib/git.ts, with regression tests) |
| a fix round's own committed artifacts red a gate that only reads committed state | 2026-09-09 Issue #131 (cifix: the Issue #113 fix's own new test fixtures/prose became 7 blocking OSS-01 internal-hostname matches, none on the exact-path allowlist) | 2026-09-13 Issue #180 (s1-closeout-164-154 round-3: the Issue #176 fix's own new `withIsolatedGitRepo()` `test@example.com` literal in `marker-corpus-probe.test.ts` had no matching OSS-01 allowlist entry) | Path B pre-commit hook (`src/secret-scan/pre-commit-scan.ts` + `.githooks/pre-commit`, `core.hooksPath`-installed via `package.json`'s `prepare` script) — a genuine, blocking `git commit` now runs OSS-01's own scan machinery against the actual to-be-committed tree before the commit lands, self-demonstrated live during this story's own build (a real `npm ci` fresh-clone verification caught this story's own new test fixtures' unallowlisted literals, same shape as Issues #131/#180) |
| an allowlist entry exempts a pattern in a file forever, not just the literal that motivated it — the false-negative sibling of the row above (that row is over-narrow allowlisting flagging legitimate content; this row is over-broad allowlisting letting a real secret through undetected) | 2026-09-09 Issue #136 (cifix Stage-3 round 3, red-team: demonstrated with a positive control — an identical synthetic fine-grained-PAT passes the gate in an allowlisted file, fails in a non-allowlisted one; 3 whole-file-forever `patterns.test.ts` entries human-ruled ACCEPT-AS-IS, tracked as a Path B follow-on) | 2026-09-14 Issue #193 (path-b-precommit-secret-scan Stage-3 round-2, red-team: round-1's own fix-now quoted a fake AWS-key-shaped literal in a `docs/qa/secret-scan-allowlist.json` `reason` field, granting a blanket `aws-access-key-id` exemption on that file; red-team staged a DISTINCT real-shaped key literal in a fresh `reason` field and it committed clean through both the pre-commit hook and CI's full-history scan) | pending lint for the GENERAL class (Issue #136's own 3 `patterns.test.ts` entries remain deliberately unfixed, human-ruled) — PARTIALLY promoted for the specific "allowlist file grants a credential-shaped pattern on itself" sub-case: `src/secret-scan/history-scan.test.ts`'s two new GitHub Issue #193 regression tests (no self-grant of a credential-shaped pattern on `docs/qa/secret-scan-allowlist.json`; no live credential-shaped match anywhere in that file's own raw text), run on every `npm test`. **2026-09-14 addendum, Issue #199 (same story, Stage-3 round-3, red-team) — FIXED, not merely disclosed:** the #193 fix's own remediation (2 new whole-file `aws-access-key-id` grants on `docs/STATE.md`/`docs/decisions.md`) carried the identical GENERAL-class blind spot the #193 regression tests only guarded for the allowlist file itself — red-team staged a distinct key-shaped literal into both files and it committed clean, undetected, through the real installed hook. A same-day "accept as established tradeoff" disclosure (this addendum's own first version) was refuted by red-team's own re-verification: `docs/STATE.md`'s literal was already reworded away while the grant stayed, proving the grant was not load-bearing there. **Promoted the same session, ahead of QA-13's own 3rd-distinct-story trigger** (both #193 and #199 landed within one story, so mandatory promotion wasn't yet due — promoted anyway because red-team's evidence made continuing to disclose-only indefensible): `src/secret-scan/history-scan.test.ts`'s new Issue #199 regression tests check `docs/STATE.md`'s current, live text for any credential-shaped match regardless of allowlist coverage, correctly scoped to exclude `docs/decisions.md` (append-only, cannot be edited to comply — its 2026-09-14 rows keep their literal forever by the same rule that protects every other historical row in that file) and this project's established test-fixture/evidence-quoting-report category (a first, over-broad attempt deriving the check from every allowlist grant self-caught on a dozen already-accepted occurrences before landing). Mutation-verified live. **2026-09-14 second addendum, red-team round-4 (`docs/reviews/path-b-precommit-secret-scan-red-team-round4-2026-09-14.md`) — the promotion above was itself the SAME defect class recurring a 3rd time (#136→#193→#199), one file over: `NARRATIVE_STATUS_FILES` was a hardcoded one-element array, and its exclusion categories were unbounded in time (`docs/decisions.md` and this project's own `*.test.ts` fixtures stayed unguarded). Genuinely promoted this time, not by widening the list: `src/secret-scan/history-scan.test.ts` now derives its checked set from the real allowlist every run and bounds each grant to a pinned, sha256-hashed baseline of its own already-reviewed occurrences — no file is hand-named, no exclusion is time-unbounded. Fixed same session (`story-implementer`, fix-now round-5), mutation-verified live in throwaway clones (2 targeted mutations, each turning exactly the intended test(s) red), red-team's own 3 round-4 attacks re-run against the fix and now correctly caught. GitHub Issues #199 (reopened) and #200 closed `completed`.** **2026-09-19 promotion note (issues 136 and 203, story `s1-136-value-scoped-allowlist`): the GENERAL class is promoted to a production mechanism instead of another per-file test. An allowlist entry now exempts a match only when its path, its pattern id and the sha256 of the matched bytes all agree (entries without a valid hash list are rejected and their matches block), and a dated-report grant is pinned to a baseline like every other file (the exclusion issue 203 named is removed). Awaiting Stage-3 review; the entry shape is drafted as THOTH-ADR-0002, status Proposed.** |
