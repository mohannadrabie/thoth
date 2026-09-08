# Red Team (Sutekh) — S6 policy centralization, CRITICAL-tier adversarial review

**Date:** 2026-09-08 · **Scope:** S6 built diff (Milestone #24) — `src/policy/config/{central-source,position-parser,loader,pin,printer,print-cli}.ts` + tests, `src/policy/rule/precedence.ts`'s `mergeLayersWithMandatoryLock`, `src/policy/rule/schema.ts`, `src/policy/kernel/rule-types.ts`, `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`
**HEAD:** `b8cb88e` (the S6 diff is entirely uncommitted/untracked — see finding 7)
**Verdict: no-go** — one HIGH, demonstrated, security-category, one-line fix.
**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

ADRs read from `adrCatalog.adrs` for this attack surface: SE ADR-0021 (kernel purity, POL-03 identical-verdicts, "never silent allow"), SE ADR-0019 (self-protection / boundary placement), SE ADR-0006 (blast radius, explicit timeouts, no scope widening), SE ADR-0004 (idempotency), SE ADR-0002/0003 (layering, injectable I/O).

## What I actually ran

```
$ npm test            # whole repo, at HEAD + working tree
pass 603 / fail 1 / cancelled 0 / skipped 0
FAIL: OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass

$ node --test src/policy/config/{central-source,loader,pin,position-parser,printer}.test.ts src/policy/rule/{precedence,schema}.test.ts
pass 81 / fail 0 / cancelled 0 / skipped 0 / todo 0

$ npm run typecheck   # clean, no output
$ npm run lint        # clean, no output  <-- contradicts the build's own CHANGELOG claim, see finding 7
$ npm run policy:print
ERROR: The system was unable to find the specified registry key or value.
central-channel status=absent
--- resolved rules (0) ---
EXIT=0
```

Plus five purpose-built attack harnesses (mandatory-lock bypass matrix, central-channel failure-shape
matrix, printer/loader integration probes, a 468-document position-parser differential fuzz, and a real
reg.exe binary-resolution hijack) — raw output inline below.

---

# Findings, ranked by blast radius (exposure x irreversibility x silence)

## 1. [ISSUE][HIGH][demonstrated] `reg.exe` is resolved through PATH, and `npm run` puts `node_modules/.bin` at the front of it — any dependency owns the central policy channel, silently

**Attack.** `central-source.ts:188` invokes the channel reader as an unqualified binary name:

```ts
stdout = runner("reg.exe", ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME], {...});
```

`execFileSync` resolves a bare name through PATH. `npm run <script>` — the shipped entry point,
`package.json`'s `"policy:print": "node src/policy/config/print-cli.ts"` — prepends the project's
`node_modules/.bin` to PATH, measured on this machine:

```
$ npm run env | grep -iE "^(PATH|Path)=" | tr ';' '\n' | head -4
PATH=/c/playground/thoth/node_modules/.bin:/c/playground/node_modules/.bin:/c/node_modules/.bin:...
      ...:/c/WINDOWS/system32:...          # System32 is 15 entries later
```

Any package with a `bin` entry named `reg`, any `postinstall` script, and every other user-writable PATH
entry ahead of System32 (`/c/Users/mohan/bin`, `/usr/local/bin`, `/usr/bin`, `/mingw64/bin` are all ahead of
it in the same measurement) can substitute the binary that speaks for the central policy channel.

Proven, not argued — a planted binary (a copy of `whoami.exe` renamed `reg.exe`) executed instead of the
real `reg.exe` with the hijack directory prepended exactly the way npm prepends `node_modules/.bin`:

```
$ HIJACK_DIR=...\scratchpad\hijack node probe3.mjs
RAN -> threw status= 1 stdout= "" stderr= " "
# contrast, the same call with an unmodified PATH:
RAN -> threw status= 1 stderr= "ERROR: The system was unable to find the specified registry key or value.\r\n"
```

**Why this is the worst one.** The hijack is silent in the fail-open direction. A planted binary that exits
1 with the English not-found text on stderr is classified `absent` (`central-source.ts:114/197`), the
central layer contributes zero rules, and `loadEffectivePolicy` returns `ok: true`. No error, no warning, no
different exit code. Alternatively the planted binary returns attacker-authored rules on stdout and they are
merged as *central* — the highest-trust tier, and the planted content can set `mandatory: true` on itself.
This is exactly the property REQUIREMENTS.md section 0.4 property 2 and POL-09 exist to hold ("a change
under review cannot alter the policy that judges it"): a change under review can add a dependency, and a
dependency owns the channel.

**Current defense, honestly assessed.** Real and non-trivial for the *argument* half — argv array, no
`shell: true`, both key path and value name are module constants, `escapeRegExpLiteral` on the value name,
bounded `timeout: 5000`, `maxBuffer: 1 MiB`, `windowsHide: true`. There is no defense on the *binary
identity* half; the file's own header reasons about injection and timeouts and never asks which `reg.exe`
runs. `mcp-enumeration.ts` had no subprocess precedent to inherit, exactly as plan v2 section 1 warned.

**Exposure:** ~100% of `loadEffectivePolicy()` invocations reaching the win32 branch (one call site,
`central-source.ts:188`; basis: counted-in-code) on any host where a PATH entry ahead of System32 is
writable by a non-admin (basis: measured — 4 such entries ahead of System32 here, plus `node_modules/.bin`
injected by `npm run`). Irreversible: no. Silent: yes, completely.

**Verdict: BREAKS.**

**Proof-test required before merge:** `central-source.test.ts` -> "AC7(i)/security: the reg query runner is
invoked with an ABSOLUTE, system-rooted executable path (%SystemRoot%\System32\reg.exe), never a bare
reg.exe resolvable through PATH" — assert the first argument the injected runner receives is absolute under
`process.env.SystemRoot`. The fix is one line at `central-source.ts:188`.

---

## 2. [ISSUE][MED][demonstrated] The only path to `absent` is an English-language string match — every non-English Windows host rejects the entire policy load in the default, no-policy-deployed state

**Attack.** `central-source.ts:114` is the sole discriminator between "nothing deployed" and "the channel is
broken":

```ts
const NOT_FOUND_PATTERN = /unable to find the specified registry key or value/i;
```

`reg.exe` localizes its error text to the Windows UI language. On a German/French/Japanese host the text
never matches, the error is re-thrown, `loader.ts:103` returns `reasonKind: "read-error"`, and the whole
load is rejected — in the single most common configuration there is (no central policy provisioned).

```
C1 en-US not-found   -> {"status":"absent"}
C2 de-DE not-found   -> THROWS: Command failed      # "FEHLER: Der angegebene Registrierungsschluessel..."
C3 fr-FR not-found   -> THROWS: Command failed
C4 access-denied     -> THROWS: Command failed      # correct
C5 timeout/empty     -> THROWS: Command failed      # correct
```

**Current defense.** The direction of failure is right — this fails closed, never open, and the header is
explicit that only the captured text resolves to `absent`. What is missing is any awareness that the
captured text is one locale's rendering. Nothing in `central-source.test.ts` exercises a non-English sample;
AC7(ii)'s fixture work captured real bytes from exactly one machine's locale.

**Exposure:** 100% of policy loads on a non-English-UI Windows host in the default state (basis:
counted-in-code — one regex, one call site). Share of such hosts in the target population: unknown (basis:
assumption — do not price this finding on it). Irreversible: no. Silent: no, it screams.

**Verdict: BREAKS** (availability, not bypass).

**Proof-test required:** `central-source.test.ts` -> "absent-classification is locale-independent: a
not-found failure resolves to status=absent for the de-DE, fr-FR and ja-JP renderings of reg.exe's
key-not-found error, while access-denied and timeout still resolve to a thrown read error". The English text
may stay as a corroborating hint; the primary discriminator must not be prose.

---

## 3. [ISSUE][MED][demonstrated] A project-file edit voids the entire load, including the central mandatory rules it collides with — and the printer blames "central policy"

**Attack.** `mergeLayersWithMandatoryLock` (`precedence.ts:129`) fails the whole call on the first collision;
`loader.ts:149` turns that into a whole-`LoadResult` failure. Nothing is merged. So the least-trusted layer
— `.thoth/policy.json`, an in-repo file every change under review can edit — makes the most-trusted layer's
mandatory rules not resolve at all, with a three-line edit:

```
=== B1: project layer violates a shipped-defaults MANDATORY lock ===
{
 "stdout": "central-channel status=absent\nREJECTED: central policy load failed (mandatory-lock-violation): layer \"project\" rejected in its entirety: rule id \"shipped-deny-secrets\" redefines a mandatory rule from an earlier layer",
 "exitCode": 1
}
```

Two defects in one output:

- **(a) Granularity.** Plan v2 AC9 ratified whole-project-LAYER rejection ("a project layer containing one
  mandatory-id-violating rule and one otherwise-valid non-conflicting override is rejected in its
  entirety"). `CHANGELOG.md`'s new S6 entry repeats it: "Rejection is whole-LAYER granularity". The shipped
  behavior is whole-LOAD — `loader.test.ts:185`'s own title says so ("rejects the WHOLE load ... not just
  that rule"). Dropping the offending layer while still enforcing shipped-defaults + central is the ratified
  reading and the safe one; discarding everything is the one that lets the low-trust layer win by breaking.
- **(b) The message is factually wrong.** Central was `absent`. The failure is in `.thoth/policy.json`. The
  operator is told "central policy load failed" and sent to hunt a registry key that does not exist.
  `printer.ts:40` hardcodes that prefix for all four reason kinds. AC9 named the required signal verbatim
  ("project layer rejected: mandatory id collision"); it does not exist. `printer.test.ts`'s grammar covers
  only three reason kinds — the fourth, `mandatory-lock-violation`, has no printer test at all.

**Current defense.** Deliberate and disclosed at the unit level, and today's exposure is bounded because no
gate consumes the loader (finding 5). What was never assessed is the trust-direction consequence.

**Exposure:** 100% of loads where any layer collides with an earlier mandatory id (basis: counted-in-code);
0% of enforcement decisions today, because nothing enforces this policy yet (basis: counted-in-code — one
production consumer, `printer.ts`). Irreversible: no. Silent: no for (a), yes for (b).

**Verdict: BREAKS.**

**Proof-tests required:** `precedence.test.ts` -> "AC9: a mandatory-lock violation in a LATER layer voids
that layer only — every earlier layer's rules, including the mandatory rule that was violated, still
resolve"; `printer.test.ts` -> "a mandatory-lock violation names the OFFENDING LAYER and its file/channel
origin, and never attributes it to the central channel when central is absent".

---

## 4. [ISSUE][MED][demonstrated] The origin line — POL-10's entire deliverable — is silently wrong whenever a layer has duplicate ids or a duplicate "rules" key, and the schema accepts both

**Attack.** `printer.ts:51` maps a merged rule back to a source line with `findIndex(r => r.id === rule.id)`
— the FIRST rule with that id, while `mergeLayersById` keeps the LAST. And `loader.ts:89` aligns
`ruleLines` to `positions[i]` positionally with a silent `?? -1`, never checking that the token scan found
the same number of rule objects `JSON.parse` produced.

```
=== B2: intra-layer DUPLICATE rule id ===
schema errors: []
... rule id=dup-rule effect=deny layer=project origin=.../project-dupid.json line=4 mandatory=false
    # the winning "deny" copy opens on line 9; line 4 is the LOSING "allow" copy

=== B3: DUPLICATE top-level "rules" key ===
schema errors: []
... rule id=real-rule effect=deny layer=project origin=.../project-duprules.json line=4 mandatory=false
    # JSON.parse keeps the SECOND "rules" array (line 7); findRulePositions collected BOTH arrays'
    # objects, so index 0 points at the discarded decoy on line 4
```

Same family: `validateRuleSet` reports ZERO errors for a duplicate rule id inside one layer, and zero for a
duplicated top-level key — against POL-06's own acceptance text ("unknown key is an error, not a silent
no-op"). The merged output also carries the LAST copy's `mandatory` value, so a layer can print
`mandatory=false` for an id that is in fact locked (demonstrated: `A5 intra-layer dup -> {"id":"dup",
"effect":"allow","mandatory":false}` while `dup` is in the lock set).

**Current defense.** None for either shape. The position parser itself is sound (CLEAN C4) — the defect is
entirely in the index-alignment contract between parser, loader and printer.

**Exposure:** every rule in a layer containing a duplicate id or duplicate key (basis: counted-in-code);
frequency of such files in practice: unknown (basis: assumption). Irreversible: no. Silent: yes — the answer
looks authoritative and is wrong, in the one command whose job is answering "why is this blocked".

**Verdict: BREAKS.** Partially filed already as Issue #105 (duplicate-id half) — the duplicate-"rules"-key
variant, the missing schema rejection, and the `mandatory` display inconsistency are appended there as a
comment rather than filed as a second Issue.

**Proof-tests required:** `schema.test.ts` -> "validateRuleSet rejects a duplicate rule id within one layer,
naming the id and both indices"; `loader.test.ts` -> "a layer whose tokenized rule-object count disagrees
with its parsed rules count is rejected, never silently line-numbered -1 or misaligned".

---

## 5. [ISSUE][MED][code-traced] `policy:print` answers "why is this blocked" from a policy no gate has ever enforced, and says nothing about it

**Attack.** Two policy-resolution paths now exist in the same tree:

```
$ grep -rn "loadEffectivePolicy\|loadBootstrapRuleSet" --include=*.ts --include=*.mjs src hooks | grep -v test
hooks/pretooluse-kernel-gate.mjs:118:    rules: loadBootstrapRuleSet(),          # what the GATE decides with
hooks/pretooluse-kernel-gate.mjs:119:    defaultOutcome: BOOTSTRAP_DEFAULT_OUTCOME,
src/policy/config/printer.ts:61:    const result = loadEffectivePolicy(input);  # what the PRINTER prints
```

`loadBootstrapRuleSet()` returns an empty ruleset with `BOOTSTRAP_DEFAULT_OUTCOME = "allow"`. So
`npm run policy:print` renders `--- resolved rules (N) ---` for rules no enforcement point consults, with no
marker saying so. SE ADR-0021's Rules for agents: "The startup gate, the in-session hook gate, and the
pipeline gate MUST all invoke the same single kernel build artifact and MUST return identical verdicts on
identical input (POL-03, section 0.4 property 3)." The divergence itself is a ratified, disclosed
consequence of Q2 ("hook not rewired in S6") — the undisclosed part is that the printer's own output does
not say it.

**Current defense.** The decision is logged in `docs/decisions.md`; the printer output carries nothing.

**Exposure:** 100% of `policy:print` runs (basis: counted-in-code — the only production consumer).
Irreversible: no. Silent: yes.

**Verdict: BREAKS** (operator-truth defect, not a mechanism defect).

**Proof-test required:** `printer.test.ts` -> "the printed header states the enforcement status of the
policy it just resolved (NOT-ENFORCED while no gate consumes loadEffectivePolicy), so an operator never
reads a resolved rule as an enforced one".

---

## 6. [ISSUE][MED][code-traced] POL-09's pin is computed and thrown away, and it covers only one of the three layers

**Attack.** `loader.ts:165` computes the pin and returns it. Nothing consumes it: not `printer.ts`
(`renderSuccess` prints the channel status and the rules, never the digest), not `print-cli.ts`, not any
artifact. POL-09's acceptance is "the resolved reference shall be recorded in every artifact", and
REQUIREMENTS.md carries an explicit warning on that row: "Do not close this requirement on the delivery half
alone." An operator cannot see the pin from any shipped command.

Second half: `computePin` (`pin.ts:49`) hashes ONLY `centralRaw`. `shipped-defaults.json` and
`.thoth/policy.json` are outside the digest entirely. Two materially different effective policies produce a
byte-identical pin whenever they differ only in the project layer — precisely the layer a change under
review can edit. The property POL-09 exists to make provable ("a change under review cannot alter the policy
that judges it") is therefore not provable from the pin S6 ships.

**Current defense.** The single-read invariant binding pin-to-merged-bytes is genuinely well built (CLEAN
C3). The SCOPE of what is pinned was never stated as a limit — plan v2 AC2 says "the pin MUST be computed
over exactly the bytes that were actually merged", and only central's bytes are.

**Exposure:** 100% of pins (basis: counted-in-code). Irreversible: no. Silent: yes — a pin that looks like an
integrity guarantee and covers one third of the input.

**Verdict: BREAKS** (scope overclaim, not a mechanism defect).

**Proof-tests required:** `pin.test.ts` -> "two loads whose project layers differ produce DIFFERENT pin
digests"; `printer.test.ts` -> "the printed output carries the POL-09 pin digest and channel descriptor". If
pinning the file layers is deliberately out of scope, that limit belongs in `pin.ts`'s header and in
REQUIREMENTS.md POL-09's row as a named residual — not left implied.

---

## 7. [ISSUE][MED][demonstrated] test-writer's locked answer key was modified after the build, and S6 never committed it at RED — so "UNMODIFIED" is unverifiable by construction

**Attack.** CLAUDE.md's DoD: "for any story that had a `test-writer` pass: its tests pass GREEN, UNMODIFIED
from what `test-writer` authored." `docs/decisions.md`'s 2026-09-08 build row and the new `CHANGELOG.md`
entry both assert compliance and record a specific consequence:

> "`npm run lint` fails on ONE pre-existing, unnecessary-type-assertion error inside test-writer's own
> `src/policy/config/printer.test.ts` (line 399, @typescript-eslint/no-unnecessary-type-assertion) — not
> edited here per this project's 'never silently edit a test-writer test file' rule; flagged back."

Both halves of that claim are now false against the tree:

```
$ npx eslint src/policy/config/printer.test.ts ; echo "eslint exit=$?"
eslint exit=0                       # the recorded failure does not reproduce

$ ls -l --time-style=full-iso src/policy/config/*.ts
... 2026-09-08 12:45:21  printer.ts
... 2026-09-08 12:46:22  loader.ts
... 2026-09-08 12:48:02  central-source.ts
... 2026-09-08 12:48:20  print-cli.ts
... 2026-09-08 12:58:39  printer.test.ts        <-- the answer key is the NEWEST file in the story
... 2026-09-08 12:17:49  docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json
```

The answer key was written 10 minutes after the last implementation file and 41 minutes after its own
fixtures. `printer.test.ts:399` is now `const match = /^node\s+(\S+)$/.exec(script);` — no type assertion for
the recorded rule to fire on.

The deeper defect is structural, and it is why this cannot be settled by reading the file: S6 committed
NOTHING. `git status` shows every S6 file untracked. S5 did this correctly — commit `ae579be` ("S5
test-writer: RED-CONFIRMED, hook contract tests for Phase 2 build") captured the answer key BEFORE the
build. With no RED-time commit, no reviewer, auditor or future session can ever prove what `test-writer`
actually wrote. The test-writer report's own grep counts still reconcile (AC3->4, AC5a->2, AC5b->3,
AC5c->2, AC10->1, 9 `test(` calls), so the CONTRACT appears intact — but a count is not a diff.

**Exposure:** 1 of 1 test-writer artifacts this story (basis: counted-in-code). Irreversible: yes — the
RED-time bytes are unrecoverable. Silent: yes, until an audit looks.

**Verdict: BREAKS.**

**Unlock:** commit the S6 tree now with the answer key in its own commit, and have `test-writer` (not
`story-implementer`) confirm the current `printer.test.ts` is what it authored, or re-author it. Standing
fix: `test-writer`'s output is committed at RED-CONFIRMED, before Phase 2 starts, every story.

---

## 8. [ISSUE][MED][code-traced] The baseline posture — `defaultOutcome` — is not expressible in any of the three tiers, so a central admin cannot mandate deny-by-default

**Attack.** `RuleSet` (`rule-types.ts:35`) is `{version, rules}`. `WorldFacts.defaultOutcome`
(`kernel.ts:156`) is supplied by the caller, and the only production supplier is `bootstrap-ruleset.ts:43`'s
`BOOTSTRAP_DEFAULT_OUTCOME = "allow"` — a code literal. `loadEffectivePolicy` returns no default outcome at
all. So the one knob deciding what happens to every action no rule matches is the one thing the new central
policy channel cannot set. POL-01: "No rule an operator is expected to tune shall live in a code literal" —
and `kernel.ts:154-156`'s own comment already concedes this applies to the baseline posture.

**Current defense.** None. Policy CONTENT authoring is ratified out of S6's scope, but this is the
mechanism's shape, not its content: no future content-authoring story can set the posture without changing
the schema, the loader's return type, and the merge's resolution rules — i.e. re-opening exactly this diff.

**Exposure:** 100% of future enforcement decisions where no rule matches (basis: counted-in-code — one
literal, one call site). Irreversible: no, but it re-opens S6's own schema. Silent: yes.

**Verdict: BREAKS** (design gap, cheapest to close now).

**Proof-test required:** `schema.test.ts` + `loader.test.ts` -> "a RuleSet may declare defaultOutcome, a
later layer may override it, and a central layer may mark it mandatory so no project layer can relax it" —
or an explicit, ratified decision row stating the posture stays out of the policy format, with the reason.

---

## 9. [ISSUE][MED][demonstrated] The repo's own test suite is RED at HEAD — DoD cannot be satisfied for this merge

```
$ npm test
pass 603 / fail 1 / cancelled 0 / skipped 0
FAIL: OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass (14482ms)
  b8cb88eb5c7e hooks/sessionstart-tool-enum.mjs [internal-hostname] ... setti...[REDACTED 14 chars]
  b8cb88eb5c7e docs/reviews/s5-red-team-2026-09-07.md [internal-hostname] ... setti...[REDACTED 14 chars]
```

Every match is at commit `b8cb88e` (HEAD) in pre-S6 files — NOT caused by this diff, and disclosed as such
by story-implementer in `CHANGELOG.md`/`docs/decisions.md`. The redacted matches all appear to be the
`*.local` hostname pattern firing on `settings.local.json`-shaped strings, i.e. a scanner false positive
that has made a CI-gating, sensitive-area check (CLAUDE.md's "Secret scanning / CI gates") permanently red.
CLAUDE.md's DoD requires "tests green in CI with real counts". No tracking Issue exists.

**Exposure:** 100% of CI runs (basis: measured). Irreversible: no. Silent: no — but a permanently-red gate
trains readers to ignore it, which is the real risk.

**Verdict: BREAKS** (pre-existing; blocks this merge's DoD, not caused by it).

**Proof-test required:** `patterns.test.ts` -> "the internal-hostname pattern does not match a
settings.local.json-shaped filename", plus either the fix or an allowlist entry with a dated rationale.

---

## 10. [ISSUE][LOW][demonstrated] reg.exe's stderr is forwarded to the parent process on every absent read

execFileSync's default `stdio` forwards the child's stderr to the parent while also capturing it:

```
$ node src/policy/config/print-cli.ts 2>/dev/null
central-channel status=absent
--- resolved rules (0) ---

$ node src/policy/config/print-cli.ts 2>&1 1>/dev/null
ERROR: The system was unable to find the specified registry key or value.
```

Cosmetic today. It stops being cosmetic the moment `loadEffectivePolicy` is called from a Claude Code hook,
where stderr is part of the protocol (S5's own exit-2-plus-stderr blocking contract). Fix: pass
`stdio: ["ignore", "pipe", "pipe"]`. **Verdict: BREAKS**, LOW — no Issue filed per this project's
LOW-severity convention.

**Proof-test:** `central-source.test.ts` -> "the runner is invoked with stderr piped, never inherited".

---

## 11. [ISSUE][LOW][demonstrated] The mandatory lock protects an id, not an effect — a mandatory ALLOW is defeated by any project rule with a different id

```
A3 shadow-by-different-id merged -> ok:true (no lock violation; ids differ)
A3 kernel verdict on the mandatory-ALLOW's own action ->
   {"outcome":"deny","reason":"denied by rule project-shadow","ruleId":"project-shadow"}
```

Central marks `central-allow-break-glass` (effect allow, mandatory true); a project rule `project-shadow`
with the same verbs/targets and effect deny wins, because `kernel.ts:173` resolves deny-over-allow among
matched rules. The lock never fires — the ids differ. The printer still shows `mandatory=true` on the
neutralized rule.

The mirror case is safe and I confirmed it: a mandatory DENY cannot be flipped by a shadowing allow
(A4 -> outcome deny, ruleId central-deny-prod), including via case-variant (Deny-Prod vs deny-prod) or
whitespace-padded ids, both of which the schema accepts (A1/A2). So the guarantee is ASYMMETRIC:
mandatory-deny is real, mandatory-allow is advisory. POL-07's acceptance text ("downstream configuration
cannot relax it") is satisfied; the asymmetry is simply undocumented, and a central admin writing a
break-glass exception will not discover it until it silently fails to apply.

**Verdict: BREAKS**, LOW — no Issue filed. **Proof-test:** `precedence.test.ts` -> "a mandatory ALLOW rule's
effective verdict survives a shadowing project DENY, or the asymmetry is documented on Rule.mandatory".

---

## 12. [SUSPICION][MED][code-traced] The full real-registry round trip has still never been run

Plan v2 section 3a point 3 named a human-owned, one-time end-to-end run (provision a real
HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson, read it back, merge, print). It has not happened.
`central-source.ts`'s header discloses this honestly and narrows it — the read+parse half is now tested
against real captured bytes, which I independently confirmed is a genuine improvement:

```
$ node probe2.mjs      # real module constants, unmodified PATH
KEY: "HKLM\SOFTWARE\Policies\Thoth" VALUE: "CentralPolicyJson"
reg threw: status= 1 stderr= "ERROR: The system was unable to find the specified registry key or value."
```

What remains untested is everything downstream of a value that actually exists: multi-line or oversized
REG_SZ rendering (the header names this as an unmeasured assumption), the active-code-page effect on
non-ASCII data (also named), and the extraction regex against real data containing the field-separator
spacing. **Verdict: UNPROVEN** — a task with a named owner, not a blocker.

**Settles it:** one human, one elevated Windows shell — `reg add` the key with a minified JSON value
containing a non-ASCII rationale, then `npm run policy:print`, raw output pasted into the Stage 3 evidence.
No agent in this project can run the write half (independently re-confirmed this pass: the tool-permission
classifier refuses it, and this session's own process token is UAC-filtered).

---

## 13. [SUSPICION][LOW][code-traced] A timeout or maxBuffer overflow whose captured stderr happens to contain the not-found text is classified `absent`

`central-source.ts:194-203` inspects only `err.stderr`, never `err.status`, `err.signal` or `err.code`. A
child killed on the 5 s timeout, or one exceeding `maxBuffer`, still carries whatever stderr was captured
before the kill. If that buffer contains the not-found text — trivially arranged by a hijacked binary
(finding 1), and conceivable for a stalled real one — the result is `absent`, the fail-open direction.
**Verdict: UNPROVEN** — I could not construct a real reg.exe timeout to demonstrate it.

**Settles it:** `central-source.test.ts` -> "a runner failure carrying ETIMEDOUT/ENOBUFS is a read error even
when its stderr contains the not-found text" — a 3-line table test with a synthetic error object.

---

# What held up (SURVIVES — attacked and defended)

- **C1 [code-traced] Argument injection into `reg query`.** No `shell: true`; argv array; key path and value
  name are module constants (`central-source.ts:107-109`); `escapeRegExpLiteral` applied before the value
  name reaches a RegExp. `central-source.test.ts:78` asserts the exact outbound call shape. Nothing
  operator- or content-controlled reaches the command line. SURVIVES.
- **C2 [demonstrated] The discriminated union never misclassifies a real failure as `absent`.** Six failure
  shapes exercised (localized not-found, access-denied, empty stderr/timeout, exit-0-with-missing-value-line,
  wrong value type REG_EXPAND_SZ, decoy value line): every one either throws or resolves to a non-absent
  state. Every misclassification I could find errs toward REJECTION, never toward "nothing to enforce" —
  apart from finding 13's unproven edge and finding 1's hijack. This is the property architecture-reviewer's
  finding 2 asked for, and it holds. SURVIVES.
- **C3 [demonstrated] POL-09 single-read / no TOCTOU.** `pin.ts` has no CentralPolicySource dependency at the
  type level; `loader.ts:101` is the sole `.read()` call site. `loader.test.ts:219` uses a test double that
  returns DIFFERENT bytes on a second call, asserts callCount === 1, asserts the merge reflects the first
  read, and independently re-hashes the first read's bytes to confirm the pin came from them. A real test of
  a real invariant, not a restatement. SURVIVES.
- **C4 [demonstrated] Position parser vs. CRLF, escapes, surrogate pairs.** 468-document differential fuzz
  (1-6 rules x 3 indent styles x LF/CRLF x 13 adversarial rationale payloads — escaped quotes, escaped
  backslashes, braces and brackets inside strings, \u escapes, astral emoji, an embedded `"rules": [ {} ]`
  decoy, tabs, empty strings), each reported line cross-checked against an independently computed ground
  truth: `fuzz: 468 documents, 0 mismatches`. The decision to scan raw source and never unescape is correct
  and correctly implemented. SURVIVES.
- **C5 [code-traced] The `sourceLayer === "central"` bug shape (Issues #65/#66/#99).** `precedence.ts:129-135`
  references no layer name at all — it keys off the stored rule's own `mandatory` field. The
  shipped-defaults-to-central direction has its own named regression test (`precedence.test.ts:203`), per the
  human's option-(a) ruling. Structurally immune, as claimed. SURVIVES.
- **C6 [demonstrated] Mandatory DENY vs. every id-normalization trick.** Case-variant ids, trailing-whitespace
  ids, byte-identical redefinition, intra-layer duplicates: none defeats a mandatory deny — the lock rejects
  the exact-id cases and deny-wins covers the rest. SURVIVES.
- **C7 [demonstrated] CWD-based reg.exe hijack.** libuv does not search the working directory: a
  `zzzprobe.exe` present in the CWD gives ENOENT, and a `reg.exe` planted in the CWD did NOT run (the real
  one did). Only the PATH vector of finding 1 is live. SURVIVES.
- **C8 [demonstrated] `process.exit()` truncating the printer's stdout.** `print-cli.ts:22-23` is the classic
  write-then-exit footgun and Windows pipes are async, so I tried to break it: 20,000-line output through a
  pipe, through `cat`, and to a file — 20000/20000/20000 lines, no truncation. SURVIVES.
- **C9 [demonstrated] Kernel purity, types, lint.** `npm run typecheck` and `npm run lint` both clean;
  `rule-types.ts`'s new `mandatory` field is pure data and the purity scanner is unaffected. SURVIVES.

---

# The single scariest unproven assumption

**That the binary answering for the central policy channel is the one Microsoft shipped.** Everything else
in this diff — the discriminated union, the fail-closed buckets, the single-read pin, the mandatory lock —
is careful, and several parts are better than the plan required. All of it sits on top of one bare string,
`"reg.exe"`, resolved through a PATH whose first entry `npm run` hands to the project's own `node_modules`.
A supply-chain attacker does not need to defeat the mandatory lock; they get to WRITE the central layer the
lock protects. That is the exact inversion of REQUIREMENTS.md section 0.4 property 2 that this story exists
to establish, and it is a one-line fix.

# Verdict

**no-go.** One HIGH, demonstrated, security-category, in a named sensitive area ("Policy delivery / config
surface"). Eight MED findings, all with named failing tests. This is not a rewrite: findings 1, 2, 10 and 13
are contained inside `central-source.ts`; 3 and 5 are message/granularity changes; 4, 6 and 8 are the ones
with real design content. The mechanism's core — merge, lock, pin, parse — held up under direct attack, and
I want that on the record alongside the no-go.

# Single next action

Change `central-source.ts:188`'s bare `"reg.exe"` to an absolute `%SystemRoot%\System32\reg.exe`, land the
named assertion from finding 1, and commit the S6 tree (finding 7) so the next reviewer has a diff to read
instead of a working directory.

---

# Editorial (verdict-neutral, fix as plain edits, no re-review)

- `CHANGELOG.md`'s new S6 entry: "Rejection is whole-LAYER granularity" describes behavior the shipped code
  does not have (finding 3a) — it is whole-load.
- `CHANGELOG.md` and `docs/decisions.md`'s build row both state `npm run lint` fails on
  `printer.test.ts:399`; it passes (finding 7).
- `printer.ts:40`'s rejection prefix is hardcoded to "central policy load failed" and is used for all four
  reason kinds, including two that have nothing to do with the central channel.
- `precedence.ts:157-163`'s POST-S6 DISPOSITION comment says `mergeLayers` has "ZERO production callers" —
  true, and worth pairing with a `@deprecated` tag so a reader gets the warning from tooling, not prose.
- `printer.test.ts`'s header (INTERPRETATION CHOICE 4) says the runnable entry point is "NOT executed by this
  file at all". It works — I ran it — but nothing in CI would notice if it stopped working.

---

```
RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] `reg.exe` invoked as a bare name (central-source.ts:188) resolves through PATH, and `npm run` prepends node_modules/.bin to it — a planted binary owns the central policy channel and silently classifies as "absent"; defense covers argv/timeout/buffer but never binary identity. Demonstrated hijack + measured npm PATH ordering.
2. [ISSUE][MED][demonstrated] `absent` is decided by one English regex on reg.exe stderr (central-source.ts:114) — de-DE/fr-FR renderings become read-error and reject the WHOLE load in the default no-policy-deployed state; fails closed, so availability not bypass; no non-English sample in any test.
3. [ISSUE][MED][demonstrated] A project-layer mandatory-id collision voids the ENTIRE load (loader.ts:149), so the least-trusted layer can suppress the most-trusted layer's mandatory rules; ratified AC9 + CHANGELOG say whole-LAYER; printer then reports "central policy load failed" while central was absent, and that 4th reason kind has no printer test.
4. [ISSUE][MED][demonstrated] Origin line is silently wrong on duplicate rule ids (printer.ts:51 findIndex picks the loser) and on a duplicate top-level "rules" key (loader.ts:89 positional misalignment); validateRuleSet accepts both with zero errors. Duplicate-id half already filed as Issue #105 — commented, not duplicated.
5. [ISSUE][MED][code-traced] `policy:print` renders loadEffectivePolicy's rules while the only gate (pretooluse-kernel-gate.mjs:118) decides from loadBootstrapRuleSet's empty ruleset + allow — two policy paths, no marker in the output; SE ADR-0021's identical-verdicts rule is the relevant standard.
6. [ISSUE][MED][code-traced] POL-09's pin is computed (loader.ts:165) and consumed by nothing — never printed, never stamped — and hashes only centralRaw, so two effective policies differing in the in-repo project layer share one digest.
7. [ISSUE][MED][demonstrated] test-writer's answer key printer.test.ts has the newest mtime in the story (12:58 vs impl 12:45-12:48), its recorded lint failure no longer reproduces (eslint exit=0), and S6 committed nothing — unlike S5's ae579be, so "UNMODIFIED from what test-writer authored" is unverifiable by construction.
8. [ISSUE][MED][code-traced] `defaultOutcome` (the deny-by-default knob) is expressible in no tier — it stays BOOTSTRAP_DEFAULT_OUTCOME="allow", a code literal, against POL-01; closing it later re-opens this diff's schema and loader types.
9. [ISSUE][MED][demonstrated] `npm test` is RED at HEAD (603 pass / 1 fail): oss:secret-scan dogfood fails on pre-existing internal-hostname false positives; not caused by S6, but DoD requires green and no tracking Issue exists.
10. [ISSUE][LOW][demonstrated] execFileSync's default stdio forwards reg.exe's stderr to the parent on every absent read — noise today, a hook-protocol hazard once wired; fix is stdio:["ignore","pipe","pipe"].
11. [ISSUE][LOW][demonstrated] The lock protects an id, not an effect: a mandatory ALLOW is neutralized by any project DENY with a different id (deny-wins in kernel.ts:173) while the printer still shows mandatory=true; mandatory DENY survives every id trick I tried.
12. [SUSPICION][MED][code-traced] The full real-registry round trip (provision -> read -> merge -> print) has still never been run; read+parse is real-byte-tested, multi-line REG_SZ and code-page behavior remain unmeasured and disclosed.
13. [SUSPICION][LOW][code-traced] Only err.stderr is inspected on failure (central-source.ts:194-203) — a timeout/ENOBUFS whose captured stderr contains the not-found text would classify as absent; could not construct a real timeout to prove it.
14. [CLEAN][code-traced] Argument injection into reg query — argv array, no shell, constants only, value name regex-escaped; outbound call shape asserted.
15. [CLEAN][demonstrated] The absent/unsupported/present union never misclassifies a real failure as absent across 6 failure shapes — every error lands in the rejecting bucket.
16. [CLEAN][demonstrated] POL-09 single-read invariant genuinely holds — one .read() call site, mutating test double asserts callCount===1, pin re-hashed from the same bytes.
17. [CLEAN][demonstrated] Position parser vs CRLF/escaped quotes/backslashes/\u escapes/astral emoji/embedded decoys: 468-document differential fuzz, 0 mismatches.
18. [CLEAN][code-traced] The mandatory check inspects the rule's own `mandatory` field, never a layer name — the Issues #65/#66/#99 shape is structurally impossible; shipped-defaults->central direction tested.
19. [CLEAN][demonstrated] Mandatory DENY survives case-variant ids, whitespace-padded ids, byte-identical redefinition and intra-layer duplicates.
20. [CLEAN][demonstrated] CWD-based reg.exe hijack does not work — libuv does not search the working directory (ENOENT proven).
21. [CLEAN][demonstrated] print-cli's write-then-process.exit does not truncate: 20,000 lines through a pipe, through cat, and to a file, all intact.
22. [CLEAN][demonstrated] typecheck clean, lint clean, kernel purity unaffected by the new `mandatory` field.
counts (CHECKSUM): issues=11 suspicions=2 clean=9
evidence (CHECKSUM): demonstrated=15 code-traced=7 derived=0
checks=603 pass / 1 fail / 0 skipped (full suite, the 1 fail pre-existing at HEAD); 81 pass / 0 fail / 0 skipped (S6 modules); typecheck clean; lint clean; 468-document parser fuzz 0 mismatches; 5 custom attack harnesses
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-2026-09-08.md
```
