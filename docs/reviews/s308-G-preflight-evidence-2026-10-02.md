# #308 story G: read-only pre-flight and runbook completeness evidence (2026-10-02)

Raw output of the run recorded by the story-implementer. Nothing was written: `git status --porcelain` and `reg query` are identical before and after. No `reg add` or `reg delete` was run.

## Reading (G3a)

- Central channel is `absent` (registry key not present, `reg query` rc=1 with the not-found message).
- Lands in the "absent is valid" case of `docs/runbooks/policy-load-recovery.md`: central contributes zero rules, load succeeds, `policy:print` rc=0.
- Resolved rule count is 0. Expected before stories E and F. This is the baseline for the owed rerun after E and F.
- Limits: proves the read path and the absent classification on English Windows only. It does not exercise a `present` value (none is provisioned; a session cannot write one).

## Raw output

```text
## before: git status --porcelain
 M docs/.maat-state.json
?? prompt
## before: reg query HKLM\SOFTWARE\Policies\Thoth /v CentralPolicyJson
ERROR: The system was unable to find the specified registry key or value.
rc=1

## command: npm run policy:print

> thoth@0.1.0 policy:print
> node src/policy/config/print-cli.ts

central-channel status=absent
--- resolved rules (0) ---
pin: sha256:3153014795265683fa9c4e4bd5506ceb4e7f159184497f42ab130c535be320b8 channel=(absent) computedAt=2026-10-02T20:32:50.655Z
posture: allow (source: bootstrap; no layer declared a posture)
NOTE: this reflects S6's own resolved policy (loadEffectivePolicy). hooks/pretooluse-kernel-gate.mjs reads the same loader but is not wired into .claude/settings.json (no PreToolUse entry), so nothing is enforced live from this policy today.
rc=0

## after: git status --porcelain
 M docs/.maat-state.json
?? prompt
## after: reg query
ERROR: The system was unable to find the specified registry key or value.
rc=1

## write-call grep over the read path (no code matches expected)
grep-rc=1 (1 = no code match)
```

## Runbook failure-table completeness (G2d), generated

Script reads `LoadFailureReasonKind` and `FailedLayerName` from `src/policy/config/loader.ts` and diffs the cross product against the runbook table row labels (one-shot, scratch script, not committed).

```text
kinds: json-parse-error,schema-invalid,read-error | layers: central,shipped-defaults,project
expected pairs: 9 runbook row labels: 9
missing from runbook: [] extra in runbook: []
rc=0
```
