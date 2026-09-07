// Generated config, hand-maintained. ESLint flat config per SE ADR-0010's quality-gate
// requirement ("MUST run the full local equivalent of CI gates before declaring work complete").
//
// Scope: thoth's own product code (`src/**`), plus (S5, Milestone #23) the real hook entry points
// under `hooks/**/*.mjs` — this story's first shipped production `.mjs` files, a sensitive area
// per CLAUDE.md (wired to `PreToolUse`/`SessionStart`/`UserPromptSubmit`). `hooks/**/*.ts` (the
// test files and test-support helpers) are intentionally NOT added here — same TS-parser-scoping
// convention `src/**/*.ts`'s own config block already uses, and this repo's existing lane
// discipline keeps test-writer's own test files out of story-implementer's lint-config changes.
// The `docs/*.mjs` maat scaffolding (ADR cache, dashboard, decision-archive tooling) belongs to the
// governance harness this repo is built under, not to thoth-the-product (REQUIREMENTS.md §0: "the
// agentic team is out of scope") — it is intentionally not part of this lint gate.
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
  {
    // hooks/**/*.mjs (S5): plain Node ESM scripts, invoked directly by Claude Code's own hook
    // runtime (never bundled/transpiled) — `process`/`console` are real Node globals these files
    // legitimately use throughout (stdin/stdout/stderr, exit codes). No `js.configs.recommended`
    // environment is declared by default in this flat config, so without this block every
    // top-level `process` reference here is flagged `no-undef`.
    files: ["hooks/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
);
