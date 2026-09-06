# S4 — Shell-command semantic detector: architecture review

**Target:** S4 (Milestone #22, CRITICAL tier, "historically highest-incident component"), built by
`story-implementer` (agent `a40050257abcfbbcc`) on top of shipped S3 (`247e5fb`). Working-tree state
at review time (uncommitted): `git status --short` shows modified `.github/workflows/ci.yml`,
`CHANGELOG.md`, `docs/backlog.md`, `docs/decisions.md`, `docs/run-log.jsonl`, `package.json`,
`src/policy/fixtures/normalizer-calls.ts`, `src/policy/normalizer/{registry.test.ts,shell.test.ts,
shell.ts}`, `src/qa/{completeness-claim-checker.ts,mutation-harness.ts}`; new files
`src/policy/normalizer/{shell-scanner,flag-catalog,wrapper-catalog}.ts` plus their `.test.ts` files,
`src/qa/shell-detector-mutants.ts`.

**Dispatched per** the 2026-09-02 "process gate miss" row in `docs/decisions.md`: PRINCIPLES.md rule
15 required this review before or parallel with the first `design-challenger` round on a CRITICAL,
first-of-its-kind-pattern story (recursive self-referential normalization). The Manager ran
`design-challenger` alone; this review runs after build as the disclosed remedy, judging the design
and its shipped implementation together — substantive intent recovered, timing intent not.

**Read, in order:** `docs/PRINCIPLES.md` (full), `docs/decisions.md`'s three 2026-09-02 S4 rows
(intake ruling, design-challenger-findings ruling, process-gate-miss disclosure), the S4
design-challenger report (verdict go), ADR-0021 (full text including Rules for agents), and the
live code: shell.ts, shell-scanner.ts, flag-catalog.ts, wrapper-catalog.ts plus all four test files,
shell-detector-mutants.ts, kernel.ts, action-record.ts (confirmed zero-diff — not in git status, read
to verify the recursion never surfaces past the normalizer boundary), docs/backlog.md's diff
(residual-carry verification), docs/STATE.md.

**ADR cache:** ADR cache HIT: reused 35 ADR(s) from catalog, fingerprint 83b2e3e, about 17300 tokens
saved this pass. Applicable ADR for this domain: ADR-0021 (applicableTo: architecture, security,
code, data) — the only Accepted ADR covering this change; no others in the catalog name normalizer,
kernel, or recursion shapes.

---

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| 1. Fit | CONFORMS | Diff matches the 2026-09-02 ratified scope exactly — 9 named wrappers, chain and substitution detect-only (never resolve), directory-flag presence-only. No invented wrapper types, no env/xargs own-grammar parsing beyond what was asked. Verified kernel.ts, registry.ts, action-catalog.ts, target-format.ts are byte-unchanged (absent from git status), matching the header comment's own claim. |
| 2. Blast radius and coupling | CONFORMS, one code-traced MED gap | Recursion is entirely internal to the normalizer; kernel and registry never see it (single ActionRecord per call — see axis 3). Single point of failure is the shell normalizer itself, already isolated behind the registry's declaration-based dispatch. One real coupling gap: normalizeShellCall's depth parameter is a public, externally-callable parameter on an exported function (finding 2 below). |
| 3. Compliance, ADR-0021 | CONFORMS | Exactly one canonical Action record per call (ADR-0021 constraints.architecture) — traced and demonstrated: the kernel and registry receive exactly one flat ActionRecord; the recursive call fully delegates to the inner record, it does not merge two separate field sets. SUR-09's deferred-field-as-execution rule is confirmed unread by kernel.ts's isMutating — deferred is stamped by the normalizer only. |
| 4. Cost shape | CONFORMS | Recursion bounded by a depth cap of 5, checked before recursing, at-cap fails closed. No unbounded variable in the recursion itself. The cap's value is unmeasured (design-challenger Finding 6, already correctly capped LOW and residual per rule 18 — not re-litigated here). |
| 5. Operability | CONFORMS, one demonstrated MED gap | Fail-closed uniformly (every ambiguous case goes to unresolved, never a guess). The QA-06 mutation harness — the instrument proving this component's own regression suite actually kills real mutants — crashes uncaught on this exact working tree due to a line-ending-fragile anchor match (finding 5 below); self-heals at the git commit boundary, does not reach CI, but is a real, demonstrated local-verification hazard on this project's own dev platform (win32). |

## Findings, ranked by blast radius

### 1. [CLEAN] Recursive re-entry into normalizeShellCall is the correct shape for this problem, not merely a convenient one

**Evidence, demonstrated:** ran the shipped code directly against three cases:

```
--- eval with nested-quoted semicolon (should be inert) ---
{"source":"parsed","verbs":[],"targets":[],"environment":"prod","identity":"svc","deferred":true,
 "unresolved":["command verb \"a;b\"","command resource \"\"","command flag --context"]}
--- eval with live semicolon after quote-strip (should be unresolved) ---
{"source":"parsed","verbs":[],"targets":[],"environment":"prod","identity":"svc","deferred":true,
 "unresolved":["chain operator \";\" detected outside quotes"]}
--- bash -c wrapping a real mutating kubectl call (should recurse and resolve) ---
{"source":"parsed","verbs":["delete"],"targets":["prod/cluster/prod-cluster/pod/payment-worker"],
 "environment":"prod","identity":"svc","deferred":true,"unresolved":[]}
```

The eval call with a nested-quoted semicolon correctly keeps it inert (it is inside the
re-materialized inner quotes, exactly as a real shell would treat it); the eval call with a live
semicolon after quote-stripping correctly goes live and denies at the recursive call. This settles
design-challenger's Finding 5 (UNPROVEN-pending-verification, "eval/bash -c inner-argument
re-quoting mismatch") as resolved correct — wrapper-catalog.test.ts already has a named test for this
("Finding #5: eval's extracted inner command has its outer quotes already stripped"), which passed
in the full run below.

**Why recursion, not an iterative unwrap loop or a separate WrapperResolver module:** tokenize()
already strips quote delimiters while preserving live content — feeding that exact string back into
the same heredoc-strip, quote-scan, tokenize, flag-scan, wrapper-detect pipeline at depth+1 is what
makes the nested-quote case above resolve correctly for free. An iterative loop would need to
manually thread quote-state stripping between iterations, reimplementing what the recursive self-call
already gives by re-running the full pipeline. A separate WrapperResolver module holding its own
bounded state would either duplicate that pipeline or call back into normalizeShellCall anyway — the
self-reference does not go away, it just moves to a second file with no correctness gain. Recursion
here is the minimal, semantically-correct shape, not gold-plating and not accidental convenience.

**Tags:** evidence demonstrated (ran the shipped code above) plus code-traced (shell.ts lines
255-273, shell-scanner.ts lines 209-247).

### 2. [ISSUE][MED] normalizeShellCall's depth parameter is public, not encapsulated — a structural (not yet live) way to bypass the depth cap

**Finding:** the exported signature is `normalizeShellCall(raw: ShellCall, depth = 0): ActionRecord`
(shell.ts line 255), exposing depth as an optional second parameter on the SAME exported symbol that
registry.ts calls at depth 0 and that the function calls on itself, monotonically incrementing, to
recurse. Nothing in the type system or module structure prevents a future caller from invoking
normalizeShellCall(raw, -1000) directly — a large negative starting depth defeats the "depth + 1 >
DEPTH_CAP" check for many additional levels before the cap engages, turning a bounded recursion into
a much deeper one for attacker-controlled input nesting.

**Exposure today:** 0 percent, basis counted in code — grepped every reference to
normalizeShellCall in src/: the only call sites are registry.ts's zero-arg registration (implicit
depth 0), shell.ts's own self-recursive call (always depth + 1, monotonic from 0), and test or
mutant-harness files. No live or planned code path passes an externally-derived depth value.

**Why it still matters here specifically:** this is the first recursive-dispatch normalizer in the
codebase (the reason this review was dispatched at all, per rule 15). If a future normalizer, or
S5's hook wiring, copies this shape — export a function with an internal recursion-depth parameter —
this exact leak reproduces by default, not by mistake. The fix is cheap and makes the cap
encapsulated by construction rather than by the accident of nobody happening to call it that way yet,
matching this same story's own stated design philosophy (wrapper-catalog.ts's header comment
explicitly warns against exactly this "safe by accident, not by design" failure mode for a different
finding).

**Fix:** split into a public single-argument normalizeShellCall(raw) and an unexported
normalizeAtDepth(raw, depth) that the public function calls at depth 0 — no caller outside this
module can ever supply depth.

**Named failing test — none exists in executable form today**, and that gap is itself worth stating
plainly per rule 19: this is a signature-encapsulation defect, not a runtime behavior bug, so there is
no input that currently makes an existing test fail. The nearest executable proxy is a structural
test (same shape as kernel-purity-check.ts's own AST or text scan) asserting normalizeShellCall's
exported signature never accepts more than one parameter — or, more simply, the refactor itself
self-verifies via TypeScript's module boundary once done (an external caller writing
normalizeShellCall(raw, 5) becomes a compile error). Recommend the refactor as the fix; a regression
test is not strictly separable from it here.

**Tags:** evidence code-traced (shell.ts line 255, lines 153 and 157, plus a grep of all call sites)
/ exposure about 0 percent of runs, basis counted in code / severity MED (structural gap in a
security-boundary component's first instance of a new pattern, not yet live).

### 5. QA-06 mutation harness CRLF crash (test chunk 1)

Demonstrated, first run (working tree exactly as story-implementer left it):
```
$ node --experimental-strip-types src/qa/shell-detector-mutants.ts
```
Root cause traced below.
**Root cause, traced:** textMutant's multi-line anchors are hardcoded newline-joined string literals
matched via exact String.prototype.includes() (shell-detector-mutants.ts line 54, the specific
failing anchor at line 253). Confirmed the working-tree shell.ts currently has CRLF throughout
(278 of 278 line breaks are CRLF) while the last committed blob (HEAD, commit 247e5fb) is pure LF —
includes() against an LF-only literal never matches CRLF content. Confirmed this is not a blanket
local-checkout artifact: the three sibling brand-new files (shell-scanner.ts, flag-catalog.ts,
wrapper-catalog.ts) are pure LF (never having gone through a git checkout), while every modified,
pre-existing file in this diff currently shows CRLF in the working tree (git diff prints a warning
that LF will be replaced by CRLF the next time git touches the file, for shell.ts,
.github/workflows/ci.yml, package.json, src/qa/completeness-claim-checker.ts, and
src/qa/mutation-harness.ts alike) — consistent with this machine's core.autocrlf setting converting
on the original checkout of each pre-existing file, which in-place edits then preserved.
**Confirmed self-heals at the git boundary, does not reach CI:** running git stash push against just
shell.ts (which internally re-normalizes via the same clean filter git add/commit uses) produced a
diff with zero carriage-return bytes — this machine's autocrlf setting normalizes CRLF to LF at
staging or commit time regardless of the working-tree byte content. CI runs on ubuntu-latest, which
does not introduce this conversion on checkout of an LF-committed blob. So the eventual commit and CI
are very likely unaffected — this is a pre-commit, local-verification-only hazard, not a merge
blocker, and it is not being raised to HIGH or blocked on.
**But it is real, not hypothetical, right now:** shell.ts was converted to LF in place as a scratch
verification, then restored to the exact original CRLF byte content afterward (confirmed via
git diff --stat unchanged before and after), and the identical command was re-run:
```
$ node --experimental-strip-types src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 28 of 28 mutant(s) KILLED.
```
28 of 28 killed once the line-ending mismatch is removed — the underlying mutant coverage is real and
complete; only the anchor-matching mechanism is fragile. No .gitattributes file exists in this repo
to make LF-on-checkout structural rather than incidental (dependent on each contributor's own git
config) — the project's declared dev platform for this very session is win32.
**Exposure:** basis measured — 0 percent of CI or merged-commit runs (confirmed ubuntu-latest plus
confirmed this machine's autocrlf setting normalizes at staging), but effectively certain (not a
percentage of a population, a reproducible condition) for running the mutation-shell script locally,
pre-commit, on a fresh Windows checkout of any edited (not newly-created) file in this mutant's scan
set — reproduced live in this session, not assumed.

**Named failing test:** add to a new or existing QA-06-adjacent test file a case asserting that
textMutant's apply() does not throw when the target source string uses CRLF line endings that
otherwise match the anchor's content ignoring line-ending style — i.e. the anchor match should
normalize CRLF to LF on both the anchor and the source before comparing (or a .gitattributes entry
should force LF endings project-wide so this class of drift cannot occur pre-commit either — both are
cheap, mechanical fixes, either sufficient alone).

**Tags:** evidence demonstrated (ran the actual crash, then the actual fix-verified pass, on the real
working tree) / severity MED (real, reproducible, but self-heals at the commit boundary and does not
reach CI or the shipped artifact).

### 6. [CLEAN] No process gap beyond the disclosed rule-15 miss — full build (no separate walking-skeleton phase) was appropriate for this story's actual size and shape

Rule 17's walking-skeleton requirement triggers on either a design loop reaching round 2 or later, or
(by its own framing, "touching every layer against a real datastore") a story with a real
external-system layer to walk through. Neither applied: design-challenger's round 1 reached go
outright with two additive findings, never a round 2; and S4 is a pure, zero-I/O function extension
(no filesystem, network, process, or timer access anywhere in its module boundary, the same purity
discipline kernel.ts's own boundary enforces one layer up) composing over already-shipped,
already-reviewed modules (action-catalog.ts, target-format.ts, kernel.ts, registry.ts — all
confirmed zero-diff). There is no additional layer for a skeleton to walk through beyond what already
exists and is already fully fixture and test covered. The two mandatory design-challenger findings
were correctly converted to day-1 failing tests before the rest of the scanner was written —
confirmed: shell.test.ts carries tests named exactly "Finding #1" and "Finding #2" as the ruling
specified, and shell-detector-mutants.ts registers matching mutant classes (command/process
substitution, directory-flag-related). The one genuinely unmeasured number this design leans on
(the depth cap of 5) was correctly capped LOW and residual per rule 18 (docs/backlog.md's diff
carries it forward verbatim) rather than silently treated as measured. Going straight from plan text
to full build was the right call here, not a shortcut.

**Tags:** evidence derived (reasoning about which rule-17 trigger condition applied) plus confirmed
code-traced for the zero-I/O claim (grep of shell.ts, shell-scanner.ts, flag-catalog.ts, and
wrapper-catalog.ts for fs, http, child_process, net imports — none found) / does not gate.

### 7. [CLEAN] Residuals from design-challenger's round-1 report were correctly carried to docs/backlog.md, not silently dropped

Verified directly against docs/backlog.md's diff: Findings 3 (blanket chain-deny false-positive
rate), 4 (sudo/su -c/interpreter -c gap), 6 (unmeasured depth cap), Finding 2's wider "does a
directory flag ever redirect the real target" open question, and the env/xargs own-flag-scope note
are all present, each attributed to its origin with a trigger and exposure statement — matching rule
12's "not in scope goes to backlog, never code" discipline. No scope-creep found in the supporting
infra changes either (mutation-harness.ts, completeness-claim-checker.ts, package.json, ci.yml diffs
are all small, correctly-scoped wiring for the new qa:mutation-shell script — read in full, no
unrelated changes smuggled in).

**Tags:** evidence code-traced (docs/backlog.md diff, read in full).

---

## NOT-COVERED and AMBIGUOUS list (architect's work queue)

1. **Finding 4** — whether this recursive-dispatch shape (self-call plus monotonic depth cap plus
   fail-closed-at-cap) is the sanctioned template for a future normalizer's own indirect-execution
   problem. No ADR decides this either way; advisory note recommended, not a blocker.

## Verdict

**APPROVE-WITH-CONDITIONS.**

The core architectural question rule 15 dispatches this review to answer — should this design exist —
is yes: recursive re-entry into the same normalization pipeline is the correct, not merely
convenient, shape for bounded indirect-execution resolution (finding 1), and it genuinely,
demonstrably honors ADR-0021's "exactly one canonical Action record per call" (finding 3) rather than
merely appearing to. Both conditions below are cheap, mechanical, non-architectural fixes — neither
reopens the design question itself:

1. **MED, Issue to be filed.** Encapsulate normalizeShellCall's recursion-depth parameter (finding 2)
   so a future caller — especially any future normalizer copying this codebase's first
   recursive-dispatch pattern — cannot structurally bypass the depth cap.
2. **MED, Issue to be filed.** Make QA-06's mutation-anchor matching, or this repo's line-ending
   policy, tolerant of CRLF working-tree content (finding 5), so the CRITICAL component's own
   regression-proving instrument does not crash on this project's own declared dev platform.

Neither condition blocks the red-team, app-security-reviewer, or cross-domain-reviewer ceremony still
owed to this CRITICAL-tier story per docs/decisions.md's process-gate-miss remedy — both can land in
the same fix-now pass those reviews' own findings resolve in.

## Single next action

File the two MED Issues (findings 2 and 5) per this project's Issue Discipline, then hand S4 to the
still-owed red-team, app-security-reviewer, and cross-domain-reviewer ceremony — this review's
findings are additive to, not a gate ahead of, that ceremony.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [CLEAN][demonstrated] Recursive re-entry into normalizeShellCall is the semantically-correct shape (nested-quote eval case verified live), not merely convenient; an iterative loop or separate resolver module would reimplement the same pipeline with no correctness gain.
2. [ISSUE][MED][code-traced] normalizeShellCall's depth param is publicly exported/callable, structurally able to bypass the depth cap; not live-exploitable today (0 external call sites with non-default depth, counted in code) but a smell in this codebase's first recursive-dispatch instance. Exposure: ~0% of runs, basis: counted in code.
3. [CLEAN][code-traced,demonstrated] ADR-0021 "exactly one canonical Action record per call" holds under recursion — the outer record fully delegates to (not unions with) the inner; 109/109 unit tests pass, 28/28 QA-06 mutants killed (once finding 5's blocker is cleared), 336/336 full-suite tests pass.
4. [SUSPICION][LOW][derived] No ADR/doc states whether this recursive-dispatch shape is the sanctioned template for a future normalizer's similar indirect-execution problem — advisory, feeds architect's queue.
5. [ISSUE][MED][demonstrated] QA-06's mutation harness (required CI gate) crashes uncaught on CRLF line endings in shell.ts, reproduced live on this exact working tree; confirmed self-heals at git's commit/staging boundary (autocrlf normalizes to LF) and CI runs on ubuntu-latest (unaffected) — real, demonstrated, non-blocking to merge, but a genuine local-verification hazard on this project's own win32 dev platform. Exposure: 0% of CI/merged runs (measured), ~100% of local pre-commit runs under this exact reproduced condition.
6. [CLEAN][derived,code-traced] No walking-skeleton process gap beyond the disclosed rule-15 miss — neither rule-17 trigger (round 2+, or a real external-system layer) applied; S4 is a pure zero-I/O extension, confirmed via import grep.
7. [CLEAN][code-traced] design-challenger's round-1 residuals (findings 3, 4, 6, and finding 2's wider question) all correctly carried to docs/backlog.md; supporting infra diffs (mutation-harness.ts, completeness-claim-checker.ts, package.json, ci.yml) are small and correctly scoped, no smuggled changes.
counts: issues=2 suspicions=1 clean=4
evidence: demonstrated=4 code-traced=5 derived=2
checks=336/336 pass (npm test, full suite) + 109/109 pass (S4-scoped test files) + 28/28 QA-06 mutants killed (post line-ending fix) + 0/28 runnable pre-fix (uncaught crash, demonstrated) + 0 fail + 0 skipped
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-architecture-2026-09-02.md
