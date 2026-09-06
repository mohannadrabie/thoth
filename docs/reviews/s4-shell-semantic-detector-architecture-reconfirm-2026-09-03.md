# S4 — Shell-command semantic detector: architecture re-confirm (fix-now round)

**Target:** S4 (Milestone #22, CRITICAL tier), `story-implementer` (agent a40050257abcfbbcc)'s
fix-now round closing the original 2026-09-02 architecture review's two MED findings, plus red-team's
no-go, app-security's REWORK, and cross-domain's REWORK from the same Stage-3 pass. This report
re-confirms only the two findings this review owns (Issues #77, #78) and re-checks ADR-0021's
"exactly one canonical Action record per call" against the fix-now round's broader rewrite
(collectResources/extractRedirectTargets, unterminated-quote detection, the two new chain-operator
separators, the herestring fix) — it does not re-litigate the other reviewers' own findings, which
are theirs to re-confirm.

**Prior report:** `docs/reviews/s4-shell-semantic-detector-architecture-2026-09-02.md`
(APPROVE-WITH-CONDITIONS). This report is additive per PRINCIPLES.md rule 11 — the original stays
verbatim; this is the follow-up dated report the rule calls for.

---

## Finding #2 (Issue #77) — depth parameter encapsulation — RE-CONFIRMED CLOSED

**Claimed fix:** split into an unexported `normalizeAtDepth(raw, depth)` (internal recursion) plus a
public single-argument `normalizeShellCall(raw)`.

**Verified directly, code-traced** (`src/policy/normalizer/shell.ts`):
- Line 375: `export function normalizeShellCall(raw: ShellCall): ActionRecord` — single parameter, no
  `depth` in the exported signature.
- Line 353: `function normalizeAtDepth(raw: ShellCall, depth: number): ActionRecord` — no `export`
  keyword; module-private.
- Line 376: `return normalizeAtDepth(raw, 0);` — the only place depth is seeded, always 0.
- Line 205: `const inner = normalizeAtDepth({ ...raw, command: wrapper.inner }, depth + 1);` — the
  only other call site, always monotonic `depth + 1`.
- Grepped every reference to `normalizeAtDepth` across `src/`: appears only in `shell.ts` (definition
  plus its two internal call sites) and in `shell-detector-mutants.ts`'s mutant anchors (which target
  `shell.ts`'s own source text, not a live import) — nothing outside this module can reach it.

**Verified demonstrated:**
```
$ node --experimental-strip-types -e "... normalizeShellCall.length ..."
1
```
`normalizeShellCall.length === 1` — a live, runtime confirmation (JS function arity) that the public
entry point genuinely takes exactly one parameter, on top of the static/structural check above.
Additionally: an external caller writing `normalizeShellCall(raw, 5)` would still type-check today
(TypeScript does not error on extra arguments to a call unless `strict`-adjacent flags are configured
a specific way) — but the extra argument would be silently ignored at runtime since the function
signature only declares one parameter, and `depth` is unreachable from outside the module regardless.
The encapsulation is real: no external caller can influence recursion depth.

**Verdict:** CLOSED. Fix is correct and complete. Recommend, non-blocking: a one-line regression test
(`assert.equal(normalizeShellCall.length, 1)`) would pin this arity as an explicit regression guard
rather than relying on a reader noticing the signature — cheap, not required to close the Issue.


## Finding #5 (Issue #78) — QA-06 CRLF crash, duplicate of red-team's Issue #75 — RE-CONFIRMED CLOSED

**Claimed fix:** `textMutant` normalizes CRLF to LF before matching, plus a new `.gitattributes` file
added to fix line endings at the source (git checkout) rather than only patching the symptom in the
harness.

**Verified directly, code-traced:**
- `src/qa/shell-detector-mutants.ts` lines 61-63: `normalizeLineEndings(text)` returns
  `text.replaceAll("\r\n", "\n")`.
- Lines 72-90: `textMutant`'s `apply()` normalizes BOTH the source and the anchor
  (`normalizeLineEndings(originalSource)`, `normalizeLineEndings(anchor)`) before the `.includes()`
  check, and returns `normalizedSource.replace(normalizedAnchor, normalizeLineEndings(mutated))` — the
  mutation is applied to fully LF-normalized content, which stays valid, parseable TypeScript
  regardless of the original working-tree line-ending state (Node's parser treats CRLF and LF
  identically inside string/token boundaries here, per the function's own comment).
- `.gitattributes` (repo root, new file): `* text=auto eol=lf` as a catch-all, plus explicit
  `*.ts text eol=lf`, `*.mjs`, `*.json`, `*.md`, `*.yml`, `*.yaml` entries — covers `shell.ts` and
  every other source/text file this project's own tooling reads byte-for-byte, at the git-checkout
  boundary rather than only at the one instrument that happened to break first.

**Verified demonstrated — both halves, including a deliberate re-break to prove robustness, not just
correlation:**
```
$ npm run qa:mutation-shell          (working tree as the fix-now round left it, 0 CRLF in shell.ts)
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.
```
Then, to verify the fix is actually robust and not merely coincidental (the file already being LF on
this checkout), CRLF was deliberately reintroduced into `shell.ts` in place (382 of 382 line breaks
converted — the exact failure condition originally demonstrated against the pre-fix code), and the
identical command re-run:
```
$ node -e "... replaceAll('\n','\r\n') ..."     # reintroduced CRLF: 382
$ npm run qa:mutation-shell
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.
```
No crash, same 40/40 result, with CRLF forcibly present. This is the strongest form of verification
available short of testing on an actual second machine: the harness-level fix
(`normalizeLineEndings`) is confirmed to work regardless of which line-ending state the working tree
is in, not merely confirmed to currently be unaffected because the file happens to be LF right now.
`shell.ts` was then restored to its exact fix-now-round state (confirmed via `git diff --stat`,
unchanged before and after: 341 insertions / 55 deletions against `HEAD`, identical to before the
stress test).

**Full regression, same session:** `npm test` — 377 of 377 passed, 0 failed, 0 skipped (up from
336/336 at the original review, consistent with the fix-now round's additional test coverage for
red-team's/app-security's other findings).

**Verdict:** CLOSED. Both halves (harness-level normalization, `.gitattributes` source-of-truth
prevention) are genuinely present, correctly implemented, and independently verified to work under
the exact failure condition originally demonstrated — not just claimed.


## Fresh look: does ADR-0021's "exactly one canonical Action record per call" still hold under the new collectResources/extractRedirectTargets logic?

The fix-now round substantially widened three things beyond the two findings this review owns: chain
operator detection (unterminated-quote-first, plus a bare newline and a bare trailing-sensitive `&`),
resource collection (every resource-shaped token, not just the first), and redirect-target extraction
(every live redirect, not just the first). All three now return ARRAYS (`resources`,
`resourceTokens`, `redirectTargets`) where the original code returned a single value. The concern
worth re-checking: does collecting into arrays anywhere create a SECOND record, or a merge of two
independently-computed record fragments, rather than populating one record's already-array-typed
fields (`verbs: string[]`, `targets: string[]`) — which is what the ADR's schema always allowed for
count-of-N results?

**Traced, code:**
- `collectResources` (shell.ts lines 226-240) and `buildResourceTargets` (lines 249-265) both operate
  purely on `positional`/`resources` passed in as plain data and return plain arrays/booleans — no
  `ActionRecord` is constructed inside either function. They are pure helpers `resolveKubectlShape`
  (the one function that actually builds a record) folds into the SAME single return statement at
  the bottom (lines 338-346) — one `return { source, verbs, targets, environment, identity, deferred,
  unresolved }`, unchanged in shape from before the fix-now round.
- `resolveWrapperMatch` (lines 182-207), the ONLY place recursion happens, is untouched by any of
  this — still exactly the same delegate-wholesale pattern as the original review found: `const inner
  = normalizeAtDepth(...); return { ...inner, deferred: true };`. Multi-resource/multi-redirect
  collection happens entirely inside the NON-recursive `resolveKubectlShape` branch — recursion and
  array-collection are orthogonal, neither was made to depend on the other.
- `action-record.ts`'s seven-field schema is unchanged (confirmed via `git diff --stat` — empty,
  zero-diff) and always declared `verbs`/`targets` as `string[]` — collecting N resources into one
  record's `targets` array was already within the ADR's own schema, not a new shape the fix-now round
  invented.

**Demonstrated**, against the actual fix-now-round code (see the two JSON outputs above): a
`bash -c "kubectl delete pods/api secrets/db-creds ..."` call — which now hits BOTH the recursion path
(via the `bash -c` wrapper) AND the new multi-resource collection path (via `resolveKubectlShape`'s
inner recursive call) in the same invocation — produces exactly ONE flat `ActionRecord` with BOTH
resources correctly collected into a single `targets` array of length 2, `deferred: true` correctly
stamped by the recursion layer, `unresolved: []`. The malformed-multi-resource variant produces
exactly ONE record with `targets: []` and a single `unresolved` entry naming both offending tokens
joined into one string (`"command resource \"pods/api, secrets/db-creds/extra\""`) — still one
record, one array field, never two records or a merged/duplicated set of fields.

**Verdict: still CONFORMS.** The fix-now round's widening is entirely inside the terminal
(non-recursive) record-building branch and entirely within the ADR's pre-existing array-typed field
schema. Nothing in this round's diff touches `resolveWrapperMatch`'s delegation pattern, the kernel,
the registry, or the `ActionRecord` shape itself. The property this review traced and demonstrated in
the original report holds unchanged.


---

## Verdict

**APPROVE.** Both MED findings this review owns (Issues #77, #78) are genuinely, verifiably closed —
not merely claimed — with fresh evidence in each case beyond re-reading the diff: a live arity check
for #77, and a deliberate CRLF re-break-then-retest for #78 to prove the fix is robust rather than
coincidental. The fresh look at ADR-0021 compliance under the fix-now round's broader rewrite
(multi-resource collection, multi-redirect extraction) finds no new gap — the property traced and
demonstrated in the original 2026-09-02 report still holds, unchanged in mechanism.

This review's own two conditions are cleared. The story's overall ship gate is still governed by
red-team's/app-security's/cross-domain's own re-confirmation of their own findings (Issues #68-#75),
which is not this report's scope.

## Single next action

Close Issues #77 and #78 (`state_reason: completed`), then continue tracking red-team's/
app-security's/cross-domain's own re-confirmation passes for their findings — this review's scope on
S4 is now complete pending any further changes to the recursive-dispatch shape specifically.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by blast radius):
1. [CLEAN][code-traced,demonstrated] Finding #2 (Issue #77) CLOSED — normalizeShellCall is now a single-argument public export (normalizeShellCall.length === 1, confirmed live), normalizeAtDepth carries depth and is never exported; grepped, no external reference anywhere in src/.
2. [CLEAN][demonstrated] Finding #5 (Issue #78) CLOSED — textMutant normalizes CRLF to LF on both anchor and source before matching; .gitattributes added covering *.ts/*.mjs/*.json/*.md/*.yml/*.yaml plus a catch-all. Verified under the ORIGINAL failure condition by deliberately reintroducing CRLF into shell.ts (382/382 line breaks) and re-running qa:mutation-shell: still 40/40 KILLED, no crash — not just currently-passing-by-coincidence.
3. [CLEAN][code-traced,demonstrated] ADR-0021 "exactly one canonical Action record per call" still holds under the fix-now round's collectResources/extractRedirectTargets widening — the recursive delegation pattern in resolveWrapperMatch is untouched, multi-resource/multi-redirect collection happens entirely inside the non-recursive terminal branch and entirely within the ADR's pre-existing array-typed field schema; demonstrated with a combined recursion-plus-multi-resource case producing exactly one flat record.
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=3 code-traced=3 derived=0
checks=377/377 pass (npm test, full suite) + 40/40 QA-06 mutants killed (working-tree state as left) + 40/40 QA-06 mutants killed (CRLF forcibly reintroduced, stress-test) + 0 fail + 0 skipped
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-architecture-reconfirm-2026-09-03.md
