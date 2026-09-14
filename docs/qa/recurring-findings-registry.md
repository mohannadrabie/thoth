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
