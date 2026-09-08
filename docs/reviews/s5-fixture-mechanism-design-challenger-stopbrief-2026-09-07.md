# Design Challenger (Apep) — Stop Brief, S5 fixture-based exemption/reconciliation mechanism

**Council seat, Stop Brief mode.** Trigger: PRINCIPLES rule 16(c) — 2 consecutive non-clean Stage-3 rounds (`red-team` no-go both rounds) on S5's post-build fix-now sub-effort, Milestone #23, CRITICAL tier. `docs/.maat-state.json`: `humanRulingRequired: false`, `councilHeld: true` (pre-build council only), this Stage-3 post-build council is the one now convening.

**Scope of this brief, exactly as scoped by the invocation: the fixture-based exemption/reconciliation mechanism only** — `docs/qa/s5-central-classification.json`, `src/policy/tools/central-classification.ts`, the two hooks' consumption of it (`hooks/sessionstart-tool-enum.mjs`'s `computeSessionTools`/`reconcileReason`/`writeHaltReason`, `hooks/userpromptsubmit-halt-relay.mjs`'s `UNLOCK_HINTS`/`sanitizeDetail`). Not the whole S5 diff. No fix-writing. No new attack surface.

**Read, in full, before writing this:** `docs/PRINCIPLES.md`; `docs/decisions.md`'s 2026-09-07 row ("S5 Stage-3 CRITICAL review round 1..."); `docs/reviews/s5-red-team-2026-09-07.md` (round 1); `docs/reviews/s5-cross-domain-round2-2026-09-07.md`, `s5-halt-hooks-app-security-round2-2026-09-07.md`, `s5-fixnow-round2-red-team-2026-09-07.md` (round 2); the actual current code — `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, `src/policy/tools/central-classification.ts`, `src/policy/tools/central-classification.test.ts`, `docs/qa/s5-central-classification.json`. `git status --porcelain` confirms the working tree matches exactly what round 2's reports reviewed — no round 3 fix has landed yet.

---

## 1. Frozen set — proven safe, by what evidence, not re-litigated

Everything below was independently re-demonstrated in round 2 (not just carried on the implementer's word), and I did not re-run it a third time — this is the inherited frozen set per the Evidence-tier rule ("Re-opening a frozen item requires NEW evidence").

| # | What's frozen | Evidence | Round closed |
|---|---|---|---|
| 1 | Sticky-halt bricking (round-1 F5, Issue #94) — a resumed session whose condition resolves now clears via `reconcileReason`'s `set:false` write | `red-team` round 2, exact repro re-run: exit 2 → SessionStart re-run → exit 0 | 2 |
| 2 | Fail-open on 4 malformed `reasons` shapes (round-1 F6, Issue #95) — `inspectHaltState` now validates every level | `red-team` round 2: 15/15 shapes correct (4 previously-open shapes now block, 4 new legitimate shapes still pass) | 2 |
| 3 | Allowlist contents are now pinned and drift-visible (round-1 F1/F10 partial, Issue #98) — a hostile entry added to either allowlist now fails `AC1-a`/`AC1-b` by name | `red-team` round 2: same mutation methodology that was 513/513-green in round 1 now fails by name | 2 |
| 4 | EPIPE fail-closed on a dead stdout/stderr pipe | `app-security-reviewer` round 2: fresh 4/4 re-run against the live file, exit 2 preserved | 2 |
| 5 | `centralLayer.class` inertness is honestly disclosed at all three sites (Issue #93) — no comment claims `.class` gates anything | `cross-domain-reviewer` round 2, C9: three sites read verbatim, consistent | 2 |
| 6 | ADR-0021 INT-07 disclosure (Issue #90) is present, accurate, names the exact defeat, claims no verification that doesn't exist | `app-security-reviewer` round 2, finding 1; I independently re-read `central-classification.ts:15-26` myself — confirmed | 2 |
| 7 | ASCII control-character stripping in `sanitizeDetail` (Issue #97's ASCII half) — ESC/LF/CR/NUL/DEL stripped, 200-char cap with explicit truncation marker, single stderr line preserved | `app-security-reviewer` round 2, re-ran the probe directly | 2 |
| 8 | Runtime expiry mechanism itself (not its pinning — see N2 below) — `isFixtureExpired` is real-wall-clock, UTC-midnight-anchored, injectable for tests, 3 boundary tests including a local-vs-UTC case | `red-team`+`app-security-reviewer` round 2, both independently exercised it against real fixture contents | 2 |
| 9 | AC-4 "vanilla fully-classified session leaves no halt-state file at all" contract | `red-team` round 2 C11, `app-security-reviewer` implicit | 2 |
| 10 | No new dependencies; no credential-bearing path touched by any new test | `app-security-reviewer` round 2, findings 5 + test-isolation section | 2 |
| 11 | ADR-0021 kernel-purity boundary unaffected — `central-classification.ts` correctly sits outside `src/policy/kernel/` | `cross-domain-reviewer` round 2, fresh `npm run qa:kernel-purity` re-run | 2 |
| 12 | A malformed/missing fixture fails CLOSED (new failure mode introduced this round, immediately attacked and held) | `red-team` round 2, C8 | 2 |

None of the above is re-opened here. New evidence would be required to touch it again.

---

## 2. Open calibrated blocking HIGHs against this mechanism: **none.**

This is the load-bearing conclusion of this brief, and it is why `red-team`'s two consecutive no-go verdicts do not, on inspection, resolve to a design-challenger-calibrated blocker.

I independently re-traced every one of round 2's open findings against this mechanism (`central-classification.ts`, the fixture, and the two hooks' use of it) against the four-part HIGH test (`evidence ∈ {demonstrated, code-traced}` AND `reach=user` with a named entry point AND `likelihood ∈ {routine, plausible}` AND effect ∈ {money wrong, data lost, silent state divergence, security boundary bypassed/one-bug-from-open}):

### N1 — env-var fixture override (`Issue #99`), `hooks/sessionstart-tool-enum.mjs:238-241`

```js
const fixturePathOverride = process.env.THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH;
const fixture = fixturePathOverride
  ? loadCentralClassificationFixture(fixturePathOverride)
  : loadCentralClassificationFixture();
```

Independently re-confirmed by reading the file myself (line numbers above match). No code anywhere records which fixture was actually resolved — confirmed: `grep -rn "fixturePathOverride" hooks/ src/` (run as part of this brief) returns only the three lines inside this resolution block; nothing writes the resolved path to the halt-state file, stderr, or any log.

- **evidence:** code-traced + demonstrated (red-team ran it end-to-end, both the direct env-var path and the `.claude/settings.local.json` delivery vector, against the full gate set). ✓ qualifies.
- **reach:** the trigger is "an env var is set, or a gitignored local settings file is placed" — that is config/infrastructure-level, not "a route, handler, screen, or scheduled trigger a real user's action actually invokes" per this role's own reach-proof requirement. There is no `path:line` inside this repo where a user-facing action reaches this env var; the delivery vectors named (a shell rc file, `.envrc`, a CI runner, an ungated `Write` tool call since `PreToolUse` is deliberately unwired this milestone) are all operator/agent-with-local-execution-capability actions, the same actor class `app-security-reviewer` itself declined to call "user" for the adjacent Unicode finding. **Tag: `reach=operator`.** This alone caps the finding below HIGH regardless of the other three factors.
- **likelihood:** `plausible` (no special skill needed, but requires a deliberate local config/environment action).
- **effect:** yes — this is exactly "a security boundary bypassed or weakened," and silently (undo=reversible in the narrow sense that deleting the env var reverts behavior going forward, but the failure is silent with zero forensic trace, so per the undo-downgrade rule it **keeps its severity** rather than downgrading).
- **Verdict: MED, not HIGH** — fails the reach=user gate. It is, however, a **security-boundary-crossing MED** (bypasses/weakens a ratified control's integrity with zero trace) and therefore, per the Verdict section's carve-out, **may never be discharged to the residual register** — it must become a named failing proof-test regardless of its MED cap.

### N2 — `expiresOn`'s value is unpinned (`central-classification.test.ts:60-65`)

Independently confirmed: `AC1-c` asserts only `isFixtureExpired(fixture, new Date()) === false` — "some future date," not the ratified date itself. Rolling `2026-10-07` → `2099-01-01` passes every test and gate (red-team, demonstrated).

- **evidence:** demonstrated. **reach:** `operator` (a human, or an automated agent, edits a committed JSON file — goes through normal git/PR flow, but nothing in that flow flags the change as security-relevant). **likelihood:** `operator-error` (the whole point of the finding is that this edit looks identical in cost/attention to a typo fix). **effect:** weakens the temporal boundary of a ratified security exception, silently (no test signal distinguishes a 1-day extension from a 73-year one).
- **Verdict: MED, not HIGH** (reach≠user AND likelihood=operator-error both independently cap it). Boundary-crossing (it silently defeats the "never rolled forward" property the human ruling explicitly rested on) → **must route to a named proof-test, not the residual register.**

### App-security Issue #96 escalation — reconciliation can clear a *different* session's active halt

`reconcileReason` (`sessionstart-tool-enum.mjs:172-179`) writes `set:false` for any key previously `set:true` in the file for that `sessionId`, with **no check that the previous `set:true` was written by the same logical session** — and the pre-existing fallback (`sessionId = "unknown-session"` when stdin's `session_id` is missing/non-string, line 276/280) means two failed-resolution invocations share one bucket. I re-traced this directly: nothing in `reconcileReason`, `wasReasonActive`, or `writeHaltReason` inspects anything beyond the reason key and its `set` boolean — session identity is never part of the reconciliation decision once two runs land in the same file.

- **evidence:** demonstrated (`app-security-reviewer` round 2, end-to-end: run A sets a halt under `unknown-session`, run B for a *different* colliding invocation resolves its own condition and reconciles the shared key to `set:false`, unblocking a relay check that should still be blocked).
- **reach:** `operator` — the precondition (Claude Code delivering a hook payload with a missing/non-string `session_id`) is explicitly documented as "should never happen per the documented contract" (Issue #96's own framing, undisturbed since round 1). This is not a route a real user clicks through; it is a violation of an upstream platform contract. **likelihood:** `exact-race` (app-security's own word: "a narrow, compound precondition" requiring two such violations, with different underlying states, before the first's `UserPromptSubmit` runs).
- **effect:** yes — this is a genuine access-control failure (an unrelated session's still-active halt is silently discharged), which is exactly the "security boundary... one bug from open" category.
- **Verdict: MED, not HIGH** (reach=operator AND likelihood=exact-race both cap it independently — this is the textbook case the calibration rule anticipates: "likelihood ∈ {operator-error, exact-race} caps at MED, whatever the damage would be"). It is unambiguously **boundary-crossing** (an access boundary between sessions is bypassed) → **must route to a named proof-test per the carve-out, never the residual register**, regardless of the exact-race cap.

### N3 — post-expiry `UNLOCK_HINTS` name an unlock that doesn't unlock

Independently confirmed: `grep -c "expir" hooks/userpromptsubmit-halt-relay.mjs` → 0. `UNLOCK_HINTS["SUR-03-unclassified-tool"]` tells the operator to "reclassify the tool in `docs/qa/s5-central-classification.json`" — but past `expiresOn`, `computeSessionTools` (line 247-248) forces `centralLayer = { tools: [] }` and `knownConnectors = new Set()` regardless of the fixture's own listed entries, so re-adding an already-listed name is a no-op. This one **does** meet reach=user with a real entry point (`hooks/userpromptsubmit-halt-relay.mjs:255-258`, the `activeReasons` branch, invoked automatically by every prompt submission once the fixture expires — no attacker action needed, just the calendar reaching 2026-10-07) and likelihood=routine (guaranteed, dated, ~30 days out on this machine).
- **effect, however, does not qualify:** this does not move money, lose data, silently diverge state, or bypass/weaken a security boundary — if anything the system becomes *more* restrictive (full revert to halt) at that moment; the defect is that the *message* misdirects, wasting operator time, not that protection weakens.
- **Verdict: MED, not HIGH** (fails the effect-type gate even with reach=user + routine likelihood). **Not boundary-crossing** — eligible for the residual register, though given it is dated and certain (2026-10-07 on this operator's real fixture), I'd flag it as a strong candidate for a day-1 test rather than a register line; that routing choice belongs to the Manager, not to me.

### App-security finding 7 — Unicode bidi/format characters survive `sanitizeDetail`

Confirmed: the strip regex is `\x00-\x1F` + `\x7F` only; U+202E (RTL override) and five other Unicode control/format characters pass through unchanged into the human-and-Claude-visible `systemMessage`.
- **reach:** `operator` (requires an attacker to name a connector/MCP server — the same actor class already accepted as residual elsewhere). **effect:** display-integrity, not a bypass of the halt itself (exit 2 is unaffected either way — explicitly confirmed by app-security).
- **Verdict: MED, not HIGH.** Not boundary-crossing (no access is granted or widened) — eligible for the residual register or a day-1 test, Manager's call.

**Conclusion of this section: zero findings against this mechanism clear the calibrated-HIGH bar.** `red-team`'s two "no-go" verdicts are real, substantive, well-evidenced findings — none of them is manufactured — but under strict reach/likelihood/effect calibration, every one caps at MED. Two of the five (N1, and the Issue #96 escalation) are additionally boundary-crossing and therefore **cannot** be waved into the residual register no matter how the MED cap was earned — they must become named, failing, day-1 proof-tests. This is the resolution the Council needs: the loop is not deadlocked on an unresolved HIGH: it stalled because two mechanically-fixable, security-relevant MEDs were being treated with CRITICAL-tier full-round ceremony instead of being converted straight to tests.

---

## 3. Does Issue #99 alone block, or does it compound?

**Alone: no** — it caps at MED (reach=operator) as shown above, and is boundary-crossing, so on its own it routes to a mandatory proof-test, not a blocker.

**Compounded: the picture is worse than any single finding, and worth stating plainly.** N1 (undetectable full-fixture replacement, including `expiresOn`), N2 (the one field that would otherwise force renewal is itself unpinned), and the Issue #96 escalation (a shared-bucket reconciliation write with no session-identity check) together mean that **all three independent guarantees the human ruling rested on — bounded content, forced expiry, and per-session isolation — each have a live, demonstrated, silent failure mode**, and none of the three failure modes overlaps with (or is caught by) the others' proof-tests. That is a materially different, sharper risk than any one of them read in isolation, even though none individually clears HIGH. I am not inflating any single finding's tag to express this — the compounding is itself the finding, and it is `derived` (a reasoning conclusion from three independently `demonstrated`/`code-traced` facts), so it does not itself carry a severity tag or block anything on its own; it is context for the Council's judgment on whether one more mechanical round is enough.

---

## 4. What has genuinely never been tested at all — not "not yet re-confirmed," never probed by any round

1. **Connector display-name spoofability itself** (Issue #90's core premise, F4/round-1 → N6/round-2). Whether claude.ai's `claudeAiMcpEverConnected` prefix (`"claude.ai "`) is client-applied to every entry (in which case a user-named custom connector called `Gmail` collides with the allowlist) or is a first-party string a custom connector cannot mint. **Never run in any round** — explicitly named in both red-team reports as requiring a real claude.ai account action outside any sandbox. This is the single highest-leverage unknown in the whole mechanism: if it resolves unfavorably, the *already-accepted* residual (Issue #90) becomes trivially remotely triggerable by naming alone, with none of N1/N2/#96's local-access preconditions required at all.
2. **Concurrent SessionStart delivery for one session id.** Both red-team rounds flagged the now-non-atomic (read-then-write, still) `writeHaltReason`/`reconcileReason` path as newly able to *lose* a halt under a concurrent write (round 2, N5) — neither round constructed this, and neither measured whether Claude Code's runtime ever delivers two SessionStart events concurrently for the same session id. Directly bears on how real the Issue #96 escalation's "exact-race" tag actually is.
3. **Real frequency of malformed/unparseable SessionStart stdin** (Issue #96's own root precondition). Every round's basis for this is "should never happen per the documented contract" — an assumption, never a measurement, carried unchanged since round 1.
4. **`CLAUDE_PROJECT_DIR`-vs-`cwd` divergence for the halt-state path** across the two hook invocations (F11/N7) — partially mitigated for the fixture path specifically (module-URL-relative, immune), but the halt-state path itself is unchanged and the divergence case has never been constructed in either round.
5. **Whether a live Claude Code session actually inherits a `.claude/settings.local.json` `env` block into a hook subprocess**, specifically — red-team's demonstration directly set the env var and observed the vulnerable code path (this part is solid, standard OS process-env inheritance, not really in doubt), but did not spawn a real Claude Code CLI session to confirm that *specific* delivery mechanism end-to-end. This does not weaken N1 (multiple simpler vectors — a shell export, a CI config, an ungated `Write` call — reach the same `process.env` read and are not in doubt), but it is one specific claim in the report that remains unverified as stated.

---

## 5. Unrun verifications — commands nobody has executed yet, with owner

| Verification | Command / method | Owner |
|---|---|---|
| Connector display-name collision | In a scratch claude.ai account: add a custom connector named `Gmail` (and `claude.ai Gmail` if the UI allows), connect once, print `claudeAiMcpEverConnected` from the real `~/.claude.json`, diff against `docs/qa/s5-central-classification.json`'s `knownConnectors` | Human operator (named in both red-team reports, still outstanding) |
| Concurrent SessionStart frequency | Instrument/ask: does this runtime ever fire two SessionStart hook invocations for one session id inside a window shorter than one `writeHaltReason` read-modify-write cycle? | Human operator / platform-behavior lookup, not this sandbox |
| Env-var override detectability fix | `hooks/sessionstart-tool-enum-fixnow.test.ts` → the named test red-team already specified: "the fixture path cannot be redirected by ambient environment in a production invocation, and any non-default resolution leaves a trace" | `story-implementer`, next round |
| `expiresOn` exact-value pin | `src/policy/tools/central-classification.test.ts` → exact-equality assertion on the ratified date, alongside the existing `deepEqual` allowlist pins | `story-implementer`, next round |
| Unknown-session reconciliation fix | `hooks/sessionstart-tool-enum-fixnow.test.ts` → never write `set:false` for the `"unknown-session"` fallback id (additive-only there), or make the fallback id per-invocation-unique | `story-implementer`, next round |

---

## 6. Candidate paths forward (no mechanism design beyond what's already on the table)

**(A) One more mechanical round.** Close N1 (gate the env override behind an explicit test-only signal, or drop the seam and pass the path from the test harness some other way; record the resolved fixture path in halt-state), pin `expiresOn`'s exact value (N2), and fix `reconcileReason` to never clear the `"unknown-session"` fallback bucket (Issue #96 escalation). All three are the reviewers' own named, already-scoped proof-tests — none requires new topology. N3 and the Unicode gap (finding 7) ride along if time allows but are not mandatory-route.

**(B) Redesign the trust boundary itself, architecture-reviewer's lane.** Remove the env-var indirection entirely — the fixture path is hardcoded with zero indirection in the production entrypoint, and any test-time need to exercise expiry/override behavior is satisfied a different way that never touches `process.env` in the shipped code path at all. This also settles `cross-domain-reviewer`'s own round-2 suspicion (their finding 6): nobody has yet ruled whether S6's real central-policy loader should inherit this exact fixture-loading shape — Option B answers that now instead of letting S6 discover the pattern already baked in by default.

**(C) Treat the whole mechanism as a dated, self-expiring stopgap (PRINCIPLES rule 20 tier (b)) rather than a permanent control.** The fixture already carries a hard 30-day `expiresOn` (2026-10-07). Ship with N1, N2, and the Issue #96 escalation as day-1 failing tests (not residual-register lines, per the boundary-crossing carve-out), and let the whole mechanism be superseded by S6's real policy-centralization loader before a second review cycle on it would even matter.

**My read:** (A) is the default per rule 16's own text ("no open calibrated blocking HIGH... the recommendation... is build now: every open finding becomes a day-1 failing test") — nothing here overrides that default, since no calibrated HIGH is open. I'd pair (A) with flagging (B)'s question to `architecture-reviewer` for awareness rather than as a gating requirement, given the structural-root-cause pattern in section 7 below — but that is the Manager's/architect's call, not mine to force.

---

## 7. Structural root cause, or ordinary churn?

The packet asks this directly, and the evidence supports a specific answer: **this is the same root-cause CLASS recurring, not ordinary churn.**

- **Round 1's defect:** two allowlists hardcoded inline inside a CRITICAL enforcement hook, self-approved, unexpiring, untested — a control whose actual contents nobody could independently verify or audit.
- **Round 2's fix** correctly addressed that shape (committed fixture, expiry, pinning tests) — but in doing so introduced **the identical shape one layer down**: the fixture-loading path itself now has an unverifiable input (which fixture actually loaded — N1), an unverified field within the verified artifact (`expiresOn`'s value — N2), and the *other* round-1 fix (reconciliation, built to solve sticky-halt) introduced an unverified identity assumption (which session a reconciliation write belongs to — the Issue #96 escalation).

The pattern in all three: **an enforcement surface trusts an input (a path, a date, a session id) without any independent check that it is the input it thinks it is, and the trust gap is silent.** That is, structurally, the exact shape ADR-0021's own INT-07 rule exists to catch ("no control may rest on an unverified third party's claim about its own behavior") — except here it is recurring *inside the compensating mechanism* built to manage the first INT-07 gap (Issue #90), not in the original gap itself. This satisfies PRINCIPLES rule 16(b)'s "same root-cause class recurring in a new form" language in substance, even though the rule's own machinery (`architecture-reviewer` early-dispatch) is written for the pre-build design-challenger loop and this is post-build Stage 3. I am naming it for the Council's judgment, not invoking rule 15/16(b)'s pre-build machinery myself — that would be out of lane here.

---

## 8. Editorial (verdict-neutral, not counted)

- `central-classification.ts`'s header and `hooks/sessionstart-tool-enum.mjs`'s header both correctly and consistently disclose the mechanism's real shape — no drift found between the two files' claims and the code, independently re-checked.
- Round 2's own RECEIPT-vs-body test-count discrepancy (543 real vs. 551 claimed) was already caught and corrected by both `red-team` and `app-security-reviewer` round 2 — not re-flagged here.

---

## 9. Scariest unproven assumption

**That the seven `"claude.ai "`-prefixed connector display names in the ratified allowlist cannot be minted by an untrusted custom connector.** Every other open item in this mechanism (N1, N2, the Issue #96 escalation) requires an actor with local write/environment access on the machine already running the governed session — a meaningfully privileged position. If this one assumption resolves unfavorably, the *already-accepted, human-ratified* residual (Issue #90) collapses from "spoofable in principle, accepted knowingly" to "trivially triggerable by anyone who can get an operator to connect a maliciously-named connector, no local access required at all" — and it has been open, unmeasured, and carried forward as UNPROVEN across both rounds without anyone running the one drill that would settle it.

---

## Computed recommendation

**No open calibrated blocking HIGH against this mechanism.** Per rule 16's own default: **build now.** Three findings (N1, N2, the Issue #96 reconciliation escalation) are boundary-crossing MEDs that **must** become named day-1 failing tests, not residual-register lines, regardless of their MED cap. Two more (N3, the Unicode sanitization gap) are real but not boundary-crossing and may route to either a day-1 test or the residual register at the Manager's discretion. The single highest-leverage unresolved question is not in this diff at all — it is the connector-spoofability drill (section 5), which no round has run and which this mechanism's entire risk-acceptance rests on.

---

RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced/demonstrated][operator][plausible][reversible-but-silent, keeps severity] N1/Issue #99: `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` (sessionstart-tool-enum.mjs:238-241) lets any env-setting actor silently replace the entire ratified fixture (allowlists + expiry) with zero forensic trace; caps below HIGH on reach=operator (no user-facing entry point), but boundary-crossing — must become a named proof-test, cannot route to residual register. Exposure: ~100% of the exemption+expiry control surface from any env-setting vector, basis: measured.
2. [ISSUE][MED][demonstrated][operator][exact-race] App-security Issue #96 escalation: `reconcileReason` (sessionstart-tool-enum.mjs:172-179) plus the pre-existing "unknown-session" fallback bucket (line 276/280) lets a second colliding SessionStart invocation silently clear a genuinely-still-active halt belonging to a different logical session; caps below HIGH on reach=operator + likelihood=exact-race, but boundary-crossing (access-control failure) — must become a named proof-test. Exposure: unquantified (compound precondition on an already-disclosed "should never happen" platform-contract violation), basis: demonstrated mechanism / assumption on real-world frequency.
3. [ISSUE][MED][demonstrated][operator][operator-error] N2: `central-classification.test.ts`'s AC1-c only asserts `expiresOn` is "some future date," not the exact ratified value — rolling 2026-10-07 to 2099-01-01 leaves 543/543 tests and all 4 qa gates green, silently defeating the forced-renewal property the human ruling explicitly rested on. Boundary-crossing (weakens a ratified control's temporal limit) — must become a named proof-test. Exposure: 100% of the time-boxing property, basis: measured.
4. [ISSUE][MED][demonstrated][user, entry point: hooks/userpromptsubmit-halt-relay.mjs:255-258][routine] N3: past the fixture's real expiresOn (2026-10-07, ~30 days out on this machine), UNLOCK_HINTS tell the operator to re-add already-listed names to the fixture — a no-op, since expiry reverts both allowlists to empty regardless of listed contents; "expir" appears 0 times in the relay. Reach=user and likelihood=routine both hold, but effect is operator-misdirection, not money/data/security-boundary — fails the HIGH effect gate. Not boundary-crossing; eligible for residual register or a day-1 test at the Manager's discretion. Exposure: ~100% of local sessions from 2026-10-07, basis: counted-in-code.
5. [ISSUE][MED][demonstrated][operator][plausible] App-security finding 7: `sanitizeDetail` strips ASCII controls only; U+202E (RTL override) and five other Unicode format/control characters reach the human-and-Claude-visible systemMessage unstripped. Display-integrity gap, not a halt bypass (exit 2 unaffected) — not boundary-crossing. Exposure: 0% under committed settings, basis: counted-in-code; non-zero on the same actor class already accepted as residual elsewhere.
6. [SUSPICION][MED][derived] Compounding: N1+N2+the #96 escalation together mean all three guarantees (bounded content, forced expiry, per-session isolation) the human ruling rested on each have an independent, non-overlapping silent-failure mode — a materially sharper picture than any one finding alone, though none individually clears HIGH. Not independently tagged/blocking; context for the Council.
7. [SUSPICION][MED][derived, carried unchanged from round 1] Connector display-name spoofability (Issue #90's core premise) — never tested by any round in any sandbox; if the `"claude.ai "` prefix is client-applied rather than first-party-only, the already-accepted residual becomes remotely, trivially triggerable by connector-naming alone, no local access required. Named human drill in section 5, still outstanding. This is the single scariest unproven assumption in the whole mechanism.
8. [SUSPICION][LOW][derived, carried unchanged from round 2] Concurrent SessionStart delivery for one session id — never constructed or measured in any round; bears directly on how real finding 2's exact-race tag actually is.
9. [SUSPICION][LOW][code-traced, carried unchanged since round 1] Writer/reader CLAUDE_PROJECT_DIR-vs-cwd divergence for the halt-state path — partial credit: the fixture path itself is module-URL-relative and immune, but the halt-state path is unchanged and the divergence case has never been constructed.
10. [CLEAN][demonstrated] Sticky-halt bricking (round-1 F5, Issue #94) genuinely fixed and re-confirmed round 2 — exact repro now clears on SessionStart re-run. SURVIVES, frozen.
11. [CLEAN][demonstrated] Fail-open on 4 malformed halt-state shapes (round-1 F6, Issue #95) genuinely fixed — 15/15 shapes correct round 2, no over-triggering on legitimate shapes either. SURVIVES, frozen.
12. [CLEAN][demonstrated] Allowlist-content invisibility (round-1 F1/F10 partial, Issue #98) genuinely fixed for CONTENTS — a hostile entry now fails AC1-a/AC1-b by name (513/513 green in round 1 on the identical mutation). SURVIVES, frozen (expiresOn's own pinning is the separate open N2 above, not re-litigated as part of this closure).
13. [CLEAN][demonstrated] EPIPE fail-closed re-confirmed round 2, fresh 4/4 re-run against the live file. SURVIVES, frozen.
14. [CLEAN][code-traced] centralLayer.class inertness honestly disclosed at all three sites (Issue #93), no overclaim anywhere. SURVIVES, frozen.
15. [CLEAN][code-traced] ADR-0021 INT-07 disclosure (Issue #90) present, accurate, names the exact defeat, claims no verification it doesn't have — independently re-read by me directly. SURVIVES, frozen (the disclosed risk itself stays open per item 7 above, correctly not claimed closed).
16. [CLEAN][demonstrated] ASCII-control stripping half of sanitizeDetail (Issue #97) genuinely works — ESC/LF/CR/NUL/DEL stripped, 200-char cap, single stderr line preserved. SURVIVES, frozen (Unicode half is the separate open finding 5 above).
17. [CLEAN][demonstrated] Runtime expiry mechanism itself (UTC-midnight boundary, injectable clock, 3 boundary tests) works correctly — independently re-verified via central-classification.test.ts. SURVIVES, frozen (only the pinned-VALUE gap, N2, is open).
18. [CLEAN][demonstrated] AC-4 vanilla no-file contract survives the new reconciliation logic. SURVIVES, frozen.
19. [CLEAN][demonstrated/code-traced] No new dependencies; no test touches the real ~/.claude.json (mkdtemp trees, HOME+USERPROFILE both overridden, env copied never mutated). SURVIVES, frozen.
20. [CLEAN][demonstrated] ADR-0021 kernel-purity boundary unaffected — central-classification.ts correctly sits outside src/policy/kernel/, fresh qa:kernel-purity re-run PASS. SURVIVES, frozen.
21. [CLEAN][demonstrated] A malformed/missing fixture fails CLOSED (new failure mode this round, immediately attacked and held). SURVIVES, frozen.
counts (CHECKSUM): issues=5 suspicions=4 clean=12
evidence (CHECKSUM): demonstrated=15 code-traced=5 derived=1
round=3 (Stop Brief, council seat) roundsSinceLastGo=0 frozen=12 residuals=2 unrun=5 editorial=2
checks=n/a (this brief re-traced code directly and cites round-1/round-2's own raw command output; no new instrument run beyond direct grep/read verification of line numbers and test assertions cited above)
adr=HIT(35)
report=docs/reviews/s5-fixture-mechanism-design-challenger-stopbrief-2026-09-07.md
