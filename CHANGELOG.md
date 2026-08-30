# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added — S1: protect the baseline (CI-01, QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, OSS-01)
- Project skeleton: TypeScript (run natively via Node's built-in type stripping, `engines.node >=22.18.0`), `node:test`, npm scripts, ESLint flat config (SE ADR-0010), Apache-2.0 `LICENSE`.
- `.github/workflows/ci.yml` (CI-01): lint, typecheck, full test suite, and every QA/OSS instrument's own gate run on every push/PR to `master`.
- `src/qa/fixture-coverage-check.ts` (QA-01): fails the build when a policy rule has no positive or negative fixture. Zero-rules-today state discloses as a vacuous pass, loudly.
- `src/qa/diff-fixture-check.ts` (QA-02): fails the build when a policy rule is added or changed in a diff with no accompanying fixture change.
- `src/qa/fixture-isolation-check.ts` (QA-05): fails when a test fixture writes into a declared live governance path. Proven against a deliberately-broken self-test fixture.
- `src/qa/mutation-harness.ts` (QA-06): generic apply-mutant → shadow-copy → rerun-suite → kill/survive engine. Proven against a live self-test mutant (real subprocess, real kill). Zero-real-mutant-classes state (no detector exists yet) discloses loudly.
- `docs/qa/recurring-findings-registry.md` + `src/qa/recurring-findings-registry.ts` (QA-13): lighter registry-file mechanism, human-ratified — a documented convention plus a structural validator, not an automated classifier (that's `docs/backlog.md`).
- `src/qa/reference-resolver.ts` (QA-14): fails on a citation to a nonexistent authority, a cross-repo Issue number, or an unparseable citation shape. Never silently skips an unrecognized citation shape.
- `src/qa/completeness-claim-checker.ts` (QA-15): fails when a numeric completeness claim's cited instrument, re-run, produces a different number than claimed, or when no machine-readable instrument reference exists.
- `src/qa/broken-instrument-gate.ts` (QA-16) + `docs/qa/broken-instruments.json`: fails unless a dated, named `docs/decisions.md` entry explicitly disables a registered broken instrument; a malformed or missing disable-decision still fails.
- `src/secret-scan/history-scan.ts` (OSS-01): scans full git history (every commit, not just the working tree), redacts secret values before logging. Proven to catch a fake secret planted in a non-HEAD commit. `docs/qa/secret-scan-allowlist.json` — the `.gitleaksignore`-equivalent CLAUDE.md's sensitive-areas list names — allowlists this repo's own test fixtures by exact path+pattern-id; an allowlisted match is still reported, never silently dropped, and still fails the gate if a non-allowlisted match exists alongside it.

### Fixed — real bugs found during S1's own build and dogfooding, each with a regression test
- `src/lib/exec.ts`: a nested `node --test` subprocess (QA-06's mutation harness reruns a suite as a subprocess) silently reported 0 tests / exit 0 because `NODE_TEST_CONTEXT` leaked into the child process env from the outer test runner. Every mutant would have scored SURVIVED, silently.
- `src/lib/git.ts`: `git ls-tree` submodule (gitlink) entries were treated as scannable blobs, crashing `history-scan.ts` on this repo's own `adr` submodule.
- `src/secret-scan/patterns.ts`: the email-address pattern false-positived on npm package version specifiers (`@microsoft/agent-governance-sdk@5.0.0`) in `REQUIREMENTS.md`; tightened to require an alphabetic TLD.
- `src/qa/reference-resolver.ts` (QA-14) and `src/secret-scan/history-scan.ts`/`patterns.ts` (OSS-01), run against their own source and history, each flagged their own doc-comment placeholders and test fixtures at first. Fixed by rewording the doc comments (not a real citation/secret, just example text) and by the allowlist mechanism above (real, checker's-own test fixtures) — not by suppressing the checks.
