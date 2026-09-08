// POL-09 (pinning half — the write-protection half is satisfied by the runtime primitive itself,
// per REQUIREMENTS.md's 2026-09-01 split): computes an immutable content-hash reference over the
// central channel's raw bytes, so "a change under review cannot alter the policy that judges it"
// is provable, not merely asserted.
//
// Single-read invariant (design-challenger S6 Attack F, AC2): this function NEVER reads the
// central channel itself — no `CentralPolicySource` dependency exists anywhere in this file, at
// the type level. It only ever hashes bytes its caller (loader.ts) already has in hand from the
// ONE read it performed. This closes the TOCTOU risk Attack F named structurally, not by
// convention: a future refactor cannot accidentally introduce a second, independent read here,
// because there is nothing in this file's own signature that could call `.read()` again.
import { createHash } from "node:crypto";

export type CentralChannelStatus = "absent" | "unsupported" | "present";

export interface PolicyPin {
  /** SHA-256 hex digest. When `centralStatus !== "present"`, this is a digest over a fixed,
   * status-specific sentinel string — NEVER the digest of an empty string — so a pin can never be
   * mistaken for "central deployed genuinely empty content" vs. "no central channel consulted at
   * all" (two structurally different states that must never collide on one hash). */
  digest: string;
  /** The real channel descriptor when present; a parenthesized status word otherwise (e.g.
   * "(absent)") — always populated, never blank, so a pin is self-describing without cross-referencing
   * the load result it came from. */
  channel: string;
  /** ISO-8601 timestamp of computation — not itself part of the digest (a pin must be
   * byte-for-byte reproducible from identical central content, run-to-run; a timestamp inside the
   * hash would defeat that). */
  computedAt: string;
}

export interface ComputePinInput {
  centralStatus: CentralChannelStatus;
  /** Required when `centralStatus === "present"`; ignored otherwise. */
  centralChannel?: string | undefined;
  /** The EXACT bytes the caller already read and merged — required when `centralStatus ===
   * "present"`. Never re-read from the channel by this function. */
  centralRaw?: string | undefined;
}

function sentinelFor(status: "absent" | "unsupported"): string {
  return `__thoth-central-${status}__`;
}

/**
 * Computes POL-09's pin. Pure — no I/O, deterministic for identical input, callable any number of
 * times without re-touching the central channel.
 */
export function computePin(input: ComputePinInput, now: Date = new Date()): PolicyPin {
  const hash = createHash("sha256");
  let channel: string;
  if (input.centralStatus === "present") {
    hash.update(input.centralRaw ?? "", "utf8");
    channel = input.centralChannel ?? "";
  } else {
    hash.update(sentinelFor(input.centralStatus), "utf8");
    channel = `(${input.centralStatus})`;
  }
  return { digest: hash.digest("hex"), channel, computedAt: now.toISOString() };
}
