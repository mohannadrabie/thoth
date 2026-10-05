// STUB (RED commit, Issue #428).
import type { TrustPorts, TrustResult } from "../gate/bare-binary-trust.ts";
export function createRealTrustPorts(): TrustPorts {
  throw new Error("not implemented");
}
export function createRealBinaryCheck(): (names: readonly string[]) => TrustResult {
  return () => ({ ok: true });
}
