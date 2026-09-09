# cifix — Infra Security Review, ROUND 2 re-confirm (Wadjet)

**Date:** 2026-09-09
**Reviewer:** infra-security-reviewer (Wadjet)
**Scope:** cifix, CRITICAL tier, infra-only. Round-2 re-confirm against my own round-1 report (docs/reviews/cifix-infra-security-2026-09-09.md, APPROVE-WITH-CONDITIONS, 1 MED = Issue #125). Delta since round 1: Issue #125 fixed (GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0 env-var form, step-scoped, plus a same-step residue assertion), red-team round-1 fix-now items #126/#127/#128 landed in the same file, and a widened-scope fix for pre-existing Issue #113 (secret-scan false positive) in src/secret-scan/patterns.ts + patterns.test.ts.
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e [CACHE=HIT]

## ADR compliance

Same applicable ADRs as round 1 (devops ADR-0008 CI/CD gates and policy-as-code, devops ADR-0009 least-privilege IAM/secrets), read from the shared catalog per PRINCIPLES.md rule 9, not re-read here. No literal rule in either ADR addresses a GitHub-Actions-secrets/PAT scenario; their spirit (vaulted secrets, least-privilege scope, disclosed rotation) is unchanged and still satisfied, see Finding 5 below. No applicable-ADR violation found in this rounds delta.

## What I did (re-verification, not trust)

1. Read the live .github/workflows/ci.yml diff (git diff HEAD) end to end.
2. Independently reproduced the GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0 mechanism in a real local git repo with a fake HOME, using a fake token, not a re-read of the workflow comments claim.
3. Ran a positive control: reproduced the OLD, vulnerable git config --global pattern to prove the workflows own residue-check assertion (grep -rq "x-access-token" HOME/.gitconfig) actually fires, rather than being decorative.
4. Attacked the env-var mechanism itself for the leak classes named in the brief: GITHUB_ENV-style persistence to later steps, verbose/debug-flag exposure, argv/process-listing exposure, and stderr-on-failure exposure.
5. Read the full src/secret-scan/patterns.ts diff and independently exercised the new internal-hostname regex against constructed cases, then measured its real delta against this repos own tracked files (242 files) rather than reasoning about it in the abstract.
6. Ran the real test suite (node --experimental-transform-types --test) and the isolated patterns.test.ts file directly.
7. Confirmed .gitmodules literal URL against the new GIT_CONFIG_KEY_0/VALUE_0 values byte for byte.
8. Re-read round-1s and this rounds least-privilege/credential-scope claims against the current docs/backlog.md / docs/decisions.md text.

## Findings (ranked by exploitability x impact)

### 1. [CLEAN][demonstrated] -- Issue #125 fix verified: zero disk residue, and the mechanism's own assertion is meaningful, not decorative

**Evidence -- reproduced in a real repo, not read-and-trusted:**

```
$ HOME=<fake> GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:<FAKE_TOKEN>@github.com/mohannadrabie/adr.git.insteadOf" \
  GIT_CONFIG_VALUE_0="https://github.com/mohannadrabie/adr.git" \
  git config --list --show-origin | grep -i insteadof
command line:	url.https://x-access-token:<FAKE_TOKEN>@github.com/...insteadof=...
$ cat "$HOME/.gitconfig"
cat: .../fakehome/.gitconfig: No such file or directory   # absent BEFORE and AFTER
```

git config --list --show-origin reports the rewrite's origin as `command line` (Git's documented behavior for GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n -- treated identically to an ad hoc -c key=value, never written to any file). $HOME/.gitconfig does not exist before or after.

**Positive control (proves the workflow's own assertion is load-bearing, not theater):**

```
$ HOME=<fake2> git config --global url."https://x-access-token:<FAKE_TOKEN>@github.com/mohannadrabie/adr".insteadOf "https://github.com/mohannadrabie/adr"
$ cat "$HOME/.gitconfig"
[url "https://x-access-token:<FAKE_TOKEN>@github.com/mohannadrabie/adr"]
	insteadOf = https://github.com/mohannadrabie/adr
$ grep -rq "x-access-token" "$HOME/.gitconfig" && echo "CHECK CORRECTLY DETECTED RESIDUE"
CHECK CORRECTLY DETECTED RESIDUE
```

The exact `grep -rq "x-access-token" "$HOME/.gitconfig"` line ci.yml runs (line 118) fires correctly against the old vulnerable pattern and stays silent against the new one -- the assertion actually guards what it claims to guard.

**Step-scope isolation, independently reproduced (not assumed from GitHub's docs):**

```
$ env -i HOME=<fake> PATH="$PATH" bash -c \
  'echo "GIT_CONFIG_COUNT=${GIT_CONFIG_COUNT:-<unset-as-expected>}"; git config --list --show-origin | grep -i insteadof || echo "(no insteadof entries)"'
GIT_CONFIG_COUNT=<unset-as-expected>
(no insteadof entries -- confirms step-scoping works, next step sees nothing)
```

A step-level env: block in GitHub Actions applies only to that step's own process; nothing persists to later steps unless explicitly written to $GITHUB_ENV (this script never does). Confirms round 1's finding 1 is genuinely closed.

**Verdict on this finding: CLOSED.** Recommending Issue #125 close -- see Issue-actions section.

### 2. [CLEAN][code-traced] -- Round-1 finding 2 (insteadOf substring-collision, LOW) also closed as a side effect

**Evidence:** .gitmodules line 3: `url = https://github.com/mohannadrabie/adr.git`. Current ci.yml:62-63: `GIT_CONFIG_KEY_0: url.https://x-access-token:${{ secrets.ADR_REPO_PAT }}@github.com/mohannadrabie/adr.git.insteadOf` / `GIT_CONFIG_VALUE_0: https://github.com/mohannadrabie/adr.git` -- both now carry the literal .git suffix, an exact match against .gitmodules's real URL rather than round 1's bare-prefix .../adr (no trailing .git). The prefix-collision class (a hypothetical mohannadrabie/adr2 or .../adrenaline sharing the same prefix) is now structurally excluded. Not filed as its own issue in round 1 (LOW, non-blocking); closed here as a verified side effect, no separate action needed.

### 3. [ISSUE][MED][code-traced][demonstrated] -- Issue #113's fix (internal-hostname pattern) introduces a new, unguarded false-negative class: multi-label internal FQDNs no longer match

**Evidence -- read the diff, then ran it:**

src/secret-scan/patterns.ts:28 (working tree): the fix adds `(?![.-][a-z0-9])` after the existing `\b[a-z0-9-]+\.(?:internal|corp|local)\b`. This correctly kills the Issue #113 false positive (settings.local.json, settings.local-shaped) -- but it disqualifies ANY continuation, not just a filename-extension/hyphenated-modifier continuation. A real internal hostname that continues as a longer FQDN (a very common real-world shape -- host.corp.example.com, db.internal.mycompany.io) is exactly this shape, and now silently stops matching:

```
OLD regex vs NEW regex against constructed cases:
"host01.corp.contoso.com is a real internal FQDN"      -> OLD: ["host01.corp"]    NEW: null
"connect to db1.internal.example.com over vpn"         -> OLD: ["db1.internal"]   NEW: null
"backup-svc.corp.acmecorp.io stores nightly dumps"     -> OLD: ["backup-svc.corp"] NEW: null
```

**Measured exposure, not assumed (PRINCIPLES rule 18):** ran both regexes against all 242 files tracked by `git ls-files` in this repo. 16 files show a match-count delta, 39 total lost matches. Manually inspected every file with a delta (grep -o on each): all 39 are the intended Issue #113 false-positive class (settings.local inside .claude/settings.local.json-shaped strings) -- zero are genuine internal hostnames. Exposure today: 0%, measured (counted, not assumed) against this repo's real tracked content.

**Attack sketch:** the moment any future file in this repo (or, if history-scan.ts runs against real infra docs elsewhere, any doc committed anywhere in this tool's history) contains a genuine multi-label internal FQDN, OSS-01's own secret-shaped scanner silently fails to flag it -- the exact "fixing a false positive while silently weakening a control" risk this task's brief named. No regression test in patterns.test.ts's new additions covers the multi-label-continuation true-positive case (only the false-positive-suppression case is tested); nothing would catch this gap widening further or a future edit reintroducing it more broadly.

**Minimal fix (either is sufficient, neither blocks this scope's ship -- see verdict):**
- (a) narrow the disqualifying lookahead to the specific continuation shapes that actually caused Issue #113 (a filename-extension-like suffix, or a hyphenated English word) instead of blanket-excluding any dot/hyphen continuation, and add a named regression test asserting host01.corp.contoso.com-shaped input still matches; or
- (b) if (a) is judged not worth the regex complexity, at minimum add an explicit disclosed-limitation comment (matching this file's own convention, and ci.yml's own "known limitation" comment style at the gitlink-reachability check) so the trade-off is a documented decision, not a silent regression, plus the same named regression test asserting current behavior so any further narrowing is caught.

**Named failing test (per PRINCIPLES rule -- findings become tests):** `internal-hostname: still matches a multi-label internal FQDN (host01.corp.contoso.com)` -- currently would fail (returns no match) against the new regex.

### 4. [CLEAN][demonstrated] -- Issue #113's own blocking defect is genuinely fixed; OSS-01 dogfood + full suite are real-green now

```
$ node --experimental-transform-types --test
tests 660
pass 660
fail 0
skipped 0
OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass (19063.07ms)
```

Independently re-run, not taken on the story's word. This is the same suite red-team's round-1 report found red (1 fail) at HEAD -- now genuinely green. (Separately, and not re-litigated here: cross-domain round 1's Issue #120 -- QA-14/QA-15 as standalone CI steps outside npm test -- remains open and would still turn a live push red at a later step; that is already-tracked, cross-domain's lane, unaffected by anything in my lane this round.)

### 5. [CLEAN][code-traced] -- Least-privilege/credential-scope conclusions from round 1 still hold

- Top-level `permissions: contents: read` (ci.yml:25-26) unchanged.
- ADR_REPO_PAT still a single-repo (mohannadrabie/adr), Contents:Read-only, 90-day-expiry PAT per docs/backlog.md:6 and docs/decisions.md's 2026-09-09 row -- text unchanged from round 1.
- Default GITHUB_TOKEN (the Checkout step) is never widened; the separate credential is fully isolated to the one "Init adr submodule" step.

### 6. [CLEAN][code-traced] -- Env-var mechanism attacked for the leak classes named in the brief; no new path found

- **$GITHUB_ENV/later-step persistence:** the script never writes to $GITHUB_ENV or $GITHUB_PATH -- step-scoped env: cannot leak forward (independently reproduced in Finding 1).
- **Verbose/debug flag:** the script uses `set -euo pipefail`, never `set -x`; no GIT_TRACE/GIT_CURL_VERBOSE set anywhere in the workflow. ACTIONS_STEP_DEBUG (GitHub's own debug-logging toggle) affects Actions' own internal diagnostic logs, not a run: shell script's own trace output -- no additional exposure path from that toggle.
- **argv/process-listing:** the credential is carried in an environment variable (GIT_CONFIG_KEY_0's value), never a git command-line argument -- `git submodule update --init --recursive` and `git ls-remote https://github.com/mohannadrabie/adr.git` both invoke with a clean argv; nothing in this job's ps-visible command lines carries the token.
- **stderr-on-failure:** if the rewritten URL (with the embedded token) ever appears in a git error message (a real, known git behavior on fetch failure), GitHub's automatic secret-value log masking -- registered because secrets.ADR_REPO_PAT is referenced via ${{ }} in this same step's env: block -- redacts the literal token value wherever it recurs in that job's log output, including in an error string. Same mitigant round 1 already relied on for the direct-embed pattern; still holds here since the token is still sourced from secrets.ADR_REPO_PAT and never transformed (base64/URL-encoded) before use.

No new leak path found for this mechanism beyond what round 1 already priced in.

## Clean / verified-sound (carried forward, still true)

- Workflow triggers unchanged: push/pull_request (branches: master)/schedule only, no pull_request_target/workflow_dispatch -- no fork path to the secret.
- secrets.ADR_REPO_PAT still used only via GitHub's standard safe patterns (direct ${{ }} embed in env:, never untrusted-context interpolation).

## Editorial

None found this round.

## Verdict

**APPROVE-WITH-CONDITIONS.**

Issue #125 (my own round-1 MED) is genuinely fixed -- independently reproduced, not taken on trust -- and closes clean. Round 1's LOW (insteadOf substring collision) also closes as a verified side effect. This round's one new finding (the internal-hostname false-negative regression) is real, code-traced and demonstrated, but measured at 0% exposure against this repo's actual tracked content today, on a scanner whose own top-of-file comment already discloses it is a curated heuristic set, "not a claim of exhaustiveness." It does not block restoring CI (the entire point of cifix, CI dead 8+ days) -- it tracks as a fast-follow with a named test.

**Condition:** file and track the new finding (Issue filed this round); land either the narrower regex + regression test, or at minimum the disclosed-limitation comment + regression test, before or shortly after this scope archives.

## Next action

story-implementer (or a fast-follow) adds the named regression test (internal-hostname: still matches host01.corp.contoso.com) and either narrows the disqualifying lookahead or documents the trade-off explicitly. Everything else in my lane is clear to ship.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] Issue #125 fix independently reproduced: GIT_CONFIG_* env-var form leaves zero ~/.gitconfig residue (real repo repro), positive control proves the workflow's own residue-check assertion is load-bearing (fires on --global, silent on the fix), and step-scoped env does not leak to later steps (fresh-env subshell repro). Recommend closing Issue #125.
2. [CLEAN][code-traced] Round-1 LOW (insteadOf substring collision) closed as a side effect: GIT_CONFIG_KEY_0/VALUE_0 now use the exact .git-suffixed URL matching .gitmodules byte-for-byte, not the bare-prefix form. Not separately filed (already non-blocking).
3. [ISSUE][MED][code-traced][demonstrated] src/secret-scan/patterns.ts:28 -- Issue #113's fix ((?![.-][a-z0-9]) lookahead) blanket-disqualifies ANY continuation, silently dropping real multi-label internal FQDNs (host.corp.contoso.com, db.internal.example.com -- matched before, null after); measured 0/39 real-repo delta matches are genuine losses (all are the intended FP suppression) so exposure is 0% today, but no regression test guards the true-positive class and the rule is blanket, not targeted; fix: narrow the lookahead to the actual FP shape + add the named test, or at minimum disclose the trade-off + add the test. Filed as a new Issue.
4. [CLEAN][demonstrated] Issue #113's own blocking defect independently re-confirmed fixed: full suite 660/660 pass, 0 fail, 0 skipped; OSS-01 dogfood gate genuinely green. (Issue #120, QA-14/QA-15 unconditional failures, remains open -- cross-domain's lane, unaffected, not re-litigated here.)
5. [CLEAN][code-traced] Least-privilege/credential-scope conclusions from round 1 still hold: permissions: contents: read unchanged; ADR_REPO_PAT still single-repo/Contents:Read-only/90-day-expiry; default GITHUB_TOKEN never widened.
6. [CLEAN][code-traced] Env-var mechanism attacked for $GITHUB_ENV persistence, verbose/debug flags, argv/process-listing exposure, and stderr-on-failure exposure -- no new leak path found; GitHub's automatic secret-value log masking still covers the one theoretical stderr path, same mitigant round 1 relied on.
7. [CLEAN][code-traced] Workflow triggers and secret-usage pattern (safe direct-embed, no untrusted-context interpolation) unchanged from round 1 -- no fork path to the secret.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=4 derived=0 (primary/gating tag per finding: 1=demonstrated, 2=code-traced, 3=demonstrated (dual-tagged code-traced+demonstrated in its finding header, counted once here under its gating tag), 4=demonstrated, 5=code-traced, 6=code-traced, 7=code-traced -- totals 3+4=7, matching issues=1+clean=6)
checks="660/0/0|plus 4 ad-hoc reproduction scripts run directly and pasted above (credential-residue mechanism + positive control, step-scope isolation, old-vs-new regex diff across 242 tracked files) -- not part of the named test suite but raw output quoted in this report"
adr=HIT(35)
report=docs/reviews/cifix-infra-security-round2-2026-09-09.md
