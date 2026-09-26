# App-security review: s6-policy-residuals-112-124 (Issues #112, #124; #107 ratified residual)

[app-security-reviewer]
App Security Reviewer (Horus) - reviewing for exploitable weakness

Tier: CRITICAL (policy delivery / config surface, a CLAUDE.md named sensitive area). Reviewed HEAD `8e65a2b` (detached, isolated checkout). Production diff `5ab5f06..8e65a2b -- src` (loader.ts, rule-types.ts, precedence.ts, schema.ts; 4 files, +86/-8). Test-writer diff `ae6b4f1..51bcefd` read for the #124 contract.

ADR compliance: `📊 ADR cache BUILT: cataloged 37 ADR(s) ... [CACHE=HIT]`. Applicable security-domain ADRs: THOTH-ADR-0001, THOTH-ADR-0002 (secret scanning / classification, `applicableTo` security). The diff touches neither the classification file nor the secret-scan patterns; no rule of either is violated. No ADR violation, no ADR blocker.

## Verdict: APPROVE-WITH-CONDITIONS

No blocking finding. The one open MED is a weakness in the amended #124 test oracle (production is sound); the rest is LOW hardening. Nothing consumes the new field, so live exposure of every finding below is nil today.

## What I ran (raw)

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | 0 vulnerabilities |
| `npm run typecheck` | clean (no output) |
| `npm run lint` | clean (no output) |
| `node --test "src/policy/**/*.test.ts"` | tests 475, pass 475, fail 0, skipped 0 |
| `npm test` (full) | tests 1130, pass 1130, fail 0, cancelled 0, skipped 0 (the expected gate-manifest failure did NOT occur here: no sibling agent checkouts exist under this tree; the string gate-manifest appears 0 times in the output) |
| `npm run oss:secret-scan` | `PASS: Full history scanned, 0 blocking secret-shaped matches found (2380 allowlisted)`, exit 0 |
| diff of `hooks` between ae6b4f1 and 8e65a2b, byte count | 0 (hook byte-identical to before the story) |
| grep `loadEffectivePolicy` / `config/loader` outside `*.test.ts` | only `printer.ts`; printer stdout does not render `defaultOutcome` (renderSuccess, printer.ts:80-100). `hooks/pretooluse-kernel-gate.mjs:50,119` still reads `BOOTSTRAP_DEFAULT_OUTCOME` |

(Note: `node --test src/policy` with a bare directory fails on Node 24/Windows with "test failed" at 51ms, a runner-invocation artifact, not a finding; the quoted glob form above is the real run.)

## Findings, ranked by exploitability x impact

### 1. [ISSUE][MED][demonstrated] The amended #124 oracle only catches a whole-file dump; a near-total dump passes 13/13

Evidence: `src/policy/config/printer.test.ts` `assertRejectionBound` (`raw-bytes-absent`: `!actual.includes(bound.raw)`), plus `rawBound(raw) = raw.trim()`.

Attack sketch: a "helpful diagnostics" regression appends all-but-one-character (or any strict slice) of the offending policy text to the rejection message; the exact-substring check does not see it, so the leak class red-team round-6 finding 2 raised survives in every form except the literal whole file.

Demonstration (mutant applied to `loader.ts` `parseLayerText` json-parse-error return, then reverted by restoring the file from the index):
- Mutant `message + newline + text.trim().slice(0, -1)`: `node --test src/policy/config/printer.test.ts` -> `tests 13 / pass 13 / fail 0` (survives).
- Control mutant `message + newline + text.trim()` (whole file): `tests 13 / pass 8 / fail 5` (caught).
- The production diff was empty after the revert.

Exposure: ~0% of runs today, basis: measured (production `loader.ts` at HEAD emits no raw bytes; verified in finding 8's probes). This is a guard-strength gap, not a live leak, so it is capped at MED and does not gate.
Minimal fix (test-only, `test-writer` lane): strengthen `raw-bytes-absent` to reject any run of N (say 24) consecutive characters of the trimmed raw text appearing in stdout, or cap total rejection stdout length; keep the exact-message form for the read-error site. Then re-run the slice mutant: it must go red.
Executable form: one new failing test, "ISSUE-123(b) partial-dump mutant": red against the mutant above, green against HEAD. It does not exist yet; writing it is the task.

### 2. [ISSUE][LOW][demonstrated] (pre-existing, not in this diff) Attacker-chosen key text is echoed unsanitized into rejection stdout

Evidence: `src/policy/rule/schema.ts:226-232` (`unknown key "${key}"`, `field: key`) joined by `src/policy/config/loader.ts` `parseLayerText` (`${e.field}: ${e.message}`) and printed by `printer.ts:72`.

Probe (project file whose top-level key is ESC-31m-FAKE, newline, REJECTED-LOOKALIKE): stdout was
`"central-channel status=absent\nREJECTED: project policy load failed (schema-invalid): .probe/proj2.json: \u001b[31mFAKE\nREJECTED-LOOKALIKE: unknown key \"\u001b[31mFAKE\nREJECTED-LOOKALIKE\""`
so an ESC sequence and a forged line reach the terminal. Attack sketch: a PR author's project policy file spoofs or recolours the reviewer's CLI rejection output. No code execution, no secret disclosure (printer is unwired). The new `defaultOutcome` field adds nothing here (its error text is a fixed string; the bad value is NOT echoed, see finding 8).
Exposure: ~0% of runs, basis: counted in code (only the manual `policy:print` CLI reaches it). LOW, no Issue per contract. Minimal fix: strip `[\p{Cc}\p{Zl}\p{Zp}]` from echoed keys (the class S5 #278 already adopted); route to a future printer story.

### 3. [SUSPICION][LOW][demonstrated] Peers override each other, so project can relax a shipped-defaults `deny` posture

Demonstration (27-cell matrix over shipped/central/project x {undeclared, allow, deny} through the real `mergeLayersWithMandatoryLock`): `s=deny c=undefined p=allow -> allow@project`.
This is the ratified D2 ("shipped-defaults and project are peers and override each other ... disclosed, not fixed"), consistent with how their rules already behave, so it is not a defect against the ruling. Worth naming because a scalar global posture is a larger lever than one rule id: with central absent (the default deployment) an in-repo project file under review can flip the baseline from deny to allow. Nothing consumes it today. Route to the hook-rewiring story's Phase 1 (same review-back point as the #107 row). No Issue (SUSPICION).

### 4. [SUSPICION][LOW][code-traced] A declared posture is accepted and silently inert until the hook is rewired

`schema.ts:13-15` now accepts `defaultOutcome`; `hooks/pretooluse-kernel-gate.mjs:119` still uses the code literal `allow`; printer stdout does not show the resolved posture (`printer.ts:80-100`). A policy author who writes `"defaultOutcome":"deny"` gets an accepting load and no enforcement, with only the generic `ENFORCEMENT_DISCLOSURE` note. This is the disclosed D3 and is already carried by Issue #288; no new Issue.

### 5. [CLEAN][demonstrated] Trust-boundary logic: central cannot be relaxed by a lower-trust layer

27/27 combinations run: `cells=27 central-relaxed violations=0`. Central `deny` is final in all 9 cells where it is declared; central `allow` can only be moved by project to `deny` (tighten, the fail-closed direction). A voided layer contributes nothing (`resolveDefaultOutcome(acceptedLayers)`, `precedence.ts:333`). Resolution reads `TRUST_RANK`, never layer names (`precedence.ts:207`).

### 6. [CLEAN][demonstrated] Schema completeness for `defaultOutcome`

Probed through the real `JSON.parse` + `validateRuleSet(parsed, rawText)`: `"allow"`/`"deny"` accepted; `null`, `0`, `["deny"]`, `{"a":1}`, `"DENY"`, `"deny "` all rejected with the field's own enum error; byte-identical duplicate and `defaultOutcome` unicode-escaped duplicate both rejected by the existing duplicate-key check; `__proto__` and `constructor` top-level keys rejected as `unknown key`; BOM-prefixed document still rejected at `JSON.parse` (unchanged). After all parses `Object.prototype.defaultOutcome` and `({}).defaultOutcome` are both `undefined` (no pollution). The `in` read at `schema.ts:277` is only reachable with an already-polluted `Object.prototype`, which nothing here creates.

### 7. [CLEAN][code-traced] Fail direction of every new branch

`resolveDefaultOutcome` is total over validated data (no throw path). If the merge did throw, `printer.ts:113-120` catches and renders a rejection (exit 1), never a permissive result. With no layer declaring a posture the loader falls back to `"allow"` with `source:"bootstrap"` (`loader.ts:268`): the same fail-open literal the hook already uses, ratified in the decisions row, and nothing enforces from it. A relaxing declaration by a lower layer is ignored, never an error (documented). A voided layer yields no posture and falls to the next layer or the bootstrap literal.

### 8. [CLEAN][demonstrated] Rejection-path disclosure after the #124 amendment

Three probe rejections from real policy files: malformed JSON with an `AKIA...` token in the body -> stdout carries only `Expected ',' or '}' after property value in JSON at position 62 (line 1 column 63)` (no snippet, Node 24.15.0); unknown key -> the key name only (finding 2); bad `defaultOutcome` value -> fixed enum text, value not echoed. V8 shows a ~10-character document-start snippet in the BOM case (`"{"version"...`), bounded and not a secret vector. A whole-file dump is still caught (control mutant red, 5 of 13).

### 9. [CLEAN][demonstrated] Secrets and hook

`oss:secret-scan` PASS, 0 blocking; the diff and both new decisions rows contain no credential-shaped string. Hook byte-identical (0-byte diff for `hooks`). `bootstrap-ruleset.ts`, kernel, printer.ts, pin.ts are unchanged by this story (the only production files changed are loader.ts, rule-types.ts, precedence.ts, schema.ts).

## Blockers vs hardening

- BLOCKERS: none.
- Condition (fix-now, test-only): Finding 1.
- Hardening (deferred, route named): Finding 2 (printer story), Finding 3 (hook-rewiring story Phase 1), Finding 4 (#288).

## Findings become tests

open findings = 1 [ISSUE][MED] = 1 failing test to write (the partial-dump mutant test). Findings 2-4 are LOW/SUSPICION with no executable form yet: hardening or design choices with no consumer; recorded here and in #288 / the hook-rewiring story rather than as tests. (Finding 2 is [ISSUE][LOW]: a sanitization test is possible but LOW issues do not spawn one.)

## Editorial

- printer.test.ts INTERPRETATION CHOICE 8's claim "no raw layer bytes may ride along" is stronger than the check (whole-file only); reword with finding 1's fix.
- The plan's expected `gate-manifest-check` failure did not occur in this isolated checkout (1130/1130): consistent, not a discrepancy.

## Single next action

test-writer: strengthen `assertRejectionBound` to a windowed/length bound and confirm the slice mutant goes red (finding 1). Then merge-handoff may proceed.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/policy/config/printer.test.ts assertRejectionBound: whole-file-only includes() lets an all-but-one-char raw dump in the message survive (13/13); fix = windowed/length bound + new red-on-mutant test
2. [ISSUE][LOW][demonstrated] src/policy/rule/schema.ts:226-232 + printer.ts:72 (pre-existing): attacker key text with ESC/newline echoed unsanitized into rejection stdout; fix = strip [\p{Cc}\p{Zl}\p{Zp}]
3. [SUSPICION][LOW][demonstrated] precedence.ts:207 peer rule: project can relax a shipped-defaults deny posture (ratified D2); revisit in hook-rewiring story Phase 1
4. [SUSPICION][LOW][code-traced] schema accepts defaultOutcome while hook/printer ignore it: silent no-op for authors until rewired (D3, tracked #288)
5. [CLEAN][demonstrated] trust lock: 27-cell matrix, central never relaxed by a lower layer (0 violations); voided layer contributes nothing
6. [CLEAN][demonstrated] schema: null/number/array/object/case/whitespace/duplicate/unicode-escaped-duplicate/__proto__/constructor all rejected; no prototype pollution
7. [CLEAN][code-traced] fail direction: resolution total, printer catch rejects, bootstrap allow fallback is the ratified pre-existing literal
8. [CLEAN][demonstrated] rejection paths do not echo the bad defaultOutcome value or file bodies (Node 24.15.0); whole-file dump still caught 5/13 red
9. [CLEAN][demonstrated] hook byte-identical (0-byte diff), nothing consumes the field, secret-scan PASS 0 blocking, no secrets in diff/reports
counts (a CHECKSUM): issues=2 suspicions=2 clean=5
evidence (a CHECKSUM): demonstrated=7 code-traced=2 derived=0
checks="1130/0/0"
adr=HIT(37)
report=docs/reviews/s6-policy-residuals-112-124-app-security-2026-09-24.md
