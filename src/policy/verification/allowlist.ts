// SUR-04: "Structured tool servers reachable by the session shall be governed by an exclusive
// allowlist, not an additive one." Amended 2026-09-01 (REQUIREMENTS.md line 460): this is
// configuration, not build — satisfied by `allowManagedMcpServersOnly` with `allowedMcpServers`,
// or a deployed `managed-mcp.json`. "Thoth's work is to verify the setting is in force and to
// report it when it is not (INT-07, REL-12), never to reimplement it... that verification is a
// fixture, not an assumption."
//
// S3 builds the verification/report function only, against fixture settings content (docs/
// decisions.md, 2026-09-01 S3-intake row, point 3). Real deployed-settings-file reads are INT-07
// (S9, Milestone #27) and REL-12 (S14, Milestone #34) — not this story's job.
export interface AllowlistComplianceResult {
  compliant: boolean;
  reason: string;
}

interface SettingsShape {
  allowManagedMcpServersOnly?: unknown;
  allowedMcpServers?: unknown;
  /** Fixture stand-in for "a deployed managed-mcp.json is in force" — the real deployed-file read
   * is INT-07/REL-12's job, not this story's (see header comment). */
  managedMcpConfigDeployed?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
}

/**
 * SUR-04's own acceptance text names two independent ways to satisfy it: `allowManagedMcpServersOnly`
 * with a non-empty `allowedMcpServers`, OR a deployed `managed-mcp.json`. Fail-closed on anything
 * ambiguous or absent — mirrors POL-05's own fail-closed shape rather than defaulting an
 * unrecognized settings shape to compliant (the exact near-miss S2's Issue #62 named — see
 * docs/backlog.md).
 */
export function verifyAllowlistInForce(settings: unknown): AllowlistComplianceResult {
  if (!isRecord(settings)) {
    return { compliant: false, reason: "settings input is not an object — cannot verify, treated as non-compliant" };
  }

  const s = settings as SettingsShape;

  if (s.managedMcpConfigDeployed === true) {
    return { compliant: true, reason: "a deployed managed-mcp.json is in force" };
  }

  const exclusiveFlagSet = s.allowManagedMcpServersOnly === true;
  const allowlistPopulated = isNonEmptyStringArray(s.allowedMcpServers);

  if (exclusiveFlagSet && allowlistPopulated) {
    return {
      compliant: true,
      reason: "allowManagedMcpServersOnly is true with a non-empty allowedMcpServers list",
    };
  }

  if (exclusiveFlagSet && !allowlistPopulated) {
    return {
      compliant: false,
      reason:
        "allowManagedMcpServersOnly is true but allowedMcpServers is missing, empty, or not a string array — " +
        "the exclusive allowlist is not actually in force",
    };
  }

  return {
    compliant: false,
    reason: "neither allowManagedMcpServersOnly+allowedMcpServers nor a deployed managed-mcp.json was found",
  };
}
