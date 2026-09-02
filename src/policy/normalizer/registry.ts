// ADR-0021 "Rules for agents": "MUST register each per-tool-type normalizer on the normalizer
// registry by declaration; MUST NOT add a tool type by editing a shared dispatch chain or the
// kernel (POL-12)." "MUST NOT let a normalizer return a verdict, or let the kernel inspect a
// tool's identity or shape directly — the kernel decides only from the Action record (§3.2)."
//
// This file is deliberately kept free of any reference to a specific tool type: it exports only
// the registration mechanism (`registerNormalizer`) and the lookup/normalize functions. Every
// concrete normalizer (shell.ts, structured-cluster.ts, any future one) imports THIS file and
// calls `registerNormalizer` on itself at module-load time — this file never imports any of them.
// That is the entire mechanism behind "declaration, not dispatch chain": a dispatch chain requires
// the dispatcher to know every case; here, every case declares itself to a dispatcher that knows
// none of them. src/qa/normalizer-registry-purity-check.ts proves this structurally (no sibling
// import, no `switch`), not just by convention — mirroring src/qa/kernel-purity-check.ts's own
// structural-test pattern.
//
// Lives outside the kernel purity boundary (src/policy/kernel/**) — it depends on the kernel's
// public ActionRecord type (one-directional, per action-record.ts's own header comment) but is not
// itself part of the pure kernel.
import type { ActionRecord } from "../kernel/action-record.ts";

export interface NormalizerEntry {
  /** The tool-type identifier this normalizer handles (e.g. "shell", "cluster"). Matched exactly
   * against the `toolType` argument passed to `normalize()`. */
  toolType: string;
  /** Produces a well-formed ActionRecord from a raw, tool-specific call. MUST NOT return a
   * Verdict — normalizers never decide (ADR-0021 §3.2). */
  normalize: (raw: unknown) => ActionRecord;
}

const registry = new Map<string, NormalizerEntry>();

/**
 * The ONLY way a tool type becomes known to this registry — called by each normalizer's own
 * module at import time (see shell.ts / structured-cluster.ts's bottom-of-file registration call).
 * Registering a second, third, or Nth normalizer requires calling this function from a NEW file;
 * it requires editing neither this file nor any prior normalizer's file (POL-12's acceptance bar).
 */
export function registerNormalizer(entry: NormalizerEntry): void {
  registry.set(entry.toolType, entry);
}

export function resolveNormalizer(toolType: string): NormalizerEntry | undefined {
  return registry.get(toolType);
}

function bestEffortString(raw: unknown, field: string): string {
  if (typeof raw === "object" && raw !== null && field in raw) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return "unknown";
}

/**
 * ADR-0021 §3.2 / SUR-02: an unrecognized `toolType` (no normalizer registered for it) MUST NOT
 * silently fall through to `allow` — it produces an opaque Action record instead, exactly the
 * shape POL-05 denies a mutating action on. This is the registry's own fail-closed default; it is
 * not a per-normalizer concern, and it is reached by construction whenever `toolType` has no
 * registered entry, never by a normalizer opting in.
 */
export function normalize(toolType: string, raw: unknown): ActionRecord {
  const entry = resolveNormalizer(toolType);
  if (!entry) {
    return {
      source: "opaque",
      verbs: [],
      targets: [],
      environment: bestEffortString(raw, "environment"),
      identity: bestEffortString(raw, "identity"),
      deferred: false,
      unresolved: [`toolType "${toolType}" has no registered normalizer`],
    };
  }
  return entry.normalize(raw);
}
