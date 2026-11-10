import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { mcpHandler } from "../worker/mcp";

export function mcpClient(handler = mcpHandler) {
  let sequence = 0;
  const exchanges: { request: string; response: string }[] = [];
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const request = JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params });
    const ctx = createExecutionContext();
    const response = await handler(env)(
      new Request("https://blog.example.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: request,
      }),
      env,
      ctx
    );
    const body = await response.text();
    await waitOnExecutionContext(ctx);
    if (!response.ok) throw new Error(`${response.status}: ${body}`);
    const message = JSON.parse(
      body.startsWith("{")
        ? body
        : body
            .split("\n")
            .find((line) => line.startsWith("data: "))!
            .slice(6)
    );
    exchanges.push({ request, response: JSON.stringify(message) });
    return message;
  }
  async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const message = await rpc("tools/call", { name, arguments: args });
    if (message.error) throw new Error(JSON.stringify(message.error));
    if (message.result.isError) throw new Error(message.result.content[0].text);
    return JSON.parse(message.result.content[0].text) as T;
  }
  return { rpc, call, exchanges };
}
