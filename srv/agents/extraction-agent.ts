// Agent 2 (Extraction) — see CLAUDE.md §Architecture. Takes a raw remittance
// PDF and returns structured payment data. Does not look at open items or
// make matching decisions (that's Agent 3, srv/agents/matching-agent.ts).

import { extractDocument } from '../genai/index.js';

export interface ExtractedPayment {
  payer: string;
  amount: number;
  currency: string;
  valueDate: string;
  references: string[];
  extractionConfidence: number;
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Accepts the three formats the prompt allows the model to return
// (ISO 8601, "DD Mon YYYY", "DD.MM.YYYY") and normalizes to ISO 8601
// (YYYY-MM-DD) so every consumer downstream sees one consistent shape.
function normalizeValueDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return isValidCalendarDate(Number(year), Number(month), Number(day)) ? trimmed : null;
  }

  const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    return isValidCalendarDate(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : null;
  }

  const withMonthName = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (withMonthName) {
    const [, day, monthName, year] = withMonthName;
    const month = MONTH_ABBREVIATIONS[monthName.slice(0, 3).toLowerCase()];
    if (!month) return null;
    const paddedDay = day.padStart(2, '0');
    return isValidCalendarDate(Number(year), Number(month), Number(paddedDay))
      ? `${year}-${month}-${paddedDay}`
      : null;
  }

  return null;
}

function validate(parsed: unknown): ExtractedPayment {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Extraction result is not a JSON object.');
  }

  const candidate = parsed as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(candidate.payer)) errors.push('payer must be a non-empty string');
  if (!isFiniteNumber(candidate.amount)) errors.push('amount must be a finite number');
  if (!(typeof candidate.currency === 'string' && /^[A-Z]{3}$/.test(candidate.currency))) {
    errors.push('currency must be a 3-letter ISO 4217 code');
  }
  const normalizedValueDate = normalizeValueDate(candidate.valueDate);
  if (normalizedValueDate === null) {
    errors.push('valueDate must be a valid date in ISO 8601 (YYYY-MM-DD), "DD Mon YYYY", or "DD.MM.YYYY" format');
  }
  if (!isStringArray(candidate.references)) errors.push('references must be an array of strings');
  if (!(isFiniteNumber(candidate.extractionConfidence) && candidate.extractionConfidence >= 0 && candidate.extractionConfidence <= 1)) {
    errors.push('extractionConfidence must be a number between 0 and 1');
  }

  if (errors.length > 0) {
    throw new Error(`Extraction result failed validation: ${errors.join('; ')}`);
  }

  return {
    payer: candidate.payer as string,
    amount: candidate.amount as number,
    currency: candidate.currency as string,
    valueDate: normalizedValueDate as string,
    references: candidate.references as string[],
    extractionConfidence: candidate.extractionConfidence as number,
  };
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