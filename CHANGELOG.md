# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added — S1b: runtime-settings drift check (QA-17)
- `docs/qa/runtime-settings-inventory.json`: vendored, version-controlled snapshot of Claude Code's documented runtime-configurable settings keys (source: `code.claude.com/docs/en/admin-setup`, captured 2026-09-01) — 18 keys across five primitives (exclusive tool-server allowlist, permission-rule lockdown, customisation/hook lockdown, required version range, filesystem/network isolation).
- `src/qa/runtime-settings-drift-check.ts` (QA-17): pure `parseDocumentedKeys`/`computeDrift` diff the vendored snapshot against `REQUIREMENTS.md` §1.4's live table (heading-bounded parse, exact-string-match, case-sensitive). No `fetch`/`http(s)` import — offline by construction, never scrapes the real docs page. Two rows excepted from key-extraction by construction (a fixed, code-owned list, not a runtime flag): the hooks row (empty "Setting keys" cell) and the managed-policy-delivery row (channels/paths, not literal keys).
- `package.json`: `qa:runtime-settings-drift` script alias.
- `.github/workflows/ci.yml`: new `schedule` trigger (weekly, Monday 06:00 UTC) plus a separate `runtime-settings-drift` job gated `if: github.event_name == 'schedule'` — own checkout/setup/install/run steps, never folded into the push/PR `ci` job.

### Changed — REQUIREMENTS.md amendment 2026-09-01: runtime primitives overtook the document (pending architecture review)
- §1.4 rebuilt: every runtime primitive now names its actual managed-settings key. Six shipped, admin-enforceable keys were uncounted while the requirements they cover stayed marked *build*.
- **SUR-04** moved from build to configure-and-verify (`allowManagedMcpServersOnly` + `allowedMcpServers`). **INT-01**'s runtime-settings half likewise (`allowManagedPermissionRulesOnly`, `permissions.disableBypassPermissionsMode`, `allowManagedHooksOnly`, `strictPluginOnlyCustomization`, `strictKnownMarketplaces`, `disableSideloadFlags`).
- **POL-09 split**: write-protection is now a runtime primitive (admin console / plist / HKLM delivery, unwritable by the governed session); immutable pinning and the per-artifact stamp remain a build. Narrowed the matching §1.5 row.
- **ENV-13** and **SUR-11** acceptance now name `sandbox.enabled` / `sandbox.network.allowedDomains`.
- §0.7 gains normative **rule 6**: a runtime primitive shipping after this document retires the requirement it covers, re-checked by instrument.
- **QA-17 added (P0, lands in M1)**: instrument that diffs the runtime's published settings surface against §1.4's named keys and fails on an uncounted key. Enforcement mechanism for rule 6.
- Open decisions added: **T14** audit substrate (blocks scheduling the gap-G7 copy-and-fix), **T15** policy-engine substrate (Cedar, resolve by differential after M1.5), **T16** containment by workspace vs by probe (deliberately unanswered, gated on evaluation evidence).
- Explicitly unchanged and recorded as such: the semantic detector (SUR-06 to SUR-09), gap **G5** (`SessionStart` still cannot halt), and all of §6 (the unlock economy).

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

### Fixed — Stage 3 review fix-now pass (S1, `app-security-reviewer` REWORK + `cross-domain-reviewer` APPROVE-WITH-CONDITIONS, 2026-08-30)
- **[HIGH, GH issue 57]** `src/qa/completeness-claim-checker.ts` (QA-15): `[[completeness: cmd="..." expect=N]]` markers parsed out of `docs/STATE.md`/`docs/decisions.md`/`CHANGELOG.md` prose were `execFile`d directly — a demonstrated arbitrary-command-execution gadget wired unconditionally into CI. `cmd=` is now a symbolic name resolved only against a fixed, code-owned `KNOWN_INSTRUMENTS` allowlist (`src/qa/completeness-claim-checker.ts`); a name not on the allowlist fails closed, never executes. Regression tests prove a crafted malicious marker (and a shell-metacharacter-laden one) is rejected, with the runner never invoked.
- **[MED, GH issue 18 reopened/recurred]** `src/qa/diff-fixture-check.ts` (QA-02) and `src/qa/reference-resolver.ts` (QA-14) silently reported `VACUOUS-PASS`/exit 0 on a zero-SHA base ref (GitHub's `github.event.before` sentinel on a branch's first push or a history-discontinuous push). New `resolveChangedFiles`/`isZeroSha` in `src/lib/git.ts` detect the sentinel explicitly and fall back to a full-tree scan (every tracked file, via `lsTree`) instead of silently skipping the check — chosen over failing loud because it keeps QA-02/QA-14 actually enforcing instead of blocking CI on an infra artifact. Regression test added per instrument, plus one at the shared `resolveChangedFiles` level. Logged in `docs/qa/recurring-findings-registry.md` (second occurrence of this class).
- **[LOW]** `.github/workflows/ci.yml`: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` pinned from floating `@v4` tags to their current release's commit SHA (with a version comment).
- **[LOW, SUSPICION]** `src/qa/reference-resolver.ts` (QA-14): a PR-authored backtick citation path was resolved against `repoRoot` with no containment check, letting a crafted `../../`-style citation probe file existence/line-count outside the repo. New `resolveWithinRepo` rejects any resolved path that escapes `repoRoot` before `pathExists`/`lineCount` touch it; regression test confirms rejection.

### Fixed — real bugs found during S1's own build and dogfooding, each with a regression test
- `src/lib/exec.ts`: a nested `node --test` subprocess (QA-06's mutation harness reruns a suite as a subprocess) silently reported 0 tests / exit 0 because `NODE_TEST_CONTEXT` leaked into the child process env from the outer test runner. Every mutant would have scored SURVIVED, silently.
- `src/lib/git.ts`: `git ls-tree` submodule (gitlink) entries were treated as scannable blobs, crashing `history-scan.ts` on this repo's own `adr` submodule.
- `src/secret-scan/patterns.ts`: the email-address pattern false-positived on npm package version specifiers (`@microsoft/agent-governance-sdk@5.0.0`) in `REQUIREMENTS.md`; tightened to require an alphabetic TLD.
- `src/qa/reference-resolver.ts` (QA-14) and `src/secret-scan/history-scan.ts`/`patterns.ts` (OSS-01), run against their own source and history, each flagged their own doc-comment placeholders and test fixtures at first. Fixed by rewording the doc comments (not a real citation/secret, just example text) and by the allowlist mechanism above (real, checker's-own test fixtures) — not by suppressing the checks.
