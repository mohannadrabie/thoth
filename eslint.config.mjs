// Generated config, hand-maintained. ESLint flat config per SE ADR-0010's quality-gate
// requirement ("MUST run the full local equivalent of CI gates before declaring work complete").
//
// Scope: thoth's own product code (`src/**`). The `docs/*.mjs` maat scaffolding (ADR cache,
// dashboard, decision-archive tooling) belongs to the governance harness this repo is built
// under, not to thoth-the-product (REQUIREMENTS.md §0: "the agentic team is out of scope") — it
// is intentionally not part of this lint gate.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "docs/**", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Node's native type-stripping (package.json "engines") cannot erase these — keep the
      // codebase inside the erasable-syntax subset so `node src/**/*.ts` keeps working unbuilt.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
    },
  },
  {
    // node:test's own idiom is a fire-and-forget top-level `test(name, fn)` call; the runner
    // schedules and awaits it internally. Requiring `await`/`void` on every call would fight the
    // framework's own convention rather than catch a real bug.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
