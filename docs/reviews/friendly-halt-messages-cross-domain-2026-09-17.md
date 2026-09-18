# Cross-Domain Review — `friendly-halt-messages` — 2026-09-17

**Reviewer:** cross-domain-reviewer (Ra)
**Commit:** `106c2dc4ecc852f9f1d7e737e3e26e930f46dcfa` on `feat/friendly-halt-messages`
**Tier:** CRITICAL (ratified, named sensitive area: policy enforcement/session gates, `docs/run-log.jsonl` 2026-09-17T23:56:01)
**ADR cache:** `HIT` — reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23], fingerprint `83b2e3e` — whole catalog read, unfiltered (both `adr/devops/` and `adr/software-engineering/`).

## Lane(s) already run

No other reviewer's dated report exists yet for scope `friendly-halt-messages`. CLAUDE.md's CRITICAL-tier rule for a named sensitive area calls for red-team plus the relevant domain reviewer(s) alongside this standing pass; neither had reported at the time of this review. I therefore did the full seam-hunt and the whole-catalog ADR pass myself, and additionally ran the diff's own verification commands directly so this report does not depend on a lane reviewer's claim that hasn't landed yet.

## Diff scope (verified by reading the commit directly, not the commit message)

- `hooks/userpromptsubmit-halt-relay.mjs`: new `FRIENDLY_LABELS` frozen map (4 keys) + `friendlyLabelFor()`; `describeActiveReasons()` now prefixes each active-reason line with the friendly label instead of the raw `SUR-03-*` key. `UNLOCK_HINTS`/`unlockHintFor`/`sanitizeDetail`/`blockWithMessage`/`inspectHaltState` — confirmed byte-untouched by this commit (diff shows exactly two hunks: the new const+function, and `describeActiveReasons`'s one-line template change).
- `hooks/sessionstart-tool-enum.mjs`: new `quoteNames(names)` helper, used at both `reconcileReason(...)` call sites for `SUR-03-unclassified-tool`/`-connector`, dropping the old `unclassified:`/`connector identity present:` prefixes. `ENUMERATION_FAILED_REASON_KEY`/`FIXTURE_EXPIRED_REASON_KEY` detail construction, the halt-state JSON schema, and `reconcileReason` itself — confirmed untouched.
- Two new sibling test files (8 tests total); `test-writer`'s own four pre-existing hook test files confirmed untouched by this commit (`git diff --stat` against them is empty).
- CHANGELOG entry (self-corrected completeness-claim wording, per the story description) — confirmed the current text contains no bare "all N"/"N of M" completeness-claim shape in this diff's own added lines (the two pre-existing hits elsewhere in CHANGELOG.md predate this commit, from unrelated earlier stories).

## Verification, real (re-run independently, not trusted from the commit message)

- `npm test` -> **842/842 pass, 0 fail, 0 skipped** (53.0s), matches the CHANGELOG's own claimed count exactly.
- New sibling test files run in isolation: `npx tsx --test hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts hooks/sessionstart-tool-enum-friendly-labels.test.ts` -> 8/8 pass.
- `npm run typecheck` -> clean (exit 0). `npm run lint` -> clean (exit 0).
- `node src/qa/completeness-claim-checker.ts` -> `PASS: 2 file(s) checked, all completeness claims verified.`

## Cross-domain ADR verdict — whole catalog vs. the diff

Walked all 35 ADRs (12 devops + 23 software-engineering) against the changed files. No infra/IaC file touched (all 12 devops ADRs N/A by file scope). Of the software-engineering set:

- **SE-0005 (testing strategy):** new behavior (`FRIENDLY_LABELS`/`friendlyLabelFor`, `quoteNames`) has unit tests covering happy path (all 4 mapped keys) and the fallback/boundary case (unmapped key). Compliant.
- **SE-0006 (blast radius control):** no feature flag was added for this wording-only change to an existing gate. Rule 6's flag requirement is scoped to changes that are "risky or span multiple PRs" — this is a single-PR text-rendering change with the underlying halt behavior explicitly confirmed unchanged (human-scoped out of this story). Not a violation; noted, not flagged.
- **SE-0010 (code quality):** no new third-party dependency (`package.json` untouched); functions stay small and single-purpose. Compliant.
- **SE-0021 (thoth-native architecture):** none of its rules are reachable by this diff — no kernel, Action-record, normalizer, or audit-log file touched. N/A.
- Data/cost/observability ADRs (SE-0007/0008/0009/0011-0015): N/A, no data store or billable resource touched.
- Reference-port ADRs (SE-0016 through SE-0020): N/A, unrelated file family (maat-legacy/plugin-tree porting).

**Verdict: no ADR collision found**, in-lane or out-of-lane.

## Seam findings

### 1. [ISSUE][MED][code-traced] `FRIENDLY_LABELS` and `UNLOCK_HINTS` are two independently-maintained maps over the same 4 `SUR-03-*` keys, with no shared source of truth and no parity test — their fallback behaviors diverge in a way that silently reintroduces the exact bug this story fixes

`hooks/userpromptsubmit-halt-relay.mjs:101-116` (`UNLOCK_HINTS`) and `:129-134` (`FRIENDLY_LABELS`) hold the identical 4-key set today (`SUR-03-unclassified-tool`, `SUR-03-unclassified-connector`, `SUR-03-enumeration-failed`, `SUR-03-central-fixture-expired`) — verified by direct read, not assumed. Both have a documented fallback for an unmapped key (`unlockHintFor` at `:117-122`, `friendlyLabelFor` at `:135-137`), but the two fallbacks are not equivalent in what they protect:

- `unlockHintFor`'s fallback is a deliberately "still-actionable, generic" instruction (its own header comment says so) — a missing hint degrades gracefully.
- `friendlyLabelFor`'s fallback is the raw, hyphenated reason key itself — exactly the operator-unfriendly string this whole story exists to stop showing.

There is nothing tying the two maps' key sets together: no shared `REASON_KEYS` array, no runtime assertion, and no test (checked both new test files and the pre-existing `hooks/*.test.ts` siblings via grep across `hooks/` for `FRIENDLY_LABELS`/`UNLOCK_HINTS` — only the two source files and the two new test files reference either map, and neither test file cross-checks the other map's keys) that would fail if a 5th `SUR-03-*` reason key is ever added to `UNLOCK_HINTS` (the natural, already-established place to add a new reason's unlock instructions) without a matching `FRIENDLY_LABELS` entry. That addition would ship green — typecheck, lint, and all 842 tests pass — and silently regress exactly this story's own fix for that one new key.

This is not a currently-live defect (both maps agree today, confirmed), and it sits outside both a red-team mutation-testing lane (nothing here is an attacker-reachable behavior; the halt still fires correctly either way) and an app-security injection lane (no injection surface) — it is a maintainability/consistency seam between two parallel lookup tables introduced in the same commit, which is exactly this pass's mandate.

**Minimal fix:** one test asserting `Object.keys(FRIENDLY_LABELS)` covers every key in `UNLOCK_HINTS` (or a shared reason-key array both maps are built from/checked against) — a few lines in either new test file, no production-code restructuring required.

Exposure: 0% of current runs (both maps agree today); this is a latent drift risk that fires only on a future edit that touches one map and not the other — basis: code-traced (direct read of both maps' key sets, confirmed identical).

### 2. [CLEAN] The two disclosed edge cases (embedded double-quote breaking the visual quote boundary; `sanitizeDetail`'s 200-char cap truncating a long multi-name list mid-quote) are honestly scoped and low blast radius

Both are explicitly named in the CHANGELOG, the `quoteNames` header comment (`sessionstart-tool-enum.mjs:136-149`), and dated to this session's own Manager ratification (2026-09-17) — not a silent gap. Traced the actual interaction: `describeActiveReasons` (`userpromptsubmit-halt-relay.mjs:239`) applies `sanitizeDetail` to `entry.detail` (which now begins with `quoteNames`'s output for the two touched reason keys) — `sanitizeDetail` only strips control characters, it does not interact with the quoting scheme, so nothing new breaks beyond what's already disclosed. This is a cosmetic text-rendering artifact in an operator-facing message, not a security or authorization surface — the underlying halt/deny decision is unaffected either way. No new finding.

### 3. [CLEAN] "Untouched" claims verified directly, not trusted

Diffed `UNLOCK_HINTS`, `sanitizeDetail`, `blockWithMessage`, `inspectHaltState`, `reconcileReason`, and the halt-state JSON shape myself — all confirmed byte-identical pre/post commit; the commit's only hunks are the two additive blocks described above.

### 4. [CLEAN] Process discipline — completeness-claim wording, decisions.md row

`node src/qa/completeness-claim-checker.ts` passes (2 files checked) confirming the story's own self-corrected CHANGELOG wording is sound; no other completeness-claim-shaped prose ("all N", "every X") appears anywhere in this diff's added lines, in code comments or CHANGELOG. `docs/decisions.md` carries no row for this story's scope/wording-round decisions — acceptable per this project's own convention (CLAUDE.md Issue Discipline / run-log practice): the tier ratification is logged in `docs/run-log.jsonl` (`tier-ratified`, 2026-09-17T23:56:01, scope `friendly-halt-messages`) and the wording-round/label-drift correction is logged in the commit message and CHANGELOG itself — this is the "small story, run-log/state-file only" case the convention exempts, not a missing gate.

## Coverage gaps named

- No domain reviewer or red-team report exists yet for this scope at the time of this pass — flagged above under "Lane(s) already run", not a gap I can fill by proxy; I independently re-ran the verification commands (tests, typecheck, lint, completeness checker) so this report doesn't rest on an unverified claim in the interim.
- No other file type or concern in this diff goes unreviewed by some lane: the two production files are hook/policy-gate code (this pass plus the pending domain/red-team lanes), the two test files are exercised directly by the test run above, and the CHANGELOG/state/run-log entries are prose/tracking artifacts with no code-behavior risk. Nothing else to name.

## Verdict

**APPROVE-WITH-CONDITIONS.** One MED, code-traced, non-blocking-alone maintainability seam (finding 1) — files as a bug Issue with a named failing-test path; ship is not gated on it given PRINCIPLES rule 21 (non-security-class MED, 0% current exposure). No ADR collision found across the whole 35-ADR catalog. All claimed verification re-run and confirmed green.

## Findings to failing tests

| # | Finding | Failing test (to be added) |
|---|---|---|
| 1 | FRIENDLY_LABELS/UNLOCK_HINTS key-set drift | hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts: Object.keys(FRIENDLY_LABELS) must be a superset of Object.keys(UNLOCK_HINTS) (or both built from one shared array) |

open findings = 1, failing tests = 1 (equal, no gap to explain).

## Single next action

Add the one key-parity test named above (finding 1) in the same story's follow-up, or file it as a tracked Issue and ship — either way, no rework required on the shipped behavior itself.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] hooks/userpromptsubmit-halt-relay.mjs:101-137 -- FRIENDLY_LABELS and UNLOCK_HINTS are two independently-maintained maps over the same 4 SUR-03-* keys with no shared source of truth or parity test; FRIENDLY_LABELS' unmapped-key fallback (raw key) silently reintroduces this story's own fixed bug if a future key is added to UNLOCK_HINTS alone. Exposure: ~0% of current runs (both maps agree today), basis: code-traced; fires only on a future one-sided edit. Fix: one test asserting Object.keys(FRIENDLY_LABELS) is a superset of Object.keys(UNLOCK_HINTS).
2. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs:239, sessionstart-tool-enum.mjs:136-149 -- disclosed embedded-quote/200-char-truncation edge cases traced through sanitizeDetail; cosmetic only, no security/authz surface, already honestly ratified and disclosed -- no new finding.
3. [CLEAN][code-traced] UNLOCK_HINTS/sanitizeDetail/blockWithMessage/inspectHaltState/reconcileReason/halt-state JSON schema -- diffed directly, confirmed byte-untouched by this commit.
4. [CLEAN][demonstrated] completeness-claim-checker.ts PASS (2 files); no completeness-claim-shaped prose in this diff's added lines; docs/decisions.md row absence acceptable per project convention (run-log.jsonl tier-ratified event covers it for a small story).
5. [CLEAN][code-traced] whole 35-ADR catalog (12 devops + 23 software-engineering) walked against changed files -- no ADR collision, in-lane or out-of-lane.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=4 derived=0
checks=npm test 842/842 pass 0 fail 0 skipped; new sibling tests 8/8 pass; typecheck clean; lint clean; completeness-claim-checker PASS (2 files)
adr=HIT(35, whole catalog)
report=docs/reviews/friendly-halt-messages-cross-domain-2026-09-17.md
