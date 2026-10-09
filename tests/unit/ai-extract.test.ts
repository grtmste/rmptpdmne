import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** AI-tuvastuse päringu kuju ja vastuse parsimine kohaliku võltsserveriga (päris API-t ei kutsuta). */
let server: http.Server;
let lastBody: Record<string, unknown> | null = null;
let lastHeaders: http.IncomingHttpHeaders = {};

const parsed = {
  supplierName: "Rimi Eesti Food AS",
  supplierRegCode: "10263574",
  supplierVatNumber: "EE100359216",
  supplierIban: null,
  invoiceNumber: "12345",
  invoiceDate: "2026-10-01",
  dueDate: null,
  referenceNumber: null,
  currency: "EUR",
  pricesIncludeVat: true,
  lines: [{ description: "Kohv", quantity: "2", unit: "tk", unitPrice: "3.49", vatPct: "24", itemCode: null }],
  netTotal: "5.63",
  vatTotal: "1.35",
  total: "6.98",
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      lastHeaders = req.headers;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(parsed) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
});

describe("AI-tuvastus", () => {
  it("saadab pildi, ostja ja artiklid ning parsib vastuse", async () => {
    const { aiExtractInvoice } = await import("@/server/purchases/ai-extract");
    const r = await aiExtractInvoice({
      bytes: Buffer.from("fake-jpeg"),
      mediaType: "image/jpeg",
      buyer: { name: "Lilleaed OÜ", regCode: "16000001" },
      items: [{ code: "MULD", name: "Muld 50 l" }],
    });
    expect(r.supplierName).toBe("Rimi Eesti Food AS");
    expect(r.lines[0]!.unitPrice).toBe("3.49");
    const body = lastBody as { model: string; fallbacks: string; output_config: { format: { type: string } }; messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(String(lastHeaders["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0]!.content[0]!.type).toBe("image");
    expect(body.messages[0]!.content[1]!.text).toContain("MULD\tMuld 50 l");
    expect(body.messages[0]!.content[1]!.text).toContain("16000001");
  });

  it("toetamata failitüüp", async () => {
    const { aiExtractInvoice, AiExtractError } = await import("@/server/purchases/ai-extract");
    await expect(aiExtractInvoice({ bytes: Buffer.from("x"), mediaType: "image/heic", buyer: { name: "X", regCode: null }, items: [] })).rejects.toBeInstanceOf(AiExtractError);
  });
});
