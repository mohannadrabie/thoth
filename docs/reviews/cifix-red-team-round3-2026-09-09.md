# Red Team (Sutekh) — `cifix` adversarial re-confirm, ROUND 3

- **Scope:** `cifix` (`docs/.maat-state.json` -> `scope`), CRITICAL tier
- **Date:** 2026-09-09
- **HEAD:** `1b4053cfec43084a6cba411097cddf42012fa357` (uncommitted working-tree diff under attack)
- **Prior rounds:** `docs/reviews/cifix-red-team-2026-09-09.md` (`no-go`), `docs/reviews/cifix-red-team-round2-2026-09-09.md` (`no-go`)
- **Council read in full:** `cifix-design-challenger-stopbrief`, `cifix-architecture` (+ its same-session addendum, folded into the architecture report and `docs/backlog.md:55`), `cifix-impact-analyst-council`, `docs/decisions.md`'s 2026-09-09 "`cifix` design council" row (Path A ratified GO)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **ADR rules read for this attack surface:** devops ADR-0008 (CI/CD gates and policy-as-code — the **ratchet-only** rule and the "no merge with a blocking gate failing" MUST), devops ADR-0009 (secrets never in source/config), SE ADR-0005 (regression tests for every changed behavior; MUST NOT weaken a failing test), SE ADR-0001/devops ADR-0001 (obey Accepted ADRs' `Rules for agents`)
- **Verdict:** `no-go` — one blocking HIGH (NEW, never named by any prior round or council seat), two MED, two LOW, two suspicions, eleven CLEAN

> **Most of this round's fixes are genuinely good, and I closed them on my own re-run rather than on the receipt.** Issue #132's two failure paths are now truly distinguishable (I drilled both, plus a credential-leak canary on the new raw-output echo the fix introduced — it does not leak). Issue #130's narrowing is correct on 25 of 26 differential shapes. Issue #134's stated defect is measurably gone. All three new regression tests are non-vacuous under mutation. The staged set that story-implementer measured really does scan `ok=true`.
>
> The `no-go` is on something nobody looked at: **what the 17 new allowlist entries do going forward.** The allowlist matches on exact `path` + `patternId` with no value or line scoping, so an entry does not exempt *this diff's strings* — it exempts **that pattern in that file forever**. Seven of the 17 land on files that keep being written, and three of those blind OSS-01 to *credential* patterns inside a live source file. I planted a synthetic 93-character fine-grained PAT in `src/secret-scan/patterns.test.ts` and the gate returned `ok=true`; the identical string in a non-allowlisted file returned `ok=false`. `CHANGELOG.md:8`'s own ADR-0008 compliance claim — *"never a suppression-list broadening beyond this diff's own new content"* — is factually untrue of the mechanism the diff actually used.

---

## Method note

Every mechanical claim below is re-derived from a command I ran this session, raw output pasted. Simulated commits were built with `git commit-tree` against a throwaway `GIT_INDEX_FILE`; **`HEAD` and the real index were never touched** (re-verified after every drill). Every file I mutated was restored and re-verified by `git hash-object`, not by eye.

Counts of the allowlist delta and of the affected file set are **instrument-generated**, not hand-typed (CLAUDE.md hard rule, "no hand-derived completeness claims").

---

# Findings, ranked by blast radius

## 1. [ISSUE][HIGH][demonstrated] — an allowlist entry exempts a *pattern in a file forever*, not this diff's strings. 7 of the 17 new entries sit on files that keep being written; 3 of those blind OSS-01 to credential patterns in a live source file.

**Exposure: ~100% of all future matches of the named `patternId` in the 7 named files — measured (positive + negative control below). Frequency of a genuine secret arriving in one of those files: assumption; the *suppression* is not.** Security / secret-scanning category, so PRINCIPLES rule 21's narrow-exposure cap does not apply.

### Attack
Assumption being broken: *"Path A is a mechanical patch covering this diff's own new strings only"* (`docs/decisions.md`, 2026-09-09 council row; `CHANGELOG.md:8`). It is not, and cannot be, because of how the mechanism joins. `partitionAllowlisted` (`src/secret-scan/history-scan.ts:110`):

```ts
const hit = allowlist.some((e) => e.path === m.path && e.patternId === m.patternId);
```

No value. No line. No commit. No expiry. The entry is a standing, unbounded exemption for `(file, pattern)`.

### Scenario
Six weeks from now, a contributor debugging the `adr` submodule fetch pastes a live `ADR_REPO_PAT` into a `patterns.test.ts` fixture while reproducing a failure, and commits it. `npm test` is green. OSS-01 is green. The repo goes public. OSS-01's entire stated purpose (`history-scan.ts:1-5`: *"Full history shall be scanned for secrets, credentials, real account identifiers, internal hostnames and personal data before the repository is public"*) is defeated for exactly the credential class this diff was hardening.

**Demonstrated, with a positive control.** Same synthetic 93-char fine-grained PAT, two files, real scanner, real allowlist, `git commit-tree` simulation:

```
$ # planted in src/secret-scan/patterns.test.ts (ALLOWLISTED for github-pat + github-fine-grained-pat)
REF= 4b715474f2e784ea0b48e1b4ce317ee8723c410d | allowlistEntries= 22 | ok= true  | blocking= 0 | allowlisted= 130

$ # identical string planted in docs/STATE.md (NOT allowlisted) -- positive control, gate is live
REF= 8c60f76a8e611b7bf3d1b1725d5210dced6f2297 | allowlistEntries= 22 | ok= false | blocking= 1 | allowlisted= 128
  BLOCKING x1  docs/STATE.md [github-fine-grained-pat]
```

Same again for `internal-hostname`, with two genuine (never-before-seen, non-exemplar) corporate FQDNs appended to `CHANGELOG.md` and `docs/REVIEW_LOG.md`:

```
$ # payments-db-prod-07.corp.acmebank.internal + jumpbox-eu-west-1.corp.acmebank.internal
REF= d62cf5feb5c471591dc801c889beb55ea9bdd888 | allowlistEntries= 22 | ok= true | blocking= 0 | allowlisted= 132
```

`allowlisted` went 128 -> 132: the four new genuine hostnames were **found, matched, and waved through**.

### Which entries, machine-enumerated (not eyeballed)

```
allowlist entries: HEAD=5 NOW=22 ADDED=17 REMOVED=0
entries missing a reason field: 0

ADDED entries, with commit-count of target file at HEAD:
  churn=  18  APPEND-FOREVER-HIGHCHURN  CHANGELOG.md  [internal-hostname]
  churn=  18  APPEND-FOREVER-HIGHCHURN  docs/REVIEW_LOG.md  [internal-hostname]
  churn=   1  live-source-lowchurn      docs/qa/secret-scan-allowlist.json  [internal-hostname]
  churn=   1  live-source-lowchurn      src/secret-scan/patterns.test.ts  [github-fine-grained-pat]   <== credential
  churn=   1  live-source-lowchurn      src/secret-scan/patterns.test.ts  [github-pat]                <== credential
  churn=   1  live-source-lowchurn      src/secret-scan/patterns.test.ts  [internal-hostname]
  churn=   1  live-source-lowchurn      src/secret-scan/patterns.ts  [internal-hostname]
  churn=   0  write-once-dated          docs/plans/cifix-phase1-2026-09-09.md  [internal-hostname]
  churn=   0  write-once-dated          docs/reviews/cifix-cross-domain-round2-2026-09-09.md  [github-fine-grained-pat]
  churn=   0  write-once-dated          docs/reviews/cifix-cross-domain-round2-2026-09-09.md  [github-pat]
  churn=   0  write-once-dated          docs/reviews/cifix-design-challenger-stopbrief-2026-09-09.md  [internal-hostname]
  churn=   0  write-once-dated          docs/reviews/cifix-impact-analyst-council-2026-09-09.md  [internal-hostname]
  churn=   0  write-once-dated          docs/reviews/cifix-infra-security-round2-2026-09-09.md  [internal-hostname]
  churn=   0  write-once-dated          docs/reviews/cifix-red-team-2026-09-09.md  [email-address]
  churn=   0  write-once-dated          docs/reviews/cifix-red-team-round2-2026-09-09.md  [email-address]
  churn=   0  write-once-dated          docs/reviews/cifix-red-team-round2-2026-09-09.md  [internal-hostname]
  churn=   1  write-once-dated          docs/reviews/s5-...-design-challenger-round2-2026-09-06.md  [github-fine-grained-pat]
```

**The 10 `write-once-dated` entries are fine** — a dated review report is written once and never edited (PRINCIPLES rule 11), so its blob is fixed and the exemption can never cover content that does not exist yet. I am not attacking those. **The 7 others are the finding**, and the three on `patterns.test.ts` are the sharp end: a test file is the classic accidental-credential-paste location, and it is now permanently blind to *both* PAT patterns.

Note also the brief I was handed said **16** new entries; the instrument says **17**.

### Current defense (honestly assessed)
**Weak, but not zero — three real mitigations, none sufficient:**
1. An allowlisted match is still **reported** (`history-scan.ts:119-121`). So it is not fully silent. But the current output carries **128 ALLOWLISTED lines**; a 129th is not a signal anyone reads. And the *gate* — the only thing CI acts on — is silent by construction.
2. Every one of the 17 entries carries a real, specific `reason`. Instrument-checked: `entries missing a reason field: 0`. The authoring discipline is good; the mechanism just does not do what the reasons say it does.
3. `docs/qa/secret-scan-allowlist.json` is a reviewed, separately-diffed file — a genuine "allowlist touched" tripwire in a PR. That tripwire fires *when the entry is added*, never again.

**No prior round or council seat named this.** Grepped the whole `cifix` review set, `docs/backlog.md`, `docs/decisions.md` and `CHANGELOG.md` for it: `impact-analyst` priced allowlist **growth** (maintenance), `design-challenger`'s O6 priced the same growth, `architecture-reviewer`'s Path B addresses **commit-time gate drift**. Nobody priced *forward suppression*. The deferred Path B backlog line (`docs/backlog.md:55`) does not close this — a pre-commit dogfood check that runs the same allowlist returns `ok=true` on the planted-PAT tree exactly as the CI run does.

### ADR conflict
devops **ADR-0008** (`Accepted`), Rules for agents: *"MUST NOT lower gate thresholds, delete tests, or **broaden suppression/ignore lists (ratchet only)**."* This diff broadens the suppression list from 5 to 22 entries, and 7 of the additions broaden it over content that does not exist yet. `CHANGELOG.md:8` asserts the opposite (*"never a suppression-list broadening beyond this diff's own new content"*), which is the compliance claim a reviewer would rely on.

### Verdict: **BREAKS**

### Required before merge — named drill
**`oss01-allowlist-forward-suppression-drill`** (blocking). Three parts, all cheap:

1. **Remove the two credential-pattern entries on `patterns.test.ts` entirely — they are not needed.** The council recorded that *"0 of the 4 `patterns.test.ts` matches can be moved under Path C without a mutation-test regression"* (`cifix-impact-analyst-council`, Path C section). **I tested that claim and for the PAT fixtures it is false.** Rewriting the two string literals as runtime-concatenated template strings keeps the identical runtime value, keeps the assertion byte-identical, and empties the committed blob:

```
$ # both PAT fixtures rewritten as runtime-concatenated template strings
PROBE: rewrote both PAT fixtures as runtime-concatenated (identical runtime value, no literal in the committed blob)
--- 1. test still PASSES? ---
i tests 8
i pass 8
i fail 0
--- 2. blob no longer matches the PAT patterns? ---
   github-pat matches in concatenated file = 0
   github-fine-grained-pat matches in concatenated file = 0
--- restored sha=c18780ccb290f2685cf8daa176e66ba8238e5bb4 ---
   github-pat matches in AS-SHIPPED file = 1
   github-fine-grained-pat matches in AS-SHIPPED file = 1
```

   This is not Path C applied to report evidence (correctly rejected — PRINCIPLES rule 19 requires verbatim raw output). It is a code fixture whose runtime behaviour is unchanged, so rule 19 is not engaged at all. Two of the three dangerous entries disappear at zero cost. **Honest limit:** I re-ran mutation 3 against the as-shipped fixture, not against the concatenated one. The runtime string is provably identical (the test still passes against the same regex), so non-vacuity is preserved structurally — but re-running mutation 3 on the concatenated form is part of the drill, not something I am asking anyone to take on faith.

2. **Add an expiry/scope field to the remaining high-churn entries, or split them.** ADR-0008 already requires a *"human-approved, time-bound exception"* for suppressing a scanner finding. The three surviving risky entries (`CHANGELOG.md`, `docs/REVIEW_LOG.md`, `docs/qa/secret-scan-allowlist.json` x `internal-hostname`) have no time bound. Minimum viable: an `expiresOn` field the loader enforces, matching the pattern this project already uses for the S5 `centralLayer` exemption (`docs/decisions.md` 2026-09-07 row, `expiresOn: 2026-10-07`).

3. **The regression test that proves the drill:** `oss01-allowlisted-file-still-blocks-a-novel-secret` — plant a synthetic credential in an allowlisted file, assert the gate **fails**. Today that test would be red. That is the point.

**If the Manager judges (2) too large for this scope**, the honest minimum is: land (1), and record the remaining three entries as a **named residual with an owner and a date** in `docs/backlog.md` — stating plainly that OSS-01 is blind to `internal-hostname` in `CHANGELOG.md` and `docs/REVIEW_LOG.md` until Path B lands. Right now that fact is recorded nowhere.

---

## 2. [ISSUE][MED][demonstrated] — the gate is RED again, right now, for the third time in this scope, and my own report makes it worse

**Exposure: 100% of commits of the tree as it currently stands, basis: measured.**

### Attack
Assumption being broken: *"Path A closed this; the staged set scans `ok=true`."* It did — for the set that existed when story-implementer measured it. I re-ran the drill on the tree as staged and confirmed their claim independently:

```
REF= ae9f9676ca1690f75f885e8ca64de675020d08fa | allowlistEntries= 22 | ok= true | blocking= 0 | allowlisted= 128
--- HEAD still: 1b4053cfec43084a6cba411097cddf42012fa357 ---
```

Then, mid-session, two parallel round-3 reviewers persisted their reports. I re-ran the identical drill on the tree as it stood minutes later:

```
REF= 39cc8aac33e1433b5ab0930aebe2b00db30b740d | allowlistEntries= 22 | ok= false | blocking= 22 | allowlisted= 128
  BLOCKING x1   docs/reviews/cifix-infra-security-round3-2026-09-09.md [email-address]
  BLOCKING x11  docs/reviews/cifix-infra-security-round3-2026-09-09.md [github-fine-grained-pat]
  BLOCKING x10  docs/reviews/cifix-infra-security-round3-2026-09-09.md [internal-hostname]
```

`docs/reviews/cifix-cross-domain-round3-2026-09-09.md` landed after that scan, and **this report** lands after that. None of the three are on the allowlist.

### Current defense (honestly assessed)
The mechanism and the fix are both known and cheap — a few more allowlist entries per report. It fails **loud** (`npm test` red, merge blocked), it is `git revert`-able, and its reach is operator, not user: exactly the calibration `design-challenger` applied to recalibrate round 2's HIGH to MED, and I am applying it consistently rather than re-litigating my own prior tag. This is also the *known* residual the council deferred as Path B, so it is not an undisclosed surprise — it is a disclosed cost, biting for the third consecutive round.

But it still blocks the commit via devops ADR-0008's independent MUST (*"MUST NOT merge a PR with any blocking gate open, failing, or pending"*), regardless of severity tag — the same route `design-challenger` used. And "one review round away from a red gate" is now a **measured** recurrence rate of 3/3, not a projection.

### Verdict: **BREAKS** (via the ADR-0008 MUST route; severity MED, not HIGH)

### Required before merge — named drill
**`oss01-post-commit-dogfood-drill`, run LAST** — after every round-3 artifact (all three reviewer reports, the `REVIEW_LOG` rows, the CHANGELOG update, the `decisions.md` row) is on disk, not before. Build the `git commit-tree` simulation of the complete tree, add the missing entries, re-run until `ok=true`, and **only then** commit. Running it before the last artifact lands is what produced this finding twice.

---

## 3. [ISSUE][MED][demonstrated] — Issue #129's new pattern false-positives on ordinary snake_case prose about PAT handling (already filed as #135 by `infra-security-reviewer` — corroborated, not re-filed)

**Exposure: 0 occurrences in the current tree (measured); future frequency: assumption.**

### Attack
The new regex at `patterns.ts:20` has **no leading word boundary**, and its character class includes the underscore. So the literal prefix embedded inside any longer lowercase snake_case identifier matches, with zero secret material present:

```
=== A. github-fine-grained-pat (Issue #129) FALSE-POSITIVE probe ===
  ok  want=MATCH got=MATCH  "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwx"
  **  want=no    got=MATCH  "load_github_pat_for_submodule_checkout"
  **  want=no    got=MATCH  "read_github_pat_from_environment_variable"
  **  want=no    got=MATCH  "const github_pat_env_var_name_constant = 1"
  **  want=no    got=MATCH  "my.github_pat_helper_function_name_here()"
  ok  want=no    got=no     "GITHUB_PAT_UPPERCASE_ENV_NAME_HERE_XXXX"     (no /i flag - correct)
  ok  want=no    got=no     "github_pat_short"                            (length floor - correct)
```

The trigger is entirely plausible **in this repo specifically**: it is the one codebase currently writing helper code and prose about fine-grained-PAT handling. The harm is Issue #113's class re-armed — a false positive that blocks the CI gate and buys another permanent allowlist entry (finding 1).

### Current defense (honestly assessed)
Zero occurrences in the tree today, measured (the `ok=true` scan above). The case sensitivity and the length floor already kill the two most common benign shapes. The fix is one character: a leading `\b`.

### Verdict: **BREAKS** (MED). **Already filed as Issue #135** by `infra-security-reviewer` round 3, independently and with the same two lead exemplars. **Duplicate-checked, not re-filed** — I commented my corroborating evidence on #135 instead, per CLAUDE.md's Issue Discipline.

### Required — named test
**`github-fine-grained-pat-word-boundary-test`** — assert `load_github_pat_for_submodule_checkout` does NOT match while the real 93-char format still does. Rides #135.

---

## 4. [ISSUE][LOW][demonstrated] — `loadAllowlist` does not require `reason`, so the "reviewed, reasoned exception" invariant is documentation, not enforcement

`history-scan.ts:92-96` states the invariant: *"Every entry is a reviewed, reasoned exception ... so adding one is a deliberate, auditable act."* `loadAllowlist` (`history-scan.ts:147-152`) type-guards only `path` and `patternId`:

```
A. allowlist entry with NO `reason` field -> allowlisted: 1 blocking: 0
```

Every entry shipped today has a reason (instrument-checked, 0 missing) — so this is latent, not live. But on a CLAUDE.md-named sensitive-area mechanism, the single property that makes an exemption auditable is unenforced, and finding 1 shows the entries are more powerful than their authors believed.

**Verdict: BREAKS (LOW — latent, non-gating).** Fix: require a non-empty `reason` in the filter, plus a test that a reason-less entry is rejected. `[LOW]` — no Issue filed, per this project's convention.

---

## 5. [ISSUE][LOW][demonstrated] — Issue #134's fix corrected `CHANGELOG.md`/`decisions.md` but left two wrong numbers in lines this same diff ADDS to `ci.yml`

Both lines are `+` lines in this diff (verified against `git diff -U0`):

```
$ git diff -U0 -- .github/workflows/ci.yml | grep "^+.*10/10 runs\|^+.*the 23"
+          # silently, from 2026-09-01 onward (10/10 runs). Submodule init is a separate, later step
+      # cleartext into `$HOME/.gitconfig` and leave it there, on disk, for every one of the 23
```

Measured, this session:

```
$ gh run list --event push --limit 40 --jq '[.[] | select(.createdAt >= "2026-09-01")] | ...'
{"count":11,"failures":11,"successes":0}

$ ci.yml `- name:` steps total: 29
```

So `10/10` should be `11/11`, and `the 23 later steps` should be 29 (or reworded to avoid an enumeration). QA-15 does not scan `ci.yml`, so no instrument catches it — which is precisely why CLAUDE.md's hard rule is stated project-wide rather than per-file.

**Verdict: BREAKS (LOW — prose inside a comment, verdict-neutral to behaviour).** `[LOW]` — no Issue filed. Folded into `changelog-completeness-marker-check`'s scope as a one-line correction.

---

## 6. [SUSPICION][LOW][demonstrated] — the `internal-hostname` fix's extension exclusion list is a closed, hand-typed enumeration

The exclusion is a fixed list of eleven extensions. Anything outside it re-opens Issue #113's exact shape:

```
  ok  want=MATCH got=MATCH(settings.local)  "settings.local.jsonc"
  ok  want=MATCH got=MATCH(settings.local)  "settings.local.toml"
  ok  want=MATCH got=MATCH(settings.local)  "settings.local.json5"
```

Zero occurrences in this repo today (the `ok=true` scan). Claude Code uses `.json`, which *is* covered, so the live case is closed. But `patterns.ts:1-3`'s own header disclaims exhaustiveness for the pattern catalog, and that disclaimer should be extended to this exclusion list too — it is a completeness claim in regex form.

**Verdict: UNPROVEN-pending-verification.** **Command that settles it:** the OSS-01 scan itself, re-run whenever a new config-file extension enters the repo. **Who:** any future contributor. A watch item, not a blocker.

---

## 7. [SUSPICION][MED][demonstrated] — CI has still never executed a single one of these 29 steps; `ADR_REPO_PAT` still does not exist

```
$ gh run list --repo mohannadrabie/thoth --limit 6
completed  failure  S6 fix-now round 6 ...  push      34398589099  11s  2026-09-09T20:01:59Z
completed  failure  docs/STATE.md ...       push      34287186484  10s  2026-09-08T22:41:48Z
...
completed  success  CI                      schedule  34113871355  22s  2026-09-07T10:54:36Z   (no-submodule drift job)

$ gh run list --event push ... select(.createdAt >= "2026-09-01")
{"count":11,"failures":11,"successes":0}

$ gh secret list --repo mohannadrabie/thoth
(empty)
```

Every drill in this report ran on `win32`; CI is `ubuntu-latest`. Unchanged from round 2 and not independently settleable from here.

**Verdict: UNPROVEN-pending-verification.** **Command that settles it:** human creates `ADR_REPO_PAT`; push to a throwaway branch; `gh run view <id> --json jobs` shows the `ci` job reaching OSS-01. **Who:** the human (secret) + the Manager (non-default-branch push). Expect QA-14/QA-15 still red per Issue #120 — "reaches OSS-01 and passes it" is the correct success criterion, not "green CI" (`design-challenger`'s point, independently confirmed: `QA14_EXIT=1`, `QA15_EXIT=1` this session).

---

# SURVIVES — what I attacked and could not break

**8. [CLEAN][demonstrated] Issue #132 — do the two failure paths actually produce distinguishable messages now?** I extracted the real step logic from `ci.yml:64-119` and ran all four branches:
```
=== DRILL A: empty PAT ===
::error::ADR_REPO_PAT secret is not set (or is empty) -- create it: gh secret set ...
A_EXIT=1

=== DRILL B1: good creds, real pinned SHA ===
REACHABILITY-OK cdb245d977fd67889bf69c9710a13b70a8b5045f
B1_EXIT=0

=== DRILL B2: BAD/EXPIRED PAT (ls-remote CALL fails) ===
::error::git ls-remote itself FAILED against the adr remote -- this IS a credential or network
problem, not a gitlink-reachability question. ... Raw ls-remote output: remote: Invalid username
or token. ... fatal: Authentication failed for 'https://github.com/mohannadrabie/adr.git/'
B2_EXIT=1

=== DRILL B3: GOOD creds, BOGUS/unreachable SHA (grep misses) ===
::error::adr gitlink deadbeef... is NOT reachable on the adr remote ... This is NOT a credential
problem: ls-remote itself SUCCEEDED above ...
B3_EXIT=1
```
Four inputs, four distinct messages, all fail-loud, each naming its own unlock. B2 and B3 now say **opposite** things about the credential, correctly. **Issue #132 CLOSED on my own re-verification. SURVIVES.**

**9. [CLEAN][demonstrated] Does #132's fix introduce a NEW credential-leak path by echoing raw `ls-remote` output into a `::error::` annotation?** This is a surface the fix created that did not exist in round 2, so I attacked it rather than assume it. Canary probe — a distinctive token planted in the `insteadOf` rewrite URL, two failure classes:
```
=== LEAK PROBE 1: DNS/host failure with token in rewritten URL ===
RAW OUTPUT >>> fatal: unable to access 'https://nonexistent-host-xyz.invalid/mohannadrabie/adr.git/': Could not resolve host
canary NOT in output
=== LEAK PROBE 2: bad-cred path ===
RAW OUTPUT >>> remote: Invalid username or token. ... fatal: Authentication failed for 'https://github.com/mohannadrabie/adr.git/'
canary NOT in output
```
git strips the userinfo component from URLs in its own error text, on both paths. GitHub Actions secret masking is a second, independent layer. **No leak. SURVIVES**, and it is worth saying the fix cleared a bar it was not asked to clear.

**10. [CLEAN][demonstrated] Issue #130's narrowed lookahead — does it still suppress #113's false positive while catching the FQDN true positive?** 26-shape differential against the live pattern, 25 correct:
```
  ok  want=no    got=no                        "settings.local.json"              #113 FP
  ok  want=no    got=no                        "edit .claude/settings.local.json to override"
  ok  want=no    got=no                        "settings.local-shaped strings"    #113 FP variant
  ok  want=MATCH got=MATCH(host01.corp)        "host01.corp.contoso.com"          #130 TP
  ok  want=MATCH got=MATCH(api.internal)       "api.internal.acme.com"            #130 TP
  ok  want=MATCH got=MATCH(vault.corp)         "vault.corp.acme.com"              #130 TP
  ok  want=MATCH got=MATCH(jenkins.corp)       "jenkins.corp.example.net"         #130 TP
  ok  want=MATCH got=MATCH(mail.corp)          "mail.corp.co.uk"                  #130 TP
  ok  want=MATCH got=MATCH(printer.local)      "printer.local.lan"                #130 TP
  ok  want=MATCH got=MATCH(db1.internal)       "db1.internal.example.com"         #130 TP
  ok  want=MATCH got=MATCH(ec2.internal)       "ip-10-0-1-5.ec2.internal"
  ok  want=MATCH got=MATCH(db01.internal)      "db01.internal" / ":5432" / "/health" / sentence-final
  ok  want=MATCH got=MATCH(redis.internal)     "redis.internal-1"
  ok  want=MATCH got=MATCH(host.local)         "host.local-01"
  ok  want=no    got=no                        "settings.local.md" / "config.corp.yml" / "foo.corp-only"
  ok  want=no    got=no                        "settings.local.JSON"              (/i flag handles case)
  ** DIFF want=MATCH got=no                    "svc.internal-prod"
```
Every one of round 2's eight named false negatives is fixed. The single remaining DIFF is **my own test expectation being wrong, not the regex**: in `svc.internal-prod` the domain label is `internal-prod`, not `internal`, so `.internal` is not the suffix at all and excluding it is correct behaviour. **SURVIVES — round-2 finding 3 CLOSED on my own re-verification.**

**11. [CLEAN][demonstrated] Are the three new regression tests vacuous?** Mutation-tested each, in place, then restored and re-verified by hash:
```
MUTATION 1 (#130 narrowing -> round-2's blanket lookahead):
  x internal-hostname: DOES match a real multi-label corporate FQDN (... Issue #130 ...)
  tests 8 | pass 7 | fail 1        restored sha: e48e1865... (bit-exact)
MUTATION 2 (strip ALL lookaheads -> pre-#113 regex):
  x internal-hostname: does NOT match a config-filename fragment (... Issue #113 ...)
  tests 8 | pass 7 | fail 1
MUTATION 3 (disable the github-fine-grained-pat pattern):
  x github-fine-grained-pat: matches GitHub fine-grained PAT format (... Issue #129 ...)
  tests 8 | pass 7 | fail 1
```
Each mutation kills exactly one test, and the right one. **All three non-vacuous. SURVIVES.**

**12. [CLEAN][demonstrated] Issue #134 — is the QA-15 regression genuinely gone, or just relabelled?** Ran the instrument against the working tree, then against HEAD versions of the three changed doc files, same session:
```
--- AFTER (working tree) ---
  - docs/STATE.md:     3 of 3 numeric completeness claim(s) failed.
  - docs/decisions.md: 5 of 5 numeric completeness claim(s) failed.
--- BEFORE (HEAD versions of CHANGELOG/decisions/backlog) ---
  - docs/STATE.md:     3 of 3 numeric completeness claim(s) failed.
  - docs/decisions.md: 5 of 5 numeric completeness claim(s) failed.
```
Identical. `CHANGELOG.md` fails in neither (round 2 measured 0 -> 2); `decisions.md` is back to HEAD 5 (round 2 measured 6). **This diff is now QA-15-neutral. Round-2 finding 4 CLOSED on my own re-verification. SURVIVES** — the `ci.yml` residue is finding 5, a different file the fix scope did not name.

**13. [CLEAN][demonstrated] Issue #120 — still genuinely untouched and still red, as disclosed?**
```
$ git diff --stat -- src/qa/reference-resolver.ts src/qa/completeness-claim-checker.ts   (empty)
$ git status --porcelain src/qa/                                                          (0 lines)
$ npm run -s qa:reference-resolver   -> QA14_EXIT=1
$ npm run -s qa:completeness-claims  -> QA15_EXIT=1
```
Untouched, both instruments still red, exactly as the CHANGELOG discloses. **SURVIVES.**

**14. [CLEAN][demonstrated] Issue #89 newly-surfaced exemplar — genuinely disclosed to the human, or quietly allowlisted?** Genuinely disclosed. `docs/backlog.md:56` carries a dedicated entry naming the file, the Issue, the truncation, and — explicitly — *"Needs a human call, not resolved here: verify whether the underlying GitHub PAT ... is still live ... and rotate it if so — this diff own improved detection coverage is what surfaced it, not a claim that the credential is confirmed dead."* The allowlist entry own `reason` says the same. I verified the truncation claim rather than accept it:
```
MATCH 1 len=34 prefix=github_pat_11A3...[REDACTED 19]
  ctx: (a plaintext GITHUB_PERSONAL_ACCESS_TOKEN value quoted from a real ~/.claude.json, ending in an ellipsis)
total matches = 1
```
34 characters of a ~93-character format — 59+ characters absent, not reconstructable by any means short of brute force. One occurrence, not a scattered set. **Correctly handled: detected, allowlisted with a reason, escalated to the human, not resolved unilaterally. SURVIVES**, and this is exactly the behaviour the process is supposed to produce.

**15. [CLEAN][demonstrated] Is `npm test` genuinely green, and is the 662 real?** Re-run end-to-end myself:
```
i tests 662 | i suites 0 | i pass 662 | i fail 0 | i cancelled 0 | i skipped 0 | i todo 0
i duration_ms 21343.6295
```
including `OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass`. **Zero skipped — skipped is not passed, and there are none. SURVIVES.**

**16. [CLEAN][demonstrated] Does story-implementer own `ok=true` claim hold on the set they actually staged?** Independently reproduced with my own harness (`SECRET_PATTERNS`/`partitionAllowlisted` imported from the live source, real allowlist, `git commit-tree` simulation):
```
REF= ae9f9676ca1690f75f885e8ca64de675020d08fa | allowlistEntries= 22 | ok= true | blocking= 0 | allowlisted= 128
--- HEAD still: 1b4053cfec43084a6cba411097cddf42012fa357 ---
```
**Their claim is true for the tree they measured. SURVIVES** — finding 2 is about the tree that will actually be committed, not about their honesty.

**17. [CLEAN][demonstrated] Does Issue #129 new pattern collide with, or weaken, the classic `github-pat` pattern?** Zero overlap, tested directly: the real fine-grained format returns `null` against the classic `github-pat` regex (the underscore in the fine-grained prefix breaks its character class). Additive, not a widening. The uppercase env-var shape and the sub-length shape are both correctly rejected. **SURVIVES** — the finding-3 false positive is a separate, narrower defect.

**18. [CLEAN][demonstrated] Did anything in this round smuggle a `continue-on-error` into the workflow?** No. The only occurrence of that string in `ci.yml` is line 4 comment asserting its own absence; a grep for the actual YAML key returns **0**. 29 `- name:` steps across the `ci` and `runtime-settings-drift` jobs, no gate bypass. **SURVIVES.**

**Credit where it is due.** Issue #132 fix is better than the test I asked for in round 2 — it captures the command status *and* the output, attributes four distinct worlds, names its unlock in each, and (unasked) does not leak the credential on either failure path. Issue #130 narrowing turned all eight of my round-2 false negatives back into hits without giving back a single one of Issue #113 false positives, which is a genuinely hard regex to land. And Issue #89 exemplar was escalated to a human rather than quietly buried — the single most tempting thing in this round to sweep, and it was not swept.

---

# Editorial (verdict-neutral, plain edits, no re-review)

1. The round-3 brief states **16** new allowlist entries; the instrument-generated delta is **17** (`HEAD=5 NOW=22 ADDED=17`).
2. The `reason` on the Issue #89 allowlist entry says "TRUNCATED (23 of ~93 chars)"; the matched string is **34** characters including the prefix. The substance — non-reconstructable — holds either way.
3. `ci.yml:43` "(10/10 runs)" -> measured 11/11 push failures since 2026-09-01 (finding 5).
4. `ci.yml:53` "for every one of the 23 later steps" -> the file now has 29 `- name:` steps (finding 5).
5. `src/secret-scan/patterns.ts:1-3` "not a claim of exhaustiveness" disclaimer should be extended to cover the `internal-hostname` extension-exclusion list (finding 6), which is the same kind of claim in a different notation.

---

# Bottom line

## Single scariest unproven assumption
**That an allowlist entry exempts *this diff strings*.** It exempts *that pattern in that file, forever*. Seventeen entries were added under the belief expressed in `CHANGELOG.md:8` — "never a suppression-list broadening beyond this diff own new content" — and seven of them land on files that keep being written. Three blind the scanner to credential patterns inside a test file, which is where credentials actually get pasted by accident. The whole round was spent making OSS-01 detect *more*, and the mechanism used to unblock it quietly made OSS-01 detect *less* in seven specific places, permanently, with nobody — not me in two prior rounds, not three council seats — having priced it.

## Verdict: **no-go**
Not on the round substance, which is materially good: Issue #132 fix is better than what I specified, #130 narrowing is right on 25 of 26 shapes, #134 regression is measurably gone, all three new regression tests survive mutation, #89 was escalated rather than buried, and 662/662 is real. `no-go` on one demonstrated HIGH backed by devops ADR-0008 "MUST NOT ... broaden suppression/ignore lists (ratchet only)", plus a MED that independently blocks the commit via the same ADR "no merge with a blocking gate failing".

## Single next action
**Rewrite the two `patterns.test.ts` PAT fixtures as runtime-concatenated strings and delete their two allowlist entries** — I proved this session that the test stays 8/8 green and the blob goes to zero matches, which removes the two most dangerous exemptions at zero cost and refutes the one assumption the council Path C rejection rested on. Then decide (Manager call) whether the remaining three high-churn entries get a time bound now or a named, dated residual line in `docs/backlog.md`. Then run `oss01-post-commit-dogfood-drill` **last**, after every round-3 artifact including this report is on disk.

## Findings to tests (equal counts, PRINCIPLES rule 19)
5 open findings, 5 named tests — no gap:

| # | Finding | Named failing test / drill |
|---|---|---|
| 1 | HIGH — allowlist entries suppress future genuine secrets in 7 still-written files | `oss01-allowlist-forward-suppression-drill` (+ `oss01-allowlisted-file-still-blocks-a-novel-secret`) |
| 2 | MED — gate red again on the current tree (3rd recurrence) | `oss01-post-commit-dogfood-drill`, run LAST |
| 3 | MED — fine-grained-PAT prefix matches inside snake_case identifiers (Issue #135) | `github-fine-grained-pat-word-boundary-test` |
| 4 | LOW — `loadAllowlist` does not require `reason` | `allowlist-entry-without-reason-is-rejected` |
| 5 | LOW — two wrong numbers in `ci.yml` lines this diff adds | folded into `changelog-completeness-marker-check` |

Suspicions 6 and 7 have no independent executable form today (6 is settled by the standing OSS-01 run whenever a new extension appears; 7 by the human `ADR_REPO_PAT` plus one throwaway push), which is why neither is double-counted.

**Self-disclosure:** this report contains hostname-, email- and PAT-shaped strings that are load-bearing evidence under PRINCIPLES rule 19. It needs its own allowlist entries and it is counted in finding 2 alongside every other round-3 artifact. I am not exempting my own artifact from the finding I am filing — and I note, without irony, that the entry I am asking for is an instance of the very mechanism finding 1 attacks. The difference is that a dated review report is never rewritten, so its exemption can only ever cover bytes that already exist. That is the distinction the seven risky entries do not have.

---

```
RECEIPT: verdict=no-go
attacks (ALL, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] The allowlist joins on exact path+patternId only (history-scan.ts:110) -- no value, line, commit or expiry scoping -- so an entry exempts THAT PATTERN IN THAT FILE FOREVER, not this diff strings. Instrument-enumerated: 17 entries added (HEAD=5 NOW=22), 7 on files that keep being written (CHANGELOG.md churn=18, docs/REVIEW_LOG.md churn=18, secret-scan-allowlist.json, patterns.ts, patterns.test.ts x3), of which 3 blind OSS-01 to CREDENTIAL patterns in a live test file -- the classic accidental-paste location. Demonstrated with a positive control: identical synthetic 93-char fine-grained PAT -> ok=true/blocking=0 in patterns.test.ts, ok=false/blocking=1 in docs/STATE.md; two genuine corporate FQDNs appended to CHANGELOG.md + REVIEW_LOG.md -> ok=true, allowlisted 128->132 (found, matched, waved through). Violates devops ADR-0008 "MUST NOT ... broaden suppression/ignore lists (ratchet only)"; CHANGELOG.md:8 own compliance claim ("never a suppression-list broadening beyond this diff own new content") is factually untrue of the mechanism used. Defense honestly assessed: allowlisted matches ARE still reported, but among 128 existing ALLOWLISTED lines, and the GATE is silent by construction; all 17 entries carry a real reason (0 missing, instrument-checked); the allowlist-file diff tripwire fires once, at add time, never again. NAMED BY NOBODY -- grepped all 9 cifix reports + backlog + decisions + CHANGELOG: impact-analyst and design-challenger priced allowlist GROWTH, architecture Path B prices COMMIT-TIME DRIFT; forward suppression is unpriced, and Path B does not close it. Exposure: ~100% of future matches of the named patternId in the 7 named files, basis: measured. -> oss01-allowlist-forward-suppression-drill
2. [ISSUE][MED][demonstrated] The gate is RED on the CURRENT tree, 3rd recurrence in this scope: staged set alone scans ok=true (ae9f9676, 0 blocking/128 allowlisted -- story-implementer own claim independently reproduced), but two parallel round-3 reports landed mid-session and the identical drill returned ok=false / 22 blocking (39cc8aac: cifix-infra-security-round3 -- 11 github-fine-grained-pat, 10 internal-hostname, 1 email-address); cifix-cross-domain-round3 and THIS report land after that and are also un-allowlisted. Defense: fails loud (npm test red, merge blocked), git-revertible, reach=operator -- design-challenger own calibration applied consistently, so MED not HIGH -- but still BREAKS via devops ADR-0008 independent "MUST NOT merge a PR with any blocking gate open, failing, or pending". Recurrence rate is now measured 3/3, not projected. Exposure: 100% of commits of the tree as it stands, basis: measured. -> oss01-post-commit-dogfood-drill, run LAST
3. [ISSUE][MED][demonstrated] Issue #129 new fine-grained-PAT regex has no leading word boundary and its char class includes the underscore, so it matches inside ordinary lowercase snake_case identifiers with zero secret material: load_github_pat_for_submodule_checkout, read_github_pat_from_environment_variable, github_pat_env_var_name_constant, my.github_pat_helper_function_name_here -- 4/7 probe cases. Issue #113 class re-armed on a CI-gating instrument, in the one repo currently writing PAT-handling code and prose. Defense: 0 occurrences in the tree today (measured); no /i flag and the length floor already kill the two commonest benign shapes; fix is one char. ALREADY FILED as Issue #135 by infra-security-reviewer round 3 with the same lead exemplars -- duplicate-checked, corroborating comment posted instead of a second Issue. Exposure: 0 today measured; future basis: assumption. -> github-fine-grained-pat-word-boundary-test
4. [ISSUE][LOW][demonstrated] loadAllowlist (history-scan.ts:147-152) type-guards only path+patternId, so an entry with NO reason field is honored (drilled: allowlisted=1 blocking=0) -- the "every entry is a reviewed, reasoned exception ... a deliberate, auditable act" invariant at history-scan.ts:92-96 is documentation, not enforcement, on a CLAUDE.md-named sensitive-area mechanism. Defense: all 22 shipped entries have a reason (0 missing, instrument-checked), so latent not live. -> allowlist-entry-without-reason-is-rejected
5. [ISSUE][LOW][demonstrated] Issue #134 fix corrected CHANGELOG.md/decisions.md but left two hand-derived numbers wrong in lines THIS DIFF ADDS to ci.yml (both confirmed as + lines via git diff -U0): "(10/10 runs)" vs measured 11/11 push failures since 2026-09-01 (gh run list, instrument), and "every one of the 23 later steps" vs 29 actual - name: steps. QA-15 does not scan ci.yml, so no instrument catches it -- CLAUDE.md hard rule is project-wide for exactly this reason. -> folded into changelog-completeness-marker-check
6. [SUSPICION][LOW][demonstrated] The internal-hostname fix extension exclusion is a closed hand-typed list of 11 extensions; settings.local.jsonc / .toml / .json5 all still match, re-opening Issue #113 exact shape for any extension outside it. 0 occurrences today (measured); Claude Code real .json IS covered, so the live case is closed. UNPROVEN-pending-verification -- settled by the standing OSS-01 run whenever a new config extension enters the repo. A watch item, not a blocker.
7. [SUSPICION][MED][demonstrated] All 29 ci steps have STILL never executed in a real runner: gh run list shows 11 of 11 push runs since 2026-09-01 failed (measured via --jq, not eyeballed), the only success is the no-submodule scheduled drift job, and gh secret list is still empty (ADR_REPO_PAT does not exist). Every drill in this report ran win32 vs ubuntu-latest. UNPROVEN-pending-verification -- settled by the human creating the secret plus one throwaway-branch push; expect QA-14/QA-15 still red per Issue #120 (both re-confirmed exit 1 this session), so "reaches OSS-01 and passes it" is the correct criterion, not "green CI".
8. [CLEAN][demonstrated] Issue #132 GENUINELY FIXED -- all four branches drilled from the real ci.yml:64-119 logic: empty PAT exits 1 before any git call; good creds + real SHA REACHABILITY-OK exit 0; bad/expired PAT -> "this IS a credential or network problem" + raw git stderr, exit 1; good creds + bogus SHA -> "This is NOT a credential problem: ls-remote itself SUCCEEDED", exit 1. Four inputs, four distinct fail-loud messages, each naming its own unlock. Issue #132 CLOSED on my own re-verification.
9. [CLEAN][demonstrated] #132 fix introduces a NEW surface (raw ls-remote output echoed into a ::error:: annotation) and I attacked it rather than assume it: canary token planted in the insteadOf rewrite URL, probed on both the DNS-failure and bad-credential paths -- git strips userinfo from URLs in its own error text, "canary NOT in output" both times; GitHub Actions secret masking is a second independent layer. No leak.
10. [CLEAN][demonstrated] Issue #130 narrowed lookahead is correct on 25 of 26 differential shapes: all three #113 false-positive shapes still suppressed, and ALL EIGHT of my own round-2 false negatives (host01.corp.contoso.com, api.internal.acme.com, vault.corp.acme.com, jenkins.corp.example.net, mail.corp.co.uk, printer.local.lan, redis.internal-1, host.local-01) now match again. The single DIFF (svc.internal-prod) is my test expectation being wrong, not the regex -- the label there is internal-prod, so .internal is not the suffix. Round-2 finding 3 CLOSED on my own re-verification.
11. [CLEAN][demonstrated] All three new regression tests are NON-VACUOUS -- three separate in-place mutations, each killing exactly one test and the right one: #130 narrowing -> blanket lookahead kills the FQDN true-positive test; strip all lookaheads -> kills the #113 false-positive test; disable the fine-grained-PAT pattern -> kills the #129 test. 8 tests, 7 pass/1 fail each time. patterns.ts restored bit-exact (git hash-object e48e1865...), patterns.test.ts restored bit-exact (c18780cc...).
12. [CLEAN][demonstrated] Issue #134 stated defect GENUINELY FIXED -- QA-15 run against the working tree and against HEAD versions of the three changed doc files, same session, IDENTICAL output (STATE.md 3/3, decisions.md 5/5, CHANGELOG.md failing in neither). Round 2 measured CHANGELOG 0->2 and decisions 5->6; both regressions are gone and the diff is now QA-15-neutral. Round-2 finding 4 CLOSED on my own re-verification.
13. [CLEAN][demonstrated] Issue #120 STILL genuinely untouched -- git diff --stat and git status --porcelain on src/qa/reference-resolver.ts and completeness-claim-checker.ts both EMPTY; both instruments re-run and still red (QA14_EXIT=1, QA15_EXIT=1), exactly as the CHANGELOG discloses.
14. [CLEAN][demonstrated] Issue #89 newly-surfaced exemplar is GENUINELY DISCLOSED, not swept -- docs/backlog.md:56 names the file, the Issue, the truncation and explicitly routes the rotation call to the human ("Needs a human call, not resolved here ... not a claim that the credential is confirmed dead"); the allowlist reason says the same. I verified the truncation rather than accept it: exactly 1 match, 34 chars of a ~93-char format, 59+ chars absent, not reconstructable. Detected, allowlisted with a reason, escalated -- the single most tempting thing in this round to bury, and it was not buried.
15. [CLEAN][demonstrated] npm test independently re-run end-to-end: 662 total / 662 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo, including the OSS-01 dogfood blocking pass. Zero skipped -- skipped is not passed, and there are none.
16. [CLEAN][demonstrated] story-implementer own ok=true claim holds on the set they actually staged -- independently reproduced with my own harness importing the LIVE SECRET_PATTERNS/partitionAllowlisted against a git commit-tree simulation: ok=true, 0 blocking, 128 allowlisted, HEAD untouched at 1b4053cf throughout. Finding 2 is about the tree that will be committed, not about their honesty.
17. [CLEAN][demonstrated] Issue #129 pattern is genuinely ADDITIVE, not a widening -- zero character-class overlap with the classic github-pat regex (the real fine-grained format returns null against it because of the underscore), and the uppercase env-var shape and the sub-length shape are both correctly rejected.
18. [CLEAN][demonstrated] No gate bypass smuggled in -- the only occurrence of "continue-on-error" in ci.yml is line 4 comment asserting its own absence; a grep for the actual YAML key returns 0. 29 - name: steps across the ci and runtime-settings-drift jobs.
counts (CHECKSUM): issues=5 suspicions=2 clean=11
evidence (CHECKSUM): demonstrated=18 code-traced=0 derived=0
checks=npm test 662 total / 662 pass / 0 fail / 0 skipped (exit 0); OSS-01 real scanner + real allowlist vs 5 git commit-tree simulations (HEAD and real index never touched, re-verified after each): staged-set ok=true 0 blocking/128 allowlisted, current-tree-with-round3-reports ok=false 22 blocking, planted-PAT-in-allowlisted-file ok=true 0 blocking, same-PAT-in-non-allowlisted-file ok=false 1 blocking (positive control), planted-FQDNs-in-CHANGELOG+REVIEW_LOG ok=true 0 blocking/132 allowlisted; 3 in-place mutation tests on patterns.ts -> 7 pass/1 fail each, both files restored bit-exact by git hash-object; 26-shape internal-hostname differential (25 correct); 7-shape fine-grained-PAT FP probe (4 FPs found); concat-fixture probe -> tests 8/8 pass with 0 blob matches vs 1+1 as shipped; 4 ci.yml step drills (empty PAT exit 1, good creds exit 0, bad PAT exit 1 correctly attributed, bogus SHA exit 1 correctly attributed); 2 credential-leak canary probes (no leak); allowlist delta instrument (HEAD=5 NOW=22 ADDED=17 REMOVED=0, 0 missing reason); loadAllowlist reason-enforcement drill (reason-less entry honored); qa:reference-resolver exit 1; qa:completeness-claims exit 1, before/after HEAD comparison identical; git diff/status on src/qa/ empty; gh run list 11/11 push failures since 2026-09-01; gh secret list empty; ci.yml parsed 29 steps / 0 continue-on-error keys
adr=HIT(35)
report=docs/reviews/cifix-red-team-round3-2026-09-09.md
```
