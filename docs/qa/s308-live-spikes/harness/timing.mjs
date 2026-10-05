// Per-run: arrival times (ms from the first stream line) of hook_started / hook_response / tool_result lines.
import { readFileSync } from "node:fs";
for (const id of process.argv.slice(2)) {
  const { times } = JSON.parse(readFileSync(new URL(`../raw/${id}.times.json`, import.meta.url), "utf8"));
  const pick = (re) => times.filter((x) => re.test(x.head));
  const hs = pick(/hook_started/), hr = pick(/hook_response/);
  console.log(id, "lines", times.length, "hook_started@", hs.map((x) => x.t - times[0].t), "hook_response@", hr.map((x) => x.t - times[0].t), "started->response ms:", hr.map((r, i) => r.t - (hs[i] ?? hs[0]).t));
}
