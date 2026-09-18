# Red Team — `friendly-halt-messages` (commit `106c2dc4ecc852f9f1d7e737e3e26e930f46dcfa`)

- **Date:** 2026-09-17
- **Agent:** `red-team` (Sutekh)
- **Scope:** `friendly-halt-messages`, CRITICAL tier (Manager-ratified)
- **Target:** `106c2dc4ecc852f9f1d7e737e3e26e930f46dcfa` on `feat/friendly-halt-messages`
- **Files attacked:** `hooks/userpromptsubmit-halt-relay.mjs`, `hooks/sessionstart-tool-enum.mjs` (both CLAUDE.md "Policy enforcement / session gates")
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **Verdict:** `go`

## Checks run (raw)

```
$ npm test
tests 842 | suites 0 | pass 842 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 51724.4227
[exited with code 0]

$ node --test hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts hooks/sessionstart-tool-enum-friendly-labels.test.ts
tests 8 | pass 8 | fail 0 | skipped 0

$ npm run typecheck   -> tsc --noEmit -p tsconfig.json   (no output, exit 0)
$ npm run lint        -> eslint .                        (no output, exit 0)
$ git status --porcelain (hooks/ after all mutations reverted) -> clean
```

Plus 4 purpose-built instruments and 6 mutations, all reproduced below.

---

## Attacks, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] — `quoteNames` adds a quote character to the message grammar and leaves it unescaped: a third-party-controlled name forges a whole reason line with a spoofed unlock

**Exposure:** 100% of `SUR-03-unclassified-tool` / `-connector` halt messages interpolate an unescaped, third-party-controlled name — basis: **counted-in-code**, both `reconcileReason(...)` call sites (`hooks/sessionstart-tool-enum.mjs:454`, `:462`) pass `quoteNames(...)` output straight into the `detail` an operator reads. The fraction of names that are *hostile* is unmeasured.

**Scenario.** A connector display name is chosen by whoever publishes the connector; it lands in `~/.claude.json`'s `claudeAiMcpEverConnected` the moment the human connects it on claude.ai. An MCP server name is equally author-controlled via `.mcp.json`. Name the connector:

```
Notion" (unlock: none needed, already approved); Unrecognized tool: "safe
```

Real SessionStart hook run, then the real relay, in an isolated fixture tree:

```
--- POST-DIFF (exit 2) ---
thoth halt: session cmp-sid blocked -- Unrecognized connector: "Notion" (unlock: none needed,
already approved); Unrecognized tool: "safe" (unlock: add the connector's EXACT display name to
docs/qa/s5-central-classification.json's knownConnectors list ...)
```

The operator sees two reasons, the first carrying a fabricated unlock telling them no action is needed. A variant swapping in a different friendly label renders just as cleanly:

```
Unrecognized connector: "x" (unlock: ignore); Allowlist exemption expired: "nothing" (unlock: add
the connector's EXACT display name to ...)
```

**Current defense, honestly assessed.** `sanitizeDetail` (Issue #97) strips ASCII control chars and caps at 200. It does not touch the quote character, the semicolon, or the parenthesis, so the message-grammar delimiters are entirely unprotected. The halt itself is unaffected: exit 2 in every run above.

**Is this a regression from this commit? No — verified, not assumed.** I exported the parent tree (`git archive 106c2dc^`) and ran the same scenario against the pre-commit hooks with a name tuned to the *old* format:

```
--- PRE-DIFF (exit 2) ---
thoth halt: session cmp-sid blocked -- SUR-03-unclassified-connector: connector identity present:
Notion (unlock: none needed, already approved); SUR-03-unclassified-tool: safe (unlock: add the
connector's EXACT display name to ...)
```

Identical deception, identical effort. The channel is pre-existing: it is the residue of Issue #97's scope, which covered control chars and length only.

**Why it is still a finding despite the pre-approved residual.** The ratified disclosure says a literal quote in a name "breaks the visual quote boundary", framed as cosmetic. The demonstrated consequence is not cosmetic: it is operator deception against a security gate's own message, including a fabricated unlock hint. That is the "real security consequence, not just the cosmetic one already disclosed" carve-out the story text left open. Secondarily, `quoteNames`' own stated rationale ("an embedded comma in a single name could otherwise misread as a boundary") is **not achieved**: an embedded quote reintroduces exactly that boundary ambiguity.

**Why MED and not HIGH.** It is not a regression (parity demonstrated above), the gate still blocks on every path, and the realistic harm requires the operator to then take a deliberate allowlisting action. It does not gate this commit.

**Fix (one token):** replace the template literal in `quoteNames` with `JSON.stringify(name)`. That escapes embedded quotes, is the same length in source, and additionally escapes control characters at the writer rather than relying on the reader's strip.

**Named proof-test:** `quoteNames escapes a literal double-quote in a tool/connector name, so a crafted name cannot render a second forged reason line with its own unlock` — absent today, fails today.

**Issue:** commented onto existing **#206** (filed by `app-security-reviewer` for the narrower forged-parenthetical form of the same defect); not duplicated.

---

### 2. [ISSUE][MED][demonstrated] — the new tests never assert the composite message this story exists to produce; deleting the tool/connector name from the rendered line leaves all 8 new tests green

**Exposure:** 0 of the 8 new tests exercise both scripts together — basis: **counted-in-code** (per-file grep: `sessionstart-tool-enum-friendly-labels.test.ts` spawns only SessionStart, `userpromptsubmit-halt-relay-friendly-labels.test.ts` spawns only the relay against a hand-written `detail: "some detail text"`).

**Scenario.** The story's product is one string: a friendly label, then the quoted name, then the unlock. Neither half is pinned to the other. The cross-script pattern that would pin it already exists in this file family (`hooks/userpromptsubmit-halt-relay.test.ts:129-180` runs the real `sessionstart-tool-enum.mjs` writer and then the real relay against the same fixture tree) and neither new file uses it.

**Mutation evidence.** M4 — delete the detail from the rendered line, so the operator sees the label and the unlock but **not the tool/connector name**, i.e. exactly the information this story was written to surface:

```
// hooks/userpromptsubmit-halt-relay.mjs:239 (mutant, detail removed)
  new-tests-only: tests 8 | pass 8 | fail 0
  all-hooks:      tests 52 | pass 51 | fail 1
```

M5 — bypass `sanitizeDetail` entirely, re-opening Issue #97's injection channel:

```
// hooks/userpromptsubmit-halt-relay.mjs:239 (mutant, raw entry.detail interpolated)
  new-tests-only: tests 8 | pass 8 | fail 0
  all-hooks:      tests 52 | pass 50 | fail 2
```

In both cases the 8 new tests are blind; only pre-existing tests catch it. The new suite pins the label prefix and the quoting *separately*, and nothing else.

**What the new tests DO catch (fair credit).** Three mutations were correctly killed:

| Mutation | new-tests-only result |
|---|---|
| M1 `quoteNames` returns a bare comma-join (quotes dropped) | tests 8, **pass 5, fail 3** |
| M2 `friendlyLabelFor` returns `reasonKey` (labels dropped) | tests 8, **pass 4, fail 4** |
| M6 the two adjacent `reconcileReason` detail args swapped | tests 8, **pass 5, fail 3** |

M6 matters: dropping the `unclassified:` / `connector identity present:` prefixes removed the only textual discriminator between the two now structurally identical call sites, so a copy-paste swap there is a live hazard, and it is covered.

**Current defense, honestly assessed.** Real, just short of the composite. Both test files spawn real subprocesses against isolated fixture trees with no stubbing, which is why M1/M2/M6 die.

**Named proof-test:** `friendly label and quoted name compose end-to-end: a real SessionStart run against an unclassified connector, then the real relay, renders the quoted name immediately after the friendly label in systemMessage` — written in the existing cross-script shape, and it must fail under mutation M4.

**Issue:** filed fresh; no existing Issue covers test coverage of this story.

---

### 3. [ISSUE][LOW][demonstrated] — a reason key colliding with an `Object.prototype` member renders the prototype member as the label AND the unlock; this commit removed the last place the raw key survived

**Exposure:** ~0% of current runs — basis: **counted-in-code**. An instrument walked every non-test `.mjs`/`.js`/`.ts` in the repo: exactly one file (`hooks/sessionstart-tool-enum.mjs`) writes into a halt-state path outside test support, and it writes exactly 4 fixed module constants. Reachable only via a hand-edited/corrupted halt-state file or a future writer choosing such a key.

**Scenario.** `FRIENDLY_LABELS[reasonKey]` is an inherited-property read on a plain object literal, so any key present on `Object.prototype` resolves to the prototype member rather than `undefined`, and the `?? reasonKey` fallback never fires. Real relay, real halt-state files written as raw JSON text:

```
== constructor key ==
exit=2
msg=thoth halt: session ... blocked -- function Object() { [native code] }: real halt detail (function Object() { [native code] })

== __proto__ key ==
exit=2
msg=thoth halt: session ... blocked -- [object Object]: a genuine halt ([object Object])

== hasOwnProperty key ==
exit=2
msg=... -- function hasOwnProperty() { [native code] }: a genuine halt (function hasOwnProperty() { [native code] })

== valueOf key ==
exit=2
msg=... -- function valueOf() { [native code] }: a genuine halt (function valueOf() { [native code] })

== __proto__ plus a real reason together ==
exit=2
msg=... -- [object Object]: d1 ([object Object]); Unrecognized tool: "real-tool" (unlock: reclassify the tool in ...)
```

**Current defense, honestly assessed.** Fails **closed** every time: exit 2 in all five renders, and a genuine co-active reason still renders correctly (last case). The `unlockHintFor` half of this is pre-existing and identical in shape. What *this commit* changed: pre-diff the message still led with the literal key, so the operator could at least name the condition. Post-diff both slots are prototype garbage, so the message names neither the reason nor the unlock, the exact property Issue #94 / PRINCIPLES rule 2 bought.

**Fix:** guard the lookup with `Object.hasOwn` before falling back to the raw key (the same one-liner applies to `unlockHintFor`).

**Named proof-test:** `a reason key colliding with an Object.prototype member renders that raw key, not the inherited prototype member` — absent today, fails today.

**No Issue filed** (LOW; per CLAUDE.md `[LOW]` findings do not spawn one). Routed as a residual/backlog line for the Manager.

---

### 4. [SUSPICION][LOW][demonstrated] — nothing standing pins `FRIENDLY_LABELS` / `UNLOCK_HINTS` / the writer's key set

My parity check (attack 6 below) is ad-hoc: I wrote it for this review, it is not committed. The new test file's `FRIENDLY_LABEL_CASES` is a **hand-typed** 4-element list, so a 5th reason key added to the writer, or an `UNLOCK_HINTS` entry added without a `FRIENDLY_LABELS` sibling, changes nothing red. Per CLAUDE.md's no-hand-derived-completeness rule, the parity belongs in a running instrument next to the maps.

**Named proof-test:** `FRIENDLY_LABELS and UNLOCK_HINTS cover exactly the SUR-03 reason keys hooks/sessionstart-tool-enum.mjs can write`.

**Issue:** same defect class as existing **#205** (filed by `cross-domain-reviewer`); commented onto it with the instrument output rather than duplicated.

---

### 5. [CLEAN][demonstrated] — no fail-open, no crash, no empty or `undefined` render

Every path I could reach exits 2:

- `friendlyLabelFor` cannot return `undefined` for a string key (`?? reasonKey`), and every value reachable through the prototype chain string-converts without throwing (all five renders in attack 3).
- Even if it did throw: `describeActiveReasons` is called from inside `main()`, whose `main().catch(...)` handler writes its own message and calls `process.exit(2)` unconditionally (`hooks/userpromptsubmit-halt-relay.mjs:295-331`, byte-identical to pre-diff).
- `quoteNames([])` producing an empty detail is **unreachable on the active path**: `haltRequired === unclassified.length > 0` (`src/policy/tools/classification.ts:80`) and the connector flag is literally `unknownConnectorNames.length > 0` (`hooks/sessionstart-tool-enum.mjs:461`), so neither call site can be active with an empty list.
- 11 hostile / degenerate / mixed-version renders executed across this review: **exit 2 in 11 of 11** where a reason was active; exit 0 only where no reason was active.

### 6. [CLEAN][demonstrated] — `friendlyLabelFor`'s fallback masks nothing; the 4 labels are the complete key set

Instrument output (walks every non-test `.mjs`/`.js`/`.ts`, skipping `node_modules`/`.git`/`.thoth`/`adr`/`docs`):

```
Files that writeFileSync into a halt-state path (all files incl. tests/helpers):
  hooks/sessionstart-tool-enum.mjs
  hooks/test-support/fixture-tree.ts

SUR-* reason-key literals in non-test source (4):
  SUR-03-central-fixture-expired     <- hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs
  SUR-03-enumeration-failed          <- hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs
  SUR-03-unclassified-connector      <- hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs, src/policy/tools/mcp-enumeration.ts
  SUR-03-unclassified-tool           <- hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs, src/policy/tools/mcp-enumeration.ts

FRIENDLY_LABELS keys (4): SUR-03-unclassified-tool, SUR-03-unclassified-connector, SUR-03-enumeration-failed, SUR-03-central-fixture-expired
UNLOCK_HINTS   keys (4): SUR-03-unclassified-tool, SUR-03-unclassified-connector, SUR-03-enumeration-failed, SUR-03-central-fixture-expired

produced-but-no-FRIENDLY_LABEL   : []
produced-but-no-UNLOCK_HINT      : []
FRIENDLY_LABEL-but-never-produced: []
FRIENDLY vs UNLOCK symmetric diff: []
```

No key that should have a label is silently masked by the fallback. The fallback is reachable only for a not-yet-existing key, and its behavior there (show the raw key) is exactly the pre-diff behavior for every key. The sole real writer is `hooks/sessionstart-tool-enum.mjs`; `fixture-tree.ts` is test support.

### 7. [CLEAN][demonstrated] — the claimed-untouched surface is byte-identical; I diffed it rather than taking the receipt's word

Instrument extracts each named top-level declaration from `106c2dc^` and `106c2dc` by brace matching and compares SHA-256. (v1 of this instrument was wrong: it terminated on the first balanced parenthesis pair, truncating `async function main` to its empty arg list and reporting a false `identical`. Corrected to a brace-only matcher and re-run; the v1 result is discarded.)

```
### hooks/userpromptsubmit-halt-relay.mjs
  identical const MAX_DETAIL_LENGTH                pre=d4976e393ad5eb0d(30ch) post=d4976e393ad5eb0d(30ch)
  identical function sanitizeDetail                pre=41aa306161ba984e(407ch) post=41aa306161ba984e(407ch)
  identical const UNLOCK_HINTS                     pre=d22dac5df500aa88(2018ch) post=d22dac5df500aa88(2018ch)
  identical function unlockHintFor                 pre=f3338696adccb5a1(268ch) post=f3338696adccb5a1(268ch)
  identical function inspectHaltState              pre=5888f04971a2d15f(713ch) post=5888f04971a2d15f(713ch)
  identical function blockWithMessage              pre=0c1d36c39f43b77d(1058ch) post=0c1d36c39f43b77d(1058ch)
  identical function haltStatePath                 pre=4384e31b392b30d3(111ch) post=4384e31b392b30d3(111ch)
  identical function projectDir                    pre=f809c6fc4ecf3876(83ch) post=f809c6fc4ecf3876(83ch)
  identical function readStdin                     pre=5a2833ffc3ca4ea5(334ch) post=5a2833ffc3ca4ea5(334ch)
  CHANGED   function describeActiveReasons         pre=13ac3a5b657d223d(162ch) post=7384942a63d7c6b9(180ch)
  identical async function main                    pre=1b24a82ca48342c0(1983ch) post=1b24a82ca48342c0(1983ch)
  identical main().catch                           pre=5504d4937fe7d6bf(2046ch) post=5504d4937fe7d6bf(2046ch)

### hooks/sessionstart-tool-enum.mjs
  identical function readExistingHaltState         pre=34998eb0d69de7b5(217ch) post=34998eb0d69de7b5(217ch)
  identical function writeHaltReason               pre=8997f5cf8508dc2f(737ch) post=8997f5cf8508dc2f(737ch)
  identical function wasReasonActive               pre=be0492156a35a177(369ch) post=be0492156a35a177(369ch)
  identical function reconcileReason               pre=903dbfac4b640c1c(1210ch) post=903dbfac4b640c1c(1210ch)
  identical function haltStatePath                 pre=4384e31b392b30d3(111ch) post=4384e31b392b30d3(111ch)
  identical function readJsonFileIfExists          pre=15a906b7e71538e4(425ch) post=15a906b7e71538e4(425ch)
  identical function resolveFixtureLocation        pre=d234ce3354ac329e(355ch) post=d234ce3354ac329e(355ch)
  identical function isProjectMcpServerEnabled     pre=9f3a20a4edeaba6e(591ch) post=9f3a20a4edeaba6e(591ch)
  identical function computeSessionTools           pre=068b15bdb7e729ad(6208ch) post=068b15bdb7e729ad(6208ch)
  CHANGED   async function main                    pre=a426e43c0f2f0683(6864ch) post=5b3179fd233c475b(6814ch)
  identical const UNCLASSIFIED_REASON_KEY          pre=b40de10cd2e81aa3(59ch) post=b40de10cd2e81aa3(59ch)
  identical const UNCLASSIFIED_CONNECTOR_REASON_KEY pre=cfad5b7a860c3259(74ch) post=cfad5b7a860c3259(74ch)
  identical const ENUMERATION_FAILED_REASON_KEY    pre=a77a5b35fa71a9d8(66ch) post=a77a5b35fa71a9d8(66ch)
  identical const FIXTURE_EXPIRED_REASON_KEY       pre=4cb7a264989f8d26(68ch) post=4cb7a264989f8d26(68ch)
  identical const UNKNOWN_SESSION_ID               pre=1cb57caf2f676a92(45ch) post=1cb57caf2f676a92(45ch)

TOTAL: identical=25 CHANGED=2 MISSING=0
```

Exactly two declarations changed, both expected: `describeActiveReasons` and sessionstart's `main` (the two `reconcileReason` detail arguments). `UNLOCK_HINTS` values, `sanitizeDetail`, `inspectHaltState`, `blockWithMessage`, `reconcileReason`, `writeHaltReason`, `wasReasonActive`, and the halt-state JSON payload shape are all byte-identical. The receipt's claim holds.

### 8. [CLEAN][code-traced] — concurrency and partial state: nothing new to race

`reconcileReason` / `writeHaltReason` do a non-atomic read-modify-write of the per-session halt-state file, and the `UNKNOWN_SESSION_ID` bucket is additive-only. Both are **byte-identical** to pre-diff per attack 7. This commit changes one string *argument* at two call sites: no new write, no new key, no reordering, no new file, no change to when a write happens. Two concurrent SessionStart runs interleave exactly as before. Partial failure is unchanged: `main()`'s catch still writes `SUR-03-enumeration-failed` and the relay still fails closed on a mid-write or truncated file.

### 9. [CLEAN][demonstrated] — mixed-version halt state (old-format detail read by the new relay) fails closed and self-heals

This repo carries 17 pre-existing halt-state files in the old detail format (gitignored via `.gitignore:12`, so no name leak). Rendering this repo's own real file through the new relay:

```
exit=2
thoth halt: session mixed-sid blocked -- Unrecognized tool: unclassified: github, aws-mcp-server,
aws-knowledge-mcp-server, aws-api-mcp-server, terraform, playwright (unlock: reclassify the tool ...)
;  Unrecognized connector: connector identity present: claude.ai Gmail, claude.ai Excalidraw, ...
(unlock: add the connector's EXACT display name ...)
```

A redundant double prefix for one prompt. Blocks correctly, names every tool correctly, names the unlock correctly, and the next SessionStart rewrites the detail in the new format. Cosmetic and transitional only.

### 10. [CLEAN][demonstrated] — the pre-approved truncation residual is bounded and self-announcing, and the diff makes truncation *less* likely at realistic sizes

12 synthetic connectors, real end-to-end:

```
Unrecognized connector: "claude.ai Connector Number 0", ..., "claude.ai Connector Number 5",
"claude....[truncated] (unlock: add the connector's EXACT display name to ...)
```

The cut does land mid-name, but `sanitizeDetail`'s `...[truncated]` marker is present and unchanged, so a reader never mistakes the capped list for the complete one, and the unlock hint is appended *after* truncation and therefore never eaten. Arithmetic: for a list of N names the new format is `28 - 2N` characters **shorter** than the old (the 28-char prefix is gone, 2 quote chars added per name), so it truncates *later* than the pre-diff format for any N below 14. This commit does not worsen the residual at realistic list sizes.

---

## Editorial (verdict-neutral)

- `quoteNames`' header comment states its purpose as disambiguating "an embedded comma in a single name" — true for commas, false for quotes, which reintroduce the same ambiguity (finding 1). One sentence, worth correcting when finding 1 is fixed.
- Both header comments and the CHANGELOG disclose the two residuals accurately and name their ratification. The `[LOW]`/`[MED]` findings above are consequences the disclosure's framing understates, not omissions.

## Findings to tests

| # | Finding | Named failing test |
|---|---|---|
| 1 | Unescaped quote enables a forged reason line and spoofed unlock | `quoteNames escapes a literal double-quote in a tool/connector name, so a crafted name cannot render a second forged reason line with its own unlock` |
| 2 | Composite message unpinned | `friendly label and quoted name compose end-to-end: a real SessionStart run against an unclassified connector, then the real relay, renders the quoted name immediately after the friendly label in systemMessage` |
| 3 | Prototype-chain label/hint lookup | `a reason key colliding with an Object.prototype member renders that raw key, not the inherited prototype member` |
| 4 (suspicion) | No standing key-parity instrument | `FRIENDLY_LABELS and UNLOCK_HINTS cover exactly the SUR-03 reason keys hooks/sessionstart-tool-enum.mjs can write` |

Open findings = 3; named failing tests for them = 3. The suspicion carries a 4th test. No finding lacks an executable form.

## Scariest unproven assumption

**That a halt message's own structure is trustworthy to the operator reading it.** It is not. The message is a single flat string assembled by concatenating code-authored text with third-party-authored text, with no escaping and no delimiter the attacker cannot type. Everything downstream ("is this one connector or two", "is this unlock real") rests on that assumption, and this commit made the grammar richer (quotes, prose labels) without making it trustworthy. The gate itself is sound; its *report* is not authenticated.

## Go / no-go

**`go`.** Zero HIGH. The blocking property (exit 2 on every active reason, fail-closed on every malformed or hostile input I could construct) is intact and demonstrated across 11 renders; the untouched surface is instrument-verified byte-identical; the reason-key coverage is complete; three of the six mutations I planted die against the new tests. The two MED findings are a pre-existing deception channel this commit walks past (not a regression, parity proven against `106c2dc^`) and a test-coverage gap, neither of which degrades the gate.

## Single next action

Apply the one-token fix in `quoteNames` (`hooks/sessionstart-tool-enum.mjs:148`) so each name goes through `JSON.stringify`, and pin it with the finding-1 test. That closes the forged-reason-line vector and the finding-1 half of Issue #206 in a single line, cheap enough to fold in before merge rather than defer.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] quoteNames adds a quote char to the message grammar unescaped -- a third-party connector/MCP name forges a whole extra reason line with a spoofed "unlock: none needed, already approved"; sanitizeDetail strips control chars + length only, never delimiters; demonstrated end-to-end through both real hooks, and proven NOT a regression (same forgery lands on 106c2dc^ with a differently-tuned name). Exposure: 100% of SUR-03 unclassified halt messages interpolate an unescaped third-party name, basis: counted-in-code (sessionstart-tool-enum.mjs:454,462). Fix: JSON.stringify(name). Commented onto #206.
2. [ISSUE][MED][demonstrated] the 8 new tests never assert the composite string this story exists to produce -- mutation M4 (delete the tool/connector NAME from the rendered line) and M5 (bypass sanitizeDetail, re-opening Issue #97) both leave new-tests-only at 8 pass / 0 fail; only pre-existing tests catch them. The cross-script fixture pattern that would pin it already exists at userpromptsubmit-halt-relay.test.ts:129-180 and is unused. Fair credit: M1/M2/M6 all correctly die. Exposure: 0 of 8 new tests spawn both scripts, basis: counted-in-code. New Issue filed.
3. [ISSUE][LOW][demonstrated] a reason key colliding with Object.prototype (constructor/__proto__/hasOwnProperty/valueOf) resolves through the prototype chain in BOTH friendlyLabelFor and unlockHintFor -- renders "function Object() { [native code] }" as label AND unlock; fails CLOSED (exit 2, 5/5) but names neither reason nor unlock, and this commit removed the last slot where the raw key survived. Exposure ~0% of runs, basis: counted-in-code (sole non-test writer emits 4 fixed constants). Fix: Object.hasOwn guard. No Issue (LOW).
4. [SUSPICION][LOW][demonstrated] nothing standing pins FRIENDLY_LABELS/UNLOCK_HINTS/writer-key-set parity -- my check was ad-hoc and the new test file's 4-case list is hand-typed, so a 5th key drifts silently. Commented onto existing #205, not duplicated.
5. [CLEAN][demonstrated] no fail-open: friendlyLabelFor never returns undefined, never throws for a string key, and a throw would land in main().catch -> exit(2) anyway; quoteNames([]) unreachable on the active path (haltRequired === unclassified.length > 0, classification.ts:80); exit 2 in 11 of 11 active-reason renders.
6. [CLEAN][demonstrated] fallback masks nothing -- instrument shows FRIENDLY_LABELS' 4 keys == UNLOCK_HINTS' 4 keys == the complete set of 4 SUR-* reason-key literals in non-test source; sole real writer is hooks/sessionstart-tool-enum.mjs.
7. [CLEAN][demonstrated] claimed-untouched surface instrument-verified byte-identical: 25 declarations identical, exactly 2 CHANGED (describeActiveReasons, sessionstart main); UNLOCK_HINTS/sanitizeDetail/inspectHaltState/blockWithMessage/reconcileReason/writeHaltReason/halt-state payload shape all identical. (My v1 matcher was wrong and gave a false identical on main; corrected and re-run.)
8. [CLEAN][code-traced] concurrency/partial state unchanged -- the read-modify-write race and UNKNOWN_SESSION_ID additive-only bucket are byte-identical; this diff changes one string argument at two call sites, adds no write, key, or ordering.
9. [CLEAN][demonstrated] mixed-version halt state (17 pre-existing old-format files, gitignored) renders a redundant "Unrecognized tool: unclassified:" double prefix for one prompt -- blocks correctly, names every tool and the unlock, self-heals on the next SessionStart.
10. [CLEAN][demonstrated] pre-approved truncation residual bounded: "...[truncated]" marker present, unlock hint appended after truncation and never eaten, and the new format is 28-2N chars SHORTER than the old, so it truncates later than pre-diff for any list under 14 names.
counts (a CHECKSUM -- MUST equal the lines listed above): issues=3 suspicions=1 clean=6
evidence (a CHECKSUM over the tags above): demonstrated=9 code-traced=1 derived=0
checks=npm test 842 pass / 0 fail / 0 skipped (exit 0); new tests in isolation 8 pass / 0 fail / 0 skipped; typecheck clean; lint clean; 6 mutations planted+reverted (M1 8:5/3, M2 8:4/4, M4 8:8/0 + all-hooks 52:51/1, M5 8:8/0 + all-hooks 52:50/2, M6 8:5/3 + all-hooks 52:48/4); 11 end-to-end hostile/degenerate renders through the real hooks; 4 purpose-built instruments (untouched-surface hash diff, reason-key parity, pre-diff parity probe against 106c2dc^, mixed-version render); git status hooks/ clean after revert
adr=HIT(35)
report=docs/reviews/friendly-halt-messages-red-team-2026-09-17.md
