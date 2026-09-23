// Agent 2 (Extraction): takes a raw remittance
// PDF and returns structured payment data. Does not look at open items or
// make matching decisions (that's Agent 3, srv/agents/matching-agent.ts).

import { z } from 'zod';
import { extractDocument } from '../genai/index.js';

function normalizeValueDate(value: string): string | null {
  const trimmed = value.trim();

  // ISO 8601 (YYYY-MM-DD)
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (d.getUTCFullYear() === Number(year) && d.getUTCMonth() === Number(month) - 1 && d.getUTCDate() === Number(day)) {
      return trimmed;
    }
    return null;
  }

  // DD.MM.YYYY
  const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (d.getUTCFullYear() === Number(year) && d.getUTCMonth() === Number(month) - 1 && d.getUTCDate() === Number(day)) {
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  // DD Mon YYYY (e.g. 15 Jan 2026)
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const d = new Date(ts);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

export const ExtractedPaymentSchema = z.object({
  payer: z.string().trim().min(1, 'payer must be a non-empty string'),
  amount: z.number().finite('amount must be a finite number'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
  valueDate: z.string().transform((val, ctx) => {
    const normalized = normalizeValueDate(val);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'valueDate must be a valid date in ISO 8601 (YYYY-MM-DD), "DD Mon YYYY", or "DD.MM.YYYY" format',
      });
      return z.NEVER;
    }
    return normalized;
  }),
  references: z.array(z.string()),
  extractionConfidence: z.number().min(0, 'extractionConfidence must be a number between 0 and 1').max(1, 'extractionConfidence must be a number between 0 and 1'),
});

export type ExtractedPayment = z.infer<typeof ExtractedPaymentSchema>;

const EXTRACTION_PROMPT = `You are extracting structured payment data from a remittance advice, wire transfer confirmation, or check stub PDF.

Return ONLY a single JSON object, with no markdown code fences, no commentary, and no leading or trailing text. The JSON object must have exactly these fields:

{
  "payer": string — the name of the customer/party making the payment,
  "amount": number — the payment amount as a plain number, no currency symbols or thousands separators,
  "currency": string — the ISO 4217 currency code (e.g. "USD", "EUR"),
  "valueDate": string — the payment/value date in ISO 8601 format (YYYY-MM-DD) or DD Mon YYYY or DD.MM.YYYY,
  "references": string[] — any invoice numbers, PO numbers, or other reference identifiers mentioned in the document (empty array if none found),
  "extractionConfidence": number — your confidence that the extracted fields are correct, from 0 (not confident) to 1 (fully confident); use a low value if the document is ambiguous, low-quality, or missing fields rather than guessing
}

If a required field genuinely cannot be determined from the document, still return your best-supported value but reflect the uncertainty in extractionConfidence — do not fabricate a value with high confidence.`;

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

function validate(parsed: unknown): ExtractedPayment {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Extraction result is not a JSON object.');
  }

  const result = ExtractedPaymentSchema.safeParse(parsed);
  if (!result.success) {
    const errorDetails = result.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Extraction result failed validation: ${errorDetails}`);
  }

  return result.data;
}

export async function extractPayment(
  pdfBuffer: Buffer,
  extract: (pdfBuffer: Buffer, prompt: string) => Promise<string> = extractDocument,
): Promise<ExtractedPayment> {
  const raw = await extract(pdfBuffer, EXTRACTION_PROMPT);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    throw new Error(`Extraction result was not valid JSON: ${(err as Error).message}\nRaw response: ${raw}`);
  }

  return validate(parsed);
}