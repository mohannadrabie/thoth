// J6 / J6a local timing (no live Claude call): wall time per invocation of the gate, three launch forms, allow and deny input.
// Forms: direct (node <gate>), launcher (sh <launcher> <gate>), execenv (env -i PATH=... sh <launcher> <gate>).
// Usage: THOTH_REPO=<repo> node j6-timing.mjs [N]
import { spawnSync } from "node:child_process";
const REPO = process.env.THOTH_REPO.replaceAll("\\", "/");
const GATE = `${REPO}/hooks/pretooluse-kernel-gate.mjs`;
const LAUNCHER = `${REPO}/hooks/launch-gate.sh`;
const N = Number(process.argv[2] ?? 40);
const input = (command) => JSON.stringify({ session_id: "j6", cwd: REPO, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "j6" });
const forms = {
  direct: ["node", [GATE]],
  launcher: ["sh", [LAUNCHER, GATE]],
  execenv: ["env", ["-i", "PATH=/usr/bin:/bin:/c/PROGRA~1/nodejs", "sh", LAUNCHER, GATE]],
};
const cases = { allow: "kubectl get pods/x --context=c", deny: "ls" };
const pct = (a, p) => a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
const out = [];
for (const [cn, cmd] of Object.entries(cases)) {
  for (const [fn, [bin, args]] of Object.entries(forms)) {
    const ts = [];
    let verdict = "";
    for (let i = 0; i < N + 2; i++) {
      const t0 = performance.now();
      const r = spawnSync(bin, args, { input: input(cmd), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO } });
      const dt = performance.now() - t0;
      if (i >= 2) ts.push(dt); // two warm-up runs dropped
      verdict = `exit=${String(r.status)} ${r.stdout.includes('"deny"') ? "deny-json" : r.stdout.length === 0 ? "silent" : "other"}`;
    }
    ts.sort((a, b) => a - b);
    out.push({ case: cn, form: fn, n: ts.length, verdict, min: +ts[0].toFixed(1), p50: +pct(ts, 50).toFixed(1), p95: +pct(ts, 95).toFixed(1), p99: +pct(ts, 99).toFixed(1), max: +ts[ts.length - 1].toFixed(1) });
  }
}
console.log(JSON.stringify(out, null, 1));
