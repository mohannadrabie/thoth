# Thoth

A governance engine for AI coding sessions. Thoth decides what a session may do, verifies what it is actually incapable of doing, and produces evidence of both.

## What Thoth promises

Thoth does not promise that an agent will never attempt a change it shouldn't. It promises that, for every environment declared off limits at `proven` assurance, the session is verified incapable of reaching it, that Thoth halts when that verification cannot be produced, that the incapability is re-tested on a schedule with retained evidence, and that wherever a weaker assurance was chosen, Thoth says so plainly instead of claiming more than it proved.

In-session gates are a fast-feedback control, not a security boundary. They run in the agent's own process at the agent's own privilege, which is why Thoth separates what it can verify from what it can only observe:

| Plane | What it is | Certain? | Thoth's role |
|---|---|---|---|
| A. Capability | The session holds no credential and no route to a forbidden environment | Yes, at `proven` assurance | Verify and halt |
| B. Runtime policy | The in-session gate | Never | Own it. Fast feedback and an audit trail |
| C. Out-of-band authority | Separate deploy identity, cloud guardrails, platform-level denial | Yes | Verify and report |

Full detail, the amendment history, and the reuse ledger against Microsoft's Agent Governance Toolkit (AGT) live in `REQUIREMENTS.md`.

## What Thoth is not

- Not a security boundary at the in-session gate
- Not an agent framework, a roster, or a workflow engine (that's the separate `maat` plugin, which Thoth governs like any other consumer)
- Not multi-runtime or multi-provider (Claude Code on Bedrock only, by design)
- Not a replacement for IAM, cloud guardrails, or a delivery pipeline

## What's built so far

**Policy engine** (`src/policy/`): a kernel that renders verdicts against normalized action records, a normalizer that turns raw tool calls (including a semantic shell-command scanner) into a canonical shape, a rule schema with precedence handling, a tool classification and MCP-enumeration layer, and a config loader that resolves shipped defaults against project-level overrides with a print CLI for inspecting the resolved policy.

**Quality/self-check instruments** (`src/qa/`): seventeen standalone checkers wired into CI and `npm run qa:*`, covering fixture coverage and isolation, mutation testing (including a dedicated shell-detector mutation harness), reference resolution, completeness-claim checking (catches unverified "all N" claims in the project's own docs), broken-instrument detection, runtime-settings drift, kernel purity (the policy kernel can't be touched by code outside its own boundary), gate-manifest and gate-latency checks, and a recurring-findings registry that tracks repeat defect classes across stories.

**Secret scanning** (`src/secret-scan/`): a full-history scanner and a pre-commit variant that simulates the resulting tree via git plumbing without touching the real index, installed through a real git hook (`.githooks/`) rather than a script someone has to remember to run.

**Governance process itself**: the repo is built under its own `maat`-plugin loop (intake, plan, build, review, verify, audit) with a written charter (`docs/PRINCIPLES.md`), architecture decisions in a shared `adr/` submodule that outrank convention, and a full audit trail in `docs/STATE.md`, `docs/decisions.md`, and dated reports under `docs/reviews/`. Every non-trivial change gets at least one domain reviewer plus a standing cross-domain pass; sensitive areas (the policy kernel, the guard hooks, secret scanning, evidence recording) draw red-team review.

## Current status

As of this writing the active branch is `feat/kernel-purity-ast-hardening`: PR #214 is open, both required reviewers are clean, and it's awaiting human review and merge. Full test suite: 877 of 879 passing (2 pre-existing failures tracked separately, not introduced by this branch). Typecheck and lint are clean.

The next largest unstarted blocks are Milestone S5 (deny-by-default policy enforcement plus hook wiring, 7 open items) and Milestone S6 (policy centralization, 5 open items). `docs/backlog.md` carries roughly 30 smaller deferred items, mostly disclosed residuals from already-shipped stories.

For the full, current picture, read `docs/STATE.md` first. It's kept current at every ship-close and is the single source of truth for what's actually merged versus in flight.

## Repo layout

```
src/policy/     the policy kernel, normalizer, rule schema, tool classification, config loader
src/qa/         self-check instruments (fixture coverage, mutation testing, drift checks, ...)
src/secret-scan/  full-history and pre-commit secret scanning
src/lib/        shared utilities (exec, git, fs helpers, hook installer)
hooks/          git/session hook implementations
.thoth/         runtime state (halt-state, policy pointer)
adr/            architecture decisions (git submodule, shared across projects)
docs/           STATE.md, decisions log, review reports, requirements, backlog, plans
```

## Working in this repo

```
npm test              run the full suite
npm run typecheck      tsc --noEmit
npm run lint            eslint .
npm run qa:kernel-purity   check the policy kernel hasn't been touched from outside its boundary
npm run policy:print       print the resolved policy config
npm run oss:secret-scan    full-history secret scan
```

Requires Node >=22.18.0. TypeScript throughout, ESM only.

## Where to go next

- `REQUIREMENTS.md`: the single input to planning, including the reuse ledger against AGT and the two open architecture amendments (2026-08-29, 2026-09-01) awaiting review
- `docs/STATE.md`: what's actually shipped, what's in flight, and the exact resume point
- `docs/PRINCIPLES.md`: the working charter (ceremony scales with risk, evidence not claims, stalled loops escalate)
- `CLAUDE.md`: hard rules, risk tiers, sensitive areas, and the human-only action list
