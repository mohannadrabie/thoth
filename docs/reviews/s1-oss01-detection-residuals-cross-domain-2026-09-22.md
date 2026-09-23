# Cross-Domain Review (Ra) -- s1-oss01-detection-residuals, 2026-09-22

**Scope** CRITICAL-tier post-build cross-domain pass. Branch `fix/s1-oss01-detection-residuals`, HEAD `39572a2`, delta `origin/master...HEAD` (1 commit, 7 files, 524 insertions / 25 deletions). Bundled fix for OSS-01 residuals #246 (UTF-16 decode), #247 (scan-time bound + `timeout-minutes`), #249 (behaviour-based 0xA0 guard), #250 (blob-dedupe path scoping). Originates from `docs/reviews/s1-237-nul-byte-scan-red-team-2026-09-20.md` attacks 1-3.

**Lanes running alongside this pass** (per task brief and this file family's own precedent on every prior CRITICAL story here): `red-team` (adversarial attacks on the timeout mechanism, the dedupe fix, BOM-detection gaps) and `app-security-reviewer` (THOTH-ADR-0002 compliance, `vm.Script` sandbox safety, `ci.yml` scoping). Neither report was yet persisted in `docs/reviews/` at the time of this pass (no `s1-oss01-detection-residuals-{red-team,app-security}-*.md` on disk) -- this pass does not rely on either and checks the code directly, per PRINCIPLES rule 9. This report avoids re-litigating vm.Script sandbox internals, dedupe/timeout adversarial probing, and ADR-0002-specific compliance detail, which are those lanes' own angles; it covers the seams and what falls outside both.

**ADR cache** `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog -- approx 18300 tokens saved this pass (fp b588a48) [CACHE=HIT]`. Read whole and unfiltered, both domain folders plus `docs/adr` (PRINCIPLES rule 9): devops ADR-0001 through ADR-0010, SE ADR-0001 through ADR-0021, THOTH-ADR-0001, THOTH-ADR-0002.

---

## 1. Cross-domain ADR verdict (whole catalog vs. the diff)

| ADR | applicableTo | Collision? |
|---|---|---|
| devops ADR-0002-0007, 0009, 0010 (CDK/IaC, tagging, cost, environments) | iac, cdk, cost, tagging | No file in this diff is infra-as-code; not applicable. No collision. |
| devops ADR-0008 (CI/CD gates and policy-as-code) | pipeline, quality, security, supply-chain | Rules cover gate-blocking discipline, suppression justification, ratchet-only thresholds -- none prescribe `timeout-minutes` specifically, none are violated by adding it. `.github/workflows/ci.yml:41` `timeout-minutes: 30` raises reliability, doesn't lower a gate. No collision. |
| SE ADR-0002 (multi-layer architecture) | architecture | `src/secret-scan/*` is internal QA/CI tooling, not a layered application with presentation/application/domain/infrastructure directories -- same reading this file family's prior reviews have consistently used. No collision. |
| SE ADR-0003 (SOLID) | quality, architecture | The new module-scope `timeoutSandbox`/`matchAllScript` (`history-scan.ts:110-113`) is not an injected I/O dependency (no DB/HTTP/clock/random) -- a reused V8 sandbox for CPU-bound regex matching. No collision. |
| SE ADR-0004 (Idempotency) / SE ADR-0005 (Testing strategy, idempotency-test rule) | architecture, reliability, testing | `scanHistory` is a pure read over git objects (matching is a function of the blob's own bytes); re-running it is deterministic by construction, and the dedupe-cache fix (#250) is exactly what makes that determinism hold under duplicate paths. Not a "mutating endpoint/consumer" in this ADR's sense (its own examples are money/inventory/message-consumer side effects). No collision, no owed idempotency test. |
| SE ADR-0006 (Blast radius control) | architecture, reliability, cloud | "MUST set explicit timeouts on every network call" is aimed at network calls; this diff's timeout is on in-process regex matching, not a network call, so the letter doesn't apply -- but the diff independently satisfies its spirit (explicit, measured ceiling; no change requiring lockstep deploy; no schema/data migration). No collision. |
| SE ADR-0011-0015 (DB/data), SE ADR-0016-0021 (governance-plugin/kernel/wrap architecture), THOTH-ADR-0001 (central-classification fixture) | data, governance-plugin tree, kernel | No file in this diff touches a database, the governance-plugin tree, the kernel, or the central-classification fixture. No collision. |
| THOTH-ADR-0002 (value-scoped OSS-01 allowlist) | security, architecture, code | Status `proposed`, served like accepted per its own frontmatter note and Issue #220. Checked directly against the shipped code (not against red-team's or app-security's findings): (a) `docs/qa/secret-scan-allowlist.json` is untouched by this diff (`git diff --stat` lists 7 files, not the allowlist) -- no widening, no new exemption shape. (b) The reserved `SCAN_TIMEOUT_PATTERN_ID = "oss01-scan-timeout"` (`history-scan.ts:130`) reuses the existing value-scoped allowlist shape (a `HistoryMatch`-shaped finding, gated the same way) rather than adding a second exemption mechanism -- satisfies the "no other exemption shape" rule. (c) The "code" constraint ("a change to a pattern's match boundary in `patterns.ts` MUST be accompanied by re-derived valueSha256 lists") does not trigger: `patterns.ts` itself is untouched in this diff (only `patterns.test.ts` changed for #249). No collision. |

**No cross-domain ADR collision found.** Every applicable rule outside the two dispatched lanes' own slice either doesn't fire on the files this diff touches, or is independently satisfied.

---

## 2. Functional correctness -- independently re-measured, not trusted

Re-ran the real full-history scan myself, clean working tree, HEAD `39572a2`:

```
$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (2067 allowlisted).
```

This is not the "2031" figure the task brief flagged for independent measurement -- and rightly so: the CHANGELOG itself (`CHANGELOG.md:15,18`) already discloses two numbers, not one: 2031 is the pre-existing baseline measured by toggling the diff on/off at the same base commit (`git stash`), and 2067 is the number after this story's own commit lands (touched files re-match their own already-allowlisted fixture literals, the same mechanics any commit touching those files has always had -- explicitly disclosed, not hidden). My independent run at the real HEAD matches the second, post-commit number exactly: 2067 allowlisted, 0 blocking. The implementer's own claim reconciles with an instrument run fresh, not copied from their report.

```
$ npm test
tests 1055  pass 1055  fail 0  cancelled 0  skipped 0  todo 0
$ npm run typecheck   # tsc --noEmit -p tsconfig.json -- clean, no output
$ npx eslint src/secret-scan/ .github/workflows/ci.yml   # 0 errors (ci.yml: 1 unrelated "no config" warning)
```

Note: a plain `npm run lint` in this working tree reports 17 errors, all in two untracked scratch files at the repo root (`__poc_collision.mjs`, `__poc_collision2.mjs` -- synthetic PoC scripts probing the dedupe collision shape, not part of this diff, absent from a fresh checkout). Scoped `eslint` on the diff's own files is clean; this is working-tree noise, not a diff defect.

No third, undiscovered variant of the implementer's own self-reported dedupe-bug class survives in the shipped code -- see the mutation drill in section 3.1 below, which directly probes the shipped dedupe key.

---

## 3. Test quality -- two mutation drills, both run against the real shipped code

### 3.1 oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another (Issue #250)

Mutated the shipped dedupe key back to sha-alone (`history-scan.ts:244`, replaced the path-plus-sha template-literal key with the bare sha) and re-ran only the new test:

```
FAIL oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another
  AssertionError: the byte-identical blob is reported at BOTH paths, not just the first one the tree walk reaches
  1 !== 2
```

Reverted (`git checkout -- src/secret-scan/history-scan.ts`), confirmed `git status --porcelain` clean before continuing. Non-vacuous, demonstrated.

### 3.2 oss01-no-negated-class-rejects-a-high-byte (Issue #249) -- and its predecessor's blind spot, independently reproduced

Mutated `patterns.ts`'s `generic-password-assignment` value class from the shipped hand-enumerated ASCII-whitespace class to a class using the `\xa0` escape instead -- a spelling the OLD, spelling-enumerating guard (`oss01-no-negated-whitespace-class-hides-a-high-byte`) does not recognise (it only tokenizes the two-character `\s`/`\S` tokens):

```
PASS oss01-no-negated-whitespace-class-hides-a-high-byte           (stays green -- BLIND to this spelling)
FAIL oss01-no-negated-class-rejects-a-high-byte
  AssertionError: pattern generic-password-assignment's negated class rejects high byte 0xA0
```

This independently reproduces red-team's attack 2 finding from the prior story and confirms the shipped fix for it: the new behaviour-based probe (`patterns.test.ts:217`, extracts every negated class from the live `SECRET_PATTERNS` catalog via a `negatedClasses()` helper, asserts none rejects 0x80-0xFF, non-vacuous by its own assertion that the catalog has at least one negated class to probe) genuinely catches what the old guard missed. Reverted (`git checkout -- src/secret-scan/patterns.ts`). Non-vacuous, demonstrated.

---

## 4. Seams

**allowlist-tool.ts's runHash vs. history-scan.ts's decode logic -- cannot drift, by construction.** `runHash` (`allowlist-tool.ts:334-341`) calls `decodeBlobVariants(content)` then `hashLines` (`allowlist-tool.ts:298-302`), and `hashLines` itself calls `scanBlobText` -- the exact same function `scanHistory`'s own `scanBlob` (`history-scan.ts:196-206`) calls. There is one decode function and one scan/hash function, imported by both call sites; a future change to either updates both by construction, so the "could they drift" question is closed at the type level, not just today. [CLEAN][code-traced]. The one behavioural difference -- `runHash` wraps its output in a `Set` while `scanHistory` deliberately does not dedupe -- is intentional and does not reintroduce the class of bug the implementer's own two self-reported regressions were: `runHash`'s job is to print the distinct hashes a human needs to grant (an allowlist entry's `valueSha256` is itself a deduped list), not to count occurrences. [CLEAN][code-traced].

**oss01-scan-timeout reserved pattern id vs. the allowlist / src/qa/* instruments.** No collision: `docs/qa/secret-scan-allowlist.json`'s 6 real pattern ids (measured: aws-access-key-id, email-address, ipv4-private, github-fine-grained-pat, internal-hostname, github-pat) do not include the reserved id. A grep for `SECRET_PATTERNS` or `patternId` across `src/qa/` returns no file -- no QA instrument enumerates pattern ids, so nothing elsewhere can silently break on an id shaped `oss01-*` rather than one of the ten real ones. [CLEAN][demonstrated].

**pre-commit-scan.ts inherits all four fixes with zero seam.** It calls `scanHistory` directly (`pre-commit-scan.ts:37,54`) -- never reimplements matching -- so UTF-16 decode, the scan-time bound, and the dedupe fix apply to the hook path automatically. [CLEAN][code-traced].

---

## 5. "One commit, not four" -- honest assessment

Reasonable, not a reviewability problem, with one caveat. `history-scan.ts`'s three production-code fixes (#246 decode, #247 timeout, #250 dedupe-cache) are genuinely interleaved: `scanBlob` (#250's cache) calls `decodeBlobVariants` (#246), whose output flows into `scanBlobText`'s per-pattern loop, which is what #247 wraps in `matchAllBounded`. Splitting these three into sequential commits would work but each intermediate commit would carry a materially incomplete OSS-01 gate -- a real argument for bundling, not just a convenience one. The diff itself stays legible despite the bundling: each concern has its own doc block, its own named test(s), and its own CHANGELOG paragraph citing its own issue number.

The one part of the bundle that didn't need to be bundled: Issue #249 touches `patterns.test.ts` only -- zero production code, zero interleaving with #246/#247/#250's shared code path in `history-scan.ts`. It could have shipped as its own STANDARD-tier PR with no loss of reviewability or safety. This isn't a defect -- the implementer's own stated reason (small, individually well-specified, sharing the same file family) is a legitimate editorial call -- but my honest read is #249 was bundled for narrative convenience (one story, one CHANGELOG section, one commit) rather than technical necessity, whereas #246/#247/#250 were bundled for real interleaving reasons. Doesn't block.

---

## 6. Coverage gaps

- `runtime-settings-drift` job in `ci.yml` has no `timeout-minutes` (unlike the `ci` job this diff touches). Pre-existing, unrelated to this diff (it never calls `history-scan.ts`, runs only on `schedule`), and out of this diff's own blast radius -- named here so it doesn't silently look "covered" by this story's `timeout-minutes` addition. Not a finding against this diff.
- CHANGELOG.md's narrative accuracy -- no domain reviewer's lane names prose-accuracy checking; covered in this pass (section 2), independently re-measured, confirmed accurate.
- The story's own design/ratification paper trail -- see section 7. Not a code file, so not "in the diff," but it's cited from the diff's own shipped code and is exactly the kind of evidence-trail gap that falls between lanes (no domain reviewer checks for a missing plan document).

---

## 7. [ISSUE][MED][demonstrated] Shipped code and tests cite a Manager ruling to a plan document that was never committed

**Finding.** `history-scan.ts:29` and `history-scan.test.ts:1738` both cite a "Manager ruling, s1-oss01-detection-residuals plan" as the source of a specific design decision -- that a UTF-16-decoded match and the same literal written as plain ASCII hash identically, so one allowlist entry covers both forms. `CHANGELOG.md:11` repeats the same citation ("Manager ruling on the open design question"). No such plan document exists:

```
$ ls docs/plans/ | grep -i oss01
(no output)
$ git log --all --diff-filter=A --name-only --pretty=format: -- 'docs/plans/*' | grep -i oss01
(no output)
$ grep -n "oss01-detection-residuals" docs/decisions.md
(no output)
$ grep -n "s1-oss01-detection-residuals" docs/.maat-state.json
(no output)
```

Every prior CRITICAL-tier story in this exact file family (s1-237-nul-byte-scan, s1-136-value-scoped-allowlist, s1-229-qa14-red, s1-135-pat-regression-test) has a `docs/plans/<scope>-phase1-<date>.md`, ratification rows in `docs/decisions.md`, and a `.maat-state.json` note -- all three are absent here, and two committed source citations point at the first of the three as if it exists.

**Why this is my finding, not a duplicate of the security lanes.** Neither red-team's nor app-security-reviewer's stated angles (timeout-mechanism/dedupe/BOM adversarial attacks; ADR-0002/vm.Script/ci.yml-scoping compliance) check for a missing design-ratification artifact -- this is a process/evidence-trail gap, not a code-security or ADR-text defect, and it's the seam PRINCIPLES rule 9 assigns to this pass.

**Assessment of the ruling itself.** Not disputed -- independently verified correct: every SECRET_PATTERNS regex matches ASCII-only text, `hashMatchedBytes` hashes only the matched substring (latin1-encoded), and the shipped `oss01-utf16-text-file-does-not-hide-a-secret` test (`history-scan.test.ts:1723-1740`) asserts exactly this equality and passes. The finding is that the record of who decided this and when is missing, not that the decision is wrong.

**Exposure:** ~100% of future readers/auditors trying to trace this specific ruling to a committed artifact (a Manager-ratification citation that resolves to nothing), basis: demonstrated (all four searches above run fresh, all empty). This is an audit-trail defect, not a runtime/security one -- it does not affect what the gate does or who it protects.

**Minimal fix, cheap, same session:** commit a short `docs/plans/s1-oss01-detection-residuals-phase1-2026-09-2X.md` capturing the tier ratification and this one design ruling, or a `docs/decisions.md` row -- either way, a real committed artifact the two existing source citations can resolve to. Does not require touching gate logic or re-running any test.

**Named failing test:** none -- this is a documentation/process gap with no executable form (PRINCIPLES rule 19's own explicitly-allowed case: any gap is explained). It resolves to a residual-register line / a same-session Manager action, not a test.

---

## Findings to failing tests

Open findings: 1. Named failing tests: 0 -- explained above (section 7): a missing-artifact citation has no executable form; it resolves to committing the missing artifact, not a test.

## Single next action

Before merge: commit the plan doc (or a `docs/decisions.md` row) the shipped code and tests already cite by name, so the "s1-oss01-detection-residuals plan" citation in `history-scan.ts:29` and `history-scan.test.ts:1738` resolves to a real, committed artifact.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][MED][demonstrated] history-scan.ts:29, history-scan.test.ts:1738, CHANGELOG.md:11 cite a "s1-oss01-detection-residuals plan" as the source of a Manager ruling; no plan doc, no docs/decisions.md row, no .maat-state.json note exist for this scope (4 empty searches, run fresh) -- the ruling itself is independently verified correct, only its paper trail is missing; Exposure: ~100% of future auditors tracing this citation, basis: demonstrated; fix: commit the missing plan doc or decisions.md row, same session -> filed as its own Issue, no test (documentation gap, no executable form)
2. [CLEAN][demonstrated] Whole ADR catalog (37, both domain folders + docs/adr) checked against the diff's changed files outside the red-team/app-security lanes: devops ADR-0008 (CI/CD gates) has no timeout-minutes rule to violate and this diff only raises reliability; SE ADR-0002/0003/0004/0006 don't fire on this file family or this diff's shape; THOTH-ADR-0002 satisfied directly against shipped code (allowlist untouched, no new exemption shape, patterns.ts's match-boundary rule doesn't trigger since patterns.ts itself is unchanged) -- no cross-domain ADR collision
3. [CLEAN][demonstrated] Independently re-ran the real full-history scan at HEAD 39572a2: 2067 allowlisted, 0 blocking -- matches the CHANGELOG's own disclosed POST-commit number exactly (not the pre-commit 2031 baseline, which the CHANGELOG itself already discloses as a separate, correctly-labeled figure); npm test 1055/0/0 fail/skip, typecheck clean, eslint clean on the diff's own files (17 lint errors elsewhere are two untracked scratch PoC files at repo root, not part of this diff)
4. [CLEAN][demonstrated] Mutation drill 1 (Issue #250): dedupe key reverted to sha-alone on the shipped code -> oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another goes red (1 != 2); reverted clean
5. [CLEAN][demonstrated] Mutation drill 2 (Issue #249): patterns.ts value class mutated to a \xa0 spelling the OLD tokenizer-based guard doesn't recognise -> old test stays green (vacuous against this spelling, reproducing red-team's own prior finding), new behaviour-based test oss01-no-negated-class-rejects-a-high-byte correctly goes red; reverted clean
6. [CLEAN][code-traced] allowlist-tool.ts's runHash and history-scan.ts's scanHistory share the identical decodeBlobVariants + scanBlobText pipeline (one function each, imported by both) -- cannot drift by construction; runHash's own Set-based dedup is an intentional, orthogonal difference (distinct hashes for a human grant list, not occurrence counting) and is not a third variant of the implementer's two self-reported dedup regressions
7. [CLEAN][demonstrated] oss01-scan-timeout reserved pattern id collides with nothing: 0 of 6 real allowlist pattern ids match it, and no src/qa/* instrument enumerates SECRET_PATTERNS or patternId (grep -rl returns no file)
8. [CLEAN][code-traced] pre-commit-scan.ts calls scanHistory directly (never reimplements matching), so all four fixes apply to the hook path with zero seam
9. [SUSPICION][LOW][derived] Bundling all four issues into one commit was reasonable for #246/#247/#250 (genuinely interleaved in history-scan.ts's shared code path) but #249 (test-only, patterns.test.ts, zero production-code overlap) didn't need to be bundled -- editorial call, not a defect, doesn't block
counts (checksum over the lines above): issues=1 suspicions=1 clean=7
evidence (checksum over the tags above): demonstrated=7 code-traced=3 derived=1
checks=npm test 1055 pass/0 fail/0 skipped; typecheck clean; eslint (scoped to diff files) 0 errors; node src/secret-scan/history-scan.ts PASS 0 blocking (2067 allowlisted); mutation M1 (dedupe key reverted) oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another red (1 fail); mutation M2 (patterns.ts \xa0 spelling) oss01-no-negated-whitespace-class-hides-a-high-byte green (vacuous) / oss01-no-negated-class-rejects-a-high-byte red (1 fail); both mutations reverted, git status clean
adr=HIT(37, whole catalog)
report=docs/reviews/s1-oss01-detection-residuals-cross-domain-2026-09-22.md
