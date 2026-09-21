// STUB (red commit): whole-file behavior everywhere, so the scoping tests compile and fail on
// their assertions rather than on a missing module. Replaced by the real module in the next commit.
export const APPEND_ONLY_FILES: readonly string[] = [
  "docs/decisions.md",
  "docs/decisions-archive.md",
  "docs/REVIEW_LOG.md",
  "CHANGELOG.md",
];
export const APPEND_ONLY_DIR_PREFIXES: readonly string[] = ["docs/reviews/"];
export const GENERATED_MIRROR_FILE = "docs/.maat-state.json";

export interface AddedLine {
  text: string;
  run: number;
}
export interface ParsedDiff {
  added: Map<string, AddedLine[]>;
  removed: Map<string, string[]>;
}
export interface ScanTextDeps {
  diffText: () => Promise<string>;
  readFile: (repoRelativePath: string) => Promise<string | null>;
  shouldScan: (repoRelativePath: string) => boolean;
}

export function isAppendOnlyRecord(_repoRelativePath: string): boolean {
  return false;
}

export function stripAdrCatalog(text: string): string {
  return text;
}

export function parseUnifiedDiff(_diffText: string): ParsedDiff {
  return { added: new Map(), removed: new Map() };
}

export async function buildScanTexts(
  changedFiles: readonly string[],
  _fullTree: boolean,
  deps: ScanTextDeps,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of changedFiles) {
    if (!deps.shouldScan(file)) continue;
    const text = await deps.readFile(file);
    if (text !== null) out.set(file, text);
  }
  return out;
}
