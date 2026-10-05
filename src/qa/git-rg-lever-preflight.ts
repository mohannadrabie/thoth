// #409 (S7): read-only preflight for pre-planted git/rg exec-lever state. STUB in the RED commit.
export interface Finding {
  where: string;
  key: string;
  detail: string;
}
export interface PreflightInput {
  repoRoot: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  programData?: string;
  managedSettingsPath?: string;
}
export const RESIDUALS: Readonly<Record<string, string>> = {};
export const runPreflight = (_input: PreflightInput): Finding[] => [];
