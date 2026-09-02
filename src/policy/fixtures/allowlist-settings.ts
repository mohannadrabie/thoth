// In-memory settings-blob fixtures for src/policy/verification/allowlist.test.ts (SUR-04, S3
// scope: verification against fixture content only — see allowlist.ts's header comment).

/** Compliant: allowManagedMcpServersOnly + a non-empty allowedMcpServers. */
export const compliantSettingsViaExclusiveFlags = {
  allowManagedMcpServersOnly: true,
  allowedMcpServers: ["github", "filesystem"],
};

/** Compliant: a deployed managed-mcp.json, the other route SUR-04's acceptance text names. */
export const compliantSettingsViaManagedConfig = {
  managedMcpConfigDeployed: true,
};

/** Non-compliant: an ADDITIVE allowlist with no exclusive flag — exactly what SUR-04 forbids
 * ("governed by an exclusive allowlist, not an additive one"). */
export const nonCompliantSettingsAdditiveOnly = {
  allowedMcpServers: ["github"],
};

/** Non-compliant: the exclusive flag is set, but the allowlist itself is empty — the flag alone
 * proves nothing without a populated list behind it. */
export const nonCompliantSettingsFlagWithEmptyList = {
  allowManagedMcpServersOnly: true,
  allowedMcpServers: [],
};

/** Non-compliant: no relevant keys present at all. */
export const nonCompliantSettingsEmpty = {};
