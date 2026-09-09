# Red Team (Sutekh) — `cifix` adversarial review

- **Scope:** `cifix` (`docs/.maat-state.json` -> `scope`), CRITICAL tier, infra-only
- **Date:** 2026-09-09
- **HEAD:** `1b4053cfec43084a6cba411097cddf42012fa357` (uncommitted working-tree diff reviewed)
- **Diff under attack:** `.github/workflows/ci.yml`, `docs/backlog.md`, `CHANGELOG.md`
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **ADR rules read for this attack surface:** devops ADR-0008 (CI/CD gates and policy-as-code — `pipeline,quality,security,supply-chain`), devops ADR-0009 (Least-privilege IAM and secrets in IaC — `security,secrets`), SE ADR-0009 (Monitoring — "MUST NOT log secrets, tokens"), SE ADR-0010 (Code quality and maintainability gates)
- **Verdict:** `no-go` — one blocking HIGH, three MED, two LOW, one MED suspicion, nine CLEAN

> **The diff's mechanism is correct and I verified it works.** The `no-go` is not against the workflow edit's content. It is against shipping this as "Issue #27 fixed": the change cannot reach — and therefore cannot demonstrate — the gate it exists to restore.

---

## Method note — holding myself to the bar this reviewer missed last round

Round 6's red-team report asserted "nothing in any npm/qa:* script reads `adr/`" from a hand-derived grep and was found FALSE by the Manager. Every mechanical claim below is re-derived from a command I ran in this session, with raw output pasted. Re-verified from scratch rather than taken from the plan's restatement:

```
$ git grep -n -E '"adr/|adr/devops|adr/software-engineering|adr\.dir' -- 'src/**' 'scripts/**' 'hooks/**' 'docs/*.mjs' 'package.json' 'maat.json'
docs/adr-cache.mjs:15:  ... adr.dir ...
maat.json:3:    "dir": ["adr/devops", "adr/software-engineering"],
src/policy/kernel/action-record.ts:19:   * ... (ADR-0021's Decision table, `adr/software-engineering/0021-
src/qa/reference-resolver.test.ts:117:    ...(await listFilesRecursive("adr/devops", ...
src/qa/reference-resolver.test.ts:118:    ...(await listFilesRecursive("adr/software-engineering", ...
src/qa/reference-resolver.ts:249:    ...(await listFilesRecursive("adr/devops", ...
src/qa/reference-resolver.ts:250:    ...(await listFilesRecursive("adr/software-engineering", ...
```

QA-14 (`src/qa/reference-resolver.ts:249-250`) does read `adr/devops` and `adr/software-engineering` — the Manager's correction stands, independently confirmed. This grep is a running instrument over tracked files, not prose.

I also re-derived the diagnosis rather than accepting it:

```
$ gh run view 34398589099 --repo mohannadrabie/thoth --json jobs
"1 Set up job -> success", "2 Checkout -> failure", "3 Set up Node.js -> skipped",
... "15 QA-14 reference-resolver -> skipped", ... "24 OSS-01 full-history secret scan -> skipped"

$ gh run list --repo mohannadrabie/thoth --limit 100 --json conclusion
[{"c":"failure","n":18},{"c":"success","n":10}]
```

12 consecutive push-triggered failures since 2026-09-01, all at `Checkout`, all downstream steps `skipped`. The one 2026-09-07 `success` is the `schedule` trigger (the `runtime-settings-drift` job, which has no submodule) — consistent with the diagnosis, not a counterexample.

---

# Findings, ranked by blast radius

## 1. [ISSUE][HIGH][demonstrated] — `cifix` cannot reach its own verification target; QA-14 and OSS-01 still never run

**Exposure: 100% of CI runs, basis: measured.** Security / CI-gate category, so PRINCIPLES rule 21's narrow-exposure cap does not apply.

### Attack
Assumption being broken: *"restoring the `adr` submodule restores CI."* It does not, because a second, independent gate fails earlier in the same job.

### Scenario
The human creates `ADR_REPO_PAT`. A push lands on `master`. Step 1 `Checkout` succeeds. Step 2 `Configure credential` succeeds. Step 3 `Init adr submodule` succeeds — `adr/` is populated for the first time in CI history. Step 5 `npm ci` succeeds. Step 8 **`Test (full node:test suite)` fails**, because the `OSS-01 (dogfood)` test is red at HEAD (GitHub Issue **#113**, state `OPEN`, labels `bug`, `severity:med`, `oss`; its title is literally *"oss:secret-scan dogfood gate is RED at HEAD"*). GitHub Actions aborts the job. Steps 9-26 never execute — including **step 16 `QA-14 reference-resolver`, the only consumer of the `adr` submodule in the entire workflow**, and **step 25 `OSS-01 full-history secret scan`**.

Reproduced locally, raw output:

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
TYPECHECK_EXIT=0

$ npm run lint
> eslint .
LINT_EXIT=0

$ npm test  ->  NPM_TEST_EXIT=1
x OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass (18768.8072ms)
i tests 658
i suites 0
i pass 657
i fail 1
i skipped 0
i todo 0
```

Step ordering, machine-read from the file under review (not eyeballed):

```
$ node -e "... yaml.load('.github/workflows/ci.yml') ... steps.forEach(...)"
ci job step count: 26
 0 | Checkout
 1 | Configure credential for private `adr` submodule
 2 | Init adr submodule
 ...
 7 | Test (full node:test suite)        <-- deterministic failure, Issue #113
 ...
15 | QA-14 reference-resolver           <-- the ONLY adr/ consumer; unreachable
24 | OSS-01 full-history secret scan    <-- unreachable
```

The file's own header states the design that makes this fatal: *"Any failing step fails the job; there is no continue-on-error anywhere in this file."* Verified: no `continue-on-error` key exists in the parsed YAML.

### Current defense (honestly assessed)
Partial. The CHANGELOG **does** disclose the failing test and names Issue #113. It calls it *"pre-existing ... unrelated, unchanged by this diff"* — all three of which are true. What it does **not** state anywhere I could find is the **consequence**: that this failure sits upstream of every gate `cifix` exists to revive, so the substance of Issue #27 — *"lint/typecheck/npm test/every QA+OSS instrument including OSS-01's secret scan has run ZERO times in real CI across S1-S6"* (`docs/decisions.md`, 2026-09-09 row) — is **unchanged by this diff**. The CHANGELOG's "AC3/AC4/AC5 are NOT YET VERIFIABLE" framing attributes the gap solely to the missing secret. That attribution is incomplete: creating `ADR_REPO_PAT` will not make them verifiable.

### ADR conflict
devops **ADR-0008** (`Accepted`, `pipeline,quality,security,supply-chain`), Rules for agents:
- *"MUST NOT merge a PR with any blocking gate open, failing, or pending."* — `npm test` is a blocking gate in this very workflow and it is failing.
- *"MUST run the full gate set locally ... before declaring work complete; **failing gates = unfinished work**."*

An ADR MUST, which per PRINCIPLES rule 9 outranks a convention-level judgment call.

### Verdict: **BREAKS**

### Required before merge — named drill
**`ci-green-end-to-end-drill`** (blocking; nothing else in this report needs a real runner):
1. Human creates `ADR_REPO_PAT` (fine-grained, `mohannadrabie/adr` only, Contents: Read-only, 90-day expiry) via `gh secret set ADR_REPO_PAT --repo mohannadrabie/thoth`.
2. Resolve Issue #113. **Caveat carried from ADR-0008:** *"MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)."* Fixing #113 by widening the `internal-hostname` allowlist is only permissible if the `settings.local.json`-shaped match is a genuine false positive **with an inline justification**; a blanket allowlist widening trades this HIGH for an ADR-0008 violation.
3. Push to a throwaway branch. Assert via `gh run view <id> --json jobs`: **all 26 steps `success`**, specifically `QA-14 reference-resolver -> success` and `OSS-01 full-history secret scan -> success`.
4. Only then may Issue #27 close `completed`.

Until step 3 produces that run, **Issue #27 stays OPEN** regardless of this diff merging.

---

## 2. [ISSUE][MED][demonstrated] — `ADR_REPO_PAT` sits in plaintext on the runner for 23 subsequent steps, including `npm ci` over 83 third-party packages with install scripts enabled

**Exposure: 100% of CI runs, basis: measured** (step index 1 of 26; 83 entries counted in `node_modules`; `ignore-scripts` confirmed unset). Security category, so rule-21 exempt from the exposure cap. Severity held at MED, not HIGH, because the credential is read-only, single-repo, and revocable — inflating it would be manufactured.

### Attack
Assumption being broken: *"`url.insteadOf` confines the credential to the submodule fetch."* It confines **which URL** the credential is sent to. It does **not** confine **who on the runner can read it**, or **for how long**.

### Scenario
`git config --global` writes the token to `$HOME/.gitconfig` in plaintext, and it stays there for the remainder of the job. Demonstrated with a fake token in an isolated `GIT_CONFIG_GLOBAL`:

```
$ git config --global url."https://x-access-token:ghp_FAKETOKEN123@github.com/mohannadrabie/adr".insteadOf "https://github.com/mohannadrabie/adr"
config EXIT=0
$ cat "$GIT_CONFIG_GLOBAL"
[url "https://x-access-token:ghp_FAKETOKEN123@github.com/mohannadrabie/adr"]
	insteadOf = https://github.com/mohannadrabie/adr
```

Second disk location: `secrets.ADR_REPO_PAT` is interpolated directly into the `run:` **script body**, so the runner writes the literal token into `/home/runner/work/_temp/<uuid>.sh` before executing it. (GitHub's own hardening guidance prefers `env:` for exactly this reason; it also removes the token from the rendered `Run ...` log group entirely rather than relying on the masker.)

Now the trigger. `Install dependencies` (`npm ci`) runs at step 5 — **after** the credential is on disk:

```
$ cat .npmrc            -> No such file or directory
$ grep -rn "ignore-scripts" package.json .npmrc  -> (not set)
$ node -e "...package.json..."   -> deps 0 devDeps 5
$ ls node_modules | wc -l        -> 83
```

Any one of those 83 packages shipping a compromised `postinstall` reads `~/.gitconfig` and exfiltrates the PAT. npm dependency compromise is a routine real-world trigger, not a hypothetical. Blast radius on compromise is bounded and honest: **read access to the private `mohannadrabie/adr` repo**, nothing more — the PAT has no access to `thoth`, which is exactly what the human's Q1 ruling bought, and it holds up.

### Current defense (honestly assessed)
- GitHub's log masker covers the `Run` block echo — real, and adequate for the log channel.
- Ephemeral GitHub-hosted runner (`runs-on: ubuntu-latest`, both jobs) bounds persistence to one job. Real.
- Nothing at all defends the **on-runner filesystem** during the job. There is no cleanup step, and the credential's lifetime is the whole job rather than one git invocation.
- SE ADR-0009's *"MUST NOT log secrets, tokens, passwords"* is satisfied. devops ADR-0009's *"MUST NOT place secret material in source, context, env vars, or synthesized templates"* is **AWS-IaC-scoped** (`applicableTo: cdk,security,iam,secrets`) and I do **not** claim it as a violation here — noted only as the analogous principle.

### Verdict: **BREAKS** (hardening gap, not a functional defect)

### Required before merge — named test, plus a fix I verified rather than proposed
Env-only, zero disk write, zero argv exposure, zero residue:

```
$ GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.file://$SB/realsub.git.insteadOf" \
  GIT_CONFIG_VALUE_0="file://$SB/PRIVATE-UNREACHABLE.git" \
  git submodule update --init --recursive
Submodule 'adr' (file:///.../PRIVATE-UNREACHABLE.git) registered for path 'adr'
Cloning into '.../super/adr'...
Submodule path 'adr': checked out '27e890028edf505a0ee879757ddd0dc758b033e0'
EXIT=0
adr/ contents: [.git f.txt]
global config after: [0] insteadOf entries
```

Collapse steps 1+2 into one step:

```yaml
- name: Init adr submodule (private repo, adr-only credential)
  env:
    GIT_CONFIG_COUNT: "1"
    GIT_CONFIG_KEY_0: url.https://x-access-token:${{ secrets.ADR_REPO_PAT }}@github.com/mohannadrabie/adr.git.insteadOf
    GIT_CONFIG_VALUE_0: https://github.com/mohannadrabie/adr.git
  run: |
    git submodule update --init --recursive
```

`git -c url."...".insteadOf="..." submodule update --init --recursive` also works — verified, `EXIT=0`, zero residue — but puts the token in `/proc/<pid>/cmdline` for the duration of the call. The `GIT_CONFIG_*` form has neither the file nor the argv exposure, so prefer it. This form also closes finding 5 for free, by pinning the key to `.../adr.git`.

Named test: **`ci-no-credential-residue-check`** — a step appended after submodule init asserting
`! grep -rq "x-access-token" "$HOME/.gitconfig" "$RUNNER_TEMP" 2>/dev/null`.

---

## 3. [ISSUE][MED][code-traced] — gitlink/remote push race: `thoth`'s master can pin an `adr` SHA that is not on the `adr` remote, and nothing checks

**Exposure: 1 of 2 historical `adr` gitlink bumps landed in this exact state, basis: counted in git history.**

### Attack
Assumption being broken: *"the SHA the superproject pins is fetchable."* CLAUDE.md makes any push to a default branch — **including the `adr` submodule's `main`** — human-only. The agent commits to `adr` locally and bumps `thoth`'s gitlink in the same session; the human pushes `adr` later, or not at all. Between those two moments, `thoth`'s `master` points at a SHA that does not exist on `mohannadrabie/adr`.

### Scenario — this already happened
```
$ git log --format="%h %ad %s" --date=short --diff-filter=M -- adr
79a6ab4 2026-09-01 Prep ADR-0021 acceptance (local, unpushed) + reconcile GitHub tracking ...
d3a833f 2026-08-30 S1 session close-out ...
```

Commit `79a6ab4` bumped `thoth`'s `adr` gitlink and **its own commit message declares the target "local, unpushed."** `docs/decisions.md`'s 2026-09-01 row says the same: *"**Not yet pushed** — the Manager held the push deliberately."* CI was already dead throughout that window, so it never surfaced. Once CI is alive, that same sequence fails `Init adr submodule` at the checkout stage — and the error text ("Failed to clone 'adr'", "Could not read from remote repository. Please make sure you have the correct access rights") reads as a **credential** failure, sending the next debugger straight back to the PAT that is in fact fine.

### Current defense (honestly assessed)
None in the diff. Nothing verifies gitlink reachability before merge, and the PAT-shaped error message actively misdirects. **The current state is safe** — verified, not assumed, against the authoritative remote:

```
$ git ls-remote https://github.com/mohannadrabie/adr
cdb245d977fd67889bf69c9710a13b70a8b5045f	HEAD
cdb245d977fd67889bf69c9710a13b70a8b5045f	refs/heads/main
$ git ls-tree HEAD adr
160000 commit cdb245d977fd67889bf69c9710a13b70a8b5045f	adr
$ gh api repos/mohannadrabie/adr/commits/cdb245d9... --jq .sha
cdb245d977fd67889bf69c9710a13b70a8b5045f
```

Gitlink equals `refs/heads/main` today. The `docs/decisions.md` "Not yet pushed" note is stale; the push happened. This is a **future** race, not a present breakage.

### Verdict: **BREAKS** (latent; re-arms on the next ADR acceptance)

### Required before merge — named test
**`adr-gitlink-reachable-on-remote-check`** — a pre-push/CI assertion that the gitlink SHA resolves on the remote, with an error string that names the real cause:
```sh
SHA=$(git ls-tree HEAD adr | awk '{print $3}')
git ls-remote https://github.com/mohannadrabie/adr | grep -q "$SHA" \
  || { echo "adr gitlink $SHA is NOT on the adr remote — push the adr submodule first (this is NOT a credential problem)"; exit 1; }
```
Acceptable alternative given the loud-failure profile: a `docs/backlog.md` residual-register line plus the improved error string. It must not be left silent.

---

## 4. [ISSUE][MED][demonstrated] — AC4's `git submodule status` is claimed as "mechanical proof the submodule content is present." It proves nothing.

**Exposure: the assertion gap is present in 100% of CI runs; the failure it fails to catch requires a `.gitmodules`/registration change to trigger. Basis: measured for the gap, assumption for the trigger frequency.**

### Attack
Assumption being broken: *"`git submodule status` proves `adr/` is populated."* `docs/decisions.md`'s 2026-09-09 Q3 ruling calls it *"direct, mechanical proof the private submodule content is actually present, at the exact spot that broke silently for 8+ days."* The CHANGELOG repeats it. Both are wrong on the mechanics.

### Scenario
Neither `git submodule update --init --recursive` nor `git submodule status` fails when there is nothing registered — both exit 0 and print **nothing**:

```
$ cd norepo   # a git repo with no submodules
$ git submodule update --init --recursive ; echo "EXIT=$?"
EXIT=0
$ git submodule status ; echo "EXIT=$?"
EXIT=0
```

And `git submodule status`'s output is never asserted on — it is a log line, printed into the same CI log nobody read for 8 days. That is the exact defense Issue #27 proved does not work.

Downstream, an empty `adr/` degrades silently rather than erroring. `src/lib/fs-walk.ts:15-18`:

```js
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;                      // missing root -> [], never an error
    }
```

so QA-14's `knownAdrIds` (`src/qa/reference-resolver.ts:249-253`) becomes an **empty set** with no error. The suite even names this state: `QA-14: no citations -> vacuous pass`. A diff citing no ADR then passes QA-14 green against zero ADRs. A diff citing `ADR-0021` fails with `"no ADR with this id exists in the tree"` (`reference-resolver.ts:67`) — loud, but misdiagnosed as a bogus citation rather than a missing submodule.

### Current defense (honestly assessed)
**The primary defense is real and I confirmed it works.** When the submodule *is* registered and unreachable, the step fails hard:

```
$ git submodule update --init --recursive     # registered, unreachable URL
fatal: 'PRIVATE-UNREACHABLE.git' does not appear to be a git repository
fatal: clone of '...' into submodule path '.../adr' failed
Failed to clone 'adr' a second time, aborting
EXIT=1
adr/ contents: []
```

GitHub Actions runs `run:` under `bash -e`, and the file has no `continue-on-error`, so `EXIT=1` -> red step -> red job. **The bad-credential and expired-PAT paths fail loud, not silent.** That is a genuine SURVIVES for the main partial-failure question.

What breaks is the **claim**, and the defense-in-depth layer the human explicitly ruled in as AC4. The gap only opens if `adr` is ever de-registered from `.gitmodules` — and this project's own hard rule against hand-derived completeness claims is exactly why an unasserted diagnostic should not be sold as proof.

### Verdict: **BREAKS** (as an assurance claim; the primary fail-loud path SURVIVES)

### Required before merge — named test
**`ci-adr-submodule-populated-assert`** — replace the bare diagnostic with a real assertion:
```sh
git submodule status
test -n "$(ls -A adr/devops 2>/dev/null)" && test -n "$(ls -A adr/software-engineering 2>/dev/null)" \
  || { echo "adr submodule did not populate — QA-14 would run against an EMPTY ADR catalog"; exit 1; }
```
Then correct the CHANGELOG line so it claims what the step actually does.

---

## 5. [ISSUE][LOW][demonstrated] — `url.insteadOf` matches by raw string prefix, not path component

### Attack and scenario
The configured key is `https://github.com/mohannadrabie/adr` — **no `.git` suffix**. `insteadOf` is a byte-prefix match, so it also captures every sibling repo whose name starts with `adr`:

```
$ git config --global url."file://$SB/REWRITTEN".insteadOf "https://github.com/mohannadrabie/adr"
$ GIT_TRACE=1 git ls-remote https://github.com/mohannadrabie/adrenaline
trace: run_command: ... 'git-upload-pack '\''.../REWRITTENenaline'\'''
```

`.../adrenaline` was rewritten to `REWRITTEN` + `enaline`. Any future `mohannadrabie/adr*` repo fetched in this job — a second submodule, a git-URL npm dependency — silently receives the PAT.

### Current defense (honestly assessed)
Weak by construction, but the **impact is genuinely small**: the rewrite target is still `github.com` over TLS, so the token goes to its legitimate issuer, not a third party. It is over-scoping, not exfiltration. No such sibling repo exists today (`git ls-remote` shows the `adr` repo only; `.gitmodules` declares exactly one submodule). Also confirmed the intended URL still matches with the `.git` suffix `.gitmodules` actually uses, so the current key does work:

```
$ cat .gitmodules
[submodule "adr"]
	path = adr
	url = https://github.com/mohannadrabie/adr.git
$ GIT_TRACE=1 git ls-remote https://github.com/mohannadrabie/adr.git
trace: run_command: ... '.../REWRITTEN.git'
```

### Verdict: **BREAKS** (LOW — hardening, non-gating)

### Fix
Pin the key to the exact URL `.gitmodules` declares: `.../mohannadrabie/adr.git`. **Finding 2's recommended `GIT_CONFIG_*` rewrite already does this**, so both close in one edit.

---

## 6. [ISSUE][LOW][demonstrated] — a missing/empty `ADR_REPO_PAT` passes the "Configure credential" step and misattributes the failure one step later

### Attack and scenario
This is **today's actual state** — `gh secret list --repo mohannadrabie/thoth` returns empty; the secret does not exist. `secrets.ADR_REPO_PAT` then expands to the empty string, and `git config` accepts the degenerate key without complaint:

```
$ git config --global url."https://x-access-token:@github.com/mohannadrabie/adr".insteadOf "https://github.com/mohannadrabie/adr2"
config-with-empty-token EXIT=0
```

So step 2 `Configure credential` reports **green**, and the job dies at step 3 `Init adr submodule` with `Could not read from remote repository. Please make sure you have the correct access rights` — indistinguishable from an expired PAT, a revoked PAT, or finding 3's unpushed-gitlink case.

### Current defense (honestly assessed)
Fails loud (job red), so no silent degradation — but points at the wrong step. Relevant beyond first-run: the 90-day expiry is acknowledged in `docs/backlog.md` with no rotation automation, so this exact message is what day 91 looks like.

### Verdict: **BREAKS** (LOW — diagnostic quality)

### Fix — named test `ci-adr-pat-presence-precheck`
One line ahead of the config, naming its own unlock per PRINCIPLES rule 2:
```sh
[ -n "${ADR_REPO_PAT:-}" ] || { echo "ADR_REPO_PAT secret is not set — create it: gh secret set ADR_REPO_PAT --repo mohannadrabie/thoth (fine-grained, mohannadrabie/adr only, Contents: Read-only)"; exit 1; }
```

---

## 7. [SUSPICION][MED][demonstrated] — nothing past `Checkout` has executed in the real runner environment in over 8 days; 23 steps are unproven

### Attack
Every step from `Set up Node.js` to `Upload OSS-01 redacted report` has run `skipped` on 12 consecutive push runs. This diff will, for the first time, deliver each of them a runner state that has **never existed before**: a populated `adr/` directory inside the workspace.

Unknowns I could not settle from this workstation:
- Does the newly-present `adr/` (with its own `.git`) change `OSS-01 full-history secret scan`, `QA-01 fixture-coverage-check`, `QA-05 fixture-isolation-check`, or `QA-16 broken-instrument-gate` behaviour? These have never run with `adr/` populated in CI.
- Do Linux-vs-Windows path assumptions hold? Every local verification in this report ran on `win32`; CI is `ubuntu-latest`.
- Does `npm ci` succeed on the runner at all? Never observed.

### Current defense (honestly assessed)
The local suite is green apart from Issue #113, and `fs-walk` skips `.git` directories explicitly (`src/lib/fs-walk.ts:21`), which covers the most likely `adr/.git` traversal hazard. That is reassuring, not proof — local `node_modules` and a Windows filesystem are not the runner.

### Verdict: **UNPROVEN-pending-verification**

**Command that settles it:** the same `ci-green-end-to-end-drill` from finding 1 — one push to a throwaway branch after the secret exists and #113 is resolved, then `gh run view <id> --json jobs`. **Who runs it:** the human (secret creation) + Manager (branch push, non-default). This is a task, not a blocker on its own.

---

# SURVIVES — attacks I ran that the design withstood

| # | Attack | Evidence | Verdict |
|---|---|---|---|
| 8 | **Does a `--global` `insteadOf` actually drive `git submodule update --init --recursive`?** The whole fix rests on this. | Built a superproject pinning an unreachable URL; with the global rewrite: `Submodule path 'adr': checked out '27e8900...'`, `EXIT=0`, `adr/` populated. | **SURVIVES** [demonstrated] |
| 9 | **Does the token leak into repo config, where `upload-artifact` or a commit could carry it?** | After a successful rewritten fetch, both configs retain the **clean** `.gitmodules` URL: `submodule.adr.url = file:///.../PRIVATE-UNREACHABLE.git` and `.git/modules/adr` `remote.origin.url` identical. The rewrite is transport-time only; the token is never written into `.git/config` or `.git/modules/adr/config`. | **SURVIVES** [demonstrated] |
| 10 | **Does `actions/checkout`'s persisted `GITHUB_TOKEN` extraheader override the PAT and 403 the fetch?** The failure mode that would make the whole fix silently not work. | Superproject-**local** config demonstrably does not reach the submodule clone (`EXIT_with_LOCAL_only=1`, `adr/` empty), and `actions/checkout` writes `http.https://github.com/.extraheader` with `--local` (`configureToken(false)`); its global path (`configureGlobalAuth`) only runs when `submodules:` is set — which this diff removed. No Authorization-header collision. | **SURVIVES** [demonstrated] |
| 11 | **Partial apply: config step succeeds, fetch fails — does CI silently pass against an empty `adr/`?** | `EXIT=1`, `adr/ contents: []`, `Failed to clone 'adr' a second time, aborting`. `run:` uses `bash -e`; no `continue-on-error` in the parsed YAML. Red step -> red job. (See finding 4 for the one residual sub-case.) | **SURVIVES** [demonstrated] |
| 12 | **Forked-PR secret exfiltration.** | Confirmed, not assumed: `find .github -type f` -> `.github/workflows/ci.yml` only; no `pull_request_target` anywhere; `permissions: contents: read`; no `id-token`; repo is `{"isFork":false,"visibility":"PRIVATE"}`. Fork PRs receive no secrets and there is no privileged-context trigger to abuse. Forward-looking, non-blocking: if `thoth` ever goes public (the `oss` requirement group suggests intent), every external fork PR will fail at `Init adr submodule` with no secret. Fail-closed, but fork PRs can then never be green. Worth a backlog line before any open-sourcing. | **SURVIVES** [code-traced] |
| 13 | **Concurrency / runner reuse — `git config --global` leaking across unrelated jobs.** | Both jobs are `runs-on: ubuntu-latest`, so GitHub-hosted ephemeral VM, one job per VM, `~/.gitconfig` destroyed at job end. `setup-node`'s `cache: npm` caches `~/.npm`, not `~/.gitconfig`; `upload-artifact` uploads only `docs/qa/history-scan-report.json`. No cross-job or cache-mediated leak path. Contingent on staying GitHub-hosted: on a self-hosted runner the `--global` write becomes persistent cross-job credential residue. Finding 2's fix removes that contingency. | **SURVIVES** [code-traced] |
| 14 | **`--recursive` pulling a nested submodule to an unrewritten third-party host, or handing the PAT to one.** | `git -C adr ls-tree HEAD` shows no `160000` gitlinks; no `adr/.gitmodules`. `--recursive` is a no-op beyond `adr`. | **SURVIVES** [demonstrated] |
| 15 | **Is the CHANGELOG's self-reported verification honest, or inflated?** | Reproduced exactly: typecheck `EXIT=0`, lint `EXIT=0`, `tests 658 / pass 657 / fail 1 / skipped 0`. The 1 failure is genuinely pre-existing (Issue #113 `OPEN`). Added diff lines introduce no new secret-scan bait (grep for internal-hostname/AKIA/ghp_/github_pat_ shapes over added lines -> none). YAML parses; `permissions` and triggers are as documented. **Honest reporting, including the inconvenient number.** | **SURVIVES** [demonstrated] |
| 16 | **Scope discipline / gold-plating (PRINCIPLES rule 12).** | Diff confined to `.github/workflows/ci.yml`, `docs/backlog.md`, `CHANGELOG.md`. The 90-day rotation reminder went to `docs/backlog.md`, not into the diff as automation — correct per the human's Q2 ruling. No unrelated edits. | **SURVIVES** [code-traced] |

**Design-level credit where due.** The human Q1 ruling (adr-only PAT, `thoth`'s own checkout keeps the unwidened default `GITHUB_TOKEN`) is materially safer than the obvious alternative — `actions/checkout` with `token: secrets.ADR_REPO_PAT`, which would have used the PAT for **both** checkouts. The implementation honors that ruling correctly, and removing `submodules: recursive` from the checkout step was **necessary**, not a deviation: `actions/checkout` fetches submodules inside its own step, before any later credential step could possibly run. `docs/decisions.md`'s earlier 2026-09-09 row says "restoring `ci.yml`'s existing `submodules: recursive` checkout as originally designed," which reads as a conflict at a glance — the same day's more specific Phase 1 ruling authorizes this mechanism, and per PRINCIPLES rule 9's more-specific-wins tiebreak the implementation is correctly governed. **Not a finding.**

**Deploy key vs PAT (flagged, non-blocking, as requested).** A repo-scoped read-only **deploy key** on `mohannadrabie/adr` would be narrower than even a fine-grained PAT: bound to one repository by construction rather than by configuration, no expiry (removing the 90-day rotation cliff that finding 6 and the backlog entry both circle), and not tied to a user account, so it survives offboarding. Costs: SSH transport requires an `ssh-agent`/`known_hosts` step and a `.gitmodules` URL scheme change (or an SSH-direction `insteadOf` rewrite) — more moving parts than the current one-liner. **The PAT choice is defensible and was human-ruled; do not reopen it for this change.** Worth a backlog line for the next rotation cycle.

---

# Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `CHANGELOG.md`: "a direct, mechanical diagnostic line **proving** the private submodule content is actually present" — `git submodule status` proves no such thing (finding 4). Reword to "printing the resolved submodule SHA for log-forensics" and add the real assertion.
2. `CHANGELOG.md`: "AC3/AC4/AC5 ... are NOT YET VERIFIABLE — `ADR_REPO_PAT` doesn't exist as a repo secret until the human creates it" — incomplete. Creating the secret is necessary but not sufficient; Issue #113 also blocks (finding 1). Add the second precondition.
3. `docs/decisions.md`, 2026-09-01 row: "**Not yet pushed** — the Manager held the push deliberately" is stale. `cdb245d` is on `refs/heads/main` today (verified). Append a correcting row rather than editing; this file is append-only.
4. `CHANGELOG.md` says "edits confined to `.github/workflows/ci.yml`, `docs/backlog.md`, this entry" — accurate for the approved change, but the working tree also carries modifications to `docs/.maat-state.json`, `docs/decisions.md`, and `docs/run-log.jsonl` (workflow bookkeeping, expected). One clarifying clause so the claim is not read as a whole-tree completeness statement.

---

# Bottom line

## Single scariest unproven assumption
**That merging this diff makes CI work.** It restores the `adr` submodule — I verified the mechanism does exactly what it claims — but `npm test` fails deterministically at step 8 on an open, separately-tracked issue, so `QA-14` (the only consumer of the submodule this change exists to restore) and `OSS-01`'s secret scan **still never execute**. The measured harm in Issue #27 — every QA/OSS gate having run zero times in CI across S1-S6 — is unchanged by this diff. Everything downstream of `Checkout` remains unexecuted in a real runner, so 23 of 26 steps stay untested.

## Verdict: **no-go**
Not on the workflow edit, which is sound and, in three separate respects (transport-only credential scoping, no `GITHUB_TOKEN` collision, loud failure on bad credentials), better than I expected going in. **No-go on shipping this as the closure of Issue #27**, on one demonstrated HIGH backed by an accepted-ADR MUST (devops ADR-0008: "MUST NOT merge a PR with any blocking gate open, failing, or pending").

## Single next action
**Resolve Issue #113 so `npm test` can go green, then run `ci-green-end-to-end-drill`** — the human creates `ADR_REPO_PAT`, push to a throwaway branch, and confirm via `gh run view <id> --json jobs` that all 26 steps report `success`, `QA-14 reference-resolver` and `OSS-01 full-history secret scan` among them. That single run closes finding 1, closes suspicion 7, and is the only evidence that can legitimately close Issue #27.

## Findings to tests (equal counts, PRINCIPLES rule 19)
6 open findings, 6 named tests — no gap:

| # | Finding | Named failing test / drill |
|---|---|---|
| 1 | HIGH — gates unreachable behind #113 | `ci-green-end-to-end-drill` |
| 2 | MED — PAT plaintext on runner for 23 steps | `ci-no-credential-residue-check` |
| 3 | MED — gitlink/remote push race | `adr-gitlink-reachable-on-remote-check` |
| 4 | MED — `git submodule status` asserts nothing | `ci-adr-submodule-populated-assert` |
| 5 | LOW — `insteadOf` prefix over-scope | closed by finding 2's `GIT_CONFIG_*` rewrite (`.../adr.git` pin) |
| 6 | LOW — empty-secret misattribution | `ci-adr-pat-presence-precheck` |

Suspicion 7 has no independent executable form — it is settled by finding 1's drill, which is why the counts do not double-count it.

---

```
RECEIPT: verdict=no-go
attacks (ALL, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] CI still cannot go green — npm test (step 8) fails deterministically on OPEN Issue #113, so steps 9-26 incl. QA-14 (sole adr/ consumer) + OSS-01 secret scan never run; Issue #27's substance unchanged; violates devops ADR-0008 "MUST NOT merge a PR with any blocking gate open, failing, or pending". Defense: CHANGELOG discloses the failing test but not its consequence. Exposure: ~100% of runs, basis: measured. -> ci-green-end-to-end-drill
2. [ISSUE][MED][demonstrated] git config --global writes the PAT plaintext into ~/.gitconfig (+ the run: temp script) at step 2, live for 23 later steps incl. npm ci over 83 packages with ignore-scripts unset; no cleanup, no env-scoping. Defense: log masking + ephemeral runner only — nothing guards the on-runner filesystem. Verified fix: GIT_CONFIG_COUNT env form, EXIT=0, zero residue. Exposure: ~100% of runs, basis: measured. -> ci-no-credential-residue-check
3. [ISSUE][MED][code-traced] Gitlink/remote race — thoth master can pin an adr SHA not pushed to the remote (push is human-only); commit 79a6ab4 "Prep ADR-0021 acceptance (local, unpushed)" did exactly this, 1 of 2 historical bumps; failure text reads as a credential error and misdirects. Defense: none; current SHA verified reachable today via ls-remote. Exposure: 1/2 gitlink bumps, basis: counted in git history. -> adr-gitlink-reachable-on-remote-check
4. [ISSUE][MED][demonstrated] AC4's git submodule status claimed as "mechanical proof content is present" — demonstrated to exit 0 printing nothing with no submodule registered, output never asserted on; fs-walk.ts:15-18 returns [] for a missing adr/devops, so an empty catalog yields a vacuous QA-14 pass. Defense: primary fail-loud path (EXIT=1 on unreachable submodule under bash -e) genuinely SURVIVES; the assurance claim does not. Exposure: gap in ~100% of runs, basis: measured; trigger frequency basis: assumption. -> ci-adr-submodule-populated-assert
5. [ISSUE][LOW][demonstrated] url.insteadOf is a raw byte-prefix match — .../adrenaline demonstrably rewrites through the .../adr key, so any future adr* sibling repo silently receives the PAT. Defense: none, but token still only reaches github.com over TLS and no such repo exists today. -> closed by finding 2's .../adr.git pin
6. [ISSUE][LOW][demonstrated] Empty/missing ADR_REPO_PAT (today's real state) still passes the "Configure credential" step (git config EXIT=0), pushing the failure one step later with a message indistinguishable from expiry, revocation, or finding 3. Defense: loud but misattributed; matters again at the 90-day expiry with no rotation automation. -> ci-adr-pat-presence-precheck
7. [SUSPICION][MED][demonstrated] 23 of 26 steps have never executed in the real runner (12/12 push runs skipped past Checkout); adr/ populated in the workspace is a state CI has never seen, and all local verification ran on win32 vs ubuntu-latest. Settled by finding 1's drill; not independently blocking.
8. [CLEAN][demonstrated] Global insteadOf genuinely drives git submodule update --init --recursive — EXIT=0, submodule checked out, content present. The core mechanism works.
9. [CLEAN][demonstrated] Token never persisted into .git/config or .git/modules/adr/config — both retain the clean .gitmodules URL; rewrite is transport-time only, so no artifact/commit can carry it.
10. [CLEAN][demonstrated] No GITHUB_TOKEN extraheader collision — superproject-local config demonstrably does not reach the submodule clone, and actions/checkout writes extraheader --local (its global path runs only with submodules: set, which this diff removed).
11. [CLEAN][demonstrated] Partial-failure: bad/expired/absent credential -> git submodule update EXIT=1 under bash -e, no continue-on-error in the parsed YAML -> red step, red job. Fails loud, not silent.
12. [CLEAN][code-traced] No forked-PR exfiltration path — confirmed not assumed: .github/workflows/ci.yml is the only workflow file, no pull_request_target, permissions: contents: read, repo PRIVATE and not a fork.
13. [CLEAN][code-traced] Concurrency/runner reuse safe — both jobs ubuntu-latest (ephemeral, one job per VM); cache: npm caches ~/.npm not ~/.gitconfig; artifact upload scoped to one JSON file.
14. [CLEAN][demonstrated] --recursive is a no-op beyond adr — no adr/.gitmodules, no gitlinks in its tree; cannot reach an unrewritten third-party host.
15. [CLEAN][demonstrated] CHANGELOG's verification claims reproduce exactly (typecheck 0, lint 0, 658/657/1/0); the 1 failure is genuinely pre-existing; added lines add no new secret-scan findings. Honest reporting including the inconvenient number.
16. [CLEAN][code-traced] Scope discipline clean — diff confined to the three approved files; rotation reminder correctly went to docs/backlog.md, not into the diff as automation.
counts (CHECKSUM): issues=6 suspicions=1 clean=9
evidence (CHECKSUM): demonstrated=12 code-traced=4 derived=0
checks=typecheck exit 0 (pass); lint exit 0 (pass); npm test 658 total / 657 pass / 1 fail / 0 skipped (fail = pre-existing OSS-01 dogfood, Issue #113 OPEN); ci.yml YAML parse OK (26 steps enumerated); 7 git submodule/insteadOf lab experiments (A-G) completed; gh run list 18 failure / 10 success; gh run view 34398589099 + 34287186484 (Checkout=failure, steps 3-24=skipped); git ls-remote + gh api confirm gitlink cdb245d on refs/heads/main
adr=HIT(35)
report=docs/reviews/cifix-red-team-2026-09-09.md
```
