// Issue #294 (S6): `policy:print` writes policy-derived text (rule ids, unknown keys, JSON.parse
// snippets, file paths, channel descriptors) to a terminal. Text from a policy file is not trusted
// to be free of terminal control sequences, so every such string passes through this helper at the
// render boundary (printer.ts, print-cli.ts) and never below it: the loader and schema keep the raw
// text, so comparisons and `validateRuleSet`'s own errors are unchanged.
//
// The class is exactly C0/DEL/C1 (`\p{Cc}`) plus U+2028 and U+2029, the same literal the S5
// UserPromptSubmit hook uses (hooks/userpromptsubmit-halt-relay.mjs, Issue #278). It is copied, not
// imported, because that hook is a plain-JS enforcement point this story does not edit;
// sanitize.test.ts compares the two literals so they cannot drift.
//
// STRIP, not escape: removed characters leave no trace in the output. Deliberately no NFKC and no
// truncation: both would change bytes of clean text, and the hook's 200-character cap is its own
// diagnostic-line policy.
//
// ACCEPTED RESIDUALS (Manager to record in docs/decisions.md):
//   - A stripped key can read like a known key: a key spelled with an ESC inside "version" prints
//     as `unknown key "version"`. The line still says it is an unknown key; the name can mislead.
//   - Format characters (`\p{Cf}`) survive, so bidi overrides (U+202E) and zero-width characters can
//     visually reorder or hide text. They cannot forge a line or emit an escape sequence. Same
//     residual S5 #278 accepted.
//   - No NFKC, so homoglyph lookalikes survive.
//   - Two distinct hostile keys can strip to the same printed text.
export function sanitizeForTerminal(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");
}
