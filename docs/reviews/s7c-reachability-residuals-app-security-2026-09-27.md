[app-security-reviewer]
App Security Reviewer (Horus) - reviewing for exploitable weakness

# S7-C reachability residuals: application security review (2026-09-27)

- Scope: Issues 334 and 335, branch feat/s7c-reachability-residuals, HEAD 6637833, S7-C-only diff (git diff 1aba7df HEAD: rule-reachability.ts, its test, the tool-class-format.ts comment, the decisions row, CHANGELOG, the Phase 1 plan).
- Tier: CRITICAL (sensitive area: policy delivery / config surface). Worktree: C:\playground\thoth\.claude\worktrees\agent-a96252388a70961e3 (detached at 6637833).
- ADR compliance: the ADR cache reporter printed "ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]". I read the input-handling, secrets-adjacent and data-exposure rules from the catalog slice; the diff violates none. No ADR blocker.
- Read: CLAUDE.md, the Phase 1 plan, the 2026-09-27 decisions row, red-team round-2 findings 2 and 3, rule-reachability.ts, loader.ts (call site), kernel.ts (matching and precedence), the three normalizers' verb emit points, action-catalog.ts, sanitize.ts, printer.ts (rejection render), the gate hook header, Issues 308, 329, 338.

## What I ran

| Command | Result |
|---|---|
| node --test --test-concurrency=1 on rule-reachability.test.ts, loader-reachability.test.ts, loader.test.ts, tool-class-golden.test.ts | tests 57, pass 57, fail 0, skipped 0, todo 0 |
| Mutant 1: allow-widening branch applied to every effect | 5 failing (R2-5, R2-13, R2-12, R2-6, R2-17 part 3); reverted |
| Mutant 2: empty-array case dropped (absent verbs only) | 2 failing (R2-12, R2-17 part 2); reverted |
| Mutant 3: marker-required condition dropped and marker-plus-stray collapsed to markers-only | 2 failing (R2-12, R2-20); reverted |
| Probe: real shell normalizer plus real kernel, deny baseline, redirect record mcp/my_dir/f.py (verbs write), against rule shapes | table below |
| Probe: 20000-target allow rule with no verbs through checkRuleReachability | 20000 errors, 11,766,668 joined characters, 39 ms |
| Probe: hostile characters in a rule id and a server segment | U+202E, U+2028, U+200B and U+0085 survive raw in the message; ESC is escaped by JSON quoting |

Probe table (allow rule, target mcp/my_dir/, an unpresentable server; rejected = errors from the check; kernel = decision for the shell redirect record under a deny baseline):

| Rule shape | rejected | kernel on the redirect |
|---|---|---|
| no verbs field | 1 | allow (the widening is real) |
| empty verbs array | 1 | allow |
| marker only | 1 | deny |
| marker plus WRITE (case-variant stray) | 1 | deny |
| write only | 0 | allow |
| marker plus write | 0 | allow |
| two targets, one presentable and one not, no verbs | 1 | allow |
| target ./mcp/my_dir/ (not the MCP prefix) | 0 | deny |
| lookalike marker (fullwidth colon) | 0 | no match |
| verb __proto__ | 0 | deny |

## Findings, ranked by exposure x irreversibility x silence

Live exposure for everything below is 0%: the gate hook is unwired (Issue 308) and the committed shipped-defaults and project policy files hold zero rules (the test that prints their counts, restated in the decisions row).

### 1. [ISSUE][LOW][demonstrated] The aggregate loader failure message is still uncapped (open finding R2-18, routed, not built)
- Evidence: one allow rule with 20000 bad targets yields 20000 errors and about 11.8 million characters joined into one schema-invalid message in 39 ms (loader.ts:159 joins every error, no cap); policy:print then prints it.
- Attack sketch: whoever can write the project policy file makes the print surface emit megabytes; the gate hook never echoes it (fixed stderr line), so the model channel is not hit.
- Exposure: ~0% of loads, basis: counted in code (zero committed rules; gate unwired).
- Fix: cap the joined error count with an "and N more" tail. S7-C widens the set of inputs that produce an error but does not change per-error size, so it does not worsen this in kind.
- Executable form: R2-18 aggregate-message-cap (named by the red-team, unbuilt; the decisions row keeps the number free on purpose).

### 2. [SUSPICION][LOW][demonstrated] The residual recorded in Issue 338 understates the allow shapes that still load
- Evidence: the probe table. An allow rule with write (or a marker plus write) on an unpresentable server target loads (rejected 0) and the real kernel returns allow for the real shell redirect record. Red-team round-2 finding 3 measured exactly this legacy-verb half; S7-C closes only the no-verbs half. R2-17 part 3 pins the legacy-verb allow as a ruled edge and decisions row item (a) states it, but Issue 338 and fact 4 of the tool-class-format.ts comment describe only "a presentable server target with no marker verb". An allow with no verbs on the bare MCP prefix also loads by ruling and is not named in 338.
- Assessment: an author literally writing a write allow on a path is far less surprising than the no-verbs case, so this is a ruled edge and not a defect in the diff. What is incomplete is the activation-precondition record.
- Fix: a comment on Issue 338 widening its scope to any allow that can match a shell redirect record (a catalog verb on an unpresentable target, no verbs on the bare prefix, no marker on a presentable target), and a line in Issue 308's precondition list. No code change.
- Executable form: none; it is a record correction and an activation-time decision (reject or disclose), so it resolves to a residual-register line.

### 3. [SUSPICION][LOW][demonstrated] A verb list holding only a lookalike of the marker (or only strays) loads inert, silently for a deny
- Evidence: a verb spelled with a fullwidth colon in place of the ASCII colon is not caught by V1 (it does not start with the ASCII prefix) and is outside the S7-C scope (no exact marker), so targetScope returns undefined and V2 and V3 are skipped; probe shows rejected 0.
- Assessment: disclosed as out of scope (docs/backlog.md) and by the header. For an allow the same shape is inert and fails closed. Not a regression.
- Exposure: ~0%, basis: counted in code. Executable form: none today (backlog scope by ruling).

## Verified sound

### 4. [CLEAN][code-traced] The rejections close the allow-widening without opening a new fail-open
- Clause (i), a class marker present and no verb any normalizer emits: the only verb-emitting sites are the tool-class normalizer (one marker, tool-class.ts:67), the shell normalizer (a resolveVerb result plus the literal write, shell.ts:393 and 396, both catalog members) and the cluster normalizer (a resolveVerb result, structured-cluster.ts:45). resolveVerb returns only a catalog member (action-catalog.ts:43). No shell or cluster record carries a marker or a stray, so a marker-plus-stray rule can match only a class record, whose target the runtime always presents with an admitted server segment. Rejecting such a rule loses nothing that could match. R2-19 enumerates the emitted verbs at run time; I traced the emit sites independently.
- Clause (ii), an allow with no verbs: matches the kernel (matchesVerb returns true for absent and empty, kernel.ts:116-117) and the probe. A deny with no verbs stays loadable because it only denies more.
- Direction: a rejected rule fails the layer load, and a failed load is a whole-load rejection the gate turns into a deny. The change only tightens; it lets nothing through that the S7-B check rejected (mutants 1 to 3 confirm every branch is load-bearing).
- Evidence: rule-reachability.ts:114-120 and 134-156, kernel.ts:116-118, the three emit sites above.

### 5. [CLEAN][code-traced] Rejecting on all three layers, and the central whole-load availability caveat, are stated honestly
- One call site (loader.ts:155), after the schema check, same schema-invalid kind, layer-attributed. Central, shipped-defaults and project rules are all checked, so no lower-trust layer can carry a shape the central owner cannot.
- A newly rejected central rule fails the whole load, so every governed call is denied until the out-of-session owner fixes the source. That is fail-closed, matches the S7-B ruling, is stated in the module header and decisions row item (h), and migration exposure is zero rules today. The central Unlock names the owner and says a session cannot repair it (rule-reachability.ts:92-97). A project or shipped-defaults file that triggers the rejection also fails the whole load, which is the existing behavior for any schema error, so this adds no new denial-of-service surface.

### 6. [CLEAN][demonstrated] Error and Unlock text stays inside the S6 sanitizer boundary
- Policy-derived text (rule id, verb, target, server segment) is JSON-quoted and capped at 80 characters (rule-reachability.ts:86-88), so C0 controls such as ESC are escaped. Probe: U+202E, U+2028, U+200B and U+0085 survive in the raw message, but it is rendered only through sanitizeForTerminal (printer.ts:141, strips Cc, Zl, Zp), and the gate hook never places the raw message on its model-visible channel (fixed line: layer, kind, error type). The surviving format characters are the residual S6 already accepted in sanitize.ts. The new static clauses (whyRejected, withMarkerFix) contain no author text.

### 7. [CLEAN][demonstrated] Input validation on targetScope holds
- Verbs and targets reach the check only after validateRuleSet (string arrays enforced), and loader.ts is the only production caller, so non-string elements cannot arrive. The verb __proto__ is a plain string that loads inert with no prototype effect (arrays and a Set, no object keys). Duplicates are harmless (no per-element state). Case is exact, matching the kernel, so a case-variant stray is correctly a stray. Cost is linear with constant-time Set lookup (20000 targets in 39 ms). Odd-unicode server segments fail the anchored admitted-name pattern (V3); the pattern has no multiline flag, so a trailing newline cannot slip past.

### 8. [CLEAN][demonstrated] The tests are load-bearing and green
- 57 of 57 pass, 0 skipped, serial. Three spot mutants each die by the tests built for them. The replacement of the R2-12 marker-plus-stray row is explicit in the test header and the decisions row (SE ADR-0005 reading); locked tests, G13b assertions, R2-13 and R2-15 are untouched (the diff stat lists none of them).

## Blockers vs hardening

- Blockers: none. No HIGH. No ADR violation.
- Hardening (non-blocking): finding 1 (cap the aggregate message), finding 2 (widen Issue 338's description), finding 3 (backlog: lookalike marker).

## Verdict: APPROVE

Single next action: comment on Issue 338 widening its stated scope to every allow that can match a shell redirect record, add a line to Issue 308's precondition list, then proceed to the cross-domain review.

## Open findings and failing tests

Open findings: 3 (all LOW). Named failing tests: 1 (R2-18 aggregate-message-cap, already named, unbuilt). Findings 2 and 3 have no executable form: one is a record correction to an Issue description, the other is backlog scope by ruling. That is why the two numbers differ.

## Editorial (verdict-neutral, plain edits, no re-review)

1. Issue 308's body still says an allow with no verbs or a legacy verb loads as an accepted cost; the no-verbs half is now rejected. Issue bodies are immutable, so correct it with a comment.

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][LOW][demonstrated] src/policy/config/loader.ts:159 - aggregate schema-invalid message uncapped (20000 targets gives 11.8M characters); cap joined errors with an "and N more" tail (R2-18, routed, unbuilt)
2. [SUSPICION][LOW][demonstrated] Issue 338 and tool-class-format.ts fact 4 understate the allow shapes still loading: a catalog-verb allow on an unpresentable target and a no-verbs allow on the bare prefix match a shell redirect (probe: kernel returns allow); widen 338 by comment
3. [SUSPICION][LOW][demonstrated] rule-reachability.ts:114-120 - a verb list with only a lookalike marker or only strays loads inert (silent for a deny); backlog scope by ruling, disclosed
4. [CLEAN][code-traced] rule-reachability.ts:114-120, kernel.ts:116, shell.ts:393, structured-cluster.ts:45, tool-class.ts:67 - the emitted verb set is the catalog plus markers, so both rejections are sound and only tighten (fail-closed direction)
5. [CLEAN][code-traced] loader.ts:155 - one call site rejects on all three layers; central whole-load failure is fail-closed, stated, and the unlock names the out-of-session owner
6. [CLEAN][demonstrated] printer.ts:141 - policy-derived text is JSON-quoted, capped at 80 and sanitized at the render boundary; the gate never echoes it; bidi and zero-width survivors are the accepted S6 residual
7. [CLEAN][demonstrated] targetScope input handling - schema guarantees string arrays, prototype-key verb inert, duplicates harmless, case exact, linear cost
8. [CLEAN][demonstrated] 57 of 57 tests pass serial; three spot mutants killed by named tests
counts (a CHECKSUM): issues=1 suspicions=2 clean=5
evidence (a CHECKSUM): demonstrated=6 code-traced=2 derived=0
checks="57/0/0"
adr=HIT(37)
report=docs/reviews/s7c-reachability-residuals-app-security-2026-09-27.md
