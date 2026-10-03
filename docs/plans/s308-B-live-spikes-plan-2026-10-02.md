# #308 story B: live spikes, Phase 1 plan (2026-10-02)

Planner: Ptah (story-implementer), Phase 1 only. Branch `s308/activation-2` (from `origin/master` 35f49e9). Source rows: `docs/plans/s308-activation-phase0-2026-10-02.md` section 3 (B1 to B7) and `docs/plans/s308-activation-phase1-2026-09-30.md` rows AP-5 (line 33), X-2 (49), X-3 (50), X-8 (55), X-9 (56), X-21 (68). Approval to run live scratch `claude -p` sessions: `docs/decisions.md` 2026-10-02 rows (human ruling: the team runs live tests in scratch sessions).

ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`

## 0. Restatement and ADR review

Restatement: measure, in real scratch Claude Code sessions, six runtime facts about this repo's real PreToolUse hook (wall clock at `timeout` 60, a closed stdout, tool-name sanitization, settings `env` reach, a long deny reason, the `mcp__.*` matcher), record raw output as scrubbed evidence in the repo, and leave `.claude/settings.json` untouched.

ADR review (catalog read via `adr-cache`; no ADR was opened beyond the Phase 0 section 1 constraint list, which already screened A to K):
- THOTH-ADR-0001 (classification fixture as gate input): NOT-APPLICABLE to B (no fixture edit; the spikes only read it through the real hook).
- SE ADR-0005 (locked tests): NOT-APPLICABLE (no test file is created or edited by B; see section 8).
- SE ADR-0010 (type suppression): NOT-APPLICABLE unless the harness scripts are committed as `.mjs` under `docs/qa/` (then they are plain JS outside `src/` and `hooks/`; the 8-site JSDoc allow-list is for the three production hooks only). Flagged as Q2 so a builder does not guess.
- UNCLEAR: none.
CLAUDE.md hard rules honored: no `.claude/settings.json` change (B7); no edit to `hooks/*` or `src/policy/*` (sensitive areas, none touched; the real hook is only executed, and it writes no file); no secret in code (scrub step section 6); no gold-plating (B4b below is the same fact as B4, one more env value, see 3.4).

## 1. Facts verified while planning (so the builder does not re-derive them)

1. `claude --version` = 2.1.267. `claude --help` lists `--setting-sources`, `--settings`, `--mcp-config`, `--strict-mcp-config`, `--allowedTools`, `--output-format stream-json`, `--verbose`, `--include-hook-events`, `--max-budget-usd`, `--no-session-persistence`, `--disable-slash-commands`, `--model`. It does NOT list `--max-turns`. So the spend cap is `--max-budget-usd` plus a prompt that forces one call plus a kill timer in the runner. The builder tries `--max-turns 3` once at the smoke step; if rejected, it is dropped.
2. Default posture today: `src/policy/config/shipped-defaults.json` has `rules: []`; `.thoth/policy.json` (tracked) is the same placeholder; the loader's fallback `defaultOutcome` is `allow` (`src/policy/config/bootstrap-ruleset.ts:49`). So with the real hook: an allowed call emits NOTHING (exit 0, empty stdout, by design, Q-B in the hook header); only the hard-coded kernel rule POL-05 (`src/policy/kernel/kernel.ts`, `pol05Rule`) can deny today (mutating action with an opaque source or any unresolved field), plus the pre-kernel refusals (unroutable tool name, malformed input, policy load failure).
3. The project policy path is module-relative (`hooks/pretooluse-kernel-gate.mjs` line `PROJECT_POLICY_PATH = join(HERE, "..", ".thoth", "policy.json")`), and the classification fixture is module-relative too. A scratch `.thoth/policy.json` in the scratch project is therefore NOT read. A deny cannot be forced through scratch policy. It must be forced through POL-05 (below), or by editing the repo's `.thoth/policy.json`, which the plan rejects (sensitive area, and B is evidence-only).
4. Workspace trust is skipped in `-p` mode (help text), so the scratch project's `.claude/settings.json` hooks load without a dialog. `--setting-sources project` keeps the user's global settings (and plugin hooks such as maat's) out of the measurement.
5. Latency baseline: `npm run qa:gate-latency-budget` measures cold spawns of the real hook, 10 runs over the corpus; Phase 1 plan row AP-5 records p99 293.89 ms on this machine (Node 24.15); declared budget ceiling 2000 ms (`src/qa/gate-latency-budget-check.ts`, `ceilingMs`); the entry timeout 60 s is separate and fixed.
6. Tool-name shape the normalizer admits: server `[A-Za-z0-9-]+` (`ADMISSIBLE_SERVER_NAME`, `tool-class-format.ts:91`), tool `[A-Za-z0-9_-]+`; the runtime-side rule it assumes is "every char outside `[A-Za-z0-9_-]` becomes `_`" (`tool-class-format.ts:95-97`, observed for space and dot only, plan S-1). N13 is `src/policy/normalizer/tool-class.test.ts:270`.

## 2. Scratch layout (outside the repo)

Proposed: `C:\playground\thoth-spikes` (a sibling of the repo, not under `C:\playground\thoth`; not a git repo). The session scratchpad is the fallback if the human prefers nothing outside the session; it is a temp path and is lost, so the sibling folder is preferred, and evidence is copied into the repo anyway.

```
C:\playground\thoth-spikes\
  .claude\settings.json          active profile, written by run.mjs before each run (sequential runs only)
  profiles\<name>.json           one settings file per spike (section 3)
  harness\log-hook.mjs           logger: appends one JSON line per invocation, never decides (exit 0, no output)
  harness\tee-hook.mjs           spawns the REAL hook, times it, logs, passes result through (modes: pass | close-stdout | swallow)
  harness\odd-mcp.mjs            hand-rolled stdio MCP server, odd names from env/args (section 3.3)
  harness\run.mjs                runner: copies a profile, runs claude, captures raw output, enforces caps, appends to a ledger
  harness\scrub.mjs              evidence scrubber (section 6)
  mcp\<case>.json                --mcp-config files, one per B3 case
  raw\<id>.stream.jsonl|.err|.meta.json   raw captures (never committed unscrubbed)
  logs\<label>.jsonl             logger/tee output
```

All paths in profiles are absolute. The real hook is referenced as `node "C:/playground/thoth/hooks/pretooluse-kernel-gate.mjs"` (forward slashes survive the hook shell either way; the builder confirms in the smoke step which shell the runtime uses on this machine, and records it).

### Harness pieces (no new npm dependency; Node 24 built-ins only)

- `log-hook.mjs <label>`: reads stdin JSON; appends `{label, t_epoch_ms, t_iso, event (hook_event_name), tool_name, tool_use_id, stdin_bytes, node_version: process.version, cwd, env_probe}` to `logs/<label>.jsonl`. `env_probe` is NOT a full env dump (secrets): it holds `{keyCount, has: {CLAUDE_PROJECT_DIR, NODE_OPTIONS, SYSTEMROOT, windir}, values: {SPIKE_ENV_PROBE, CLAUDE_PROJECT_DIR(scrubbed later), NODE_OPTIONS}}` and the sorted list of env key NAMES that start with `CLAUDE` or `SPIKE`. The raw `tool_input` is stored only for Bash (short). It exits 0 with empty stdout, so it never changes a verdict.
- `tee-hook.mjs --mode=<m> --label=<l> -- node <real hook>`: spawns the real hook with piped stdio, forwards stdin, records `hrtime` spawn-to-exit, child exit code, stdout bytes and text, stderr text, and its own start offset (`performance.now()` at entry, to separate wrapper start-up from hook time). Modes: `pass` (writes the child's stdout/stderr through, exits with the child's code: transparent), `close-stdout` (B2: destroys the read end of the child's stdout pipe BEFORE forwarding stdin, so the child's write hits a closed pipe; the wrapper writes nothing to its own stdout and exits with the child's exit code), `swallow` (B2 control: runs the child, discards its output, exits 0 with empty stdout: what an unflagged dropped write used to look like).
- `odd-mcp.mjs`: newline-delimited JSON-RPC 2.0 over stdio. Handles `initialize` (echoes the client's `protocolVersion`, `capabilities: {tools: {}}`, `serverInfo: {name: <arg>, version: "0.0.0"}`), ignores `notifications/*`, `tools/list` (returns the tool names from `SPIKE_TOOLS`, a JSON array in the config's `env`, each with an empty-object `inputSchema` and a one-line description), `tools/call` (returns `{content:[{type:"text",text:"spike-ok <name>"}]}` and appends a line to `logs/mcp-calls.jsonl`, which proves the call was actually executed, i.e. NOT blocked), `ping`, and an error for unknown methods. About 60 lines.
- `run.mjs <spikeId> --profile <p> --prompt "<text>" [--mcp <case>] [--tools "<allowed>"]`: copies `profiles/<p>.json` to `.claude/settings.json`, runs from cwd = scratch, writes raw stdout/stderr, the exit code and wall time to `raw/`, appends `{id, cost_usd (from the stream's result event), duration}` to `ledger.jsonl`, kills at 120 s, and refuses to start when the ledger shows 40 calls or USD 3.00 spent (the hard stop; section 7).

### The invocation (all live calls share this shape)

```
claude -p "<prompt>" --model haiku --output-format stream-json --verbose --include-hook-events \
  --setting-sources project --disable-slash-commands --no-session-persistence \
  --allowedTools "<Bash | mcp__...>" --max-budget-usd 0.25 [--strict-mcp-config --mcp-config mcp/<case>.json] < NUL
```

Why these: `haiku` is the cheapest model that reliably issues a named tool call (the builder verifies `haiku` resolves as an alias at the smoke step; fallback is the dated haiku model id from `claude --help`); `--allowedTools` pre-approves the one tool so `-p` does not stall on a permission prompt, WITHOUT `--dangerously-skip-permissions` (the hook is a PreToolUse gate and must be the only thing deciding); `--include-hook-events` puts hook start/response events (with timestamps and exit codes, if the runtime emits them in this version) into the stream; `stream-json --verbose` gives the `system/init` tool list and the `tool_result` text the model was shown, which B3 and B5 need. Prompt pattern that forces exactly one call: `Call the <Bash|named> tool exactly once with <the literal input>. Do not call any other tool. After the result (or an error) reply with the single word DONE.`

## 3. Per-spike design

Common smoke step (S0, 1 call, before any criterion): profile `smoke` = logger only (no real hook), Bash `echo spike-smoke`. It proves: scratch settings load under `--setting-sources project`, the hook shell and command form work with an absolute path, `haiku` resolves, `--max-turns` accepted or not, the stream contains hook events (or not; B1 then relies on the tee numbers alone). The builder records which shell ran the hook command.

Offline dry runs first (0 live calls, S-pre): pipe synthetic payloads into the real hook from the scratch folder to pick the B5/B2 deny payloads and to learn the exact default-posture behavior (section 4). Example: `echo '{"tool_name":"Bash","tool_input":{"command":"..."} ,"session_id":"x"}' | node C:/playground/thoth/hooks/pretooluse-kernel-gate.mjs`.

### 3.1 B1 (AP-5): wall clock of the real hook at `timeout` 60

- Profiles: `b1-direct` = PreToolUse, matcher `Bash`, TWO entries in the same group: the real hook with `"timeout": 60`, and `log-hook.mjs b1-direct` (parallel sibling; its start timestamp marks tool-call arrival). Plus a PostToolUse entry for `log-hook.mjs b1-post` (end marker). `b1-tee` = matcher `Bash`, one entry `tee-hook.mjs --mode=pass --label=b1-tee -- node <real hook>` with `"timeout": 60`.
- Calls: 3 on `b1-direct`, 3 on `b1-tee`; each prompt: Bash with the harmless literal `echo spike-b1-<n>` (allowed by the default posture, so the hook's normal silent-allow path is what is timed). One call per `claude -p` run, so each is a cold hook spawn.
- Captured: stream events (hook start/response times if present), `logs/b1-*.jsonl` (start/post epoch ms; tee's hrtime), plus a same-hour baseline: `npm run qa:gate-latency-budget` output, and an offline `tee`-style timing of 10 cold spawns from the scratch folder with the same payload.
- Criterion (B1): numbers recorded and set beside the p99 (about 294 ms) and the 2000 ms budget. What it can show: the real runtime's spawn-to-exit time for the allow path and that the 60 s timeout is never approached. It cannot show: latency of a deny path with rules (no rules exist), or the cost of a populated policy (story E). An observed hook wall clock above 2000 ms is a FINDING to file, not a failure of B. The tee overhead (a second Node start) is reported separately, which is why both profiles exist.

### 3.2 B2 (X-2): stdout closed before write, in a real session

- Needs a deny so the hook attempts a write: an allow emits nothing, so a closed stdout would prove nothing. Payload: a POL-05 deny command chosen offline (3.5); harmless if executed (relative path inside scratch, no network).
- Profiles: `b2-close` = matcher `Bash`, tee `--mode=close-stdout` around the real hook, `timeout` 60. `b2-control` = tee `--mode=swallow` around the real hook (a dropped deny that exits 0 with empty stdout), `timeout` 60. Optional third, `b2-baseline` = real hook direct (the deny arrives normally), so the three outcomes sit side by side.
- Calls: 3 (one per profile), the same Bash prompt.
- Captured: tool_result text, whether the tool executed (a marker file the command would create in scratch: its presence means the call was NOT blocked), tee log (child exit code, stderr text, whether the write errored), stream hook events.
- Criterion (B2): record whether the runtime blocked the call when the real hook exits 2 on a closed stdout. Expected from the hook's own header: exit 2 with the fixed stderr line, call blocked; control: the call runs (this is the fail-open the exit-2 path exists to prevent, demonstrated live). The probe row `stdout-closed-before-write` stays unchanged (verify: `git diff --stat -- src/qa/gate-fail-open-probe.ts` empty). Limit stated in the evidence: this simulates the closed pipe through a launcher on Windows; the runtime itself never closed the pipe, which nothing here can make it do. Linux stays unmeasured (X-2 says so; out of scope).

### 3.3 B3 (X-3) and B6 (U-5): odd MCP names, and the `mcp__.*` matcher

- Server: `harness/odd-mcp.mjs` per the pieces list. Configs in `mcp/<case>.json`: `{"mcpServers": {"<config key>": {"command": "node", "args": ["C:/playground/thoth-spikes/harness/odd-mcp.mjs", "<key>"], "env": {"SPIKE_TOOLS": "[\"<tool names>\"]"}}}}`.
- Server config keys tried (the characters X-3 asks about): `plain-srv` (control), `under_score`, `odd.srv` (dot), `sp ace` (space), `co:lon` (colon), `plus+x`, `slash/x`, `caf\u00e9` (non-ASCII), and `a__b` (double underscore, the delimiter-ambiguity case). Tool names tried on the control server: `plain_tool`, `do.it`, `sp ace`, `co:lon`, `slash/x`, `caf\u00e9`, a 65-char name. Because one invalid name could make the API reject the whole request, each odd name is its own config file and session.
- Step 1, free of tool calls: one `-p` run per config case with the prompt `Reply with the single word OK.`, reading the `system/init` event's tool list. That gives the runtime's own sanitized `mcp__...` name (or its absence) for every case. About 12 cheap runs, but they can share one session where the runtime accepts all servers together; the builder runs the combined session first (1 call) and falls back to per-case runs only for a case that is missing from the combined list or that breaks the session. Recorded as a table: configured name, name shown in init.
- Step 2, one call each for the cases that appear in init (up to 6 calls): profile `b3` = matcher `mcp__.*`, entries: real hook (`timeout` 60) and `log-hook.mjs b3`. The prompt names the exact tool name from init. Captured: logger `tool_name` (exactly what the hook received), the real hook's verdict as shown in the tool_result, and `logs/mcp-calls.jsonl` (the server ran only when the call was not denied).
- What the real hook will do: an unclassified `mcp__` name has no catalog entry, so it is opaque and POL-05 denies it if the action is mutating (the builder confirms offline in S-pre which names deny and which allow; the default posture otherwise allows). That is fine for B3: the question is the `tool_name` string the hook receives, which the logger records regardless of the verdict.
- Criterion (B3): the table of configured name, init name, hook-received `tool_name`; then re-read N13 (`tool-class.test.ts:270`) and `tool-class-format.ts:95-97` against it and write one of two lines: "the runtime sanitizes every char outside `[A-Za-z0-9_-]` to `_` for the cases tried, N13's tool-segment premise holds" OR "names that differ: <list>, N13/grammar needs story follow-up (file an Issue, no edit in B)". The live result is the instrument; no hand-typed completeness claim about "all characters" (the claim is limited to the cases tried, listed).
- B6 (U-5): in profile `b6` the matcher is `mcp__.*` only (no `Bash` matcher), logger plus real hook. One run, two calls in order: Bash `echo spike-b6-bash` then the control server's `plain_tool`. Pass: the logger shows an entry for the MCP call and NO entry for the Bash call (matcher matched the MCP name and excluded the built-in). If the model does not make both calls in one run, split into two runs. The real hook's deny of the unclassified MCP call also appears in the tool_result, which independently shows the hook ran.

### 3.4 B4 (X-8): does a settings `env` block reach hooks

- Profile `b4`: `"env": {"SPIKE_ENV_PROBE": "from-settings-env"}`, matcher `Bash`, entries: `log-hook.mjs b4` (reads `process.env.SPIKE_ENV_PROBE`) and the real hook. 1 call (Bash `echo spike-b4`).
- Profile `b4b` (same fact, the form-of-D question): `"env": {"NODE_OPTIONS": "--spike-unknown-flag"}` with matcher `Bash`, real hook direct plus the logger. 1 call. This asks whether a project settings `env` block can poison the hook's process start (exit 9, non-blocking, fail-open per hook header residual (a)), which is what decides whether the launcher in story D must scrub or set its own env. Hazard: `NODE_OPTIONS` in the env block may also affect the Bash tool or `claude` itself; the run is a scratch session so the worst case is a failed run, recorded as the result. Not a gold-plate: it is the same mechanism, one more value, and the X-8 row already names env-block reach as the open unknown.
- Captured: logger `env_probe` (does `SPIKE_ENV_PROBE` equal the configured value; key names present), the real hook's behavior under b4b (exit code from hook events, whether the Bash call proceeded).
- Criterion (B4): recorded yes/no per value. If yes, record which launcher consequence follows (D must not trust inherited env; the existing disclosed limit D5 stands). If no, record that D need not defend against the env block. The ruling on D's form stays with the Manager/human; B only records.

### 3.5 B5 (X-9): deny reason near the 512-char cap, what the runtime shows or truncates

- The 512 cap is `REASON_NAME_CAP` (`decide-tool-call.ts:60`) for reflected tool names and `UNRESOLVED_FRAGMENT_CAP` (`kernel.ts:81`) per unresolved fragment of a POL-05 reason. A model cannot make a tool name long (the API limits tool-name length), so the live lever is a Bash command whose unresolved fragments reflect into the POL-05 reason. Reason text is `POL-05: mutating action has unresolved field(s) [<frag>, ...] — fail-closed on ambiguity`, after terminal sanitization.
- S-pre (offline, 0 calls): the builder finds three Bash commands, each harmless if it were executed (relative path in scratch, no network), whose real-hook deny reasons measure by script (`JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason.length`) at about 450 to 520 characters (just under and just over the cap), about 2,000, and about 10,000. Candidates: `touch "$(echo <long literal>)"`-style commands with a long dynamic fragment, or a long redirect target built from an expansion; several fragments push the reason past one fragment's cap. The measured lengths go in the evidence, produced by the script, not typed. If no Bash shape denies today, a POL-05 deny through an opaque MCP name (3.3, tool `do.it` or similar) is the fallback lever, with the length ladder limited to what a tool name allows.
- Calls: 3 (one per rung), profile `b5` = matcher `Bash`, real hook direct with `timeout` 60 plus logger, `--allowedTools Bash`. Prompt: `Call Bash exactly once with this exact command: <command>`. A deny leaves the model to reply; the verbatim command must survive the model's retyping, so the logger's recorded `tool_input.command` is checked against the intended string (a mismatch voids that rung and it is rerun once).
- Captured: stream `tool_result` text (what the model was shown), the hook-event response text if emitted, the logger's stdin record. Observation: for each rung, the reason length the hook produced, the length and text the runtime surfaced, whether it truncated (and where), whether the call was blocked. Pass (B5): the three rungs are recorded with these four fields. A truncation, a dropped reason, or an error on a long reason is a FINDING; if the hook's deny is dropped silently and the call proceeds, that is a fail-open and gets a High Issue.
- What it can and cannot show: it shows the runtime's handling of long `permissionDecisionReason` on this version. It does not show behavior with real rules (none exist) or a reason built from a rule id and label.

## 4. What the default posture lets each spike show

| Spike | Real-hook result today | Therefore |
|---|---|---|
| B1 | allow, silent, exit 0 | times the allow path only; deny-path and rule-evaluation latency wait for story E/J |
| B2 | needs a POL-05 deny to attempt a write | the deny payload comes from S-pre; allow commands would make the spike void |
| B3 | unclassified `mcp__` name is opaque; POL-05 may deny | the logger, not the verdict, is the instrument |
| B4 | allow, silent | the logger is the instrument; b4b observes hook exit under a poisoned env |
| B5 | POL-05 deny with reflected fragments | the only deny lever without rules |
| B6 | opaque MCP name denied; Bash not routed to the hook by this matcher | logger shows matcher reach; the deny shows the hook ran |

Not forceable here: a rule-driven deny (rules come from `shipped-defaults.json`, central, or the repo `.thoth/policy.json`; the scratch project's `.thoth/policy.json` is never read, section 1 item 3). Rule-driven latency and reason text are story E/J concerns and are out of B.

## 5. Evidence location

- Scrubbed raw captures: `docs/qa/s308-live-spikes/<spike>.txt` (B1 through B6, one file each; B3 and B6 may share the odd-server case table), each with a header block: date, Claude Code version, Node version, the exact command line, the profile JSON used (scrubbed), model, the call's cost from the ledger.
- Summary: `docs/qa/s308-live-spikes/SUMMARY.md`: one table, rows B1 to B6, columns: question, observation (quoted from the txt, with the file name), disposition (answers X-2/X-3/X-8/X-9/AP-5/U-5 and what it implies for D, E, J), and findings to file as Issues. Counts and lengths are pasted from script output, not hand-derived.
- Harness copies (so a rerun is possible; small): `docs/qa/s308-live-spikes/harness/*.mjs` (Q2: commit them, or leave them in the scratch folder only).
- Citations in the summary must resolve (QA-14): the builder runs `node src/qa/reference-resolver.ts origin/master HEAD` before any push (memory note: npm default misses doc citations). Avoid hand-typed "all/every" completeness prose in the summary (the completeness-claims checker); tables come from script output.
- Not edited in B: `docs/STATE.md`, `CHANGELOG.md`, and `docs/decisions.md` are the Manager's or are touched in the story's own closing commit; the builder proposes lines, and the spike results that change a Phase 1 row (X-2, X-3, X-8, X-9, AP-5) are recorded as new rows by the Manager, not by editing the old plan rows.

## 6. Scrubbing before anything is committed

`harness/scrub.mjs` reads `raw/` and `logs/`, writes a copy for the repo, and replaces: the home path in any form (`C:\Users\<name>`, `C:/Users/<name>`, `/c/Users/<name>`) with `<HOME>`; `C:\playground\thoth` forms with `<REPO>`; `C:\playground\thoth-spikes` forms with `<SPIKES>`; session ids and `tool_use_id`/message uuids (UUID and `toolu_` shapes) with stable placeholders (`<SESSION-1>`, `<TOOL-USE-1>`); the machine hostname (`os.hostname()`), the account email, org or account ids and any `apiKeySource`-adjacent field from the init event; and ANTHROPIC/Claude token-shaped strings. The `system/init` event is cut down to the fields B3 needs (`tools`, `mcp_servers` names and status, `model`, `claude_code_version`, `permissionMode`). Environment dumps never reach the files in the first place (the logger records an allow-list, section 2).

Verification of the scrub, run by script, results pasted: (1) `node src/secret-scan/pre-commit-scan.ts` over the staged evidence (the repo's pattern set includes `email-address`, `internal-hostname`, `ipv4-private`, token and key patterns, `src/secret-scan/patterns.ts`; a home path or session id does not trip any of them, which is why the scrub script, not the scanner, is what removes them); (2) a negative grep over `docs/qa/s308-live-spikes/` for the username, the hostname, the account email and a UUID regex, each expected to return nothing; (3) `git diff --stat -- .claude/settings.json` empty (B7). A leftover hit is fixed in the scrubber and the evidence regenerated from `raw/`, never hand-edited.

## 7. Cost and number of live calls

| Group | Calls |
|---|---|
| S0 smoke | 1 |
| B1 | 6 |
| B2 | 3 |
| B3 init session(s) (combined, per-case fallback) | 1 to 4 |
| B3 per-case calls | up to 6 |
| B6 | 1 (2 if split) |
| B4 + B4b | 2 |
| B5 rungs | 3 (+2 reruns allowed) |
| Total expected | about 25; ceiling 40 enforced by `run.mjs` |

Each is a haiku call with the CLI's own system prompt and tool definitions (low tens of thousands of input tokens, a few hundred output); expected well under USD 0.05 each, about USD 1.00 in total, hard-capped at USD 0.25 per call (`--max-budget-usd`) and USD 3.00 for the whole set (`run.mjs` reads `total_cost_usd` from each result event and refuses further calls). These are estimates to be replaced by the ledger's real sum in the evidence summary.

## 8. Risk tier, acceptance criteria, checks

Risk tier: STANDARD, agree with Phase 0. Justification: no repo behavior change, evidence and docs only; it executes a sensitive-area hook read-only and opens no write path. The reason it is not TRIVIAL is that its output is evidence other stories rely on (D's launcher form, J's wiring) and a scrubber failure could leak a path or id into history. Reviewer: one domain reviewer, `code-reviewer` (checks that evidence matches raw output, the scrub, the dispositions), plus `cross-domain-reviewer` per the every-tier-above-TRIVIAL rule. No `red-team`, no CRITICAL ceremony. If a spike surfaces a fail-open (B2 control, B4b, B5 dropped deny), the finding is filed and the owning story (D/H/J) is re-tiered by the Manager.

| # | Criterion | Check (named) |
|---|---|---|
| B1 | AP-5 wall clock recorded and compared | `docs/qa/s308-live-spikes/B1.txt` with hook-event/logger/tee timings (n=6) and the `qa:gate-latency-budget` line from the same session; `SUMMARY.md` row B1 states the comparison |
| B2 | X-2 reach in a real session | `B2.txt` with three runs (close-stdout, swallow control, baseline), tool-executed markers, tee exit code; `git diff --stat -- src/qa/gate-fail-open-probe.ts` empty |
| B3 | X-3 sanitization table | `B3.txt` table configured name / init name / hook `tool_name` per case tried; N13 line and `tool-class-format.ts:95-97` re-read recorded in `SUMMARY.md` |
| B4 | X-8 env reach | `B4.txt` with the `SPIKE_ENV_PROBE` observation and the b4b hook-exit observation |
| B5 | X-9 long-reason handling | `B5.txt` with three rungs, four fields each, lengths produced by script |
| B6 | U-5 matcher match | `B6.txt`: logger shows the MCP call entry and no Bash entry under matcher `mcp__.*` |
| B7 | `.claude/settings.json` unchanged | `git diff --stat -- .claude/settings.json` empty at start and at end (both outputs in `SUMMARY.md`) |
| Derived (marked, not load-bearing) | the evidence is scrubbed | scrub verification of section 6 (secret scan clean; negative greps empty) |
| Derived (marked, not load-bearing) | the repo is otherwise untouched | `git status --short` after the build lists only `docs/qa/s308-live-spikes/**` (and the plan file) |

Rollout and rollback: evidence-only files in one commit on `s308/activation`; revert the commit to roll back. Nothing is deployed. The scratch folder is deleted by the human or left in place (it holds raw unscrubbed captures; the plan recommends deleting `raw/` after the scrubbed copy is committed, once the summary is accepted).

## 9. Test-first dispatch check

Does the plan identify a new or changed UI flow or API surface? No. It has no externally observable behavior change in the product; it records runtime facts. `test-writer` is NOT dispatched. Proceed from this plan to Phase 2 on approval. (Spike-first, PRINCIPLES rules 17 and 18: B is the spike; no number in the plan is assumed. The walking-skeleton rule does not apply, nothing novel is shaped.) Findings that arrive from the spikes and need a test (for example an N13 change) are separate stories and arrive as failing tests first.

## 10. Questions for the Manager (none blocks starting; ranked by build impact)

1. Scratch location: `C:\playground\thoth-spikes` (proposed, a sibling of the repo) versus the session scratchpad. Default if unanswered: the sibling folder.
2. Commit the harness scripts (about 4 small `.mjs`, as `docs/qa/s308-live-spikes/harness/`) for rerunnability, or evidence only? Default: commit them; they hold no secrets and are not under `src/` or `hooks/`.
3. B4b (`NODE_OPTIONS` poison through the env block): in scope as the same X-8 fact, or limited to the `SPIKE_ENV_PROBE` reach only? Default: include it (2 calls).
4. B5 uses a 3-rung length ladder (about 500, 2,000 and 10,000 characters), not only the near-512 rung, to find where the runtime truncates if it does. Default: include it (2 extra calls). The shape of the deny lever depends on S-pre (offline); if no Bash command denies by POL-05 on today's normalizer, the builder stops and reports instead of editing the repo.
5. If a spike shows a fail-open (B2 control passing as expected is NOT one; B4b exit 9 proceeding, or B5 dropped deny, would be), who files the Issue: the builder in the same turn per the Issue Discipline rules. Confirm that spawning a finding Issue from a spike is wanted.

RECEIPT: verdict=PLAN-READY criteria="7/7 mapped" checks="0/0/0" adr=NONE(0) pr=n/a
