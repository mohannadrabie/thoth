# #308 story E0 app-security re-confirm of #436 (Horus) - 2026-10-05

[app-security-reviewer] Narrow re-confirm. Delta `git diff 78cee9d 6b0384f`; probed in my own detached worktree at 6b0384f (node_modules junction; worktree deregistered, empty dir left behind by a busy handle). ADR cache HIT (38); no applicable security ADR violated.

## Verdict: APPROVE
#436 is fixed. Fix is one clause in `isBarePath` (readonly-catalog.ts: `&& !t.value.startsWith("//")`); an operand that fails it is unresolved, so POL-05 denies.

## Evidence: real hook `node hooks/pretooluse-kernel-gate.mjs`, PreToolUse/Bash JSON, 38 commands, 0 errors (exit 0 each)
DENY (all 23 UNC shapes): `cat //h/s/x`, `ls //h/s`, `grep -r p //h/s`, `head|tail|wc //h/s/x`, `head|tail -n 5 //h/s/x`, `wc -l //h/s/x`, `cat ///h/s`, `ls ///h/s`, `cat //h`, `ls //`, `cat /\h/s`, `cat \h\s\x`, `cat '//h/s/x'`, `cat "//h/s/x"`, `cat /\/h/s`, `cat \/\/h/s/x`, `ls -la //h/s`, `grep -rn foo //h/s`, `grep foo //h/s/x`, `grep -r p ///h`. Backslash forms were already outside BARE_WORD; quoted forms fail raw==value.
ALLOW (silent), no regression: `cat .//x`, `cat a//b`, `cat ./a//b`, `cat /a//b`, `cat /etc/hosts` (single leading slash stays ordinary; the out-of-repo read is #435, unchanged), `cat README.md`, `ls`, `ls -la`, `ls src/`, `grep -rn foo src`, `grep -r p src/policy`, `head -n 5 README.md`, `wc -l README.md`, `tail README.md`, `cat src/a/b.ts`.
Still DENY as designed: `git status`.
Header edit in `hooks/pretooluse-kernel-gate.mjs`: diff is 2 lines, both `//` comment lines (4 changed lines incl. replacement); no code change.

## Findings
1. [CLEAN][demonstrated] #436 UNC operand now unresolved across all shapes above.
2. [CLEAN][demonstrated] No ordinary-read regression; mid-path `//` still allowed.
3. [CLEAN][code-traced] Hook header change comment-only.

Open findings: 0. Failing tests: 0. Residual (not new): #435 read-deny scope and #437 recursive roots remain K preconditions.
Next action: merge; the Fixes line closes #436.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][demonstrated] 20+ UNC shapes (//, ///, //h, //, /\, \, quoted, mixed) via real hook all deny
2. [CLEAN][demonstrated] cat .//x, a//b, /a//b, README.md, ls -la, grep -rn foo src still allowed; git status still denied
3. [CLEAN][code-traced] hook header edit is 2 comment lines only
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=2 code-traced=1 derived=0
checks="38/0/0 (real-hook probe commands; unit suites not re-run, running in shared dir)"
adr=HIT(38)
report=docs/reviews/s308-E0-app-security-reconfirm-2026-10-05.md
