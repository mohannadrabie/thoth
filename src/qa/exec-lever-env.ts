// #409 (S7): the exec-lever environment-key rule. STUB in the RED commit: every export is deliberately inert so the
// failing-first tests in git-rg-lever-seal.test.ts fail on assertions, not on a missing import.
export const LEVER_PREFIXES: readonly string[] = [];
export const LEVER_NAMED: readonly string[] = [];
export const AMBIENT_COMMON: readonly string[] = [];
export const isLeverKey = (_key: string): boolean => false;
export const isAmbientCommon = (_key: string): boolean => false;
export interface SettingsEnvHit {
  scope: string;
  key: string;
}
export const scanSettingsEnv = (_scope: string, _text: string): SettingsEnvHit[] => [];
