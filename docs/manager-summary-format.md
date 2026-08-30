# Manager Summary Format

**This is the canonical format for the Manager Summary.**

Both the manager agent AND the main session (when synthesizing inline) MUST use this EXACT structure.

---

## Manager Summary

**TL;DR:** [One or two plain-English sentences — what happened and what the human does next. No jargon, no agent names, no severity tags. A reader who stops here still knows what's going on.]

**Verdict:** [SHIP | SHIP-WITH-CONDITIONS | REWORK | BLOCKED]

**Per-reviewer:**
- [reviewer-name] ([pokemon-call-sign]) → [verdict] → [single most important finding or "clean"] → `docs/reviews/<file>.md` [read-depth]
- [reviewer-name] ([pokemon-call-sign]) → [verdict] → [single most important finding or "clean"] → `docs/reviews/<file>.md` [read-depth]

> Where **[read-depth]** is `[receipt-trusted — not full-read]` (STANDARD tier, receipt passed every integrity check, I did not open the full report) or `[full report read]` (CRITICAL tier, or a receipt tripped a reopen trigger). Every path is cited regardless — the human can open any report themselves. This makes it explicit where independent verification was skipped, so a `[receipt-trusted]` line is the reader's cue for where to spot-check if they want the evidence behind a clean pass.

**ADR Compliance:**
- [ADR-ID/name] → [COMPLIANT | VIOLATED | UNCLEAR]
  - If VIOLATED: Quote constraint + reviewer who flagged + severity (BLOCKER/finding)
  - If UNCLEAR: Note ambiguity that needs architect clarification
- If none applicable: "No ADR compliance issues"

**Blockers:**
- [Must-fix items with named unlocks]
- OR "none" if no blockers
- Include ADR violation blockers here

**Conditions:**
- [Fix-now vs. defer-with-dated-backlog]
- OR "none" if no conditions

**Next action:**
[Single most important thing engineer does next]

---

## Format Rules

1. **Keep it short** — This is the first (often only) thing the engineer reads
2. **One line per reviewer** — Include the agent's call sign for transparency
3. **ADR Compliance aggregates ALL reviewers** — Single source of truth for ADR findings
4. **Blockers are explicit** — Each blocker includes its named unlock
5. **Next action is singular** — One thing, not a list
6. **Full reports always available, and always cited** — the summary is built from each reviewer's `RECEIPT:` block (verdict, top findings, counts), but the per-reviewer line always ends with that reviewer's report path — the human can open and read it themselves regardless of whether the Manager itself reopened it
7. **A dated `docs/decisions.md` → `docs/decisions-archive.md` sweep happens at session handoff** (see Session Handoff Format below), via the orchestrating session's own tools — not a claim the Manager subagent's read-only frontmatter can act on itself
8. **TL;DR is mandatory and comes first** — one or two plain-English sentences, before the Verdict line, written for a reader who may stop there. It states the outcome and the human's next action in ordinary language, not process vocabulary (no "REWORK", no agent call signs, no severity tags) — those live in the structured fields below it.

## Reviewer verdict vocabularies — what counts as "clean"

Each agent's own verdict enum differs; the Manager Summary's own `[SHIP | SHIP-WITH-CONDITIONS | REWORK | BLOCKED]` is the aggregate. Per-reviewer, "clean" always means the FIRST value below — anything else is "not clean" and is a reopen trigger (see each agent's own file for its RECEIPT spec):

| Agent(s) | Enum (first value = clean) |
|---|---|
| code-reviewer, performance-reviewer | `SHIP` \| SHIP-AFTER-FIXES \| DO-NOT-SHIP |
| infra-security / network / app-security / api / data / architecture-reviewer, cross-domain-reviewer | `APPROVE` \| APPROVE-WITH-CONDITIONS \| REWORK |
| red-team, design-challenger, usability-reviewer | `go` \| no-go |
| impact-analyst | `SAFE-TO-PATCH` \| PATCH-WITH-CONDITIONS \| REDESIGN-REQUIRED |
| debugger | `FIXED` \| UNREPRODUCIBLE \| BLOCKED |
| story-implementer | `BUILD-COMPLETE` \| BLOCKED |

`cross-domain-reviewer` is a standing line in **every** Manager Summary above TRIVIAL (rule 9) — it isn't optional the way a domain pick is; its absence from the Per-reviewer list is itself a shirked-gate finding.

## When to Use

**Main session synthesizes inline:**
- ONE domain reviewer ran, alongside `cross-domain-reviewer` (its standing partner — not counted as a second reviewer)
- Both verdicts clean (SHIP/SHIP-WITH-CONDITIONS or APPROVE/APPROVE-WITH-CONDITIONS)
- No findings marked as BLOCKER
- No ADR violations

**Spawn manager agent:**
- More than one domain reviewer ran (even if they agree)
- ANY reviewer — including `cross-domain-reviewer` — marked ANY finding as BLOCKER
- ANY reviewer marked ADR violation
- Verdicts conflict (SHIP vs. REWORK, or domain reviewer vs. `cross-domain-reviewer`)
- Tier disagreement detected

## Example

```markdown
## Manager Summary

**TL;DR:** Ready to ship once one IAM policy is tightened — a wildcard S3 permission needs to be narrowed before merge. Everything else is clean.

**Verdict:** SHIP-WITH-CONDITIONS

**Per-reviewer:**
- infra-security-reviewer (Wadjet) → APPROVE-WITH-CONDITIONS → Fix IAM wildcard in terraform/modules/api/iam.tf:42 → `docs/reviews/api-infra-security-2026-07-11.md` [full report read]
- network-reviewer (Shu) → APPROVE → Clean, no reachability issues → `docs/reviews/api-network-2026-07-11.md` [receipt-trusted — not full-read]
- cross-domain-reviewer (Ra) → APPROVE → No cross-domain ADR collisions, no seam gaps found → `docs/reviews/api-cross-domain-2026-07-11.md` [receipt-trusted — not full-read]

**ADR Compliance:**
- ADR-003 (S3 encryption) → COMPLIANT
- ADR-007 (IAM least privilege) → VIOLATED (BLOCKER)
  - Constraint: "No wildcard actions in IAM policies"
  - Flagged by: infra-security-reviewer (Wadjet)
  - Location: terraform/modules/api/iam.tf:42

**Blockers:**
- Fix IAM wildcard: Replace `s3:*` with specific actions (s3:GetObject, s3:PutObject)

**Conditions:**
- Add CloudWatch alarm for failed API calls (defer to backlog, due 2026-07-20)

**Next action:**
Fix IAM policy wildcard, then run /verify
```

---

## Path-Forward Brief

Replaces the Manager Summary whenever PRINCIPLES.md rule 16 fires (a stalled pre-build loop convenes the design council). Capped at one page — copied here verbatim from `council.md`, the canonical source.

```markdown
## Path-Forward Brief — <artifact> — <YYYY-MM-DD>

**Council verdict:** GO | NO-GO   ·  **Rounds spent:** <n>  ·  **Feature code written so far:** <n> lines
**Trigger:** rule 16(<a|b>) — <one line>

### Business impact
- **What users cannot do today:** <one line, in user terms, not system terms>
- **Cost of the stall:** <n> rounds / <n> days of review with <n> lines of code produced.
- **Deadline pressure:** <the date that makes this expire, or "none">
- **Exposure if we ship with the current residuals:** ~<N>% of <runs|users>, basis <measured|counted|assumption>
- **Exposure if we keep reviewing:** <what continues not to exist>

### The problem, technically
- <bullet — what the design does>
- <bullet — where it is genuinely unproven, with the evidence tier>
- <bullet — what has never been run, and for how many rounds>

### Root cause
<ONE sentence naming the causal assumption, not the symptom. "The design's shape rests on an unmeasured figure X" beats "round 12 had a bug." If the root cause is that the loop is attacking a document instead of a system, say exactly that.>

### Options
| | Path | Cost | Risk | Analyst verdict | Architect verdict |
|---|---|---|---|---|---|
| **A** | <one line> | <days / files> | <exposure %> | CONTAINS/RELOCATES/WIDENS | APPROVE/REWORK |
| **B** | <one line> | | | | |
| **C** | Ship with residuals, findings become day-1 failing tests | | | | |

### Council recommendation
<one option, one sentence why, and the strongest argument against it>

### Dissent
<any seat that disagreed, in its own words, one line — PRINCIPLES.md rule 7>

### If NO-GO — the decision needed from you
<a single question with lettered options. Nothing else. No homework.>

**Reports:** `docs/reviews/<scope>-design-challenger-<date>.md` · `<scope>-architecture-<date>.md` · `<scope>-impact-analyst-<date>.md`
```

---

## Session Handoff Format

The manager posts this at a natural close **and whenever the human says "wrap up" / "I need to go" / "stop here"** (any time, even mid-stage). Update `docs/STATE.md` with the same facts first — this block is the visible echo of the state you just saved.

```markdown
## Session Handoff — <YYYY-MM-DD>

**TL;DR:** [One plain-English sentence — what got done this session and what happens next. Written for someone skimming, not auditing.]

**State saved:** `docs/STATE.md` updated ✓ — done (+ evidence) · in-progress (+ where it stands) · blocked-on-human · open questions.

**ADR-cache savings this session:**
- Tokens saved: **~<N>** — sum of the `📊 ADR cache HIT` lines (<k> agent(s) reused the catalog).
- Est. cost saved: **~$<x>** = <N> × <model> input rate (Haiku ≈ $1/M · Sonnet ≈ $3/M · Opus ≈ $15/M). Rough estimate.
- (or) **No ADR-cache reuse this session.**

**Committed:** `<short-sha>` — <one-line commit summary> (or: "working tree already clean, nothing to commit" / "committed session changes; <N> unrelated pre-existing dirty file(s) left uncommitted — flagged below")

**Next action:** <the one thing to do first when you resume — matches STATE.md>
```

### Rules
1. **Numbers, not prose.** If nothing was reused, say "No ADR-cache reuse this session" — never invent a figure.
2. **The $ is an estimate** (~500 tokens/ADR avoided; provider prompt-caching may already discount repeats) — a ballpark, not a bill.
3. **`Next action` == STATE.md's next action** — one resume point, stated once.
4. Fires on demand: "wrap up" / "I need to go" / "stop here" runs this immediately, even mid-stage — nothing is lost.
5. **Wrap-up always commits.** `git add` the session's own changes and `git commit` with a real summary message — commit only, never push (push, especially to the default branch, stays human-only). Report the short SHA and a one-line summary in the **Committed** field. An already-clean tree is reported as such, not silently skipped. Pre-existing unrelated dirty state is never folded into the session's commit — call it out separately so the human decides what to do with it.
6. **TL;DR is mandatory and comes first**, same rule as the Manager Summary — one plain-English sentence before any structured field.

### Example
```markdown
## Session Handoff — 2026-07-11

**TL;DR:** Billing guard shipped clean; receiving flow is mid-build and blocked on a second dev store.

**State saved:** `docs/STATE.md` updated ✓ — done: billing guard (26/26 green, S01-code-2026-07-11.md) · in-progress: receiving flow (schema landed, cost-sync unbuilt) · blocked-on-human: 2nd dev store · open: pg-boss worker placement.

**ADR-cache savings this session:**
- Tokens saved: **~59,000** — 5 agents reused the catalog (24 ADRs each).
- Est. cost saved: **~$0.18** = 59,000 × Sonnet $3/M. Rough estimate.

**Committed:** `a1b2c3d` — "Ship billing guard (26/26 green); scaffold receiving-flow schema"

**Next action:** build the cost-sync job behind `/challenge` before it touches money.
```
