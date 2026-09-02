// In-memory ActionRecord fixtures (S2 scope: pure fixtures only, no config-file I/O — see
// docs/decisions.md's 2026-09-01 S2 row). Used by src/policy/kernel/kernel.test.ts and any later
// story's tests that need realistic sample Action records before a real normalizer (ADR-0021
// shape 3) exists.
import type { ActionRecord } from "../kernel/action-record.ts";

/** A clean, fully-resolved mutating action — POL-05 does not fire. */
export const mutatingCleanAction: ActionRecord = {
  source: "structured",
  verbs: ["write"],
  targets: ["/repo/README.md"],
  environment: "dev",
  identity: "agent:story-implementer",
  deferred: false,
  unresolved: [],
};

/** POL-05 negative case: a mutating action whose source could not be classified. */
export const mutatingOpaqueAction: ActionRecord = {
  source: "opaque",
  verbs: ["delete"],
  targets: ["prod/database"],
  environment: "prod",
  identity: "agent:unknown",
  deferred: false,
  unresolved: [],
};

/** POL-05 negative case: a mutating action with an unresolved field. */
export const mutatingUnresolvedAction: ActionRecord = {
  source: "parsed",
  verbs: ["execute"],
  targets: ["prod/deploy.sh"],
  environment: "prod",
  identity: "agent:build",
  deferred: false,
  unresolved: ["targets[0].flags"],
};

/** A non-mutating action with an opaque source — POL-05 governs MUTATING actions only, so this
 * does not fire (kernel.test.ts asserts this explicitly, to prove the scope boundary is real). */
export const nonMutatingOpaqueAction: ActionRecord = {
  source: "opaque",
  verbs: ["read"],
  targets: ["/repo/README.md"],
  environment: "dev",
  identity: "agent:unknown",
  deferred: false,
  unresolved: [],
};

/** SUR-09 case: identical to mutatingOpaqueAction except `deferred: true` — must be denied the
 * same way, proving deferred execution is evaluated as execution, not a lesser class. */
export const deferredMutatingOpaqueAction: ActionRecord = {
  ...mutatingOpaqueAction,
  deferred: true,
};

/** SUR-09 case: identical to mutatingCleanAction except `deferred: true` — a deferred action with
 * no POL-05 violation still reaches ordinary rule matching, it is not auto-allowed or auto-denied
 * merely for being deferred. */
export const deferredMutatingCleanAction: ActionRecord = {
  ...mutatingCleanAction,
  deferred: true,
};
