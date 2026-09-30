# s361-hooks-typecheck — app-security review (Horus), 2026-09-30
Tier CRITICAL. Diff e26e7aa..eb0b2d2 (s7/closeout), read/run in own detached worktree (removed after).
ADR: `📊 ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]` — no applicable ADR standard violated.

## Verdict: APPROVE — zero blocking findings, zero open findings, zero failing tests.

## Evidence (raw)
- `npx tsc -p tsconfig.hooks.json` → rc=0, no output (all 3 hooks clean under strict+checkJs).
- Runtime-equivalence: parsed old (e26e7aa) vs new source with TS printer, comments removed. `hooks/userpromptsubmit-halt-relay.mjs: IDENTICAL after comment-strip` (sanitize copy, fail-closed paths, exit 2 untouched). `hooks/sessionstart-tool-enum.mjs`: 4 diffs, all `${x?.stack}` → `${(x)?.stack}` (parenthesized JSDoc-cast; runtime-identical, catch-message strings unchanged). Halt-state write path (`writeHaltReason`, `reconcileReason`) has annotations only; `payload` typed `Record<string, unknown>` by comment.
- Suppression/erasure: `grep -nE 'ts-ignore|ts-expect-error|ts-nocheck|as unknown|@type \{\*\}' hooks/*.mjs` → no matches (rc=1). The 5 `{any}` are all on JSON-parsed inputs (`initialHaltState`, `projectSettings`, `haltState`) plus `fixtureLocation` (documented reason).
- Sanitize force reaches the hooks: mutation appending `renderHookOutput({})` to the relay → `hooks/userpromptsubmit-halt-relay.mjs(583,1): error TS2554: Expected 2 arguments, but got 1.` (file restored; nothing left in worktree). Neither hook calls renderHookOutput today (relay uses its own inline `diagnosticSanitize`, unchanged), so the force is a forward guard, and it is live.
- Tests: `node --test` on hook-typecheck-coverage-check{,.fixnow}.test.ts + classification-builtin-override.test.ts → 50 tests, 50 pass, 0 fail, 0 skipped. `node src/qa/hook-typecheck-coverage-check.ts` → all 3 hooks 0 diagnostics; baseline `{"pinned":{...:[],...:[]}}` empty.
- R1-11 regex change (classification-builtin-override.test.ts:181-183): probe → matches new cast spelling (true), old spelling (true), a malformed cast (false). Test-only; still pins the detail prefix that feeds the relay's 200-char cap.

## Findings
1. [CLEAN][code-traced+demonstrated] No runtime change on enforcement paths (relay byte-identical minus comments; SessionStart only cast parens).
2. [CLEAN][demonstrated] Sanitize-arg type force now genuinely covers all 3 hooks (TS2554 mutation).
3. [CLEAN][demonstrated] No suppression/type-erasure spelling introduced.
4. [SUSPICION][LOW][derived] `@param {any}` on JSON-shaped inputs (`inspectHaltState`, `wasReasonActive`, `isProjectMcpServerEnabled`) leaves those parse boundaries un-typed at the type level; runtime guards (typeof/Array.isArray/boolean checks) do the real work and are unchanged. No exploit; `unknown` + narrowing would be a future hardening, not a gate.
5. [SUSPICION][LOW][derived] R1-11 regex makes the cast and paren optional independently (`(?:...\()?err\)?`), so it accepts slightly more spellings than the hook uses; harmless for a source scrape, still fails if the template prefix or `err?.message` changes.

## Blockers vs hardening
Blockers: none. Hardening: items 4, 5 (optional, no Issue per rule: LOW).

Exposure: n/a (no blocking findings).
open findings = 0; failing tests = 0.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][derived] hooks/userpromptsubmit-halt-relay.mjs inspectHaltState / sessionstart-tool-enum.mjs wasReasonActive: `@param {any}` on JSON inputs; runtime guards unchanged; optional `unknown` narrowing later
2. [SUSPICION][LOW][derived] src/policy/tools/classification-builtin-override.test.ts:183: R1-11 regex accepts marginally more spellings than used; harmless
3. [CLEAN][demonstrated] relay identical after comment-strip; SessionStart differs only by cast parentheses
4. [CLEAN][demonstrated] renderHookOutput sanitize force reaches relay (TS2554 mutation)
5. [CLEAN][demonstrated] no ts-ignore/expect-error/nocheck/as unknown in hooks/*.mjs
counts: issues=0 suspicions=2 clean=3
evidence: demonstrated=3 code-traced=0 derived=2
checks="50/0/0"
adr=HIT(37)
report=docs/reviews/s361-hooks-typecheck-app-security-2026-09-30.md
