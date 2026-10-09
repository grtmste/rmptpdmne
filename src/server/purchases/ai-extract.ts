import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * Ostuarve / tšeki andmete tuvastus Claude'iga (PDF-id, ka skaneeritud, ja fotod).
 * Valikuline: töötab ainult siis, kui keskkonnas on ANTHROPIC_API_KEY. Dokument saadetakse
 * Anthropicu API-le; tulemus on ettepanek, mille kasutaja üle vaatab.
 */

export const aiExtractionEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5-5";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const nullableText = z.string().nullable();

export const AiInvoiceSchema = z.object({
  supplierName: nullableText.describe("Müüja (tarnija) nimi"),
  supplierRegCode: nullableText.describe("Müüja registrikood"),
  supplierVatNumber: nullableText.describe("Müüja KMKR number, nt EE123456789"),
  supplierIban: nullableText.describe("Müüja pangakonto IBAN ilma tühikuteta"),
  invoiceNumber: nullableText.describe("Arve või tšeki number"),
  invoiceDate: nullableText.describe("Kuupäev kujul YYYY-MM-DD"),
  dueDate: nullableText.describe("Maksetähtaeg kujul YYYY-MM-DD"),
  referenceNumber: nullableText.describe("Viitenumber"),
  currency: nullableText.describe("Valuuta ISO kood, nt EUR"),
  pricesIncludeVat: z.boolean().describe("Kas ridade hinnad sisaldavad käibemaksu (tšekkidel tavaliselt jah)"),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.string().describe("Kogus, punkt kümnendkohana"),
      unit: nullableText,
      unitPrice: z.string().describe("Ühiku hind, punkt kümnendkohana, ilma tuhandeliste eraldajata"),
      vatPct: nullableText.describe("Käibemaksu määr protsentides, nt 24"),
      itemCode: nullableText.describe("Artikli kood ettevõtte artiklite loetelust, kui rida vastab selgelt artiklile; muidu null"),
    }),
  ),
  netTotal: nullableText,
  vatTotal: nullableText,
  total: nullableText,
});

export type AiInvoice = z.infer<typeof AiInvoiceSchema>;

export class AiExtractError extends Error {
  constructor(public code: "aiNotConfigured" | "aiUnsupportedFile" | "aiRefused" | "aiFailed") {
    super(code);
    this.name = "AiExtractError";
  }
}

const SYSTEM = `Sa loed Eesti ettevõtte raamatupidamisse sisestatavat ostuarvet või kassatšekki.
Tagasta dokumendis olevad andmed täpselt nii, nagu need on dokumendil – ära arva ega arvuta puuduvaid väärtusi juurde.
- Ostja on raamatupidamist pidav ettevõte; ära tagasta ostja andmeid müüja (tarnija) väljadel.
- Kuupäevad kujul YYYY-MM-DD; summad ja kogused punktiga kümnendkohana, ilma tuhandeliste eraldajata.
- Ridadeks on dokumendi kauba- või teenuseread (mitte vahesummad, allahindluse kokkuvõtted ega maksmisviis).
- "KM", "km", "VAT", "ALV" tähendavad käibemaksu. Kui hinnad on käibemaksuga (tšekk), märgi pricesIncludeVat = true.
- itemCode täida ainult siis, kui rida vastab selgelt mõnele antud artiklile; kasuta täpselt selle koodi.`;

export async function aiExtractInvoice(input: {
  bytes: Buffer;
  mediaType: string;
  buyer: { name: string; regCode: string | null };
  items: Array<{ code: string; name: string }>;
}): Promise<AiInvoice> {
  if (!aiExtractionEnabled()) throw new AiExtractError("aiNotConfigured");
  const data = input.bytes.toString("base64");
  let source: Anthropic.Beta.BetaContentBlockParam;
  if (input.mediaType === "application/pdf") {
    source = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  } else if ((IMAGE_TYPES as readonly string[]).includes(input.mediaType)) {
    source = { type: "image", source: { type: "base64", media_type: input.mediaType as (typeof IMAGE_TYPES)[number], data } };
  } else {
    throw new AiExtractError("aiUnsupportedFile");
  }
  const catalog = input.items
    .slice(0, 300)
    .map((i) => `${i.code}\t${i.name}`)
    .join("\n");

  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AiInvoiceSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            source,
            {
              type: "text",
              text: `Ostja: ${input.buyer.name}${input.buyer.regCode ? ` (reg. kood ${input.buyer.regCode})` : ""}.\n\nEttevõtte artiklid (kood<TAB>nimetus):\n${catalog || "(artikleid pole)"}\n\nTuvasta dokumendi andmed.`,
            },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error(`AI tuvastus ebaõnnestus (${e.status}):`, e.message);
      throw new AiExtractError("aiFailed");
    }
    throw e;
  }
  if (response.stop_reason === "refusal") throw new AiExtractError("aiRefused");
  if (!response.parsed_output) throw new AiExtractError("aiFailed");
  return response.parsed_output;
}
