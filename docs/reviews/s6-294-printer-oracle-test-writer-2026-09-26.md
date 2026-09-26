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
