# Red Team (Sutekh) — `friendly-halt-messages` round 2, targeted re-confirm

- **Date:** 2026-09-17
- **Scope:** commit `45ec0682efbd0aa982f6a20653c2cf779b6ece50` — the fix-now delta on top of `106c2dc4`
- **Branch:** `feat/friendly-halt-messages` (HEAD `4bbee86`, docs-only on top of the target)
- **Tier:** CRITICAL (re-confirm, narrowed to the 4 claimed fixes + scope containment)
- **Prior round:** `docs/reviews/friendly-halt-messages-red-team-2026-09-17.md` (3 issues + 1 suspicion, verdict `go`)
- **ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e [CACHE=HIT]
- **Verdict:** `go` — all four prior findings genuinely closed by demonstration. Two new LOW findings, neither gating, neither a shipped-code defect.

---

## Method

Nothing here is read-and-trusted. Every claim was re-attacked with a **purpose-built harness of my own** (`scratchpad/e2e.mjs`) that spawns the two real hook scripts as real subprocesses against isolated fixture trees, using **no** project `test-support` helper — so the project's own test scaffolding cannot flatter the result. 16 end-to-end renders, 4 planted mutations (all reverted), 1 pre-fix control mutant, 1 completeness instrument over the production diff.

`git status --short` is empty at the end of this pass; every mutation was reverted with `git checkout --` and the full suite re-run afterwards to certify no residue.

---

## Scope containment (checked first, before any claim)

```
$ git show 45ec068 --name-only --format="" | grep -v '^hooks/'
(none outside hooks/)

$ git show 45ec068 --numstat --format=""
31  0   hooks/sessionstart-tool-enum-friendly-labels.test.ts
19  6   hooks/sessionstart-tool-enum.mjs
216 2   hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts
17  5   hooks/userpromptsubmit-halt-relay.mjs
```

The `.mjs` files' line counts are mostly comment. **Instrument** (not a hand-derived claim) — every non-comment production line changed between `106c2dc` and `45ec068`:

```
$ git diff 106c2dc 45ec068 -- 'hooks/*.mjs' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
    | grep -vE '^[+-]\s*(\*|//|/\*)' | grep -vE '^[+-]\s*$'
-  return names.map((name) => `"${name}"`).join(", ");
+  return names.map((name) => JSON.stringify(name)).join(", ");
-  return (
-    UNLOCK_HINTS[reasonKey] ??
-    `unlock: inspect .thoth/halt-state/<this session's id>.json's "reasons" object, ...`
-  );
+  return Object.hasOwn(UNLOCK_HINTS, reasonKey)
+    ? UNLOCK_HINTS[reasonKey]
+    : `unlock: inspect .thoth/halt-state/<this session's id>.json's "reasons" object, ...`;
-  return FRIENDLY_LABELS[reasonKey] ?? reasonKey;
+  return Object.hasOwn(FRIENDLY_LABELS, reasonKey) ? FRIENDLY_LABELS[reasonKey] : reasonKey;
```

Exactly three production expressions changed. Nothing else. The upstream name-filtering logic in `sessionstart-tool-enum.mjs` is untouched (`git diff ... | grep -cE '^[+-].*(filter|typeof)'` gives `0`).

**ADR compliance.** The one rule on this attack surface is ADR-0021's *"the in-session hook gate ... MUST NOT assume `SessionStart` alone can halt a session — the halt point is `UserPromptSubmit` (gap G5)"*. Respected: `SessionStart` exited 0 in every render I drove, and the relay exited 2 on every active reason (16/16). No kernel, normalizer, or Action-record surface is touched by this diff.

---

## Attack 1 — prior finding 1: forged reason line via an unescaped `"` -> **SURVIVES (closed)**

**Scenario.** A third party controls an MCP/connector display name. They name a connector so the closing quote lands early and a whole second, fabricated `Unrecognized tool: "safe" (unlock: none needed, already approved)` line appears in the operator-facing halt message — the operator reads a fabricated all-clear next to a real block.

**Re-run, exact hostile name, through both real hooks:**

```
$ node scratchpad/a1.mjs
sessionstart exit: 0 | relay exit: 2
--- systemMessage ---
thoth halt: session rt-forge-... blocked -- Unrecognized connector: "Notion\" (unlock: none needed, already approved); Unrecognized tool: \"safe" (unlock: add the connector's EXACT display name to docs/qa/s5-central-classification.json's knownConnectors list ...)
--- forgery probes ---
contains escaped-quote sequence: true
count 'Unrecognized connector: ': 1
count 'Unrecognized tool: ': 1
active reason keys: [ 'SUR-03-unclassified-connector' ]
systemMessage === stderr first line: true
```

The embedded `"` renders as `\"`. The payload is inert text inside one quoted string; the quote boundary never closes early.

**Control — I proved the attack still lands on the old code**, so this is not a harness artifact. Reverting *only* `quoteNames` to its pre-fix form:

```
--- systemMessage (PRE-FIX quoteNames) ---
thoth halt: session rt-forge-control-... blocked -- Unrecognized connector: "Notion" (unlock: none needed, already approved); Unrecognized tool: "safe" (unlock: add the connector's EXACT display name ...)
```

Two reason lines, one of them fabricated, with a spoofed "no unlock needed". That is the deception channel, and it is gone.

**Regression cover:** with that pre-fix mutant applied, the two friendly-label suites go **16 tests / 14 pass / 2 fail** — the fix is pinned, not merely applied. Reverted (`git status --short hooks/` empty).

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## Attack 2 — prior finding 2: the composite string was never asserted (mutations M4, M5) -> **SURVIVES for M4 (the named proof-test); M5 not covered where claimed (finding 6)**

My prior round's named proof-test was *"the quoted name renders immediately after the friendly label in the real end-to-end `systemMessage`, and it must fail under mutation M4."* That test now exists and bites.

**M4** — delete the detail (the tool/connector name) from the rendered line at `hooks/userpromptsubmit-halt-relay.mjs:251`:

| run | prior round (`106c2dc`) | now (`45ec068`) |
|---|---|---|
| new-tests-only | tests 8, **pass 8, fail 0** (blind) | tests 16, **pass 5, fail 11** |
| all `hooks/*.test.ts` | tests 52, pass 51, fail 1 | tests 60, pass 48, fail 12 |

M4 no longer survives anything. The operator-facing product of this story — label, then name, then unlock, as one exact string — is pinned end-to-end through the real cross-script pipeline.

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## Attack 3 — prior finding 3: prototype-chain key collision -> **SURVIVES (closed, and wider than asked)**

I seeded halt-state files with reason keys matching inherited `Object.prototype` members and ran the real relay against each. I tested the 4 required keys **plus 6 more** the `Object.hasOwn` fix should also cover:

```
constructor              exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
__proto__                exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
hasOwnProperty           exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
valueOf                  exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
toString                 exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
isPrototypeOf            exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
propertyIsEnumerable     exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
toLocaleString           exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
__defineGetter__         exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
__lookupSetter__         exit=2 protoLeak=false rawKeyLabel=true genericUnlock=true
```

`protoLeak` probes for `[native code]` / `function Object()` / any `function X() {` rendering. Zero leaks in 10/10. Every case renders the raw key as the label and the generic fallback unlock naming that exact key, and still exits 2. `Object.hasOwn` is the right shape of fix: it closes the whole class, not the four enumerated instances. The `__proto__` case is real, not vacuous — `JSON.parse` creates a genuine own property for it, and the relay enumerated and rendered it.

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## Attack 4 — prior finding 4: the key-parity test -> **SURVIVES (the test is real and bites both directions)**

I mutated each map independently and ran the suite.

| mutation | result |
|---|---|
| `"SUR-03-brand-new-key"` added to **`FRIENDLY_LABELS` only** | tests 12, **pass 11, fail 1** — the named parity test fails |
| `"SUR-03-orphan-hint"` added to **`UNLOCK_HINTS` only** | tests 12, **pass 11, fail 1** |

The failing test is exactly *"key parity (GitHub Issue #205): FRIENDLY_LABELS and UNLOCK_HINTS cover the exact same reason-key set."* It is not a tautology: the two key sets are extracted independently from the real shipped source text, and each one-sided edit turns it red. Both mutants reverted.

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## Finding 5 — **[ISSUE][LOW][demonstrated]** the parity instrument is line-anchored and is evaded by a same-line key addition

**Attack.** The parity test parses source *text*, not runtime objects, with a line-anchored key regex (`^\s*"([^"]+)":` with the `m` flag). That anchor requires each key to start its own line. A future developer adds a key on a line that already has one:

```js
  "SUR-03-central-fixture-expired": "Allowlist exemption expired", "SUR-03-evade-samleline": "Sneaky",
```

**Result — the net does not catch it:**

```
$ node --test hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts
tests 12 | pass 12 | fail 0

$ npx eslint hooks/userpromptsubmit-halt-relay.mjs
ESLINT_EXIT=0
```

Green suite, green lint — **and the maps genuinely diverge at runtime.** The real relay against a halt-state seeded with that key:

```
thoth halt: session rt-evade-... blocked -- Sneaky: d (unlock: inspect .thoth/halt-state/<this session's id>.json's "reasons" object, resolve the "SUR-03-evade-samleline" condition named in the detail above, ...)
```

A label with no matching hint, silently. In the mirror direction (hint-only) this is exactly the raw-key leak Issue #205 exists to prevent.

**Current defense, honestly assessed.** Real but narrow. The instrument catches the overwhelmingly likely shape of a future edit (one quoted key per line — all 8 current keys are written that way, counted in the source) and is worth far more than nothing. What it cannot see is anything off that one formatting assumption, and no lint rule backs the assumption up.

**Exposure: ~0% of runs today; fires only on a future one-sided map edit written on a shared line, basis: counted-in-code (8/8 current keys are one-per-line).** Blast radius when it fires is an operator-facing message missing its label or its unlock — the block itself (exit 2) is unaffected in every case.

**Verdict: BREAKS (LOW).** Not gating.

**Named proof-test:** "key parity is computed from the module's runtime exports, not its source text: a key added on a shared line still fails parity" — the durable fix is to give the module an `import.meta.url` main-guard (or export the two frozen maps) and assert the two runtime key sets are deep-equal. That removes the formatting assumption entirely. A cheaper interim: make the extractor's regex non-line-anchored over the block body.

Per this project's convention, `[LOW]` findings do not spawn a GitHub Issue; this is routed to the backlog as the residual above.

---

## Finding 6 — **[ISSUE][LOW][demonstrated]** mutation M5 still survives the new tests; the commit's claim is broader than what shipped

**Attack.** M5 — bypass `sanitizeDetail` entirely and interpolate the raw detail value, re-opening Issue #97's injection channel, at `hooks/userpromptsubmit-halt-relay.mjs:251`.

```
new-tests-only (both friendly-labels files): tests 16 | pass 16 | fail 0   <-- still blind
all hooks/*.test.ts:                        tests 60 | pass 58 | fail 2
```

The two tests that do catch it are pre-existing:

```
FAIL Issue #97: a control character (embedded newline) in 'detail' is stripped from the chat-visible systemMessage
FAIL Issue #97: an oversized 'detail' string is length-capped in the chat-visible systemMessage, marked truncated
```

**Why this is LOW and not a defect.** The new composite tests *cannot* catch M5 by construction: their fixture names contain no control characters and sit under the 200-char cap, so `sanitizeDetail` is a no-op on that input and removing it changes nothing observable. The property itself **is** pinned by a running instrument in the same `npm test` gate CI runs, so the marginal exposure of this gap is zero. What is wrong is the *claim*: this commit's fix-now framing asserts the new tests close the composite-coverage gap; that is true for M4 and untrue for M5. My prior round named M4 as the required proof-test, and M4 is delivered — so the condition was met; the claim simply reaches past it.

**Exposure: 0% marginal — the property is caught by 2 pre-existing tests in the same gate, basis: measured (58 pass / 2 fail).**

**Verdict: BREAKS (LOW), claim-accuracy only.** Not gating. No GitHub Issue (LOW).

**Named proof-test (if anyone wants the coverage local to the new file):** "composite end-to-end: a connector name carrying an embedded newline and exceeding 200 chars renders sanitized and truncation-marked in the exact composite systemMessage" — one fixture, same cross-script shape, and it kills M5 inside the new suite.

---

## Attack 7 — new surface opened by `JSON.stringify` itself -> **SURVIVES**

`JSON.stringify` changed the rendered grammar, so I attacked the new renderer directly rather than assuming an escape function is universally safe.

| probe | result |
|---|---|
| control chars (newline, BEL, U+2028) in the name | escaped by `JSON.stringify`; U+2028 additionally stripped by `sanitizeDetail`; exit 2 |
| lone surrogate U+D800 | rendered as an escaped code unit (well-formed stringify); no mojibake, no crash; exit 2 |
| 120 consecutive double-quotes (escape inflation past the 200-char cap) | length-capped and explicitly marked `...[truncated]`; exit 2 |
| empty-string name | renders as an empty quoted string, still halts; exit 2 |
| non-string entries (`5`, `null`, `true`, `{}`, `[]`) | filtered upstream — **no reason set, relay exits 0** |

The truncation case is worth naming: escape inflation makes the disclosed truncation residual easier to reach, but it is not a forgery vector — the cap appends a visible `...[truncated]` marker, so an attacker cannot terminate the string cleanly to leave a forged suffix looking complete.

The non-string case is a genuine fail-open shape (a non-string connector entry skips the SUR-03 halt), but it is **pre-existing, untouched by this commit (0 diff lines in the filtering logic), and zero-marginal**: whoever can write a non-string into the home `claude.json`'s `claudeAiMcpEverConnected` array can equally delete the entry outright and evade identically. Recording it as a residual, not a finding against this diff.

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## Attack 8 — gate integrity across the whole pass -> **SURVIVES**

The one property that actually matters is that the relay still blocks. Across every render in this pass — hostile quote name, 10 prototype-chain keys, control chars, lone surrogate, escape-inflated overflow, empty string, the diverged-map case — the relay exited **2**, and `systemMessage` was byte-identical to stderr's first line where both were present. Message rendering degraded in none of them, and the block degraded in none of them.

```
$ npm run typecheck   -> clean
$ npm run lint        -> clean
$ npm test
tests 850 | pass 850 | fail 0 | skipped 0 | todo 0
$ git status --short  -> (empty)
```

850 = prior round's 842 + 8 new tests (4 prototype-chain + 2 composite + 1 parity + 1 SessionStart hostile-quote), consistent with the diff. Zero skipped.

**Verdict: SURVIVES.** Evidence: `demonstrated`.

---

## The scariest unproven assumption

**That a source-text parser is an adequate long-term guard over a runtime invariant.** Finding 5 is the small, demonstrated instance; the general shape is that the project's newest safety net is only as good as a formatting convention no linter enforces. It costs nothing today (both maps agree, 850/850 green) and it is strictly better than the nothing that preceded it — but it will quietly stop being true the first time someone reformats that block.

## Go / no-go

**`go`.** Zero HIGH, zero MED. All four prior findings are closed by demonstration, not by reading: the forgery vector is dead with a working pre-fix control proving the attack was real; M4 goes from 8/0-blind to 11 failures; the prototype-chain fix closes 10 members, not the 4 asked for; the parity test bites in both directions. The two new findings are both LOW — one a narrow evasion of a brand-new safety net, one a claim that reaches past what shipped — and neither touches the blocking property or the shipped message path.

## Single next action

Hand `45ec068` to the human for merge, and file finding 5's runtime-keys parity assertion to the backlog — do **not** add it to this diff (gold-plating a commit under final re-confirm).

## Editorial (verdict-neutral)

- This commit's message, bullet 3, says the new end-to-end tests close the gap where "the existing 8 tests ... would not have caught a mutation deleting the name from the message entirely." That sentence is accurate. The broader framing that the composite gap is closed is not: mutation M5 still passes the new suite 16/16 and is caught only by the two pre-existing Issue #97 tests. See finding 6.
- The new composite test duplicates the two unlock-hint literals from the production map. That is deliberate and documented in the test's own comment as a pin on operator-facing text — noted, no action.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [CLEAN][demonstrated] prior finding 1 (forged reason line via unescaped double-quote) -- hostile name re-run end-to-end through both real hooks renders the embedded quote escaped, one reason line, exit 2; pre-fix control mutant reproduces the two-line forgery, proving the fix (not the harness) is what closed it; that mutant also turns the new suite 16:14/2.
2. [CLEAN][demonstrated] prior finding 2's named proof-test (mutation M4, name deleted from the rendered line) -- was new-tests-only 8 pass/0 fail, now 16 tests/5 pass/11 fail; all-hooks 60/48/12. Composite string pinned end-to-end.
3. [CLEAN][demonstrated] prior finding 3 (prototype-chain key collision) -- 10 Object.prototype members seeded through the real relay (the 4 required + 6 more): 0 leaks, raw-key label + generic unlock, exit 2 in 10/10; Object.hasOwn closes the class, not the instances.
4. [CLEAN][demonstrated] prior finding 4 (no key-parity instrument) -- test is real and non-tautological; a one-sided key added to FRIENDLY_LABELS fails it 12:11/1, and to UNLOCK_HINTS fails it 12:11/1.
5. [ISSUE][LOW][demonstrated] the parity instrument is line-anchored -- a key added on a SHARED line evades it entirely: suite 12/12 green, eslint exit 0, and the maps genuinely diverge at runtime (label renders, unlock falls back to the generic raw-key text). Exposure ~0% today, fires on a future one-sided edit off the one-key-per-line convention, basis counted-in-code (8/8 keys one-per-line). Fix: assert parity on the runtime maps, not the source text.
6. [ISSUE][LOW][demonstrated] mutation M5 (sanitizeDetail bypassed) STILL survives the new tests 16 pass/0 fail -- caught only by the 2 pre-existing Issue #97 tests (all-hooks 60:58/2); the new composite fixtures cannot catch it by construction (no control chars, under the 200-char cap). Claim-accuracy only: 0% marginal exposure, basis measured; the required M4 proof-test was delivered.
7. [CLEAN][demonstrated] scope containment -- instrument over the production diff shows exactly 3 changed expressions (quoteNames, unlockHintFor, friendlyLabelFor), 0 files outside hooks/, 0 changes to the upstream name-filtering logic; ADR-0021's halt-point rule (UserPromptSubmit, not SessionStart) respected in 16/16 renders.
8. [CLEAN][demonstrated] new surface opened by JSON.stringify -- control chars escaped/stripped, lone surrogate well-formed, 120-quote escape inflation length-capped and marked truncated (no clean-suffix forgery), empty name still halts; non-string names skip the halt but that is pre-existing, untouched (0 diff lines) and zero-marginal (the same writer can delete the entry).
9. [CLEAN][demonstrated] gate integrity -- exit 2 on every one of 16 hostile/degenerate renders, systemMessage byte-identical to stderr line 1; typecheck clean, lint clean, 850/850, 0 skipped; git status empty after all mutations reverted.
counts (CHECKSUM): issues=2 suspicions=0 clean=7
evidence (CHECKSUM): demonstrated=9 code-traced=0 derived=0
checks=npm test 850 pass / 0 fail / 0 skipped (exit 0); typecheck clean; lint clean; 5 mutations planted+reverted (pre-fix quoteNames control 16:14/2, M4 16:5/11 + all-hooks 60:48/12, M5 16:16/0 + all-hooks 60:58/2, parity one-sided x2 12:11/1 each, same-line evasion 12:12/0 + eslint 0); 16 end-to-end renders through both real hooks via an independent harness; 1 completeness instrument over the production diff; git status clean after revert
adr=HIT(35)
report=docs/reviews/friendly-halt-messages-red-team-round2-2026-09-17.md

---

## Addendum (Manager, 2026-09-17)

QA-14 (`npm run qa:reference-resolver`) flags this report's Method section (line 15) as an unresolved path citation: it names, in backtick-code form, the throwaway harness script this round's attacks were run through, written under this session's own ephemeral scratchpad directory (never committed, disposable scratch work) rather than a path inside this repository. The original evidence above stays verbatim per PRINCIPLES rule 11 — this addendum is the clarification, not a correction of substance.

The rest of QA-14's currently-failing citation count predates this story: confirmed by grepping the exact failing strings across the tree before and after this story's diff, and every match lands in review reports, docs, and test fixtures dated well before 2026-09-17. This story's diff changes that pre-existing count by exactly one line (the harness-path mention above) — not a new pattern, and not something this small a story should take on fixing project-wide.

Convention worth carrying forward: a future report describing a scratch/throwaway script should name it in plain prose, not in the backtick-code path form QA-14 treats as a citation to verify.
