# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-08-30

## Current state
- **Done, built, awaiting review:** S1 ("protect the baseline" — CI-01, QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, OSS-01). Built by `story-implementer` (Ptah) against ADR-0021 revision 2 (proposed, human-authorized "clearly-enough-directed" build basis — `docs/decisions.md` 2026-08-30). Evidence: real `npm run typecheck` / `npm run lint` / `npm test` runs, 80/80 tests passing 0 skipped, every QA/OSS instrument's CLI run for real against this repo, including against the real diff of this commit itself (see the build receipt in this session's `story-implementer` transcript — no `docs/reviews/` report yet, that's Stage 3).
  - Project skeleton: TypeScript (Node's native type-stripping, `engines.node >=22.18.0`, measured not assumed), `node:test`, npm, ESLint flat config, `LICENSE` (Apache-2.0, T9).
  - `.github/workflows/ci.yml` — validated YAML, every job step reproduces locally.
  - Real bugs found and fixed during build (not deferred), each with a regression test: (1) `node --test` subprocess nesting silently swallowed a nested test run's real output because `NODE_TEST_CONTEXT` leaked into the child env — `src/lib/exec.ts`. (2) `git ls-tree` submodule (`adr`) gitlink entries were treated as scannable blobs, crashing `history-scan.ts` — `src/lib/git.ts`. (3) OSS-01's email-address pattern false-positived on `@microsoft/agent-governance-sdk@5.0.0` npm version specifiers in `REQUIREMENTS.md` — tightened to require an alphabetic TLD. (4) Dogfooding QA-14 and OSS-01 against their own source/history found each flagging its own doc-comment placeholders and test fixtures — fixed by rewording (doc comments) and `docs/qa/secret-scan-allowlist.json` (the `.gitleaksignore`-equivalent CLAUDE.md's sensitive areas already name; real fixtures only, never a blanket suppression).
  - **Not yet reviewed.** `.github/workflows/ci.yml` and the secret-scan surface (`src/secret-scan/*`) are CLAUDE.md-named sensitive areas — needs a fresh `app-security-reviewer` + `cross-domain-reviewer` pass (Stage 3) before it's shippable.
- **In progress:** nothing else mid-build.

## Next (in order)
1. Dispatch Stage 3 review on S1's diff: `app-security-reviewer` + `cross-domain-reviewer` (STANDARD tier, per `docs/decisions.md` 2026-08-30 tier ratification).
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
