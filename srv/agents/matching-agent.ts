// Agent 3 (Matching): takes a structured
// payment (Agent 2's output) and the customer's open items, and returns
// proposed matches with a status and rationale. Does not write to S/4 or
// decide to post — that's after human approval.
//
// Deterministic scoring (amount/reference comparison) handles the clear
// cases entirely in code, with no LLM call. The LLM is only invoked for the
// ambiguous branch: when no open item is directly referenced in the payment,
// fuzzy-matching payment.payer against candidate CustomerNames is a genuine
// language judgment, and that same call also produces the human-readable
// rationale for that branch. Clear (reference-based) cases get a rationale
// generated directly from the deterministic reasoning — no LLM round trip
// needed to explain an exact-amount, exact-reference match.

import { z } from 'zod';
import { generateText } from '../genai/index.js';
import type { OpenItem } from '../s4/open-items-client.js';
import type { ExtractedPayment } from './extraction-agent.js';

export interface ProposedMatchCandidate {
  openItemId: string;
  companyCode: string;
  // Carried straight through from the matched open item so the approve()
  // action has everything postClearing needs without a second read.
  customerAccount: string;
  amount: number;
  currency: string;
  matchStatus: 'full' | 'probable' | 'toBeChecked' | 'noMatch';
  matchScore: number;
  rationale: string;
}

function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

function referencesContainId(references: string[], openItemId: string): boolean {
  if (!openItemId.trim()) return false;
  const needle = openItemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp(`(^|[^a-z0-9_-])${needle}($|[^a-z0-9_-])`, 'i');
  return references.some((ref) => token.test(ref));
}

function noMatchCandidate(rationale: string): ProposedMatchCandidate {
  return { openItemId: '', companyCode: '', customerAccount: '', amount: 0, currency: '', matchStatus: 'noMatch', matchScore: 0, rationale };
}

function carriedFields(item: OpenItem): Pick<ProposedMatchCandidate, 'customerAccount' | 'amount' | 'currency'> {
  return { customerAccount: item.customerAccount, amount: item.invoiceAmount, currency: item.invoiceAmountCurrency };
}

function scoreSingleReferencedItem(payment: ExtractedPayment, item: OpenItem): ProposedMatchCandidate {
  const sameCurrency = item.invoiceAmountCurrency === payment.currency;

  if (!sameCurrency) {
    return {
      openItemId: item.openItemId,
      companyCode: item.companyCode,
      ...carriedFields(item),
      matchStatus: 'toBeChecked',
      matchScore: 0.5,
      rationale: `Open item ${item.openItemId} is referenced in the payment, but its currency (${item.invoiceAmountCurrency}) differs from the payment's (${payment.currency}) — needs manual review.`,
    };
  }

  if (amountsEqual(item.invoiceAmount, payment.amount)) {
    return {
      openItemId: item.openItemId,
      companyCode: item.companyCode,
      ...carriedFields(item),
      matchStatus: 'full',
      matchScore: 1,
      rationale: `Open item ${item.openItemId} is referenced in the payment and its amount (${item.invoiceAmount.toFixed(2)} ${item.invoiceAmountCurrency}) matches the payment exactly.`,
    };
  }

  if (payment.amount < item.invoiceAmount) {
    const pct = ((payment.amount / item.invoiceAmount) * 100).toFixed(0);
    return {
      openItemId: item.openItemId,
      companyCode: item.companyCode,
      ...carriedFields(item),
      matchStatus: 'toBeChecked',
      matchScore: 0.5,
      rationale: `Open item ${item.openItemId} is referenced in the payment, but the payment amount (${payment.amount.toFixed(2)} ${payment.currency}) is only ${pct}% of the open item's amount (${item.invoiceAmount.toFixed(2)} ${item.invoiceAmountCurrency}) — looks like a partial payment (${pct}%), not a full match.`,
    };
  }

  const pct = ((payment.amount / item.invoiceAmount) * 100).toFixed(0);
  return {
    openItemId: item.openItemId,
    companyCode: item.companyCode,
    ...carriedFields(item),
    matchStatus: 'toBeChecked',
    matchScore: 0.5,
    rationale: `Open item ${item.openItemId} is referenced in the payment, but the payment amount (${payment.amount.toFixed(2)} ${payment.currency}) is ${pct}% of the open item's amount (${item.invoiceAmount.toFixed(2)} ${item.invoiceAmountCurrency}) — payment exceeds open item (${pct}%), looks like an overpayment, not a full match.`,
  };
}

function scoreMultiItemReferenced(payment: ExtractedPayment, items: OpenItem[]): ProposedMatchCandidate[] {
  const sameCurrency = items.every((item) => item.invoiceAmountCurrency === payment.currency);
  const sum = items.reduce((total, item) => total + item.invoiceAmount, 0);
  const ids = items.map((item) => item.openItemId).join(', ');

  if (sameCurrency && amountsEqual(sum, payment.amount)) {
    return items.map((item) => ({
      openItemId: item.openItemId,
      companyCode: item.companyCode,
      ...carriedFields(item),
      matchStatus: 'full' as const,
      matchScore: 1,
      rationale: `Payment references multiple open items (${ids}) whose amounts sum to ${sum.toFixed(2)} ${payment.currency}, matching the payment amount exactly.`,
    }));
  }

  const sumDescription = sameCurrency ? `${sum.toFixed(2)} ${payment.currency}` : `${sum.toFixed(2)} (mixed currencies)`;
  return items.map((item) => ({
    openItemId: item.openItemId,
    companyCode: item.companyCode,
    ...carriedFields(item),
    matchStatus: 'toBeChecked' as const,
    matchScore: 0.5,
    rationale: `Payment references multiple open items (${ids}), but their amounts sum to ${sumDescription}, which does not match the payment amount of ${payment.amount.toFixed(2)} ${payment.currency} — needs manual review.`,
  }));
}

interface CustomerCandidate {
  customerAccount: string;
  customerName: string;
}

function uniqueCustomers(items: OpenItem[]): CustomerCandidate[] {
  const seen = new Map<string, CustomerCandidate>();
  for (const item of items) {
    if (!seen.has(item.customerAccount)) {
      seen.set(item.customerAccount, { customerAccount: item.customerAccount, customerName: item.customerName });
    }
  }
  return [...seen.values()];
}

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

const PayerResolutionSchema = z.object({
  matchedCustomerAccounts: z.array(z.string(), {
    message: 'Payer resolution result: matchedCustomerAccounts must be an array of strings.',
  }),
  rationale: z.string().trim().min(1, 'Payer resolution result: rationale must be a non-empty string.'),
});

type PayerResolution = z.infer<typeof PayerResolutionSchema>;

function buildPayerResolutionPrompt(payer: string, candidates: CustomerCandidate[]): string {
  const candidateList = candidates.map((c) => `- ${c.customerAccount}: "${c.customerName}"`).join('\n');

  return `You are resolving which customer a payment came from, for accounts-receivable cash application matching.

Payment payer name, as extracted from a remittance document (it may be misspelled, abbreviated, or a person's name rather than the legal entity name): "${payer}"

Candidate customers with open items in S/4:
${candidateList}

Decide which of these customers, if any, plausibly match the payer name above — accounting for abbreviations, legal suffixes (e.g. "GmbH", "Ltd", "Inc"), minor misspellings, or a person's name that could plausibly belong to that company. Do not guess a match unless it is well-supported; if nothing plausibly matches, return an empty array.

Return ONLY a single JSON object, with no markdown code fences, no commentary, and no leading or trailing text:
{
  "matchedCustomerAccounts": string[],
  "rationale": string
}

"matchedCustomerAccounts" must contain only customerAccount values copied exactly from the candidate list above (empty array if none plausibly match). "rationale" is one or two sentences explaining your reasoning, written for a human reviewer.`;
}

function parsePayerResolution(raw: string, validAccounts: Set<string>): PayerResolution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    throw new Error(`Payer resolution result was not valid JSON: ${(err as Error).message}\nRaw response: ${raw}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Payer resolution result is not a JSON object.');
  }

  const result = PayerResolutionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid payer resolution result.');
  }

  const candidate = result.data;
  const unknownAccounts = candidate.matchedCustomerAccounts.filter((account) => !validAccounts.has(account));
  if (unknownAccounts.length > 0) {
    throw new Error(`Payer resolution result referenced unknown customer account(s): ${unknownAccounts.join(', ')}`);
  }

  return candidate;
}

async function resolveByPayerFuzzyMatch(payment: ExtractedPayment, items: OpenItem[], complete: typeof generateText): Promise<ProposedMatchCandidate[]> {
  if (items.length === 0) {
    return [noMatchCandidate('No open items are available to match against.')];
  }

  const candidates = uniqueCustomers(items);
  const raw = await complete(buildPayerResolutionPrompt(payment.payer, candidates));
  const resolved = parsePayerResolution(raw, new Set(candidates.map((c) => c.customerAccount)));

  if (resolved.matchedCustomerAccounts.length === 0) {
    return [noMatchCandidate(resolved.rationale)];
  }

  const matchedAccounts = new Set(resolved.matchedCustomerAccounts);
  const candidateItems = items.filter((item) => matchedAccounts.has(item.customerAccount));

  if (resolved.matchedCustomerAccounts.length === 1 && candidateItems.length === 1) {
    const item = candidateItems[0];
    const sameCurrency = item.invoiceAmountCurrency === payment.currency;
    if (sameCurrency && amountsEqual(item.invoiceAmount, payment.amount)) {
      return [{
        openItemId: item.openItemId,
        companyCode: item.companyCode,
        ...carriedFields(item),
        matchStatus: 'probable',
        matchScore: 0.75,
        rationale: resolved.rationale,
      }];
    }
  }

  return candidateItems.map((item) => ({
    openItemId: item.openItemId,
    companyCode: item.companyCode,
    ...carriedFields(item),
    matchStatus: 'toBeChecked' as const,
    matchScore: 0.35,
    rationale: resolved.rationale,
  }));
}

export async function proposeMatches(
  payment: ExtractedPayment,
  openItems: OpenItem[],
  complete: typeof generateText = generateText,
): Promise<ProposedMatchCandidate[]> {
  // Open items already being handled elsewhere are excluded entirely, not
  // just deprioritized.
  const eligibleItems = openItems.filter((item) => item.clearingStatus !== 'IN PROCESS');

  const referencedItems = eligibleItems.filter((item) => referencesContainId(payment.references, item.openItemId));

  if (referencedItems.length > 1) {
    return scoreMultiItemReferenced(payment, referencedItems);
  }

  if (referencedItems.length === 1) {
    return [scoreSingleReferencedItem(payment, referencedItems[0])];
  }

  return resolveByPayerFuzzyMatch(payment, eligibleItems, complete);
}