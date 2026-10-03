{
# hooks/launch-gate.sh (#308 story D, AP-13). Run as: sh "<this file>" "<gate script>". Maps every child status other than 0 and 2 to 2.
# The whole body is ONE compound command opened on line 1, so any truncation is a syntax error (exit 2); a 0-byte file is caught by the pinned hash.
# Scope: ambient and accidental launch faults. Limits are named in src/qa/gate-launcher.test.ts (X-8, SHELLOPTS=noexec, outer-shell levers, PATH node).
# The Windows root variables are checked here but NOT forwarded: the Git Bash (MSYS) runtime supplies the real value to the native child (#397).
set +e +u +x +v
unset -f env printf test '[' command true false 2>/dev/null
target=${1-}
[ -f "$target" ] || { printf 'launcher: target is not a file\n' >&2; exit 2; }
[ "${SYSTEMROOT+x}" ] && { [ -d "$SYSTEMROOT/System32" ] || { printf 'launcher: SYSTEMROOT does not name a Windows directory\n' >&2; exit 2; }; }
[ "${SystemRoot+x}" ] && { [ -d "$SystemRoot/System32" ] || { printf 'launcher: SystemRoot does not name a Windows directory\n' >&2; exit 2; }; }
[ "${WINDIR+x}" ] && { [ -d "$WINDIR/System32" ] || { printf 'launcher: WINDIR does not name a Windows directory\n' >&2; exit 2; }; }
[ "${windir+x}" ] && { [ -d "$windir/System32" ] || { printf 'launcher: windir does not name a Windows directory\n' >&2; exit 2; }; }
set --
[ "${CLAUDE_PROJECT_DIR+x}" ] && set -- "$@" "CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR"
/usr/bin/env -i PATH="$PATH" "$@" node -- "$target"
rc=$?
case $rc in 0|2) exit "$rc";; esac
printf 'launcher: child exit %s mapped to 2\n' "$rc" >&2
exit 2
}
