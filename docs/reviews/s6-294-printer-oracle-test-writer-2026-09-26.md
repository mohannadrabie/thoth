# s6-294 printer.test.ts oracle amendment (Q1a) - test-writer report, 2026-09-26

[test-writer] Khnum. Scope: API/CLI-output oracle amendment (no UI). Commit dfae8d6 on fix/s6-294-echoed-key-sanitize.

## ADR
`[CACHE=HIT]` 37 ADRs. Applicable: SE ADR-0005 / ADR-0010 (no assertion deleted or weakened: honored, the oracle is stricter). No conflicts.

## Discovery
ui-framework: n/a. api-framework: node:test + node:assert/strict (existing convention in printer.test.ts; no second framework introduced).

## Change (exact lines, src/policy/config/printer.test.ts)
```diff
+import { sanitizeForTerminal } from "./sanitize.ts";
-  return { message: `${origin}: ${reason}`, raw: text.trim() };
+  // AMENDED 2026-09-26 (Issue #294, ...): comment (3 lines)
+  return { message: sanitizeForTerminal(`${origin}: ${reason}`), raw: text.trim() };
```
Inside `parseFailureBound`. The message is still computed from JSON.parse's own error (offending token still asserted), then run through the helper; the whole composite is sanitized because the printer sanitizes the whole `${origin}: ${msg}` message. `raw` and `assertNoRawEcho` untouched. No other line edited.

## Red run (AC: Issue #294 / criterion 11 + Q1)
1. Baseline before edit: `node --test src/policy/config/printer.test.ts` -> tests 20, pass 20, fail 0.
2. After edit (sanitize.ts absent): tests 1, pass 0, fail 1; `ERR_MODULE_NOT_FOUND: Cannot find module '...src\policy\config\sanitize.ts' imported from ...printer.test.ts` (whole file fails to load; 20 tests cannot run).
3. Reason-2 check with a TEMPORARY stub sanitize.ts (deleted afterwards, not committed; printer.ts unchanged, so it still emits the raw newline): tests 20, pass 18, fail 2:
   - ISSUE-108(c) pretty-printed BOM project file
   - ISSUE-123(c) exact-message equality, site "project BOM (pretty)"
   Both fail with the ISSUE-123(c) exact-tail assertion, i.e. the current printer's raw newline no longer matches the sanitized oracle. The 18 others pass, so the oracle is correct once the printer sanitizes.

## AC mapping
Amendment traces to plan criterion 11 (locked suites pass unmodified apart from Q1's one oracle line) and Q1(a); no new tests added (the implementer writes sanitize.test.ts / echo-sanitize.test.ts per plan section 6). Grep-counted tags: n/a (no new test bodies).

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test
tests="0/0/0/0" (amendment of 1 existing oracle helper; 0 new tests) mapped to 1/1 (Q1a / plan criterion 11) acceptance criteria (grep-counted from AC tags, not hand-typed)
red-run: checks="1/1" (file fails to load: ERR_MODULE_NOT_FOUND on ./sanitize.ts; with a temp stub, 2/20 fail on the raw-newline site, 0 unexpectedly passing new tests)
adr=HIT(37)
report=docs/reviews/s6-294-printer-oracle-test-writer-2026-09-26.md

---

## Addendum 2026-09-26 (Q1a follow-on): second oracle line, ISSUE-108(c) `> 2` assertion

Authority: Manager ruling (human preapproved Manager decisions this session), same Issue #294 / Q1(a) class as the first amendment. My earlier amendment missed one locked assertion that depended on the raw newline surviving to stdout.

**Defect found by the build:** `src/policy/config/printer.test.ts` test `ISSUE-108(c)` asserted `result.stdout.split("\n").length > 2`. That held only while the JSON.parse error snippet's raw newline was echoed. With the ruled sanitizer the rejection is exactly two stdout lines.

**Red evidence (pre-amendment, real run against HEAD with the built sanitize.ts/printer.ts):** `node --test src/policy/config/printer.test.ts` -> tests 20, pass 19, fail 1, skipped 0. The single failure was `ISSUE-108(c)`: `AssertionError ... expected this PRETTY-PRINTED BOM fixture's rejection to span MORE than 2 lines ...; got: central-channel status=absent / REJECTED: project policy load failed (json-parse-error): ...printer-project-bom-pretty-malformed.json: Unexpected token '<BOM>', "<BOM>{  "vers"... is not valid JSON` (2 lines, newline stripped).

**Amendment (only that test; nothing else touched):**
- Title: prefixed `[AMENDED 2026-09-26, Issue #294, Manager ruling]` and reworded to say the JSON.parse newline is now stripped and the rejection is EXACTLY 2 stdout lines.
- Assertion: `assert.ok(split("\n").length > 2, ...)` -> `assert.equal(split("\n").length, 2, ...)` (stricter, not loosened); the 4-line explanatory comment above it replaced by an AMENDED comment stating why.
- Unchanged and still passing: exit code 1 assertion, `buildExpectedRejectionStdout(...)` against the sanitized bound, no "central policy load failed" misattribution.

**Scan for other assertions of the same class** (raw control character / newline from policy-derived text surviving to stdout), across `*.test.*` under src/ and hooks/:
- `printer.test.ts` `split("\n")` sites: line 322/324 (reads fixture files, not printer output); 425 (fixture builder join); 475 `assertExactMessage` and 490-493 `buildExpectedRejectionStdout` use `>= 2` lines and rejoin `slice(1)` -- tolerant of either line count and compare against the sanitized bound, so NOT raw-dependent (already correct after Q1a); 529 compares line 1 only. The comments at ~103 and ~244 are historical prose, left alone. The only raw-dependent assertion was ISSUE-108(c).
- `print-cli.test.ts`: `split(/\r?\n/)` filters `posture:` lines from the CLI's own output; independent of policy-derived text.
- `sanitize.test.ts` and `echo-sanitize.test.ts` (implementer-owned, new, assert the sanitized behavior); `gate-structure.test.ts` does not touch the printer.
- `hooks/userpromptsubmit-halt-relay-*` and `src/secret-scan/*` `split("\n")` sites concern other surfaces (halt relay, secret scan CLI), do not exercise `printEffectivePolicy`/`sanitizeForTerminal`, and remain untouched.
Result: exactly one same-class assertion (ISSUE-108(c)); amended.

**Green evidence (post-amendment):**
- `node --test src/policy/config/printer.test.ts` -> tests 20, pass 20, fail 0, skipped 0.
- `npm test` (full) -> tests 1325, pass 1325, fail 0, cancelled 0, skipped 0, todo 0.

**Lane:** only `src/policy/config/printer.test.ts` and this report addendum changed; no production code touched. `docs/.maat-state.json` shows as modified in the working tree from before this pass (adr-cache refresh) and is deliberately NOT committed here.

## AC mapping (addendum)
Traces to plan criterion 11 / Q1(a) (locked suites pass unmodified apart from the ruled oracle amendments). No new tests; 1 existing assertion strengthened (`> 2` -> `=== 2`).

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test
tests="0/0/0/0" (amendment of 1 existing assertion in ISSUE-108(c); 0 new tests) mapped to 1/1 (Q1a / plan criterion 11) acceptance criteria (grep-counted from AC tags, not hand-typed)
red-run: checks="1/20" (pre-amendment: ISSUE-108(c) failed on `> 2` against the built sanitizer; post-amendment printer.test.ts 20/20 pass, full npm test 1325/1325 pass, 0 fail, 0 skipped)
adr=HIT(37)
report=docs/reviews/s6-294-printer-oracle-test-writer-2026-09-26.md
