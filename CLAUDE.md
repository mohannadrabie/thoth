# Project Context

This is a **full-stack** project (infrastructure **and** application code) using the `maat` plugin under one Manager-orchestrated loop.

> **Fork notice:** This is the shipped template `/maat:init` scaffolds into consumer projects. It is hand-maintained separately from this plugin repo's own dogfood `CLAUDE.md` at its repo root — editing one does **not** update the other. Sync changes by hand when they should apply to both.

**Read first, in order** (PRINCIPLES.md rule 14): `docs/STATE.md` → this file → `docs/PRINCIPLES.md` → `docs/decisions.md` (active decisions only — `docs/decisions-archive.md` is read on demand) → the applicable ADRs.

## Risk Tier Definitions

Review ceremony scales with risk per `docs/PRINCIPLES.md`.

**These definitions are yours to extend.** Edit the tiers below, add your own, or name a class of change that always lands in one. For a rule that must bind rather than merely advise, write it as an **ADR**: by PRINCIPLES rule 9 an accepted ADR outranks this file, so `MUST: any change under payments/ is CRITICAL` in an ADR's `Rules for agents` binds the Manager's tier ratification, while the same sentence here is a convention it can weigh. You may raise the ceremony a class of change gets; you may not lower it below what its blast radius warrants, and security, data-integrity, legal and safety changes never drop out of review.

**Who decides:** `story-implementer` proposes a tier in its Phase 1 plan with a one-line justification. **The Manager ratifies it** and challenges over- or under-tiering; the tier is the Manager's call, and you can overrule it. It is then persisted once to `docs/.maat-state.json`, and `/maat:review` and `/maat:verify` reuse it rather than re-deriving. Reviewers read the tier and calibrate to it; they do not re-litigate it.

### TRIVIAL
- Docs, comments, formatting, cosmetic changes. Tests + self-review, ship. No formal review.

### STANDARD
- Most feature work, refactors, config. ONE domain reviewer (chosen by what changed) + implementer.
- **Infra reviewers**: `network-reviewer`, `infra-security-reviewer` (IAM/secrets/exposure), `usability-reviewer` (self-service ADR)
- **App reviewers**: `app-security-reviewer` (authz/injection/deps), `api-reviewer` (contracts), `data-reviewer` (schema/migrations), `performance-reviewer`
- **Either**: `architecture-reviewer` (design), `code-reviewer` (correctness/tests)
- **`test-writer`** (black-box acceptance tests, written BEFORE the code exists) — not a reviewer, dispatched during Phase 1 planning, picked by what the plan says will change: **the moment the story's plan identifies a new/changed UI flow or API surface**, the same way a domain reviewer is picked by what changed, before a diff exists. Not dispatched against a story with no externally observable behavior change (pure internal refactor, infra-only, schema-only) — that stays covered by `story-implementer`'s own unit tests, unchanged. Does not count against the one-domain-reviewer pick above; it runs *before* build, not instead of the post-build review.

### CRITICAL
- Sensitive areas (IAM, network, auth, payments, migrations, public API), prod-facing, security-relevant.
- `red-team` (adversarial) + the relevant domain reviewer(s). A change spanning infra **and** app gets one reviewer per side, in parallel.

### Every tier above TRIVIAL
- `cross-domain-reviewer` always joins the domain reviewer(s) — the standing cross-domain pass that reads the WHOLE ADR catalog (not a domain slice) and catches what falls in the seams between lanes. It doesn't count against the "never more than two reviewers" cap (PRINCIPLES.md rule 9).

## Workflow Loop

**Primary command: `/maat:ship <story>`** — the **Manager (Osiris) conducts** the full loop, invoking each agent (across both domains, by what the change touches) and speaking to you at every gate:
```
intake → plan → test-first (if UI or API surface changes) → build → review → verify → audit → merge-handoff
```
The `test-first` stage is **conditional**, seated by `test-writer` — it runs only when Phase 1's plan identifies a new/changed UI flow or API surface (see the STANDARD-tier reviewer list above), the same way a domain reviewer is picked by what changed. `story-implementer` does not start Phase 2 (build) until `test-writer`'s tests exist and are confirmed red (`RED-CONFIRMED` on its receipt); a story with no externally observable behavior change skips this stage entirely and goes straight from `plan` to `build`.

Individual commands: `/maat:plan`, `/maat:review`, `/maat:debug`, `/maat:verify`, `/maat:resolve`, `/maat:red-team`, `/maat:audit`, `/maat:adr-amend`, `/maat:help`, `/maat:init`.

## Human-only actions

These stay with the human, always. No agent runs them, and no review report changes that:
- `git merge` / `gh pr merge` / any push to the default branch, and `git push --force`.
- `terraform apply` / `execute-change-set` and any prod deploy.
- Namespace deletion, package publish, destructive SQL.

## Sensitive areas

These areas always draw a named reviewer before a change to them is shippable — the tier picks who:
- **Policy enforcement / session gates** — anything that halts or gates an in-session action: `hooks/report-subject-gate.mjs` and any other `hooks/*` enforcement point wired to `PreToolUse` / `UserPromptSubmit`.
- **Guard / policy engine** — `scripts/guard/*`, `src/policy/guard/*`: the mechanism that decides what a session may do.
- **Evidence / audit trail** — `hooks/audit-log.mjs` and any component that records or verifies the incapability/assurance evidence (Plane A/C verification per `docs/REQUIREMENTS.md` §0.3).
- **Secret scanning / CI gates** — `.github/workflows/ci.yml`, `.gitleaks.toml`, `.gitleaksignore`, `scripts/secret-scan/*`.
- **Policy delivery / config surface** — anything that changes how policy is authored or delivered to the enforcement point (`docs/REQUIREMENTS.md` §"Policy is centralized").

## Architecture Decisions

Architecture decisions tracked in the `adr/` git submodule (central org repo, shared across projects), split by domain:
- `adr/devops/` — infrastructure/IaC decisions
- `adr/software-engineering/` — application/code decisions

ADRs are read from **both** domain folders in the pulled ADR repo — `maat.json → adr.dir` is an array: `["adr/devops", "adr/software-engineering"]`. The cache reporter (`docs/adr-cache.mjs`) scans each recursively; every agent prints a `📊 ADR cache …` line. Author ADRs with `docs/adr-template.md`. Accepted ADRs' **Rules for agents** rank ABOVE the conventions in this file — where they conflict, the ADR wins (PRINCIPLES.md rule 9).

## Applying this migration to a project already in progress

This project's own setup/migration steps may be re-applied more than once to this repo (a resumed or re-run pass), or applied fresh to a different project that's already mid-stream — or applied for the very first time to a brand-new project via `/…:init`, including an `/…:init` run that itself gets interrupted and re-run. Either way:

1. **Resume-safe, not duplicate-creating.** Before creating anything (a tracking artifact, a label, an issue, a board), check whether it already exists — detect a partial prior run and skip what's already done, never duplicate it. This half applies unchanged to a first-time bootstrap too: a brand-new project has nothing to resume, but a re-run `/…:init` still checks before creating so a partial first attempt is completed, not duplicated.
2. **Seed in-flight threads at their real current state.** Any active build/design thread's tracking artifact reflects its ACTUAL status — round count, what's shipped, what's blocked and on whom — pulled from this project's real `docs/STATE.md` / `docs/decisions.md` content, never a generic "just started" template. A brand-new project has no in-flight thread to seed from, so this half is a no-op there, not a violation — nothing to seed is not the same as skipping the check.
3. **This reasoning is a standing capability, not a one-off.** It's documented here once so a future session — re-running this migration against this repo, applying it to a different mid-stream project, or bootstrapping a brand-new project via `/…:init` — reads this section and follows it, instead of re-deriving the same reasoning from a source prompt each time.

## Issue Discipline

**The full schema — labels, body shape, state machine, and a token-efficient query cookbook agents use to control how much Issue context they load — lives in `docs/issue-template.md`.** It's a standalone, portable file (no dependency on the rest of this project's docs) so it can be copied into another repo or handed to an agent outside this project's scope unchanged. Read it once; every section below is that file's convention applied to this project specifically.

Applies to every GitHub Issue this project's workflow creates once a GitHub Project/Issues setup exists (see the bootstrap step in `/maat:init`) — read once, standing from here on; any future workflow step that creates or updates Issues (backlog migration, review-finding filing, tracking-issue updates) defers to this section rather than restating it.

1. **Descriptions are immutable once created.** Write an Issue's body correctly at creation time; after that, it is never edited (an obvious same-session typo fix before anyone has acted on the issue is the only exception). Every subsequent fact, correction, status change, or piece of new context is a new COMMENT, never a body edit — the same append-only philosophy `docs/decisions.md` already uses, applied to Issues: a comment thread is a real, diffable history of what was known and when, not a description that silently drifts.
2. **Use GitHub's native state machine properly, not just a label.** The Project `Status` field (Backlog / Design / Blocked-on-owner / In Review / Building / Shipped / Declined) tracks workflow stage. But the issue's actual open/closed state is the real signal Milestones roll up from:
   - An issue closes ONLY when its work is genuinely done: shipped and verified (`state_reason: completed`, `Status` set to `Shipped` at the same time — never one without the other) or explicitly decided against (`state_reason: not_planned`, `Status` set to `Declined`, with a comment stating why and who decided).
   - Link the commit/PR that closes an issue with a `Closes #N` / `Fixes #N` reference in its message, so the closure is tied to a real artifact, not a manual status flip with nothing behind it.
   - **If a closed issue's problem recurs, REOPEN the same issue** (native reopen) and comment why — never open a fresh duplicate. This keeps one thread's full history in one place instead of fragmenting the same bug across multiple issue numbers.
3. This discipline costs nothing extra in tokens — it's a convention for `gh issue create/comment/close/reopen` calls, not new tooling to build. **Query cheaply, per `docs/issue-template.md`'s cookbook** — triage with a metadata-only `gh issue list`, and only pull a full body/comment thread (`gh issue view <N> --json body,comments`) for the specific issue you're about to act on, never in bulk across a list.
4. Every comment posted under this discipline opens with the posting agent's identity, a fixed greppable prefix (e.g. `[architecture-reviewer]`, `[Manager]`) — without it, a comment thread posted through one shared bot/PAT identity is unreadable (no way to tell one agent's comment from another's).

### Review Verdicts → Issue Status

The `verdict:go` / `verdict:conditional` / `verdict:no-go` / `verdict:reject` labels apply **only** to `design-challenger`/design-council rounds (a Feature or PR a pre-build or post-build design loop ruled on) — they are not the per-reviewer verdict enum itself (`docs/manager-summary-format.md` has that table). General rule for every reviewer type, keyed off the first (clean) value in that table:
- **Clean verdict** (`SHIP`, `APPROVE`, `go`, `SAFE-TO-PATCH`, `FIXED`, `BUILD-COMPLETE`) → no Issue Status change needed.
- **Conditional-clean verdict** (`SHIP-WITH-CONDITIONS`, `APPROVE-WITH-CONDITIONS`, `PATCH-WITH-CONDITIONS`) → leave Status as-is, but the reviewer adds a same-turn comment naming the condition(s) and whether each is fix-now or deferred.
- **REWORK/BLOCKED-class verdict** (`SHIP-AFTER-FIXES`, `DO-NOT-SHIP`, `REWORK`, `no-go`, `REDESIGN-REQUIRED`, `BLOCKED`, `UNREPRODUCIBLE`) → set `Status = Blocked-on-owner` on the tracked Issue/PR (if one exists for this change) with a comment naming the blocker and its unlock.

### Review Findings → Bug Issues

**Trigger:** the moment any reviewer role lists a finding in its own RECEIPT at `[ISSUE][HIGH]` or `[ISSUE][MED]`, a GitHub Issue gets filed — same turn, self-persisted by the reviewer itself (the Manager is the backstop only, per `ship.md` stage 3). PRINCIPLES.md rule 21's severity-triage cap (a narrow-blast-radius `[HIGH]` routed to the Manager's Role 2b before it gates) changes whether a finding blocks ship — it does not change whether the Issue gets filed; file it regardless, then let the triage decide the Status/Conditions handling.

**Issue shape:** `bug` label + the matching `severity:high`/`severity:med` label (per `docs/issue-template.md`) + this project's Feature ID label if one applies, else the `chore` catch-all + no Milestone at filing time. Body stays short per `docs/issue-template.md`: one-line summary + a link to the dated report in `docs/reviews/` — never paste the report's finding prose into the Issue body.

**Duplicate check first:** `gh issue list --search` for existing matching Issues before filing — never create a second Issue for the same finding across review rounds; comment on the existing one instead.

**Closure:** the Issue closes with `state_reason: completed` — `gh issue close <n> --reason completed`, not the bare default.

## Hard rules — never violate
_Project invariants. The reviewer checks these every time (its standing checklist); a violation is a Blocker. Edit for your project._
- `terraform apply` / `execute-change-set` and prod deploys never run from a session — human-only.
- No IAM `Action: "*"`/`Resource: "*"`; no secrets in code/state/config — read from a vault / env.
- Domain logic gets unit tests WITH the feature; money & inventory ops are idempotent (run-twice test).
- No changes to the sensitive areas above (policy enforcement/guard, evidence trail, secret scanning/CI, policy delivery) without a fresh dated review report in `docs/reviews/`.
- No gold-plating: not in the approved change → a new GitHub Issue on the Project board (Feature ID label, or the `chore` catch-all, `Status = Backlog`) once this project has a GitHub Issues/Project setup (see `/maat:init`'s bootstrap step); until then, `docs/backlog.md`. Either way, never the diff.
- No hand-derived completeness claims. Any claim of completeness/exhaustive enumeration ("all N writers", "every consumer", "the full set of X") is generated by a running instrument (a test, script, or query) — never hand-typed or hand-derived in prose. If no such instrument exists, building one is part of the task. Proportionality clause: skip this for a short, flat set that's genuinely trivial to eyeball — the exemption keys on inspection complexity, not raw file count; a single file can still be non-trivial to verify by inspection (long, nested, or structurally mixed content) and stays in scope. It applies whenever the set is non-trivial to verify by inspection (spans multiple files, call sites, or modules; is long or nested even within one file; or has recurred as wrong before). Applies project-wide, to whichever role makes the completeness claim (commonly `story-implementer` when it builds the fix, but equally any other role — e.g. a role asserting its own coverage is complete).
- _<add your project's own invariants>_

## Definition of Done (every change)
_`/maat:verify` enforces this. Edit for your project._
- build / typecheck / lint / policy pass; tests green in CI with real counts (skipped ≠ passed); coverage gate real
- infra: plan/changeset reviewed, destructive changes listed; app: migrations reversible, API changes back-compat or versioned
- required review report(s) fresh in `docs/reviews/` with raw evidence
- **for any story that had a `test-writer` pass: its Playwright/API tests pass GREEN, UNMODIFIED from what `test-writer` authored.** If `story-implementer` believes a test is wrong or impossible per spec, it flags that back rather than silently editing the test file — the test is the answer key, not something the implementer gets to edit to pass.
- CHANGELOG entry + `docs/STATE.md` updated; working tree clean
