import { beforeAll, beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { mcpClient } from "./mcp-client";
import { benchmarkContent as content } from "./mcp-benchmark-fixture";
import baseline from "./fixtures/mcp-baseline.json";
import optimized from "./fixtures/mcp-optimized.json";

beforeAll(async () => {
  await env.DB.exec(env.MIGRATION.replace(/\n/g, " "));
});
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM contents"), env.DB.prepare("DELETE FROM search_index")]);
});

it("reduces schema and workflow JSON budgets, including every continuation call", async () => {
  const client = mcpClient();
  const size = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
  const schema = (await client.rpc("tools/list")).result;
  const schemaBytes = size(schema);
  const measure = () => ({
    calls: client.exchanges.length,
    inputBytes: client.exchanges.reduce((n, x) => n + size(x.request), 0),
    outputBytes: client.exchanges.reduce((n, x) => n + size(x.response), 0),
  });
  client.exchanges.length = 0;
  type Receipt = { id: string; version: number };
  type Read = Receipt & { revisionId: string; markdown: string; nextOffset: number | null };
  const created = await client.call<Receipt>("write_content", { action: "create", kind: "post", content });
  await client.call("publication", { action: "publish", id: created.id, expectedVersion: created.version });
  const createPublish = measure();
  client.exchanges.length = 0;
  await client.call("read_content", { action: "list", query: "Benchmark" });
  const first = await client.call<Read>("read_content", { action: "get", id: created.id });
  const searchReadFirstPage = measure();
  let current = first;
  let markdown = first.markdown;
  while (current.nextOffset !== null) {
    current = await client.call<Read>("read_content", { action: "revision", revisionId: first.revisionId, offset: current.nextOffset });
    markdown += current.markdown;
  }
  expect(markdown).toBe(content.markdown);
  const searchRead = measure();
  client.exchanges.length = 0;
  const draft = await client.call<Read>("read_content", { action: "get", id: created.id });
  await client.call("write_content", {
    action: "update",
    id: created.id,
    expectedVersion: draft.version,
    replacements: [{ oldText: "Paragraf lama.", newText: "Paragraf baru." }],
  });
  const editParagraph = measure();
  expect(schema.tools).toHaveLength(12);
  expect(schemaBytes).toBeLessThan(baseline.schemaBytes);
  expect(createPublish.outputBytes).toBeLessThan(baseline.createPublish.outputBytes * 0.1);
  expect(editParagraph.inputBytes + editParagraph.outputBytes).toBeLessThan((baseline.editParagraph.inputBytes + baseline.editParagraph.outputBytes) * 0.2);
  expect(searchRead.inputBytes + searchRead.outputBytes).toBeLessThan(baseline.searchRead.inputBytes + baseline.searchRead.outputBytes);
  expect({ toolCount: schema.tools.length, schemaBytes, createPublish, searchReadFirstPage, searchRead, editParagraph }).toEqual(optimized);
});
