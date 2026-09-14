# Red Team (Sutekh) — `path-b-precommit-secret-scan` — ROUND 2 (targeted re-confirm)

- **Date:** 2026-09-14
- **Scope:** `feat/path-b-precommit-secret-scan`, HEAD `a9d68e4` (round-1 HEAD was `86f053c`)
- **Tier:** CRITICAL (CLAUDE.md "Secret scanning / CI gates" sensitive area)
- **Verdict:** **go**
- **Predecessor:** `docs/reviews/path-b-precommit-secret-scan-red-team-2026-09-14.md` (round-1, no-go)
- **ADR cache:** `HIT` — 35 ADRs reused (`adr/devops:12`, `adr/software-engineering:23`), fp `83b2e3e`, ~17300 tokens saved. Attack-surface slice unchanged from round 1: devops ADR-0008 (CI/CD gates & policy-as-code), devops ADR-0009 (secrets in IaC), SE ADR-0003 (inject I/O), SE ADR-0004 (idempotency), SE ADR-0006 (blast radius).

> Literal discipline in this report: every AWS-key-shaped fixture value below is written with a
> deliberate break (`AKIA` + `-` + suffix) so this file does NOT itself require a new
> `aws-access-key-id` allowlist grant. See finding N1 for why that matters.

## Praise first

Both round-1 blockers are genuinely, verifiably fixed — not claimed fixed. I re-ran my own exact attack shapes against fresh isolated fixtures with a real installed hook, and both now behave correctly. More importantly, I **mutation-tested every new regression test**: reverting each fix in a throwaway clone turns exactly the matching test red. These are real tests, not green-by-construction assertions. The `#188` fix in particular is better than the minimum — one bulk `git ls-files -s -z` into a `Map` removes the whole glob-interpretation class rather than patching one symptom, and it made `#189`'s two-pass ordering fall out cleanly.

Nine fresh attacks on the rewritten git-plumbing logic all SURVIVED, including three I expected to break it.

## Scorecard

| # | Attack | Verdict | Severity | Evidence |
|---|---|---|---|---|
| R1 | #187 — hook committed non-executable (round-1 HIGH) | SURVIVES (fixed) | — | demonstrated |
| R2 | #188 — glob-pathspec wrong-blob secret leak (round-1 HIGH) | SURVIVES (fixed) | — | demonstrated |
| R3 | #189 — dir<->file swap `update-index` fatal (round-1 MED) | SURVIVES (fixed) | — | demonstrated |
| R4 | #190 — raw stack trace, no named unlock (round-1 MED) | SURVIVES (fixed, one residual) | — | demonstrated |
| R5 | #191 — `prepare` hard-fails outside `.git` (round-1 MED) | PARTIAL | LOW | demonstrated |
| R6 | #192 — `--no-verify` disclosure (round-1 MED) | SURVIVES (fixed) | — | code-traced |
| R7 | round-1 finding 8 — `core.hooksPath` clobber warning (LOW) | SURVIVES (fixed) | — | demonstrated |
| R8 | round-1 finding 7 — `GIT_INDEX_FILE` passthrough pinned (SUSPICION) | SURVIVES (settled) | — | demonstrated |
| R9 | round-1 finding 9 — SIGINT temp-dir leak (LOW) | UNPROVEN (disclosed only, accepted) | LOW | code-traced |
| N1 | Allowlist now self-grants `aws-access-key-id` on its own file — real key commits clean | BREAKS | MED | demonstrated |
| N2 | Every commit costs ~12.5-13.0 s + 264 output lines; "fast enough" claim unmeasured | BREAKS | MED | demonstrated |
| N3 | `installGitHooks` uses `existsSync(.git)`, silently skips install in a real checkout | BREAKS | LOW | demonstrated |
| N4 | #187 POSIX end-to-end (exec bit actually honored on Linux/macOS) | UNPROVEN-pending-verification | LOW | demonstrated (blocked: no POSIX runtime) |
| N5 | NEW — deletion path with glob magic: does `--force-remove` glob? | SURVIVES | — | demonstrated |
| N6 | NEW — `D <p>` / `A <p>` same-path collision after two-pass reorder | SURVIVES | — | demonstrated |
| N7 | NEW — intent-to-add (`git add -N`) empty-blob false negative | SURVIVES | — | demonstrated |
| N8 | NEW — unmerged index (multi-stage `ls-files -s`) breaks the Map | SURVIVES | — | demonstrated |
| N9 | NEW — tab in filename splits the `indexOf` parse | SURVIVES | — | code-traced |
| N10 | NEW — `node` absent from PATH: fails open? | SURVIVES (fails CLOSED) | — | demonstrated |
| N11 | NEW — mutation-sensitivity of all 4 new regression tests | SURVIVES | — | demonstrated |
| N12 | NEW — TOCTOU between `diff --cached` and the bulk `ls-files` read | SURVIVES | — | demonstrated |

---

## Part 1 — round-1 findings, re-verified against the code

### R1. #187 [was HIGH] — FIXED

```
$ git ls-files -s .githooks/pre-commit
100755 4ae8431a75c3d7338cc42cf47205b5d39fa0bcb3 0	.githooks/pre-commit
```

Real fresh-clone install drill (not just the mode bit), full path:
```
$ git clone --local /c/playground/thoth repo && cd repo
$ git ls-files -s .githooks/pre-commit
100755 4ae8431a75c3d7338cc42cf47205b5d39fa0bcb3 0	.githooks/pre-commit     <- mode survives the clone
$ git config --get core.hooksPath
(unset)
$ node src/lib/git-hooks-install.ts
[prepare] git hooks installed (core.hooksPath = .githooks).
PREPARE EXIT=0
$ git config --get core.hooksPath
.githooks
$ printf 'const k = "AKIA-FAKEFAKEFAKEFAKE";\n' > leak-probe.js && git add leak-probe.js
$ git commit -m "fresh clone: try to land a secret"
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (263 allowlisted, not counted).
  - 30e59ac76cb7 leak-probe.js [aws-access-key-id] AWS access key id: AKIA...[REDACTED 20 chars]
CLONE-COMMIT EXIT=1
$ git log --oneline -1
a9d68e4 chore(qa): ...          <- nothing landed
```

Mutation test — the regression test is real:
```
$ git update-index --chmod=-x .githooks/pre-commit
$ git ls-files -s .githooks/pre-commit
100644 4ae8431a75c3d7338cc42cf47205b5d39fa0bcb3 0	.githooks/pre-commit
$ node --test src/secret-scan/pre-commit-scan.test.ts
X R187 (GitHub Issue #187, red-team [HIGH], regression): .githooks/pre-commit is committed with the executable bit set ...
```

**Residual (N4):** the POSIX half — that git on Linux/macOS actually honors the restored exec bit — I still could not execute. `docker info` fails (daemon down), and the only WSL distro present is `docker-desktop`, which reports `Linux` but has neither git nor node (`NOGIT`, `NONODE`). This is `UNPROVEN-pending-verification`, not a finding against the fix: the mechanism is vendor-documented (`githooks(5)`: *"Hooks that don't have the executable bit set are ignored"*), the mode bit is now correct and mutation-pinned. Settling command, for anyone with a Linux box or a running Docker daemon:
```
docker run --rm -v "$PWD:/src:ro" alpine/git sh -c 'cd /tmp && git clone -q /src r && cd r && \
  git config core.hooksPath .githooks && git config user.email t@<example>.com && git config user.name T && \
  printf "k=\"AKIA<FAKE x16>\"\n" > c.js && git add c.js && git commit -m x; git log --oneline -1'
```

### R2. #188 [was HIGH] — FIXED

My own exact attack, rebuilt from scratch in an isolated fixture with a real installed hook:
```
$ git status --porcelain
A  k5.js
A  k[0-9].js
$ git commit -m "smuggle a secret past the Path B hook"
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (0 allowlisted, not counted).
  - b74010b00c58 k[0-9].js [aws-access-key-id] AWS access key id: AKIA...[REDACTED 20 chars]
COMMIT EXIT=1
$ git log --oneline
77883fa init          <- the secret did NOT land
```
It names the correct path (`k[0-9].js`), so it is resolving the right blob, not coincidentally catching the sibling.

Code trace of the fix: `src/secret-scan/simulated-commit.ts:134-152` — one unfiltered `git ls-files -s -z` (no `--`, no pathspec at all), parsed into `Map<path, {mode, sha}>`; `:199-206` looks each staged path up by exact key, and a miss throws rather than guessing. There is no surface left for pathspec magic to act on.

Mutation test:
```
# reverted resolveAllStagedBlobs to the per-path `ls-files -s -z -- <path>` + .find() shape
$ node --test src/secret-scan/simulated-commit.test.ts
X buildSimulatedCommit (GitHub Issue #188, red-team [HIGH], regression): a staged path containing
  pathspec glob magic resolves its OWN blob, not a lexicographically-earlier sibling's ...
```

### R3. #189 [was MED] — FIXED, both directions

```
### dir -> file collapse
--- name-status ---
A	a
D	a/b
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) ... a [aws-access-key-id]
SCAN EXIT=1                       <- builds a tree, catches the secret; no update-index fatal

--- same fixture, clean content, through the real installed hook ---
[Path B pre-commit-scan] PASS: ...
COMMIT EXIT=0
62571dc dir->file swap            <- the commit git itself accepts now goes through
cbc3c3c init

### file -> dir (reverse)
--- name-status ---
D	a
A	a/b
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) ... a/b [aws-access-key-id]
SCAN EXIT=1
```

Mutation test (re-interleaved to reported order):
```
X buildSimulatedCommit (GitHub Issue #189, red-team [MED], regression): a staged directory->file
  replacement builds a tree, not an `update-index` fatal ...
```

### R4. #190 [was MED] — FIXED (presentation), one residual

```
$ node src/secret-scan/pre-commit-scan.ts       # fresh `git init`, no HEAD
[Path B pre-commit-scan] BLOCKED: an internal error prevented the scan from completing, so the
commit is refused rather than silently allowed. simulated-commit: could not resolve HEAD (git
rev-parse --verify HEAD failed (exit 128): fatal: Needed a single revision). This repo has no
commits yet — the pre-commit secret scan requires an existing HEAD to build a simulated commit against.
SCAN EXIT=1
```
Single named line, no stack trace, exit code still non-zero — fail-closed direction held. `pre-commit-scan.ts:59-70`.

**Residual [LOW]:** PRINCIPLES rule 2 asks a block to name its *unlock*, not just its *cause*. The message names the cause ("no commits yet") but tells the developer nothing about how to proceed. Round-1's finding 4 named two proof-tests; the second (`an empty repo scans the staged tree against the empty tree 4b825dc... instead of throwing`) was not built, so a brand-new repo with this hook installed still cannot make its first commit at all. Observed live during this very pass: my first fixture's `git commit -qm init` was itself refused for this reason. Exposure in this repo is genuinely 0 (HEAD always exists), and the disclosed non-goal at `simulated-commit.ts:31-32` covers it honestly. One added clause — "for a repo's first-ever commit, use `git commit --no-verify` once" — closes it.

### R5. #191 [was MED] — PARTIAL (now a LOW finding)

The `.git`-absent case is genuinely fixed:
```
### full source tree, NO .git (vendored-source / tarball build)
> thoth@0.1.0 prepare
> node src/lib/git-hooks-install.ts
[prepare] no .git directory found -- skipping git hook install (not a git checkout).
added 110 packages, and audited 111 packages in 2s
NPM-CI-A EXIT=0
```
But the *specific scenario the fix's own comment names* still hard-fails:
```
### package.json + package-lock.json ONLY — the Docker `COPY package*.json . && npm ci` layer
Error: Cannot find module '...\atk191b\src\lib\git-hooks-install.ts'
  code: 'MODULE_NOT_FOUND'
npm error code 1
npm error command failed
npm error command ... node src/lib/git-hooks-install.ts
NPM-CI-B EXIT=1
```
Against `src/lib/git-hooks-install.ts:5-10`, which claims it is *"Now guarded"* against exactly *"a future Docker `COPY package*.json . && npm ci` layer"*, and `CHANGELOG.md`'s round-1 entry: *"a future Docker `COPY`-only layer, a tarball install ... is now a quiet no-op (exit 0), not a hard failure."* Both statements are demonstrably false for that shape. The failure simply moved from git's exit 128 to node's `MODULE_NOT_FOUND`.

Downgraded to **LOW**, honestly: exposure is still 0 of 2 current `npm ci` call sites (counted-in-code; no Dockerfile in this repo, both CI `npm ci` steps run after `actions/checkout`), the failure is LOUD and immediate, and the residual property ("`npm ci` needs the package's own `src/` present to run `prepare`") is ordinary for any Node project with a local `prepare` script — much weaker than round-1's "hard dependency on git + a trusted git repo," which IS fixed. What remains is a false claim in shipped source about a security control's install path. Fix: `"prepare": "node src/lib/git-hooks-install.ts || exit 0"`, or correct the two comments to say what is actually guarded.

### R6. #192 [was MED] — FIXED

`--no-verify` is now disclosed in all three places round-1 asked for, and framed correctly:
- `CHANGELOG.md:35` — *"Known, disclosed limitation ... not an unbypassable control"*, naming CI's OSS-01 scan as the real backstop.
- `src/secret-scan/simulated-commit.ts:36-40` — added to the non-goals block.
- `.githooks/pre-commit:11-15` — *"This is a defense-in-depth, LOCAL, pre-commit-only backstop -- not an unbypassable control."*
- `docs/STATE.md:39` — same.

The overclaim is gone. `grep -rn "no-verify"` now returns hits in exactly the artifacts that previously had none.

### R7. round-1 finding 8 [was LOW] — FIXED

```
$ git config core.hooksPath ".pre-existing-husky"
$ node src/lib/git-hooks-install.ts
[prepare] WARNING: core.hooksPath was already set to ".pre-existing-husky" -- overwriting it with
".githooks". If that was a different hook manager (husky, a manually installed hook, ...), it is now
inactive. Restore it with: git config core.hooksPath ".pre-existing-husky"
[prepare] git hooks installed (core.hooksPath = .githooks).
PREPARE EXIT=0
```
Names the prior value and the exact restore command — rule 2 satisfied. `git-hooks-install.ts:34-39, 60-67`.

### R8. round-1 finding 7 [was SUSPICION/MED] — SETTLED

Documented at both the point of mechanism (`src/lib/exec.ts:30-40`, marked `LOAD-BEARING`) and the point of reliance (`simulated-commit.ts:17-28`), and — the part that actually matters — pinned by a mutation-sensitive test:
```
# mutant: added `for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];`
#         to cleanSubprocessEnv()
$ node --test src/secret-scan/pre-commit-scan.test.ts
X R7 (red-team [SUSPICION->settled], regression): `git commit -am` with a secret in a tracked,
  unstaged file is refused ...
```
The exact silent-regression path I feared now has a test standing in front of it.

### R9. round-1 finding 9 [was LOW] — disclosed only, accepted

`simulated-commit.ts:48-52` now states the SIGINT case plainly, and `:41-47` corrects the round-1 inaccuracy about blocked-commit tree/commit objects. No orphans on this box right now (`ls $TMP | grep -c thoth-precommit-index- -> 0`). Fine as a residual; the drill remains unexecuted and that is an honest, disclosed choice.

---

## Part 2 — NEW findings, ranked by blast radius

### N1. [MED][demonstrated] The allowlist now grants itself a blanket `aws-access-key-id` exemption — a real AWS key pasted into `secret-scan-allowlist.json` commits clean, and CI is blind to it too

**Scenario.** Someone writes an incident or rotation note into an allowlist entry's `reason` field — "the leaked key was AKIA... , rotated 2026-09-14" — the single most natural place in this repo to write prose *about* secrets. The pre-commit hook prints PASS. CI's OSS-01 full-history scan reads the same allowlist and also prints PASS. The key is in git history permanently, with both layers green.

**Code trace.** Commit `a9d68e4` added to `docs/qa/secret-scan-allowlist.json`:
```json
{ "path": "docs/qa/secret-scan-allowlist.json", "patternId": "aws-access-key-id",
  "reason": "self-referential: this file's own reason fields ... quote the AKIA...FAKE fixture literal ..." }
```
`history-scan.ts:97-113` — a grant is `{path, patternId}` only. There is no `value` / literal field in `AllowlistEntry`:
```ts
const hit = allowlist.some((e) => e.path === m.path && e.patternId === m.patternId);
```
So this entry exempts **every** AWS-key-shaped string in that file, forever — not just the fixture literal it was written to cover.

**Evidence — end-to-end, real hook, fresh clone:**
```
# a DISTINCT key-shaped literal (not the story's fixture) in an allowlist reason field
$ git add docs/qa/secret-scan-allowlist.json
$ git commit -m "incident note in the allowlist"
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (264 allowlisted).
$ git log --oneline -1
522345d incident note in the allowlist
$ git show HEAD:docs/qa/secret-scan-allowlist.json | grep -o "AKIA-Q7ZP4RX2VLMN8TWD"
AKIA-Q7ZP4RX2VLMN8TWD                                <- landed in history

# control: the identical literal in an ordinary file
$ printf 'k = "AKIA-Q7ZP4RX2VLMN8TWD"' > control.js && git add control.js && git commit -m control
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found ... control.js [aws-access-key-id]
CONTROL EXIT=1
```
(The literal is written broken in this report; it was contiguous in the fixture.)

**Current defense, honestly assessed.** The grant mechanism (`{path, patternId}`, no value scoping) is pre-existing OSS-01 design, untouched and not a finding here. What is new in this round is applying it to `aws-access-key-id` — the highest-severity pattern — on the allowlist file **itself**, which is the one file in this repo that grows continuously and whose whole purpose is prose about secret-shaped strings. Prior self-referential grants existed only for `internal-hostname` and `email-address`. Round-1's R2 "zero new exemption surface" CLEAN no longer holds for round 2.

**Exposure: 1 of 311 tracked files, blind to the highest-severity pattern in BOTH the pre-commit hook and CI's full-history scan, basis: counted-in-code.** Security-class, so PRINCIPLES rule 21's narrow-exposure cap does not defuse it. Rated MED not HIGH because arming it requires a human or agent to write a real key into that specific file — a narrower trigger than #188's, which armed on any Next.js-style filename with zero intent. The failure, once armed, is silent and irreversible.

**Proof-test required:** `secret-scan-allowlist: no entry grants aws-access-key-id on docs/qa/secret-scan-allowlist.json itself` — a one-assertion guard test over the allowlist JSON.

**Fix (no schema change):** rewrite the four `reason` fields so they do not contain a contiguous AWS-key-shaped run, then delete the self-referential `aws-access-key-id` entry. The same discipline this report uses. If value-scoped grants are wanted more broadly, that is a separate backlog item against `AllowlistEntry`, not this story.

### N2. [MED][demonstrated] Every commit now costs ~12.5-13.0 s and prints 264 lines — and the shipped "fast enough" claim was never measured

**Scenario.** The hook is installed repo-wide. Every `git commit` — including a one-line docs fix — blocks the developer's terminal for about 13 seconds and then scrolls 263 lines of `ALLOWLISTED` noise past them. The predictable human response is a habitual `git commit --no-verify` alias, or `git config --unset core.hooksPath`, at which point the control this story exists to install is gone. That is a slower, quieter version of the same failure round-1's #187 described.

**Evidence — warm, real repo, 3 consecutive runs:**
```
run 1: exit=0 elapsed_ms=13044 output_lines=264
run 2: exit=0 elapsed_ms=13029 output_lines=264
run 3: exit=0 elapsed_ms=12547 output_lines=264

$ head -1 t1.txt
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (263 allowlisted).
$ git ls-files | wc -l
310
```
And end-to-end through a real `git commit` in a fresh clone (clean, one-file change):
```
CLEAN COMMIT EXIT=0  elapsed_ms=11694
lines of hook output on a CLEAN commit: 267
```

**Where it goes.** `src/secret-scan/history-scan.ts:80-81` — one serial `await git.catFileBlob(sha)` per tracked path, i.e. ~310 sequential `git cat-file` subprocess spawns per commit. Ironically the same O(N)-subprocess shape the `#188` fix just removed from `resolveStagedBlob`; it survives in the scan path, which is where the real cost is. Cost scales with **tree size**, so a 5,000-file repo is roughly 3 minutes per commit.

**Current defense.** None, and the module header at `pre-commit-scan.ts:13-17` asserts the opposite without a number: *"proportional to tree size, not full history length, so this stays fast enough to run on every real `git commit`."* PRINCIPLES rule 18 — a design claim resting on an unsourced figure. The figure is now sourced: ~13 s at 310 files.

**Exposure: 100% of commits made by any developer with the hook installed, ~12.5-13.0 s and 264 output lines each, basis: measured.** Not security-class directly; the risk is second-order (bypass-by-attrition) and the failure is loud, not silent — which is why this is MED, not HIGH.

**Proof-test required:** `pre-commit-scan: a clean commit on this repo's own tree completes within a stated budget` — an explicit latency-budget test in the shape this project already uses for `qa:gate-latency-budget`.

**Fix options, cheapest first:** (a) print allowlisted details only on FAIL, or behind a `--verbose` flag — kills 263 of 264 lines at zero risk; (b) a single `git cat-file --batch` stream instead of N spawns; (c) both. None of this needs a design round.

### N3. [LOW][demonstrated] `installGitHooks` probes the filesystem, not git — so it silently skips installing the security hook inside a real git checkout

**Scenario.** Any invocation whose cwd is not the repo root — a monorepo package, a nested workspace, `npm ci` run from a subdirectory. The guard is `existsSync(join(repoRoot, ".git"))` (`git-hooks-install.ts:30`), so it reports "not a git checkout" and skips, exit 0.

**Evidence.**
```
$ cd <real clone>/packages/sub && node ../../src/lib/git-hooks-install.ts
[prepare] no .git directory found -- skipping git hook install (not a git checkout).
PREPARE EXIT=0
$ git rev-parse --git-dir
.../clone187/repo/.git                              <- it IS a git checkout
```

**Current defense.** None. Exposure for this repo is genuinely 0 (`package.json` sits at the repo root; counted-in-code, 1 package.json). Rated LOW on that basis. Recorded because the failure mode — a security control silently not installed, with a message asserting something false — is the exact class `#187` was.

**Fix:** use `git rev-parse --git-dir` (exit code) instead of `existsSync`. One line, and it also covers worktrees and submodule `.git`-as-a-file.

---

## SURVIVES — fresh attacks on the rewritten plumbing, honestly

I attacked the bulk-`ls-files` rewrite and the two-pass reorder as new code, not as a patch. Nine attacks, all held.

**N5. Deletion path with glob magic — SURVIVES.** The `#188` fix only touched the *addition* side; deletions still pass the path to `git update-index --force-remove -- <path>`. I expected the same bug there. It is not:
```
$ GIT_INDEX_FILE=tmp git update-index --force-remove -- 'k[0-9].js'
$ GIT_INDEX_FILE=tmp git ls-files -s
100644 ... k5.js
100644 ... k7.js                     <- only the literal 'k[0-9].js' was removed; siblings untouched
$ GIT_INDEX_FILE=tmp2 git update-index --force-remove -- 'k?.js'
Ignoring path k?.js                  <- literal, matched nothing; no glob expansion
```
`update-index`'s file arguments are literal paths, not pathspecs. Clean by git's own semantics.

**N6. `D <p>` then `A <p>` on the same path after the reorder — SURVIVES.** The two-pass ordering is only safe if git never emits both a deletion and an addition for the same path in one `name-status`. I tried three shapes to force it — a rename swap, a chained rename, and a delete-plus-rename-into-the-hole. Git collapses every one of them into `M`/`D`/`A` records with no path appearing twice:
```
### rename swap a<->b
M	a.txt
M	b.txt
### chained rename
M	y.txt
R088	x.txt	z.txt         -> scan: FAIL, secret in y.txt correctly caught
### delete b + move a into b
D	a.txt
M	b.txt
A	c.txt                 -> scan: FAIL, secret in b.txt correctly caught
```
The reorder is order-independent for every shape git can actually produce, and it strictly improves on the old code (which would have applied a synthetic `A p` before a synthetic `D p` and silently dropped `p` from the scanned tree — a false negative, had git ever produced that pair).

**N7. Intent-to-add (`git add -N`) — SURVIVES.** I expected a clean false negative here: `git add -N` puts the *empty* blob in the index, and `git diff --cached --name-status HEAD` reports nothing at all, so the simulated tree would never see the content. Git closes the hole itself:
```
$ git add -N ita.js && git commit -m "ita plain"
no changes added to commit (use "git add" and/or "git commit -a")
EXIT=1                                              <- git refuses before the hook matters
$ git commit -am "ita dash-a"
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) ... ita.js [aws-access-key-id]
EXIT=1                                              <- -a stages the real blob; caught
$ git log --oneline
13c6326 init                                        <- nothing landed either way
```

**N8. Unmerged index (multi-stage `ls-files -s`) — SURVIVES.** The new `map.set(path, ...)` last-wins would pick stage 3 where the old `.find()` picked stage 1. Both would be arbitrary — except the path is unreachable through `git commit`, and last-wins happens to be the fail-safe choice:
```
$ git ls-files -s                     # conflicted
100644 df967b96... 1	f.js
100644 e8a99e07... 2	f.js
100644 4dacb59a... 3	f.js
$ git diff --cached --name-status HEAD
U	f.js
$ git commit -m "commit while conflicted"
fatal: Exiting because of an unresolved conflict.
COMMIT EXIT=128                       <- git refuses BEFORE running any hook
$ node src/secret-scan/pre-commit-scan.ts    # run directly, anyway
FAIL: ... f.js [aws-access-key-id]    <- last-wins = stage 3 = the secret side; caught
# and the resolved merge commit:
MERGE COMMIT EXIT=1                   <- correctly blocked
```
Matches the disclosed non-goal at `simulated-commit.ts:33-35`, and the disclosure is accurate.

**N9. Tab in a filename — SURVIVES (code-traced).** `simulated-commit.ts:142` uses the *first* tab index. `git ls-files -s -z`'s metadata prefix (`<mode> <sha> <stage>`) is space-separated and contains no tab, so the first tab is always the separator and everything after it is the path verbatim, tabs included. `-z` also suppresses `core.quotepath` quoting. Safe by construction. (I could not create a tab-named file to demonstrate it — NTFS rejects it: `fatal: pathspec 'ta<TAB>b.js' did not match any files`.)

**N10. `node` absent from PATH — SURVIVES, and fails CLOSED.** `.githooks/pre-commit:8-9` claims the hook *"silently no-ops if `node` is not on the invoking shell's PATH."* That is wrong, in the safe direction:
```
$ PATH="/mingw64/bin:/usr/bin:/bin" git commit -m "commit with node absent from PATH"
.../hooks/pre-commit: line 2: exec: node: not found
EXIT=1
$ git log --oneline
43d04a0 init                          <- commit refused, nothing landed
```
`exec` failure exits 127 from the hook, git treats any non-zero as a refusal. The control is stronger than its own comment says. Editorial correction below.

**N11. Regression-test quality (mutation-tested) — SURVIVES, and this is the strongest evidence in the report.** I reverted each of the four fixes in a throwaway clone and confirmed exactly the matching test turns red, and nothing else did: `#188` (per-path glob lookup restored), `#189` (single-pass reported order restored), `#187` (`--chmod=-x` on the tracked mode), finding 7 (`GIT_*` stripped from `cleanSubprocessEnv`). Green-by-construction tests would have stayed green through all four. These did not.

**N12. TOCTOU between the two index reads — SURVIVES.** The rewrite now reads the index twice (`diff --cached --name-status`, then the bulk `ls-files -s -z`) with a ~13 s window between the scan starting and finishing. But `git commit` holds `.git/index.lock` for the whole hook's lifetime (and for `-a`, that lock file *is* the temp index git points the hook at), so no concurrent `git add` can mutate the index underneath it. And if a path somehow appeared in `name-status` but not in the map, `simulated-commit.ts:202-206` throws `refusing to guess its content` — fail-closed, not fail-open. Round-1's temp-index isolation finding (`mkdtemp` per run) is unchanged by the rewrite.

---

## Raw checks

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog
  - ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

$ npm test
tests 822
pass 822
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 35454.2878

$ git ls-files -s .githooks/pre-commit
100755 4ae8431a75c3d7338cc42cf47205b5d39fa0bcb3 0	.githooks/pre-commit

$ grep -c '^test(' src/secret-scan/simulated-commit.test.ts  -> 17
$ grep -c '^test(' src/secret-scan/pre-commit-scan.test.ts   -> 12
$ grep -c '^test(' src/lib/git-hooks-install.test.ts         -> 6
   (CHANGELOG's round-1 counts 17/12/6 verify — the round-1 editorial miscount is corrected in place, honestly)

MUTATION RUNS (throwaway clone, 4 mutants, each reverted after):
  mutant #188 per-path glob lookup   -> 1 failing test  (the #188 regression test)
  mutant #189 single-pass order      -> 1 failing test  (the #189 regression test)
  mutant #187 --chmod=-x             -> 1 failing test  (the R187 regression test)
  mutant GIT_* stripped from env     -> 1 failing test  (the R7 regression test)

LATENCY (warm, real repo, 310 tracked files):
  run 1: exit=0 elapsed_ms=13044 output_lines=264
  run 2: exit=0 elapsed_ms=13029 output_lines=264
  run 3: exit=0 elapsed_ms=12547 output_lines=264
  end-to-end `git commit` in a fresh clone: exit=0 elapsed_ms=11694, 267 lines

POSIX runtime probe (for the #187 e2e drill):
  $ docker info -> failed to connect ... dockerDesktopLinuxEngine (daemon down)
  $ wsl -d docker-desktop -e sh -c 'uname -s; command -v git; command -v node'
    Linux / NOGIT / NONODE
  -> #187's POSIX half stays UNPROVEN-pending-verification; command to settle it is in R1.
```

Adversarial fixtures built and run this pass (13): glob-magic pathspec end-to-end through a real installed hook; glob-magic on the *deletion* side (`--force-remove` literality probe); dir->file and file->dir swaps; rename swap; chained rename; delete+rename-into-hole; intent-to-add (plain and `-a`); unmerged/conflicted index + resolved merge commit; tab-in-filename (creation refused by NTFS); `node`-absent-from-PATH; fresh `git clone --local` + `prepare` + planted secret; `npm ci` with full source and no `.git`; `npm ci` with package.json only; `core.hooksPath` clobber; self-granting allowlist leak + control; 4 source mutants.

## Open findings -> failing tests

3 open findings (2 BREAKS-MED + 1 BREAKS-LOW) + 2 LOW residuals + 2 UNPROVEN -> 5 named test cases + 2 drills:

| # | Named test / drill |
|---|---|
| N1 | `secret-scan-allowlist: no entry grants aws-access-key-id on docs/qa/secret-scan-allowlist.json itself` |
| N2 | `pre-commit-scan: a clean commit on this repo's own tree completes within a stated latency budget` |
| N3 | `installGitHooks: a subdirectory of a real git checkout still installs the hook` |
| R4-residual | `pre-commit-scan: the BLOCKED message for a repo with no HEAD names the unlock, not only the cause` |
| R5-residual | `package.json: prepare never fails an install when only package.json is present` |
| N4 | (drill) POSIX fresh-clone exec-bit e2e — command given in R1; no unit-test form on this platform |
| R9 | (drill) SIGINT-during-commit temp-dir residue — unchanged from round 1, disclosed residual |

Five have an executable form. N4 and R9 are drills, not tests, and stay residual-register lines.

## Editorial (verdict-neutral, plain edits, no re-review)

- `.githooks/pre-commit:8-9` — *"it silently no-ops if `node` is not on the invoking shell's PATH"* is false. `exec node ...` exits 127 when node is missing and git refuses the commit (demonstrated, N10). The control is stronger than the comment claims; the sentence should say "fails closed."
- `src/lib/git-hooks-install.ts:5-10` and `CHANGELOG.md`'s `#191` bullet — both name a Docker `COPY package*.json . && npm ci` layer as now-guarded. It is not (R5). Say what is actually guarded: a checkout with the full source tree but no `.git`.
- `src/secret-scan/pre-commit-scan.ts:13-17` — *"fast enough to run on every real `git commit`"* is now a measured ~13 s at 310 files. State the number and the scaling, or drop the claim (PRINCIPLES rule 18).
- `history-scan.ts`'s summary string prints *"Full history scanned"* even when the scan is scoped to a single simulated commit's tree. Misleading in the pre-commit context; pre-existing wording in reused code, worth parameterising.
- `git-hooks-install.ts:57` — *"not a git checkout"* is asserted, not tested (N3). The message is wrong whenever cwd is below the repo root.

---

## Scariest unproven assumption

**That the allowlist can be trusted to describe secrets without containing them.** Round 1's blockers were about the gate not running or reading the wrong bytes; those are fixed and pinned. The residue is subtler and self-inflicted by the fix round: the exemption registry — the single mechanism that decides what this project is allowed to ignore — now exempts *itself* from the highest-severity pattern, in both the local hook and CI. Every future allowlist entry's prose lives inside that blind spot, and it grows by a few entries every story. Nothing warns anyone when a real key crosses into it.

## Verdict: go

Both round-1 HIGHs are fixed and each is pinned by a test I proved goes red when the fix is reverted. All four MEDs are addressed, two of them completely; the two residuals are LOW, loud, and zero-exposure today. Nine fresh attacks on the rewritten git plumbing — including three I expected to break it — all held, and the rewrite is a genuine structural improvement over a targeted patch. There is no HIGH finding in this round, so nothing here forces a no-go.

N1 and N2 are real and should be fixed, but neither defeats the control's core property and both are cheap. My recommendation to the Manager: fix N1 the same turn (it is a four-`reason`-field edit plus one guard test, and it is security-class), treat N2's output-volume half as fix-now (one conditional) and its latency half as a measured backlog item, and carry N3 plus the two LOW residuals as residual-register lines.

## Single next action

Rewrite the four `reason` fields in `docs/qa/secret-scan-allowlist.json` so none contains a contiguous AWS-key-shaped run, delete the self-referential `aws-access-key-id` grant on that file, and add the one-assertion guard test — the same fix removes the blind spot from both the pre-commit hook and CI in one edit.

---

## Addendum (same session, appended per PRINCIPLES rule 11 — original evidence unaltered)

Staging this report against the gate it reviews caught two literals I had not broken (the settling `docker run` command in R1):
```
$ git add docs/reviews/path-b-precommit-secret-scan-red-team-round2-2026-09-14.md
$ node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] FAIL: 2 secret-shaped match(es) found in history (263 allowlisted, not counted).
  - 14d5af8d378e ...red-team-round2-2026-09-14.md [aws-access-key-id] AWS access key id: AKIA...[REDACTED 20 chars]
  - 14d5af8d378e ...red-team-round2-2026-09-14.md [email-address] an email address: t@e....[REDACTED 7 chars]
SCAN EXIT=1
```
Resolved by breaking both literals in place (`AKIA<FAKE x16>`, `t@<example>.com`), **not** by adding allowlist entries — demonstrating that finding N1's recommended fix is viable in practice and that this review round adds zero new exemption surface. The gate working on its own reviewer is a point in its favour, and is recorded here rather than quietly fixed.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Allowlist self-grants `aws-access-key-id` on `docs/qa/secret-scan-allowlist.json` itself (added this round, a9d68e4); a distinct key-shaped literal in a `reason` field committed clean through the real hook and landed in history while the identical literal in control.js was refused — grants are `{path,patternId}` only (history-scan.ts:110), so it is blanket and CI's full-history scan is blind too; defense: none. Exposure: 1 of 311 tracked files blind to the top-severity pattern in BOTH layers, basis: counted-in-code (security-class, rule 21 cap does not apply)
2. [ISSUE][MED][demonstrated] Every commit costs ~12.5-13.0 s warm and prints 264 lines (263 allowlisted) even when clean — ~310 serial `git cat-file` spawns at history-scan.ts:80-81; pre-commit-scan.ts:13-17 claims "fast enough to run on every real git commit" with no measurement (PRINCIPLES rule 18); drives bypass-by-attrition on the control this story installs. Exposure: 100% of commits with the hook installed, basis: measured
3. [ISSUE][LOW][demonstrated] `installGitHooks` guards on `existsSync(.git)` (git-hooks-install.ts:30), so from a subdirectory of a real checkout it prints "not a git checkout" and skips installing the security hook, exit 0; `git rev-parse --git-dir` is the correct probe. Exposure: 0 today (1 package.json, at the repo root), basis: counted-in-code
4. [ISSUE][LOW][demonstrated] #191 only half fixed — `.git`-absent now exits 0 (verified), but the Docker `COPY package*.json . && npm ci` shape its own comment names as guarded still hard-fails (MODULE_NOT_FOUND, npm exit 1); git-hooks-install.ts:5-10 and CHANGELOG both claim otherwise. Exposure: 0 of 2 `npm ci` call sites, basis: counted-in-code
5. [ISSUE][LOW][demonstrated] #190 residual — the BLOCKED message names the cause but not the unlock (rule 2); a brand-new repo still cannot make its first commit at all, hit live in my own fixture setup this pass. Exposure: 0% in this repo, basis: measured
6. [SUSPICION][LOW][demonstrated] #187's POSIX half unproven-pending-verification — mode is 100755 and mutation-pinned, Windows fresh-clone e2e passes, but no runtime available to prove git honors the bit (docker daemon down; only WSL distro has NOGIT/NONODE); settling command in the report
7. [SUSPICION][LOW][code-traced] SIGINT temp-dir residue unchanged from round 1 — now honestly disclosed at simulated-commit.ts:48-52, drill still unexecuted; accepted residual
8. [CLEAN][demonstrated] #187 FIXED — `git ls-files -s` shows 100755, survives a real `git clone --local`, `prepare` installs, planted secret refused at exit 1, nothing landed; `--chmod=-x` mutant turns the R187 test red
9. [CLEAN][demonstrated] #188 FIXED — my own exact k5.js/k[0-9].js attack now FAILs naming the correct path, commit refused, nothing landed; bulk `ls-files -s -z` + Map lookup removes the pathspec surface entirely; reverting to the per-path call turns the #188 test red
10. [CLEAN][demonstrated] #189 FIXED both directions — dir->file and file->dir build trees not fatals, secrets caught, and the clean version of the same refactor now commits at exit 0; single-pass mutant turns the #189 test red
11. [CLEAN][demonstrated] #190 FIXED (presentation) — single-line `BLOCKED:` message, no stack trace, exit still non-zero; residual is finding 5 above
12. [CLEAN][code-traced] #192 FIXED — `--no-verify` now disclosed in CHANGELOG.md:35, simulated-commit.ts:36-40, .githooks/pre-commit:11-15, STATE.md:39, framed as defense-in-depth with CI named as the real backstop; the overclaim is gone
13. [CLEAN][demonstrated] round-1 finding 8 FIXED — hooksPath clobber now warns with the prior value and the exact restore command
14. [CLEAN][demonstrated] round-1 suspicion 7 SETTLED — GIT_INDEX_FILE passthrough documented at exec.ts:30-40 and simulated-commit.ts:17-28, and a `GIT_*`-stripping mutant turns the R7 `git commit -am` test red
15. [CLEAN][demonstrated] NEW — deletion side is safe: `update-index --force-remove` treats its arg as a literal, not a pathspec (`k[0-9].js` removed exactly; `k?.js` -> "Ignoring path"), so #188's class does not exist there
16. [CLEAN][demonstrated] NEW — two-pass reorder is order-independent: three attempts to force a same-path D/A collision (rename swap, chained rename, delete+rename-into-hole) all collapse to M/D/A with no repeated path; the reorder strictly improves on the old code
17. [CLEAN][demonstrated] NEW — intent-to-add (`git add -N`) empty-blob false negative does not exist: plain `git commit` is refused by git itself, `git commit -am` stages the real blob and the hook catches it; nothing landed either way
18. [CLEAN][demonstrated] NEW — unmerged index: git refuses a conflicted commit at exit 128 before any hook runs; run directly, the Map's last-wins picks stage 3 (the secret side) and catches it; the resolved merge commit is correctly blocked
19. [CLEAN][code-traced] NEW — tab-in-filename cannot split the parse: the first-tab index is always the separator because the `<mode> <sha> <stage>` prefix is space-separated, so the remainder is the path verbatim; `-z` also suppresses quotepath (NTFS refused to create the fixture)
20. [CLEAN][demonstrated] NEW — `node` absent from PATH fails CLOSED (exec exits 127, commit refused, nothing landed); `.githooks/pre-commit:8-9`'s "silently no-ops" claim is wrong in the safe direction (editorial)
21. [CLEAN][demonstrated] NEW — all four new regression tests are mutation-sensitive: four independent mutants each turned exactly one matching test red and nothing else; these are real tests, not green-by-construction
22. [CLEAN][demonstrated] NEW — no TOCTOU between the two index reads: `git commit` holds `.git/index.lock` for the hook's whole lifetime, and a path in name-status missing from the map throws "refusing to guess its content" (fail-closed, simulated-commit.ts:202-206)
counts (CHECKSUM): issues=5 suspicions=2 clean=15
evidence (CHECKSUM): demonstrated=20 code-traced=2 derived=0
checks=npm test 822 pass / 0 fail / 0 skipped; 4 source mutants each -> exactly 1 matching failing test; 13 adversarial git fixtures built and run (1 reproduced a live end-to-end secret leak through the installed hook via the new self-granting allowlist entry); latency measured 3x warm (12547-13044 ms, 264 output lines) + 1x end-to-end commit (11694 ms, 267 lines)
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round2-2026-09-14.md
