# S6 "Policy Centralization" -- App-Security Review (post-build, Stage 3)

**Scope:** built diff (uncommitted working tree, verified via `git status --short` and `git diff HEAD~1 HEAD --stat`), Milestone #24. **Tier:** CRITICAL. **Reviewer:** app-security-reviewer (Horus). **Date:** 2026-09-08.

**Files reviewed:** `src/policy/config/{central-source,position-parser,loader,pin,printer,print-cli}.ts` (+`.test.ts` for all but `print-cli.ts`), `src/policy/rule/precedence.ts` (`mergeLayersWithMandatoryLock`) + `precedence.test.ts`, `src/policy/kernel/rule-types.ts`, `src/policy/rule/schema.ts` + `schema.test.ts`, `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`, `docs/qa/s6-policy-loader-fixtures/*`, `package.json` diff.

**Read first:** `docs/plans/S6-phase1-v2-2026-09-08.md`, `docs/decisions.md` 2026-09-08 rows (S6 intake ruling, plan ratification, pre-build review ruling, Phase-2-build-complete row), `docs/reviews/s6-policy-centralization-design-challenger-2026-09-08.md` (go, 6 MED derived findings), `docs/reviews/s6-policy-centralization-architecture-2026-09-08.md` (APPROVE-WITH-CONDITIONS, 6 MED/LOW derived findings).

---

## ADR compliance (mandatory gate)

`node docs/adr-cache.mjs --ensure` returned: `CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] ... [CACHE=HIT]`.

My domain slice (authn/authz, input handling, secrets, dependencies, data exposure) intersects one ADR with binding rules touching this diff: **SE ADR-0021** (Thoth-native architecture -- kernel purity, POL-11). Applicable rule, quoted:

> No filesystem, network, process-spawning, timer, or vendor-SDK import MAY appear anywhere under the kernel's own module boundary; the layer boundary is enforced by a lint rule or structural test, not by convention alone.

**Verified, not assumed:** `src/policy/config/**` (where `central-source.ts`'s `execFileSync` call and every other new module lives) is outside `KERNEL_ROOT` (`src/qa/kernel-purity-check.ts:210` = `src/policy/kernel`). Ran the real scanner:

```
$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
EXIT=0
```

`rule-types.ts`'s new `mandatory?: boolean` field lands inside the kernel boundary but is pure data (no I/O, no new import) -- confirmed it cannot trip the scanner's import/forbidden-global checks (architecture-reviewer's pre-build findings 7/8, re-confirmed here against the live tool, not just cited).

No other ADR in my domain slice applies -- no IAM/secrets-in-IaC content (devops ADR-0009 is devops-domain, out of my slice), no data/DB ADRs triggered (read path, no DB). **No BLOCKER from ADR non-compliance.**

---

## Findings

### 1. [CLEAN][demonstrated] Subprocess call is genuinely injection-safe -- argv array, no shell, hardcoded key/value

`central-source.ts:157-158,188-193`:
```ts
const defaultRunner: SyncRegQueryRunner = (cmd, args, opts) => execFileSync(cmd, args as string[], opts);
...
stdout = runner("reg.exe", ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME], { timeout: 5_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "utf8" });
```
`execFileSync` is called with a literal command string and a literal argv array -- no `shell: true`, no string concatenation of any operand. `REGISTRY_KEY_PATH` (`HKLM\SOFTWARE\Policies\Thoth`) and `REGISTRY_VALUE_NAME` (`CentralPolicyJson`) are hardcoded module-level constants (`central-source.ts:107-108`), never derived from user/environment/config input anywhere in the diff -- there is no operand here an attacker (a governed session, or anything with only project-file write access) can influence at all. This is the textbook safe shape; the plan's own worry (SS1/SS6, "net-new subprocess-safety work, first-time scrutiny") is fully discharged.

**Demonstrated:** `central-source.test.ts:78-90` asserts the exact captured argv (`capturedCmd === "reg.exe"`, `capturedArgs === ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME]`) via an injected runner -- ran it:
```
PASS: AC7(i): createWindowsRegistryCentralPolicySource calls reg query with the exact key path and value name, no shell interpolation of either
```

### 2. [CLEAN][code-traced] Timeout and output-size bound are real, Node-enforced limits, not documentation-only

`timeout: 5_000` and `maxBuffer: 1024 * 1024` are passed directly into Node's own `child_process.execFileSync` options -- these are primitives Node itself enforces (kills the child process past the timeout; throws `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER` and kills the child past the buffer cap), not values this codebase merely threads through and trusts a comment to honor. `windowsHide: true` additionally suppresses a console-window flash. Confirmed both bound values are passed unconditionally on every call (`central-source.ts:189-193`), not gated behind any flag that could be silently unset.

### 3. [CLEAN][demonstrated] Fail-closed on every central-channel failure shape -- parse error, schema error, and read error (including the disclosed timeout/maxBuffer/permission-denied paths) all reject the whole load

Traced the full catch chain: `central-source.ts:194-204` -- only a stderr match against the real, captured "key/value not found" text (`central-source.ts:114`, `isNotFoundError`) resolves to `{status:"absent"}`; every other failure (timeout, `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER`, `ENOENT`, "Access is denied", an unrecognized stdout shape) is re-thrown. `loader.ts:100-104` catches that throw and turns it into `reasonKind: "read-error"`, `ok: false` -- the whole load rejected, never silently treated as central-absent. Verified this explicitly for the "Access is denied" case (`central-source.test.ts:71-73`, asserted NOT matched by `isNotFoundError`) -- meaning a genuine permission failure on the real channel fails closed rather than degrading to "nothing deployed," which is the correct posture for a security-boundary read.

**Demonstrated**, ran the real test files:
```
$ node --test src/policy/config/*.test.ts src/policy/rule/precedence.test.ts src/policy/rule/schema.test.ts
PASS AC5a: central channel ABSENT -- contributes zero rules, load succeeds ...
PASS AC5b: central present, syntactically INVALID JSON -- whole load rejected, reasonKind=json-parse-error ...
PASS AC5b: central present, syntactically VALID JSON but fails schema validation -- whole load rejected, reasonKind=schema-invalid ...
PASS AC5c: centralSource.read() itself THROWS -- whole load rejected, reasonKind=read-error ...
PASS table: absent, unsupported, present-valid succeed; malformed-json, schema-invalid, read-error all fail-closed -- none of the three failure shapes collapses into the non-rejecting bucket ...
tests 84
pass 84
fail 0
skipped 0
```
All 84 tests pass, 0 skipped, 0 failed -- raw output captured above (trimmed; full run available on request).

### 4. [CLEAN][code-traced] Discriminated union prevents "platform unsupported" from being silently read as "central confirmed absent"

`CentralPolicyResult = {status:"absent"} | {status:"unsupported"} | {status:"present", raw, channel}` (`central-source.ts:98-101`). The reader returns `"unsupported"` immediately on any non-`win32` platform, before attempting any subprocess call (`central-source.ts:182-184`) -- confirmed no `runner` invocation happens in that branch (`central-source.test.ts:131-141`, asserts `called === false`). `pin.ts`'s `sentinelFor()` hashes a different sentinel string per status (`__thoth-central-absent__` vs `__thoth-central-unsupported__`), so the two states are also cryptographically distinguishable at the pin layer, not just the printer layer -- closing architecture-reviewer's pre-build finding 2 exactly as specified, and demonstrated (`pin.test.ts`: "absent and unsupported produce DIFFERENT pin digests from each other too", passing).

### 5. [CLEAN][code-traced] Single-read invariant structurally closes the POL-09 pin TOCTOU (design-challenger Attack F)

`loader.ts:98-104` calls `input.centralSource.read()` exactly once, at the top of `loadEffectivePolicy()`, before shipped-defaults/project are touched; the one returned `CentralPolicyResult` feeds both the merge (`centralRuleSet`, line 124) and the pin (`centralRawForPin`, threaded into `computePin()` at line 165). `pin.ts` itself has **no `CentralPolicySource` dependency at the type level at all** (confirmed by reading the full file -- `ComputePinInput` only accepts `centralStatus`/`centralChannel`/`centralRaw` as plain data) -- a future refactor cannot accidentally reintroduce a second independent read from inside `pin.ts`, because there is nothing in that file's signature capable of calling `.read()` again. This is a structural fix, not a convention. Demonstrated: `loader.test.ts`'s "AC2 (design-challenger Attack F): centralSource.read() is called EXACTLY ONCE per invocation, and that ONE returned value feeds BOTH the merge and the pin" -- passing, using a test double whose `read()` returns a different string per call.

### 6. [CLEAN][code-traced] mergeLayersWithMandatoryLock is the general form, verified against realistic bypass shapes

Read `precedence.ts:124-136` in full. The lock check inspects `rule.mandatory` (the stored rule's own field) -- never `layer.name`/`sourceLayer` -- so the "plausible-but-wrong" implementation design-challenger's Attack C named (`sourceLayer === "central"`, which would pass every central-to-project test while silently doing nothing for shipped-defaults-to-central) is structurally impossible to have shipped here: the code has no branch that references a layer name at all in the lock-check loop. This was independently the single MED finding both pre-build reviewers rated highest-risk (Issues #65/#66/#99 recurring-bug-shape concern), and the human ruling (`docs/decisions.md`, 2026-09-08) required a shipped-defaults-to-central regression test *now*, not backlogged -- it exists and passes: `precedence.test.ts`, "SHIPPED-DEFAULTS -> CENTRAL is the SAME general mechanism as central -> project, not a special case."

Checked the specific bypass classes named in this review's brief:
- **Id case-folding / whitespace variants:** the lock and merge both key on exact `rule.id` string equality (`Set<string>`/`Map<string,...>` throughout -- never a plain-object key). A project rule with a whitespace- or case-variant id does not collide with (and therefore cannot suppress or override) a mandatory central rule of near-identical spelling -- but it also does not need to: the mandatory central rule remains present in the merged output unmolested under its own id. This is a real property, not a documented design invariant of case/whitespace normalization (nothing in POL-07's acceptance text or the ratified decision claims ids are normalized) -- noted below as finding 11, a hardening observation, not a defect against a stated requirement.
- **Duplicate-key JSON tricks:** `JSON.parse`'s own last-key-wins semantics apply uniformly to every layer (central, shipped-defaults, project) before `validateRuleSet()` runs -- no special-cased trust asymmetry between layers here; a duplicate top-level key inside one rule object (e.g. two `mandatory` keys) resolves the same way `JSON.parse` always resolves it, and the resulting object is then validated by `schema.ts`'s strict allowlist regardless of which layer it came from.
- **Prototype-pollution-shaped keys** (`__proto__`, `constructor`, `prototype`): the merge core (`mergeLayersById`) stores entries in a `Map<string, ...>` keyed by `rule.id` (`precedence.ts:49`), never in a plain object via bracket/dot assignment -- `Map` is immune to prototype-chain interference by construction. `schema.ts`'s `validateRule`/`validateRuleSet` iterate `Object.keys(input)` against a fixed allowlist (`RULE_KEYS`/`RULE_SET_KEYS`) -- a key literally named `__proto__` would just be rejected as an "unknown key" like any other name not on the allowlist. No plain-object property assignment from untrusted JSON keys exists anywhere in this diff's merge/validate path.

Demonstrated: `precedence.test.ts`'s full mandatory-lock suite (11 tests, all passing) including AC1 (byte-identical redefinition still rejected), AC9 (whole-layer rejection granularity).

### 7. [CLEAN][code-traced] POL-09 pin's scope is honestly bounded -- a project-layer-only attacker cannot make the pin misrepresent the central channel

The pin (`pin.ts`) hashes only `centralRaw` -- project-layer content never enters the digest. This is **by design**, matching the narrowed POL-09 scope ratified 2026-09-01 (`docs/decisions.md`: "S6 (#24) POL-09 narrowed to the pinning/stamping half only") -- the pin's stated claim (`pin.ts:1-4`, own doc comment: "a change under review cannot alter the policy that judges it") is specifically about the **central** channel being immune to the governed session's own write reach, not about the project layer (which is *expected* to be session-writable, and is the very thing POL-07's mandatory-lock protects against, and POL-10's printer discloses per-rule origin+line for regardless of pin coverage). An attacker with write access to only `.thoth/policy.json` (the project file) can change project-layer rules -- visibly, via the printer's own per-rule origin/line output -- but cannot cause the pin to claim a false statement about the central channel's content, because the pin never claims anything about the project layer in the first place. Verified this is the intended scope, not an oversight, by reading the ratified decision row directly rather than assuming.

### 8. [CLEAN][code-traced] No new dependency added

`git diff package.json` shows exactly one line added: a new `policy:print` npm script pointing at `node src/policy/config/print-cli.ts`. No new `dependencies`/`devDependencies` entry. This repo carries no `package-lock.json` (a genuinely zero-runtime-dependency project -- confirmed via `ls`, no such file exists) -- consistent with the plan's own claim and with `position-parser.ts` being a hand-rolled tokenizer specifically to avoid adding one (SE ADR-0010, already checked CONFORMS by architecture-reviewer's pre-build pass, re-confirmed here against the actual diff).

### 9. [CLEAN][code-traced] No secrets or sensitive-data leakage in the new read path, error messages, or fixtures

- Fixtures (`docs/qa/s6-policy-loader-fixtures/*`, `central-source.test.ts`'s captured samples) contain only a benign, publicly-known Windows product string ("Windows 10 Home") and placeholder JSON -- no credentials, hostnames, usernames, or internal identifiers.
- `printer.ts`'s output intentionally discloses rule content, origin file/channel, and line numbers -- this is POL-10's stated job ("one command answers 'why is this blocked'"), not a leak; the channel descriptor is a fixed constant (`win32-registry:HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson`), not secret material.
- `pin.ts` exposes only a SHA-256 hex digest of the central bytes -- a one-way digest, never the raw content itself.
- Every rejection message (`loader.ts`'s `LoadFailure.message`) is built from `JSON.parse`'s own error text or `schema.ts`'s structural validation messages (field names and expected shapes) -- grepped `schema.ts` in full: no error path interpolates a field's actual VALUE into a message, only key names and type descriptions. No central-content leak into rejection text beyond what POL-10 already intends to disclose for successful loads.
- Grepped the whole diff for password/secret/api-key/token patterns -- the only hits were "tokenize"/"tokens" (the position-parser's own vocabulary), a false positive, no real secret material anywhere.

### 10. [CLEAN][demonstrated] Build/gate evidence, raw

```
$ node --test src/policy/config/*.test.ts src/policy/rule/precedence.test.ts src/policy/rule/schema.test.ts
tests 84 / pass 84 / fail 0 / cancelled 0 / skipped 0 / todo 0

$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, exit 0, no output)

$ npm run lint
> eslint .
(clean, exit 0, no output)
```
The pre-existing lint failure `docs/decisions.md`'s Phase-2-build-complete row disclosed (`printer.test.ts:399`, no-unnecessary-type-assertion) is **no longer present** -- `npm run lint` is clean as of this review's run. Noted as a positive delta, not re-verified against that specific line since the whole-repo lint gate is the authoritative signal.

### 11. [SUSPICION][LOW][derived] Mandatory-lock id matching has no normalization -- a hardening note, not a demonstrated bypass

As detailed in finding 6: id matching is exact-string, case- and whitespace-sensitive, with no normalization step anywhere in the merge/lock path. This does not let an attacker suppress or override a mandatory central rule (it remains present under its own id regardless), and nothing in POL-07's acceptance text or the ratified decision claims id normalization is in scope. Whether a project-layer session could meaningfully exploit a near-identical-but-distinct id to create a competing/confusing rule depends entirely on `kernel.ts`'s own rule-evaluation/precedence semantics for multiple matching rules -- `kernel.ts` is **unchanged by this diff** (confirmed via `git diff HEAD -- src/policy/kernel/kernel.ts`, empty) and was reviewed under S2's own app-security pass, out of this review's scope. Flagging as a named observation for whichever future story authors real mandatory shipped-defaults/central content (the same NOT-COVERED queue architecture-reviewer's finding 6 already tracks) to consider whether id-collision detection should also cover confusable-id classes, not as a defect in this diff.
Exposure: unbounded, basis: assumption (no attacker with project-write-only access has been demonstrated to gain anything from this) -- capped at LOW per the evidence policy.

### 12. [SUSPICION][LOW][derived] Disclosed single-line-REG_SZ assumption -- worst case verified fail-closed, not fail-open

`central-source.ts:82-89` discloses (PRINCIPLES rule 18) that `extractRegSzValue` assumes a REG_SZ value's data renders entirely on one `reg query` output line -- untested against a genuinely multi-line-rendered value, since none was ever created (content-authoring is out of S6's scope). Traced the failure mode if this assumption is ever wrong: a value whose data spans multiple `reg.exe` output lines would have only its first line's fragment captured by `extractRegSzValue`'s single-line regex; that fragment is very likely truncated/invalid JSON, which `parseLayerText` (`loader.ts:73-79`) catches via `JSON.parse`'s own throw -> `reasonKind: "json-parse-error"` -> whole load rejected. The disclosed gap's worst case is therefore an inconvenient fail-closed rejection (an admin must reformat as single-line JSON), never a fail-open or a silently-corrupted-but-accepted parse. Confirmed this by code-tracing the two functions together, not by a dedicated test (none exists for this specific shape, consistent with the disclosed scope). Not a security defect; restating the existing disclosure with its safety direction explicitly confirmed.
Exposure: unmeasured, basis: assumption (real multi-line REG_SZ rendering was never observed) -- capped at LOW.

---

## Trust-boundary correctness (explicit answer to the review brief)

The central channel is treated as fully untrusted input, identically to shipped-defaults and project: `parseLayerText()` (`loader.ts:73-91`) is the single shared code path all three tiers go through -- `JSON.parse` then `validateRuleSet()` (schema.ts's strict allowlist) -- no tier gets a shortcut or a relaxed check. Size is bounded by Node's own `maxBuffer` enforcement on the subprocess read (finding 2); structure is bounded by the same schema validator every tier uses (finding 3, POL-06's discipline, unchanged by this diff). This matches (and in fact exceeds, since it is the FIRST tier requiring subprocess mediation) the diligence already applied to project/shipped-defaults file reads.

## Fail-closed vs. fail-open -- explicit answer

No code path found where a central-channel read error, malformed value, or unexpected exception results in the loader silently proceeding as if central were absent. Every failure shape (JSON parse error, schema-invalid, subprocess read error including timeout/maxBuffer/permission-denied, mandatory-lock violation) independently routes to `ok:false` and rejects the WHOLE load -- verified by code trace (findings 3, 6) and by 84/84 passing tests including the explicit "none of the three failure shapes collapses into the non-rejecting bucket" table test.

## Editorial

None found in the reviewed files -- prose in `central-source.ts`'s header, `loader.ts`'s header, and `pin.ts`'s header is internally consistent with `docs/decisions.md`'s corresponding rows on every point checked.

## Findings vs. failing tests

All findings above are CLEAN or LOW-severity SUSPICION (derived, non-blocking). No open finding requires a new failing test -- the two LOW suspicions are hardening observations against unstated requirements / already-safe-in-the-worst-case disclosed limitations, not confirmed defects. Open findings requiring a test: 0. This matches "findings become tests" -- there is nothing here to convert.

## Verdict

**APPROVE.** No BLOCKER found. SE ADR-0021's kernel-purity rule (the one applicable ADR in my domain) is verified CONFORMS against the live scanner, not merely by convention. The subprocess call is genuinely argv-array-based with no injection surface (hardcoded operands, no shell), with real Node-enforced timeout/buffer bounds. Every central-channel failure shape fails closed, demonstrated by 84/84 passing tests. The discriminated union and single-read invariant close exactly the two structural risks the pre-build reviews flagged (platform-unsupported/absent conflation; pin TOCTOU), verified against the shipped code, not just the plan's claims. The mandatory-lock mechanism is the general form (not the "looks-equivalent-for-the-tested-case" trap this codebase has shipped before), proven by the shipped-defaults-to-central regression test the human ruling required. No new dependency, no secrets/sensitive-data leak. Two LOW, non-blocking hardening observations noted for the future content-authoring story's queue.

## Single next action

None required to ship S6 from an app-security standpoint. The one still-genuinely-open item is the plan's own human-owned confidence-path step (section 3a point 3: a real write-and-provision round trip against `HKLM\SOFTWARE\Policies\Thoth` on a real elevated session) -- already disclosed honestly in `central-source.ts`'s own header and tracked outside this review's gating scope (it is an operational verification step, not a code defect). If the two LOW suspicions above are to be tracked, add them as `docs/backlog.md` lines alongside the three S6 already added (id-normalization consideration, multi-line-REG_SZ handling -- the latter is in fact already named there).

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] central-source.ts:157-158,188-193 -- execFileSync called with literal argv array, hardcoded key/value constants, no shell interpolation; asserted exact argv via injected-runner test (AC7(i), passing)
2. [CLEAN][code-traced] central-source.ts:189-193 -- timeout=5000ms and maxBuffer=1MB are real Node-enforced execFileSync bounds, unconditionally applied on every call, not documentation-only
3. [CLEAN][demonstrated] central-source.ts:194-204 + loader.ts:100-104 -- every central-channel failure shape (parse error, schema error, read error incl. timeout/maxBuffer/permission-denied) fails closed, whole load rejected; 84/84 tests pass including the explicit no-collapse-into-absent table test
4. [CLEAN][code-traced] central-source.ts:98-101,181-184 + pin.ts sentinelFor -- discriminated union + distinct pin sentinels prevent "unsupported platform" from ever being read as "confirmed absent"
5. [CLEAN][code-traced] loader.ts:98-104 + pin.ts (no CentralPolicySource dependency at type level) -- single-read invariant structurally closes the POL-09 pin TOCTOU, demonstrated by AC2 test
6. [CLEAN][code-traced] precedence.ts:124-136 -- mergeLayersWithMandatoryLock is the general form (checks rule.mandatory, never sourceLayer); checked against id-case-folding/whitespace, duplicate-key JSON, and prototype-pollution-shaped-key bypass classes -- none apply (Map/Set-keyed core, strict Object.keys allowlist validation)
7. [CLEAN][code-traced] pin.ts:1-4,49-59 -- pin's scope is honestly bounded to the central channel only (POL-09 narrowed per 2026-09-01 ruling); project-layer-only write access cannot make the pin misrepresent the central channel, since the pin never claims anything about the project layer
8. [CLEAN][code-traced] package.json diff -- no new dependency added (one npm script only); repo carries no package-lock.json, zero-runtime-dependency confirmed
9. [CLEAN][code-traced] fixtures/error messages/printer output -- no secrets or sensitive-data leak; rejection messages carry structural validation text only, never raw field values; pin exposes only a SHA-256 digest
10. [CLEAN][demonstrated] node --test (84/84 pass, 0 skipped), npm run typecheck (clean), npm run lint (clean), node src/qa/kernel-purity-check.ts (PASS) -- raw command output captured in report
11. [SUSPICION][LOW][derived] precedence.ts's mandatory-lock id matching has no normalization (case/whitespace) -- does not enable rule suppression/override (mandatory rule stays present under its own id); real exploitability depends on unchanged, out-of-scope kernel.ts rule-evaluation semantics -- hardening note for future content-authoring story
12. [SUSPICION][LOW][derived] central-source.ts:82-89's disclosed single-line-REG_SZ assumption -- traced worst case: a multi-line-rendered value truncates to invalid JSON, which fails closed (json-parse-error rejection), never fail-open or silently-corrupted-accept
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=2 clean=10
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=6 derived=2
checks="84/0/0|typecheck clean|lint clean|kernel-purity PASS"
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-app-security-2026-09-08.md
