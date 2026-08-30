# App Security Review — S1 "protect the baseline"

**Reviewer:** app-security-reviewer (Horus)
**Subject:** commit `2992bfb` (local, unpushed), diff from `a5448c6`, repo `mohannadrabie/thoth`
**Tier:** STANDARD (ratified `docs/decisions.md` 2026-08-30)
**Scope trigger:** CLAUDE.md-named sensitive areas — `.github/workflows/ci.yml` (Secret scanning / CI gates) and `src/secret-scan/*` (the secret scanner itself)
**Date:** 2026-08-30

## ADR compliance

`node docs/adr-cache.mjs --ensure` result: ADR cache HIT, reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp be365e4, CACHE=HIT.

Applicable ADRs read from the cached catalog (`docs/.maat-state.json` -> `adrCatalog.adrs`), scoped to my domain (secrets, dependencies, injection, data exposure, CI supply chain):

- **SE ADR-0009 (Monitoring and observability)**: "MUST emit structured JSON logs with the standard fields; MUST NOT log secrets, tokens, passwords, or personal data."
- **SE ADR-0010 (Code quality and maintainability gates)**: "MUST add a new third-party dependency only with a justification paragraph in the PR description." Also: "MUST NOT disable, skip, or inline-suppress linter/type/test rules to get green ... without a comment justifying it AND a human-approved exception."
- **SE ADR-0021 (Thoth-native architecture)**: "Introducing agent-governance-sdk, agent-governance-claude-code, or an equivalent third-party governance-decision dependency ... MUST NOT happen without a new recorded decision reopening that question."
- **devops ADR-0009 (Least-privilege IAM and secrets in IaC)**: secrets never in source/env/state, read from a vault — not directly applicable (no IaC/cloud secrets surface in this diff), checked for completeness.
- **devops ADR-0008 (CI/CD gates and policy-as-code)**: "MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)" — relevant to whether the allowlist mechanism is a real bypass risk.

No violation of any of these ADRs' text was found (see Findings 4, 7, 9, 10 below). One ADR-adjacent process nit (Finding 8, SE-0010's literal "justification paragraph" form) is noted but not blocking.

## Method

- Read `.github/workflows/ci.yml`, `src/secret-scan/history-scan.ts`, `src/secret-scan/patterns.ts` and their tests in full.
- Read `src/lib/git.ts`, `src/lib/exec.ts` and their regression tests for the two build-time bug fixes.
- Read `src/qa/reference-resolver.ts`, `src/qa/completeness-claim-checker.ts`, `src/qa/broken-instrument-gate.ts`, `src/qa/mutation-harness.ts`, `src/qa/diff-fixture-check.ts`, `src/qa/fixture-isolation-check.ts`.
- Ran `npm test` (80/80 pass, 0 skipped), `npm run typecheck` (clean), `npm run lint` (clean), `npm audit` (0 vulnerabilities) — all demonstrated, raw output at the bottom of this report.
- Built a proof-of-concept against `src/qa/completeness-claim-checker.ts` in an isolated scratchpad (never touched tracked files) to confirm or deny a suspected command-execution gap — demonstrated, raw output below.
- Grepped the full tree for `agent-governance-sdk` / `agent-governance-claude-code` — confirmed no import (only ADR/doc prose discussing why not to use it).

## Findings

### 1. [ISSUE][HIGH][demonstrated] Arbitrary command execution via QA-15's completeness marker

`src/qa/completeness-claim-checker.ts:76-99` (`verifyMarkerClaim`) parses a `[[completeness: cmd="<shell command>" expect=<N>]]` marker out of file text and calls `runner(cmd, args, ...)` — i.e. execFile()s whatever command string is embedded in the marker, with no allowlist, no validation, no sandboxing. `.github/workflows/ci.yml`'s unconditional "QA-15 completeness-claim-checker" step invokes this with no CLI args, so it defaults (`completeness-claim-checker.ts:152`, `DEFAULT_FILES`) to scanning `docs/STATE.md`, `docs/decisions.md`, `CHANGELOG.md` — three files this project's own CLAUDE.md Definition of Done requires every story to touch ("CHANGELOG entry + docs/STATE.md updated").

**Attack sketch:** a contributor (fork PR or same-repo branch) edits `docs/STATE.md` to include a marker such as `[[completeness: cmd="node ./payload.js" expect=0]]` (payload committed alongside, or `cmd="bash"` with an inline `-c` script arg). CI checks out the PR content and unconditionally runs the QA-15 step against it, executing the attacker's command inside the GitHub Actions runner as a required, always-run CI step — no opt-in, no human gate first.

**Demonstrated** (scratchpad only, no tracked files touched):
```
$ cat fake-STATE2.md
Progress: [[completeness: cmd="node <tmp>/payload.js" expect=0]]
$ cat payload.js
require('fs').writeFileSync(process.env.PROOF, 'RCE-PROOF-pid-' + process.pid);
console.log(0);
$ PROOF=<tmp>/proof.txt node src/qa/completeness-claim-checker.ts fake-STATE2.md
[QA-15 completeness-claim-checker] PASS: 1 file(s) checked, all completeness claims verified.
$ cat <tmp>/proof.txt
RCE-PROOF-pid-14024
```
The checker not only ran the attacker's command, it reported a clean PASS — the gate that is supposed to protect the pipeline is itself the injection point.

**Exposure:** 100% of CI runs (push + PR to master), basis: measured — `.github/workflows/ci.yml`'s QA-15 step has no `if:` guard and no path filter, and `completeness-claim-checker.ts:152`'s `DEFAULT_FILES` (`docs/STATE.md`, `docs/decisions.md`, `CHANGELOG.md`) are files CLAUDE.md's Definition of Done requires touching on every story — so the attacker-reachable surface is the near-totality of future PRs to this repo, not an edge case.

**Blast radius today:** `permissions: contents: read`, no `secrets:` used anywhere in the workflow, and the trigger is `pull_request` (not `pull_request_target`) — so a fork PR gets no elevated token and no repo secrets today. That caps today's damage to CI-runner compute abuse, cache/artifact tampering, and same-job env/output poisoning (a command can write to `$GITHUB_ENV`/`$GITHUB_OUTPUT` to influence later steps in the same job). The moment this repo's CI gains any secret (deploy key, npm publish token, cloud credential) this becomes a full secret-exfiltration path for anyone who can land a push (same-repo branch, no fork restriction applies) or an approved PR touching three files every story already touches.

**Minimal fix:** never execFile a command string sourced from repository prose. Require `cmd=` to name a pre-registered instrument id resolved against a fixed, code-owned allowlist (e.g. exact `package.json` `qa:*`/`oss:*` script names matched by hardcoded string equality, not looked up dynamically from `package.json` either, since that file is also PR-editable) rather than executing arbitrary attacker text.

### 2. [ISSUE][LOW][code-traced] CI actions pinned to floating tags, not commit SHAs

`.github/workflows/ci.yml:16,25,88` — `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` are pinned to major-version tags. A tag can be moved by the action's maintainer (or an attacker who compromises the maintainer's account/token) to point at different code without the pin changing; a commit SHA cannot. All three are first-party `actions/*` (lower historical compromise rate than the third-party-action supply-chain incidents of 2024-2025), and the job has no secrets to steal today (see Finding 1's blast-radius note), so exploitability is low, but this is the standard hardening baseline (GitHub's Actions security hardening guide, StepSecurity, OpenSSF Scorecard's pinned-dependencies check).

**Minimal fix:** pin each `uses:` to a commit SHA with a version comment, e.g. `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`.

### 3. [SUSPICION][LOW][code-traced] reference-resolver path checks are not confined to repoRoot

`src/qa/reference-resolver.ts:236` (`pathExists: (p) => existsSync(resolve(repoRoot, p))`) and `:239` (`lineCount` via `readFileSync(resolve(repoRoot, p), "utf8")`) resolve a citation-shaped backtick path straight from PR-changed-file text with no `..`-segment or containment check. A crafted citation like a backtick path `../../../../etc/hosts:1` in a PR-changed file would cause `existsSync`/`readFileSync` to touch a path outside the repo checkout. Impact is bounded — only existence and line-count are surfaced in the checker's report, never file content, and (as with Finding 1) there's no secret in this job to leverage today — so this is marked a suspicion for a second look rather than a confirmed exploit path, since no case was demonstrated where the disclosed existence/line-count is itself sensitive on a GitHub-hosted runner.

**Minimal fix:** reject or normalize any citation path containing a `..` segment, or verify `resolve(repoRoot, p)` still starts with `repoRoot` before calling `existsSync`/`readFileSync`.

### 4. [CLEAN][code-traced] Secret scanner redaction is sound and regression-tested

`src/secret-scan/patterns.ts`'s `redact()` returns only the first 4 characters of a match plus a length-only suffix (e.g. `AKIA...[REDACTED 20 chars]`). For every pattern in `SECRET_PATTERNS` (`patterns.ts:11-24`) the leading characters of a match are either a fixed, publicly-known prefix (`AKIA`, `xoxb-`, `----`) or the variable-name label itself (`password:`, `secret_access_key=`) — never entropy from the secret's own value. This is genuinely tested, not just asserted: `history-scan.test.ts:12-17` proves `redact()` never contains the input; `:25-31` proves a summarized match's `details` never contain the raw secret; `:115-118` proves a full `JSON.stringify(matches)` of a real planted-then-removed history secret never contains the raw value. The generated report (`docs/qa/history-scan-report.json`) is gitignored (`.gitignore` comment: "Generated ... on every run") and its content, inspected live, contains only `redacted` fields, never raw secret text. Satisfies SE ADR-0009's "MUST NOT log secrets, tokens, passwords."

### 5. [CLEAN][code-traced] Allowlist mechanism is a narrow, still-reported, exact-match gate — not a silent bypass

`docs/qa/secret-scan-allowlist.json` entries are matched by exact `path` + `patternId` (`history-scan.ts:110`, `partitionAllowlisted`), never a glob or prefix — an attacker who could edit this file to hide a real secret would need to know the real secret's exact commit-relative path and pattern id in advance, and even then the match is still emitted in the report as `ALLOWLISTED ...` (`history-scan.ts:119-121`), never dropped — a human or a future stricter gate can still see it. The file itself is not exempted from the checked-file set by anything in this diff, and editing it to add a bogus entry is a normal, diffable PR change reviewable like any other — the same bar CLAUDE.md sets for `.gitleaksignore`. Today's 5 entries are all narrowly-scoped test-fixture exceptions with stated reasons (`docs/qa/secret-scan-allowlist.json:1-27`), consistent with their claimed purpose.

### 6. [CLEAN][code-traced] CI workflow injection/permissions surface is clean

- `permissions: contents: read` only (`ci.yml:13-14`) — no `write`, no `pull-requests`, no `id-token`. Least privilege.
- Trigger is `pull_request` (`ci.yml:8-10`), not `pull_request_target` — fork PRs get no elevated token, no repo secrets (none are used regardless).
- The only shell-interpolated values in any `run:` step are `steps.diff-refs.outputs.base`/`.head` (`ci.yml:63-64,67`), themselves sourced from `github.event.pull_request.base.sha`/`.head.sha`/`github.event.before`/`github.sha` — commit SHAs, not attacker-formattable text (PR title/body/branch name are never interpolated anywhere in this file).
- `npm ci` (not `npm install`) is used, enforcing the lockfile (`ci.yml:35`).
- No `continue-on-error` anywhere — every step is a real, blocking gate (matches the file's own header comment, verified by reading every step).

### 7. [CLEAN][demonstrated] Dependency / supply-chain risk

`npm audit` output: "found 0 vulnerabilities". All 5 new dependencies (`typescript ^5.7.3`, `eslint ^9.19.0`, `@eslint/js ^9.19.0`, `typescript-eslint ^8.22.0`, `@types/node ^22.13.1`) are `devDependencies` only — no runtime/production footprint, they never ship. `package-lock.json` is lockfileVersion 3, and every one of its 110 resolved packages carries an `integrity` hash (count of `"resolved"` entries = count of `"integrity"` entries = 110). Web search for known CVEs against `eslint`/`typescript-eslint` at these version ranges turned up nothing applicable (the one recent supply-chain incident found, `eslint-config-prettier` CVE-2025-54313, is a different, unrelated package not present in this dependency tree).

### 8. [SUSPICION][LOW][derived] SE-0010's "justification paragraph" isn't present per-dependency

SE ADR-0010 literally requires "a justification paragraph in the PR description" for each new third-party dependency. This commit's `CHANGELOG.md` documents the tooling collectively ("ESLint flat config (SE ADR-0010)") rather than as a discrete justification paragraph per package, and there is no PR yet (this is a local, unpushed commit) for the literal PR-description form to exist in. Low security impact — these are standard, necessary, dev-only build tools (compiler, linter) with 0 known CVEs — so this is a process nit to close at PR-open time, not a security blocker. Derived from ADR text plus commit content; no code defect to point at.

### 9. [CLEAN][code-traced] ADR-0021 compliance — no AGT import

Grep for `agent-governance-sdk` / `agent-governance-claude-code` / `@microsoft/agent-governance` across the tree returns matches only in `docs/STATE.md`, `CHANGELOG.md`, `docs/.maat-state.json`, `adr/software-engineering/0017-*.md`, `docs/decisions.md`, `docs/reviews/adr0021-*-checkpoint2-2026-08-30.md`, `adr/software-engineering/0021-*.md`, `REQUIREMENTS.md` — all doc/ADR prose discussing why these packages were evaluated and NOT reused. `package.json`/`package-lock.json` grep for `agent-governance` returns nothing. No AGT import anywhere in `src/**`.

### 10. [CLEAN][code-traced] Library bug fixes are correct and regression-tested

- `src/lib/exec.ts:28-34` strips `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` from the subprocess env before spawning. `src/lib/exec.test.ts:16-21` directly asserts the child process sees `NODE_TEST_CONTEXT` as `unset` when run from inside a `node --test` parent — this test would fail without the fix.
- `src/lib/git.ts:41-51`'s `lsTree` now filters `type !== "blob"`, skipping `160000 commit` gitlink entries. `src/lib/git.test.ts:17-28` directly reproduces the exact shape (`160000 commit def456 adr`) that previously crashed the history scan and asserts it's excluded from the returned map.
- Both regressions are exercised for real in the full suite: `npm test` -> 80/80 pass, 0 skipped (raw output below).

## Raw evidence

```
$ npm test 2>&1 | tail -10
ttests 80
tsuites 0
tpass 80
tfail 0
tcancelled 0
tskipped 0
ttodo 0
tduration_ms 4537.6366

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)

$ npm run lint
> eslint .
(clean, no output)

$ npm audit
found 0 vulnerabilities
```

## Verdict

**REWORK.**

Finding 1 is a demonstrated, HIGH-severity arbitrary-command-execution gadget wired into a required, unconditional CI gate that scans files every story in this project is required to touch. Per PRINCIPLES.md rule 19, a HIGH finding backed by demonstrated evidence forces a non-clean verdict; per rule 21, its exposure is quantified above as effectively 100% of future CI runs. This is a BLOCKER — .github/workflows/ci.yml and src/secret-scan/* are explicitly named sensitive areas in CLAUDE.md, and QA-15 (src/qa/completeness-claim-checker.ts), wired unconditionally into that same pipeline, inherits the same bar.

Everything this task specifically asked to check on the named sensitive areas came back clean: the secret scanner redacts correctly and is genuinely tested (4), the allowlist is a narrow, still-reported, exact-match mechanism with no realistic silent-bypass path (5), the CI workflow's permission/trigger/injection surface is sound (6), the two library bug fixes are correct and regression-tested (10), dependencies are clean and dev-only (7), and there is no AGT import anywhere (9). The one blocking issue is in `src/qa/completeness-claim-checker.ts` — in scope because it is unconditionally wired into the same ci.yml this review was dispatched to check, not because it was named directly in the dispatch brief.

**Failing tests these findings map to** (none exist yet — the "no executable form" case PRINCIPLES rule 19 / "findings become tests" anticipates):
- Finding 1 needs a new regression test in `src/qa/completeness-claim-checker.test.ts` asserting that a `cmd=` value not present in a fixed allowlist is rejected without executing anything, plus the fix itself in `verifyMarkerClaim`.
- Finding 3 (suspicion, not blocking) would map to a new test in `reference-resolver.test.ts` asserting a `..`-segment or out-of-root path citation is rejected/unparseable rather than reaching `existsSync`/`readFileSync`.

open findings = 2 (1 blocking, 3 non-blocking suspicion needing a second look); failing tests named above = 2 — counts match; both have a named executable form, no gap to explain.

## Next action

Fix `src/qa/completeness-claim-checker.ts`'s `verifyMarkerClaim` to resolve `cmd=` against a fixed, code-owned allowlist instead of executing attacker-supplied text, add the regression test above, then re-request this review.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] src/qa/completeness-claim-checker.ts:76-99 + .github/workflows/ci.yml QA-15 step -- attacker-controlled [[completeness: cmd="..." expect=N]] marker in docs/STATE.md/decisions.md/CHANGELOG.md gets execFile'd unconditionally every CI run (demonstrated: crafted marker wrote a proof file via node <payload>.js); fix: resolve cmd= against a fixed allowlist, never execute raw text.
2. [ISSUE][LOW][code-traced] .github/workflows/ci.yml:16,25,88 -- actions/checkout@v4, setup-node@v4, upload-artifact@v4 pinned to floating tags not commit SHAs; no secrets exposed today so low exploitability; fix: pin to SHA with version comment.
3. [SUSPICION][LOW][code-traced] src/qa/reference-resolver.ts:236,239 -- pathExists/lineCount resolve a PR-authored backtick citation path with no ../containment check, letting a crafted citation probe file existence/line-count outside repoRoot; low impact (no content disclosed, no secrets in job); fix: reject/normalize .. or verify containment.
4. [CLEAN][code-traced] src/secret-scan/patterns.ts redact() + history-scan.ts -- redaction genuinely tested to never leak raw secret text in details/report/serialized matches (SE-0009 satisfied).
5. [CLEAN][code-traced] docs/qa/secret-scan-allowlist.json mechanism -- exact path+patternId match, allowlisted hits still reported not dropped, no realistic silent-bypass path.
6. [CLEAN][code-traced] .github/workflows/ci.yml -- least-privilege permissions (contents:read only), pull_request not pull_request_target, no PR title/body/branch interpolated into shell, npm ci used, no continue-on-error.
7. [CLEAN][demonstrated] package.json/package-lock.json -- npm audit 0 vulnerabilities, all 5 new deps are devDependencies only, lockfile fully integrity-pinned (110/110).
8. [SUSPICION][LOW][derived] SE ADR-0010's per-dependency "justification paragraph" not present in discrete form (CHANGELOG documents collectively); low impact, process nit only.
9. [CLEAN][code-traced] No agent-governance-sdk/agent-governance-claude-code import anywhere in package.json/package-lock.json/src/** -- ADR-0021 compliant.
10. [CLEAN][code-traced] src/lib/exec.ts NODE_TEST_CONTEXT strip + src/lib/git.ts gitlink-skip fix -- both have real regression tests that would fail without the fix; full suite 80/80 pass, 0 skipped.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=2 suspicions=2 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=6 derived=1
checks="80/0/0 (npm test) + typecheck clean + lint clean + npm audit 0 vulns|n/a"
adr=HIT(35)
report=docs/reviews/s1-protect-baseline-app-security-2026-08-30.md
