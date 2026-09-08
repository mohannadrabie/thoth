---
schema: maat-issue-v1
portable: true
requires:
  - "gh CLI (GitHub Issues + Projects v2)"
labels:
  type:
    - bug
    - feature
    - chore
  severity:
    - severity:high
    - severity:med
    - severity:low
  verdict:
    - "verdict:go"
    - "verdict:no-go"
    - "verdict:conditional"
    - "verdict:reject"
  status:
    - blocked-on-owner
    - current-focus
  feature: [pol, sur, int, ops, qa, ci, oss]
  catchAll: "chore"
project_fields:
  Status: [Backlog, Design, Blocked-on-owner, In Review, Building, Shipped, Declined]
  Feature ID: "One label per REQUIREMENTS.md requirement-group prefix — pol/sur/int/ops/qa/ci/oss — kept in sync with that file's own group headers. If a requirement-group prefix in REQUIREMENTS.md has no matching label, that's a gap: add the label before filing against it, don't reuse the nearest existing one (2026-09-07 postmortem: SUR/OPS bugs were mistagged `pol` for lack of their own labels, S4 Issue #84 and S5 Issues #90-98)."
  Risk tier: [TRIVIAL, STANDARD, CRITICAL]
  Round count: "number, optional — design-challenger/review round tracking"
---

# Issue Template & Query Cookbook

**This file has no dependency on any other file in this plugin.** Copy it into
any repo, any project, any agent's context on its own — it stands alone as a
spec for how Issues are shaped and how to query them cheaply. Where it's used
alongside the `maat` plugin, it's the schema that plugin's
reviewers, the Manager, and `/maat:init`'s bootstrap step already assume;
outside that plugin, it's just a sane default for any agent-driven Issue tracker.

## Why this exists

Two separate problems, one file:

1. **Consistency.** Every Issue an agent creates should look the same — same
   labels, same body shape, same state-machine — so a different agent (or a
   different project) can read one without re-learning a bespoke format.
2. **Token cost.** The naive way to "check the issues" is `gh issue list --json
   number,title,body,comments,...` across everything, which loads full bodies
   and comment threads for issues nobody is about to work on. This file fixes
   that by making the query itself tiered: cheap metadata first, expensive
   full-content reads only for the one issue actually in scope.

## 1. Issue schema

**Title:** short, imperative, no ticket-speak — `Fix IAM wildcard in api/iam.tf`,
not `[BUG] Issue with IAM policy configuration`.

**Labels** (apply the ones that are relevant; not every Issue needs every kind):
- **Type:** `bug` | `feature` | `chore`
- **Severity** (bugs/findings only): `severity:high` | `severity:med` | `severity:low`
- **Verdict** (design-loop/review-loop artifacts only — a Feature/PR an
  adversarial or council pass ruled on): `verdict:go` | `verdict:no-go` |
  `verdict:conditional` | `verdict:reject`
- **Workflow state:** `blocked-on-owner` (waiting on a human decision, not on
  more agent work) · `current-focus` (pinned — the small set an agent should
  always load at session start, see the query cookbook below)
- **Feature ID:** one label per feature/epic your project's own roadmap
  defines, plus a catch-all (`chore` or similar) for work that
  isn't feature-shaped

**Body — short, and stays short:**
```markdown
<one-line summary of the problem or the ask>

<link to the full evidence: a dated report path, a PR, a design doc — never
paste the full finding/report prose into the Issue body>
```
Never paste a reviewer's full report prose into an Issue body — link to the
dated report file instead. The Issue is a pointer into the tracking system,
not a second copy of the evidence.

**State machine (native open/closed, not just a label):**
- An Issue closes ONLY when its work is genuinely resolved:
  `state_reason: completed` (shipped and verified) or `state_reason:
  not_planned` (explicitly decided against, with a comment saying who decided
  and why) — never a bare default close.
- Link the closing commit/PR with `Closes #N` / `Fixes #N` so the closure
  traces to a real artifact.
- **If a closed Issue's problem recurs, reopen the same Issue** (native
  reopen) and comment why. Never open a duplicate — one thread, one number,
  full history in one place.
- **Descriptions are immutable once created** (an obvious same-session typo
  fix is the only exception). Every later fact, correction, or status change
  is a new **comment**, never a body edit — an append-only history you can
  diff, the same philosophy as an audit log.
- Every comment opens with the posting agent's identity in brackets —
  `[architecture-reviewer]`, `[Manager]` — so a shared bot/PAT identity
  doesn't make the thread unreadable.

## 2. Token-efficient query cookbook

The point: **decide how much you need before you ask for it.** Three tiers,
cheapest first.

**Tier 1 — triage / "what's out there" (cheap: number, title, labels only).**
Use this to decide what, if anything, needs a closer look. Never request
`body` or comments at this tier.
```bash
gh issue list --state open --label bug --json number,title,labels,updatedAt --limit 50
gh issue list --state open --label current-focus --json number,title,labels
gh issue list --state open --label severity:high --json number,title,updatedAt
```

**Tier 2 — scoped triage (medium: metadata for a narrowed set).** Once tier 1
narrows the candidates, pull a bit more — still no full body/comments — for
just that set.
```bash
gh issue list --state open --label "severity:high,severity:med" \
  --json number,title,labels,assignees,updatedAt --limit 20
```

**Tier 3 — full context for ONE issue you're about to act on (expensive:
body + comment thread).** Only ever call this for the specific issue(s) you
are actually going to read or work, never in a loop over a list.
```bash
gh issue view <N> --json number,title,body,labels,comments,state
```

**Anti-pattern — never do this:**
```bash
# Loads full body+comments for every open issue, unconditionally.
gh issue list --state open --json number,title,body,comments   # DON'T
```
If you find yourself writing that, you almost certainly want tier 1 first,
then tier 3 on the two or three issues that survive triage.

**Session-start pattern** (pairs with the "one state, read first" rule most
agent loops already follow): tier-1 query the pinned set first, nothing
more, before touching anything else.
```bash
gh issue list --label current-focus --state open --json number,title,labels
```
Only escalate to tier 2/3 for the specific item you're about to act on.

## 3. Portability notes

- **No dependency on this plugin's other docs.** The labels and query
  patterns above are complete on their own — `gh` CLI plus the label set is
  the only requirement.
- **No GitHub Issues? Same schema still applies.** If your tracker is
  file-based, a different ticket system, or a spreadsheet, the sections above
  still describe the right shape: short immutable-at-creation body, a
  severity taxonomy, a state machine with a real "why" on close, and a
  cheap-then-expensive query discipline. Swap `gh issue …` for your tracker's
  equivalent CLI/API calls.
- **Migrating an existing file-based backlog into this schema?** See
  `/maat:init`'s bootstrap step (in the `maat` plugin) for a
  worked, idempotent migration flow — or, standalone, the short version is:
  one Issue per still-open backlog item, its original text kept verbatim as
  the Issue body's first line, its origin noted as a comment (not silently
  dropped), and the source file left in place as a dated pointer rather than
  deleted, until every item is confirmed migrated.
