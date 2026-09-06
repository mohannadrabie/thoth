# S4 — Shell-command semantic detector: Design Council Stop Brief

**Mode:** Stop Brief (PRINCIPLES.md rule 16(c)) — not a new attack round. No new attack surface was opened; anything noticed while reading is logged as a residual, not attacked.

**Trigger:** rule 16(c) — 2 consecutive REWORK/no-go Stage-3 verdicts on the same target with no intervening clean/conditional-clean verdict, counted per reviewer lane. Confirmed independently in **two** lanes, either of which alone trips the rule:
- `red-team`: round 1 (2026-09-02) `no-go` → round 2 (2026-09-03) `no-go`.
- `cross-domain-reviewer`: round 1 (2026-09-02) `REWORK` → round 2 (2026-09-03) `REWORK`.

`app-security-reviewer` and `architecture-reviewer` both went REWORK/APPROVE-WITH-CONDITIONS → **APPROVE** this round — those two lanes are clean and closed.

**What I read (in order):** `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/decisions.md` (full active log), `docs/.maat-state.json` (ADR cache fp `83b2e3e`, `reviewRoundsSinceClean: 2`, `humanRulingRequired: false`), my own pre-build report (`s4-shell-semantic-detector-design-challenger-2026-09-02.md`, verdict `go`), all 4 round-1 Stage-3 reports (`red-team`, `app-security-reviewer`, `cross-domain-reviewer`, `architecture-reviewer`, all dated 2026-09-02), all 4 round-2 reports (`red-team`, `cross-domain-reviewer` dated 2026-09-03; `app-security-reconfirm`, `architecture-reconfirm` dated 2026-09-03), GitHub Issues #80/#81/#82 (all `OPEN`, no comments), `docs/backlog.md`, and the live code (`src/policy/normalizer/shell.ts:130-165`, `src/policy/kernel/kernel.ts:121-146`, confirmed unchanged since the round-2 reports were filed — `git status`/`git log` show the working tree is exactly where round 2 left it, no round-3 fix attempted). Also ran `gh run list --workflow=ci.yml --branch master` and `gh run view --log-failed` on the latest run — see Unrun Verifications.

---

## 1. What is proven safe

Reconfirmed by at least two independent lanes across two rounds, each with its own repro run, not carried on trust. Not re-attacked here.

| Item | Evidence |
|---|---|
| SUR-06/SUR-09 chaining: `&&`, `\|`, `;`, `\|\|`, plus round-2's added bare newline and non-trailing `&` | `red-team` round 1 no-go Finding 1 → round 2 Finding "FIXED, verified" (6/6 original repros deny; trailing-`&`-as-wrapper exemption correctly scoped) |
| `<<<` herestring no longer mis-parsed as a heredoc marker | `red-team` round 2, verified at the scanner level independent of the newline fix |
| Directory-flag guard (4 spellings: `-C`, `-d`, `--directory=`, `--directory ` space-form, plus the `-C=`→`context` alias collision) | `red-team` round 2 + `app-security-reviewer` reconfirm, both independently re-ran the PoC + alias-collision case |
| Multi-resource under-reporting (only first resource token extracted) | `red-team` round 2: both resources now reported; malformed-among-good denies the whole call; `xargs` always denies |
| Multi-redirect under-reporting (only first target extracted) | `red-team` round 2: both targets reported, matches real bash truncation semantics |
| CRLF crash in `qa:mutation-shell` (Issue #75/#78) | `red-team` round 2 (CRLF condition deliberately recreated, 40/40 killed) + `architecture-reviewer` reconfirm (CRLF forcibly reintroduced into `shell.ts`, 382/382 line breaks, still 40/40 — proven robust, not coincidental) |
| Mutant-list overclaim (Issue #76) | `red-team` round 2: header now correctly states "manually curated, not AST-derived" |
| Unterminated single-quote defeats chain-op + substitution detection (Issue #68, app-security's original HIGH) | `app-security-reviewer` reconfirm: original PoC + 3 adjacent shapes, all now deny |
| `normalizeShellCall`'s depth-parameter encapsulation (Issue #77, architecture's original MED) | `architecture-reviewer` reconfirm: live arity check (`normalizeShellCall.length === 1`), grepped — no external caller can reach `normalizeAtDepth` |
| QA-15 completeness-claim gate (Issue #79, cross-domain's original HIGH) | `cross-domain-reviewer` round 2: `docs/decisions.md` now passes clean; the row was rephrased not marker-fabricated |
| ADR-0021 "exactly one canonical Action record per call" holds under the round-2 multi-resource/multi-redirect widening | `architecture-reviewer` reconfirm, demonstrated with a combined recursion-plus-multi-resource case |
| Zero-diff to `kernel.ts`/`registry.ts`/`action-catalog.ts`/`target-format.ts` | Verified independently by `red-team`, `app-security-reviewer`, `cross-domain-reviewer`, and `architecture-reviewer` each round, plus by me directly this pass (`git status`/`git diff --stat` empty on all four) |
| `sudo`/`su -c`/`doas`/interpreter-`-c`/`-e` grammar-accident protection | Re-confirmed still holding after the round-1 rewrite (`red-team` round 1 Finding 12, re-checked round 2 Finding N4) |
| `eval`/`bash -c` inner-quote re-stripping (my own round-1 Finding 5, UNPROVEN-pending-verification) | Settled correct by `architecture-reviewer` round 1 + `cross-domain-reviewer` round 1's independent trace of `tokenize()`'s dequoting contract |
| Command substitution / directory-flag detection (my own round-1 mandatory Findings #1/#2) | Shipped as real, passing, mutation-covered tests — confirmed by `cross-domain-reviewer` round 1 Seam 3 |

**Frozen, per rule 19: no new evidence reopens any of the above.** A recheck of this story grades only the diff since round 2, plus what that diff demonstrably touches.

---

## 2. What is genuinely open right now

Two findings, both new this round, both unfixed as of this read (confirmed live in the current working tree, not from the reports' word):

### N1 — quoted `">"` literal drops the following resource token (Issue #80)

- **Where:** `src/policy/normalizer/shell.ts:146-149` (confirmed unchanged): `if (tokens[i] === ">" || tokens[i] === ">>") { i += 2; continue; }` — a token-**value** match, applied after `tokenize()` has already stripped quoting, so a quoted literal `">"` argument is indistinguishable from a live redirect operator and silently removes the next token (a real resource) from `positional`.
- **Filed by:** `red-team`, round 2, tagged `[ISSUE][HIGH][demonstrated]`.
- **My own calibration** (design-challenger's specific reach/entry-point discipline, applied identically to every S4 finding across all 4 reports and both rounds, including my own round-1 mandatory Findings #1/#2): no `hooks/` directory exists in this repo; no live session or CI job feeds a real command through `normalizeShellCall`. `reach=user` is **not provable** with a `path:line` today — S5 (hook wiring) is next on the critical path and has not landed. Retagged honestly: **`reach=instrument`**, which caps severity at **MED** and never independently blocks under my rules.
- **Boundary-crossing carve-out applies regardless of that cap:** this is a security-boundary-relevant silent divergence (a resource invisible to the policy record while the real command acts on it) — it **may not** be discharged to the residual register. It routes to **(a): a named failing proof-test**, same disposition as every other S4 finding across this story's whole review history.
- **Fix direction already named** (`red-team`, one of two options, not prescribed as final): key the exclusion on **position** (the offsets `extractRedirectTargets` already computes over `liveText`) rather than on token value.

### N2 — kernel's OR-across-targets `matchesTarget` lets a narrow ALLOW rule authorize a bundled, unrelated resource (Issue #82)

- **Where:** `src/policy/kernel/kernel.ts:121-127` (confirmed unchanged since S2, zero-diff this whole story): `matchesTarget` returns true if **any one** of `action.targets` satisfies **any one** rule pattern (`action.targets.some(t => targets.some(pattern => ...))`); `decide()`'s ALLOW path grants for the whole action the instant one match exists. This composes unsafely with round-1's own fix for Issue #73 (multi-resource collection), which is the first thing in this codebase's history to ever put more than one resource into `ActionRecord.targets`.
- **Filed by:** `cross-domain-reviewer`, round 2, tagged `[ISSUE][HIGH][demonstrated]`.
- **My own calibration:** same `reach=instrument` reasoning, same cap at MED. `cross-domain-reviewer`'s own report says this explicitly: "same `reach=instrument` calibration every other S4 finding across all four reports has applied... becomes `reach=user` the instant S5 wires the hook."
- **Boundary-crossing carve-out applies:** this is a policy-engine authorization bypass (the kernel's own stated verdict reason misattributes the bundled resource's authorization to a rule that never covered it) — **may not** be discharged to residual. Routes to **(a)**.
- **Fix direction named, two options, explicitly not chosen by the filer:** (1) kernel-side — require ALL targets covered before ALLOW (touches `kernel.ts`, reopens this story's own "zero diff to kernel.ts" invariant — an explicit Manager-level re-ruling, not a silent cross); (2) normalizer-side — treat any multi-resource shell invocation as ambiguous and deny via `unresolved` (stays inside S4's own stated scope, already within `red-team`'s own round-1 named test bar: "reports every resource in `targets`, **or reports unresolved**" — the OR branch was never taken).

### Calibration verdict for the council's GO bar

Under design-challenger's own consistently-applied calibration (the same one that capped my own round-1 mandatory Findings #1/#2 at MED for the identical reason), **neither N1 nor N2 is a valid, calibrated blocking HIGH** — both fail the `reach=user`-with-named-`path:line`-entry-point requirement, because that entry point genuinely does not exist in this codebase yet. `red-team` and `cross-domain-reviewer` correctly tagged them `[HIGH]` under their own roles' conventions (PRINCIPLES rule 21's security exemption is about the exposure-percentage cap, not about my reach-gates-HIGH rule) — that is not a disagreement to resolve, it is two different roles' calibration frameworks correctly producing different labels for the same underlying fact. **Both findings are mandatory day-1 failing tests via the boundary-crossing carve-out regardless of the MED cap** — that carve-out exists precisely so a `reach=instrument` cap cannot be used to quietly drop a security-shaped finding, and it is not optional.

Net: **no open calibrated blocking HIGH exists under my rules.** Rule 16(c)'s trigger is a real, correctly-fired process circuit-breaker (2 consecutive non-clean verdicts) independent of whether any individual finding clears my HIGH bar — the two are different questions, and the trigger firing does not itself imply an open HIGH.

---

## 3. What has never been run

1. **A real GitHub Actions CI run of this diff has never happened.** The diff is still uncommitted. I checked the last 5 runs of `ci.yml` on `master` (`gh run list --workflow=ci.yml --branch master --limit 5`) — **all 5 fail**, including the S3 commit (`247e5fb`) this story builds on. Root cause, read directly from the failing run's log (`gh run view 33626325202 --log-failed`): the `adr` git submodule fails to clone — `remote: Repository not found` / `fatal: repository 'https://github.com/mohannadrabie/adr.git/' not found` — an infrastructure/access problem (the submodule remote is unreachable to the CI runner), **unrelated to any S4 finding or any code in this diff**, and pre-existing since at least S1. This means: **no report in this story's entire review history (design-challenger, red-team, app-security, cross-domain, architecture, across both rounds) has ever actually confirmed a green run on the real CI platform.** Every "typecheck/lint/test/mutation-gate PASS" claim in every one of those reports is a local simulation, honestly and consistently disclosed as such, but never cross-checked against the real pipeline this repo's own Definition of Done requires green. This settles `red-team` round 1's Finding 8/Suspicion (routed to the Manager, "settled by `gh run list`") — settled now: CI is red, for a reason that is not S4's.
   - **Owner:** the human (submodule remote access is an account/repo-visibility problem, not something a session can fix) — or the Manager, to confirm whether `mohannadrabie/adr` needs to be made accessible to the Actions runner (a deploy key, a PAT with submodule scope, or converting the checkout step) before this or any other story can claim a real green CI run.
2. **N1's and N2's own proof-tests** — named in both filing reports, not yet written (no round 3 has run).
3. **The whole story's still-inherited "reach=instrument → reach=user" question** — no live session has ever driven a single one of the 11 total S4-era findings (my own 2 round-1, red-team's 7+2 across two rounds, app-security's 2, cross-domain's 2) through a real `PreToolUse` hook. S5 is next on the critical path; per every report's own stated concern (first raised in my own round-1 report's "single scariest unproven assumption"), S5's review will reasonably assume S4's detection logic is already correct and will not re-review it from scratch.
4. **`docs/STATE.md`'s pre-existing QA-15 completeness-claim failure** — confirmed still present in round 2 (`cross-domain-reviewer`), unrelated to S4, not this diff's problem to fix, but it means `qa:completeness-claims` will not go fully green even once N1/N2 close and the CI-submodule problem is fixed.

---

## 4. Candidate paths forward

Costed, not designed — mechanism choice within each path is `story-implementer`'s/`architecture-reviewer`'s, not stated here.

**(A) One more targeted fix-now round closing exactly N1 and N2, each with its already-named fix direction.**
- N1: switch `shell.ts:146`'s redirect exclusion from token-value to token-position (the offsets `extractRedirectTargets` already computes).
- N2: normalizer-side — treat any multi-resource shell invocation as ambiguous (`unresolved`), the already-reviewed-and-allowed OR-branch of `red-team`'s own round-1 Finding 4 test bar. Stays inside S4's stated scope; no `kernel.ts` diff.
- **Cost:** small — 1-2 files (`shell.ts`, maybe `shell-scanner.ts`), a handful of new tests + 2-3 new named mutants, one more red-team/cross-domain re-confirm pass (their 3rd, within the CRITICAL-tier 2-round-hard-stop budget only because the council is now handling routing).
- **Does NOT close:** the general kernel-side gap — `matchesTarget`'s OR-across-targets semantics stay exactly as they are today, latent for **any future normalizer** that ever produces a multi-target `ActionRecord**. N2's fix under this path only prevents *this* normalizer from ever handing the kernel a multi-target record; it does not fix the mechanism a later story could still trip over the same way.

**(B) Structural: deny ALL multi-resource shell invocations outright, by counting resource-shaped tokens BEFORE any exclusion logic runs.**
- If resource-shaped-token counting happens on the raw positional stream (before the `">"`/`">>"` value-based skip ever executes), a call like `kubectl delete pods/api ">" secrets/db-creds --context=prod` counts 2 resource-shaped tokens regardless of the exclusion bug, and denies on multiplicity alone — closing N1 and N2 from one shared root cause (multi-resource `ActionRecord.targets` reaching the kernel's ALLOW path at all), not two separate patches.
- **Cost:** touches `shell.ts`'s core `resolveKubectlShape` path more substantially than (A) — narrows the round-1 fix for Issue #73 (which specifically built multi-resource collection) back toward the "or reports unresolved" branch, removing/simplifying the `collectResources`/`buildResourceTargets` multi-collection logic and its ~12 associated mutants. This re-opens a fix that `app-security-reviewer` and `architecture-reviewer` already reviewed and approved this round — both would need a fresh, focused look to confirm the narrowing doesn't reopen anything else, not a rubber-stamp.
- **Does NOT close:** the same general kernel-side gap (A) doesn't close — `matchesTarget` itself is untouched, still latent for a future normalizer.

**(C) Kernel-side fix: `decide()`'s ALLOW path requires every element of `action.targets` to be covered by a matching allow rule (DENY stays `.some()`, unaffected).**
- The durable, general fix — closes the underlying kernel gap for **any** future multi-target-producing normalizer, not just this one.
- **Cost:** highest of the three. Touches `kernel.ts`, breaking this story's own explicitly-stated, repeatedly-reverified "zero diff to kernel.ts" invariant — every one of the 8 reports across both rounds treats that invariant as load-bearing; crossing it needs an explicit Manager ruling, not a silent cross, plus a fresh `qa:kernel-purity` run and very plausibly a fresh look from S2's own reviewers (Issues #61/#62's already-closed gaps live in this exact function's neighborhood) to confirm nothing already-settled is reopened. This is the one path that changes a **shared, foundational mechanism** every present and future normalizer depends on, not a story-local fix — the kind of decision PRINCIPLES rule 15 routes to `architecture-reviewer` before it's built, not after.
- **Does NOT close N1 on its own** — N1 is a normalizer-side parsing bug independent of kernel semantics; it needs its own fix under any of (A)/(B)/(C).

**My reading:** (A) is the cheapest complete closure of both named findings and fits inside a single fix-now round with fix directions the filing reviewers already named — nothing here requires new topology, so it does not itself trigger a rule-15 architecture-reviewer dispatch. (B) is attractive if the Manager/architect judge the newly-introduced multi-resource-collection surface itself (not just its two symptoms) as the thing worth removing, at the cost of re-opening an already-approved round-1 fix for a fresh look. (C) is the only path that actually retires the *general* risk this story's own multi-resource widening exposed — a real architectural question about shared kernel-matching semantics, properly `architecture-reviewer`'s and the Manager's to weigh, not mine to prescribe.

**Default recommendation, per rule 16's own stated default:** since no calibrated blocking HIGH is open, the default is **build now** — N1 and N2 become day-1 failing tests before anything else, via path (A) at minimum (it is a strict subset of what (B)/(C) would also need to do). Whether to additionally pursue (B) or (C) for the general-mechanism question is a shape call for the architect/impact-analyst, not a gate on shipping (A)'s fixes.

---

## Residual-risk register (carried forward, not re-litigated — unchanged from `docs/backlog.md`)

| Item | Trigger | Exposure |
|---|---|---|
| Blanket chain-deny also denies benign piped/chained read-only commands | Any governed session issues a `\|`/`&&`/`;`/`\|\|`/newline/non-trailing-`&`-bearing read-only command | Unmeasured (`assumption`) — instrument once S5 wires this live |
| `sudo`/`su -c`/interpreter-`-c`/`-e` wrappers uncaught by name, safe only via grammar-rigidity accident | A future grammar loosening that tolerates a leading modifier token | Unbounded if the accident is ever removed without a pinning test |
| Recursion depth cap = 5, unmeasured | N/A until real nesting-depth data exists | Unbounded — no data either direction |
| N2's app-security-reviewer-cleared adjacent SUSPICION (cosmetic fabricated-resource pollution from an attached-form `>value` redirect) | Traced through kernel matching, confirmed can only ADD a match on the DENY side (safe); the ADD-on-ALLOW-side risk is exactly N2 itself, not a separate item | N/A — subsumed by N2's own fix |
| SUR-10 fail-open register does not exist anywhere in the repo | Every one of this story's 7+ named fail-opens is a candidate entry once it exists | Not S4's obligation to build; milestone assignment unconfirmed |
| No ADR states whether S4's recursive-dispatch shape is the sanctioned template for a future normalizer | A future normalizer needing to resolve its own indirect/deferred construct | Advisory only |
| `docs/STATE.md`'s pre-existing QA-15 bare-completeness-claim failure | Unrelated to S4, blocks full-green `qa:completeness-claims` regardless | Pre-existing since S3 |

---

## The single scariest unproven assumption

That this story's own review ceremony — 4 reviewer lanes, 2 full rounds, 11+ demonstrated findings closed — has been exercising code that has never once run on the platform this project's own Definition of Done requires (a real GitHub Actions green run). Every "PASS" in every one of these 8 reports is a faithful, honestly-disclosed local simulation. Nobody has yet confirmed the actual CI pipeline agrees, and the reason it can't right now (`adr` submodule unreachable) has nothing to do with anything this story built. If that infrastructure gap and this story's own remaining code gap (N1/N2) are fixed in the same breath without separately confirming CI goes green on the *code* fix, the story could ship "reviewed" without ever having been proven to build in its actual target environment.

## Verdict this Stop Brief carries to the Manager/human

No calibrated blocking HIGH is open. Recommendation: **build now** — path (A) closes N1 and N2 as day-1 failing tests (mandatory, boundary-crossing carve-out, not negotiable to the residual register); separately, get one real green `ci.yml` run on this diff before calling S4 done, which requires the `adr` submodule access problem fixed first (human/Manager action, outside this story's code). Whether (B) or (C) is also worth pursuing for the general kernel-mechanism question is the architect's and impact-analyst's call, not a gate on (A).

---

RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius — Stop Brief mode, no new attacks; this lists the disposition of every OPEN item carried into this brief):
1. [SUSPICION][MED][demonstrated/instrument/plausible/irreversible][~0% live traffic today, 100% reliable as evasion primitive once live] N1 (Issue #80): shell.ts:146 excludes ">"/">>" by token VALUE post-quote-stripping, so a quoted literal '">"' silently drops the following resource token from the record; reach=instrument (no hooks/ wiring exists), caps MED, boundary-crossing carve-out mandates a day-1 proof-test regardless — cannot route to residual.
2. [SUSPICION][MED][demonstrated/instrument/plausible/irreversible][requires an ordinary least-privilege ALLOW rule + a bundled multi-resource call, both unforced] N2 (Issue #82): kernel.ts's matchesTarget (unchanged since S2) is OR-across-targets, so a narrow ALLOW rule authorizes an unrelated resource bundled into the same multi-resource shell call, introduced by round-1's own Issue #73 fix; reach=instrument, caps MED, boundary-crossing carve-out mandates a day-1 proof-test regardless — cannot route to residual.
3. [CLEAN][demonstrated] SUR-06/09 chaining (newline, non-trailing `&`, `&&`/`|`/`;`/`||`) — reconfirmed FIXED by red-team round 2 against all original repros plus wrapper routes.
4. [CLEAN][demonstrated] `<<<` herestring mis-parse — reconfirmed FIXED at the scanner level, independent of the chaining fix.
5. [CLEAN][demonstrated] Directory-flag guard (4 spellings + alias-collision) — reconfirmed FIXED by both red-team and app-security-reviewer independently.
6. [CLEAN][demonstrated] Multi-resource under-reporting (only-first-token) — reconfirmed FIXED, both resources now reported or the whole call denied.
7. [CLEAN][demonstrated] Multi-redirect under-reporting (only-first-target) — reconfirmed FIXED, matches real bash truncation semantics.
8. [CLEAN][demonstrated] CRLF crash in qa:mutation-shell — reconfirmed FIXED under a deliberately recreated CRLF condition (architecture-reviewer forcibly reintroduced 382/382 CRLF, still 40/40 killed).
9. [CLEAN][code-traced] Mutant-list overclaim — reconfirmed FIXED, header now correctly scoped to "manually curated."
10. [CLEAN][demonstrated] Unterminated single-quote defeating chain-op + substitution detection (Issue #68) — reconfirmed FIXED by app-security-reviewer's independent re-run.
11. [CLEAN][demonstrated] normalizeShellCall depth-parameter encapsulation (Issue #77) — reconfirmed CLOSED via live arity check plus exhaustive grep.
12. [CLEAN][demonstrated] QA-15 completeness-claim gate on docs/decisions.md (Issue #79) — reconfirmed FIXED, now passes clean.
13. [CLEAN][demonstrated] ADR-0021 "exactly one canonical Action record per call" — reconfirmed holding under the round-2 multi-resource/multi-redirect widening.
14. [CLEAN][demonstrated] Zero-diff to kernel.ts/registry.ts/action-catalog.ts/target-format.ts — reconfirmed by all 4 lanes each round, plus independently by me this pass.
15. [SUSPICION][LOW][demonstrated/instrument/plausible/reversible][unmeasured, basis: assumption] Blanket chain-deny also denies benign read-only piped/chained commands — accepted, ratified tradeoff, residual-register only.
16. [SUSPICION][LOW][derived/instrument/plausible/irreversible][unbounded if the accident is removed] sudo/su -c/interpreter wrapper gap, currently safe only by grammar-rigidity accident — residual-register only.
17. [SUSPICION][LOW][derived/instrument/plausible/irreversible][unbounded, no data either direction] Recursion depth cap = 5, unmeasured — residual-register only.
18. [SUSPICION][LOW][demonstrated] Unrun: no real GitHub Actions green run of this diff exists anywhere in this story's history — CI is red on master for an unrelated adr-submodule access failure (confirmed this pass via gh run list/view), not fixable from within this story's code.
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=0 suspicions=6 clean=12
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=15 code-traced=1 derived=2
round=3 (council seat, Stop Brief mode — not a graded attack round) roundsSinceLastGo=2 frozen=14 residuals=7 unrun=4 editorial=0
checks=npm test 377/377 pass/0 fail/0 skip (per round-2 reports, re-cited not re-run); typecheck/lint clean (per round-2 reports); qa:mutation-shell 40/40 KILLED (per round-2 reports, including under a deliberately recreated CRLF condition); zero-diff to kernel.ts/registry.ts/action-catalog.ts/target-format.ts confirmed directly this pass (git status/diff --stat empty); gh run list --workflow=ci.yml --branch master --limit 5: 5/5 FAIL (confirmed directly this pass, root cause = adr submodule unreachable, unrelated to S4)
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-design-challenger-stopbrief-2026-09-03.md
