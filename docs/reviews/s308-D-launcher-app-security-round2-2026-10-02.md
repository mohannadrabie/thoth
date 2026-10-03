[app-security-reviewer]
🛡️ App Security Reviewer (Horus) — reviewing for exploitable weakness

# #308 story D round 2 — env/injection delta re-confirm (git diff 911e518..561227b)
Date 2026-10-02 · CRITICAL · ADR cache HIT (38 ADRs, fp 702b16a) from round 1; no security ADR rule touched by the delta.

## Verdict: APPROVE
The delta is sound. #397 is closed for the launcher path, with one named residual below.

## Evidence (raw, own scratch dir under repo, removed after; git status unchanged)
- Shim now: Windows root vars checked (`-d X/System32`, exit 2 if not) but not forwarded; `env -i PATH=... [CLAUDE_PROJECT_DIR=...] node -- "$target"`. sha256sum of hooks/launch-gate.sh = 6c7525336c7ed11f2ce92840d5d81304bd4fc5fc554d8f4f0ec365744b01b5d5 = PINNED_SHA256 in gate-launcher-pin-check.ts.
- Hostile run (path with $ and backtick, SECRET, TEMP, stdin `a\r\n\0\xff\x80z`): child keys `CLAUDE_PROJECT_DIR, MSYSTEM, PATH, SYSTEMROOT, WINDIR`; `SYSTEMROOT=C:\WINDOWS`, `SystemRoot=C:\WINDOWS` (Windows env is case-insensitive), `WINDIR=C:\WINDOWS`, `windir=C:\WINDOWS`; stdin hex `610d0a00ff807a` exact; CLAUDE_PROJECT_DIR intact; SECRET/TEMP absent; rc=0.
- Decoy: parent SYSTEMROOT/SystemRoot/WINDIR/windir all set to a dir containing an empty System32 -> child still sees `C:\WINDOWS` for all four, rc=0. Steering of central-source.ts:107-109 (`env.SystemRoot || env.windir`) is closed: the value comes from the MSYS runtime, not the parent.
- Decoy with no System32 -> `launcher: SystemRoot does not name a Windows directory`, rc=2 (backstop works, fail-closed).
- Dash target (`./-p`, passed as `-p`): `node --` treats it as a file, no stdin-eval; rc=0. My round-1 LOW 1 is closed.
- Caveat: in this sandbox `fs.existsSync("C:\WINDOWS\System32\reg.exe")` returns false for every binary (true with forward slashes), also in plain node outside the shim, so I could not demonstrate reg.exe resolution from the child; the value it would use is the correct real root. Command that settles it on a normal host: run a child under the shim printing `existsSync(process.env.SystemRoot + "\System32\reg.exe")` (D2-systemroot-from-runtime covers the value).

## Findings
1. [CLEAN][demonstrated] #397 closed for the launcher path: child SystemRoot/windir are runtime-supplied, decoy parent value ignored.
2. [CLEAN][demonstrated] Allow-list still sufficient; stdin byte-exact; quoting safe; stderr fixed strings.
3. [CLEAN][demonstrated] Round-1 LOW 1 (`--`) fixed; pin matches the new bytes.
4. [SUSPICION][LOW][code-traced] hooks/launch-gate.sh:9-12 — correctness now depends on the MSYS runtime synthesizing SystemRoot for a native child under `env -i`; true on Git Bash tested here, not guaranteed for other `sh` (WSL, busybox). Failure mode is node abort, mapped to 2 (fail-closed). Residual round-1 LOW 3 (path-check shape) and LOW 4 (ambient PATH) unchanged and not worsened.

Next action: ship; settle the reg.exe existence check on a normal host if wanted.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][code-traced] hooks/launch-gate.sh:9-12 — SystemRoot correctness depends on MSYS runtime supplying it to the native child; other sh fail closed (node abort -> 2)
2. [CLEAN][demonstrated] #397 closed on launcher path: decoy parent SystemRoot/windir ignored, child sees C:\WINDOWS
3. [CLEAN][demonstrated] allow-list, stdin byte-exact, quoting, stderr unchanged and sound
4. [CLEAN][demonstrated] `node --` fixes round-1 LOW 1; pin equals sha256 of shim
counts: issues=0 suspicions=1 clean=3
evidence: demonstrated=3 code-traced=1 derived=0
checks="4/0/0"
adr=HIT(38)
report=docs/reviews/s308-D-launcher-app-security-round2-2026-10-02.md
