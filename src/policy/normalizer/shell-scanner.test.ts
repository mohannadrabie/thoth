import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractRedirectTargets,
  findLiveChainOperator,
  findLiveRedirectOperatorPositions,
  findLiveSubstitution,
  findLiveTrailingSensitiveSeparator,
  hasLiveChainOperator,
  hasLiveSubstitution,
  hasUnterminatedQuote,
  normalizeToolToken,
  quoteStates,
  stripHeredocBodies,
  tokenize,
  tokenizeWithOffsets,
} from "./shell-scanner.ts";

// --- quoteStates -------------------------------------------------------------------------------

test("quoteStates: unquoted text is 'none' throughout", () => {
  const states = quoteStates("abc");
  assert.deepEqual(states, ["none", "none", "none"]);
});

test("quoteStates: a single-quoted span is 'single' for its full extent, including the delimiters", () => {
  const states = quoteStates("a'bc'd");
  assert.deepEqual(states, ["none", "single", "single", "single", "single", "none"]);
});

test("quoteStates: a double-quoted span is 'double' for its full extent", () => {
  const states = quoteStates('a"bc"d');
  assert.deepEqual(states, ["none", "double", "double", "double", "double", "none"]);
});

test("quoteStates: a backslash-escaped quote outside any span does not open a span", () => {
  const states = quoteStates(`a\\'b`);
  // \' -> both chars stay "none"; the following 'b' stays "none" too (no span was opened)
  assert.deepEqual(states, ["none", "none", "none", "none"]);
});

// --- app-security-reviewer, S4 Stage-3 review, Finding 1 (Issue #68): hasUnterminatedQuote -----

test("Issue #68: an unterminated single quote is detected", () => {
  assert.equal(hasUnterminatedQuote("kubectl get pod/foo --context='prod"), true);
});

test("Issue #68: an unterminated double quote is detected", () => {
  assert.equal(hasUnterminatedQuote('kubectl get pod/foo --context="prod'), true);
});

test("Issue #68: a properly closed quote is NOT flagged as unterminated", () => {
  assert.equal(hasUnterminatedQuote("kubectl get pod/foo --context='prod'"), false);
});

test("Issue #68: no quotes at all is NOT flagged as unterminated", () => {
  assert.equal(hasUnterminatedQuote("kubectl get pod/foo --context=prod"), false);
});

test("Issue #68: empty string is NOT flagged as unterminated", () => {
  assert.equal(hasUnterminatedQuote(""), false);
});

// --- SUR-06a: findLiveChainOperator / hasLiveChainOperator -------------------------------------

test("SUR-06a: a live '&&' outside quotes is detected", () => {
  assert.equal(findLiveChainOperator("cmd1 && cmd2"), "&&");
});

test("SUR-06a: a live ';' outside quotes is detected", () => {
  assert.equal(findLiveChainOperator("cmd1 ; cmd2"), ";");
});

test("SUR-06a: a live '|' outside quotes is detected", () => {
  assert.equal(findLiveChainOperator("cmd1 | cmd2"), "|");
});

test("SUR-06a: a live '||' outside quotes is detected (reported as the 2-char operator)", () => {
  assert.equal(findLiveChainOperator("cmd1 || cmd2"), "||");
});

test("SUR-06a: no chain operator present -> undefined", () => {
  assert.equal(findLiveChainOperator("kubectl delete pod/x --context=prod"), undefined);
});

test("SUR-06b: a chain-operator-shaped substring fully inside double quotes is inert", () => {
  assert.equal(hasLiveChainOperator('kubectl delete pod/x --context="a && b"'), false);
});

test("SUR-06b: a chain-operator-shaped substring fully inside single quotes is inert", () => {
  assert.equal(hasLiveChainOperator("kubectl delete pod/x --context='a ; b'"), false);
});

test("a bare single trailing '&' (background, not one of the 4 named operators) is not a chain operator", () => {
  assert.equal(hasLiveChainOperator("kubectl delete pod/x --context=prod &"), false);
});

// --- red-team, S4 Stage-3 review, Finding 1 (Issue #70): findLiveTrailingSensitiveSeparator -----

test("Issue #70: a live newline with a second command following it is a separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("kubectl get pod/x --context=prod\nkubectl delete pod/y --context=prod"), "\\n");
});

test("Issue #70: a live non-doubled '&' with a second command following it is a separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("kubectl get pod/x --context=prod & kubectl delete pod/y --context=prod"), "&");
});

test("Issue #70: a TRAILING single '&' (nohup-style background marker) is NOT a separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("kubectl delete pod/x --context=prod &"), undefined);
});

test("Issue #70: a trailing newline with nothing after it is NOT a separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("kubectl delete pod/x --context=prod\n"), undefined);
});

test("Issue #70: '&&' is not double-counted as a trailing-sensitive single ampersand", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("cmd1 && cmd2"), undefined);
});

test("Issue #70: a newline inside a quoted span is inert", () => {
  assert.equal(findLiveTrailingSensitiveSeparator('kubectl delete pod/x --context="a\nb"'), undefined);
});

test("Issue #70: no separator present -> undefined", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("kubectl delete pod/x --context=prod"), undefined);
});

// --- red-team round-2, Finding N2 (Issue #81): fd-dup ampersand exclusion -----------------------

test("Issue #81 (review's own repro): '2>&1' is NOT read as a command separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("cat p > /tmp/ok 2>&1"), undefined);
});

test("Issue #81: '&>' is NOT read as a command separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("cat p &> /tmp/out"), undefined);
});

test("Issue #81: bare '>&2' is NOT read as a command separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("cmd >&2 other"), undefined);
});

test("Issue #81 regression pin: a genuinely separating '&' with a space before an unrelated '>' elsewhere is still detected", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("a & b > /tmp/out"), "&");
});

// --- design-challenger S4 round-1 Finding #1: findLiveSubstitution / hasLiveSubstitution -------

test("Finding #1: a live '$(' command substitution outside quotes is detected", () => {
  assert.equal(findLiveSubstitution("kubectl delete pod/$(id) --context=prod"), "$(");
});

test("Finding #1: a live backtick substitution outside quotes is detected", () => {
  assert.equal(findLiveSubstitution("kubectl delete pod/`id` --context=prod"), "`");
});

test("Finding #1: process substitution '<(' is detected", () => {
  assert.equal(findLiveSubstitution("diff <(cmd1) <(cmd2)"), "<(");
});

test("Finding #1: process substitution '>(' is detected", () => {
  assert.equal(findLiveSubstitution("cmd1 >(cmd2)"), ">(");
});

test("Finding #1: '$(' INSIDE double quotes is still live (a real shell evaluates it there)", () => {
  assert.equal(hasLiveSubstitution('bash -c "$(malicious)"'), true);
});

test("Finding #1: '$(' inside SINGLE quotes is inert (only single quotes suppress substitution)", () => {
  assert.equal(hasLiveSubstitution("echo '$(not-evaluated)'"), false);
});

test("no substitution present -> undefined", () => {
  assert.equal(findLiveSubstitution("kubectl delete pod/payment-worker --context=prod"), undefined);
});

// --- SUR-08: stripHeredocBodies / extractRedirectTargets ----------------------------------------

test("SUR-08 (named test): a heredoc marker's own line, including a trailing redirect, is preserved", () => {
  const { liveText } = stripHeredocBodies("cmd <<EOF > /target\nbody line\nEOF");
  assert.equal(liveText, "cmd <<EOF > /target");
  assert.deepEqual(extractRedirectTargets(liveText), ["/target"]);
});

// --- red-team, S4 Stage-3 review, Finding 2 (Issue #71): '<<<' herestring exclusion ------------

test("Issue #71: a '<<<' herestring is NOT mis-detected as a heredoc marker", () => {
  const { liveText, bodies } = stripHeredocBodies("kubectl get pods/api --context=prod <<<DELIM\nkubectl delete secrets/db-creds --context=prod");
  // the following line stays LIVE (unconsumed), not swallowed as an inert heredoc body
  assert.equal(liveText, "kubectl get pods/api --context=prod <<<DELIM\nkubectl delete secrets/db-creds --context=prod");
  assert.deepEqual(bodies, []);
});

test("Issue #71: a genuine two-'<' heredoc marker is still recognized, unaffected by the herestring fix", () => {
  const { liveText, bodies } = stripHeredocBodies("cmd <<EOF\nbody\nEOF");
  assert.equal(liveText, "cmd <<EOF");
  assert.deepEqual(bodies, ["body"]);
});

test("Issue #71: a '<<-' heredoc marker (tab-stripping form) is still recognized, unaffected by the herestring fix", () => {
  const { liveText, bodies } = stripHeredocBodies("cmd <<-EOF\nbody\nEOF");
  assert.equal(liveText, "cmd <<-EOF");
  assert.deepEqual(bodies, ["body"]);
});

test("SUR-08: heredoc body content is removed from liveText, never scanned as live syntax", () => {
  const { liveText } = stripHeredocBodies("cmd <<EOF\nrm -rf / && evil\nEOF");
  assert.equal(liveText, "cmd <<EOF");
  assert.equal(hasLiveChainOperator(liveText), false);
});

test("SUR-08: the body content itself is returned separately, for wrappers that need it (e.g. 'at')", () => {
  const { bodies } = stripHeredocBodies("at now <<EOF\nkubectl delete pod/x --context=prod\nEOF");
  assert.deepEqual(bodies, ["kubectl delete pod/x --context=prod"]);
});

test("SUR-08: '<<-' strips leading tabs from the delimiter comparison", () => {
  const { liveText, bodies } = stripHeredocBodies("cmd <<-EOF\n\t\tbody\n\tEOF");
  assert.equal(liveText, "cmd <<-EOF");
  assert.deepEqual(bodies, ["\t\tbody"]);
});

test("SUR-08: a quoted heredoc delimiter is recognized the same as an unquoted one", () => {
  const { liveText, bodies } = stripHeredocBodies("cmd <<'EOF' > /target\nbody\nEOF");
  assert.equal(liveText, "cmd <<'EOF' > /target");
  assert.deepEqual(bodies, ["body"]);
});

test("no heredoc present -> liveText unchanged, no bodies", () => {
  const result = stripHeredocBodies("kubectl delete pod/x --context=prod");
  assert.equal(result.liveText, "kubectl delete pod/x --context=prod");
  assert.deepEqual(result.bodies, []);
});

test("extractRedirectTargets: a live '>>' append redirect is also recognized", () => {
  assert.deepEqual(extractRedirectTargets("cmd >> /var/log/out.log"), ["/var/log/out.log"]);
});

test("extractRedirectTargets: a quoted redirect target has its quotes stripped", () => {
  assert.deepEqual(extractRedirectTargets('cmd > "/path with spaces/file"'), ["/path with spaces/file"]);
});

test("extractRedirectTargets: a '>' inside quotes is not a live redirect", () => {
  assert.deepEqual(extractRedirectTargets('echo "a > b"'), []);
});

test("extractRedirectTargets: no redirect present -> empty array", () => {
  assert.deepEqual(extractRedirectTargets("kubectl delete pod/x --context=prod"), []);
});

// --- red-team, S4 Stage-3 review, Finding 5 (Issue #74): every live redirect is collected -------

test("Issue #74 (review's own repro): two '>' redirects on one line both extracted, in order", () => {
  assert.deepEqual(extractRedirectTargets("cat payload > /tmp/harmless > /etc/cron.d/pwn"), [
    "/tmp/harmless",
    "/etc/cron.d/pwn",
  ]);
});

test("Issue #74: a '>' followed by a '>>' both extracted", () => {
  assert.deepEqual(extractRedirectTargets("cat p > /tmp/ok >> /etc/cron.d/pwn"), ["/tmp/ok", "/etc/cron.d/pwn"]);
});

test("Issue #74: a stderr fd-redirect ('2>') is also collected alongside an earlier stdout redirect", () => {
  assert.deepEqual(extractRedirectTargets("cat p > /tmp/ok 2> /etc/cron.d/pwn"), ["/tmp/ok", "/etc/cron.d/pwn"]);
});

// --- tokenize -------------------------------------------------------------------------------

test("tokenize: plain whitespace-separated tokens", () => {
  assert.deepEqual(tokenize("kubectl delete pod/x --context=prod"), [
    "kubectl",
    "delete",
    "pod/x",
    "--context=prod",
  ]);
});

test("SUR-07: tokenize strips a fully-quoted token's enclosing quotes", () => {
  assert.deepEqual(tokenize('"kubectl" "delete" "pod/payment-worker" --context=prod'), [
    "kubectl",
    "delete",
    "pod/payment-worker",
    "--context=prod",
  ]);
});

test("SUR-06b: tokenize preserves quoted whitespace/operator content as part of ONE token, not lost", () => {
  assert.deepEqual(tokenize('--context="a && b"'), ['--context=a && b']);
});

test("tokenize: a partially-quoted flag value collapses into a single token with quotes stripped", () => {
  assert.deepEqual(tokenize('--context="prod-cluster"'), ["--context=prod-cluster"]);
});

test("tokenize: single-quoted content is preserved verbatim, including embedded double quotes", () => {
  assert.deepEqual(tokenize(`echo 'a "b" c'`), ["echo", 'a "b" c']);
});

test("tokenize: empty input -> no tokens", () => {
  assert.deepEqual(tokenize(""), []);
});

// --- normalizeToolToken -----------------------------------------------------------------------

test("SUR-07: normalizeToolToken strips a path prefix", () => {
  assert.equal(normalizeToolToken("/usr/local/bin/kubectl"), "kubectl");
});

test("normalizeToolToken: lowercases", () => {
  assert.equal(normalizeToolToken("KUBECTL"), "kubectl");
});

test("normalizeToolToken: a bare tool name is unchanged (besides lowercasing)", () => {
  assert.equal(normalizeToolToken("bash"), "bash");
});

// --- round 3 (council-approved path, 2026-09-03): Issues #80, #81 -------------------------------

// --- Issue #80: tokenizeWithOffsets / findLiveRedirectOperatorPositions (position-based) --------

test("Issue #80: tokenizeWithOffsets reports each token's start offset in the original text", () => {
  assert.deepEqual(tokenizeWithOffsets("kubectl delete pod/x"), [
    { value: "kubectl", start: 0 },
    { value: "delete", start: 8 },
    { value: "pod/x", start: 15 },
  ]);
});

test("Issue #80: a quoted token's start offset is the position of its OPENING QUOTE, not its dequoted content", () => {
  assert.deepEqual(tokenizeWithOffsets('kubectl ">"'), [
    { value: "kubectl", start: 0 },
    { value: ">", start: 8 },
  ]);
});

test("Issue #80: findLiveRedirectOperatorPositions finds a live '>' by character position", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions("kubectl delete pod/x > /tmp/log"), [21]);
});

test("Issue #80 (the load-bearing case): a quoted literal '>' is NOT reported as a live redirect position — its token's start (8, the opening quote) never appears in this set", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions('kubectl delete ">" pod/x'), []);
});

test("Issue #80: '&>' both-streams form is reported at the '&' position (its token's real start), not the '>' character's own position", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions("cmd &> /tmp/out"), [4]);
});

test("no live redirect present -> empty array", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions("kubectl delete pod/x --context=prod"), []);
});

// --- Issue #81: fd-dup ampersand exclusion in extractRedirectTargets ----------------------------

test("Issue #81: '2>&1' extracts NO target — a fd-dup redirect creates no file", () => {
  assert.deepEqual(extractRedirectTargets("cat p > /tmp/ok 2>&1"), ["/tmp/ok"]);
});

test("Issue #81: bare '>&2' alone extracts no target", () => {
  assert.deepEqual(extractRedirectTargets("cmd >&2"), []);
});

test("Issue #81: '&>' (both-streams to a REAL file) still extracts its target correctly", () => {
  assert.deepEqual(extractRedirectTargets("cat p &> /tmp/out"), ["/tmp/out"]);
});

test("Issue #81: '&>>' (append, both-streams) still extracts its target correctly", () => {
  assert.deepEqual(extractRedirectTargets("cat p &>> /tmp/out"), ["/tmp/out"]);
});

// --- red-team round-3 re-confirm, Finding 1 (Issue #83): fd-dup exclusion must consult LIVENESS,
// not a raw neighbouring character — a backslash-escaped '>' is not a live redirect operator, so
// an '&' next to it is NOT fd-dup and must still be detected as a real command separator. -------

test("Issue #83 (report's own repro, scanner level): a backslash-escaped '>' immediately before '&' is not fd-dup — the '&' is still a live command separator", () => {
  assert.equal(findLiveTrailingSensitiveSeparator(String.raw`kubectl get --context=prod \>& kubectl delete secrets/db-creds --context=prod`), "&");
});

test("Issue #83: findLiveRedirectOperatorPositions does not report a backslash-escaped '>' as a live redirect operator position at all", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions(String.raw`echo a \> b`), []);
});

test("Issue #83: extractRedirectTargets does not extract a target from a backslash-escaped '>' — 'echo a \\> b' is a literal argument, not a redirect", () => {
  assert.deepEqual(extractRedirectTargets(String.raw`echo a \> b`), []);
});

test("Issue #83 regression pin: a genuinely LIVE '>' immediately before '&' (real fd-dup, e.g. '2>&1') is still excluded from separator detection, unaffected by the escape fix", () => {
  assert.equal(findLiveTrailingSensitiveSeparator("cat p > /tmp/ok 2>&1"), undefined);
});

test("Issue #83 edge case: an escaped leading '>' glued to a genuinely live second '>' ('\\>>x') — the escaped one is inert, the live one is still found as its own redirect", () => {
  // "echo a \>>x": indices 0-3 "echo", 4 " ", 5 "a", 6 " ", 7 "\\", 8 ">" (escaped, inert),
  // 9 ">" (live, its own single-char operator), 10 "x" (its target).
  assert.deepEqual(findLiveRedirectOperatorPositions(String.raw`echo a \>>x`), [9]);
  assert.deepEqual(extractRedirectTargets(String.raw`echo a \>>x`), ["x"]);
});

test("Issue #83, sibling location: an ESCAPED '&' immediately before a live '>' is not the '&>' both-streams form — tokenStart is the '>' itself (position 6), not the escaped '&' (position 5)", () => {
  // "cmd \&> /tmp/out": the backslash makes '&' a literal argument character; the '>' right after
  // it is an ORDINARY (single-stream) live redirect, not prefixed by a live '&'. Getting this wrong
  // would report the wrong token as the redirect operator's start to shell.ts's position-based
  // exclusion (Issue #80) — a different token than the one that actually opens the operator.
  assert.deepEqual(findLiveRedirectOperatorPositions(String.raw`cmd \&> /tmp/out`), [6]);
  assert.deepEqual(extractRedirectTargets(String.raw`cmd \&> /tmp/out`), ["/tmp/out"]);
});

// --- red-team round-4 (Issue #84): '>&WORD' is a real bash file redirect (the historical synonym
// for '&>WORD'), not fd-dup — only '>&DIGIT'/'>&-' are genuine fd-dup. Round 3's #81 fix skipped
// ANY '>' followed by '&' unconditionally, silently dropping the '>&WORD' target. -----------------

test("Issue #84 (report's own repro): '>& out' (spaced) extracts 'out' as a real write target, not fd-dup", () => {
  assert.deepEqual(extractRedirectTargets("kubectl get pods/api --context=prod >& out"), ["out"]);
});

test("Issue #84: '>&out' (glued, no live whitespace) extracts 'out' as a real write target", () => {
  assert.deepEqual(extractRedirectTargets("kubectl get pods/api --context=prod >&out"), ["out"]);
});

test("Issue #84: findLiveRedirectOperatorPositions reports '>& out' at the '>' character's own position (not preceded by a live '&', so no tokenStart shift)", () => {
  assert.deepEqual(findLiveRedirectOperatorPositions("cmd >& out"), [4]);
});

test("Issue #84 regression pin: bare '>&2' (digit form) still extracts NO target — genuine fd-dup, unaffected by the word-form fix", () => {
  assert.deepEqual(extractRedirectTargets("cmd >&2"), []);
});

test("Issue #84 regression pin: multi-digit fd-dup ('>&12') still extracts NO target", () => {
  assert.deepEqual(extractRedirectTargets("cmd >&12"), []);
});

test("Issue #84 regression pin: bare '>&-' (close-the-descriptor form) still extracts NO target", () => {
  assert.deepEqual(extractRedirectTargets("cmd >&-"), []);
});

test("Issue #84 regression pin: '&>' (ampersand LEADING, both-streams to a real file) is unaffected by the trailing-ampersand fix", () => {
  assert.deepEqual(extractRedirectTargets("cat p &> /tmp/out"), ["/tmp/out"]);
});
