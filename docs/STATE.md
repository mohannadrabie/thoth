# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-08-30

## Current state
- **Done, built, Stage 3 fix-now pass complete, ready for re-review:** S1 ("protect the baseline" — CI-01, QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, OSS-01). Built by `story-implementer` (Ptah) against ADR-0021 revision 2 (proposed, human-authorized "clearly-enough-directed" build basis — `docs/decisions.md` 2026-08-30). Stage 3 review (`app-security-reviewer` REWORK, `cross-domain-reviewer` APPROVE-WITH-CONDITIONS) found four items; every one of them fixed in this same pass by `story-implementer`:
  - **[HIGH, GH issue 57]** QA-15 (`src/qa/completeness-claim-checker.ts`): `cmd=` in a `[[completeness: ...]]` marker was `execFile`d directly — demonstrated arbitrary-command-execution gadget wired unconditionally into CI. Fixed: `cmd=` is now a symbolic name resolved only against a fixed `KNOWN_INSTRUMENTS` allowlist; an unknown name fails closed, never executes. Regression tests prove a crafted malicious marker is rejected with the runner never invoked (live-demonstrated against the exact payload shape the reviewer used — no proof file written).
  - **[MED, GH issue 18 reopened, second recurrence]** QA-02/QA-14 silently `VACUOUS-PASS`ed on a zero-SHA base ref. Fixed: new `resolveChangedFiles`/`isZeroSha` (`src/lib/git.ts`) detect the sentinel and fall back to a full-tree scan instead of silently skipping — chosen over failing loud so the gate keeps enforcing rather than blocking CI on an infra artifact. One regression test per instrument, plus one at the shared helper. Logged in `docs/qa/recurring-findings-registry.md`'s first-ever row (this repo's QA-13 mechanism is a human-ratified structural-validator + documented convention, NOT an automated recurrence classifier — confirmed honest in this pass, not just asserted).
  - **[LOW]** `.github/workflows/ci.yml`: `actions/checkout`/`setup-node`/`upload-artifact` pinned to commit SHAs (current v4.x release each) instead of floating `@v4` tags.
  - **[LOW, SUSPICION]** QA-14 (`src/qa/reference-resolver.ts`): a PR-authored `../../`-style backtick citation could probe file existence/line-count outside `repoRoot`. Fixed: new `resolveWithinRepo` rejects any resolved path escaping `repoRoot`; regression test confirms rejection.
  - Evidence: real `npm run typecheck` (0 errors) / `npm run lint` (0 findings) / `npm test` (89/89 passing, 0 skipped — 80 prior + 9 new regression tests) runs, every QA/OSS instrument's CLI run for real against this repo including against the real diff of this fix-now commit.
  - **Scope note:** the working tree also carries pre-existing, unrelated modifications (`docs/adr-cache.mjs`, `docs/backlog.md`, `docs/decisions.md`, `docs/REVIEW_LOG.md`, `adr` submodule pointer, `docs/.maat-state.json`) from the review stage — left untouched and uncommitted by this fix-now pass, per the Manager's explicit four-finding scope. Flagged for the Manager: `docs/adr-cache.mjs`'s own existing content (line ~149, a pre-existing GH-issue-shaped code comment) would itself fail QA-14 for real once committed and diffed — unrelated to any of the four findings fixed here, not fixed in this pass (out of scope), surfaced so it isn't silently missed at the next commit that includes that file.
  - Project skeleton: TypeScript (Node's native type-stripping, `engines.node >=22.18.0`, measured not assumed), `node:test`, npm, ESLint flat config, `LICENSE` (Apache-2.0, T9).
  - `.github/workflows/ci.yml` — validated YAML, every job step reproduces locally.
  - Real bugs found and fixed during build (not deferred), each with a regression test: (1) `node --test` subprocess nesting silently swallowed a nested test run's real output because `NODE_TEST_CONTEXT` leaked into the child env — `src/lib/exec.ts`. (2) `git ls-tree` submodule (`adr`) gitlink entries were treated as scannable blobs, crashing `history-scan.ts` — `src/lib/git.ts`. (3) OSS-01's email-address pattern false-positived on `@microsoft/agent-governance-sdk@5.0.0` npm version specifiers in `REQUIREMENTS.md` — tightened to require an alphabetic TLD. (4) Dogfooding QA-14 and OSS-01 against their own source/history found each flagging its own doc-comment placeholders and test fixtures — fixed by rewording (doc comments) and `docs/qa/secret-scan-allowlist.json` (the `.gitleaksignore`-equivalent CLAUDE.md's sensitive areas already name; real fixtures only, never a blanket suppression).
  - **Fix-now pass complete, needs re-review.** `.github/workflows/ci.yml` and the secret-scan surface (`src/secret-scan/*`) are CLAUDE.md-named sensitive areas — needs `app-security-reviewer` (re-request, its REWORK verdict is what triggered this pass) + `cross-domain-reviewer` to confirm the 4 fixes before it's shippable.
- **In progress:** nothing else mid-build.

## Next (in order)
1. Re-dispatch Stage 3 review on S1's diff (post fix-now pass): `app-security-reviewer` + `cross-domain-reviewer` confirm the 4 items are actually closed.
2. On a clean/conditional-clean verdict: `/maat:verify`, then merge-handoff (human-only merge).
3. After S1 ships: plan S2 (kernel / Action record / normalizer registry per ADR-0021 shapes 1–3), which needs ADR-0021 to move from `proposed` to human-accepted first (still pending — `docs/decisions.md` 2026-08-30, "genuine human acceptance is still pending").

## Blocked on a human
- ADR-0021 final acceptance (currently `proposed`, revision 2; building continues on the authorized "clearly-enough-directed" basis, but S2's kernel work needs real acceptance before it starts).
- Repo visibility flip to public (OSS-01 builds/runs the scan only; the flip itself is out of S1's scope per `docs/decisions.md` 2026-08-30).
- Merge of S1's PR once Stage 3 review clears (merge is human-only regardless of verdict).

## Open questions / pending decisions
- None new this session beyond what's already logged in `docs/decisions.md`.

## Session savings (ADR cache)
- **Last session:** ~17,300 tokens saved (~$0.05 at Sonnet $3/M) — one `📊 ADR cache HIT` (35 ADRs, fingerprint `be365e4`) reused during this build's ADR pre-flight check.
