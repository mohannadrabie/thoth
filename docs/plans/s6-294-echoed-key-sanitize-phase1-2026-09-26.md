# s6-294-echoed-key-sanitize: Phase 1 plan (2026-09-26)

Issue #294 (closes the S6 milestone). Branch `fix/s6-294-echoed-key-sanitize`. Phase 1 only; nothing built.
ADR cache: `[CACHE=HIT]` 37 ADRs (fp 13c1476).

**Story, one sentence:** strip terminal-active characters (`[\p{Cc}\p{Zl}\p{Zp}]`, `u` flag) from every policy-derived string that `policy:print` writes to stdout, at the render boundary, without changing output for clean input or the fail-closed direction.

## 0. Readiness

One blocking question (section 4, Q1). Everything else is a default the Manager can strike. Manager rulings honored as given: Scope B, render-boundary placement, exact strip class, strip not escape, R5 instrument.

## 1. ADR review

| ADR | Verdict | Rule this story must honor |
|---|---|---|
| SE ADR-0005 | APPLICABLE | "MUST NOT delete or weaken a failing test to make CI pass"; "MUST write unit tests for every new/changed ... behavior". Bears on Q1 (locked oracle). |
| SE ADR-0010 | APPLICABLE | "MUST run the full local equivalent of CI gates before declaring work complete"; "MUST NOT lower coverage thresholds, delete tests". |
| SE ADR-0003 | APPLICABLE | "MUST NOT create modules that mix unrelated responsibilities" (helper is its own module); "SHOULD NOT over-abstract" (one function, no options). |
| SE ADR-0002 | APPLICABLE | Layering: the helper lives in `src/policy/config/`, beside its three consumers; nothing under `src/policy/kernel/` or `rule/` gains an import. |
| SE ADR-0021 | APPLICABLE | Kernel purity and fail-closed: kernel untouched; `qa:kernel-purity` stays green; a rejection stays a rejection (exit 1). |
| SE ADR-0004 | NOT-APPLICABLE | No mutating operation. (The helper is idempotent anyway; a cheap test says so.) |
| THOTH-ADR-0001 | NOT-APPLICABLE | Concerns `docs/qa/s5-central-classification.json`; not touched. Its "changes the loader ... still needs a fresh report" line is honored by the review chain in section 8. |
| THOTH-ADR-0002 | NOT-APPLICABLE | Secret-scan allowlist; not touched. |
| devops ADR-0001..0010 | NOT-APPLICABLE | No IaC/CDK/IAM. |
| SE ADR-0006..0009, 0011..0020, THOTH none other | NOT-APPLICABLE | Data, cost, tagging, port-fidelity; nothing here. |

UNCLEAR: none. Q1 needs a human/Manager reading of ADR-0005/0010 (an oracle amendment that strengthens a locked test), not an ADR clarification.

## 2. Findings that shape the plan (checked, not assumed)

- **Spike (rule 18): what does `JSON.parse` echo on Node 24.15?** Ran it. A malformed document prints its offending token plus about 4 to 10 characters from the document start, e.g. `Unexpected token '\u001b', "\u001b[31m\nREJE"... is not valid JSON`. Other shapes print only a position. So ESC and a newline do reach stdout at `loader.ts:138`, but a long forged line cannot ride this site. Site stays in scope (a 4-character `ESC [ 2 J` clears the screen).
- **Locked-test conflict (Q1).** `docs/qa/s6-policy-loader-fixtures/printer-project-bom-pretty-malformed.json` yields a `JSON.parse` message containing a real `\n` (probed: control-class match = true). `printer.test.ts` `assertExactMessage` requires the stdout tail to equal `REJECTED: ... : <raw JSON.parse message>` including that newline, and its own comment says such newlines are "legitimately embedded (Issue #123)". Stripping the class at this site makes that locked assertion fail. Inherent: no design both strips `\n` and keeps that assertion.
- **Only outflow of `LoadFailure.message` is the printer.** `hooks/pretooluse-kernel-gate.mjs:101` forwards `failedLayer` and `reasonKind` only, never `message`. So sanitizing in `printer.ts` covers every loader/schema message with no loader edit.
- **Print-cli NOTE line is untestable as written.** `print-cli.ts` hard-wires the real registry reader and `.thoth/policy.json`; no seam (and none may be added: Issue #99 bars env-selected paths). Plan extracts the NOTE string builder into `printer.ts` as one exported function; `print-cli.ts` keeps near-zero logic.
- **`rationale` is never printed** by any current path. The instrument still injects it and asserts absence, so a future echo trips the test.
- **Site 10** (kernel/hook deny reason) is out of scope: Issue #312.

## 3. Acceptance criteria (numbered, each mapped to a named check)

Derived criteria are marked (derived). None is load-bearing on the build shape.

| # | Criterion | Named check (file) |
|---|---|---|
| 1 | The helper strips exactly `\p{Cc}` (0x00-0x1F, 0x7F-0x9F), U+2028, U+2029, and nothing else. | `sanitizeForTerminal strips exactly the C0, DEL, C1, U+2028 and U+2029 code points across the whole BMP` (`sanitize.test.ts`; oracle is an explicit range list, not the same regex) |
| 2 | Clean text (letters, BOM, non-ASCII, emoji) comes out byte-identical. (derived: restates the "clean stays identical" ruling at the helper) | `sanitizeForTerminal leaves clean text byte-identical` (`sanitize.test.ts`) |
| 3 | The helper is idempotent. (derived) | `sanitizeForTerminal is idempotent` (`sanitize.test.ts`) |
| 4 | The helper's class literal equals the S5 hook's, so the two cannot drift. (derived; hook is read, never edited) | `sanitize class literal matches userpromptsubmit-halt-relay.mjs` (`sanitize.test.ts`) |
| 5 | Hostile text (ESC sequence + newline + forged `REJECTED-LOOKALIKE` line + U+2028 + U+0085 + CR) placed at every policy-derived JSON position, in each of the three layers, never puts a control character or an extra line on stdout, through the real `loadEffectivePolicy` + `printEffectivePolicy`. Positions are enumerated by a walk over a valid base document (top-level unknown key, every rule key as unknown key, rule id, effect, verbs/targets/environments elements, rationale, version, bad `defaultOutcome` value), not hand-listed. | `hostile text at every policy-derived JSON position never reaches stdout` (`echo-sanitize.test.ts`, one subtest per position x layer) |
| 6 | Structural echoes are covered: duplicate top-level key, duplicate rule id, mandatory-collision `VOIDED:` line plus the surviving `rule id=` lines, malformed-JSON raw text, a read-error message, and the scanned/parsed key-list disagreement message. | `hostile text in duplicate key, duplicate id, mandatory collision, malformed JSON, read error never reaches stdout` (`echo-sanitize.test.ts`); `key-scan disagreement message is sanitized at the printer boundary` (`echo-sanitize.test.ts`; see risk R-3 on reachability) |
| 7 | The inert-mandatory NOTE line is sanitized and, for clean input, equals today's exact string. | `renderInertMandatoryNote strips hostile id and layer, one line` and `renderInertMandatoryNote output for clean input equals the pre-change literal` (`echo-sanitize.test.ts`) |
| 8 | Raw text is kept below the render boundary: `validateRuleSet` still returns the raw offending key (comparisons and `schema.test.ts` unaffected), and the printed unknown-key error still names the (stripped) offending key; a clean unknown key prints exactly `unknown key "bogus"`. | `validateRuleSet keeps the raw hostile key in its error` and `printed unknown-key error names the stripped offending key (POL-06)` (`echo-sanitize.test.ts`) |
| 9 | Fail-closed direction unchanged: every hostile rejection variant still exits 1 with `posture: unresolved`; every hostile-id success variant still exits 0; sanitizing never turns a rejection into a load. | `sanitizing never changes the exit code or posture` (`echo-sanitize.test.ts`, asserted inside the AC-5/6 loops) |
| 10 | Every `${...}` interpolation in `printer.ts` and `print-cli.ts` is either wrapped in the helper or on a named code-controlled allowlist (enums, counts, digest, timestamps). A future unsanitized echo fails the test. (derived from the R5 instrument requirement; a source scan, labelled heuristic) | `every interpolation in the print modules is sanitized or allowlisted` (`echo-sanitize.test.ts`) |
| 11 | Clean-input output is byte-identical: the locked `printer.test.ts`, `loader.test.ts`, `schema.test.ts`, `print-cli.test.ts` pass with no assertion edited (subject to Q1's one oracle line), and `npm run policy:print` on the repo's own inputs prints the same bytes before and after (hash compared). | existing suites unmodified; evidence command `npm run policy:print` sha256 before vs after (recorded in the PR) |
| 12 | Scope held: `schema.ts`, `schema.test.ts`, `loader.ts`, `hooks/*`, `docs/qa/s5-central-classification.json` unchanged. | evidence command `git diff --name-only master...HEAD` reviewed against the file list in section 6 |
| 13 | Gates green with real counts: typecheck, lint, full `node --test`, `qa:kernel-purity`, `qa:normalizer-registry-purity`, `qa:gate-manifest`, `qa:completeness-claims`, QA-14 diff mode, secret scan. | commands in section 7 |

Completeness statement (hard rule): the claim "every policy-derived echo site is covered" is carried by checks 5, 6 and 10 (enumerating walk plus interpolation scan), not by this document's prose. This plan makes no numeric completeness claim; the tests derive their own position list and must not hard-code a count.

## 4. Blocking question and defaults

**Q1 (blocks Phase 2): the `JSON.parse` site collides with a locked test.** See section 2. Options:
- **(a) Recommended.** `test-writer` (author of the locked file), or an explicit Manager authorization, changes ONE helper, `parseFailureBound` in `printer.test.ts`, so its expected message passes through the same helper (the file's own Issue #291 principle: the expected message is computed, not hand-typed). No assertion is removed or weakened; it becomes stricter (asserts the sanitized message). It fails first against unsanitized code (red), so it is the failing test for this site. Needs a Manager/human reading of SE ADR-0005 and ADR-0010, the same kind of call as the S7 AC-2 amendment (still pending human ratification per `docs/STATE.md`).
- (b) Drop the `JSON.parse` echo from scope (Issue #294 residual: ESC + newline + about 10 characters at document start still reach stdout). Not recommended.
- (c) Keep `\n` at that one site. Rejected: it is the forged-line vector.

Non-blocking defaults (Manager may strike; each is one line to reverse):
- **Q2, placement.** Messages are sanitized in `printer.ts` `renderRejection`, not in `loader.ts`. Reason: the printer is the single outflow (section 2), it also covers read-error text and the catch-all backstop, and `loader.ts` (named sensitive surface) is not edited. This deviates from the ruling's list, which named the loader join as a render point; the loader sites are covered because their only output path is `renderRejection`. If the Manager prefers the loader edit, it moves the call to `loader.ts:138` and `:144`; every check above still passes.
- **Q3, three extra sites beyond the Scope B list.** `origin` (printer rule line), `centralChannel` (printer status line), `pin.channel` (print-cli pin line). In production these are code constants or repo paths, so they are not attacker-chosen today; wrapping them makes the rule uniform ("every interpolated string is sanitized or allowlisted") and keeps check 10 simple. Strike them if the Manager wants strictly the listed sites (then they join the check-10 allowlist).
- **Q4, extraction.** `renderInertMandatoryNote(d)` moves from `print-cli.ts` into `printer.ts` (exported), sanitized there; `print-cli.ts` calls it. Needed to test the NOTE line at all.
- **Hook not touched.** The hook keeps its inline class (`userpromptsubmit-halt-relay.mjs:175`); the plan adds one new copy of the one-line regex in `sanitize.ts` plus check 4 as a drift guard. Moving the hook onto the shared helper would edit a `UserPromptSubmit` enforcement file (sensitive), change plain-JS-to-TS import shape, and buy nothing this story needs. Not justified here.

## 5. Constraints and sensitive areas

- CLAUDE.md hard rules: no gold-plating (Site 10 stays #312); completeness claim from an instrument; domain logic gets tests with the feature.
- **Sensitive area touched:** Policy delivery / config surface (`src/policy/config/printer.ts`, `print-cli.ts`; the loader is deliberately not edited). Fresh dated review report(s) in `docs/reviews/` required before ship.
- Not touched: hook enforcement points, guard engine, evidence trail, CI/secret-scan files, halt-state directory.

## 6. Plan

Files:

| File | Change |
|---|---|
| `src/policy/config/sanitize.ts` (new) | `export function sanitizeForTerminal(text: string): string` = `text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "")`. No NFKC, no truncation (both would alter clean bytes; the hook's NFKC and 200-character cap are its own diagnostic-line policy). Header comment: strip not escape, and the accepted residuals below. |
| `src/policy/config/printer.ts` | Wrap `message` (renderRejection), `centralChannel` (status line), `v.layer`, `v.ruleId`, `rule.id`, `origin` (renderSuccess). Add exported `renderInertMandatoryNote(d)`. Code-controlled values (`failedLayer`, `reasonKind`, `effect`, `sourceLayer`, `line`, `mandatory`, counts) stay bare. |
| `src/policy/config/print-cli.ts` | NOTE loop calls `renderInertMandatoryNote`; wrap `pin.channel`. |
| `src/policy/config/sanitize.test.ts` (new) | Checks 1-4. |
| `src/policy/config/echo-sanitize.test.ts` (new) | Checks 5-10. Base document valid per `validateRuleSet`; key sets derived from `validateRule`'s own `expected: one of: ...` text (so a new schema key forces the base document to grow); temp files for shipped/project layers, stub `CentralPolicySource` for central; oracle = no class character except the printer's own `\n`, no line starting with the forged marker, line count equals the structural expectation (2 for a rejection). Includes an "oracle bites" subtest that feeds the oracle a known-bad string and expects a failure. |
| `docs/qa/...`, `printer.test.ts` | Only Q1(a): one line in `parseFailureBound`, authored by `test-writer` or authorized by the Manager. Implementer does not edit it. |
| `CHANGELOG.md` | One entry (Phase 2). |

Order of work (findings arrive as failing tests):
1. Reachability probe for the key-scan disagreement branch through real files; if unreachable, record it and keep the direct schema-level test plus the read-error stand-in (R-3).
2. Write `sanitize.test.ts` and `echo-sanitize.test.ts` failing; run and capture the red counts.
3. After Q1(a) lands red, add `sanitize.ts`; make printer/print-cli changes; go green.
4. Capture the before/after `policy:print` hash (before taken on the unmodified branch head first).

Numbers: none measured or assumed. No latency, capacity or size figure depends on this change.
Walking skeleton / spike: the `JSON.parse` echo probe above is the only measurement; no new shape, no skeleton needed.

Rollout / rollback: pure code, no flag, no data. The printer is unwired (nothing enforces from it). Rollback = revert the commit; a revert only reintroduces the terminal-injection defect.

**Accepted residuals (Manager to record in `docs/decisions.md`; implementer adds a code comment):**
- Strip, not visible-escape (ruling Q3): a stripped key can read like a known key, e.g. `vers<ESC>ion` prints as `unknown key "version"`. The error still carries the rule index / the fact it is an unknown key, but the printed name can mislead. Accepted.
- The class excludes format characters (`\p{Cf}`), so bidi overrides (U+202E) and zero-width characters survive; they cannot forge a line or emit an escape but can visually reorder text. Same residual S5 #278 accepted.
- No NFKC, so homoglyph lookalikes survive.
- Two distinct hostile keys can strip to the same printed text.

## 7. Verification plan (commands, run in Phase 2 with real counts)

- `npm run typecheck`, `npm run lint`, `npm test` (record pass/fail/skipped; skipped is not passed).
- `npm run qa:kernel-purity`, `qa:normalizer-registry-purity`, `qa:gate-manifest`, `qa:completeness-claims`, QA-14 diff mode (`.claude/worktrees/` must be empty first, per STATE.md process note), the secret scan.
- Before/after: `npm run policy:print | sha256sum` on unmodified head and on the finished branch (check 11).
- `git diff --name-only master...HEAD` (check 12).
- Red evidence: counts of the new tests failing before the code (recorded in the PR skeleton).

## 8. Risk tier and review chain

**Proposed tier: CRITICAL.** Justification: the change edits the Policy delivery / config surface, a named sensitive area in `CLAUDE.md`, and is a security control (terminal-injection sanitization) whose bypass classes are worth an adversarial pass; it also amends a locked test oracle (Q1).

Challenge I considered: by blast radius alone this is STANDARD (rule 20(c): manual, unwired operator CLI; Issue #294 is LOW; no code execution, no secret disclosure). I propose CRITICAL because the named-sensitive-area rule is unconditional and the hard rule "no changes to sensitive areas without a fresh dated review report" applies either way; the Manager ratifies. If ratified STANDARD instead, the minimum is `app-security-reviewer` + `cross-domain-reviewer` with the same fresh-report requirement.

Reviewers (CRITICAL): `red-team` (bypass classes: `\p{Cf}`, lone surrogates, position not enumerated, key-scan disagreement, hostile text through a path the walk misses), `app-security-reviewer` (the one domain pick), `cross-domain-reviewer` (standing, uncapped). Not needed: `architecture-reviewer` (no novel shape), `api-reviewer`, `data-reviewer`, `performance-reviewer`, `design-challenger` (no design surface; the design is one 1-line function). Dispatch each in an isolated worktree per the STATE.md process notes.

## 9. Test-first dispatch check

**Answer: NO.** This story changes no UI flow and no API surface. Valid input produces byte-identical output (check 11); the only behavior change is for hostile input on an operator CLI's stdout, which is neither a UI flow nor an API contract in `CLAUDE.md`'s sense (no Playwright journey, no HTTP/API surface). Contrast S7, which added a new printed posture line (a new output surface) and did dispatch `test-writer`. Failing tests come first anyway (section 6, order 2), written by the implementer.

Single exception: the Q1(a) one-line oracle amendment to `printer.test.ts` must come from `test-writer` (or an explicit Manager authorization), because the implementer never edits a test file `test-writer` produced. That is an amendment, not a full `test-writer` pass, and it does not gate the rest of the plan.

## 10. Risks

- R-1: check 10 is a source-scan heuristic and can be brittle; it is labelled as such and backed by the enumerating walk (check 5).
- R-2: the base document must stay valid and cover every schema key; the derived key set fails loudly if the schema grows.
- R-3: the scanned/parsed disagreement message may be unreachable through real files (the scanner and `JSON.parse` agree on well-formed input). If the probe confirms that, criterion 6's last item is covered by a direct schema-level test plus the printer's whole-message sanitization (proved by the read-error path), and the report says so plainly rather than claiming a real-path test.
- R-4: exact edits to `printer.ts` interpolations must keep `printer.test.ts` exact-string equality for clean fixtures; guarded by check 11.

## 11. Single next action

Manager rules on Q1 (option a recommended) and confirms or strikes Q2 to Q4; then dispatch Phase 2.
