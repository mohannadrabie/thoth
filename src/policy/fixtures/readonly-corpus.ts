// #308 story E0 (Issue #408): the shared corpus for the closed read-only shell command set. One data file, read by the
// unit test (src/policy/normalizer/readonly-catalog.test.ts) and the real-hook test
// (hooks/pretooluse-kernel-gate-readonly.test.ts), so both layers judge the same rows.
// Plan: docs/plans/s308-E0-readonly-shell-plan-2026-10-05.md (sections 3 and 5).

export interface AcceptRow {
  command: string;
  verb: "read" | "list";
  /** The one canonical target the record must carry (lowercase, "./" folded, "." for an implicit current directory). */
  target: string;
}

export const ACCEPT_ROWS: readonly AcceptRow[] = [
  { command: "ls", verb: "list", target: "." },
  { command: "ls -la", verb: "list", target: "." },
  { command: "ls -la src", verb: "list", target: "src" },
  { command: "ls -A -R ./src", verb: "list", target: "src" },
  { command: "ls -1thrSF docs", verb: "list", target: "docs" },
  { command: "cat README.md", verb: "read", target: "readme.md" },
  { command: "cat -n README.md", verb: "read", target: "readme.md" },
  { command: "cat -nbsAETv ./docs/Plan.md", verb: "read", target: "docs/plan.md" },
  { command: "head -n 20 README.md", verb: "read", target: "readme.md" },
  { command: "head -n20 README.md", verb: "read", target: "readme.md" },
  { command: "head -c 100 README.md", verb: "read", target: "readme.md" },
  { command: "head -qv README.md", verb: "read", target: "readme.md" },
  { command: "tail -n 5 CHANGELOG.md", verb: "read", target: "changelog.md" },
  { command: "tail -c 10 CHANGELOG.md", verb: "read", target: "changelog.md" },
  { command: "wc -l README.md", verb: "read", target: "readme.md" },
  { command: "wc -lwcmL README.md", verb: "read", target: "readme.md" },
  { command: "grep foo README.md", verb: "read", target: "readme.md" },
  { command: "grep -rn foo src", verb: "read", target: "src" },
  { command: "grep -iwxFEHhIosqvlLcn foo README.md", verb: "read", target: "readme.md" },
  { command: "grep -e foo README.md", verb: "read", target: "readme.md" },
  { command: "grep -A 3 foo README.md", verb: "read", target: "readme.md" },
  { command: "grep -B3 -m 5 foo README.md", verb: "read", target: "readme.md" },
  { command: "grep -rn 'a.*b' src", verb: "read", target: "src" },
  { command: "grep '[0-9]' README.md", verb: "read", target: "readme.md" },
  { command: "grep -e 'x|y' README.md", verb: "read", target: "readme.md" },
  { command: "grep -r foo", verb: "read", target: "." },
  { command: "grep 'foo$' README.md", verb: "read", target: "readme.md" },
  { command: "grep 'a`b' README.md", verb: "read", target: "readme.md" },
];

// Every row below must NEVER yield a clean read or list record (empty `unresolved`), and must be denied by the real hook.
export const DENY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  "B-01-binary-identity": [
    "./cat README.md", "/usr/bin/cat README.md", "CAT README.md", "cat.exe README.md", "cat.cmd README.md",
    "'c'at README.md", 'c""at README.md', String.raw`\cat README.md`, '"cat" README.md', "LS", "./ls",
  ],
  "B-02-chains-and-substitution": [
    "ls; rm x", "ls && rm x", "ls || rm x", "ls | sh", "ls\nrm x", "ls & rm x", "ls $(rm x)", "ls `rm x`", "ls <(rm x)",
    'cat "$(rm x)"', "cat a | tee b", "ls &",
  ],
  "B-10-redirects-and-heredocs": [
    "ls > /etc/x", "cat a >> b", "cat a 2>&1", "cat < a", "cat <<EOF\nx\nEOF", "cat <<< x", "ls >&-", "cat a > f",
    "ls >out.txt", "grep foo README.md > out.txt",
  ],
  "B-11-env-prefix": ["FOO=1 ls", "LD_PRELOAD=x ls", "A=$(x) ls", "PAGER=x git log", "GIT_EXTERNAL_DIFF=x git diff", "RIPGREP_CONFIG_PATH=x rg p"],
  "B-12-wrappers": [
    "env ls", "env -i ls", "sh -c 'ls'", "bash -c 'cat README.md'", "bash -c \"ls; rm x\"", "sh -c 'ls | tee f'", "xargs cat",
    "command ls", "builtin ls", "exec ls", "nice ls", "nohup ls", "timeout 5 ls", "stdbuf -o0 ls", "time ls", "sudo ls",
    "doas ls", "eval ls", "eval 'cat README.md'", "source ls", ". ls", "at now", "crontab -l",
  ],
  "B-15-git-out-of-set-until-409": [
    "git status", "git status -s", "git log", "git log --oneline", "git log -p", "git diff", "git diff --cached", "git show",
    "git show HEAD", "git -c core.pager=x log", "git -c core.fsmonitor=x status", "git -C /tmp status", "git --git-dir=x log",
    "git log --output=f", "git diff --ext-diff", "git branch -D x", "git checkout x", "git push",
  ],
  "B-16-rg-out-of-set-until-409": ["rg p", "rg foo src", "rg --pre cat p", "rg --pre=x p", "rg -z p", "rg --search-zip p", "rg --hostname-bin x p"],
  "B-13-other-binaries-out-of-set": [
    "find . -name x", "find . -exec rm {} ;", "find . -delete", "sed -n 1p README.md", "sed -i s/a/b/ f", "awk 1 f", "less f", "more f",
    "curl x", "tee f", "cp a b", "mv a b", "rm x", "echo hi", "pwd", "which ls", "type README.md", "dir", "file x", "stat x",
    "du", "df", "printenv", "tree", "jq . f", "node x", "npm test", "python -c 1", "touch x", "dd if=a of=b",
  ],
  "B-03-flags-outside-the-closed-list": [
    "ls -Z", "ls --color", "ls --hyperlink", "ls -d", "ls -d x", "ls -- x", "ls -I x", "cat -x README.md", "cat - ", "cat",
    "cat -- README.md", "grep -P x README.md", "grep -f p README.md", "grep -C 3 p README.md", "grep -C=3 p README.md",
    "grep --include=x p README.md", "grep", "grep p", "grep -e", "grep -- -x README.md", "grep -e x -e y README.md",
    "head -z README.md", "head -5 README.md", "head -n 5", "tail -f log", "tail -F log", "tail --follow log", "tail --pid=1 log",
    "tail -s 1 log", "wc --files0-from=x", "wc", "wc README.md --total=always",
  ],
  "B-17-integer-values": [
    "head -n x README.md", "head -n 99999999 README.md", "head -n README.md", "head -n -5 README.md", "head -n 1.5 README.md",
    "grep -A -1 p README.md", "grep -m x p README.md", "tail -c 1234567 README.md",
  ],
  "B-18-operand-shapes": [
    "cat *.md", "cat a?", "cat [ab]", "cat {a,b}", "cat ~/x", "cat ~", "cat $HOME/x", 'cat "$HOME"', "cat $'\x2f'", String.raw`cat a\ b`,
    "cat !$", "cat #x", "cat 'a b'", 'cat "a"', "cat 'x'", 'cat a"b"c', "cat -x", String.raw`cat C:\x`, String.raw`ls .\x`, "cat a\u2215b",
    "cat a\u0000b", "cat a\tb\u0007", "cat a;b", "cat a(b", "cat a<b", "cat a>b", "cat a|b", "cat a&b", "ls `x`",
    "cat a b", "cat a b c d e f g h", "cat a b c d e f g h i", "ls a b", "grep p a b", "wc -l a b", "head -n 1 a b", "tail -n 1 a b",
  ],
  "B-18b-grep-pattern-slot": ["grep * README.md", "grep [0-9] README.md", 'grep "$x" README.md', 'grep "a.*b" README.md', "grep '-x' README.md", "grep '' README.md", "grep -e '' README.md", "grep 'caf\u00e9' README.md"],
  "B-19-unterminated-quote": ["ls 'x", 'cat "x', "grep 'x README.md"],
  // Issue #436: a leading "//" is a UNC path on Windows (an SMB authentication vector); canonicalization would fold it to "/host/share".
  "B-21-unc-operands": ["cat //h/s/x", "cat //h", "cat //", "ls //h/s", "grep -r p //h/s", "grep p //h/s/x", "head -n 1 //h/s/x", "tail -n 1 //h/s/x", "wc -l //h/s/x", "cat \\\\h\\s\\x", "ls \\\\h\\s"],
  "B-20-colon-and-drive-forms": ["cat a:b", "cat c:x", "cat c:/x", "cat policy.json::data", "ls c:"],
};

export const DENY_ROWS: readonly { group: string; command: string }[] = Object.entries(DENY_GROUPS).flatMap(([group, rows]) => rows.map((command) => ({ group, command })));

/** Wrapper names the Manager's ruling 2 lists, plus a few from the existing catalog; the test adds WRAPPER_BINARY_NAMES. */
export const RULING_WRAPPER_NAMES: readonly string[] = [
  "env", "sh", "bash", "xargs", "command", "builtin", "exec", "nice", "nohup", "timeout", "stdbuf", "time", "sudo", "doas", "eval", "source", "at", "crontab",
];

/** Binaries that run config- or env-driven helper programs, or have a large bypass grammar: none may be a table key. */
export const CONFIG_EXEC_OR_BROAD_BINARIES: readonly string[] = [
  "git", "rg", "less", "man", "more", "vi", "vim", "nano", "ssh", "curl", "wget", "find", "sed", "awk", "perl", "python", "node", "npm",
];
