# #428 bare-binary trust check -- app-security review (Horus), 2026-10-05

[app-security-reviewer] Tier CRITICAL. Diff `6b0384f..s7/knockout-428` (worktree C:/playground/thoth-wt428). ADR cache HIT (38); no applicable ADR security standard violated.

## Verdict: APPROVE (two LOW hardening notes, no blockers)

## Findings (ranked)

1. [LOW][code-traced] Trust anchor on Windows is read from env without validation. src/policy/gate/bare-binary-trust.ts buildContext() takes the first of SYSTEMROOT/windir matching `^[A-Za-z]:[\/]` and trusts that directory and its System32 (+3 subfolders). If a hook process ever ran with an attacker-set SYSTEMROOT plus PATH (for example a `env` block in a session-writable settings file, with the hook run without the launcher), a planted dir would be "the Windows folder". Mitigated today: hooks/launch-gate.sh runs `env -i PATH=...` and does NOT forward SYSTEMROOT/windir (MSYS supplies the real value), and settings are K-protected. Fix (optional): also require the anchor to equal the OS-reported root (e.g. a hard-coded `C:\Windows` allowance or a realpath equality check); or keep the launcher the only way to start the gate.
2. [LOW][code-traced] Deny reasons name PATH directories (shadow, no-trusted-hit, unreadable-dir), which can include `C:\Users\<name>\...`/`$HOME/bin`, in model-visible text. Bounded to 200 chars and sanitized by renderHookOutput; the session already knows its own home. Accept; no secret is involved. Never the raw fault text (TRUST_FAULT is fixed).
3. [CLEAN][demonstrated] Fail-closed wiring. decide-tool-call.ts binaryTrustRefusal: names undetermined => deny; port absent => deny; throw => deny with fixed text; answer not exactly `{ok:true}` / `{ok:false,reason:non-empty string}` => deny; runs only on kernel allow (can turn allow to deny, never the reverse; VerdictOutcome is allow|deny only). Hook: `await import(path-trust-check.ts)` is inside the try, so a load failure or a missing `createRealBinaryCheck` exits 2. Tests: `node --test src/policy/gate/*.test.ts src/policy/config/sanitize.test.ts src/policy/config/hook-import-pins.test.ts hooks/pretooluse-kernel-gate-path-trust.test.ts` => tests 248, pass 247, fail 0, skipped 1 (re-run with the per-group count: gate group 186/0/0 -- one suite-level artefact when a directory is passed to node --test, not a failure).
4. [CLEAN][demonstrated] Collector matches the normalizer. Probe over 22 commands via `invokedBareBinaries` (leading assignment => `KUBECONFIG=x` not bare => deny; `env FOO=1 kubectl` => `["env"]` and unresolved; wrappers sh/bash -c/env/eval/exec yield each layer; quoting `'kubectl'`, `k"ubectl"` => `kubectl`; `/usr/bin/kubectl`, `./kubectl` => not-bare deny; pipelines/`;` unresolved). It is the same recursion (shell.ts normalizeAtDepth), so no second parser. Builtins eval/exec/source/. skipped correctly.
5. [CLEAN][code-traced] Adapter reads (path-trust-check.ts:15-38): only PATH, SYSTEMROOT, windir, cwd (payload cwd, harness-supplied), homedir, readdir/realpath.native/lstat. Read-only; no cache (live PATH each call); UNC PATH entries never listed; home unknown => throw => deny. Under the launcher (`env -i PATH="$PATH" CLAUDE_PROJECT_DIR`), a settings env block cannot inject SYSTEMROOT/windir/HOME-derived values beyond PATH, and PATH is exactly what the shell uses. Residuals (TOCTOU, rc-file PATH edits, elevated Program Files writes) are disclosed in the file header and decisions row.
6. [CLEAN][code-traced] Pins not over-loosened. sanitize.test.ts ALLOWED_SPECIFIERS gains exactly one specifier (../src/policy/config/path-trust-check.ts); the Promise.all shape stays pinned. hook-import-pins adds the module as a graph root (so its imports are scanned) and pins node:fs/node:os x1 and the env/cwd sites with counts; the pure core imports no node:*. Method-level read-only-ness of node:fs is not pinned (count-only), but the file is now deny-protected, so a write call needs a reviewed change.
7. [CLEAN][code-traced] Generated deny rules: protect-src-policy-config-path-trust-check-ts and protect-src-policy-gate-bare-binary-trust-ts, same verbs/mandatory form as siblings; K proposal gains the matching two Edit entries. gate-sandbox's allow-all stub lives only in the sandbox copy-tree (pinPathTrust throws if the export shape changes); the real hook path is unchanged.

Exposure: no blocking finding.

Editorial: none.

## Blockers vs hardening
Blockers: none. Hardening: findings 1 and 2 (optional).

## Next action
Merge-handoff for #428 may proceed; optionally track finding 1 as a chore if the hook is ever started without the launcher.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][code-traced] bare-binary-trust.ts buildContext: SYSTEMROOT/windir trust anchor unvalidated; safe under launcher env -i; optional hardening
2. [ISSUE][LOW][code-traced] deny reasons expose PATH dir names (may include home) to the model; bounded and sanitized; accept
3. [CLEAN][demonstrated] fail-closed wiring (absent port, throw, malformed answer, undetermined names, load failure) all deny; 247/0/1
4. [CLEAN][demonstrated] collector names match normalizer recursion over 22 probe commands
5. [CLEAN][code-traced] adapter env/fs reads read-only, live, launcher-scrubbed
6. [CLEAN][code-traced] pins narrowed to one specifier plus counted graph root
7. [CLEAN][code-traced] two generated deny rules and K entries correct; sandbox stub test-only
counts: issues=2 suspicions=0 clean=5
evidence: demonstrated=2 code-traced=5 derived=0
checks="247/0/1"
adr=HIT(38)
report=docs/reviews/s428-app-security-2026-10-05.md
