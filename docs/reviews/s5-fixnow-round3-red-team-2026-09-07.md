# Red Team (Sutekh) — S5 fix-now build, ROUND 3 (terminal re-confirm)

**Scope:** `scope=s5-fixnow-round3` / `tier=CRITICAL` (Milestone #23). Target: the council-ratified Path A patch against my round-2 report (`docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md`) and `architecture-reviewer`'s council seat (`docs/reviews/s5-central-classification-architecture-council-2026-09-07.md`).
**Date:** 2026-09-07
**Reviewer:** `red-team` (Sutekh), round 3
**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
**HEAD:** `1fa39f1` (build uncommitted)
**Verdict:** **go** — all four claimed closures independently re-verified by re-running my own round-2 repros. One new MED, UNPROVEN, non-blocking.

**Mandate:** narrow. Four specific fixes re-confirmed, not a re-run of the full round-1/round-2 attack surface (frozen). Anything genuinely new is flagged but not permitted to expand the round unless blocking.

---

## 0. Ground rules

Same as round 2. KNOWN_CONNECTORS' spoofability is human-ratified as a disclosed, dated interim residual and is **not** re-flagged. Every hook invocation ran against synthetic HOMEs in the scratchpad, seeded only with names already published in my own prior reports and in this repo's committed fixture. I did not read, execute against, or dump `~/.claude.json`.

Every mutation I applied was restored and verified byte-identical by `sha256sum` before this report was written.

---

## 1. The four claimed closures — re-verified

### R1 — [CLEAN][demonstrated] N1 / Issue #99: the env-var fixture override is genuinely inert, not merely moved

`THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` is gone from the production path. `grep` across `hooks/`, `src/`, `docs/qa/` returns it only in review reports, in one in-code comment documenting its removal (`hooks/sessionstart-tool-enum.mjs:264`), and in the regression test that asserts it does nothing.

I re-ran my **exact** round-2 attack — same attacker fixture, same synthetic home, same hook.

```
=== E1: control, no env var ===
exit=0
  SUR-03-unclassified-tool      set=true | unclassified: brand-new-unreviewed-mcp
  SUR-03-unclassified-connector set=true | connector identity present: claude.ai EvilExfil

=== E2: EXACT round-2 attack -- env var -> attacker fixture (2099 expiry, both entities allowlisted) ===
exit=0
  SUR-03-unclassified-tool      set=true | unclassified: brand-new-unreviewed-mcp
  SUR-03-unclassified-connector set=true | connector identity present: claude.ai EvilExfil
```

Round 2, the identical input flipped both to exempt. Now it changes nothing.

**The live-shell claim, independently verified.** The implementer reported this var was still set in this environment as a leftover from my own round-2 PoC. Confirmed, and confirmed inert without touching it:

```
$ env | grep THOTH
THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH=/tmp/attacker.json

=== E2b: var inherited from THIS LIVE SHELL, untouched ===
exit=0
  SUR-03-unclassified-tool      set=true | unclassified: brand-new-unreviewed-mcp
  SUR-03-unclassified-connector set=true | connector identity present: claude.ai EvilExfil
```

**The new fallback path, attacked on its own terms.** `DEFAULT_FIXTURE_PATH` (`central-classification.ts:54-55`) is `dirname(fileURLToPath(import.meta.url))` + `../../../docs/qa/s5-central-classification.json` — it resolves to the same committed repo file, via the module's own location, immune to `cwd` and to `CLAUDE_PROJECT_DIR`. There is no second physical copy to poison. The fallback direction is also the safe one: a tree with no fixture of its own reads the **real** committed fixture, never "no fixture -> exempt everything." That is a genuine hardening over round 2 and I credit it.

The regression test (`hooks/sessionstart-tool-enum-fixnow.test.ts:144`) is non-vacuous — it asserts `haltState === undefined` on a vanilla session with the var pointed at a bogus path, so it fails both if the var is honored and if a bogus path fails closed.

**SURVIVES. Issue #99 genuinely closed.**

### R2 — [CLEAN][demonstrated] N2 / Issue #100: expiresOn is pinned to the exact ratified value

My own independent mutation, `2026-10-07` -> `2099-01-01`, nothing else touched:

```
$ npm test
x S5-R2-N2: the committed fixture's expiresOn is pinned to the EXACT ratified date, not merely
  'some future date' -- rolling it forward (by one day or one century) must fail this test...
  AssertionError: docs/qa/s5-central-classification.json's expiresOn (2099-01-01) drifted from the
  exact date ratified in docs/decisions.md's 2026-09-07 row -- a NEW expiresOn requires a fresh,
  dated, human-ratified decisions.md row AND a deliberate edit to this assertion together, never a
  silent fixture-only extension
  + actual: '2099-01-01'   - expected: '2026-10-07'
```

Round 2, the same mutation left 543/543 and all four QA gates green. It now fails by name with a message that states the correct remedy. Fixture restored; `sha256sum` identical (`f1ea578d...`).

**SURVIVES. Issue #100 genuinely closed.**

### R3 — [CLEAN][demonstrated] N3 / Issue #101: the post-expiry unlock hint now actually unlocks

My exact round-2 "follow the unlock instruction literally" drill, real fixture contents with `expiresOn` moved into the past (identical computation to advancing the wall clock, since `isFixtureExpired` is `now >= expiry`):

```
=== step 1: SessionStart, expired fixture ===
  SUR-03-unclassified-tool         set=true
  SUR-03-unclassified-connector    set=true
  SUR-03-central-fixture-expired   set=true | ...expired on 2026-09-01 -- both interim allowlists
                                              have reverted ... regardless of their listed contents

=== step 2: relay ===
RELAY EXIT=2, and the message now carries a THIRD, distinct hint:
  "unlock: the exemption fixture ITSELF has expired (this is NOT the same as an unlisted name --
   re-adding an already-listed tool/connector name will NOT unlock this, since expiry reverts BOTH
   allowlists regardless of their contents) -- re-ratify with a NEW expiresOn via a fresh, dated
   docs/decisions.md row ... or remove the exemption outright"

=== step 3a: follow the OLD hints literally (re-add already-listed names) ===
RELAY EXIT after following hint #1 literally = 2      <- still a no-op, as before

=== step 3b: follow the NEW expiry hint literally (fresh expiresOn) ===
  SUR-03-unclassified-tool        set=false
  SUR-03-unclassified-connector   set=false
  SUR-03-central-fixture-expired  set=false
RELAY EXIT after following the NEW expiry hint = 0    <- UNLOCKS
```

Round 2's answer to "does following the message unlock the session?" was no. It is now yes. The expiry cause is a distinct reconciled reason key (`FIXTURE_EXPIRED_REASON_KEY`, `sessionstart-tool-enum.mjs`), so the relay can branch on it rather than guess — the exact shape my round-2 named proof-test required. The new hint also pre-empts the two stale hints in the same message by naming re-adding as a no-op.

**SURVIVES. Issue #101 genuinely closed.** (One ergonomic residual on hint ordering — Editorial item 1, verdict-neutral.)

### R4 — [CLEAN][demonstrated] app-security's #96 escalation: the shared fallback bucket no longer clears a foreign halt

My own two-invocation collision repro, isolated tree:

```
=== A: garbage stdin (session_id unresolvable) -> genuine halt in the shared bucket ===
  exit=0    SUR-03-enumeration-failed set=true

=== B: DIFFERENT logical session, also fails session_id resolution, CLEAN config ===
  exit=0    SUR-03-enumeration-failed set=true     <- A's halt NOT cleared

=== relay for the shared bucket ===
  RELAY EXIT=2   (2 = A's halt survived; 0 would be fail-open)
```

**And I proved the guard is load-bearing rather than incidental** — mutation test, disabling only the `sessionId === UNKNOWN_SESSION_ID` branch (`reconcileReason`, `sessionstart-tool-enum.mjs:196`):

```
$ (mutate: "} else if (sessionId === UNKNOWN_SESSION_ID) {"  ->  "} else if (false) {")
  WITH GUARD DISABLED, RELAY EXIT=0    (A's halt WAS cleared -- guard IS load-bearing)

$ npm test
x S5-R2-Issue96-escalation: the shared 'unknown-session' fallback bucket is NEVER reconciled to
  set:false -- a second, different colliding invocation whose OWN condition is resolved must not
  silently clear a still-active halt that belongs to a different invocation
```

The fix is real, the named test catches its removal, and the escalation is relocated to its pre-round-2 safe direction (stuck-blocked, not fail-open). Hook restored; `sha256sum` identical (`44083f5e...`).

**SURVIVES.** Issue #96 itself stays **OPEN** — only the round-2 *escalation* is closed; the underlying deferred defect (the relay never reads the unknown-session bucket for a real session) is unchanged and correctly still deferred, spike-first.

---

## 2. New this round — flagged, not expanded

### R5 — [SUSPICION][MED][demonstrated at hook level; basis: assumption at production reachability] The policy source is now selected by `CLAUDE_PROJECT_DIR`, which is still an ambient environment signal

**Attack.** The fix replaced a bespoke env var with `join(projectDir(), "docs","qa","s5-central-classification.json")`, and `projectDir()` is `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()` (`sessionstart-tool-enum.mjs:118-120`). The council's own condition 1 said the replacement must never be "a signal that lives in the same process-environment namespace Claude Code's own `env` settings key writes into." `CLAUDE_PROJECT_DIR` lives in exactly that namespace.

**Demonstration, at the hook boundary:**

```
=== E3: attacker fixture planted at the CLAUDE_PROJECT_DIR-relative path ===
env -u THOTH_... CLAUDE_PROJECT_DIR=<attacker tree> HOME=<real home>
exit=0
(NO HALT FILE -- both unreviewed entities EXEMPTED)

=== E3b: relay ===
RELAY EXIT=0
```

Same outcome as round-2 N1: allowlists and expiry both replaced. Note the asymmetry that makes this a privilege crossing rather than a wash — connector identities are read from `homeDir()`, which `CLAUDE_PROJECT_DIR` does **not** redirect, so the attacker redirects the *policy* without redirecting the *input it judges*. The council's justification for treating `CLAUDE_PROJECT_DIR` as benign ("the session already has unrestricted write access to everything it redirects") held while that var only selected `.claude/settings.json` and `.mcp.json` — the things being judged. It now also selects the judge.

**Why this is UNPROVEN and not a blocker.** The production delivery vector is unestablished. Vendor docs (`https://code.claude.com/docs/en/hooks`) state Claude Code **always injects** `CLAUDE_PROJECT_DIR` into hook subprocesses, and are **silent** on whether a settings `env` block can override an injected variable. That is the opposite of round-2 N1, where the bespoke var was *never* set by Claude Code, so ambient always won. I could not settle the precedence question from this sandbox, and I will not upgrade a hook-level behaviour into a production finding without it. The `process.cwd()` leg is separately safe: a cwd with no `docs/qa/` fixture falls back to the module-adjacent real one.

**Current defense, honestly assessed.** Partial and undocumented. There is no allowlist of permitted project dirs, and the hook still records nowhere which fixture path it resolved — so if the override *is* reachable, it is as silent as N1 was. Against that: the attack now needs two conditions (control of `CLAUDE_PROJECT_DIR` **and** a planted `docs/qa/` tree) instead of one, and it must beat Claude Code's own injection.

**Exposure: unquantified at production; ~100% of the exemption+expiry surface at the hook boundary, basis: assumption for the production leg** (per PRINCIPLES rules 18/21 this caps the finding, and the only recommendation permitted is "measure it"). 0% against today's deployment either way — `PreToolUse` is unwired.

**Verdict: UNPROVEN-pending-verification.** Cannot gate. This is a task, not a blocker.

**Named settling drill (pre-activation, before `PreToolUse` goes live), runnable by the human operator on a real Claude Code session, ~5 minutes:** put an `env` block setting `CLAUDE_PROJECT_DIR` to a scratch tree in `.claude/settings.local.json`, start a session, and print `process.env.CLAUDE_PROJECT_DIR` from the SessionStart hook. If Claude Code's injection wins, R5 is closed as unreachable and should be recorded as such. If the `env` block wins, R5 becomes a demonstrated HIGH with the same shape as N1 and must be fixed before activation — the fix being to resolve the fixture solely from `DEFAULT_FIXTURE_PATH` (module-adjacent, already immune) and record the resolved path in the halt-state file.

### R6 — [ISSUE][LOW][code-traced] Round-2 N4 carried forward unchanged — not claimed closed, correctly

`sanitizeDetail` is still `text.replace(/[\x00-\x1F\x7F]/g, "")` (`userpromptsubmit-halt-relay.mjs:92`). U+2028/U+2029/U+0085/U+009B/U+202E/U+200B still survive; the bidi-override display-spoofing case is the one with teeth. The impact-analyst's Candidate A listed this as item (5) of the patch; it did not ship. It was never in this round's claimed-closed set, it was LOW in round 2, and **Exposure: 0% under this repo's committed settings, basis: counted-in-code** (`isProjectMcpServerEnabled`, unchanged). Non-blocking, carried. No new Issue — this is round-2 N4's locus, already reported there.

---

## 3. Independent re-verification of the build receipt's claims

```
$ npm test
tests 547   pass 547   fail 0   cancelled 0   skipped 0   todo 0   duration_ms 20638.0435
```

**547 pass / 0 fail / 0 skipped — the implementer's RECEIPT figure is correct this round.** Round 2's real count was 543, so this patch added 4 tests. (Round 2's receipt claimed 551 against a real 543; that hand-typed-count defect did not recur.)

```
$ npm run typecheck                  clean (rc=0)
$ npm run lint                       clean (rc=0)
$ npm run qa:gate-command-path       PASS: 2 command-type hook entries checked, every referenced script resolves
$ npm run qa:gate-manifest           PASS: Exactly 1 gate manifest found: .claude/settings.json
$ npm run qa:gate-matcher-drift      PASS: 19 referenced tool name(s), all present in the vendored snapshot
$ npm run qa:runtime-settings-drift  PASS: 18 vendored runtime-settings key(s)
```

**test-writer's two files are byte-unchanged**, verified by blob hash against HEAD rather than by eyeballing a diff:

```
$ git diff --stat -- hooks/sessionstart-tool-enum.test.ts hooks/userpromptsubmit-halt-relay.test.ts
(no output -- zero diff)
$ git status --porcelain -- <same two paths>
(no output -- clean)
$ git hash-object <f>  vs  git rev-parse HEAD:<f>
hooks/sessionstart-tool-enum.test.ts       worktree=020af86e... HEAD=020af86e...   IDENTICAL
hooks/userpromptsubmit-halt-relay.test.ts  worktree=d7813508... HEAD=d7813508...   IDENTICAL
```

DoD's "answer key unmodified" requirement holds.

---

## 4. Working tree

All mutations restored and verified:

- `docs/qa/s5-central-classification.json` — `sha256 f1ea578dc0e46c09917d3c29d9da0caf2465e1b4104830b1335dc560986425ad`, matches pre-review backup.
- `hooks/sessionstart-tool-enum.mjs` — `sha256 44083f5e0188a0ee7c64c97fc5b992be9760cda44c484f203e369364126b404b`, matches pre-review backup.
- `git status --porcelain` shows only the expected build paths; no harness debris, no planted settings file, nothing left in `.thoth/halt-state/`.

---

## 5. Editorial (verdict-neutral, plain edits, no re-review)

1. The expired-fixture block message emits all three hints in reason-key order, so the operator reads the two *stale* hints ("reclassify the tool", "add the connector's exact display name") before the correct one, at the end of a ~1900-character single line. The new hint explicitly negates them, so the message is self-correcting if read fully — but ordering the causally-correct hint first (or suppressing the other two when `SUR-03-central-fixture-expired` is set) reads better under stress.
2. Round-2 editorial item 4 not fixed: `hooks/userpromptsubmit-halt-relay.mjs:74-75` still reads "closing the injection channel this diff would otherwise widen." It narrows it — R6 shows six characters still pass. Should read "narrowing."
3. Round-2 editorial item 2 not fixed: `src/policy/tools/mcp-enumeration.ts:78` still reads "A connector's mere presence is unconditionally reported this way." False at the system level — the hook filters through `knownConnectors`.
4. Round-2 editorial item 3 (the relay's miscounted "three call sites") — not re-checked this round; out of the narrow mandate.

---

## 6. Open findings vs. failing tests

**1 open finding (R6), 1 named test case** — already named in round 2 and unchanged: `hooks/userpromptsubmit-halt-relay-fixnow.test.ts` -> "S5-R2-N4: Unicode line-separator, bidi-override and zero-width characters are stripped alongside ASCII controls."

R5 is a `[SUSPICION]` with no executable form in this sandbox; it carries the named human drill in section 2 instead, per the same convention rounds 1 and 2 used for the connector-spoofability drill.

**Fixes verified this round carry their own named, load-bearing tests** — I confirmed each is non-vacuous by mutation, not by reading it:

| Closure | Test that guards it | Proven load-bearing by |
|---|---|---|
| #99 | `sessionstart-tool-enum-fixnow.test.ts` "S5-R2-N1: ...has NO effect whatsoever..." | asserts `haltState === undefined`; my E2/E2b re-run |
| #100 | `central-classification.test.ts` "S5-R2-N2: ...pinned to the EXACT ratified date" | my `2026-10-07 -> 2099-01-01` mutation -> RED |
| #101 | reconciled `SUR-03-central-fixture-expired` key + `UNLOCK_HINTS` entry | my follow-the-hint drill -> relay exit 0 |
| #96 escalation | `sessionstart-tool-enum-fixnow.test.ts` "S5-R2-Issue96-escalation: ..." | my guard-removal mutation -> RED + relay exit 0 |

---

## 7. Scariest unproven assumption, and the call

**Scariest unproven assumption:** *that `CLAUDE_PROJECT_DIR` cannot be redirected by anything but Claude Code itself.* The patch closed the bespoke door and then made the policy source depend on a var whose override precedence the vendor does not document. At the hook boundary I replaced the entire ratified policy through it and got a clean, silent, no-halt session. What I could not establish — and will not assert — is whether any real actor can win that var against Claude Code's own injection. That question is cheap to settle and should be settled before `PreToolUse` activates, not after.

That caveat aside, this is a clean terminal round. Every one of the four claimed closures survived my own re-run of my own repro, three of them with a mutation test proving the new guard is load-bearing rather than decorative. The receipt's numbers are accurate this time. The answer key is untouched. Round 2's finding — "the fix built the audit trail into the fixture and then left a door beside it" — no longer holds: the door is gone, and the remaining question is about a door the whole codebase already walks through.

**Verdict: go.**

**Single next action:** run R5's five-minute `CLAUDE_PROJECT_DIR` precedence drill (section 2) and record the result in `docs/decisions.md` as a pre-activation gate on Milestone #24 — it is the last unmeasured fact standing between this mechanism and activation.

---

## 8. Addendum (same turn, appended before this report was handed off) — halt-state debris

Not a finding against this diff; recorded because `.thoth/halt-state/` is a named sensitive surface in `CLAUDE.md`.

```
$ ls .thoth/halt-state/ | wc -l
43
$ ls .thoth/halt-state/
  20x race-check-<n>.json, 3x sim-*.json, 20x <uuid>.json   (mtimes 19:55-20:28, all predating this pass)
```

These are **not** mine — every harness this round wrote into a scratchpad `CLAUDE_PROJECT_DIR`, and the sha256 checks in section 4 confirm the repo's own files are untouched. They are leftover harness output from an earlier pass in this session. The directory is gitignored, and session ids are UUIDs so a stale file is never read by a later real session — impact is nil. Worth one `rm` before merge so the sensitive directory ships empty, and worth noting that no harness in this repo currently cleans up after itself there.

---

RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [SUSPICION][MED][demonstrated] NEW: the fix moved fixture resolution onto CLAUDE_PROJECT_DIR, still an ambient env signal (the council's own condition 1 forbade exactly that namespace); planting a hostile fixture at the CLAUDE_PROJECT_DIR-relative path replaced allowlists AND expiry -- no halt file, relay exit 0 -- and connectors are read from HOME, which that var does NOT redirect, so the judge moves while the judged does not. Production reachability UNPROVEN: vendor docs confirm Claude Code always injects the var and are silent on whether a settings `env` block beats it. UNPROVEN-pending-verification, cannot gate. Exposure: unquantified at production, basis: assumption.
2. [ISSUE][LOW][code-traced] Round-2 N4 carried forward, not claimed closed: sanitizeDetail is still /[\x00-\x1F\x7F]/ (relay:92), so U+2028/2029/0085/009B/202E/200B still survive; impact-analyst's Candidate A item (5) did not ship. Exposure: 0% under committed settings, basis: counted-in-code.
3. [CLEAN][demonstrated] N1/#99 CLOSED: my exact round-2 env-var attack is inert -- control halts, attack halts identically; also verified inert against the leftover var STILL LIVE in this shell (=/tmp/attacker.json) without touching it. The new module-adjacent fallback opens nothing (DEFAULT_FIXTURE_PATH is import.meta.url-relative to the same committed file -- no second copy to poison) and fails in the safe direction. Regression test is non-vacuous. SURVIVES.
4. [CLEAN][demonstrated] N2/#100 CLOSED: my own independent 2026-10-07 -> 2099-01-01 mutation now fails S5-R2-N2 by name with the correct remedy in the message; round 2 left the same mutation 543/543 green across all four gates. Fixture restored, sha256 identical. SURVIVES.
5. [CLEAN][demonstrated] N3/#101 CLOSED: expiry is now a distinct reconciled reason key with its own hint; following the OLD hints literally still exits 2 (unchanged, correctly), following the NEW expiry hint literally reconciles all three keys to set:false and the relay exits 0 -- it genuinely unlocks. SURVIVES.
6. [CLEAN][demonstrated] #96 escalation CLOSED: two-invocation collision repro shows B no longer clears A's halt in the shared unknown-session bucket (relay exit 2); proved load-bearing by mutation -- disabling only the UNKNOWN_SESSION_ID guard flips it to exit 0 AND fails the named S5-R2-Issue96-escalation test. Issue #96 itself correctly stays OPEN (underlying deferral unchanged). SURVIVES.
7. [CLEAN][demonstrated] Build-receipt numbers independently re-verified: npm test 547 pass/0 fail/0 skipped matches the claim exactly (round 2's hand-typed-count defect did not recur); typecheck clean, lint clean, all four QA gates PASS. SURVIVES.
8. [CLEAN][demonstrated] test-writer's answer key untouched: git diff and git status both empty for the two files, and worktree blob hashes equal HEAD's (020af86e..., d7813508...) -- verified by hash, not by eyeballing a diff. DoD holds. SURVIVES.
counts (CHECKSUM): issues=1 suspicions=1 clean=6
evidence (CHECKSUM): demonstrated=7 code-traced=1 derived=0
checks=npm test 547 pass/0 fail/0 skipped/0 todo; typecheck clean (rc=0); lint clean (rc=0); qa:gate-command-path PASS; qa:gate-manifest PASS; qa:gate-matcher-drift PASS; qa:runtime-settings-drift PASS; 6 adversarial harnesses re-run (round-2 env-var fixture-redirect repro incl. the live leftover var; CLAUDE_PROJECT_DIR-relative fixture redirect; expiresOn roll-forward mutation vs full suite; full follow-the-unlock-under-expiry drill through re-ratification; #96 two-invocation shared-bucket collision; UNKNOWN_SESSION_ID guard-removal mutation vs suite + relay); all mutations restored, sha256 verified (fixture f1ea578d..., hook 44083f5e...)
adr=HIT(35)
report=docs/reviews/s5-fixnow-round3-red-team-2026-09-07.md
