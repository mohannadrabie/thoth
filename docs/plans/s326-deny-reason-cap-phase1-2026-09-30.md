# Issue #326 - bound the command text reflected in the deny reason (Phase 1 plan, 2026-09-30)

ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`
ADR review: no ADR names deny-reason size or hook stdout size. THOTH-ADR-0001 (classification file) is NOT-APPLICABLE (no change to docs/qa/s5-central-classification.json). Deny-stays-deny and fail-closed polarity are CLAUDE.md/PRINCIPLES constraints, honored below.

## Story (one sentence)
The POL-05 deny reason reflects untrusted command text unbounded (about 32 KB out for 16 KB in, about 1 MB for 524 KB); cap the reflected text at 512 characters with a visible truncation marker, and pin the maximum deny stdout size through the real hook.

## Where the text is reflected (from reading the code)
`src/policy/kernel/kernel.ts::pol05Rule` builds `reason` as `POL-05: ... unresolved field(s) [${action.unresolved.join(", ")}]`. The `unresolved` entries come from `src/policy/normalizer/shell.ts` (about lines 365-371: `command verb "<candidate>"`, `command resource "<tokens>"`, plus chain/separator/substitution fragments), so a newline span inside quotes lands verbatim, possibly in more than one entry. Nothing else reflects command text (rule rationale/id are policy-authored).

## Placement decision
Cap in `src/policy/kernel/kernel.ts::pol05Rule`, per unresolved entry, with a small local `boundedFragment` (limit 512, marker `[truncated, N characters in all]`, same shape as decide-tool-call.ts `bounded`/REASON_NAME_CAP). Reasons:
- Not in the hook: hooks/pretooluse-kernel-gate.mjs is not edited at all, so the #312 AC-3 pinned member-write/global allow-lists are untouched.
- Not in the normalizer: `record.unresolved` also feeds the action record/audit trail; truncating there would lose evidence. Only the model-visible reason is bounded.
- Not in render-hook-output.ts: it is generic (all reasons, including policy-authored rationale), and gate/** and kernel/** are import-isolated (G15, kernel-purity-check), so a shared constant cannot be imported. A whole-reason cap there would also truncate legitimate long rationales, which is beyond the ruling. The kernel needs no imports (purity stays green); 512 is duplicated by value with a comment naming REASON_NAME_CAP.
- Deny stays deny; the reason is never blank (the prefix is fixed text). The #312 sanitize call in render-hook-output.ts still runs on the shorter reason, unchanged, so AC-7/AC-9/AC-10 are unaffected.
- Bound on stdout: per entry at most 512 chars plus marker (~40); worst-case JSON escape is 6 bytes per char (\u00XX), so about 3.3 KB per entry, and the normalizer emits few entries. The pin is an absolute max plus the property that stdout does not grow with input size (16 KB vs 524 KB inputs within a small constant). The exact number is fixed after the red run shows measured sizes (spike rule 17).

## Acceptance criteria (derived ones marked)
1. A 16 KB single-quoted newline-span command yields a deny with stdout under a pinned max, exit 0, valid JSON, decision "deny".
2. Same for 524 KB: stdout size does not grow with input size (within a stated constant of the 16 KB case).
3. Escape-heavy maximal-expansion input (control chars that JSON-escape to 6 bytes, quotes, backslashes, newline span) stays under the same pinned max. (derived: what "maximal expansion" means)
4. The truncation is visible: the reason contains `[truncated, <N> characters in all]` with the true original length.
5. Reason never blank and outcome stays deny (no exit 2, no allow, no unparseable stdout) at every size.
6. A command under the cap yields the byte-identical reason as before (existing kernel/gate tests unchanged).
7. #312 guards stay green, unmodified: sanitize.test.ts AC-7/AC-9, hook AC-3 env guard with pinned allow-sets, AC-10, kernel purity check, gate-structure G15.
8. Hostile control bytes inside the capped span are still sanitized on real hook stdout (cap and sanitize compose).

## AC -> named check
| AC | Check | Where |
|---|---|---|
| 1, 5 | `AC-326-1: 16 KB newline-span deny is bounded, valid JSON, deny` | hooks/pretooluse-kernel-gate-reason-cap.test.ts (new; real hook via gate-sandbox, same pattern as the -sanitize sibling) |
| 2 | `AC-326-2: 524 KB input yields stdout within a constant of the 16 KB case` | same file |
| 3 | `AC-326-3: maximal-expansion input stays under the pinned max stdout` (states the max and its derivation) | same file |
| 4, 6 | `AC-326-4: truncation marker carries the true length`; `AC-326-6: under-cap reason byte-identical` | src/policy/kernel/kernel.test.ts (unit on pol05Rule) plus one real-hook assertion |
| 5 | `AC-326-5: never blank, never allow, at 1 / 16K / 524K` | hook file |
| 7 | existing suites run unmodified: sanitize.test.ts, pretooluse-kernel-gate-sanitize.test.ts, render-hook-output.test.ts, gate-structure.test.ts, kernel purity check, full test run | no edits |
| 8 | `AC-326-8: hostile bytes in a capped span still sanitized on real stdout` | hook file |

Findings arrive as failing tests: first commit is the new tests, run red with measured sizes, then the kernel change turns them green. I do not edit those tests afterwards to make them pass.

## Risk tier (proposed)
STANDARD. Narrow, display-only change inside the guard/policy engine that cannot change any verdict (deny stays deny, reason non-blank). It is a sensitive area, so a named-reviewer report is mandatory regardless. The Manager may raise to CRITICAL if it wants red-team on the truncated-decision path (the issue came from red-team as LOW).

## Sensitive areas touched and reports required
- Guard / policy engine (`src/policy/kernel/*`): fresh dated report in docs/reviews/: `app-security-reviewer` (domain) plus `cross-domain-reviewer` (every tier above TRIVIAL).
- Policy-enforcement hook stdout contract: behavior observed by tests, but `hooks/pretooluse-kernel-gate.mjs` is NOT edited, so no separate hook-edit report is triggered.
- Close-out: note on #308 activation preconditions that this item is resolved (docs only).

## Test-first dispatch check (test-writer)
New or changed UI flow or API surface? Answer: NO, `test-writer` is not dispatched. The hook stdout JSON shape (`hookSpecificOutput`, decision, reason field) is unchanged; only the length of one free-text diagnostic field under hostile-size input changes, and no caller depends on that text. It is arguably an interface, but this is a bound on an internal fail-closed diagnostic, not a new or changed contract. Coverage stays with the implementer-written failing-first tests above. If the Manager reads the hook stdout as an API surface, the fallback is dispatching test-writer on AC 1-5 only; nothing else changes.

## Blocking questions
None. Notes:
- The runtime's real stdout cap stays unmeasured by design (per the ruling); the pin bounds our side.
- The stdout max under the new code is not yet measured; the first build task is the red run that records it, then the pin value is set.

## Plan
1. Stay on s7/closeout; no branch switch. (This phase commits nothing.)
2. Write the failing tests (hooks/pretooluse-kernel-gate-reason-cap.test.ts; kernel.test.ts unit cases); confirm red and record measured sizes.
3. Add `boundedFragment` and apply it to each `action.unresolved` entry in `pol05Rule` (kernel.ts; no imports; comment cross-referencing REASON_NAME_CAP).
4. Run build/typecheck, lint, full test suite with real counts, kernel purity check, gate-structure, sanitize suites, qa:hook-typecheck-coverage, QA-14/15, secret scan.
5. Re-run the original measurement (16 KB, 524 KB) and quote the new sizes.
6. Close-out docs: CHANGELOG, STATE.md, #308 precondition note; PR skeleton on the existing branch; dispatch reviewers per above. Rollback: revert the single kernel.ts hunk together with its tests.
