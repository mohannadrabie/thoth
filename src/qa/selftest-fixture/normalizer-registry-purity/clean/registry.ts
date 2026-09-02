// Minimal clean fixture: a declaration-based registry with no sibling-directory import and no
// switch statement — mirrors the shape src/policy/normalizer/registry.ts's real production code
// must hold.
export interface FixtureNormalizerEntry {
  toolType: string;
  normalize: (raw: unknown) => unknown;
}

const registry = new Map<string, FixtureNormalizerEntry>();

export function registerNormalizer(entry: FixtureNormalizerEntry): void {
  registry.set(entry.toolType, entry);
}

export function resolveNormalizer(toolType: string): FixtureNormalizerEntry | undefined {
  return registry.get(toolType);
}
