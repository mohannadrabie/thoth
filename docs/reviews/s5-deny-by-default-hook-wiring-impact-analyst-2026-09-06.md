# S5 Phase 1 Plan — Impact Analyst (council seat)

**Scope:** `docs/plans/S5-phase1-2026-09-06.md` (v2). Milestone #23, CRITICAL tier. Council convened per PRINCIPLES rule 16(b) (2 consecutive design-challenger no-go rounds, no intervening clean verdict) and independently per rule 16's repeat-root-cause counter (same root-cause class recurring across both rounds).
**Seat:** impact-analyst (Wepwawet).
**Date:** 2026-09-06.
**Candidates priced (per the Manager's council-seat task, matching the design-challenger Stop Brief's own §4 set):** A (fix T11 properly), B (sidestep — Claude Code's documented 600s default + margin), C (my own derivation — pin exec-form invocation, named explicitly in the Stop Brief's own §4 as Path C), and Issue #89's own fix path (MCP-enumeration secret scoping). I did not invent a materially different fourth path for the timeout question — A/B/C already exhaust the design space the Stop Brief and both design-challenger rounds surfaced.

## What was read

`docs/STATE.md`, `docs/PRINCIPLES.md`, `docs/plans/S5-phase1-2026-09-06.md` (v2, full), both design-challenger rounds (`...-design-challenger-2026-09-06.md`, `...-round2-2026-09-06.md`) and its Stop Brief (`...-stopbrief-2026-09-06.md`), `architecture-reviewer`'s round 1 + round 2 reports (same file), GitHub Issues #86/#88/#89 (body + comments, via `gh issue view`), `.claude/settings.json` (full, current), `.github/workflows/ci.yml`, `package.json`, `docs/decisions.md` (rows 35–38, the S5-specific ratifications), `docs/backlog.md`, `REQUIREMENTS.md` (SUR-02/03/05/10/11/12, OPS-03, T11, G4/G5/G6). Fetched Claude Code's own current CLI/MCP docs directly (`code.claude.com/docs/en/mcp`, `.../cli-reference`) to check whether a narrower enumeration surface than raw-file reads exists for Issue #89 — this is `derived` evidence (a summarized fetch, not a command run on this machine) and is labeled as such throughout. No S5 code exists yet (`hooks/` confirmed absent) — this is a pre-build plan review; every enumeration below is either a command run against this repo's real files/CI config, or an explicit `derived`/`unmeasured` label.

---

## Candidate A — Fix T11 properly (measure the real end-to-end shell-invoked hook cost, derive a tight timeout)

**Classification: seam.** The declared `timeout` value in `.claude/settings.json` is enforced by Claude Code's own runtime, not by any thoth code — the boundary being constrained is thoth's code (a subprocess) vs. an external process-invocation mechanism (which shell, which OS, which machine) thoth does not control.

**Upstream — who feeds the number this candidate derives?**
The "producer" of the real invocation cost is the deploying machine's own shell/platform choice, not thoth code. Mechanically enumerated, not assumed:
```
$ grep -n "runs-on" .github/workflows/ci.yml
32:  runs-on: ubuntu-latest
126:  runs-on: ubuntu-latest
```
CI runs **exclusively** on `ubuntu-latest` — 2 jobs, both the same OS/shell family (`sh -c` shell form). The demonstrated worst case in both design-challenger rounds (`spawnSync("powershell", ...)`, p99=1051.2ms, a 6.7x understatement vs. exec-form) was measured on a real Windows machine — this session's own environment (`gitStatus`: `Platform: win32`) — which CI structurally cannot exercise. **This is candidate A's hidden second half**: "measure on a range of representative machines/shells" has no CI-backed instrument behind it for the one platform class (Windows without Git Bash → PowerShell fallback) already shown to be the worst case. A human has to manually re-run the spike on a second machine image, by hand, with no regression protection if a *third* developer's machine differs again (older PowerShell, corporate antivirus intercepting every `exec`, a cold OS file-cache, a slower CPU). Can every real producer (every developer's own machine) "satisfy the new precondition" (real cost stays under the derived margin) today? **Unknown and unenumerable** — there is no fleet, no CI matrix, and no mechanical check against any machine other than the one or two this review process happens to run on.

**Downstream — who consumes the declared number?**
```
$ grep -c '"command"' .claude/settings.json   → 2   (both are hook-invocation shapes: the existing broken entry + none yet added)
$ grep -rln "evaluateToolInventory" --include="*.ts" .   → 2 files (classification.ts, classification.test.ts — zero production wiring yet, confirms S5 hasn't shipped anything)
```
Consumers of the timeout value: (1) Claude Code's own hook-timeout enforcement (the only real consumer — one code path, outside this repo); (2) the plan's own regression test (C7: "declared timeout ≥ safety multiple of a freshly re-measured subprocess p99") — but "freshly re-measured" runs in CI, which is `ubuntu-latest` only (see above), so this test can never re-validate the demonstrated worst-case platform; (3) every real developer session using this repo's hooks, on whatever machine they actually run — the only consumer whose behavior actually matters for G6, and the one no instrument here checks.

**Invariant delta.** Before: no live hook exists, so "the declared timeout always exceeds real cost" is vacuously true (0% exposure, per `docs/STATE.md`'s own tracked claim). After candidate A ships: that invariant becomes a claim resting on measurements taken on 1–2 machines, extrapolated to every real developer's machine — a claim this exact defect class has already been wrong twice in two consecutive rounds (round 1: measured function calls, not the subprocess; round 2: measured exec-form, not the shell form Claude Code actually spawns for every entry in this file). Nobody who relies on "the gate will actually run, not silently bypass" gets to keep believing that on faith once this ships with a tightly-derived number — they are trusting a number this project's own history says has been wrong on the first two tries.

**Whack-a-mole verdict: RELOCATES.**
Defect class: *"the declared PreToolUse timeout is derived from a proxy measurement that does not match what Claude Code actually times, across an unenumerable set of real deployment shells/platforms."* This class has **already recurred twice** in consecutive graded design-challenger rounds — round 1 (function-only vs. subprocess) and round 2 (exec-form vs. shell-form) — a fact design-challenger's own round 2 report and Stop Brief both name explicitly as tripping PRINCIPLES rule 16's second, independent stop-counter. Per this project's own rule ("a class fixed 2+ times already is a structural finding"), that bar is already met — **this is the structural finding**, not something I am newly discovering. Continuing down candidate A's path (measure tighter, again) does not remove the class: it narrows one specific proxy gap (shell-form vs. exec-form) while leaving the next axis (cross-machine variance — antivirus, cold cache, CPU/Node version, WSL, a container) exactly as unmeasured and exactly as unguarded as the prior two axes were before someone happened to demonstrate them. No mechanical guard is proposed anywhere in the plan that would catch a third recurrence — and none is cheaply available: this project has no CI matrix across OS/shell (confirmed above, `ubuntu-latest` only), and building one is a real, separate cost this plan doesn't budget for. This is not WIDENS (it doesn't create new surface beyond what already existed) but it is squarely RELOCATES: the instance moves one layer down, the class stays open.

**Ledger:**
```
Fix A: touches ~3 files (T11 spike script/doc, C7 regression test, docs/decisions.md row) · new preconditions 1
(real subprocess cost < margin, on every real deploying machine — unenumerable) · migration no · reversible yes
· exposure if wrong ~100% of live Bash calls, basis: demonstrated (both rounds' own measurements, 148ms-1051ms
range depending on shell) · residual if NOT fixed (i.e. B ships instead) ~0% of live Bash calls, basis: measured
(600s default is ~500-4000x the demonstrated worst-case real cost)
```

**Verdict: PATCH-WITH-CONDITIONS** — condition: do not treat a third "tighter measurement" round as if it converges; if pursued, it must be paired with an explicit, named residual disclosure that no CI instrument validates the number against any platform but the one(s) actually measured, and a decision-log entry stating which machine classes were and were not covered.

---

## Candidate B — Sidestep: Claude Code's documented default (600s) + large disclosed margin

**Classification: seam** (same boundary as A), but **no measurement dependency** — the number comes directly from Claude Code's own documentation (already fetched and confirmed in both v1 and v2 research), not from a thoth-run benchmark.

**Upstream.** The only "producer" is Claude Code's own documented default-timeout value and its "configurable, no documented ceiling below 600s" property — both already confirmed via direct doc fetch in the plan's own §5 step 4 (unchanged across v1/v2, not re-litigated by either design-challenger round). No thoth-side producer to enumerate; there is nothing here that varies by developer machine, shell, or platform, because no measurement is being extrapolated. This is the direct, structural reason this candidate has no upstream "hidden second half": it doesn't ask an unenumerable population of machines to satisfy a precondition, it picks a number so large that the precondition is satisfied by construction.

**Downstream.** Same single real consumer (Claude Code's own enforcement). The regression test analogous to C7 becomes closer to vacuous (600s will almost always exceed any measured real value by 2–3 orders of magnitude) — that's not a defect in this candidate, it's the point: the test degrades to a sanity check, not a load-bearing guard, because the margin no longer needs one.

**Invariant delta.** Before: "the gate will actually run before Claude Code's timeout fires" is unproven for any candidate (nothing ships yet). After B: this invariant is *true by construction* for any plausible real-machine cost (the demonstrated worst case measured across both rounds — 1051ms — is roughly 1/570th of 600s). What changes, disclosed openly per the candidate's own framing: a **genuinely hung** hook (an actual bug — an infinite loop, a deadlock in `decide()`, not merely a slow machine) now blocks a user's session for up to 600s before Claude Code falls open, instead of failing open quickly. This is a UX/availability cost, not a new security exposure — SUR-12/OPS-03's own acceptance text already frames a timeout as "an incident under CI-10, not a routine event," which is a statement about how rare a real timeout should be, not about how fast it should resolve once genuinely triggered.

**Whack-a-mole verdict: CONTAINS.**
This removes the defect class entirely for the reason candidate A cannot: there is no proxy measurement to get wrong a third time, because there is no measurement. A future contributor cannot "silently narrow the margin" without it being visible — recommend (not design) a one-line decision-log/header-comment note stating explicitly that this number was chosen as Claude Code's own documented ceiling, not tightly derived, specifically to close this recurring defect class; that note is the cheap, sufficient guard against someone later "optimizing" it back down to a tightly-measured number without re-running this exact history.

**Ledger:**
```
Fix B: touches ~2-3 files (same regression-test + decisions.md row, no multi-platform spike) · new preconditions 0
· migration no · reversible yes · exposure if wrong (a genuine hang, not a slow machine) ~unmeasured, basis:
assumption — command that would measure it: instrument hook exceptions/hangs via CI-10 incident logging once
S8's evidence trail ships (not yet built) · residual if NOT fixed (i.e., A's tight number ships instead)
~100% of live Bash calls, same figure as A's own "exposure if wrong" line, basis: demonstrated
```

**Verdict: SAFE-TO-PATCH.**

---

## Candidate C — Pin exec-form invocation (explicit `args` array), then measure that pinned shape

**Classification: seam**, narrower in scope than A: this changes the **shape** of every `.claude/settings.json` hook entry (bare command string → `command`+`args`), not just the number.

**Upstream.** Removes exactly the variance source both rounds demonstrated (shell-form vs. exec-form: 30% on Git Bash, 6.7x on PowerShell fallback) by construction — Claude Code's own docs (fetched, quoted in round 2) confirm `args` present ⇒ exec form, no shell spawned, so "which shell falls back on which OS" stops being a producer of variance at all. Producer count for the *remaining* variance (cold module resolution, disk I/O, CPU/Node version, antivirus-intercepted `exec` calls) is unchanged from candidate A — this candidate closes one axis, not the whole class.

**Downstream.** New consumer not present in A/B: a structural CI check (cheap to add, same shape as `gate-command-path-check.ts`) asserting every `hooks.*.hooks[].command` entry carries an explicit `args` array — this is a genuinely mechanical guard, unlike A's unguardable claim. But it also changes an established convention: **every existing hook entry in this repo, 100% of them (1 of 1 today, the one being removed) uses the bare-string shape** — converting to `args`-form for the 3 new entries (while the file's only historical precedent used bare strings) is itself a small, disclosable seam that needs its own review attention, and either leaves the file with two coexisting shapes or implies (not required, but tempting) converting the pattern going forward.

**Invariant delta.** Before: shell-form variance is the dominant demonstrated risk (6.7x). After C: that specific axis is closed by construction; the residual (cross-machine variance beyond shell choice) is unchanged from A, at a smaller and currently unmeasured magnitude.

**Whack-a-mole verdict: RELOCATES** (smaller magnitude than A, same underlying class). Closes the *specific instance* both rounds demonstrated (shell fallback), but the class — "unmeasured/unmeasurable real invocation cost on an unenumerated real machine" — is still reachable via the next axis, exactly as the Stop Brief's own "scariest unproven assumption" section (antivirus scan of a freshly-written `.mjs`, cold OS cache, Node-version drift) already names. Genuinely cheaper and lower-residual than A; still not a full CONTAINS.

**Ledger:**
```
Fix C: touches ~4 files (.claude/settings.json shape change to 3-4 entries, 1 new structural CI check, T11 spike
re-run in exec-form only, decisions.md row) · new preconditions 1 (every hook command entry must use args-form
— mechanically checkable, cheap guard) · migration no · reversible yes · exposure if wrong: reduced from A's
~100% (the 30%-6.7x shell-variance sources are removed by construction) to an unmeasured residual bounded by
cross-machine variance beyond shell choice, basis: assumption — command that would measure it: repeat both
rounds' spawnSync benchmark on 2+ additional real machine images (a Windows box with a corporate AV product,
a cold/just-provisioned VM) · residual if NOT fixed: same ~100% figure as A, since C only ever ships instead
of, not in addition to, a bare-string entry
```

**Verdict: PATCH-WITH-CONDITIONS** — condition: still needs the same disclosure A does (this narrows, not closes, the unmeasured-machine problem) and needs its own confirmation that `args`-form doesn't change how Claude Code passes `stdin`/environment to the hook (not checked by either design-challenger round — flag as `unmeasured`, command: a same-day spike feeding real stdin through both entry shapes and diffing the hook's observed `process.env`/stdin bytes).

---

## Issue #89's own fix path — MCP-enumeration reads `~/.claude.json`, which carries live plaintext secrets

**Candidate as currently specified (v2 criterion 15, no field-level scoping named, no canary test named):**

**Classification: seam**, crossing directly into CLAUDE.md's own named sensitive-area/hard-rule territory ("No secrets in code/state/config") — this is not a subtle boundary call, the plan itself is reading a file this project's own conventions already flag by name.

**Upstream — who produces `~/.claude.json`'s content?** Every developer's own local Claude Code CLI (via `claude mcp add`, manual edits, OAuth flows) — not thoth code, and not enumerable as "N known producers"; it's "whatever any developer's own machine happens to hold," confirmed non-hypothetical on this exact machine (`mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN`, a live-shaped PAT, quoted verbatim in both the design-challenger round-2 report and Issue #89's own filed body). Can every producer "satisfy the new precondition" (only names ever propagate downstream)? Not today — nothing in the plan scopes the extraction, so the precondition is simply unenforced, not merely unverified.

**Downstream — who consumes what `sessionstart-tool-enum.mjs` reads?**
```
$ grep -rln "evaluateToolInventory" --include="*.ts" .   → 2 files (classification.ts, classification.test.ts)
```
Confirms zero production consumers exist yet (S5 hasn't shipped). The consumers that **will** exist once built: (1) `evaluateToolInventory`'s merged catalog (S3, shipped — the intended, legitimate consumer); (2) the halt-state file at `.thoth/halt-state/<session_id>.json` (gitignored, per the plan — but gitignored is not the same as "never leaves the machine": a session transcript, a bug report, a screen-share, or a support ticket can all surface stderr/log text that a gitignore does nothing to stop); (3) any stderr the script emits on its own failure path (criterion 16's fail-closed exception handling deliberately writes a detail string into the halt-state reason — the plan never states this detail string can't itself contain a secret if the exception happens to occur while holding a partially-parsed server object); (4) **a downstream nobody has named yet: test fixtures.** If any future contributor builds `sessionstart-tool-enum.mjs`'s test suite by copying a real `~/.claude.json`-shaped object as a "realistic" fixture rather than a synthetic mock, a real secret shape could be committed to the repo outright — a strictly worse, silent, and much higher-blast-radius failure than a runtime stderr leak, and nothing in the plan states fixtures must be synthetic. `.gitleaks.toml`/CI secret-scanning is the backstop for this specific case, but relying on the backstop instead of preventing the mistake at the source is exactly the shape of risk this project's own "sensitive areas" list exists to catch before merge, not after.

**Invariant delta.** Before v2 (i.e., v1's scope): `~/.claude.json` was never read at all — no secret-exposure surface existed here (design-challenger's own round 2 report states this explicitly: "v1 never touched `~/.claude.json` at all... this risk did not exist until v2's own fix for Issue #88 added this file as a new input"). After v2, as currently specified: a brand-new script reads a secrets-bearing file with no stated scoping and no test preventing propagation — the invariant "this hook never touches credential material" is broken by this fix itself, not by anything S5 was asked to build.

**Whack-a-mole verdict: WIDENS, as currently specified.**
This is not a repeat of an old class — it's new surface v2's own fix for a different finding (Issue #88) introduces, with a new precondition (secret-scoped extraction) that more code paths can now violate (any future edit to this script, any future debug log added under time pressure, any future fixture copied from a real file) than existed before this file was ever read. Per this project's own "silence is a finding" rule: this is exactly the shape — a plausible, uncaught, silent divergence (an `env` value quietly reaching a log line) — that this method treats as the highest-priority thing to surface, above even the T11 timeout question, because the failure mode here is not "the gate silently doesn't run" (already an accepted, disclosed category under G6) but "a real developer's real credential silently leaves the machine via a channel nobody was watching."

**The fix that flips this to CONTAINS is cheap and already named by design-challenger's own round 2 report**: a day-1, test-first canary check — feed `sessionstart-tool-enum.mjs` a mock config with a canary secret string in an `env`/`args`/`command` field, assert that string never appears in the halt-state file, stderr, or any other output the script produces, written and confirmed RED before the script's own implementation exists. This is a genuinely mechanical guard (a committed, named, executable test) — once it exists, a future regression (someone "helpfully" widening the extraction to `JSON.stringify(server)`) fails CI immediately, which is exactly what distinguishes CONTAINS from WIDENS in this method.

**Is there a narrower way to get the same information — the Manager's specific question?**
Yes, in principle, **but on `derived` evidence only** (a documentation fetch, not a command run on this machine — I did not verify this by executing it):
- `claude mcp list` is a documented Claude Code CLI subcommand that enumerates configured MCP servers — **including claude.ai account connectors** (per the same fetch, servers "from claude.ai appear in the list with indicators") — by name and connection status only; the documentation states credentials/env values are never exposed in its output.
- `claude mcp get <name>` gives endpoint-origin-level detail (scheme+host, no path/query) for one server, again without secrets.
- This is structurally narrower than reading the raw config file, because the secret bytes are never touched at all — there's no "did the extraction scope correctly" question to get wrong, because the CLI's own output never contains what would need scoping.

This is a genuinely better-shaped fix **if it holds up under an actual spike**, which nothing here has done. Costs/preconditions this path adds, none of them free:
1. Requires the `claude` binary to be reachable on `PATH` from inside a `SessionStart` hook's own subprocess environment — **unconfirmed**, `unmeasured`: the command that would settle it is running `claude mcp list` from inside a minimal Node subprocess spawned the same way `sessionstart-tool-enum.mjs` will be, on this same machine, today.
2. No documented `--json`/machine-readable flag was found in this fetch — the CLI's own output uses status symbols (`✔`/`✘`/`!`/`⏸`) meant for a human terminal; parsing it programmatically is a new, undemonstrated fragility class this project has already been bitten by once with S4's own hand-parsed shell grammar (ironic, but a real precedent for how expensive "parse an external tool's text output" gets when the format shifts under a version bump).
3. Adds a second subprocess-spawn layer (`node` → shell → `claude`) to `SessionStart` — lower stakes than `PreToolUse` (`SessionStart` already can't block per gap G5, so extra latency here isn't a G6-style bypass risk), but it is a new, unbudgeted cost nothing in this plan currently pays.

**Recommendation on this sub-question:** do not adopt `claude mcp list` as a substitute for the near-term fix — its evidence tier (`derived`) cannot itself justify a design change, and it needs its own spike (item 1 above) before anyone should build against it. The cheap, already-specified, test-first canary check is the correct near-term fix (flips WIDENS→CONTAINS at near-zero cost); `claude mcp list` is a strong candidate for `docs/backlog.md` as a future hardening pass (a narrower, secrets-proof-by-construction enumeration source), not a blocking condition on S5.

**Ledger:**
```
Fix #89 (canary-test + names-only scoping): touches 1 new file (sessionstart-tool-enum.mjs, not yet written)
+ 1 new test · new preconditions 1 (extraction scoped to names/enable-flags only — mechanically guarded once
the canary test exists) · migration no · reversible yes · exposure if wrong (test-not-written) ~unmeasured
population (how many dev machines carry an inline-secret MCP server env block), basis: assumption — demonstrated
non-zero on this one machine · residual if the whole criterion-15 fix is dropped instead (reverting to v1's
project-only enumeration): reopens Issue #88's original gap, ~demonstrated non-zero (6 configured servers on
this machine alone, per round 2's own count) — worse on balance than shipping criterion 15 WITH the canary test
```

**Verdict: PATCH-WITH-CONDITIONS** (condition: the canary test is written and confirmed RED before `sessionstart-tool-enum.mjs`'s own implementation — matching this project's own established test-first convention, and matching design-challenger's own proof-test recommendation verbatim).

---

## Recommended path

**Ship candidate B for the timeout (Claude Code's documented 600s default, disclosed, not tightly derived) and the canary-test-scoped version of the Issue #89 fix.** One sentence why: B is the only timeout candidate that removes rather than relocates a defect class that has already independently triggered PRINCIPLES rule 16's repeat-root-cause stop twice, and it satisfies rule 18 ("numbers measured before they shape anything") more cleanly than A/C because it rests on a directly-documented constant, not a derivation this project's own history shows is easy to get wrong a third time.

**Strongest argument against this recommendation:** B accepts a materially wider fail-open *window* (up to 600s of session-blocking delay on a genuine hang, vs. a fast fail-open on a merely-slow one) in exchange for removing the bypass risk — if a future story (S6's real config I/O, S8's audit-write, S11b's capability checks) adds enough synchronous work to this same hot path that a *routine*, non-buggy call starts taking seconds rather than milliseconds, 600s stops being "obviously safe" and starts being a real, if still bounded, latency budget question OPS-03 will need to re-litigate on its own terms — not a security regression, but a legitimate cost this recommendation defers rather than closes.

## Structural findings (defect classes fixed 2+ times, and the guard each needs)

1. **T11's timeout-derivation defect class has recurred in 2 consecutive graded rounds** (function-vs-subprocess, then exec-vs-shell-form) — already self-identified by design-challenger's own round 2 report and Stop Brief as tripping PRINCIPLES rule 16's repeat-root-cause counter. The guard this needs is not "measure again, more carefully" — this project has no CI matrix across OS/shell to mechanically validate any tighter number against the actual worst-case platform (confirmed: CI is `ubuntu-latest` only). The guard that actually contains the class is removing the parameter's sensitivity to measurement error altogether (candidate B), not a fourth measurement attempt.
2. **This is the first time this project has read a file outside its own repo/config that is independently known to carry live secrets** (`~/.claude.json`'s `mcpServers.*.env` blocks). No prior story (S1–S4) had this shape. The guard needed going forward, not just for this fix: any future story reading a user-scope config file for enumeration/classification purposes should carry the same test-first canary-secret discipline by default, not rediscover it per-story — worth a line in CLAUDE.md's "Sensitive areas" list naming "any code reading a Claude Code user/local config file" alongside the existing entries, since S11a/S11b are both plausible candidates to touch this same file again.

## Unmeasured

- True worst-case subprocess-invocation cost across a real fleet of developer machines (beyond the 1–2 measured this session) — command: repeat both design-challenger rounds' `spawnSync` benchmark on additional real machine images (a Windows box with corporate antivirus, a cold/just-provisioned VM, a WSL environment), owner: `story-implementer`/a human with access to those machines.
- Whether `args`-form (exec form) changes how Claude Code passes stdin/env to the hook vs. bare-string (shell) form — command: a same-day spike feeding identical stdin through both entry shapes, diffing the hook's observed input, owner: `story-implementer`, before candidate C could be adopted.
- Population-wide frequency of developer machines with an inline-secret `env` block in `~/.claude.json`'s `mcpServers` — command: none exists; this would need an opt-in, privacy-respecting survey or an org-wide config audit, not something this review can produce. Demonstrated non-zero on one machine only.
- Whether `claude mcp list` is actually reachable, non-interactive, and secret-free when invoked from inside a `SessionStart` hook's own subprocess — command: `node -e 'require("child_process").execSync("claude mcp list", {stdio:"inherit"})'` run from this repo's own working directory, owner: `story-implementer`, before any backlog item pursuing this path is prioritized.

## The single change most likely to be regretted in a month

**Shipping v2's criterion 15 (reading `~/.claude.json` for MCP enumeration) without the canary-secret test**, not the timeout question. A wrong timeout reopens a known, already-disclosed, non-secret bypass category (G6) that this project's own requirements text already treats as an accepted, recorded class of fail-open. An unscoped read of a file holding a real developer's real PAT is a different order of risk: the leak vector isn't a security abstraction, it's a stderr line, a shared transcript, or a screen-share away from a real credential in someone else's hands — and the fix that prevents it (one test, written before the script it guards) costs less than any of the three timeout candidates above.

---

RECEIPT: verdict=PATCH-WITH-CONDITIONS
candidates (ALL of them, ranked by risk):
1. [SUSPICION][HIGH][demonstrated/systemic][~100% of live Bash calls if a third tightly-derived number again mismeasures] Candidate A (fix T11 properly, continue tight measurement) — RELOCATES a defect class already recurring in 2 consecutive graded rounds; no CI-mechanical guard exists for the demonstrated worst-case platform (CI is ubuntu-latest only, worst case measured on Windows/PowerShell-fallback).
2. [ISSUE][MED][demonstrated(secret shape)+derived(leak-not-yet-built)/seam][demonstrated non-zero on this machine] Issue #89's fix path, as currently specified in v2 criterion 15 (no field-level scoping, no canary test named) — WIDENS: new, unguarded secret-exposure surface introduced by this story's own fix for a different finding (Issue #88); flips to CONTAINS at near-zero cost once the canary test (already recommended by design-challenger) is written test-first.
3. [SUSPICION][MED][demonstrated(shell-variance closed)+assumption(cross-machine residual)/seam][unmeasured residual, reduced from A's 100%] Candidate C (pin exec-form invocation) — RELOCATES at smaller magnitude than A: closes the specific shell-fallback variance both rounds demonstrated, leaves the same unmeasured-machine-cost class open one axis down.
4. [CLEAN][measured/seam][residual ~0% of live Bash calls] Candidate B (sidestep — Claude Code's documented 600s default + disclosed margin) — CONTAINS: removes the class rather than relocating it; satisfies PRINCIPLES rule 18 via a directly-sourced constant, no derivation to get wrong a third time.
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=1 suspicions=2 clean=1
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=0 derived=2
traced: upstream=2 producers (CI's ubuntu-latest-only matrix; ~/.claude.json's uncontrolled developer-machine population) downstream=4 consumers (Claude Code's own timeout enforcement; the C7/analogous regression test; evaluateToolInventory's merged catalog; the halt-state file/stderr/future-log/test-fixture channels) structural=2 classes fixed 2+ times (T11 measurement-methodology; first-ever read of a secrets-bearing external config file)
recommended=B (timeout) + #89-fix-with-canary-test unmeasured=4
checks=n/a (pre-build plan review; ran real grep/gh/git commands against this repo's actual files and CI config, plus 3 WebFetch calls against Claude Code's own current docs — no application test suite exists yet, hooks/ confirmed absent)
adr=HIT(1) (ADR-0021, already cited by both design-challenger rounds and architecture-reviewer; no new ADR surface touched by this seat)
report=docs/reviews/s5-deny-by-default-hook-wiring-impact-analyst-2026-09-06.md

---

## Addendum (same day) — reconciling with architecture-reviewer's council-seat ruling

`docs/reviews/s5-deny-by-default-hook-wiring-architecture-council-2026-09-06.md` (REWORK, read after this report's own analysis and RECEIPT above were already written and persisted) reaches the same directional conclusion — do not let a tightly-measured invocation-latency figure be the enforcement `timeout` value — by a sharper route: SUR-12 and OPS-03's own already-accepted text (`REQUIREMENTS.md:468/585`) specifies two distinct quantities in a "far below" relationship, not one number with a margin multiplier, and this repo already ships the working precedent (`.claude/settings.json:101`, `timeout: 10` against a disclosed few-millisecond real cost, never re-derived across four prior CRITICAL-tier cycles).

That seat's ruling refines my candidate B in one respect this report did not go far enough on: I described candidate B's regression test as degrading "closer to vacuous" once the config timeout goes generous. Architecture-reviewer's split-budget model is the correction — the tightly-measured subprocess+shell-form figure (round 2's own, already-correct measurement methodology; candidate C's exec-form pinning is a legitimate cheap refinement to it) does not become disposable, it moves to a **separate, still load-bearing** role: an internal OPS-03 alarm threshold, CI-regression-tested, whose overrun is a visible CI-10 incident — never the security-enforcement ceiling itself. This is a strictly better shape than my own candidate B as originally priced (a config timeout with no CI signal at all watching for real-world drift) and does not conflict with any of my three candidates' pricing above: it is B's own enforcement-value choice, plus A/C's measurement work redirected to a non-security-critical alarm rather than discarded.

**This does not change my recommendation's substance** (ship a generous, fixed, disclosed enforcement timeout, not a tightly-derived one) but revises how I would price "keep the measurement work" — it is not sunk cost once B ships, it is repurposed at the same cost this report already priced for candidates A/C, now protecting OPS-03's own fast-feedback budget instead of the security boundary. Recommended path, restated to match: **ship the split-budget model** (architecture-reviewer's own term) — generous fixed `timeout` (my candidate B's enforcement value) decoupled from a separately-measured, CI-regression-tested OPS-03 budget (candidates A/C's measurement work, repurposed as an alarm, not an enforcement input). Both council seats concur; nothing here is a dissent.

On Issue #89: architecture-reviewer's ruling adds two findings I did not surface — (1) `.mcp.json` carries the identical secret-shape risk as `~/.claude.json` and the canary fixture should cover both, not only the file this round happened to inspect; (2) the new `.thoth/halt-state/` directory should be named under CLAUDE.md's sensitive-areas list, since it is a persistent, session-readable artifact partly derived from secrets-bearing config. Both are correct, cheap extensions of the same WIDENS-as-specified/CONTAINS-with-the-canary-test verdict this report already gave; they sharpen the fixture's required scope (two files, not one) rather than changing its shape. Architecture-reviewer also names the specific accepted requirement this crosses (`OPS-02`, `REQUIREMENTS.md:584`, P0: "Thoth shall never read, log or emit credential material... Fixture asserts no secret-shaped content in any artifact") — this report's WIDENS verdict rested on CLAUDE.md's general hard-rule language; citing OPS-02 by number in the plan text is the more precise fix and should be adopted as the condition's exact wording.

No change to this report's counts/evidence/RECEIPT above — this addendum reconciles, it does not retract or contest any finding.
