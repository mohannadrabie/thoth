# Red Team (Sutekh) — `path-b-precommit-secret-scan`

- **Date:** 2026-09-14
- **Scope:** `feat/path-b-precommit-secret-scan` vs `master`, HEAD `86f053c`
- **Tier:** CRITICAL (CLAUDE.md "Secret scanning / CI gates" sensitive area)
- **Verdict:** **no-go**
- **ADR cache:** `HIT` — 35 ADRs reused (`adr/devops:12`, `adr/software-engineering:23`), fp `83b2e3e`, ≈17300 tokens saved. Attack-surface slice read: devops ADR-0008 (CI/CD gates & policy-as-code — its `--no-verify` rule is quoted below), devops ADR-0009 (secrets in IaC), SE ADR-0003 (inject I/O), SE ADR-0004 (idempotency), SE ADR-0006 (blast radius).

## Praise first

The human-ruled core decision — sourcing every staged path's content from the index's own blob SHA rather than re-`git add`-ing the working tree — is correct, is genuinely implemented (not just claimed), and I could not break it. I built my own fixture independently of the shipped tests and it held in both directions. The test suite is the real thing: real subprocesses, real `mkdtemp` repos, a real `git clone --local` of the project itself. 810/810 pass, 0 skipped. Fail-closed direction is right: every crash path I found exits non-zero and git refuses the commit.

Two defects nonetheless let a secret reach a commit silently, which is the one outcome this story exists to prevent.

## Scorecard

| # | Attack | Verdict | Severity | Evidence |
|---|---|---|---|---|
| 1 | Hook file committed non-executable -> gate inert on every POSIX clone | BREAKS | HIGH | code-traced |
| 2 | Staged path passed as a git **pathspec**, not a literal -> wrong blob scanned, PASS on a real secret | BREAKS | HIGH | demonstrated |
| 3 | Entry ordering: add-file-before-delete-dir -> `update-index` fatal, commit hard-blocked | BREAKS | MED | demonstrated |
| 4 | No error handling: every failure path is a raw Node stack trace with no named unlock | BREAKS | MED | demonstrated |
| 5 | `prepare` makes `npm ci`/`npm install` fail hard (exit 128) wherever `.git` is absent | BREAKS | MED | demonstrated |
| 6 | `--no-verify` / GUI bypass undisclosed while artifacts claim "structurally refused" | BREAKS | MED | code-traced |
| 7 | `git commit -a` / `-- <path>` correctness rests on undocumented, unpinned `GIT_INDEX_FILE` inheritance | UNPROVEN | MED | demonstrated |
| 8 | `prepare` silently clobbers a pre-existing `core.hooksPath` (incl. ADR-0008's mandated Gitleaks hook) | BREAKS | LOW | demonstrated |
| 9 | Temp-index / loose-object residue on signal-kill; header's "no extra leak" claim slightly off | UNPROVEN | LOW | code-traced |
| 10 | Partial-stage divergence (the ruled core property), both directions | SURVIVES | — | demonstrated |
| 11 | Temp-index isolation + concurrency: real `.git/index` / `HEAD` never touched | SURVIVES | — | demonstrated |
| 12 | R2 — zero new exemption surface, `history-scan.ts` reused unmodified | SURVIVES | — | code-traced |
| 13 | R5 — non-CI-scope honestly held | SURVIVES | — | code-traced |
| 14 | Tree fidelity: rename / delete / symlink / exec-bit / nested / untracked-exclusion / `--amend` | SURVIVES | — | demonstrated |
| 15 | Fail-closed on internal error (a throw must never fail open) | SURVIVES | — | demonstrated |
| 16 | Windows: does the hook actually execute under git-for-windows' bundled `sh`? | SURVIVES | — | demonstrated |
| 17 | Test quality: real subprocess vs. mocked / implementation-detail assertions | SURVIVES | — | demonstrated |

---

## 1. [HIGH][code-traced] The hook is committed non-executable — git ignores it on every POSIX clone

**Scenario.** A teammate, a CI job, or a future Linux/macOS checkout clones this repo and runs `npm ci`. `prepare` fires, `core.hooksPath` is set to `.githooks`, everything looks installed. Git then checks the hook's mode, finds `100644`, and skips it. Every commit from that machine bypasses the gate entirely. The whole story is inert, and nothing in the repo says so.

**Evidence.**
```
$ git ls-files -s .githooks/pre-commit
100644 3b64c8ff0199a9bf2ff2bc74496ca80d7fa16135 0	.githooks/pre-commit

$ git config core.filemode
false
```
git's own `githooks(5)`: *"Hooks that don't have the executable bit set are ignored."* (https://git-scm.com/docs/githooks). Modern git prints an `advice.ignoredHook` hint to stderr; the commit still proceeds. The mode stored in the **index** is what every clone checks out, regardless of this Windows box's `core.filemode=false`.

Why the shipped tests cannot catch this: `pre-commit-scan.test.ts` R3 writes its own hook and `chmod 0o755`s it; R4 clones and relies on git-for-windows, which ignores the exec bit entirely. Both pass on Windows while the property they imply is false on POSIX.

**Current defense.** None. The mode was never asserted anywhere.

**Exposure: ~100% of non-Windows clones (gate fully inert), ~0% of the single current Windows dev box, basis: measured** (index mode read directly; git behavior from vendor docs). Security-class -> exempt from PRINCIPLES rule 21's narrow-exposure cap.

**Proof-test required before merge:** `githooks: .githooks/pre-commit is committed with mode 100755` — assert `git ls-files -s .githooks/pre-commit` starts with `100755`. Fix: `git update-index --chmod=+x .githooks/pre-commit`.

**Settles it on POSIX** (I could not run this — no git/node in the available WSL distro, docker daemon down): `docker run --rm -v "$PWD:/src:ro" alpine/git sh -c 'cd /tmp && git clone -q /src r && cd r && git config core.hooksPath .githooks && git config user.email t@e.com && git config user.name T && printf "k=\"AKIAFAKEFAKEFAKEFAKE\"\n" > c.js && git add c.js && git commit -m x; git log --oneline -1'`. Any reviewer with a Linux box or a running Docker daemon can run it.

---

## 2. [HIGH][demonstrated] Staged paths are passed as git **pathspecs**, not literals — a glob-magic filename silently scans the wrong blob and the gate reports PASS

**Scenario.** A developer adds `app/[id].js`, `pages/[slug].tsx`, `k[0-9].js` — any path containing `[`, `]`, `*`, or `?`. `resolveStagedBlob` runs `git ls-files -s -z -- <path>`, where `<path>` is interpreted by git as a **glob pathspec**, and then takes the **first** returned record. When the glob also matches a lexicographically-earlier sibling, the simulated tree gets that sibling's blob. The scan reports `PASS`, `git commit` proceeds, and the secret lands in git history permanently. No warning, no non-zero exit, nothing to notice.

**Code trace.** `src/secret-scan/simulated-commit.ts:101-102`
```ts
const raw = await run(runner, repoRoot, ["ls-files", "-s", "-z", "--", path]);
const record = raw.split("\0").find((r) => r.length > 0);
```

**Evidence — end-to-end, with the real hook installed via `core.hooksPath`:**
```
$ git status --porcelain
A  k5.js
A  k[0-9].js

$ git ls-files -s -z -- 'k[0-9].js' | tr '\0' '\n'
100644 17eae1607058529c004c493346d7956e79aa3def 0	k5.js
100644 4dacb59a9d6be89885593a56dc0ae4f97dad67eb 0	k[0-9].js
      ^ two records; .find() takes the FIRST — the wrong file

$ node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (0 allowlisted).
SCAN EXIT=0

# simulated tree, dumped directly:
k5.js      => const clean = "nothing here";
k[0-9].js  => const clean = "nothing here";   <-- WRONG BLOB. real content is the secret.

$ git commit -m "smuggle a secret past the Path B hook"
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (0 allowlisted).
COMMIT EXIT=0
$ git show "HEAD:k[0-9].js"
const k = "AKIAFAKEFAKEFAKEFAKE";
```
Control, identical secret in an ordinary filename `k9.js`:
```
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found ... k9.js [aws-access-key-id]
CONTROL COMMIT EXIT=1
```
The gate works; the pathspec does not.

On POSIX, where `*` and `?` are legal filename characters, a staged path containing `*` matches essentially the whole index and would pick the first index entry overall — a much broader version of the same bug. (Reasoned, not demonstrated: `*` is not creatable on this Windows filesystem.)

**Current defense.** None. `--` disables *option* parsing, not *pathspec magic*. No test stages a glob-magic path.

**Exposure: 0 of 305 tracked paths today, basis: measured** (`git ls-files | grep -cE '[][*?]'` -> `0`; `git ls-files | wc -l` -> `305`). This is a **latent** false negative, not an active one — but it is silent, git-history-irreversible, and security-class, so rule 21's exposure cap does not defuse it. The first Next.js-style `[id].tsx`-shaped path anyone commits arms it.

**Proof-test required before merge:** `buildSimulatedCommit: a staged path containing pathspec glob magic resolves its OWN blob, not a glob sibling's` — stage `k5.js` (clean) + `k[0-9].js` (secret), assert the simulated tree's `k[0-9].js` blob contains the secret.
**Fix:** one `git ls-files -s -z` call up front, parsed into a `Map<path, {mode, sha}>` (removes N subprocess spawns too), or `:(literal)` pathspec magic / `--literal-pathspecs`.

---

## 3. [MED][demonstrated] Add-before-delete ordering hard-blocks a commit git itself would accept

**Scenario.** A routine refactor collapses a directory into a file: `src/foo/index.ts` -> `src/foo.ts`. `git diff --cached --name-status -z HEAD` sorts by path, so `A src/foo.ts` is emitted before `D src/foo/index.ts`. The loop at `simulated-commit.ts:139-159` processes entries in that order and tries to add the file while the directory still exists in the temp index.

**Evidence.**
```
$ git diff --cached --name-status HEAD
A	a
D	a/b

$ node src/secret-scan/pre-commit-scan.ts ; echo "EXIT=$?"
Error: git update-index --add --cacheinfo 100644 4dacb59a... a failed (exit 128):
       error: 'a' appears as both a file and as a directory
SCAN EXIT=1

$ git commit -m "dir/file swap with a secret"   # real hook installed
COMMIT EXIT=1
$ git log --oneline
0715f3b init          <-- commit permanently refused
```
The real `git commit` accepts this tree without complaint. The simulation diverges, and it diverges in the blocking direction with no way forward short of `--no-verify`.

**Current defense.** Fail-closed, which is the right direction — but PRINCIPLES rule 2: the block names no unlock, and the developer is stuck.

**Exposure: ~0% of commits today, basis: assumption** (directory->file collapse frequency is not measured here). Rated MED on availability + no-unlock, not on volume.

**Proof-test required:** `buildSimulatedCommit: a staged directory->file replacement builds a tree, not an update-index fatal`.
**Fix:** two passes — apply every `D` first, then every `A`/`M`/`T`.

---

## 4. [MED][demonstrated] Every failure path is a raw Node stack trace with no named unlock

**Scenario.** Any internal error — empty repo, the ordering bug above, a transient git failure — surfaces to the developer as an unhandled-rejection dump. `main()` at `pre-commit-scan.ts:51-54` has no `try/catch`, and `buildSimulatedCommit` throws freely.

**Evidence** (fresh `git init`, hook installed, committing an entirely clean README):
```
$ git commit -m "first commit ever"
    at async main (file:///C:/playground/thoth/src/secret-scan/pre-commit-scan.ts:52:16)
    at async file:///C:/playground/thoth/src/secret-scan/pre-commit-scan.ts:57:3
Node.js v24.15.0
FIRST-COMMIT EXIT=1
$ git log --oneline
fatal: your current branch 'main' does not have any commits yet
```
The module header at `simulated-commit.ts:18-19` says the empty-repo case "fails loud with a clear message." The message text exists (`simulated-commit.ts:126-128`) but reaches the developer buried under a stack trace, and the failure is unrecoverable: a brand-new repo with this hook installed can never make its first commit.

**Current defense.** Fail-closed and honest about *scope*; not honest about *ergonomics*. Exit code is correct (1).

**Exposure: ~0% of commits in this repo, basis: measured** (this repo always has HEAD). Rated MED on rule-2 compliance for a standing, blocking gate.

**Proof-test required:** `pre-commit-scan: an internal error prints a single-line BLOCKED message naming the unlock, not a stack trace` + `buildSimulatedCommit: an empty repo scans the staged tree against the empty tree (4b825dc...) instead of throwing`.

---

## 5. [MED][demonstrated] `prepare` makes `npm ci` / `npm install` fail hard wherever `.git` is absent

**Scenario.** Any install context without a `.git` directory — a Docker `COPY package*.json . && npm ci` layer, a tarball install, a vendored-source build — now fails the whole install. `"prepare": "git config core.hooksPath .githooks"` is unguarded.

**Evidence.**
```
> thoth@0.1.0 prepare
> git config core.hooksPath .githooks
fatal: not in a git directory
npm error code 128
npm error command failed
```
Also verified, in the install mechanism's favour: `prepare` **does** run under plain `npm install`, under `npm ci`, and even under `npm ci --omit=dev` (npm 10 semantics, measured — not assumed). The install path is more robust than the brief feared; it is the *failure* path that is unguarded.

**Current defense.** None. Mitigating: this repo has no Dockerfile (`ls Dockerfile* docker*` -> not found), and both `npm ci` steps in `.github/workflows/ci.yml` (lines 185, 289) run after `actions/checkout`, which provides `.git`.

**Exposure: 0 of 2 current `npm ci` call sites, basis: counted-in-code.** A new, unguarded hard dependency of `npm install` on git + a trusted git repo.

**Proof-test required:** `package.json: prepare never fails an install outside a git repo` — run `npm ci` in a `.git`-less fixture and assert exit 0. Fix: `"prepare": "git config core.hooksPath .githooks || exit 0"`.

---

## 6. [MED][code-traced] `--no-verify` and GUI bypass are undisclosed while the story's own artifacts claim "structurally refused"

**Scenario.** The residual register for a security gate omits its single largest hole. A reader of `CHANGELOG.md` / `docs/STATE.md` concludes commits are blocked; they are blocked only for developers who don't type six extra characters.

**Evidence — the bypass:**
```
$ git commit --no-verify -m "bypass"
NO-VERIFY EXIT=0
$ git log --oneline
a8f22cd bypass          <-- secret landed, hook never ran
```
**Evidence — the absent disclosure:**
```
$ grep -rn "no-verify" --include=*.md --include=*.ts . | grep -v node_modules
./adr/devops/0008-cicd-gates-and-policy-as-code.md:127:- MUST install and run the Gitleaks pre-commit hook; MUST NOT bypass it (`--no-verify`) ...
./docs/.maat-state.json:181: (same rule, cached)
```
Zero hits in `CHANGELOG.md`, `docs/STATE.md`, `docs/decisions.md`, `docs/backlog.md`, `.githooks/pre-commit`, or either new source file. Against that, the shipped framing: CHANGELOG *"a standing, **blocking** git pre-commit secret-scan check"*; test name R3 *"`git commit` is **structurally refused**"*; `simulated-commit.ts:17` lists three "known, disclosed non-goals" and `--no-verify` is not among them.

The one place the residual *is* covered — devops ADR-0008 line 127 — binds it to *"the Gitleaks pre-commit hook"*, and this repo has no gitleaks (`.gitleaks.toml`, `.gitleaksignore`, `.git/hooks/pre-commit` all absent), so that MUST does not currently cover this instrument by name.

Other undisclosed bypasses in the same class: a GUI/IDE client launched without `node` on its PATH; `git clone` followed by any commit before `npm install`; a GitHub squash-merge, which never runs a local hook at all (correctly out of scope — CI's `history-scan.ts` covers it — but unstated here).

**Current defense.** ADR-0008's rule, partially and by a different hook's name.

**Exposure: 100% of developers who choose to bypass, basis: measured** (bypass reproduced). Rated MED, not HIGH: this is a disclosure defect, not a mechanism defect — no hook can defeat `--no-verify`, and the honest framing is "raises the floor," not "structurally blocking."

**Resolution:** one residual-register line in `CHANGELOG.md` + `simulated-commit.ts`'s non-goals block naming `--no-verify`, non-`npm install`ed clones, and server-side merges, pointing at CI's full-history scan as the backstop. Optionally amend ADR-0008 to name this instrument rather than Gitleaks.

---

## 7. [MED][demonstrated] UNPROVEN — `git commit -a` / `git commit -- <path>` correctness rests on undocumented, unpinned `GIT_INDEX_FILE` inheritance

**Scenario.** Both of these produce a **correct** result today, and I verified both. But they are correct for a reason the code does not state and no test pins.

**Evidence — `git commit -am` with a secret in a tracked-but-unstaged file:**
```
$ git commit -am "auto-stage a secret"
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) ... tracked.js [aws-access-key-id]
EXIT=1                                                          <-- correctly blocked
```
**Evidence — `git commit -- clean.js` while `secret.js` is separately staged:**
```
$ git commit -m "partial: only clean.js" -- clean.js
[Path B pre-commit-scan] PASS: ...
EXIT=0
$ git ls-tree -r HEAD --name-only
README.md
clean.js                                                        <-- correctly NOT a false positive
```
**Why it works** — probe hook, `git commit -am`:
```
HOOK ENV GIT_INDEX_FILE=[.../atk7/.git/index.lock]
```
git points the hook at a *temporary* index (`.git/index.lock` for `-a`, `next-index-N` for a pathspec commit). `cleanSubprocessEnv()` (`src/lib/exec.ts:30-34`) copies all of `process.env` minus two `NODE_TEST_*` keys, so `git diff --cached` and `git ls-files -s` inherit it and read the right index. The `read-tree`/`update-index`/`write-tree` calls override it correctly with the private temp index.

**Why it is UNPROVEN.** `simulated-commit.ts:9` asserts content is read from *"the REAL INDEX's own staged blob"*. Under `git commit -a` that is false — the real `.git/index` is stale at hook time, and reading it would be a **silent false negative on exactly the `git commit -am` path developers use most**. The correct behavior depends entirely on a one-line env passthrough in an unrelated module, documented nowhere, tested nowhere. A future hardening of `cleanSubprocessEnv()` to strip `GIT_*` (a plausible, well-intentioned change) silently reverts this to the failure mode the story exists to close.

**Settling test:** `pre-commit-scan: git commit -am with a secret in a tracked, unstaged file is refused` — a real end-to-end hook test, plus a comment at `exec.ts:30` marking `GIT_INDEX_FILE` passthrough as load-bearing, plus a correction to `simulated-commit.ts:9`.

---

## 8. [LOW][demonstrated] `prepare` silently clobbers a pre-existing `core.hooksPath`

```
hooksPath BEFORE: .pre-existing-husky
> thoth@0.1.0 prepare
> git config core.hooksPath .githooks
hooksPath AFTER plain npm ci: .githooks
```
No warning. Setting `core.hooksPath` also disables `.git/hooks/` wholesale — so devops ADR-0008 line 127's mandated Gitleaks pre-commit hook, if anyone ever installs it the conventional way, becomes silently inert. Not currently installed, so LOW today; worth a line in the ADR-0008 conformance note. **Exposure: 0 developers today, basis: measured** (no husky, no gitleaks, no `.git/hooks/pre-commit` in this repo).

## 9. [LOW][code-traced] UNPROVEN — temp-index and loose-object residue

`buildSimulatedCommit`'s `finally` (`simulated-commit.ts:173-175`) covers throws but not signals: Ctrl-C during a commit leaves an orphan `thoth-precommit-index-*` dir in the OS temp dir. Contents are an index file (paths + SHAs), no secret bytes — genuinely minor. Separately, `simulated-commit.ts:23-26` claims the dangling objects are "not a leak beyond what a real `git commit` would itself have written": accurate for the *blob* (already written by `git add`) but not for the tree/commit objects of a **blocked** commit, which a real `git commit` would never have created. Both reclaimed by ordinary `git gc`. **Settling command:** `ls "$TMPDIR" | grep -c thoth-precommit-index-` after a SIGINT-during-commit drill.

---

## SURVIVES — attacks that failed, honestly

**10. Partial-stage divergence (the ruled core property) — SURVIVES.** I built my own fixture rather than trusting the shipped tests. A file staged clean then dirtied with a secret scans clean; a file staged with a secret then cleaned in the working tree still scans as a match. The index-blob sourcing is real, not claimed. This was the highest-value decision in the story and it holds.

**11. Temp-index isolation / concurrency — SURVIVES.** `git hash-object .git/index` is byte-identical before and after, across every fixture including mixed rename/delete/add. `mkdtemp` gives each run a unique index path, so two concurrent scans cannot collide; git's own `.git/index.lock` serializes concurrent `git commit`s above that. Every index-mutating call carries the explicit `GIT_INDEX_FILE` override (`simulated-commit.ts:134, 141-143, 156-158, 161`).

**12. R2 — zero new exemption surface — SURVIVES.** `git diff --name-only master...HEAD | grep -E "history-scan|patterns|instrument"` -> empty. `scanHistory`/`loadAllowlist`/`summarizeMatches`/`SECRET_PATTERNS` are imported, not reimplemented (`pre-commit-scan.ts:25`). The only allowlist change is 4 additive entries for this story's own test fixtures, each with a real `reason`. No in-file marker, no second grant path.

**13. R5 — non-CI-scope — SURVIVES.** `.github/workflows/ci.yml` is not in the diff. The one indirect CI effect — `npm ci` now sets `core.hooksPath` in the runner's checkout — is inert: `grep -rn "git commit|git push" .github/workflows/` returns nothing, so no workflow ever triggers the hook.

**14. Tree fidelity — SURVIVES.** Rename (`D` old + `A` new), copy (`A` new only), delete, nested paths, untracked-file exclusion, symlink (mode `120000`, secret in the link target — caught), executable bit (`100755` preserved through `--cacheinfo`, secret caught), `git commit --amend` (correctly blocked, nothing landed). Mode and blob both come from `ls-files -s`, so CRLF normalization and `.gitattributes` clean filters are handled for free — the index blob is already the committed bytes.

**15. Fail-closed on error — SURVIVES.** Two independent crash paths (empty repo, dir/file swap) both exit 1 and git refuses the commit. A throw never fails open. (Presentation is finding 4; the safety direction is correct.)

**16. Windows execution — SURVIVES.** The hook genuinely runs under git-for-windows' bundled `sh`, demonstrated by the shipped R3/R4 tests and by every fixture in this report. Not POSIX-only in the direction feared — it is *Windows*-only in the direction of finding 1.

**17. Test quality — SURVIVES, and is above this project's average.** Real `realRunner` subprocesses against real `mkdtemp` git repos; R4 does a real `git clone --local` of the project itself and asserts a real `git commit` is refused, plus a negative control proving the block comes from the setup step rather than luck. No mocks, no implementation-detail assertions. Full suite: **810 pass, 0 fail, 0 skipped**. Coverage gaps named by findings 1, 2, 3, 5, 7 — none of which is a *quality* defect in what was written, only in what was not.

---

## Raw checks

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog
   - ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

$ node --test src/secret-scan/simulated-commit.test.ts src/secret-scan/pre-commit-scan.test.ts src/lib/exec.test.ts
tests 28  pass 28  fail 0  skipped 0  todo 0

$ npm test
tests 810  pass 810  fail 0  cancelled 0  skipped 0  todo 0

$ git ls-files | grep -cE '[][*?]'   ->  0        (exposure basis, finding 2)
$ git ls-files | wc -l               ->  305
$ git ls-files -s .githooks/pre-commit -> 100644   (finding 1)
```
Adversarial fixtures built and run this pass: `commit -a` auto-stage, `commit -- <path>` partial, `commit --amend`, `--no-verify`, glob-magic pathspec collision (end-to-end through a real installed hook), directory->file swap, symlink + exec-bit staging, empty repo first commit, `npm ci` outside a git repo, `npm ci --omit=dev`, `core.hooksPath` clobber, GIT_INDEX_FILE probe hook.

## Open findings -> failing tests

9 open findings (7 BREAKS + 2 UNPROVEN) -> 9 named test cases:

| # | Named test / drill |
|---|---|
| 1 | `githooks: .githooks/pre-commit is committed with mode 100755` |
| 2 | `buildSimulatedCommit: a staged path containing pathspec glob magic resolves its OWN blob, not a glob sibling's` |
| 3 | `buildSimulatedCommit: a staged directory->file replacement builds a tree, not an update-index fatal` |
| 4 | `pre-commit-scan: an internal error prints a single-line BLOCKED message naming the unlock, not a stack trace` |
| 5 | `package.json: prepare never fails an install outside a git repo` |
| 6 | (documentation) residual-register line in `CHANGELOG.md` + `simulated-commit.ts` non-goals — no executable form; tracked as a residual line, per rule 19 |
| 7 | `pre-commit-scan: git commit -am with a secret in a tracked, unstaged file is refused` |
| 8 | `prepare: warns when it replaces a pre-existing core.hooksPath` |
| 9 | (drill) SIGINT-during-commit temp-dir residue check — no unit-test form; residual-register line |

Seven have an executable form; findings 6 and 9 do not (a disclosure and a signal-handling drill) and resolve to residual-register lines.

## Editorial (verdict-neutral, plain edits, no re-review)

- `simulated-commit.ts:9` — "Content is sourced from the REAL INDEX's own staged blob" is inaccurate under `git commit -a`/`-- <path>`, where git hands the hook a temporary index. The behavior is right; the sentence is wrong.
- `simulated-commit.ts:23-26` — "not a leak beyond what a real `git commit` would itself have written" does not hold for the tree/commit objects of a *blocked* commit.
- `.githooks/pre-commit` comment says "git invokes hooks with cwd already at the repo's own top level" — true, and worth adding that this is why the relative `node src/...` path is safe, but it also means the hook silently no-ops if `node` is absent from the invoking shell's PATH (a GUI-client concern), which the comment does not mention.
- CHANGELOG's "23 new tests (`simulated-commit.test.ts` 14, ...)" — the file contains 13 `test(` calls, not 14.

---

## Scariest unproven assumption

**That "installed" means "running."** The entire story's value rests on a hook file that git will silently decline to execute on every non-Windows clone because it was committed `100644` — and the test suite structurally cannot detect this, because it only ever runs on a platform where the exec bit is meaningless. The gate would look green forever while being inert everywhere but this one laptop.

## Verdict: no-go

Two findings with blocking-grade evidence — one `code-traced` (#1), one `demonstrated` end-to-end (#2) — both let a secret reach git history with the gate reporting PASS or never running at all. That is the precise outcome the story exists to prevent, so shipping it as-is would install confidence without protection, which is worse than no hook. Everything else here is fixable in an afternoon, and the core design — index-blob sourcing, temp-index isolation, unmodified reuse of `history-scan.ts` — is sound and should not be reopened.

## Single next action

`git update-index --chmod=+x .githooks/pre-commit`, then replace `resolveStagedBlob`'s per-path `ls-files -- <path>` with a single `git ls-files -s -z` parsed into a `Map<path, {mode, sha}>` — one change fixes finding 2, removes N subprocess spawns, and makes finding 3's two-pass reordering trivial to add on top.

---

RECEIPT: verdict=no-go
attacks (ALL, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] `.githooks/pre-commit` committed mode 100644 — git ignores non-executable hooks, so the whole gate is silently inert on every POSIX/CI clone; defense: none, and the Windows-only test suite structurally cannot catch it. Exposure: ~100% of non-Windows clones, basis: measured
2. [ISSUE][HIGH][demonstrated] Staged path passed to `git ls-files -s -- <path>` as a glob pathspec, not a literal; `.find()` takes the first match, so a `[id].tsx`-shaped filename scans a sibling's blob — gate printed PASS and the AWS-key-shaped secret landed in a real commit; defense: none. Exposure: 0 of 305 tracked paths today, basis: measured (latent, silent, irreversible, security-class)
3. [ISSUE][MED][demonstrated] name-status order applies `A <file>` before `D <dir>/<child>` -> `update-index` fatal "appears as both a file and as a directory", permanently blocking a directory->file refactor git itself accepts; defense: fail-closed but no unlock. Exposure: ~0% of commits, basis: assumption
4. [ISSUE][MED][demonstrated] No try/catch in `main()` — empty repo and every other error path dump a raw Node stack trace with no named unlock (PRINCIPLES rule 2); defense: exit code is correct, presentation is not. Exposure: ~0% in this repo, basis: measured
5. [ISSUE][MED][demonstrated] `"prepare": "git config core.hooksPath .githooks"` fails `npm ci` hard (exit 128, "not in a git directory") wherever `.git` is absent; defense: none, mitigated only by this repo having no Dockerfile. Exposure: 0 of 2 `npm ci` call sites, basis: counted-in-code
6. [ISSUE][MED][code-traced] `--no-verify` bypass reproduced (exit 0, secret landed) but disclosed nowhere in CHANGELOG/STATE/decisions/backlog/source non-goals, while those same artifacts say "blocking"/"structurally refused"; defense: devops ADR-0008 line 127 covers it only under a Gitleaks hook this repo does not have. Exposure: 100% of bypassing devs, basis: measured
7. [SUSPICION][MED][demonstrated] `git commit -a`/`-- <path>` are correct only because the hook's inherited `GIT_INDEX_FILE` (`.git/index.lock`) survives `cleanSubprocessEnv()`; both verified correct today, but `simulated-commit.ts:9` documents the opposite mechanism and no test pins it — a `GIT_*`-stripping hardening silently reverts `git commit -am` to a false negative
8. [ISSUE][LOW][demonstrated] `prepare` silently overwrites a pre-existing `core.hooksPath` and disables `.git/hooks/` wholesale, which would render ADR-0008's mandated Gitleaks hook inert; defense: none. Exposure: 0 devs today, basis: measured
9. [SUSPICION][LOW][code-traced] `finally` cleanup covers throws but not SIGINT, leaking `thoth-precommit-index-*` temp dirs; header's "no leak beyond what git commit writes" is inexact for a blocked commit's new tree/commit objects
10. [CLEAN][demonstrated] Partial-stage divergence, the human-ruled core property — independently re-fixtured, both directions hold; the index-blob sourcing is real
11. [CLEAN][demonstrated] Temp-index isolation and concurrency — real `.git/index` byte-identical before/after across every fixture; per-run `mkdtemp` plus git's own index.lock make races impossible
12. [CLEAN][code-traced] R2 zero new exemption surface — `history-scan.ts`/`patterns.ts`/`instrument.ts` untouched on this branch; allowlist gains 4 additive, reasoned entries only
13. [CLEAN][code-traced] R5 non-CI-scope honest — ci.yml untouched; no workflow runs `git commit`, so the `prepare`-set hooksPath in CI is inert
14. [CLEAN][demonstrated] Tree fidelity — rename/copy/delete/nested/untracked-exclusion/symlink 120000/exec-bit 100755/`--amend` all match the real commit; CRLF and clean filters free via the index blob
15. [CLEAN][demonstrated] Fail-closed on internal error — two distinct crash paths both exit 1 and git refuses the commit; never fails open
16. [CLEAN][demonstrated] Windows execution — the hook genuinely runs under git-for-windows' bundled sh
17. [CLEAN][demonstrated] Test quality — real subprocesses, real mkdtemp repos, a real `git clone --local` with a negative control; no mocks, no implementation-detail assertions
counts (CHECKSUM): issues=7 suspicions=2 clean=8
evidence (CHECKSUM): demonstrated=12 code-traced=5 derived=0
checks=npm test 810 pass / 0 fail / 0 skipped; targeted node --test (3 files) 28 pass / 0 fail / 0 skipped; 12 adversarial git fixtures built and run (1 reproduced a live end-to-end secret leak through the installed hook)
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-2026-09-14.md
