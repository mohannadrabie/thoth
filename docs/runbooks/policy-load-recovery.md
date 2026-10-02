# Runbook: policy load recovery

Out-of-session repair for a policy that fails to load or loads wrong. Covers the central channel, shipped-defaults and project layers. Issue #308 (AP-9, X-10, X-12, #309).

## Who this is for

- An operator with an elevated shell, working outside any gated Claude Code session.
- A gated session cannot repair its own policy. It must not try (see "What a session must not do").

## Symptom

- Every gated call is denied with category `policy-load-failure`.
- The deny text reads `policy load failed: layer <failedLayer>, kind <reasonKind>; fail-closed` and names no rule.
- Look the pair up in the failure table below to find the repair owner.

## Diagnose (read-only, safe in or out of session)

- Run `npm run policy:print` from the repo root.
- It calls the same `loadEffectivePolicy` the gate hook calls. It writes nothing.
- A load failure prints the layer and kind. A success prints `central-channel status=...`, the resolved rule count, a pin line and the posture line.
- Optional: `reg query HKLM\SOFTWARE\Policies\Thoth /v CentralPolicyJson` shows the raw central value.

## Failure table

One row per `reasonKind` by `failedLayer` pair. The row labels are checked against the unions in `src/policy/config/loader.ts` by a script (see the evidence file in `docs/reviews/`).

| Pair (kind x layer) | Cause | Repair owner | Repair |
|---|---|---|---|
| `json-parse-error` x `central` | `CentralPolicyJson` value is not valid JSON | Central policy owner | Write a corrected value, or remove it. |
| `schema-invalid` x `central` | Valid JSON, wrong shape, or a rule the load checks reject (for example an allow rule reachable by a shell redirect, Issues #338 and #340) | Central policy owner | Write a corrected value, or remove it. The deny text carries an `Unlock:` clause naming the fix. |
| `read-error` x `central` | `reg.exe` could not be run, or the read failed with an unclassified error. Includes the half-provisioned key on a non-English host (see below). | Central policy owner | Fix the host or key state, write the value, or remove the key. |
| `json-parse-error` x `shipped-defaults` | `src/policy/config/shipped-defaults.json` is not valid JSON | Repo maintainer | Reviewed PR that fixes the file. |
| `schema-invalid` x `shipped-defaults` | File parses, fails the rule schema or load checks | Repo maintainer | Reviewed PR. The message names the file. |
| `read-error` x `shipped-defaults` | File missing or unreadable | Repo maintainer | Restore the file from git (reviewed PR if the content changes). |
| `json-parse-error` x `project` | `.thoth/policy.json` is not valid JSON | Repo maintainer | Reviewed PR that fixes the file. |
| `schema-invalid` x `project` | File parses, fails the rule schema or load checks | Repo maintainer | Reviewed PR. The message names the file. |
| `read-error` x `project` | `.thoth/policy.json` missing or unreadable | Repo maintainer | Restore the file from git. |

## Central repair

> Human only. Elevated shell. Outside any Claude Code session. A session never runs these.

- Channel: registry key `HKLM\SOFTWARE\Policies\Thoth`, value `CentralPolicyJson`, type `REG_SZ`.
- The value is the whole policy as single-line minified JSON.
- An absent key or value is valid: central contributes zero rules and the load succeeds.

Write a corrected value (placeholder, substitute the real minified policy JSON; do not paste secrets):

```bat
:: human, elevated, out of session
reg add "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson /t REG_SZ /d "<minified-policy-json>" /f
```

Remove the value (policy returns to absent):

```bat
:: human, elevated, out of session
reg delete "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson /f
```

Remove the whole key (also clears a half-provisioned key):

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
- Repair: write the value, or delete the key (see "Central repair").
- Activation is accepted for English hosts only (human ruling, plan Q5).

## Project and shipped-defaults failures

- Not a registry action. Edit the file through a reviewed PR.
- Files: `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`.
- Tool classification data (`docs/qa/s5-central-classification.json`) also changes by reviewed PR only.
- A gated session cannot edit these while the gate is failing closed. The operator edits outside the session, or restores from git.

## What a session must not do

- Do not run `reg add` or `reg delete` against `HKLM\SOFTWARE\Policies\Thoth`. The shell classifier and the OS ACL refuse it (see the header of `src/policy/config/central-source.ts`).
- Do not edit the policy files to clear a deny while the gate is failing closed. That is the operator's repair.
- Do not retry in a loop. A load failure is deterministic until the source changes.
