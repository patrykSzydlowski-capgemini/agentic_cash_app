// Agent 3 (Matching & open-item assessment) — pure, side-effect-free logic.
//
// Step 1: deterministic check. When the payment references open items and the
// currency, open item ids, company name and amount all agree, the match is
// certain (score 1.00, status `full`) and no LLM call is made.
// Step 2: otherwise the payment is compared against ALL open items. The LLM
// scores each plausible candidate on a 0–0.99 rubric (1.00 is reserved for
// the deterministic path); `heuristicFallbackScores` produces the same scale
// without an LLM when the model is unavailable or answers with garbage.
// Step 3: per open item, the matches from all payments are aggregated into
// the confidence that the item is paid (`aggregateOpenItemAssessment`).

import { amountsEqual, referencesContainId } from './matching-agent.js';
import { MATCH_STATUS, OPEN_ITEM_CLEARING_STATUS, type MatchStatus } from '../constants/index.js';

export interface AssessableOpenItem {
  openItemId: string;
  companyCode: string;
  customerAccount: string;
  customerName: string;
  invoiceAmount: number;
  invoiceAmountCurrency: string;
  clearingStatus: string;
}

export interface AssessablePayment {
  payer: string;
  companyCode?: string | null;
  amount: number;
  currency: string;
  valueDate?: string | null;
  references: string[];
}

export interface ScoredCandidate {
  openItemId: string;
  companyCode: string;
  customerAccount: string;
  amount: number;
  currency: string;
  matchStatus: MatchStatus;
  matchScore: number;
  rationale: string;
}

export type ExactMatchResult =
  | { matched: true; candidates: ScoredCandidate[] }
  | { matched: false; problems: string[] };

/** Highest score the AI (or the heuristic) may give; 1.00 means deterministic. */
export const MAX_AI_SCORE = 0.99;
/** Cap for candidates that are neither referenced nor from a similar company. */
export const UNRELATED_CANDIDATE_CAP = 0.45;
/** Max number of open items sent to the LLM per payment. */
export const MAX_AI_CANDIDATES = 25;

const LEGAL_SUFFIXES = new Set([
  'inc', 'ltd', 'llc', 'gmbh', 'sp', 'z', 'o', 'oo', 'sa', 'ag', 'corp', 'corporation',
  'co', 'company', 'plc', 'limited', 'kg', 'bv', 'nv', 'srl', 'sarl', 'spa', 'us',
]);

export function normalizeCompanyName(name: string | null | undefined): string {
  const tokens = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Strip legal-form tokens only from the end so names like "Co-op Stores" survive.
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, '');
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient over character bigrams of normalized names (0..1). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let overlap = 0;
  let total = 0;
  for (const count of leftGrams.values()) total += count;
  for (const [gram, count] of rightGrams) {
    total += count;
    overlap += Math.min(count, leftGrams.get(gram) ?? 0);
  }
  return total === 0 ? 0 : (2 * overlap) / total;
}

export function companyNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCompanyName(a);
  return left !== '' && left === normalizeCompanyName(b);
}

export function clampAiScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(MAX_AI_SCORE, Math.max(0, n)) * 100) / 100;
}

export function statusFromScore(score: number, deterministic = false): MatchStatus {
  if (deterministic && score >= 1) return MATCH_STATUS.FULL;
  if (score >= 0.85) return MATCH_STATUS.PROBABLE;
  if (score > 0) return MATCH_STATUS.TO_BE_CHECKED;
  return MATCH_STATUS.NO_MATCH;
}

const fmt = (amount: number, currency: string) => `${Number(amount).toFixed(2)} ${currency}`;

function sumAmounts(items: AssessableOpenItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.invoiceAmount || 0), 0);
}

export function referencedOpenItems(payment: AssessablePayment, openItems: AssessableOpenItem[]): AssessableOpenItem[] {
  const refs = payment.references ?? [];
  return openItems.filter((item) => referencesContainId(refs, item.openItemId));
}

/**
 * 100 % rule: the payment references open items, every referenced item is
 * still OPEN, currencies agree, the referenced amounts add up to the payment
 * amount, and the payer is the open items' customer (and company code, when
 * extracted, agrees).
 */
export function checkExactMatch(payment: AssessablePayment, openItems: AssessableOpenItem[]): ExactMatchResult {
  const referenced = referencedOpenItems(payment, openItems);
  const problems: string[] = [];

  if ((payment.references ?? []).length === 0) problems.push('awizo nie zawiera numerów pozycji otwartych');
  else if (referenced.length === 0) problems.push(`żaden z numerów (${payment.references.join(', ')}) nie istnieje w S/4HANA`);

  if (referenced.length > 0) {
    const cleared = referenced.filter((item) => item.clearingStatus === OPEN_ITEM_CLEARING_STATUS.CLEARED);
    if (cleared.length > 0) problems.push(`pozycje ${cleared.map((i) => i.openItemId).join(', ')} są już rozliczone`);

    const wrongCurrency = referenced.filter((item) => item.invoiceAmountCurrency !== payment.currency);
    if (wrongCurrency.length > 0) {
      problems.push(`waluta płatności ${payment.currency} różni się od waluty pozycji (${wrongCurrency.map((i) => `${i.openItemId}: ${i.invoiceAmountCurrency}`).join(', ')})`);
    }

    const total = sumAmounts(referenced);
    if (!amountsEqual(total, payment.amount)) {
      problems.push(`kwota płatności ${fmt(payment.amount, payment.currency)} różni się od sumy pozycji ${fmt(total, referenced[0].invoiceAmountCurrency)}`);
    }

    const otherCustomers = referenced.filter((item) => !companyNamesMatch(payment.payer, item.customerName));
    if (otherCustomers.length > 0) {
      problems.push(`nazwa płatnika „${payment.payer}” nie zgadza się z klientem (${[...new Set(otherCustomers.map((i) => i.customerName))].join(', ')})`);
    }

    const code = payment.companyCode?.trim();
    if (code) {
      const otherCodes = referenced.filter((item) => item.companyCode && item.companyCode !== code);
      if (otherCodes.length > 0) problems.push(`kod spółki ${code} różni się od kodu pozycji (${otherCodes.map((i) => i.companyCode).join(', ')})`);
    }
  }

  if (problems.length > 0) return { matched: false, problems };

  const ids = referenced.map((item) => item.openItemId).join(', ');
  const rationale = referenced.length === 1
    ? `Pełne dopasowanie: numer pozycji ${ids}, kwota ${fmt(payment.amount, payment.currency)}, waluta i klient „${referenced[0].customerName}” zgadzają się z S/4HANA.`
    : `Pełne dopasowanie: płatność pokrywa pozycje ${ids}; suma ${fmt(payment.amount, payment.currency)}, waluta i klient zgadzają się z S/4HANA.`;

  return {
    matched: true,
    candidates: referenced.map((item) => ({
      openItemId: item.openItemId,
      companyCode: item.companyCode,
      customerAccount: item.customerAccount,
      amount: Number(item.invoiceAmount),
      currency: item.invoiceAmountCurrency,
      matchStatus: MATCH_STATUS.FULL,
      matchScore: 1,
      rationale,
    })),
  };
}

export interface HeuristicScore {
  score: number;
  reason: string;
}

/**
 * Rule-based scores on the same 0–0.99 scale as the AI rubric. Used when the
 * LLM is unavailable and to pre-rank which open items are sent to the LLM.
 */
export function heuristicFallbackScores(payment: AssessablePayment, openItems: AssessableOpenItem[]): Map<string, HeuristicScore> {
  const scores = new Map<string, HeuristicScore>();
  const open = openItems.filter((item) => item.clearingStatus !== OPEN_ITEM_CLEARING_STATUS.CLEARED);
  const referenced = referencedOpenItems(payment, open);
  // Several referenced items in the payment currency that add up to the payment
  // amount count as an amount match for each of them.
  const referencedSameCurrency = referenced.filter((item) => item.invoiceAmountCurrency === payment.currency);
  const referencedSumMatches = referencedSameCurrency.length > 1 && amountsEqual(sumAmounts(referencedSameCurrency), payment.amount);

  for (const item of open) {
    const isReferenced = referenced.includes(item);
    const sameCurrency = item.invoiceAmountCurrency === payment.currency;
    const amountMatches = sameCurrency && (amountsEqual(item.invoiceAmount, payment.amount) || (isReferenced && referencedSumMatches));
    const partial = sameCurrency && !amountMatches && payment.amount > 0 && payment.amount < item.invoiceAmount;
    const similarity = nameSimilarity(payment.payer, item.customerName);
    const nameMatches = similarity >= 0.8;

    let result: HeuristicScore | undefined;
    if (isReferenced) {
      if (amountMatches && nameMatches) result = { score: 0.95, reason: 'numer pozycji, kwota i waluta zgadzają się; drobna różnica w danych płatnika' };
      else if (amountMatches) result = { score: 0.6, reason: `numer pozycji i kwota zgadzają się, ale płatnik „${payment.payer}” różni się od klienta „${item.customerName}”` };
      else if (partial) result = { score: 0.5, reason: `płatność częściowa: ${fmt(payment.amount, payment.currency)} z ${fmt(item.invoiceAmount, item.invoiceAmountCurrency)}` };
      else if (!sameCurrency) result = { score: 0.4, reason: `numer pozycji zgadza się, ale waluta ${payment.currency} ≠ ${item.invoiceAmountCurrency}` };
      else result = { score: 0.3, reason: `numer pozycji zgadza się, ale kwota ${fmt(payment.amount, payment.currency)} przekracza ${fmt(item.invoiceAmount, item.invoiceAmountCurrency)}` };
    } else if (nameMatches && amountMatches) {
      result = { score: 0.85, reason: 'brak numeru pozycji w awizo, ale klient, kwota i waluta zgadzają się' };
    } else if (nameMatches && partial) {
      result = { score: 0.4, reason: `brak numeru pozycji; ten sam klient, możliwa płatność częściowa ${fmt(payment.amount, payment.currency)} z ${fmt(item.invoiceAmount, item.invoiceAmountCurrency)}` };
    } else if (amountMatches) {
      result = { score: 0.3, reason: 'zgadza się tylko kwota i waluta; numer pozycji i klient są inne' };
    } else if (nameMatches) {
      result = { score: 0.2, reason: 'zgadza się tylko klient; kwota i numer pozycji są inne' };
    }
    if (result) scores.set(item.openItemId, result);
  }
  return scores;
}

/** Open items worth sending to the LLM: highest heuristic pre-score first. */
export function selectAiCandidates(payment: AssessablePayment, openItems: AssessableOpenItem[], limit = MAX_AI_CANDIDATES): AssessableOpenItem[] {
  const heuristic = heuristicFallbackScores(payment, openItems);
  return openItems
    .filter((item) => item.clearingStatus !== OPEN_ITEM_CLEARING_STATUS.CLEARED)
    .map((item) => ({ item, rank: (heuristic.get(item.openItemId)?.score ?? 0) + nameSimilarity(payment.payer, item.customerName) * 0.1 }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ item }) => item);
}

export interface MatchingPromptContext {
  emailSubject?: string | null;
  emailBody?: string | null;
  problems?: string[];
}

export function buildMatchingPrompt(payment: AssessablePayment, candidates: AssessableOpenItem[], context: MatchingPromptContext = {}): string {
  const paymentJson = JSON.stringify({
    payer: payment.payer,
    companyCode: payment.companyCode || undefined,
    amount: payment.amount,
    currency: payment.currency,
    valueDate: payment.valueDate || undefined,
    references: payment.references ?? [],
  });
  const candidateJson = JSON.stringify(candidates.map((item) => ({
    openItemId: item.openItemId,
    customerName: item.customerName,
    customerAccount: item.customerAccount,
    companyCode: item.companyCode,
    amount: Number(item.invoiceAmount),
    currency: item.invoiceAmountCurrency,
  })));
  const body = (context.emailBody ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500);

  return `You are an accounts-receivable cash-application agent. Decide which SAP open items (unpaid invoices) the incoming payment pays, and how confident you are that each open item can be cleared with it.

Payment advice (extracted from the remittance PDF):
${paymentJson}
${context.emailSubject ? `Email subject: "${context.emailSubject}"\n` : ''}${body ? `Email body (excerpt): "${body}"\n` : ''}${context.problems?.length ? `Deterministic check failed because: ${context.problems.join('; ')}.\n` : ''}
Candidate open items from SAP S/4HANA:
${candidateJson}

Score every candidate that the payment plausibly pays with a confidence between 0 and 0.99 (never 1.0 — exact matches are handled before you):
- 0.95–0.99: everything agrees except a trivial difference (typo or legal-suffix difference in the company name, reference written differently), or the item is fully paid by this payment together with the other referenced items.
- 0.85–0.94: very likely paid, one small inconsistency that a human would accept.
- around 0.50: partial payment — the right item and customer but only part of the amount.
- 0.10–0.49: some evidence but uncertain (wrong currency, wrong or missing open item id with a similar amount, similar but different company).
- below 0.10: no real evidence — omit such candidates.
Consider typos in the company name, partial payments, wrong currency, wrong or transposed open item ids, and one payment covering several open items (their amounts add up to the payment amount).

Return ONLY a JSON object, no markdown, in this shape:
{"matches":[{"openItemId":"<id from the list>","confidence":0.0,"reason":"<one sentence in Polish>"}],"rationale":"<2-3 sentences in Polish explaining the decision>"}
Use "matches": [] when no candidate is plausibly paid.`;
}

export interface AiMatch {
  openItemId: string;
  confidence: number;
  reason: string;
}

export interface AiMatchingResponse {
  matches: AiMatch[];
  rationale: string;
}

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

/** Returns null when the model did not answer in the expected shape (caller falls back to heuristics). */
export function parseAiMatchingResponse(raw: string, validIds: Iterable<string>): AiMatchingResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      parsed = JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { matches?: unknown }).matches)) return null;

  const allowed = new Set(validIds);
  const seen = new Set<string>();
  const matches: AiMatch[] = [];
  for (const entry of (parsed as { matches: unknown[] }).matches) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { openItemId, confidence, reason } = entry as Record<string, unknown>;
    const id = String(openItemId ?? '').trim();
    if (!allowed.has(id) || seen.has(id)) continue;
    const score = clampAiScore(confidence);
    if (score <= 0) continue;
    seen.add(id);
    matches.push({ openItemId: id, confidence: score, reason: typeof reason === 'string' ? reason.trim() : '' });
  }
  const rationale = typeof (parsed as { rationale?: unknown }).rationale === 'string' ? (parsed as { rationale: string }).rationale.trim() : '';
  return { matches, rationale };
}

/**
 * Guardrail on top of the model: a candidate that is neither referenced in the
 * advice nor billed to a similarly named customer cannot be "very likely paid".
 */
export function applyScoreGuardrails(payment: AssessablePayment, item: AssessableOpenItem, score: number): number {
  const clamped = clampAiScore(score);
  const referenced = referencesContainId(payment.references ?? [], item.openItemId);
  if (!referenced && nameSimilarity(payment.payer, item.customerName) < 0.5) return Math.min(clamped, UNRELATED_CANDIDATE_CAP);
  return clamped;
}

export function toCandidate(item: AssessableOpenItem, score: number, rationale: string): ScoredCandidate {
  return {
    openItemId: item.openItemId,
    companyCode: item.companyCode,
    customerAccount: item.customerAccount,
    amount: Number(item.invoiceAmount),
    currency: item.invoiceAmountCurrency,
    matchStatus: statusFromScore(score),
    matchScore: score,
    rationale,
  };
}

/**
 * Share of a payment attributed to one of its matched open items. A payment
 * with one match counts fully; a payment split over several items is spread
 * proportionally to the item amounts (never more than each item amount).
 */
export function allocatePaymentAmount(paymentAmount: number, itemAmount: number, allMatchedItemAmounts: number[]): number {
  if (allMatchedItemAmounts.length <= 1) return Number(paymentAmount) || 0;
  const total = allMatchedItemAmounts.reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total <= 0) return 0;
  const ratio = Math.min(1, (Number(paymentAmount) || 0) / total);
  return Math.round(Number(itemAmount) * ratio * 100) / 100;
}

export interface OpenItemMatchEvidence {
  payer: string;
  paymentAmount: number;
  allocatedAmount: number;
  currency: string;
  matchScore: number;
  matchStatus: string;
  rationale: string;
}

export interface OpenItemAssessment {
  aiConfidence: number;
  aiMatchStatus: MatchStatus;
  aiRationale: string;
  matchedPaymentCount: number;
  matchedAmount: number;
}

/** Confidence that the open item is paid, combining the matches of all payments. */
export function aggregateOpenItemAssessment(item: AssessableOpenItem, evidence: OpenItemMatchEvidence[]): OpenItemAssessment {
  const relevant = evidence.filter((e) => Number(e.matchScore) > 0);
  if (relevant.length === 0) {
    return {
      aiConfidence: 0,
      aiMatchStatus: MATCH_STATUS.NO_MATCH,
      aiRationale: 'Brak awizo płatności wskazującego na tę pozycję — według dostępnych maili pozycja nie została opłacona.',
      matchedPaymentCount: 0,
      matchedAmount: 0,
    };
  }

  const sorted = [...relevant].sort((a, b) => Number(b.matchScore) - Number(a.matchScore));
  const best = sorted[0];
  const sameCurrency = relevant.filter((e) => e.currency === item.invoiceAmountCurrency);
  const matchedAmount = Math.round(sameCurrency.reduce((sum, e) => sum + Number(e.allocatedAmount || 0), 0) * 100) / 100;

  let confidence = Number(best.matchScore);
  let status: MatchStatus = best.matchStatus === MATCH_STATUS.FULL && confidence >= 1 ? MATCH_STATUS.FULL : statusFromScore(Math.min(confidence, MAX_AI_SCORE));
  const lines = [`${best.payer}: ${fmt(best.paymentAmount, best.currency)} (${Math.round(confidence * 100)}%) — ${best.rationale}`];

  const contributors = sameCurrency.filter((e) => Number(e.matchScore) >= 0.4);
  if (contributors.length >= 2 && amountsEqual(contributors.reduce((sum, e) => sum + Number(e.allocatedAmount || 0), 0), item.invoiceAmount)) {
    const allFull = contributors.every((e) => e.matchStatus === MATCH_STATUS.FULL && Number(e.matchScore) >= 1);
    confidence = allFull ? 1 : Math.max(Math.min(confidence, MAX_AI_SCORE), 0.97);
    status = allFull ? MATCH_STATUS.FULL : MATCH_STATUS.PROBABLE;
    lines.push(`Pozycja opłacona w ${contributors.length} płatnościach, łącznie ${fmt(matchedAmount, item.invoiceAmountCurrency)}.`);
  } else if (sorted.length > 1) {
    lines.push(`Inne płatności wskazujące na tę pozycję: ${sorted.slice(1).map((e) => `${e.payer} ${fmt(e.paymentAmount, e.currency)} (${Math.round(Number(e.matchScore) * 100)}%)`).join('; ')}.`);
  }

  return {
    aiConfidence: Math.round(confidence * 100) / 100,
    aiMatchStatus: status,
    aiRationale: lines.join('\n'),
    matchedPaymentCount: relevant.length,
    matchedAmount,
  };
}
