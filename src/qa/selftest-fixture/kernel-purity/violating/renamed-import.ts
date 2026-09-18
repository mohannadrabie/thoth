// Self-test fixture (regression confirmation, Issue #63 AC5): a renamed import of a non-relative
// specifier is already forbidden outright by classifyImport's non-relative-import check,
// regardless of the local binding name it's imported under — `spawn` reached under the alias `s`
// is exactly as forbidden as `spawn` reached under its own name, because the violation is keyed on
// the import SPECIFIER ("node:child_process"), never the local identifier the import renames it
// to. No new production code was needed for this class (confirmed by story-implementer's Phase 1
// spike run); this fixture only proves the existing behavior stays covered. See
// kernel-purity-check.test.ts.
import { spawn as s } from "node:child_process";

export function useRenamedImport(): void {
  s("ls", []);
}
