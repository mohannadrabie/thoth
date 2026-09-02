// S3 / ADR-0021 shape 3, REQUIREMENTS.md §3.1: "verbs from the action catalog." This is the
// normalizer-side catalog docs/backlog.md's S2 residual entry named this story as the one that
// must build ("needs a real action catalog/verb taxonomy... which is ADR-0021 shape 3's job").
//
// Distinct from src/policy/kernel/kernel.ts's own MUTATING_VERBS set — that set answers a
// different question (does the kernel treat an already-normalized verb as mutating, for POL-05's
// purposes) and is untouched by this story (POL-12's acceptance bar: zero diff to kernel.ts). This
// catalog answers a prior question: does a normalizer recognize a raw, tool-specific verb token at
// all? A raw verb outside this catalog is NEVER silently passed through as a normalized verb — the
// normalizer that encounters one reports it via `ActionRecord.unresolved` instead (ADR-0021 §3.2:
// "never silently dropped or defaulted to allow"). See shell.ts / structured-cluster.ts.
//
// Lives outside the kernel purity boundary (src/policy/kernel/**) — normalizers produce the
// ActionRecord the kernel later decides against; they are not part of the pure kernel itself.

/** Deliberately small and named, not derived (mirrors kernel.ts's own MUTATING_VERBS convention).
 * Growing this list to cover a new tool's vocabulary is a data addition, not a dispatch-chain edit
 * — POL-12 forbids branching logic keyed on tool identity, not maintaining a data catalog (the
 * same distinction POL-01 already draws for kernel rules: "a configuration change plus a fixture"
 * is expected, not forbidden). */
export const KNOWN_VERBS: ReadonlySet<string> = new Set([
  // mutating
  "write",
  "create",
  "modify",
  "delete",
  "move",
  "rename",
  "execute",
  // non-mutating
  "read",
  "list",
  "describe",
  "get",
]);

/**
 * Maps a raw, tool-specific verb token to its canonical catalog verb, case-insensitively. Returns
 * `undefined` when the raw verb is not recognized — the caller (a normalizer) MUST then report the
 * raw verb via `ActionRecord.unresolved`, never guess a canonical verb for it or drop it silently.
 */
export function resolveVerb(raw: string): string | undefined {
  const normalized = raw.trim().toLowerCase();
  return KNOWN_VERBS.has(normalized) ? normalized : undefined;
}
