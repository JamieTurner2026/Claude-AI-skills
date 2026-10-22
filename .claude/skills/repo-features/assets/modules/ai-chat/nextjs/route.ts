// app/api/chat/route.ts: server-side Anthropic call. Key stays on the server (ANTHROPIC_API_KEY in Vercel env).
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });

  const { messages, system } = (await req.json()) as {
    messages?: { role: "user" | "assistant"; content: string }[];
    system?: string;
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages }),
  });
  const data = await upstream.json();
  if (!upstream.ok) return Response.json({ error: data?.error?.message ?? "upstream error" }, { status: 502 });
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return Response.json({ text });
}
