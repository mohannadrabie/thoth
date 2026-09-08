# Impact Analyst (Wepwawet) — S5 post-build fix-now sub-effort, council seat

**Scope:** `scope=s5-fixnow` / `tier=CRITICAL` (Milestone #23). Trigger: PRINCIPLES rule 16(c) — 2 consecutive non-clean verdicts on the round-2 re-confirm ceremony (`red-team` no-go, `docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md`; `app-security-reviewer` APPROVE-WITH-CONDITIONS carrying 2 new MED, `docs/reviews/s5-halt-hooks-app-security-round2-2026-09-07.md`).
**Date:** 2026-09-07
**Reviewer:** `impact-analyst` (Wepwawet), council seat
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT]
**HEAD:** `1fa39f1` (build uncommitted)

**Findings under discussion:**
- N1 `[ISSUE][HIGH][demonstrated]` — `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` (`hooks/sessionstart-tool-enum.mjs:238-241`) lets any ambient env var replace the entire ratified fixture (allowlists + expiry), deliverable via gitignored `.claude/settings.local.json`, invisible to `git status`/`qa:gate-manifest`/every test.
- N2 `[ISSUE][MED][demonstrated]` — `expiresOn`'s value is pinned only by shape (`isFixtureExpired(...) === false`), not by exact value; rolling it 73 years forward passes the full suite + all 4 gates.
- N3 `[ISSUE][MED][demonstrated]` — post-expiry, `UNLOCK_HINTS` names an unlock ("add to the fixture") that is already satisfied and does nothing; "expir" appears 0 times in the relay.
- Finding 6 `[ISSUE][MED][demonstrated]` (app-security) — AC5's `reconcileReason` can write `set:false` into the shared `"unknown-session"` fallback bucket, clearing a *different* colliding invocation's genuinely-active halt (Issue #96 escalated from safe-direction stuck to fail-open).
- N4 / Finding 7 `[ISSUE][LOW/MED][demonstrated]` — `sanitizeDetail` strips ASCII controls only; six Unicode bidi/format/zero-width characters (incl. U+202E) survive into the chat-visible message.

I do not re-litigate KNOWN_CONNECTORS spoofability itself (Issue #90) — both reviewers ratified it CLOSED-to-standard and I have nothing to add there.

---

## Mechanical enumeration (run once, reused by every candidate below)

```
$ grep -rn "THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH" --include="*.ts" --include="*.mjs" . | grep -v node_modules | grep -v reviews
hooks/sessionstart-tool-enum-fixnow.test.ts:10   (comment)
hooks/sessionstart-tool-enum-fixnow.test.ts:39   (comment)
hooks/sessionstart-tool-enum-fixnow.test.ts:69   (usage, test 1)
hooks/sessionstart-tool-enum-fixnow.test.ts:118  (usage, test 3a)
hooks/sessionstart-tool-enum-fixnow.test.ts:132  (usage, test 3b)
hooks/sessionstart-tool-enum.mjs:233   (comment)
hooks/sessionstart-tool-enum.mjs:238   (read site — the ONLY production read)
```
**1 production read site, 1 legitimate producer (`hooks/sessionstart-tool-enum-fixnow.test.ts`, 4 usages across 3 tests).** Every other possible producer (`.claude/settings.local.json` `env` block, a shell rc file, `.envrc`, a compromised CI runner) is, by definition, unenumerable — that absence-of-enumerability is N1 itself, not a gap in my count.

```
$ grep -rln "loadCentralClassificationFixture\|isFixtureExpired" --include="*.ts" --include="*.mjs" . | grep -v node_modules
hooks/sessionstart-tool-enum.mjs
src/policy/tools/central-classification.ts
src/policy/tools/central-classification.test.ts
```
**1 production consumer, 1 test consumer.** No other file imports these.

```
$ grep -rln "halt-state" --include="*.ts" --include="*.mjs" . | grep -v node_modules
hooks/sessionstart-tool-enum.mjs                  (writer)
hooks/sessionstart-tool-enum.test.ts              (test-writer's answer-key — MUST stay unmodified)
hooks/sessionstart-tool-enum-fixnow.test.ts        (story-implementer's own)
hooks/userpromptsubmit-halt-relay.mjs             (reader — the sole blocking surface)
hooks/userpromptsubmit-halt-relay.test.ts         (test-writer's answer-key — MUST stay unmodified)
hooks/userpromptsubmit-halt-relay-fixnow.test.ts  (story-implementer's own)
hooks/test-support/fixture-tree.ts                (shared read/write test helper)
hooks/test-support/spawn-hook.ts                  (shared process-spawn test helper)
src/policy/tools/mcp-enumeration.ts               (comment reference only, no read/write)
```
**2 production files touch the shared schema (writer + reader), 4 test files assert against it, 1 shared test helper.** `$ grep -n "thoth" .gitignore` → `.thoth/halt-state/` is gitignored: no migration, no persisted external state, fully reversible by construction.

```
$ grep -rn '"unknown-session"' --include="*.ts" --include="*.mjs" .
hooks/sessionstart-tool-enum.mjs:276,280
hooks/userpromptsubmit-halt-relay.mjs:214
```
**2 production sites share the literal fallback string** — this is the exact seam Finding 6 attacks: both hooks independently compute the same collision-prone id with no coordination.

```
$ cat .claude/settings.json | grep -c '"env"'
0
```
**Zero current env-block producers in the checked-in, git-visible config.** N1's delivery vector is entirely outside anything `git status`/`qa:gate-manifest` can see today — confirms red-team's own framing exactly.

---

## Candidate A — targeted mechanical patch (one more focused fix-now round)

**What it does:** (1) removes the `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` env seam, replacing it with a delivery mechanism that cannot arrive via ambient environment (an argv-based override, since `hooks/test-support/spawn-hook.ts`'s own `runHook` already spawns the script directly and could pass an explicit arg instead of an env var — no new test infrastructure needed) and records the resolved fixture path in the halt-state file; (2) adds an exact-value pin on `expiresOn` in `central-classification.test.ts`; (3) teaches the relay to name expiry as the cause when it is the cause; (4) guards `reconcileReason` so the `"unknown-session"` bucket is never `set:false`'d, only ever additively `set:true` (app-security's own minimal-fix (a)); (5) extends `sanitizeDetail`'s strip range to the Unicode bidi/format block.

**Classification: seam.** Every one of the five sub-fixes crosses the writer/reader boundary of a shared, gitignored-but-live-at-runtime file format (`.thoth/halt-state/*.json`) or the hook-invocation contract (env → argv). None is contained inside one module; the relay (a different file, a different process invocation) must agree with whatever the writer starts emitting.

**Upstream — who feeds the inputs this narrows?**
- The env-var seam (N1): 1 legitimate producer (the fixnow test file, 4 call sites) — can it satisfy an argv-based precondition today? Yes: `runHook(scriptPath, stdin, envOverrides)` already merges an object into the spawned env; converting 4 call sites to pass an argv element instead is mechanical, no new capability needed. **Verdict: producer satisfiable today, no hidden second half.**
- The `expiresOn` claim (N2): its only "producer" is the human ratification recorded in `docs/decisions.md`'s 2026-09-07 row, already present and cited by the fixture's own `ratifiedBy` field. **Verdict: satisfiable, the value to pin already exists.**
- The halt-state "cause" the relay would key its message on (N3): produced today only implicitly (by which of the three keys fired, not by *why*). The writer (`sessionstart-tool-enum.mjs`) must be changed to also record cause — a genuinely new field, not something an existing producer already emits. **This is N3's hidden second half:** the fix isn't relay-only; it requires a coordinated writer change, and if the writer change is "stuff the word 'expired' into the existing free-text `detail` string" rather than a structured field, the relay's read side becomes a string-match against writer prose — a brittle coupling that breaks the moment `detail`'s wording changes for an unrelated reason (e.g., a future N4-style sanitization tweak). Whether Candidate A CONTAINS or RELOCATES this instance depends entirely on whether `story-implementer` adds a structured field (e.g., `{set, detail, cause}`) or a text-match hack. I flag this as a build-time choice, not something I can price as closed in advance.

**Downstream — who consumes what changes?**
```
$ grep -rln "reasons\[" --include="*.ts" --include="*.mjs" hooks/ | grep -v node_modules
hooks/sessionstart-tool-enum.mjs
hooks/userpromptsubmit-halt-relay.mjs
```
- `inspectHaltState` (`userpromptsubmit-halt-relay.mjs:144-160`) validates only `typeof entry.set !== "boolean"` — it does **not** reject unknown extra fields on a reason entry. Adding a `cause` field is additive and backward-compatible with the existing strict validator: **confirmed by code trace, not assumed.**
- `hooks/sessionstart-tool-enum.test.ts` and `hooks/userpromptsubmit-halt-relay.test.ts` (test-writer's answer-key, unmodified per this project's own DoD) reference `halt-state` but never reference `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` (confirmed by the same grep at the top) — **Candidate A's N1 fix touches zero test-writer-owned files.** Low collateral risk on that axis.
- `hooks/test-support/fixture-tree.ts`/`spawn-hook.ts` (shared helpers, used by both answer-key and fixnow tests) are NOT touched by an argv-based N1 fix unless `runHook`'s signature needs a dedicated argv-passing parameter — worth checking at build time whether the existing `envOverrides` param is reused (no signature change) or a new param is added (signature change, touches every call site across 2 fixnow test files, ~20+ call sites per the round-2 report's own test count).
- Finding 6's guard (never `set:false` the `unknown-session` bucket) touches exactly one function, `reconcileReason`, called 3 times inside `main()` — the guard is a single early-return, not three separate edits.

**Invariant delta:**
- Before: the fixture path Claude Code's hook process reads was resolvable by anything that can set an env var in that process's ancestry. After: it is resolvable only by an argv value the checked-in `.claude/settings.json` command string does not pass — a genuinely narrower, git-visible-only surface. **Who depended on the old, wider surface?** Only the 4 legitimate test call sites, already migrating.
- Before: the `unknown-session` bucket could be cleared by any invocation that resolved that bucket, regardless of which real session wrote the active reason. After: it is additive-only — once set, it stays set until a human clears the file by hand. **Who depended on the old, clearable behavior?** Nobody legitimately; AC5's own test suite exercises SessionStart-reconciliation for *real* session ids, not the fallback bucket, per the round-2 report's own C11 confirmation ("AC-4's no-file contract... `reconcileReason` only writes set:false when `wasReasonActive` is true" — that test target was a real session id, not `unknown-session`). **This restores exactly the pre-round-2 stuck-direction behavior for the fallback bucket only — it does not newly break anything, it un-fixes one narrow side effect of round 2's own AC5 fix.**

**Whack-a-mole verdict:**
- N1: **CONTAINS**, conditional on the resolved path also being recorded in the halt-state file (red-team's own stated prerequisite for N2 to mean anything) and on the new seam being genuinely git-visible-only. Defect class: "an ambient-environment override with no forensic trace." Prior-fix count in this class: **0** (this is the first time this exact class has been named in S5's history) — not yet structural, but see the cross-cutting note below.
- N2: **CONTAINS.** Defect class: "a claimed invariant pinned by shape-check, not exact-value." Prior occurrence: round 1's F10/Issue #98 was the *same class* one level up (allowlist *contents* pinned only after red-team demonstrated a hostile-entry mutation survived; C3 now confirms that pin holds). **This is the second time in two consecutive review rounds that the same fixture has shipped with an un-pinned property discovered by mutation, not by design** — round 1 found the allowlists unpinned, round 2 finds the date unpinned. Two instances of the same class, same artifact, meets this project's own "2 or more" bar.
- N3: **CONTAINS or RELOCATES depending on implementation**, per the upstream note above (structured `cause` field vs. string-match hack). Defect class either way: "the message layer's static hint table is blind to *why* a reason fired, only to *which* reason fired." This is the same shape as round-1's original Issue #94 gap (no unlock at all) generalized one level: first "no hint," now "hint blind to cause." **Second occurrence of a message-layer under-specification in as many rounds** — also meets the "2 or more" bar, independent of N3's own final disposition.
- Finding 6: **RELOCATES, correctly and deliberately.** It moves the defect from "fail-open on a collision in the shared fallback bucket" (round 2's new, worse direction) back to "fail-stuck on a collision in the shared fallback bucket" (round 1 and earlier's pre-existing, disclosed, deferred Issue #96). It does **not** contain the underlying class ("a hook that cannot resolve its own session identity shares a literal bucket with every other hook that also can't") — that class stays open, tracked, spike-deferred, exactly as the human already ruled 2026-09-07. This is the right direction to relocate it toward (safe-stuck, not fail-open), which is why app-security accepted it as a condition rather than a blocker.
- N4/Finding 7: **CONTAINS.** Mechanical regex range extension, no new surface.

**Structural finding (2+ prior fixes in this class):** the fixture (`docs/qa/s5-central-classification.json` + `central-classification.ts`) has now had two consecutive review rounds each surface a different unpinned/unenforced property of the same artifact (round 1: allowlist contents; round 2: expiry date). The absence is a mechanical guard, not a missing test: nothing walks the fixture's own declared shape and requires an exact-pin assertion per field. Recommend (not design) a structural check — a test or lint rule that fails whenever `central-classification.test.ts` does not carry an exact-equality assertion for every top-level field the parser accepts.

**Ledger:**
```
Candidate A: touches 5-7 files / ~10 call sites (sessionstart-tool-enum.mjs's computeSessionTools+reconcileReason,
userpromptsubmit-halt-relay.mjs's UNLOCK_HINTS+sanitizeDetail+inspectHaltState-adjacent read,
central-classification.test.ts, sessionstart-tool-enum-fixnow.test.ts [4 call sites migrating],
userpromptsubmit-halt-relay-fixnow.test.ts [new]) · new preconditions: 2 (halt-state reason entries
gain an optional `cause`/resolved-path field consumers must tolerate; the unknown-session bucket
becomes additive-only, an asymmetry a future maintainer must know about) · migration: no (.thoth/halt-state/
is gitignored, no persisted external state) · reversible: yes (git revert; no schema migration) ·
exposure if wrong ~100% of this repo's own SessionStart/UserPromptSubmit-gated sessions (both hooks are
live-wired in .claude/settings.json today, confirmed above), basis: counted-in-code · residual if NOT
fixed ~100% of the exemption+expiry control surface for N1 (red-team's own measured figure, security-
category, exempt from PRINCIPLES rule 21's 3% cap) — Candidate A is therefore not optional against N1,
it is the floor.
```

**Verdict: SAFE-TO-PATCH**, conditional on N3 landing as a structured field (not a string-match hack) and N1's fix including the "record the resolved path" half red-team named as a prerequisite for N2 to matter. Neither condition changes the classification or file count materially — both are quality-of-implementation choices inside the same bounded diff.

---

## Candidate B — trust-boundary redesign

**What it does, as specified:** (a) hardcode the fixture path with zero indirection (no env var, no override mechanism of any kind), and/or (b) restructure the whole exemption+reconciliation mechanism to eliminate "one session's resolved state affects another's" structurally.

**Classification: systemic.** This is not a boundary crossing inside the existing shape — it changes the shape itself: the fixture-load contract every future consumer of `central-classification.ts` inherits, and the session-identity resolution contract both hooks currently share informally via a literal string.

### (a) Zero-indirection fixture path

**Upstream check — can the one legitimate producer (tests) satisfy "zero indirection" today?**
```
$ grep -c "THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH" hooks/sessionstart-tool-enum-fixnow.test.ts
4
```
No. All 4 of `sessionstart-tool-enum-fixnow.test.ts`'s own tests rely on injecting a synthetic fixture (one active, one pre-expired) through a **real spawned hook process** — the exact property both `app-security-reviewer` ("through a real spawned hook process, not just a unit-level function call") and `cross-domain-reviewer` ("Demonstrated, not just traced") singled out as this fixture's strongest evidence this round. "Zero indirection" cannot satisfy this producer without one of:
1. Dropping black-box, real-process coverage of the runtime-expiry behavior entirely, falling back to `central-classification.test.ts`'s pure-function unit tests only (already present, AC1-a/b/c) — a real loss of the exact test class both reviewers just credited.
2. Writing over the real committed fixture file on disk during test runs and restoring it after — a strictly worse indirection than an env var: it risks corrupting the ratified, human-reviewed `docs/qa/s5-central-classification.json` on a mid-run crash, races under any parallel test execution, and is harder to reason about than what it replaces.
3. Converging back onto an argv-based seam scoped to the checked-in command string — which is Candidate A's own N1 remedy, just described as "zero indirection" while actually keeping a narrow, git-visible one.

**Verdict on (a): RELOCATES.** "Zero indirection" as literally stated does not survive contact with the one legitimate producer without either degrading test evidence (a real regression against what this round's reviewers just praised) or introducing a worse indirection (path 2). Path 3 collapses into Candidate A. There is no fourth option visible in this codebase's current test-harness shape (`hooks/test-support/spawn-hook.ts`'s `runHook` genuinely spawns a child process; there is no dependency-injection point for the fixture path other than env/argv/file-on-disk).

### (b) Structural redesign of session-identity resolution / reconciliation

**Downstream — who is committed to the current shared-fallback shape?**
```
$ grep -n "sessionId" hooks/sessionstart-tool-enum.mjs hooks/userpromptsubmit-halt-relay.mjs | grep -c "unknown-session\|session_id"
```
Both hooks independently derive `sessionId` from `input.session_id`, falling back to the literal `"unknown-session"` — this is a duplicated, uncoordinated contract (2 production sites, confirmed above), not a shared module either hook imports. A structural fix (e.g., requiring `session_id` as a hard precondition, or deriving a collision-free per-invocation fallback) touches **both** hooks' `main()` functions and every test that constructs a hook-invocation payload without a `session_id` (a mechanical count of those fixtures is itself needed before scoping this — not yet run, since Candidate B is not yet a committed design).

**This is exactly the redesign PRINCIPLES rule 18 and the human's own 2026-09-07 ruling already declined to do now:** `docs/backlog.md`'s Issue #96 entry states plainly that both candidate fixes "rest on an unmeasured or risky assumption" — (a) `CLAUDE_CODE_SESSION_ID`'s presence in the hook's real process env, never confirmed in this repo; (b) teaching the relay to also consult `unknown-session.json`, which the human's own ruling says "risks regressing the already-tested session-isolation guarantee." A structural redesign attempted now, inside a CRITICAL-tier fix-now round, builds on the same unmeasured fact rule 18 already flagged — this is not new information Candidate B brings, it is the same gap, attempted anyway.

**Verdict on (b): UNKNOWN, trending WIDENS.** I cannot trace whether "require `session_id`" is safe, because nobody has confirmed whether `session_id` is ever legitimately absent on this runtime (e.g., a very first SessionStart before Claude Code assigns one) — the same unconfirmed fact the human's own ruling names. If a hard-fail-on-missing-`session_id` redesign is wrong about that assumption, it converts a narrow, disclosed, low-likelihood collision bug (current state) into a session that cannot start at all on whatever invocation shape actually lacks `session_id` — a strictly larger blast radius than what it replaces. This is not a hypothetical: PRINCIPLES rule 18 exists precisely to stop a fix from resting on exactly this kind of unmeasured number, and it was already invoked once, days ago, for this exact gap.

**Also relevant — the S6 precedent question, already on record:** `docs/reviews/s5-cross-domain-round2-2026-09-07.md`'s own [SUSPICION][LOW][derived] finding (its item 6 in this section) names `central-classification.ts` + the JSON fixture as "a real, working precedent for S6's eventual central-override loader shape" that "nobody has yet ruled on whether S6 should keep, generalize, or discard." A structural redesign of this exact mechanism, done now, as an unplanned fix-now round, pre-empts that S6-intake-time decision in the opposite direction from what cross-domain-reviewer flagged as the risk — instead of the shape being "silently inherited by default because it already exists," it would be silently *replaced* by default because a fix-now round needed to close a narrower finding. Neither is a deliberate S6-intake-time architectural decision. S6 (Milestone #24) is the actual downstream consumer of whatever shape this mechanism ends up taking; committing to a new shape without S6 ever being planned constrains that story's own design space before it exists.

**Ledger:**
```
Candidate B: touches an UNBOUNDED file count until scoped (both hook main()s, every test fixture
constructing a hook payload — not yet mechanically counted, because this is not a committed design) ·
new preconditions: at least 1 unverified (session_id presence contract) treated as newly-hard rather
than newly-soft · migration: no code migration, but a de facto architectural precedent-setting decision
for S6, unrecorded as such · reversible: yes at the code level, no at the "S6 now has one fewer live
option to evaluate deliberately" level · exposure if wrong: UNBOUNDED — a wrong assumption about
session_id availability can brick session start entirely, basis: assumption (the same unmeasured fact
PRINCIPLES rule 18 already named) · residual if NOT done: identical to Candidate A's Finding-6 residual
(Issue #96 stays open, tracked, spike-deferred) — Candidate A already delivers this same residual
outcome without the added redesign risk.
```

**Verdict: REDESIGN-REQUIRED is the wrong frame here — this is DEFER, not build now, not as a fix-now round.** Per (a), the "zero indirection" claim doesn't survive its own producer without becoming Candidate A. Per (b), attempting it now violates PRINCIPLES rule 18 on a fact the human already ruled unmeasured, and pre-empts an S6-intake decision cross-domain-reviewer explicitly asked to be made deliberately, not by accident.

---

## Candidate C — ship with residuals as day-1 failing tests

**What it does:** accept the current diff as-is, convert every open finding (N1-N4, Finding 6, Finding 7) into a named failing test, ship anyway.

**Pricing, honestly, per the instruction not to default to it:**

PRINCIPLES rule 16's own "ship now" default is explicitly conditioned on "no OPEN finding is a calibrated blocking HIGH." N1 is `[ISSUE][HIGH][demonstrated]`. Rule 21's narrow-exposure cap (which could otherwise route a `[HIGH]` to Manager triage instead of a hard block) does **not** apply here on two independent grounds:
1. **Category exemption.** N1 sits squarely in CLAUDE.md's own named sensitive areas — "Policy enforcement / session gates" (`hooks/userpromptsubmit-halt-relay.mjs` is listed by name) and "Policy delivery / config surface" ("anything that changes how policy is authored or delivered to the enforcement point"). Rule 21 states plainly: "Security, data-integrity, legal, and safety findings are exempt from this cap regardless of stated exposure."
2. **Exposure magnitude, even if the exemption didn't apply.** Red-team's own figure is "~100% of the exemption+expiry control surface, basis: measured" — nowhere close to the <3%-of-users threshold rule 21 requires even for a narrow-blast-radius `[HIGH]` to be eligible for the triage cap.

**Verdict: NOT VIABLE as specified.** Candidate C as a blanket "ship everything as residuals" strategy fails at N1 by the charter's own mechanical rule, not by my judgment call — this is a `code-traced` reading of PRINCIPLES.md rule 21 against `red-team`'s own demonstrated exposure line, not a derived opinion.

**A narrower variant is priceable, and I show it honestly rather than dodge the question:** fix N1 only (mandatory, per above), and ship N2/N3/Finding 6/N4-Finding7 as tracked day-1 failing tests / commented-on-existing-Issues residuals. This is not really "Candidate C" — it is Candidate A with N2/N3/N4/Finding-6 deferred rather than fixed same-round. Priced:
```
Candidate C (narrow variant — N1 fixed, rest deferred as tests): touches 1-2 files / ~3 call sites
(sessionstart-tool-enum.mjs's fixture-path read site + its one fixnow test file's 4 usages) ·
new preconditions: 0 beyond N1's own · migration: no · reversible: yes · exposure if wrong ~100% of
the exemption+expiry control surface (same N1 figure, unchanged whether N2-N4/6 ship now or later) ·
residual if NOT fixing N2/N3/Finding-6/N4 now: N2 ~100% of the time-boxing property (measured, but
LOW-velocity — the fixture's own AC1-c already fails CI the day it matters, so this residual has a
real, already-built tripwire); N3 ~100% of local sessions from 2026-10-07 (counted-in-code, and
genuinely date-bounded — 30 days out, not open-ended); Finding 6 narrow/compound precondition,
MED per app-security's own calibration, already the accepted disposition; N4/Finding-7 0% under
committed settings (counted-in-code, non-zero only on a boolean flip this repo doesn't set).
```
This narrow variant is defensible **only** for N2/N3/N4/Finding-6 — each has either a build-time tripwire already in place (N2), a bounded/dated blast radius (N3), a narrow already-accepted-direction disposition (Finding 6), or zero exposure under current settings (N4/7). None of the four is itself a `[HIGH]`. But it buys almost nothing over Candidate A in file-touch cost (N2-N4/Finding-6 are each 1-2 line changes per the reviewers' own "minimal fix" language) while leaving four named, already-diagnosed gaps open against a CRITICAL-tier, human-ratified security mechanism for no measured savings. I do not recommend it, but it is not dishonest to price it as viable-if-narrowed, unlike full Candidate C.

---

## Recommended path

**Candidate A**, full scope (all five sub-fixes in one more focused fix-now round), conditioned on N3 using a structured cause field and N1 recording its resolved path. It is the only candidate that closes the mandatory-blocking N1 without either degrading this round's own best test evidence (Candidate B-a) or building on an unmeasured fact the human already ruled unmeasured six days ago (Candidate B-b), and it costs the same handful of files Candidate C's narrow variant would cost anyway, while actually closing N2-N4/Finding-6 rather than leaving four diagnosed, minimal-fix gaps open against a named sensitive area.

**Strongest argument against my own recommendation:** Candidate A is now a *third* fix-now round on the same CRITICAL-tier artifact in one day (round 1: KNOWN_CONNECTORS/centralLayer; round 2: the fix that introduced N1; round 3: this one) — PRINCIPLES rule 16(c)'s own trigger exists precisely because a fix-now round that keeps fixing the previous round's own fix is a whack-a-mole pattern, and the honest reading of my own structural findings above (N2 and N3 are each the *second* occurrence of their class within two rounds) is that this artifact's problem may not be any single finding but the review cadence itself: a small, disclosed, dated-residual fixture is being iterated under CRITICAL-tier full-ceremony pressure faster than its own test coverage can mechanically keep up with each new property someone notices. If a fourth round finds a fifth unpinned property, that is the signal to stop patching and build the structural guard (the "every fixture field gets an exact-pin test" instrument named above) rather than hand-writing a sixth named test.

## Structural findings (2+ occurrences)
1. **The `s5-central-classification.json` fixture has had an unpinned/unenforced property surface in each of its first two review rounds** (round 1: allowlist contents; round 2: `expiresOn`'s value). Guard needed: a mechanical instrument that requires an exact-pin assertion for every field the parser accepts, not a human noticing the next one.
2. **The message layer (`UNLOCK_HINTS`) has been under-specified relative to the halt condition in each of its first two review rounds** (round 1: no hint at all, Issue #94; round 2: hint blind to cause, N3). Guard needed: a structured cause/reason-shape on the writer side that the message layer keys off, rather than free text the message layer has to interpret or ignore.

## Unmeasured
- Whether `session_id` is ever legitimately absent on a real Claude Code invocation (blocks Candidate B-b entirely; also blocks Issue #96's own eventual real fix) — command that would settle it: a spike instrumenting the real hook process's env/stdin across a sample of real SessionStart/UserPromptSubmit invocations, per the human's own 2026-09-07 ruling, not yet run.
- Real-world frequency of two colliding `unknown-session` writes within one relay-check window (Finding 6's actual trigger rate) — `basis: assumption` per red-team's own N5 suspicion; command: instrument SessionStart to log (not act on) concurrent-invocation timestamps for one week of real usage once S5 ships.
- Exact file/call-site count for a hypothetical argv-signature change to `runHook` (only needed if Candidate A's N1 implementation adds a new parameter rather than reusing `envOverrides`) — not counted because the implementation choice isn't made yet; command: `grep -rn "runHook(" hooks/*.test.ts` once the choice is made.

## The single change most likely to be regretted in a month
**Fixing N3 (the post-expiry unlock message) by pattern-matching on the `detail` string instead of adding a structured `cause` field to the halt-state schema.** It would close today's demonstrated finding, pass the named proof-test, and look done — and then silently break the next time anyone touches `detail`'s wording for an unrelated reason (a fifth sanitization tweak, a phrasing cleanup, a future reason key), with no test catching the drift because the coupling was never named as a coupling. This is exactly this project's own named failure pattern (a fix-now round solving the sentence in front of it) reproduced one level down inside the very round meant to close the last instance of it.

---

RECEIPT: verdict=PATCH-WITH-CONDITIONS
candidates (ALL of them, one terse line each, ranked by risk):
1. [SUSPICION][MED][derived][~unbounded, assumption] Candidate B-b (structural session-identity redesign) — builds on the same unmeasured session_id-presence fact PRINCIPLES rule 18 and the 2026-09-07 human ruling already named unmeasured; if wrong, converts a narrow disclosed collision bug into a session that cannot start. UNKNOWN trending WIDENS.
2. [SUSPICION][LOW][code-traced][producer-count=1] Candidate B-a (zero-indirection fixture path) — the one legitimate producer (4 test call sites) cannot be satisfied without degrading this round's own best-credited test evidence or introducing a worse indirection (mutating the real fixture file on disk); the only surviving option collapses into Candidate A. RELOCATES.
3. [ISSUE][LOW][code-traced][~0% under committed settings] Candidate A's N3 sub-fix, if implemented as a string-match on `detail` rather than a structured `cause` field — CONTAINS today, silently becomes RELOCATES on the next unrelated `detail`-wording change. Flagged as an implementation-choice risk inside an otherwise-clean candidate, not priced as its own path.
4. [CLEAN][code-traced][producer/consumer counts above] Candidate A (targeted mechanical patch, full 5-part scope) — N1/N2/N4-Finding7 CONTAIN cleanly; Finding-6 correctly RELOCATES the defect back to its pre-round-2 safe-stuck direction (matching app-security's own accepted disposition); N3 CONTAINS conditional on structured implementation (see line 3). No producer/consumer left unsatisfied; zero migration; fully reversible.
5. [CLEAN][code-traced] Candidate C, full scope (ship all findings as residuals) — NOT VIABLE: N1 is a demonstrated HIGH in a CLAUDE.md-named sensitive area, exempt from PRINCIPLES rule 21's exposure cap regardless of its own ~100%-measured figure exceeding that cap anyway. Correctly excluded, not a live option.
6. [CLEAN][code-traced] Candidate C, narrow variant (N1 fixed, N2/N3/N4/Finding-6 deferred as tests) — viable but priced at near-identical file-touch cost to fixing them outright, for no measured savings; not recommended.
counts (CHECKSUM): issues=1 suspicions=2 clean=3
evidence (CHECKSUM): demonstrated=0 code-traced=5 derived=1
traced: upstream=2 producers (1 legitimate env-var producer, 1 fixture consumer) downstream=9 consumer files (2 production writer/reader, 4 test files, 1 shared test helper pair, 1 mcp-enumeration comment reference — enumerated, not estimated) structural=2 classes fixed/found 2+ times (unpinned fixture property; under-specified unlock message)
recommended=Candidate A (full 5-part scope, conditioned on structured N3 cause field + N1 recording its resolved path)
unmeasured=3
checks=n/a (no code run — this is a pre-fix impact analysis; all counts are grep/read-derived, commands pasted above)
adr=HIT(35)
report=docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md
