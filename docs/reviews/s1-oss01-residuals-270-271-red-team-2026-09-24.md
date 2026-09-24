# Red Team (Sutekh) — `s1-oss01-residuals-270-271` (Issues #270, #271), CRITICAL

- **Date:** 2026-09-24
- **Diff under review:** `git diff ae6b4f1..50dc996` (isolated worktree, detached HEAD `50dc996`)
- **Scope:** `src/secret-scan/patterns.test.ts` (#270, test-only); `src/secret-scan/history-scan.ts`, `src/secret-scan/allowlist-tool.ts` and their tests (#271); `docs/adr/thoth-0002-*` rows 110/111; `CHANGELOG.md`; `docs/decisions.md`
- **ADR cache:** `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 0c8a2ca) [CACHE=HIT]`
- **ADRs read for this attack surface:** THOTH-ADR-0002 (value-scoped allowlist; rows 110/111 are rewritten by this diff), devops ADR-0008 (CI/CD gates and policy-as-code — the ratchet rule and the exception process), SE ADR-0004 (idempotency), SE ADR-0006 (blast radius control), SE ADR-0010 (quality gates).
- **Note:** every internal-hostname literal quoted below is written with the dot bracketed (`prod-db01[.]corp`) so this report does not itself trip the OSS-01 gate. The scans that produced the evidence used the unbracketed form.
- **Verdict: go** — ship. 2 MED findings, both filed as Issues; no HIGH; nothing blocking.

## What I ran

| Command | Result |
|---|---|
| `node --test src/secret-scan/patterns.test.ts src/secret-scan/history-scan.test.ts src/secret-scan/allowlist-tool.test.ts` | `tests 129  pass 129  fail 0  cancelled 0  skipped 0  todo 0` (223.5 s) |
| `npm test` | `tests 1095  pass 1095  fail 0  cancelled 0  skipped 0  todo 0` (168.4 s), exit 0 |
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | clean, exit 0 |
| `npm run oss:secret-scan` | exit 0, 0 blocking, allowlisted matches reported |
| `npm run qa:completeness-claims` | `PASS: 2 file(s) checked, all completeness claims verified.` |
| `npm run qa:reference-resolver` | `PASS: 4 citation(s): 3 resolved, 1 unclassified (non-blocking, no explicit citation marker) — 0 failed.` |
| `npm run qa:recurring-findings` | `PASS: 3 recurring finding class(es) logged, all structurally valid.` |
| 6 live mutations of `src/secret-scan/patterns.ts` + 1 of `patterns.test.ts`, each applied and reverted | table in A3 |

The CHANGELOG's own `1095 passed, 0 failed, 0 skipped` claim is independently confirmed by my run. Tree verified clean after every mutation (`git status --porcelain` empty).

---

## A1 — [ISSUE][MED][demonstrated] (filed as Issue #289) One scan-timeout grant now blanket-exempts every pattern's timeout on that blob, and the gate never reports what the un-scanned blob contained

**Exposure: ~0% of runs today (0 of 59 allowlist entries use `oss01-scan-timeout`), rising to 100% of the blobs covered by the first such grant ever written, basis: measured** (`grep -c oss01-scan-timeout docs/qa/secret-scan-allowlist.json` = 0; `grep -c path docs/qa/secret-scan-allowlist.json` = 59).

### Scenario

A maintainer grants the `oss01-scan-timeout` finding for an oversized vendored JavaScript bundle (an illustrative path, not a file in this repository) — a normal, reviewed act this gate explicitly supports. That blob also contains a real internal hostname. The pattern that would have found the hostname is itself one of the patterns that times out, so the hostname is never reported at all; the only finding is the timeout, and the grant covers it.

### Demonstration (real shipped code, no mutation)

Input `T = 'a-'.repeat(60000) + ' prod-db01[.]corp '` (120016 bytes), scanned through the shipped `scanBlobText` / `partitionAllowlisted`:

```
gate findings: [
  'oss01-scan-timeout <84317fb84f7e> …[SCAN-TIMEOUT pattern=internal-hostname bytes=120016]',
  'oss01-scan-timeout <84317fb84f7e> …[SCAN-TIMEOUT pattern=email-address bytes=120016]'
]
OLD formula hashes: internal-hostname=3ba8ad4e603a  email-address=114690998d47
NEW formula hash  : 84317fb84f7e
with ONE new-formula grant -> blocking=0 allowlisted=2
OLD formula, grant computed when only email-address timed out -> blocking=1 allowlisted=1
is the real hostname anywhere in the gate findings? false
```

The same text scanned on its own:

```
--- clean scan of the secret alone ---
internal-hostname | prod…[REDACTED 14 chars]
```

Two things are demonstrated:

1. **The secret is genuinely invisible.** `history-scan.ts:196` returns `null` on timeout and `continue`s, so every real match that pattern had found before the budget expired is discarded. `prod-db01[.]corp` is detected in isolation and absent from the hostile blob's findings.
2. **The per-entry suppression scope is strictly wider than before this diff.** Both timeouts now carry one identical hash, so one reviewed hash exempts both. Under the pre-diff formula the two hashes differ, and a grant computed on a machine where only `email-address` timed out leaves `internal-hostname`'s timeout **blocking** (`blocking=1` above) — a human would have seen `SCAN-TIMEOUT pattern=internal-hostname` and had the chance to ask what was in the un-scanned blob.

### Is the machine-to-machine split that drives this real?

Yes, measured on this machine, unmutated shipped code, one blob size, six consecutive runs:

```
len 32016 ["none","internal-hostname+email-address","internal-hostname+email-address",
           "internal-hostname+email-address","internal-hostname+email-address","internal-hostname+email-address"]
```

Two different outcome sets on one machine at one size. Per-pattern cost at 28016 bytes is `internal-hostname=463ms` vs `email-address=452ms` against a 500 ms bound — an 11 ms gap inside a jitter band I measured to be much larger. `docs/reviews/oss01-verify-still-matches-debug-2026-09-23.md` independently shows a 24-byte blob timing out under 2-vCPU contention, so the split is not confined to the size boundary.

### Current defense, honestly assessed

- **Content-addressing holds.** The grant is still keyed to the exact scanned text: a different blob at the same path still blocks (`oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path`, green in my run). A secret *added* to the granted blob changes the text, changes the hash, and blocks.
- **Path scoping holds.** `partitionAllowlisted` (`history-scan.ts:356`) keys on `(path, patternId, hash)`. The grant cannot travel to another path.
- **Cross-id leakage is structurally impossible.** A real pattern's match is filed under its own `patternId`, so a grant under `oss01-scan-timeout` can never exempt a real match. I tried; the map key forbids it.
- **The widening is disclosed** in the ADR row this diff rewrites: *"one grant covers that blob's timeout whichever pattern trips it."* That honest disclosure is why this is MED and not HIGH.
- **The gate still names what was skipped on a passing run**: `summarizeMatches` emits `allowlistedDetails` even when `blocking.length === 0`, and each line carries `pattern=<id>`. Confirmed in my `npm run oss:secret-scan` output. This is the mitigation that keeps the widening reviewable — and nothing pins it.

### On the Manager's ADR-0008 ruling

devops ADR-0008: *"MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)."*

The ruling ("dropping `pattern.id` is not a broadening; no existing allowlist entry uses the reserved id") is **correct about the list** — measured, and I reproduced the measurement. It is **incomplete about the mechanism**: the demonstration above shows one entry now suppresses strictly more findings than the identical entry would have suppressed before. I would not overturn the ruling — the change buys grant reproducibility, which is a real defect fix; the direction stays fail-safe (never a silent pass of a *reported* match); and the ADR row states the new semantics plainly. But the ruling's own reasoning should record the mechanism half, not only the list half, and the new boundary needs a test.

Also checked and rejected as bypasses: **path scoping** (entry key includes path; a grant cannot follow the blob elsewhere), **pre-arming** (an entry can be written for text that does not yet exist and does not time out — but the hash formula ships in open-source code, so anyone able to write an entry could always compute `sha256("oss01-scan-timeout:<pid>:<text>")` for all ten ids offline; the tool's old refusal was a convenience bound, not a control), and **cross-id collision** (see A7).

### Verdict: BREAKS — the narrower per-pattern grant is gone and the replacement boundary is untested

### Named proof-test required before merge

`oss01-a-scan-timeout-grant-covers-every-patterns-timeout-on-that-blob-and-nothing-more` in `history-scan.test.ts`, asserting all three legs:

1. one grant exempts *every* pattern's timeout on that exact text (pins the intended wider semantics, so no future reader mistakes it for a bug);
2. the same grant exempts **no** real-pattern match at any path (pins the `patternId` key);
3. on a **passing** run the summary still emits one `ALLOWLISTED … pattern=<id>` line per skipped pattern — the only surviving signal that a granted blob's coverage widened.

---

## A2 — [CLEAN][code-traced + demonstrated] The no-scan unlock hash equals what the gate accepts, on every machine

**Attack:** make the developer's `allowlist-tool hash … oss01-scan-timeout` print something the gate will not accept — a machine where nothing times out, a machine where real matches are found, a Windows checkout, a BOM'd blob.

**Result: SURVIVES.**

- Both sides call the *same exported function* on the *same input*: gate `scanBlob` → `decodeBlobVariants(await git.catFileBlob(sha))` → `scanBlobText(text)` → `scanTimeoutHash(text)` (`history-scan.ts:181`, `:225`, `:258`); tool `runHash` → `decodeBlobVariants(await git.catFileBlob(sha))` → `hashLines(text, id)` → `scanTimeoutHash(text)` (`allowlist-tool.ts:379-380`, `:308`). One function, no reimplementation left to drift.
- **Line endings cannot diverge.** Both read `git cat-file blob`, i.e. raw object bytes, never the working tree — so `core.autocrlf` on a Windows checkout cannot change either side's input. This was the most plausible cross-machine break and it is closed by construction.
- **Blobs where real matches are found:** irrelevant to this branch — it no longer scans, so a blob full of real matches still yields exactly one timeout hash per decoded variant.
- **Blobs where the timeout does not trip:** the tool prints the hash anyway; the gate emits no finding; the entry matches nothing. Fail-safe, already disclosed as Issue #235.
- **BOM'd blob:** the tool prints one hash per decoded variant, a superset of what the gate reported. A superset unlocks, and the extra hash is scoped to that same blob's other decoding, so it widens nothing.
- Shipped proof: `oss01-scan-timeout-unlock-hash-does-not-depend-on-this-machines-speed` and `oss01-every-blocking-pattern-id-has-a-runnable-unlock-command` (the latter drives the real CLI end-to-end), both green in my 129/129 run.

---

## A3 — [ISSUE][MED][demonstrated] (filed as Issue #290) #270's registry closes the two hand-kept dimensions, but `ascii-only` is a self-declared opt-out with no mechanical cross-check — and a cheap one exists

**Exposure: ~0% of runs today (all 8 current `ascii-only` declarations verified honest by my own instrument), 100% of the sweep coverage of any future pattern mis-declared `ascii-only`, basis: measured.**

### The mutations I ran on real `patterns.ts` (each applied, tested, reverted)

| # | Mutation | Suite result | Caught by |
|---|---|---|---|
| M1 | 11th pattern (`db-connection-uri`) added, no registry entry | `tests 21 pass 19 fail 2` | `oss01-every-catalog-pattern-is-classified-for-the-high-byte-sweep` + the 11th-pattern control |
| M2 | password value class becomes a positive printable-ASCII class `{8,}` | `tests 21 pass 16 fail 5` | the sweep + 4 others |
| M3 | first-character-only narrowing (negative lookahead on 0xA0 before the class) | `tests 21 pass 20 fail 1` | **only** `oss01-no-value-class-however-written-hides-a-high-byte` |
| M4 | last-character-only narrowing (negative lookbehind on 0xA0 after a `{7,}` class) | `tests 21 pass 19 fail 2` | the sweep + its own control |
| M5 | PEM body class narrowed from any-character to ASCII-only | `tests 21 pass 19 fail 2` | the sweep + the negated-whitespace guard |
| **M6** | **11th pattern with a free-form, high-byte-hiding value class, *declared `ascii-only`* with a plausible reason** | **`tests 21 pass 21 fail 0` — GREEN** | **nothing** |

M3 is the clearest evidence the #270 fix earned its keep: the first-character-only narrowing is caught by the new test and by *nothing else in the suite*. The issue was real, the fix works, and I could not get past the sweep on any free-form pattern.

### M6, proved non-vacuous

The mis-declared pattern really does hide high bytes — I ran the sweep the registry declined to run:

```
control all-ascii matched whole: true
cells 1024 hidden 1024
real secret line: "postgres://user:pa<0xA0>ssword@db[.]corp" -> match: undefined
```

1024 of 1024 cells hidden, at every value position, and a realistic password containing one 0xA0 byte goes entirely unmatched — while the suite reports green at `catalog patterns=11 free-form=2 ascii-only=9`.

### Current defense, honestly assessed

The test header **discloses this exactly**: *"What stays a declared judgment, by design: whether a pattern is `free-form` … or `ascii-only`."* The declaration is forced, visible in the diff of any pattern addition, and a reviewer of that diff is the control. That is a fair design call and I am not asking for it to be reversed.

What is not fair is CLAUDE.md's own hard rule: *"Any claim of completeness/exhaustive enumeration … is generated by a running instrument — never hand-typed or hand-derived in prose."* Eight `ascii-only` reasons over regexes with nested classes, lookaheads and lookbehinds are not the "short, flat set that's genuinely trivial to eyeball" the proportionality clause exempts — this same catalog has produced four consecutive value-class defects (#244, #249, #268, #270). And the instrument is eight lines. I wrote it, extracting each character class from the shipped source and testing it against 0xA0:

```
aws-access-key-id        classes=1  accepting-0xA0=none
aws-secret-access-key    classes=4  accepting-0xA0=none
github-pat               classes=2  accepting-0xA0=none
github-fine-grained-pat  classes=2  accepting-0xA0=none
slack-token              classes=2  accepting-0xA0=none
internal-hostname        classes=2  accepting-0xA0=none
ipv4-private             classes=2  accepting-0xA0=none
email-address            classes=4  accepting-0xA0=none
```

All 8 current declarations are honest — which is why exposure today is 0% and this is MED, not HIGH. But the check that establishes that is mine, in this report, not in the suite.

### Verdict: BREAKS — a mis-declared `ascii-only` entry silently removes a pattern from the only sweep covering it, and the declaration has no mechanical cross-check although a cheap one demonstrably passes today

### Named proof-test required before merge

`oss01-an-ascii-only-declaration-is-mechanically-consistent-with-its-pattern` in `patterns.test.ts`: for every `ascii-only` entry, extract each character class from the shipped regex source and assert that none accepts a byte in `0x80..0xFF`. Positive control: the M6 shape (a class accepting 0xA0, declared `ascii-only`) must fail it. This converts the eighth shape of the evasion family — mis-classification — from a reviewer's eye into a failing test, at roughly ten lines, and it passes unchanged against today's catalog (evidence above).

---

## A4 — [CLEAN][code-traced] The replaced test: protection was moved, not lost, and the diff says so

The deleted expectation was `assert.deepEqual(hashLines("nothing hostile here\n", "oss01-scan-timeout"), [])` — "ordinary text mints no grant material." It is replaced by `assert.equal(…length, 1)`.

- **This is a genuine reduction, and it is the intended one.** The whole point of #271 is that the unlock must print the hash on a machine where nothing times out. The old assertion and the fix are logically incompatible; no version of this fix keeps it.
- **It is replaced, not deleted** (ADR-0008's ratchet is about deleting tests): the test still runs and still asserts a shape, and two *new* tests (`oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow`, `oss01-scan-timeout-unlock-hash-does-not-depend-on-this-machines-speed`) assert strictly more than the old one did.
- **Circular-oracle attack: fails.** Both new tests compute the expected digest independently inside the test (`h(...)` / `sha256(...)`), not by importing the function under test. That is the defect shape `red-team` found in the S5 halt work; it is not present here.
- **The capability the old assertion bounded was never real.** The hash formula ships in open-source code, so anyone able to write an allowlist entry could always compute the digests offline for all ten ids.
- What *is* lost is a reviewer cross-check: `allowlist-tool hash … oss01-scan-timeout` used to exit 1 with `no … match in that blob`, so a reviewer could test whether a proposed grant corresponded to anything real. It now always exits 0. Fail-safe (an inert entry blocks nothing and grants nothing until that exact text appears at that path), and it is A1's third proof-test leg rather than a separate finding.

---

## A5 — [CLEAN][demonstrated] Completeness claims in the diff are instrument-produced

| Claim | Instrument | Result |
|---|---|---|
| `npm test` 1095 / 0 / 0 (CHANGELOG) | my own `npm test` | `tests 1095 pass 1095 fail 0 skipped 0` — matches |
| "No allowlist entry uses the reserved id" (CHANGELOG, ADR row 110, plan section 1) | `grep -c oss01-scan-timeout docs/qa/secret-scan-allowlist.json` | `0` — matches |
| "must classify EVERY id in `SECRET_PATTERNS`" | `unclassifiedPatternIds` + the named test | enforced in both directions; M1 proves it bites |
| `catalog patterns=10 free-form=2 ascii-only=8` | `t.diagnostic` from the run | printed, not typed |
| `sweep cells=2048` | `t.diagnostic`, asserted equal to `value.length * 128` | printed, not typed |
| ADR row 110's old hand-typed "eight real patterns" | removed by this diff | `git grep "eight real" docs/adr` = 0 |

The one hand-derived claim left standing is the `ascii-only` reason set, which is A3.

---

## A6 — [SUSPICION][LOW][demonstrated] `allowlist-tool hash <c> <p> <realPatternId>` prints a SCAN-TIMEOUT hash under the wrong pattern id (pre-existing, unchanged by this diff)

```
hash <...> internal-hostname -> ["dc49dd88…  …[SCAN-TIMEOUT pattern=internal-hostname bytes=200000]"]
gate scanTimeoutHash        -> dc49dd88366166f026e63e677fdfcbca536e4cbe709eb11ad0123f52f8bfa269
```

`hashLines`' non-reserved branch (`allowlist-tool.ts:314`) delegates to `scanBlobText`, which is itself bounded — so on a hostile blob it returns the *timeout* finding and maps it into output as though it were an `internal-hostname` hash. A maintainer who files that hash under `patternId: "internal-hostname"` gets an entry that can never match, because the gate files it under `oss01-scan-timeout`. **Fail-safe, dead grant, confusing.** Byte-identical code at `ae6b4f1`, and the gate's own printed unlock always names the correct id, so the only route in is hand-running the tool with the wrong id. Not filed as an Issue (LOW).

---

## A7 — [CLEAN][code-traced] Hash-namespace, concurrency, idempotency and hostile-lens attacks on the new function

- **Namespace collision.** `scanTimeoutHash` lost one separator field (`oss01-scan-timeout:<text>` instead of `oss01-scan-timeout:<pid>:<text>`), so in principle a real match whose bytes are literally `oss01-scan-timeout:<x>` would hash like a timeout grant for `<x>`. Not exploitable: `partitionAllowlisted` requires `patternId` to agree, and the two live under different ids. The pre-existing latin1/utf16le hash-namespace suspicion from round 2 is unchanged by this diff.
- **Shared `vm` sandbox.** `timeoutSandbox` is module-level mutable state, but `scanBlobText` is fully synchronous with no `await` inside the sandbox window, and `scanHistory` awaits each blob in sequence. This diff *reduces* exposure: the reserved-id unlock no longer enters the sandbox at all, removing one wall-clock flake surface from the maintainer path and from `sb2-hash-lines-computes-the-scan-timeout-pattern-id-without-throwing`.
- **Idempotency (SE ADR-0004).** `scanTimeoutHash` is pure; the unlock run twice prints identical lines. Run-twice holds.
- **Hostile lens.** Nothing in this diff moves a trust boundary. The allowlist is a reviewed file in the repo; a compromised CI runner gains nothing new, since it could already suppress the gate by editing the workflow — a different, pre-existing problem outside this diff.

---

## Editorial (verdict-neutral, plain edits, no re-review)

1. `history-scan.test.ts:2096` — the comment on the #264 test still reads "one entry per (path, patternId) that timed out, each carrying blobA's OWN …", which described the pre-#271 per-pattern hash. There is now one hash per blob. The test itself is correct and green; only the comment is stale.
2. `docs/decisions.md`'s new row states the ADR-0008 ruling as "not a broadening … (no existing allowlist entry uses the reserved id, measured, and a grant stays content-addressed and path-scoped)". Accurate about the list; silent about the per-entry scope change the ADR row itself discloses two lines away. One clause closes the gap.
3. `docs/adr/thoth-0002-*` row 110 still says "besides the **six** real pattern ids" — the catalog has ten. The same hand-typed-count class this story fixed elsewhere in the same row.

---

## Scariest unproven assumption

**That a maintainer granting an `oss01-scan-timeout` finding understands they are granting "this blob is not scanned, for every pattern, until its bytes change" — and that the `ALLOWLISTED … pattern=<id>` lines on a passing run are what tells them.** Nothing in the suite pins that reporting, and this diff widens exactly what those lines have to communicate. It is also the assumption behind Issue #287: while the bound is a wall clock, a granted blob's scan coverage is decided by a race, not by a review.

## Go / no-go

**go.** Both findings are MED with measured 0% live exposure, both are disclosed in the shipped docs rather than hidden, and the fixes they call for are additive tests, not redesigns. The #270 half survived every mutation I could aim at a free-form pattern; the #271 half survived every cross-machine divergence attack I could construct. Open findings: 2. Failing tests required: 2 — `oss01-a-scan-timeout-grant-covers-every-patterns-timeout-on-that-blob-and-nothing-more` and `oss01-an-ascii-only-declaration-is-mechanically-consistent-with-its-pattern` — one per finding, both executable, so the two counts agree.

## Single next action

Write `oss01-an-ascii-only-declaration-is-mechanically-consistent-with-its-pattern` (roughly ten lines; passes against today's catalog per the evidence in A3). It is the cheaper of the two and it closes the eighth and last shape of the evasion family that has now cost four rounds.

---

RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] One scan-timeout grant now blanket-exempts every pattern's timeout on that blob and the un-scanned content is never reported; content-addressing, path scoping and cross-id separation all hold and the widening is ADR-disclosed, but the new boundary has no test — Exposure ~0% of runs today, basis measured (0 of 59 entries use the id)
2. [ISSUE][MED][demonstrated] `ascii-only` is a self-declared opt-out from the high-byte sweep with no mechanical cross-check; a mis-declared 11th pattern hid 1024/1024 high-byte cells with the suite green — all 8 current declarations verified honest by my own 8-line instrument, so exposure is 0% today, basis measured
3. [CLEAN][code-traced] The no-scan unlock hash equals the gate's on every machine — one shared `scanTimeoutHash`, both sides read `git cat-file blob` so autocrlf cannot diverge them; a BOM'd blob prints a superset that unlocks and widens nothing
4. [CLEAN][code-traced] The replaced expectation is logically incompatible with the fix, is replaced not deleted, and the two new tests use independently computed oracles — no circular oracle, no real capability lost
5. [CLEAN][demonstrated] Every completeness claim in the diff is instrument-produced; CHANGELOG's 1095/0/0 reproduced exactly
6. [SUSPICION][LOW][demonstrated] `allowlist-tool hash` with a real pattern id on a hostile blob prints a SCAN-TIMEOUT hash under that id, yielding a dead grant — pre-existing, fail-safe, byte-identical at ae6b4f1
7. [CLEAN][code-traced] Hash-namespace collision, shared vm sandbox, idempotency and compromised-runner attacks all fail; this diff removes one wall-clock flake surface from the unlock path
counts (CHECKSUM): issues=2 suspicions=1 clean=4
evidence (CHECKSUM): demonstrated=4 code-traced=3 derived=0
checks=node --test (3 secret-scan files) 129 pass / 0 fail / 0 skip; npm test 1095 pass / 0 fail / 0 skip; typecheck clean; lint clean; oss:secret-scan exit 0 (0 blocking); qa:completeness-claims PASS; qa:reference-resolver PASS (0 failed); qa:recurring-findings PASS; 7 live mutations applied and reverted, tree verified clean
adr=HIT(37)
report=docs/reviews/s1-oss01-residuals-270-271-red-team-2026-09-24.md
