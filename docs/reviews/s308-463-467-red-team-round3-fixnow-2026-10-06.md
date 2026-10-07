# Red Team (Sutekh): s308-463-467 round-3 fix-now confirm

- Date: 2026-10-06. Tier: CRITICAL. HEAD 2f30c8c. Delta: `git diff dea5f27 2f30c8c` (6 commits, 622e342..2f30c8c). Prior: `docs/reviews/s308-463-467-red-team-round3-2026-10-06.md`.
- ADR cache: `📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]`.
- No Claude Code binary was executed this round. installed-live was excluded. I ran the mutation drills in an isolated `git clone --shared` checkout under the session scratchpad (`r3f/clone`), never in the shared review worktree.

## Verdict: GO

- **#486 is FIXED.**
- **The JA-replay detector is sound against hand edits of the judgment files.** It caught all 7 mutations, and CI runs it with full history.
- **The pending marker is handled safely.** The applier refuses the real pending tools delta, reading the marker from the committed blob.

One MED remains, filed against #479: a re-judgment can be laundered by editing an **already-applied** delta and the judgment in the same commit, and replay stays green. One LOW suspicion: two lock files are judged residual by name alone.

## Attacks, ranked by exposure x irreversibility x silence

### 1. [ISSUE][MED][demonstrated] JA-replay cannot see a re-judgment laundered through an already-applied delta (#479)

Replay recomputes the judgment from whatever the deltas say **at HEAD**. If a commit edits an applied delta's entry and the judgment file the same way, the two still agree, and the record the human approved has changed. That bypasses the `replace` op and any new committed delta. Mutation M8 (isolated clone, scratchpad r3f/mut2.ts):

```
weakening applied-delta entry: .credentials.json
M8 JA-replay exit: 0 PASSED
```

M8 turned .credentials.json (anywhere, protected) into residual, in both s308-463-467-b.json and the judgment file, in one commit. The effective deny rule survives only because protected-path-list.ts hand-lists the named path. That is a second, independent list, not something the judgment guarantees.

The fix commits already edit applied deltas: `sequence` was added to a and b. So "a delta never changes after it is applied" is not enforced anywhere.

Exposure: every future judgment change. Basis: counted in code (no immutability check). It is visible in a PR diff, so MED. Required failing test: **`JA-replay/applied-deltas-immutable`**. For each delta, its content at the commit that first added it must equal its content at HEAD, ignoring only the marker keys `sequence` and the removal of `status`.

### 2. [SUSPICION][LOW][code-traced] `server.lock` and `computer-use.lock` are judged residual by name only

Delta c's evidence for both is only "in Claude Code's own list of ~/.claude child names". In 2.1.289, both strings appear only in that set and in the constant pool of a bytecode-compiled module (chunk-4ey75r3r.js, next to server-sessions.json and antproto.json), so no reader can be traced from source (scratchpad r3f/locks.ts). The nearest analogue, the IDE lock files, hold connection records and are judged protected. A server lock that carries a port or token would be the same lever.

**UNPROVEN-pending-verification.** Settle it by reading `~/.claude/server.lock` while `claude server` runs, or judge it protected fail-closed, as delta c already did for `storage-v2` and `systemd`.

### 3. [CLEAN][demonstrated] #486 FIXED

- Delta c replaces `user:mcp-skill-archives` (residual to protected, `~/.claude/mcp-skill-archives/`) and adds the `anywhere` entry with both paths.
- `CC-judgment/mcp-skill-archives-protected` passes.
- `protected-path-list: PASS, 234 protected paths`.
- The path appears 6 times in shipped-defaults.json.

### 4. [CLEAN][demonstrated] JA-replay catches hand edits

Isolated clone at 2f30c8c (scratchpad r3f/mut.ts):
- **Baseline:** passes (JA-replay/committed-deltas-reproduce-judgments).
- **Every mutation was committed, then the test was run:**
  - M1 hand-flips a judgment (plans to protected): FAIL "write-deny judgment equals base plus committed deltas".
  - M2 hand-adds a tool judgment: FAIL "tool-exec judgment ...".
  - M3 marks the applied delta b pending: FAIL.
  - M4 hand-applies the whole pending tools delta and keeps the marker: FAIL.
  - M5 deletes mailbox: FAIL.
  - M6 changes whitespace only: FAIL.
  - M7 duplicates a sequence number: FAIL "sequence numbers are unique".

The test skips only on a shallow clone. CI checks out with `fetch-depth: 0` (`.github/workflows/ci.yml:58`) and merges with merge commits, so the base lookup works in CI.

### 5. [CLEAN][demonstrated] Pending-marker handling is safe

- The applier reads `status` from the committed blob. A dry-run of s308-463-467-tools.json gives "REFUSED ... is marked pending", exit 1.
- Removing the marker only in the work tree is refused anyway, because the file is modified relative to HEAD.
- The replay skips a pending delta, but the byte check still catches any full or partial hand application of it (M4), and a false pending marker on an applied delta (M3).
- A pending delta with nothing left unapplied fails the "still unapplied" assertion, which fails closed.

### 6. [CLEAN][code-traced] Delta c's other residuals stand under the criterion (loaded as config, code or instructions = protected)

- **daemon.lock:** a pid/startedAt lock (const-held name joined onto the config dir; release checks both fields). DoS at most.
- **Data, logs and statistics:** api-dumps, downloads, file-transfers, image-cache, logs, active-time.json, stats-cache.json.
- **paste-cache:** a paste-recall cache (the P8 const, an in-flight and retained class). Same class as history.jsonl, which is residual.
- **scratch:** session scratch data.
- **Protected fail-closed** where the evidence is thin: storage-v2 (this also settles my round-3 suspicion about K's named paths: the whole dir is now protected), systemd, local-settings, project-settings, agent-memory-project, .session_ingress_token, .claude.json, bridge-spawn, server-sessions.json, antproto.json.

### 7. [CLEAN][demonstrated] Suite, drift and idempotence

- 107/107 tests (installed-live excluded).
- Drift PASS at 234 paths.
- Typecheck and lint clean.
- Delta c dry-run gives NO CHANGE.

## Commands run (raw)

```
node --test --test-skip-pattern=installed-live src/qa/cc-certified.test.ts src/qa/judgment-apply.test.ts src/qa/claude-code-write-deny.test.ts src/qa/k-runbook.test.ts src/qa/tool-exec-judgment.test.ts
  tests 107 / pass 107 / fail 0 / cancelled 0 / skipped 0
node src/qa/protected-path-list.ts   PASS, 234 protected paths (3 from plugin hooks), committed rules and proposal match the generator
npm run typecheck TC=0 ; npx eslint (3 files) LINT=0
judgment-apply s308-463-467-c.json --dry-run       NO CHANGE, exit 0
judgment-apply s308-463-467-tools.json --dry-run   REFUSED (pending), exit 1 (expected)
isolated clone (git clone --shared, scratchpad r3f/clone) at 2f30c8c: JA-replay baseline pass; mutations M1-M7 caught (7/7); M8 not caught (finding 1)
read-only byte probes: r3f/locks.ts, r3f/ccr.ts
```

## Scariest unproven assumption

That an approved delta, once applied, stays the record the human approved. Nothing pins it (M8). **Single next action:** add `JA-replay/applied-deltas-immutable` (compare each delta at its first-add commit with HEAD, ignoring the marker keys).

## Editorial (verdict-neutral)

- .ccr-launcher, .ccr-git, remote-agents.json and .host-config-snapshot- are self-hosted runner paths under a hooks dir, not .claude children. They are correctly absent from the census and judgments.
- Judging .claude.json with userPath ~/.claude/.claude.json is real only when CLAUDE_CONFIG_DIR is ~/.claude. The home ~/.claude.json is protected separately (judgment note).

## Open findings to failing tests

Open findings: 1 issue and 1 suspicion. Named failing tests: 1, `JA-replay/applied-deltas-immutable`. The suspicion has a settling probe, not a test.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] JA-replay misses a re-judgment laundered by editing an already-applied delta plus the judgment in one commit (M8: .credentials.json protected to residual, replay PASSED) (#479)
2. [SUSPICION][LOW][code-traced] server.lock and computer-use.lock judged residual by name only; their reader is bytecode-only; IDE lock files, the nearest analogue, are protected
3. [CLEAN][demonstrated] #486 FIXED: mcp-skill-archives protected at both levels, on the named list (234), in shipped rules
4. [CLEAN][demonstrated] JA-replay catches hand edits: baseline pass, M1-M7 all caught; runs in CI (fetch-depth 0, merge commits)
5. [CLEAN][demonstrated] Pending handling safe: applier refuses the committed pending delta; replay catches full or partial hand application and false pending
6. [CLEAN][code-traced] Delta c residuals (daemon.lock, data, logs, stats, paste-cache, scratch) stand; thin-evidence names protected fail-closed (storage-v2, systemd, ...)
7. [CLEAN][demonstrated] 107/107 tests, drift PASS 234, typecheck/lint clean, delta c dry-run NO CHANGE
counts: issues=1 suspicions=1 clean=5
evidence: demonstrated=5 code-traced=2 derived=0
checks=pass 113 (107 tests + drift + typecheck + lint + delta-c dry-run + pending refusal as expected + clone replay baseline) fail 0 skip 0; mutation drill 7/8 caught (the uncaught one is finding 1); installed-live excluded
adr=HIT(38)
report=docs/reviews/s308-463-467-red-team-round3-fixnow-2026-10-06.md
