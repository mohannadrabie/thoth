# #308 story C (inventory re-vendor) — app-security review (Horus)

Tier STANDARD (ratified). Reviewed commit: 92a891d (range 4459b0c^..92a891d). ADR cache: HIT (37 ADRs); no ADR security standard violated.
Checks run in a detached worktree at 92a891d (since removed): `node --test` on arbitrary-exec-classification, vendor-tool-inventory, shared-inventory-agreement, connector-labels, builtin-tool-inventory, tool-class tests -> tests 57 / pass 57 / fail 0 / skipped 0.

Verdict: APPROVE (no blockers).

## Findings
1. [CLEAN][code-traced] Classes (builtin-tool-inventory.ts CLASSIFICATION): every exec/write/network/schedule/spawn tool is workspace-mutating or remote-mutating; only ToolSearch, ListAgents, CronList, TaskOutput, ListMcpResources*/ReadMcpResource* are read-only, and those are list/read. DesignSync and ReportFindings (name-only) are remote-mutating, the conservative bucket. Built-in class drives no enforcement decision today (file header), so even a misclass is non-gating.
2. [CLEAN][code-traced] Committed capture src/qa/fixtures/claude-init-2.1.267.json is 771 bytes: type, subtype, date, platform, version, permissionMode, 33 built-in names. No cwd, session/uuid, email, org id, apiKeySource, mcp_ names, model. scrubInitEvent is an allowlist (constructs a new object); test covers it.
3. [CLEAN][demonstrated] AP-12 rewrite and N4 replacement are strengthenings (absent-allowed -> present-and-not-read-only, plus seeded mutants for each named tool in builtin, central and merge paths; unknown-name-throws kept). Not a SE ADR-0005 weakening. Tests pass 57/0.
4. [CLEAN][code-traced] Inadmissible fixture names ("claude.ai Gmail" etc., contain space/dot) cannot match a runtime name: runtime MCP names start mcp__ and are sanitized to [A-Za-z0-9_-] (tool-class-format.ts sanitizeMcpName); server index admits only /^[A-Za-z0-9-]+$/, so those entries are rejected from the index; no built-in has such a name. Inert as the decisions row states (#381).
5. [CLEAN][code-traced] Instrument: merge is union (tools = measured U previous), so a capture that drops tools cannot shrink the inventory; an injected/unknown name throws at buildBuiltinToolClassificationLayer ("no CLASSIFICATION entry"), so nothing is classified by default. Not in CI (no ci.yml invocation of vendor-tool-inventory; CI runs only the test over the committed capture). It spawns `claude` with a fixed argv from a temp cwd, no user input to the shell.
6. [SUSPICION][LOW][code-traced] src/qa/arbitrary-exec-classification.test.ts ARBITRARY_EXEC omits Monitor (classed workspace-mutating with the comment "so it runs a command"), CronDelete/ScheduleWakeup/EnterWorktree. Tripwire would not flag a later Monitor -> read-only flip. Hardening: add Monitor to ADDED_BUILTINS (tightening only).
7. [SUSPICION][LOW][code-traced] vendor-tool-inventory.ts extractBuiltinNames validates only "string"; no name pattern (e.g. /^[A-Za-z][A-Za-z0-9]*$/). Harmless today (unknown names throw downstream) but a cheap guard against a hostile --from file writing odd strings into the committed JSON.
8. [CLEAN][code-traced] Connector display names (Gmail, Spotify, Google Drive, ...) now also appear in centralLayer notes/entries; they were already in knownConnectors in the same file, so no new disclosure.

## Blockers: none. Hardening: 6, 7 (LOW; no failing test required, residual-register candidates).
Open findings = 0 blocking; failing tests = 0.
Next action: proceed; optionally add Monitor to ARBITRARY_EXEC.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][code-traced] arbitrary-exec-classification.test.ts: ARBITRARY_EXEC omits Monitor (runs a command); add to ADDED_BUILTINS
2. [SUSPICION][LOW][code-traced] vendor-tool-inventory.ts extractBuiltinNames: no name-pattern validation; add identifier regex
3. [CLEAN][code-traced] new built-in classes all >= workspace-mutating for exec/net/schedule/spawn; DesignSync/ReportFindings remote-mutating
4. [CLEAN][code-traced] committed capture scrubbed by allowlist; no identifying data
5. [CLEAN][demonstrated] AP-12 rewrite + N4 replacement are strengthenings; 57/57 pass
6. [CLEAN][code-traced] inadmissible connector names cannot match runtime names (grammar v1 rejects)
7. [CLEAN][code-traced] instrument: union merge, unknown names throw, out of CI
8. [CLEAN][code-traced] connector names in central fixture already in knownConnectors
counts: issues=0 suspicions=2 clean=6
evidence: demonstrated=1 code-traced=7 derived=0
checks="57/0/0"
adr=HIT(37)
report=docs/reviews/s308-C-inventory-app-security-2026-10-02.md
