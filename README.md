# Thoth

A governance engine for AI coding sessions running on Claude Code. Thoth decides what a session is allowed to do, verifies what it's actually incapable of doing, and keeps evidence of both.

Claude Code sessions run with real shell, filesystem and git access. Permission rules and hooks can restrict that, but they run inside the agent's own process, at the agent's own privilege, so they can be prompted around or silently miss a code path. Thoth's job is to know the difference between "we told it not to" and "it structurally cannot", and to say plainly which one applies to any given control.

## Features

- **Policy engine** (`src/policy/`): a kernel that evaluates normalized action records against a rule set, a normalizer that turns raw tool calls into a canonical shape (including a semantic shell-command scanner, so `rm -rf` survives flag reordering and quoting tricks), a rule schema with precedence handling, tool classification and MCP-server enumeration, and a config loader that resolves shipped defaults against project overrides.
- **Self-check instruments** (`src/qa/`): 17 standalone checkers wired into CI, covering fixture coverage and isolation, mutation testing, reference resolution, unverified-completeness-claim detection, broken-instrument detection, runtime-settings drift, kernel purity (nothing outside the policy kernel can quietly extend its trust boundary), and a registry that tracks recurring defect classes across the project's own history.
- **Secret scanning** (`src/secret-scan/`): full-history scanning plus a pre-commit variant that simulates the resulting tree via git plumbing, without touching the real index, installed as a real git hook rather than a script someone has to remember to run.
- **Git hook installer** (`src/lib/git-hooks-install.ts`): wired into `npm install` via the `prepare` script, so hooks are live on every clone without a manual step.

## How it's governed

Thoth's own repo is built under a Claude Code plugin called `maat`: a multi-agent loop (intake, plan, build, review, verify, audit) with a written charter (`docs/PRINCIPLES.md`), shared architecture decisions in an `adr/` submodule, and a dated review report for every non-trivial change in `docs/reviews/`. Sensitive surfaces (the policy kernel, guard hooks, secret scanning, evidence recording) require a security review before they ship. `docs/STATE.md` is the single source of truth for what's merged versus in flight, and `docs/decisions.md` is the append-only decision log.

## Requirements

- Node >= 22.18.0
- TypeScript, ESM throughout

## Install

```
npm install
```

This also installs the git hooks (pre-commit secret scan) via the `prepare` script.

## Usage

```
npm test                    run the full test suite
npm run typecheck           tsc --noEmit
npm run lint                 eslint .
npm run build                 typecheck (no emit step; this is a tool repo, not a library build)
npm run policy:print           print the resolved policy config
npm run oss:secret-scan        full-history secret scan
npm run oss:pre-commit-scan    the scan the pre-commit hook runs
```

The full list of `qa:*` scripts (mutation testing, drift checks, fixture coverage, and so on) is in `package.json`; each corresponds to one file under `src/qa/`.

## Project structure

```
src/policy/       policy kernel, normalizer, rule schema, tool classification, config loader
src/qa/            self-check instruments (fixture coverage, mutation testing, drift checks, ...)
src/secret-scan/   full-history and pre-commit secret scanning
src/lib/           shared utilities (exec, git, fs helpers, hook installer)
hooks/             git/session hook implementations
.thoth/            runtime state (halt-state, policy pointer)
adr/               architecture decisions (git submodule, shared across projects)
docs/              STATE.md, decisions log, review reports, requirements, backlog, plans
```

## Status

Active branch: `feat/kernel-purity-ast-hardening`. PR #214 is open and awaiting merge; both required reviewers are clean. Full suite: 877/879 tests passing (2 pre-existing failures tracked separately, not introduced by this branch). Typecheck and lint are clean.

Not yet started: Milestone S5 (deny-by-default policy enforcement and hook wiring, 7 open items) and Milestone S6 (policy centralization, 5 open items). `docs/backlog.md` tracks roughly 30 smaller deferred items, mostly disclosed residuals from already-shipped work.

`docs/STATE.md` is kept current at every ship-close and is more current than this file will ever be between updates; check it for the live picture.

## Documentation

- `REQUIREMENTS.md`: full requirements, priority groups, and the reuse ledger against Microsoft's Agent Governance Toolkit
- `docs/STATE.md`: what's shipped, what's in flight, exact resume point
- `docs/PRINCIPLES.md`: the working charter
- `CLAUDE.md`: risk tiers, sensitive areas, human-only actions

## License

Apache-2.0
