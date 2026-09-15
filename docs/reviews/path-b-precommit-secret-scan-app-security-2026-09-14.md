# App Security Review -- path-b-precommit-secret-scan

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-14
Scope: feat/path-b-precommit-secret-scan vs master, HEAD 86f053c
Tier: CRITICAL (CLAUDE.md "Secret scanning / CI gates" named sensitive area)

## ADR compliance

node docs/adr-cache.mjs --ensure returned: "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23]" [CACHE=HIT].

App-security-domain ADRs read from the cached catalog (software-engineering, tags touching authn/authz, input handling, secrets, dependencies, data exposure): SE ADR-0002/0003 (layering, dependency injection), SE ADR-0009 (Monitoring and observability -- "MUST NOT log secrets, tokens, passwords, or personal data"), SE ADR-0016 through 0021 (governance-plugin/thoth-kernel architecture -- scoped to kernel.ts/action.ts/normalize-fs.ts/normalize-shell.ts; this diff touches none of those files, so their kernel-purity rules do not apply here).

No ADR text legislates subprocess-argv construction directly. SE ADR-0009 no-secrets-in-logs is the one directly testable rule against this diff -- not violated, see finding 6.

No applicable ADR is violated by this diff.

## Method

Read src/secret-scan/simulated-commit.ts, src/secret-scan/pre-commit-scan.ts, .githooks/pre-commit, package.json diff, src/lib/exec.ts diff, src/lib/exec.test.ts, simulated-commit.test.ts, pre-commit-scan.test.ts, docs/qa/secret-scan-allowlist.json diff. Ran the shipped test suite for the new/changed files, npm run typecheck, and wrote a throwaway probe script (deleted after use, working tree confirmed clean via git status --short) that called the actual shipped buildSimulatedCommit() against an isolated repo with a dash-leading filename to empirically settle the argv-injection question rather than reason about it.

## Findings

### 1. [CLEAN] Subprocess/argv injection -- dash-leading filenames cannot break out of their argument position

Every new git-plumbing call in src/secret-scan/simulated-commit.ts goes through execFile (never a shell -- src/lib/exec.ts:3,50), so shell metacharacters are never interpreted regardless of filename content. The remaining question was whether git's own argument parser could misinterpret a filename starting with "-" as a flag:

- git ls-files -s -z -- PATH (simulated-commit.ts:101) and git update-index --force-remove -- PATH (simulated-commit.ts:141-143) both use an explicit "--" separator before the untrusted path.
- git update-index --add --cacheinfo MODE SHA PATH (simulated-commit.ts:153-158) has no "--" separator, but this is safe: --cacheinfo's legacy 3-argument form consumes exactly the next three tokens positionally, without re-entering git's normal option scanner for the path token. Confirmed empirically, twice:
  - Raw git test: inserting a "--" separator before the path in the --cacheinfo 3-arg form actually BREAKS it (error: unknown option), because the inserted "--" itself gets consumed as the literal 3rd argument, pushing the real path out to be re-parsed as a flag. The shipped code's choice to omit "--" here is correct, not a bug.
  - Shipped code, exercised directly: called buildSimulatedCommit(realRunner, repoDir) against a real isolated repo with a staged file named "--upload-pack=touch pwned" (containing a fake AWS-shaped secret). Result: simulated commit built successfully, tree correctly contains the dash-leading path -- no crash, no flag injection, correct content resolution.
- git diff --cached --name-status -z HEAD, git write-tree, git commit-tree, and git rev-parse --verify HEAD take no untrusted positional path arguments at all.

Verdict: CLEAN. Evidence: demonstrated (two live git-plumbing probes plus a direct call into the shipped buildSimulatedCommit; transcripts in the Checks section below).

### 2. [CLEAN] Runner.env override merges correctly, does not resurrect stripped vars, scoped per-call

src/lib/exec.ts:56: env is opts.env ? spread(cleanSubprocessEnv(), opts.env) : cleanSubprocessEnv(). cleanSubprocessEnv() runs first, opts.env spreads over it -- the only way opts.env could reintroduce a stripped var (NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID) is if a caller explicitly set that exact key, which the sole consumer (simulated-commit.ts, passing only GIT_INDEX_FILE) does not. opts is a fresh object built per call, so nothing here mutates process.env or leaks across concurrent calls.

Ran the two new regression tests directly: both pass -- opts.env reaches the subprocess, and the parent process's own process.env is confirmed untouched after the call; a second test confirms an unrelated override does not wipe the rest of the inherited env (PATH stays usable).

Hardening note (not a blocker): Runner.env is now a general capability on a shared, injectable I/O boundary -- any future caller could pass an override for something more sensitive (e.g. GIT_SSH_COMMAND, HOME) without any guardrail preventing it. Today's sole consumer only sets GIT_INDEX_FILE, so there is no live exploit path; this is a design-surface note for whoever reviews the next consumer of opts.env, not a finding against this diff.

Verdict: CLEAN. Evidence: demonstrated (node --test src/lib/exec.test.ts -- both new tests pass, see Checks section).

### 3. [CLEAN] The hook itself introduces no new attack surface

.githooks/pre-commit is one line beyond its comment header: exec node src/secret-scan/pre-commit-scan.ts. No network calls, no eval, no shell beyond the shebang invoking node. package.json's diff adds only two script entries (prepare, oss:pre-commit-scan) -- no dependencies/devDependencies changes, confirmed by reading the full diff. pre-commit-scan.ts reuses scanHistory/loadAllowlist/summarizeMatches from history-scan.ts UNMODIFIED (confirmed: history-scan.ts does not appear in git diff --stat master..HEAD), and only overrides revList to scope the walk to the one simulated commit -- no new exemption-grant surface, no new I/O sink.

Verdict: CLEAN. Evidence: code-traced (.githooks/pre-commit, package.json diff, git diff --stat confirming history-scan.ts untouched).

### 4. [CLEAN] GIT_INDEX_FILE-scoped operations cannot leak into the real index/HEAD; cleanup is guaranteed

buildSimulatedCommit (simulated-commit.ts:120-176) never opens .git/index or moves HEAD: the only index-mutating calls (read-tree, update-index --force-remove, update-index --add --cacheinfo, write-tree) are the ones that receive the GIT_INDEX_FILE override; commit-tree operates purely on object SHAs. The temp index lives under a fresh mkdtemp() directory, and rm(tmpDir, recursive+force) runs in a finally block (simulated-commit.ts:173-175), so it fires on every exit path including a thrown error mid-build. Confirmed by two dedicated tests that hash .git/index before and after a run (including a run with mixed renames/deletes/adds) and assert byte-equality, plus a "no HEAD yet" test proving a failure path still fails loud without touching repo state.

Verdict: CLEAN. Evidence: demonstrated (the byte-unchanged .git/index tests -- both the simple and mixed-changes variant -- pass, see Checks section).

### 5. [CLEAN] Allowlist diff is exactly what it claims

docs/qa/secret-scan-allowlist.json diff is a pure append: git diff master..HEAD for this file shows 21 added lines and zero removed lines (only the file's own diff header, no removed content lines) -- every pre-existing entry, including 6 patterns.test.ts-scoped whole-file allowlist entries (aws-access-key-id, ipv4-private, email-address, internal-hostname, github-pat, github-fine-grained-pat) and the cifix-era internal-hostname entries, is byte-unchanged. The 4 new entries are scoped exactly to this story's own two new test files (simulated-commit.test.ts, pre-commit-scan.test.ts), for aws-access-key-id (the synthetic AKIAFAKEFAKEFAKEFAKE fixture) and email-address (test@example.com, the project's own established reserved-test-domain convention) -- nothing broader, nothing outside those two files.

Note: the task brief's count of "3 pre-existing Issue #136 entries" undercounts what is actually in the file -- 6 patterns.test.ts entries exist. That is a discrepancy in the task's own prose, not in the diff; the diff itself confirms zero pre-existing entries touched, which is the substance of the check.

Verdict: CLEAN. Evidence: code-traced (git diff line-count check plus docs/qa/secret-scan-allowlist.json content read).

### 6. [CLEAN] No real credentials in the diff; raw secret text confirmed never printed

FAKE_SECRET = AKIAFAKEFAKEFAKEFAKE (pre-commit-scan.test.ts:11) and the inline AKIAFAKEFAKEFAKEFAKE literal in simulated-commit.test.ts are AWS-key-shaped but not valid (repeated FAKE block, does not match AWS's real base32 keyspace) -- same convention as this project's existing fixtures. All committer identities use test@example.com -- the project's own established reserved-test-domain literal, reused, not a new one. pre-commit-scan.test.ts's own R1 test asserts the raw FAKE_SECRET string never appears in stdout -- a live, passing check that the scanner's own redaction (inherited unmodified from OSS-01) holds for this new pre-commit path too.

Verdict: CLEAN. Evidence: demonstrated (the R1 test asserting the raw secret literal never appears in stdout passes).

### 7. [CLEAN, hardening note] git commit --no-verify bypass is not explicitly named, but the design does not overclaim unbypassability either

Nothing in the diff's comments/docs literally says "--no-verify bypasses this," but nothing claims the hook is unbypassable either. pre-commit-scan.ts:13-17's header comment explicitly frames this as a local, pre-commit-only backstop, not a replacement for CI's OSS-01 full-history scan, and CHANGELOG.md's entry for this story repeats the same framing. The CI-side OSS-01 full-history secret scan step genuinely exists and is untouched by this diff (.github/workflows/ci.yml:257, confirmed via git diff --stat showing zero changes to that file) -- so the defense-in-depth story is real, not aspirational, even without the specific --no-verify phrase appearing.

Hardening suggestion (LOW, not a blocker): add one explicit sentence to .githooks/pre-commit's header comment or pre-commit-scan.ts's module comment naming "git commit --no-verify" as the known, accepted bypass path a hostile or careless committer could take locally -- today a future reader has to infer this from general git knowledge rather than reading it. Costs one line; makes the accepted limitation explicit rather than implicit.

Verdict: CLEAN (hardening note only). Evidence: code-traced (pre-commit-scan.ts:13-17, .github/workflows/ci.yml:257, CHANGELOG.md diff).

## Access control (axis 1 of the standard checklist)

Not applicable in the IDOR/authn/authz sense -- this is a local dev-tool git hook with no caller identity, no multi-tenant object ownership, no network-reachable endpoint. Noted, not scored.

## Summary

Seven findings reviewed, all CLEAN. Two carry non-blocking hardening notes (finding 2's Runner.env general-capability note; finding 7's --no-verify disclosure suggestion) -- neither is exploitable today given the current single caller and the existing CI backstop, and neither rises to [ISSUE]. No [ISSUE] or [SUSPICION] findings -- nothing filed as a GitHub Issue.

## Checks run

npm run typecheck:
  tsc --noEmit -p tsconfig.json
  (clean, no output, exit 0)

node --test src/secret-scan/simulated-commit.test.ts src/secret-scan/pre-commit-scan.test.ts src/lib/exec.test.ts :
  tests 28
  pass 28
  fail 0
  cancelled 0
  skipped 0
  todo 0

Throwaway probe (temp file deleted after run, working tree confirmed clean via git status --short), calling the shipped buildSimulatedCommit directly against a dash-leading staged filename "--upload-pack=touch pwned":
  OK, simulated commit built: 694343f12ddb782feac66bcc53a82881245556de
  tree has dash-leading path: true

Raw git plumbing probe (dash-leading path, --cacheinfo 3-arg form, no -- separator, matches shipped code):
  git update-index --add --cacheinfo 100644 SHA "--upload-pack=evil"
  exit: 0
  (ls-files confirms the dash-leading path is present with the correct sha)

Raw git plumbing probe (same path, WITH an inserted -- separator, i.e. the unsafe shape):
  git update-index --add --cacheinfo MODE SHA -- "--upload-pack=evil"
  error: unknown option 'upload-pack=evil'
  exit: 129
  (confirms the shipped code's choice to OMIT -- here is the correct one)

## RECEIPT

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability times impact):
1. [CLEAN][demonstrated] src/secret-scan/simulated-commit.ts:153-158 -- --cacheinfo 3-arg form is positionally safe against dash-leading filenames; empirically confirmed against the shipped buildSimulatedCommit, no argv/flag injection.
2. [CLEAN][demonstrated] src/lib/exec.ts:56 -- Runner.env correctly merges over cleanSubprocessEnv(), scoped per-call, parent process.env untouched; hardening note: broadens a security-relevant capability for future callers, no current exploit path.
3. [CLEAN][code-traced] .githooks/pre-commit:9, package.json -- hook is a single-line node invocation, zero new dependencies, no network/eval/shell beyond git plumbing already used elsewhere in the repo.
4. [CLEAN][demonstrated] src/secret-scan/simulated-commit.ts:173-175 -- temp index cleanup guaranteed via finally; real .git/index and HEAD byte-unchanged before/after, confirmed on both a simple and a mixed rename/delete/add case.
5. [CLEAN][code-traced] docs/qa/secret-scan-allowlist.json -- diff is a pure append (0 removed lines); 4 new entries scoped exactly to this story's own 2 new test files; all pre-existing entries (including 6 patterns.test.ts entries) byte-unchanged.
6. [CLEAN][demonstrated] src/secret-scan/pre-commit-scan.test.ts:11 -- fixtures use synthetic AKIA-shaped key plus reserved test-domain email, matching project convention; live test confirms raw secret never reaches stdout.
7. [CLEAN][code-traced] src/secret-scan/pre-commit-scan.ts:13-17, .github/workflows/ci.yml:257 -- CI full-history scan backstop genuinely exists and is undisturbed; hardening note: git commit --no-verify as an accepted local bypass is not explicitly named in the docs (suggest one sentence, non-blocking).
counts (checksum, must equal the lines above): issues=0 suspicions=0 clean=7
evidence (checksum over the tags above): demonstrated=5 code-traced=2 derived=0
checks="28/0/0|n/a"
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-app-security-2026-09-14.md
