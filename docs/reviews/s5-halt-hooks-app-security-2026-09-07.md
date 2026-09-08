# App-security review S5 halt-hook diff (Milestone 23, Deny-by-default + hook wiring)

**Reviewer:** Horus (app-security-reviewer)
**Date:** 2026-09-07
**Scope:** scope=s5, tier=CRITICAL (docs/.maat-state.json). Uncommitted working-tree diff to two named CLAUDE.md sensitive-area files:
- hooks/sessionstart-tool-enum.mjs -- KNOWN_CONNECTORS allowlist + real centralLayer MCP classification (replacing the 0.0.0-bootstrap placeholder).
- hooks/userpromptsubmit-halt-relay.mjs -- blockWithMessage() chat-visible error path + try/catch-wrapped writeSync (fix for the EPIPE regression found in docs/reviews/userpromptsubmit-halt-relay-debug-2026-09-07.md).

**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e), CACHE=HIT. Per the ADR cache protocol, read the catalog (not the ADR bodies) for app-security-applicable ADRs (applicableTo covering authn/authz, input handling, secrets, dependencies, data exposure): ADR-0021 (Thoth-native architecture, applicableTo includes security/code/data) is the only catalog entry whose applicableTo and rule text bear directly on these two files (the in-session hook gate, fail-closed-on-ambiguity, no-third-party-unverified-claims). No other software-engineering or devops ADR applicableTo covers hook/session-gate application code.

**ADR compliance:** No violation found.
- The in-session hook gate MUST be implemented only through Claude Code documented PreToolUse, UserPromptSubmit, SessionStart, and SubagentStop primitives; it MUST NOT assume SessionStart alone can halt a session -- the halt point is UserPromptSubmit (gap G5). Confirmed compliant: sessionstart-tool-enum.mjs still calls process.exit(0) unconditionally (line 262, unchanged by this diff) and only ever writes a side-effect file; userpromptsubmit-halt-relay.mjs remains the sole blocking surface. Both files own header comments state this correctly and the code matches.
- No other ADR-0021 rule (kernel purity, Action-record shape, audit-log hash-chaining) is touched by this diff -- these two files sit outside the kernel/Action-record/audit-log surfaces ADR-0021 otherwise governs.

## Findings

### 1. [ISSUE][HIGH] KNOWN_CONNECTORS is a display-name string allowlist with no binding to a verified identity -- a newly-added, attacker/user-named connector can spoof its way past the SUR-03-unclassified-connector halt

**Evidence (code-traced):** hooks/sessionstart-tool-enum.mjs:77-85 defines KNOWN_CONNECTORS as a flat Set of 7 display-name strings ("claude.ai Gmail", "claude.ai Google Drive", etc). hooks/sessionstart-tool-enum.mjs:236 filters connectorNames (sourced from ~/.claude.json's claudeAiMcpEverConnected array, src/policy/tools/mcp-enumeration.ts:89-99, extractConnectorIdentities) purely by testing membership in KNOWN_CONNECTORS. There is no secondary signal checked -- no connector ID, no OAuth scope, no timestamp ordering, nothing binding the string to which underlying MCP server that name was attached to when it was connected.

claudeAiMcpEverConnected is populated from claude.ai's own Connectors feature. Per claude.com's own documentation (support.claude.com/en/articles/11175166, claude.com/docs/connectors/custom/remote-mcp -- confirmed via WebSearch, not independently re-implemented here), adding a custom connector requires only a user-chosen display Name and a remote MCP server URL -- the Name field is free text, with no evidence of any uniqueness/namespacing enforcement against the built-in first-party names. Anthropic's own review process for custom connectors covers header names sent to the third-party server, not the display-name string itself.

**Attack sketch:** an operator (voluntarily, or talked into it by a malicious skill/prompt-injection chain that instructs "add this connector for X to work") adds a custom connector, names it exactly "claude.ai Gmail", and points it at an arbitrary attacker-controlled remote MCP server. On the next session start, extractConnectorIdentities returns "claude.ai Gmail" (now referring to the attacker's server, not the real Gmail integration), KNOWN_CONNECTORS matches it, the name is filtered out, and SUR-03-unclassified-connector never fires -- the exact halt this story exists to guarantee is silently skipped for a genuinely new, unreviewed, attacker-controlled tool surface.

This also falsifies the code's own stated safety belief. The comment (hooks/sessionstart-tool-enum.mjs:73-76) asserts "a newly connected one still halts... until this list is updated again by hand" -- that is only true if the new connector's name is distinct from the 7 listed strings. Nothing in the code or the underlying claude.ai product enforces that distinctness; the mental model the allowlist rests on does not hold against a connector the user (or an attacker who can influence the user) names deliberately.

**Minimal fix:** do not exempt any connector identity from the halt by name match at all -- a connector identity is explicitly documented (mcp-enumeration.ts:61-88) as having "no tool-schema mapping possible," i.e. this hook has no way to verify what a connector actually is today. Given that, the fail-closed-consistent behavior is to always halt on any connector presence (as the code did before this diff) and defer any exemption mechanism to S6/T5's real central-override loader, the same way centralLayer's MCP classification is explicitly deferred. If an interim allowlist is operationally necessary, key it to something a session/account cannot freely rename (e.g. gate on the count of connectors staying unchanged from a pinned baseline snapshot recorded outside ~/.claude.json), or drop the allowlist and accept the halt as a one-time per-list-update cost -- a display-name string alone is not a security boundary.

**Exposure:** security/access-control finding -- exempt from PRINCIPLES rule 21's narrow-blast-radius cap regardless of stated percentage. Basis: code-traced (the trust defect is visible directly in the shipped code) plus derived (external corroboration that claude.ai's custom-connector Name field is free text) -- the code-traced portion alone is sufficient to block per PRINCIPLES rule 19.

### 2. [CLEAN] EPIPE fail-closed regression is genuinely fixed -- demonstrated

**Evidence (demonstrated):** grep-confirmed (not hand-counted) that all four writeSync call sites in the current file are each wrapped in their own try/catch (hooks/userpromptsubmit-halt-relay.mjs:121-130 in blockWithMessage, and :199-208 in the top-level main().catch() handler) -- the exact minimal fix the debug report (docs/reviews/userpromptsubmit-halt-relay-debug-2026-09-07.md section 6.1) recommended.

Reproduced the debugger own broken-pipe methodology directly against the current file (destroying the parent read end of the child stdout pipe about 5ms after spawn, mirroring a host that stops reading the hook stdout):

REPRO OUTPUT (anyReasonSet branch, 3 runs):
thoth halt: session appsec-repro-1 blocked -- SUR-03-unclassified-tool: unclassified: github
EXIT CODE: 2 SIGNAL: null
(repeated identically 2 more times, 3/3 exit 2)

REPRO OUTPUT (malformed halt-state branch, 1 run):
thoth halt: session appsec-repro-2 blocked -- its halt-state file is malformed or wrong-shaped, failing closed until it is fixed or removed
EXIT CODE: 2 SIGNAL: null

Exit code stays 2 in every run (4/4) under the exact adversarial condition that previously caused the fail-open regression (exit 1 / uncaught crash, per the debug report section 4). No uncaught exception, no stack trace leaked to the reader. The fix genuinely restores fail-closed semantics on every path the debugger flagged.

### 3. [CLEAN] Session isolation unaffected by this diff

**Evidence (code-traced):** haltStatePath(sessionId) (hooks/userpromptsubmit-halt-relay.mjs:69-71) is unchanged by this diff and still scopes strictly to input.session_id from the hook own stdin payload -- a value supplied by the Claude Code host process, not by chat-text/prompt content. Cross-session reads are not possible through this code path. Additionally: UserPromptSubmit fires before the prompt (and any tool call the model might make in response to it) is processed, so a session cannot use its own first turn tool calls to tamper with its own halt-state file before that same turn halt check has already run -- the sequencing itself closes the self-tamper-before-first-check loophole. Both properties predate this diff and are unmodified by it.

### 4. [CLEAN] No sensitive-data leak via blockWithMessage chat-visible message

**Evidence (code-traced):** every detail string that reaches describeActiveReasons()/blockWithMessage() is populated upstream only from sessionstart-tool-enum.mjs three writeHaltReason() call sites: tool names (unclassified list), connector display names, and a generic exception message. src/policy/tools/mcp-enumeration.ts own header (OPS-02) and code (lines 42-99) confirm the extraction functions never read/return env/args/command fields of any declared server object -- only Object.keys(mcpServers) and claudeAiMcpEverConnected bare string values. Nothing credential-shaped can reach the chat-visible message through this path. Minor, non-blocking: the enumeration-failed path err message could echo a local filesystem path in a parse error; not credential material, not worth gating on.

### 5. [CLEAN] No new dependencies / supply-chain surface

**Evidence (code-traced):** hooks/userpromptsubmit-halt-relay.mjs only new import is writeSync from the existing node:fs built-in (line 50). hooks/sessionstart-tool-enum.mjs adds no new imports at all -- KNOWN_CONNECTORS/centralLayer are inline data structures. No package.json/lockfile changes in this diff. Nothing to vet.

### Observation (not a new finding -- pre-existing, already-disclosed, out of this diff blast radius)

centralLayer's new 6-entry classification (hooks/sessionstart-tool-enum.mjs:198-208) matches MCP server names by string only, same as the pre-existing classification-catalog design (src/policy/tools/classification.ts:63-81, evaluateToolInventory). This inherits SUR-05 (verifying gate matchers against the runtime actual tool names), a gap the project own S3 scope note explicitly named and deferred (src/policy/tools/classification.ts:22-23), already tracked in prior review reports. This diff does not worsen that gap -- it exercises it with real data instead of an empty placeholder -- so it is noted for completeness, not filed as a new finding. It differs materially from Finding 1: classification here does not skip a halt, it only assigns a class to a tool that would otherwise itself already be gated by the (currently un-built) PreToolUse enforcement layer, whereas KNOWN_CONNECTORS actively suppresses the one halt reason this story ships to guarantee.

### Editorial (non-blocking, prose only)

blockWithMessage own docstring (hooks/userpromptsubmit-halt-relay.mjs:97-98) and the top-level .catch() handler inline comment (:184-185) both still claim a third write destination, hookSpecificOutput.permissionDecisionReason, that the actual jsonPayload object never includes (it only ever sets hookEventName + systemMessage). Already flagged as cosmetic by the debug report (section 6 item 3); repeating here only because it is still present post-fix. No re-review needed -- plain text edit.

## Verdict: REWORK

Finding 1 is HIGH severity, evidence-tier code-traced (with derived corroboration), a genuine access-control bypass on a named CRITICAL-tier sensitive-area file (CLAUDE.md "Policy enforcement / session gates" + "Halt-state directory"), and security findings are exempt from PRINCIPLES rule 21 exposure cap -- it blocks regardless of stated blast-radius percentage. Findings 2-5 are clean, two with demonstrated evidence. The blockWithMessage/EPIPE fix from the prior debug report is confirmed genuinely resolved and does not need further rework.

**Single next action:** story-implementer removes (or replaces with a non-spoofable mechanism) the KNOWN_CONNECTORS string-match exemption in hooks/sessionstart-tool-enum.mjs, re-confirms the existing hook test suites still pass, and this file re-enters review for a fast re-confirm pass (Finding 1 only -- Findings 2-5 do not need re-litigation).

---

RECEIPT: verdict=REWORK
findings (ranked by exploitability x impact):
1. [ISSUE][HIGH][code-traced] hooks/sessionstart-tool-enum.mjs:77-85,236 -- KNOWN_CONNECTORS string-match allowlist exempts a connector identity from the SUR-03-unclassified-connector halt with no binding to a verified identity; claude.ai own custom-connector flow lets a user/attacker freely name a new connector identically to an allowlisted one, silently bypassing the halt for a genuinely new, unreviewed MCP surface. Fix: drop the name-match exemption (always halt on any connector presence) until a non-spoofable mechanism exists.
2. [CLEAN][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:108-132,178-210 -- EPIPE fail-closed regression from the prior debug report is genuinely fixed; all 4 writeSync call sites individually try/catch-guarded (grep-verified), exit code 2 preserved 4/4 under reproduced broken-pipe conditions.
3. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs:69-71 -- session isolation (session_id scoping, host-supplied not prompt-supplied) unaffected by this diff; UserPromptSubmit-before-tool-execution sequencing closes the self-tamper-before-first-check loophole.
4. [CLEAN][code-traced] hooks/sessionstart-tool-enum.mjs (writeHaltReason call sites) + src/policy/tools/mcp-enumeration.ts:42-99 -- no credential/secret material reaches blockWithMessage chat-visible output; only tool/connector names and generic exception text, per OPS-02 own names-only design.
5. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs:50, hooks/sessionstart-tool-enum.mjs -- no new dependencies introduced; only node:fs built-in additions.
counts: issues=1 suspicions=0 clean=4
evidence: demonstrated=1 code-traced=4 derived=0
checks="4/0/0|n/a"
adr=HIT(35)
report=docs/reviews/s5-halt-hooks-app-security-2026-09-07.md
