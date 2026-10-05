[app-security-reviewer]
🛡️ App Security Reviewer (Horus) — reviewing for exploitable weakness

# #308 story D (AP-13 launcher) — app-security review, lane: env handling and injection
Date 2026-10-02 · CRITICAL tier · branch s308/activation-2 · diff 6e5e35a..fd8714c
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]
ADRs: catalog HIT; no security-domain ADR rule violated by the shim, pin check or path check (the probe-row flip under SE ADR-0005 is the cross-domain lane's).

## Verdict: APPROVE
No blocker. Four LOW hardening notes, none reachable by an attacker who does not already control the hook process environment. Shim, pin check and path check do what the plan says, within the limits the plan already names.

## Experiments (raw)
Run in the repo root against hooks/launch-gate.sh, scratch dir removed after; git status unchanged.
1. Hostile path + env + binary stdin (dir `zz tmp$x`id`'q`, `SECRET=hunter2 TEMP=/x`, stdin bytes `a\r\n\0\xff\x80z`):
   `{"env":["CLAUDE_PROJECT_DIR","MSYSTEM","PATH","SYSTEMROOT","WINDIR"],"cpd":"C:/playground/thoth/zz tmp$x`id`'q","len":7,"hex":"610d0a00ff807a"} rc=0`
   Child sees only the allow-list (MSYSTEM is added by MSYS env.exe, harmless); SECRET/TEMP dropped; CLAUDE_PROJECT_DIR round-trips with $ and backtick intact; stdin byte-exact (CR, NUL, high bytes). No expansion, no injection. (`"` cannot occur in a Windows filename.)
2. SYSTEMROOT/SystemRoot pointed at an attacker dir holding an empty System32: shim's `-d` check passes, node child aborts (`Assertion failed: ncrypto::CSPRNG`), `launcher: child exit 134 mapped to 2`, rc=2. Fail-closed.
3. CLAUDE_PROJECT_DIR unset: shim runs, child sees none; rc follows the gate. A POSIX-form `/c/...` path reaching Windows node fails closed (rc=2, MODULE_NOT_FOUND mapped).
4. Target named `-p` (relative, exists): `node "$target"` is parsed as the option, node evaluated stdin as a script, exit 1 mapped to 2.

## Findings (ranked)
1. [LOW][demonstrated] hooks/launch-gate.sh:17 — `node "$target"` has no `--`, so a target beginning with `-` is parsed as a node option (experiment 4). Not reachable: the J command passes an absolute `${CLAUDE_PROJECT_DIR}/hooks/...` path, and a hostile target needs a file named `-x` in cwd. Fix when the pin is next re-cut: `node -- "$target"` (changes the pinned hash, so not worth a round alone).
2. [LOW][code-traced] hooks/launch-gate.sh:11-14 — SystemRoot/windir steering of reg.exe (#397) is only narrowed: the shim checks `$X/System32` exists, not that it is the real Windows directory (src/policy/config/central-source.ts:107-109 builds `${SystemRoot}\System32\reg.exe`). Exposure: an attacker able to set env for the hook already controls PATH/node; experiment 2 shows a decoy root that is not a working Windows tree crashes node, which fails closed. Stays on #397; no new Issue.
3. [LOW][code-traced] src/qa/gate-command-path-check.ts:66-70 — extractScriptPaths takes quoted tokens first and ignores bare ones when any quoted exists (`sh "a.sh" b.mjs` leaves b.mjs unchecked), and it verifies existence only, not that the command is the launcher form wrapping the gate. This is an existence check by design, not a shape validator; shape is story J's concern (a command that drops the launcher still passes this check). Hardening: when J wires the command, add a test asserting the exact string.
4. [LOW][code-traced] hooks/launch-gate.sh:15 — `PATH="$PATH"` passes ambient PATH unfiltered, so `node` resolves from it. Disclosed limit (gate-launcher.test.ts names "PATH node"); ambient-fault scope, not an adversary-in-env scope. An empty PATH or missing /usr/bin/env gives 127, mapped to 2.
5. [CLEAN][demonstrated] Env allow-list is sufficient. Non-test code under hooks/pretooluse-kernel-gate.mjs and src/policy reads only SystemRoot/windir (central-source.ts:107) and CLAUDE_PROJECT_DIR (classification-catalog.ts:55); no os.tmpdir/homedir/TEMP/USERPROFILE use outside tests. The shim passes all four SystemRoot spellings. No missing variable.
6. [CLEAN][demonstrated] Quoting: every expansion in the shim is double-quoted and assignments go through `"$@"` to `env`; J string is double-quoted per argument. Experiment 1.
7. [CLEAN][demonstrated] stdin untouched (inherited), byte-exact. stderr text is fixed strings plus the numeric exit code (lines 8,11-14,18); no env or path values reach the model.
8. [CLEAN][code-traced] Pin check (src/qa/gate-launcher-pin-check.ts:15-26) hashes raw bytes, no normalisation, resolves the file from import.meta.url (cwd-independent), rejects empty. A CRLF checkout changes the hash and fails closed; `.gitattributes` `* text=auto eol=lf` and `git ls-files --eol` (i/lf w/lf) confirm LF. Same-repo pin is disclosed in the file header (guards accident, not intent).
9. [CLEAN][code-traced] Supply chain: package.json diff adds one script line, no dependencies, no lockfile change, no install scripts.

## Blockers vs hardening
Blockers: none. Hardening: findings 1-4, all LOW.

## Editorial
None.

## Next action
Ship story D; when the launcher is next re-pinned add `--` to the node call, and in story J pin the exact command string in a test.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][demonstrated] hooks/launch-gate.sh:17 — `node "$target"` lacks `--`; `-p` target parsed as option; unreachable via J command; add `--` at next re-pin
2. [ISSUE][LOW][code-traced] hooks/launch-gate.sh:11-14 — SystemRoot decoy only narrowed (-d System32), #397 stays open; decoy root crashes node, fails closed
3. [ISSUE][LOW][code-traced] src/qa/gate-command-path-check.ts:66-70 — extractScriptPaths skips bare tokens when any quoted exists; existence-only, no launcher-shape check; pin exact string in J
4. [SUSPICION][LOW][code-traced] hooks/launch-gate.sh:15 — ambient PATH resolves node; disclosed limit, ambient-fault scope
5. [CLEAN][demonstrated] env allow-list sufficient (gate reads only SystemRoot/windir/CLAUDE_PROJECT_DIR)
6. [CLEAN][demonstrated] quoting safe against space/$/backtick/quote paths
7. [CLEAN][demonstrated] stdin byte-exact; stderr fixed strings, no env values
8. [CLEAN][code-traced] pin check raw-byte, cwd-independent, CRLF fails closed, LF enforced
9. [CLEAN][code-traced] no new dependencies
counts: issues=3 suspicions=1 clean=5
evidence: demonstrated=4 code-traced=5 derived=0
checks="4/0/0"
adr=HIT(38)
report=docs/reviews/s308-D-launcher-app-security-2026-10-02.md
