// Sibling fixture normalizer file that the violating registry.ts (wrongly) imports directly.
export function fixtureNormalize(raw: unknown): unknown {
  return raw;
}
