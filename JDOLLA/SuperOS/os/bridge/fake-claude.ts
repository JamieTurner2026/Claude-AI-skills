// Test stand-in for the Claude Code CLI. Speaks a small subset of --output-format stream-json.
// Behaviour is chosen by words in the request text: HANG (never finishes), FAIL (budget error),
// DELIVER (writes report.md in its working folder). It echoes its arguments so tests can check them.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const text = args[args.indexOf("-p") + 1] ?? "";
const out = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");

out({ type: "system", subtype: "init", cwd: process.cwd() });
out({ type: "assistant", message: { content: [{ type: "text", text: "ARGV:" + JSON.stringify(args) }] } });
out({ type: "assistant", message: { content: [{ type: "text", text: "CWD:" + process.cwd() }] } });

if (text.includes("HANG")) {
  setInterval(() => out({ type: "assistant", message: { content: [{ type: "text", text: "still working" }] } }), 200);
} else if (text.includes("FAIL")) {
  out({ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 0.05 });
  process.exitCode = 1;
} else {
  if (text.includes("DELIVER")) writeFileSync("report.md", "# Report\nMade by the stand-in.\n");
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }, { type: "text", text: "All done." }] } });
  out({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0123, result: "All done." });
}
