// Violating fixture: demonstrates BOTH forbidden shapes at once — a direct import of a sibling
// "normalizer" file (registry reaching FOR a concrete case, the inversion POL-12 forbids), and a
// switch statement dispatching by tool-type identity (the textbook dispatch chain POL-12 names).
import { fixtureNormalize } from "./shell.ts";

export function normalizeByToolType(toolType: string, raw: unknown): unknown {
  switch (toolType) {
    case "shell":
      return fixtureNormalize(raw);
    default:
      return null;
  }
}
