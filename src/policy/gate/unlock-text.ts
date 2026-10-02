// Story H (#308 X-11, PRINCIPLES rule 2: a block names its unlock): the CLOSED table that maps a gate failure
// to the fixed text naming its real unlock. Pure: no imports, no node:*, nothing from config/ (G15). Both
// consumers (decide-tool-call.ts for a policy-load refusal, the hook through render-hook-output.ts for a
// catalog failure) read this one module, so there is exactly one table.
//
// CLOSED: a key outside the table (a layer, a kind or an error name this module does not list) never selects
// text and is never reflected; it maps to GENERIC_UNLOCK (and prints as `unknown` where a name is shown).
// Every string is fixed ASCII with no path, stack, parser text, entry name or classification class name: the
// stderr channel and the deny reason are both model-visible.

/** The line the hook prints when it knows nothing more. It is duplicated byte for byte as the hook's own
 * `UNLOCK` literal (the hook must print it with no module loaded); a test asserts the two are equal. */
export const GENERIC_UNLOCK = "Unlock: retry the call; if it fails again a human must repair the gate hook (it needs Node 22.18 or newer and an intact checkout).";

/** The error name the hook's `loadCatalog` port throws for ANY catalog or fixture failure (letters only, at
 * most 40, so the hook's stderr name filter accepts it). The original message and cause are dropped. */
export const CATALOG_FAILURE_ERROR_NAME = "ClassificationCatalogError";

const CATALOG_UNLOCK = "Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help.";

const LAYER_UNLOCK: Readonly<Record<string, string>> = Object.freeze({
  "shipped-defaults": "Unlock: a human must correct the shipped-defaults policy file through a reviewed change; retrying will not help.",
  project: "Unlock: a human must correct the project policy file through a reviewed change; retrying will not help.",
  central: "Unlock: the central policy owner must correct the central policy outside this session; retrying will not help.",
});

const REASON_KINDS: readonly string[] = Object.freeze(["json-parse-error", "schema-invalid", "read-error"]);

/** The unlock text for a thrown error NAME. Only the catalog error name has its own text; anything else
 * (including a non-string) is the generic line. */
export function hookFailureUnlock(errorName: unknown): string {
  return typeof errorName === "string" && errorName === CATALOG_FAILURE_ERROR_NAME ? CATALOG_UNLOCK : GENERIC_UNLOCK;
}

function ownKey(table: Readonly<Record<string, string>>, key: unknown): string | undefined {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? key : undefined;
}

/** The unlock text for a policy-load failure, keyed by the failing layer. A layer outside the closed set is the generic line. */
export function policyLoadUnlock(failedLayer: unknown): string {
  const key = ownKey(LAYER_UNLOCK, failedLayer);
  return key === undefined ? GENERIC_UNLOCK : (LAYER_UNLOCK[key] ?? GENERIC_UNLOCK);
}

/** The layer name as it may be printed: a member of the closed set, else `unknown`. */
export function boundedLayerName(failedLayer: unknown): string {
  return ownKey(LAYER_UNLOCK, failedLayer) ?? "unknown";
}

/** The failure kind as it may be printed: a member of the closed set, else `unknown`. */
export function boundedReasonKind(reasonKind: unknown): string {
  return typeof reasonKind === "string" && REASON_KINDS.includes(reasonKind) ? reasonKind : "unknown";
}
