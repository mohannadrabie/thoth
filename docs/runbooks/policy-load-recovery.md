# Runbook: policy load recovery

Out-of-session repair for a policy that fails to load or loads wrong. Covers the central channel, shipped-defaults and project layers. Issue #308 (AP-9, X-10, X-12, #309).

## Who this is for

- An operator with an elevated shell, working outside any gated Claude Code session.
- A gated session cannot repair its own policy. It must not try (see "What a session must not do").

> Activation status: the kernel gate hook is not wired into `.claude/settings.json` yet (stories J and K wire it). Until then `npm run policy:print` is the only consumer of the load path. The deny behavior below applies once the gate is wired.

## Symptom

- Every gated call is denied with category `policy-load-failure`.
- The deny text reads `policy load failed: layer <failedLayer>, kind <reasonKind>; fail-closed. Unlock: <fix for that layer>` and names no rule.
- The text is built at one site (`src/policy/gate/decide-tool-call.ts`, `refuse()`); the unlock clause comes from a closed table (`src/policy/gate/unlock-text.ts`). A layer or kind outside the known set prints as `unknown` with the generic line (`Unlock: retry the call; ...`).
- The clause by layer: `project` and `shipped-defaults` say a human must correct that policy file through a reviewed change; `central` says the central policy owner must correct it outside this session.
- Look the pair up in the failure table below to find the repair owner.
- A different symptom, stderr `internal exception, fail-closed (exit 2)` on `mcp__` calls only, is the catalog row at the end of the table.

## Diagnose (read-only, safe in or out of session)

- Run `npm run policy:print` from the repo root.
- It calls the same `loadEffectivePolicy` the gate hook calls. It writes nothing.
- A load failure prints the layer and kind. A success prints `central-channel status=...`, the resolved rule count, a pin line and the posture line.
- Optional: `reg query HKLM\SOFTWARE\Policies\Thoth /v CentralPolicyJson` shows the raw central value.

## Failure table

One row per `reasonKind` by `failedLayer` pair. The row labels are checked against the unions in `src/policy/config/loader.ts` by a script (see the evidence file in `docs/reviews/`).

| Pair (kind x layer) | Cause | Repair owner | Repair |
|---|---|---|---|
| `json-parse-error` x `central` | `CentralPolicyJson` value is not valid JSON | Central policy owner | Write a corrected value (see "Central repair"). Removal only with a recorded owner decision. |
| `schema-invalid` x `central` | Valid JSON, wrong shape, or a rule the load checks reject (for example an allow rule reachable by a shell redirect, Issues #338 and #340) | Central policy owner | Write a corrected value. Removal only with a recorded owner decision. `npm run policy:print` prints the loader message, which carries an `Unlock:` clause naming the fix (`src/policy/config/rule-reachability.ts`). The gate deny text carries only the layer-level clause (`the central policy owner must correct the central policy outside this session`), not that loader message. |
| `read-error` x `central` | `reg.exe` could not be run, or the read failed with an unclassified error. Includes the half-provisioned key on a non-English host (see below). | Central policy owner | Fix the host or key state and write the value. Removing the key only with a recorded owner decision. |
| `json-parse-error` x `shipped-defaults` | `src/policy/config/shipped-defaults.json` is not valid JSON | Repo maintainer | Reviewed PR that fixes the file. |
| `schema-invalid` x `shipped-defaults` | File parses, fails the rule schema or load checks | Repo maintainer | Reviewed PR. The message names the file. |
| `read-error` x `shipped-defaults` | File missing or unreadable | Repo maintainer | Restore the file from git (reviewed PR if the content changes). |
| `json-parse-error` x `project` | `.thoth/policy.json` is not valid JSON | Repo maintainer | Reviewed PR that fixes the file. |
| `schema-invalid` x `project` | File parses, fails the rule schema or load checks | Repo maintainer | Reviewed PR. The message names the file. |
| `read-error` x `project` | `.thoth/policy.json` missing or unreadable | Repo maintainer | Restore the file from git. |
| Catalog or classification-fixture failure (not a loader pair) | `docs/qa/s5-central-classification.json` is malformed, or an entry lowers a built-in tool's class. Raised by `assembleCatalog`, which `needsCatalog` routes call for `mcp__` names only | Repo maintainer | Reviewed PR to the classification fixture. |

Catalog row notes:

- Symptom: stderr `pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help. Error type: ClassificationCatalogError`. Exit code 2.
- Any other internal failure keeps the generic line (`Unlock: retry the call; if it fails again a human must repair the gate hook ...`) with its own error type.
- Every `mcp__` call is denied. `Bash` is unaffected: its route has `needsCatalog: false` (`src/policy/gate/tool-routing.ts`), so the catalog is never loaded for it.

## Central repair

> Human only. Elevated shell. Outside any Claude Code session. A session never runs these.

- Channel: registry key `HKLM\SOFTWARE\Policies\Thoth`, value `CentralPolicyJson`, type `REG_SZ`.
- The value is the whole policy as single-line minified JSON.
- An absent key or value is valid: central contributes zero rules and the load succeeds.
- Do not loosen the key's ACL (for example, do not grant Users or Authenticated Users write) to get around an access-denied. The key stays writable by administrators only.

Write a corrected value. Preferred repair. Keep the intended policy in a file outside the repo or in a location the owner controls; do not paste secrets.

PowerShell form (preferred: no cmd escaping, JSON read from a file):

```powershell
# human, elevated, out of session
# <OWNER_CONTROLLED_DIR> = an absolute path only the owner can write, outside the repo and outside any user-writable temp folder
$policyFile = '<OWNER_CONTROLLED_DIR>\central-policy.min.json'
$json = (Get-Content -Raw -Path $policyFile).Trim()
if (-not (Test-Path 'HKLM:\SOFTWARE\Policies\Thoth')) { New-Item -Path 'HKLM:\SOFTWARE\Policies\Thoth' -Force | Out-Null }
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Thoth' -Name CentralPolicyJson -Type String -Value $json
# read back and compare byte for byte against the intended JSON
$stored = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Thoth').CentralPolicyJson
if ($stored -ceq $json) { 'MATCH' } else { 'MISMATCH: do not leave this value in place'; Compare-Object $json $stored }
# only after MATCH: delete the policy file so no stale copy stays on disk
# Remove-Item -LiteralPath $policyFile
```

- Delete `$policyFile` after the read-back prints `MATCH`. Keep it if the output is `MISMATCH`.

`reg add` form (fragile; use only if PowerShell is unavailable). Escape each `"` in the JSON as `\"`. In a `.bat` file double each `%` (`%%`). Interactive `cmd` leaves an undefined `%NAME%` alone, but a `&`, `|`, `<` or `>` after an escaped quote can be read by `cmd` as an operator. Example for `{"version":1,"rules":[]}`:

```bat
:: human, elevated, out of session
reg add "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson /t REG_SZ /d "{\"version\":1,\"rules\":[]}" /f
:: read back, then compare the output by eye or with a diff tool against the intended JSON
reg query "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson
```

- A mismatch after either form is a failed repair. Rewrite before leaving the machine.
- A value that matches but is the wrong policy is the X-12 case (next sections).

Remove the value only with a recorded owner decision:

> Removing `CentralPolicyJson` drops ALL central rules. The load succeeds with zero central rules and every session on the machine falls back to shipped-defaults, project rules and the bootstrap posture (`posture: allow (source: bootstrap)` in the pre-flight evidence). That is a fail-open for the whole machine, not an equal repair. Record who decided, why, and when; restore the owner's policy afterwards.

```bat
:: human, elevated, out of session, recorded owner decision required
reg delete "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson /f
```

Remove the whole key (also clears a half-provisioned key). Same consequence and same recorded-decision requirement as removing the value:

```bat
:: human, elevated, out of session
reg delete "HKLM\SOFTWARE\Policies\Thoth" /f
```

## Verify the repair

- Run `npm run policy:print` from the repo root.
- Expect exit code 0 and `central-channel status=absent` (value removed) or `central-channel status=present` (value written).
- Expect a `pin:` line and a `posture:` line.
- Check the `resolved rules` count is what you intended. A repaired value that loads is not a verified value (next section).

## Schema-valid central typo (X-12)

- A central rule that is schema-valid loads. No deny names a load failure.
- A typo that never matches leaves the intended action allowed.
- A typo that matches too much denies actions it should not.
- Blast radius is every session on the machine that reads this central value.
- A session cannot repair it. The central policy owner writes the corrected value (same commands as "Central repair").
- Detection: compare the `resolved rules` count and rule content from `npm run policy:print` against the intended policy, and review the value before and after each write.
- The load checks reject some unreachable or over-wide shapes (`checkRuleReachability`, Issue #333). They do not catch every typo.

## Half-provisioned key on a non-English host (X-1, Issue #309)

- State: key `HKLM\SOFTWARE\Policies\Thoth` exists, value `CentralPolicyJson` does not.
- English-language Windows: the read resolves to absent. Load succeeds.
- Non-English Windows: the read rethrows the original error. Load fails as `read-error` x `central`. Every gated call is denied.
- Pinned by test C12 in `src/policy/config/central-source.test.ts`.
- Repair: write the value (preferred), or delete the key with a recorded owner decision (see "Central repair" for the consequence).
- Activation is accepted for English hosts only (human ruling, plan Q5).

## Project and shipped-defaults failures

- Not a registry action. Edit the file through a reviewed PR.
- Files: `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`.
- Tool classification data (`docs/qa/s5-central-classification.json`) also changes by reviewed PR only.
- A gated session cannot edit these while the gate is failing closed. The operator edits outside the session, or restores from git.

## What a session must not do

- Do not run `reg add` or `reg delete` against `HKLM\SOFTWARE\Policies\Thoth`. In the one session measured, the tool-permission classifier refused the write and the process token was UAC-filtered (see the header of `src/policy/config/central-source.ts`). That is one session's configuration, not a guarantee. The rule stands regardless: a session does not run these.
- Do not edit the policy files to clear a deny while the gate is failing closed. That is the operator's repair.
- Do not loosen the key ACL to make a write succeed.
- Do not retry in a loop. A load failure is deterministic until the source changes.
