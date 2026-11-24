// superos-tools: MCP server over stdio (newline-delimited JSON-RPC 2.0) that exposes the named
// script tools in registry.ts. Only the tools listed in SUPEROS_TOOLS (comma-separated) are offered,
// so a run sees exactly the tools its policy allows. No tool gets a shell or a path from the caller.
import { createInterface } from "node:readline";
import { z } from "zod";
import { TOOLS, TOOLS_SERVER } from "./registry.ts";
import type { ScriptTool, ToolContext } from "./registry.ts";

const PROTOCOL = "2024-11-05";
const Rpc = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string().max(100), params: z.record(z.string(), z.unknown()).optional() });
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };
const ok = (id: Reply["id"], result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
const err = (id: Reply["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

export function handleToolMessage(offered: readonly ScriptTool[], ctx: ToolContext, line: unknown): Reply | null {
  const parsed = Rpc.safeParse(line);
  if (!parsed.success) return err(null, -32600, "Invalid request");
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;
  switch (method) {
    case "initialize": return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: TOOLS_SERVER, version: "0.1.0" } });
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: offered.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const call = z.object({ name: z.string().max(100), arguments: z.unknown().optional() }).safeParse(params);
      if (!call.success) return err(id, -32602, "Invalid params");
      const tool = offered.find((t) => t.name === call.data.name);
      if (!tool) return err(id, -32602, `Unknown tool: ${call.data.name.slice(0, 40)}`);
      const input = tool.input.safeParse(call.data.arguments ?? {});
      if (!input.success) return ok(id, text(`Invalid arguments: ${input.error.issues.map((i) => i.message).join("; ").slice(0, 200)}`, true));
      try { return ok(id, text(JSON.stringify(tool.run(input.data, ctx), null, 2))); } catch { return ok(id, text("That tool could not answer.", true)); }
    }
    default: return err(id, -32601, "Method not found");
  }
}

/** The tools named in a comma list, in registry order. Unknown names are ignored (the bridge already refused them). */
export function offeredTools(list: string | undefined): ScriptTool[] {
  const names = new Set((list ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return TOOLS.filter((t) => names.has(t.name));
}

if (import.meta.main) {
  const offered = offeredTools(process.env["SUPEROS_TOOLS"]);
  const ctx: ToolContext = { timezone: process.env["SUPEROS_TZ"] || "America/New_York", now: () => new Date(), vault: process.env["SUPEROS_VAULT"] ?? "", logDir: process.env["SUPEROS_LOGS"] ?? "" };
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (l) => {
    if (!l.trim()) return;
    let msg: unknown;
    try { msg = JSON.parse(l); } catch { process.stdout.write(JSON.stringify(err(null, -32700, "Parse error")) + "\n"); return; }
    const reply = handleToolMessage(offered, ctx, msg);
    if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
  });
}
