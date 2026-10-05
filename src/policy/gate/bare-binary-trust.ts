// STUB (RED commit, Issue #428): the real module lands in the next commit. Fail-open on purpose so the tests fail on assertions.
export type Platform = "win32" | "posix";
export interface TrustEnv {
  PATH?: string | undefined;
  SYSTEMROOT?: string | undefined;
  windir?: string | undefined;
}
export interface DirStat {
  uid: number;
  mode: number;
}
export interface TrustPorts {
  platform: Platform;
  env: TrustEnv;
  cwd(): string;
  homedir(): string | undefined;
  readdir(dir: string): readonly string[];
  realpath(path: string): string;
  lstat(path: string): DirStat;
}
export type TrustDenyKind =
  | "not-bare-name"
  | "path-unset"
  | "no-trust-root"
  | "network-path"
  | "unreadable-dir"
  | "shadow"
  | "no-trusted-hit"
  | "hit-escapes-trust"
  | "fault";
export type TrustResult = { ok: true } | { ok: false; kind: TrustDenyKind; reason: string };
export const BUILTIN_WRAPPER_NAMES: readonly string[] = [];
export function matchesName(_entry: string, _name: string, _platform: Platform): boolean {
  return false;
}
export function checkBareBinaries(_names: readonly string[], _ports: TrustPorts): TrustResult {
  return { ok: true };
}
export function scannedDirectories(_ports: TrustPorts): readonly { dir: string; trusted: boolean }[] {
  return [];
}
export function isTrustedDirectory(_ports: TrustPorts, _dir: string): boolean {
  return false;
}
