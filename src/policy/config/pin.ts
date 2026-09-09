// POL-09 (pinning half — the write-protection half is satisfied by the runtime primitive itself,
// per REQUIREMENTS.md's 2026-09-01 split): computes an immutable content-hash reference over the
// EFFECTIVE policy's raw bytes -- all three layers (shipped-defaults, central, project), not
// central alone -- so "a change under review cannot alter the policy that judges it" is provable
// of the WHOLE resolved policy, not merely its central component.
//
// Stage-3 fix-now (2026-09-08), Issue #110 [disclosed residual, closed this pass]: the original
// build hashed ONLY the central channel's bytes. Two effective policies differing solely in the
// shipped-defaults or project layer therefore shared one digest -- REQUIREMENTS.md's own POL-09
// text warns against closing this requirement on the delivery half alone, and this was exactly
// that gap. `shippedRaw`/`projectRaw` are now REQUIRED inputs (never optional/defaulted), so a
// caller cannot silently regress back to a central-only pin by omission.
//
// Single-read invariant (design-challenger S6 Attack F, AC2), preserved: this function NEVER reads
// any of the three channels itself -- no `CentralPolicySource` dependency, no filesystem access,
// anywhere in this file, at the type level. It only ever hashes bytes its caller (loader.ts)
// already has in hand from the reads it already performed (one central read, one shipped-defaults
// read, one project read -- zero NEW reads added by this fix). This closes the TOCTOU risk Attack F
// named structurally, not by convention: a future refactor cannot accidentally introduce a second,
// independent read here, because there is nothing in this file's own signature that could call
// `.read()`/`readFileSync()` again.
//
// Length-prefixed labeled hash framing (Issue #110's own "no concatenation-boundary collision"
// requirement): each layer's bytes are hashed as `"<label>:<byte-length>:" + <content>`, in a FIXED
// order (shipped-defaults, central, project -- matching loader.ts's own `namedLayers` order). A
// naive `hash.update(a); hash.update(b)` would let two different (a, b) splits of the same total
// bytes collide (e.g. "AB"+"C" vs "A"+"BC"); the explicit label + byte-length prefix on each frame
// makes every frame boundary self-describing, so no combination of layer contents can produce the
// same byte stream as a different combination.
import { createHash, type Hash } from "node:crypto";

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
  /** Issue #110 fix: the shipped-defaults layer's EXACT raw file bytes, already in the caller's
   * hand (loader.ts's own `shippedText`) — REQUIRED, never optional, so the pin cannot silently
   * regress to covering central alone by omission. */
  shippedRaw: string;
  /** Issue #110 fix: the project layer's EXACT raw file bytes, already in the caller's hand
   * (loader.ts's own `projectText`) — REQUIRED, never optional, for the same reason as
   * `shippedRaw` above. */
  projectRaw: string;
}

function sentinelFor(status: "absent" | "unsupported"): string {
  return `__thoth-central-${status}__`;
}

/** Hashes one labeled, length-prefixed frame — see this file's header for why the label + explicit
 * byte-length prefix (rather than a bare concatenation) is required to rule out cross-layer
 * boundary collisions. */
function updateLabeledFrame(hash: Hash, label: string, content: string): void {
  const byteLength = Buffer.byteLength(content, "utf8");
  hash.update(`${label}:${byteLength}:`, "utf8");
  hash.update(content, "utf8");
}

/**
 * Computes POL-09's pin over ALL THREE effective-policy layers (shipped-defaults, central,
 * project) — Issue #110 fix, closing the "central-only" gap. Pure — no I/O, deterministic for
 * identical input, callable any number of times without re-touching any of the three channels.
 */
export function computePin(input: ComputePinInput, now: Date = new Date()): PolicyPin {
  const hash = createHash("sha256");
  let channel: string;
  // Fixed order (Issue #110): shipped-defaults, central, project — matching loader.ts's own
  // `namedLayers` array order, so the pin's byte stream has one canonical layout.
  updateLabeledFrame(hash, "shipped-defaults", input.shippedRaw);
  if (input.centralStatus === "present") {
    updateLabeledFrame(hash, "central", input.centralRaw ?? "");
    channel = input.centralChannel ?? "";
  } else {
    updateLabeledFrame(hash, "central", sentinelFor(input.centralStatus));
    channel = `(${input.centralStatus})`;
  }
  updateLabeledFrame(hash, "project", input.projectRaw);
  return { digest: hash.digest("hex"), channel, computedAt: now.toISOString() };
}
