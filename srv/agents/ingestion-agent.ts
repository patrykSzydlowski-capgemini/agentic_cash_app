import cds from '@sap/cds';
import { z } from 'zod';
import { generateTextWithUsage } from '../genai/index.js';
import type { TokenUsage } from '../genai/types.js';
import {
  listUnreadMailboxMessages,
  type MailboxAttachment,
  type MailboxMessage,
} from '../connectors/mailbox-client.js';
import { CLASSIFICATION_DECISION, type ClassificationDecision } from '../constants/index.js';

const LOG = cds.log('ingestion-agent');

export interface IngestionItemResult {
  messageId: string;
  subject: string;
  from: string;
  classification: ClassificationDecision;
  reason: string;
  pdfAttachments: Array<{ filename: string; content: Buffer }>;
  tokenUsage?: TokenUsage;
  model?: string;
  isDuplicate?: boolean;
}

export interface IngestionAgentDeps {
  listMessages: () => Promise<MailboxMessage[]>;
  hasLoggedMessage: (messageId: string) => Promise<boolean>;
  generateTextWithUsage: typeof generateTextWithUsage;
}

const ClassificationSchema = z.object({
  classification: z.enum(['relevant', 'notRelevant', 'needsReview']),
  reason: z.string().min(1, 'Reason must be a non-empty string'),
});

function isPdfAttachment(attachment: MailboxAttachment): boolean {
  return (
    attachment.contentType === 'application/pdf' ||
    /\.pdf$/i.test(attachment.filename)
  );
}

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text.trim();
}

const CLASSIFICATION_PROMPT = `You are an AI Cash Application Ingestion Agent in SAP.
Decide whether this email is a customer payment remittance advice, wire transfer confirmation, or check stub that should be processed for automated cash matching.
You are given the email's subject, sender, and body text only — no attachment content.

Return ONLY a single valid JSON object (no markdown, no quotes, no commentary):
{
  "classification": "relevant" | "notRelevant" | "needsReview",
  "reason": "one concise sentence explaining the decision"
}

Decision Guidelines:
- "relevant": Clearly a payment remittance advice, payment confirmation, wire transfer notice, or check stub intended for Accounts Receivable.
- "notRelevant": Marketing, newsletters, spam, internal notifications, or an invoice being sent TO the customer.
- "needsReview": Ambiguous, missing clear context, or uncertain. Never guess if signal is weak.`;

function buildPrompt(message: MailboxMessage): string {
  return `${CLASSIFICATION_PROMPT}

Email Details:
From: ${message.from}
Subject: ${message.subject}
Body:
${message.bodyText.slice(0, 2000)}`;
}

function parseClassification(raw: string): { classification: ClassificationDecision; reason: string } {
  try {
    const cleaned = stripCodeFence(raw);
    const parsed = JSON.parse(cleaned);
    const validated = ClassificationSchema.parse(parsed);
    return {
      classification: validated.classification as ClassificationDecision,
      reason: validated.reason,
    };
  } catch (err) {
    LOG.warn(`[IngestionAgent] Failed to parse classification JSON: ${(err as Error).message}. Raw: ${raw}`);
    return {
      classification: CLASSIFICATION_DECISION.NEEDS_REVIEW,
      reason: `Classification response could not be parsed: ${(err as Error).message}`,
    };
  }
}

/**
 * Deterministic heuristic fallback when AI call fails or is unreachable.
 */
function heuristicFallback(message: MailboxMessage): { classification: ClassificationDecision; reason: string } {
  const text = `${message.subject} ${message.bodyText}`.toLowerCase();
  const keywords = ['remittance', 'payment', 'płatność', 'przelew', 'advice', 'settlement', 'überweisung', 'aviso'];
  const hasKeyword = keywords.some((kw) => text.includes(kw));

  if (hasKeyword) {
    return {
      classification: CLASSIFICATION_DECISION.RELEVANT,
      reason: 'Heuristic keyword match for payment remittance (deterministic fallback).',
    };
  }

  return {
    classification: CLASSIFICATION_DECISION.NOT_RELEVANT,
    reason: 'Heuristic rule: no payment or remittance keywords detected (deterministic fallback).',
  };
}

/**
 * Agent 1 (Ingestion): Lists unread emails, skips messages without PDFs,
 * filters duplicates BEFORE calling AI, qualifies with AI Classifier,
 * and extracts relevant PDF attachments.
 */
export async function classifyMailboxItems(deps: IngestionAgentDeps): Promise<IngestionItemResult[]> {
  const messages = await deps.listMessages();
  const results: IngestionItemResult[] = [];

  LOG.info(`[IngestionAgent] Processing ${messages.length} message(s) from mailbox connector.`);

  for (const message of messages) {
    // 1. Early deduplication: check IngestionLog before invoking LLM
    if (message.messageId && (await deps.hasLoggedMessage(message.messageId))) {
      LOG.info(`[IngestionAgent] Message ${message.messageId} already processed — skipping LLM evaluation.`);
      results.push({
        messageId: message.messageId,
        subject: message.subject,
        from: message.from,
        classification: CLASSIFICATION_DECISION.NOT_RELEVANT,
        reason: 'Message already processed in previous ingestion run (deduplicated).',
        pdfAttachments: [],
        isDuplicate: true,
      });
      continue;
    }

    // 2. Deterministic pre-filter: messages with no PDF attachments are ignored
    const pdfAttachments = (message.attachments || []).filter(isPdfAttachment);
    if (pdfAttachments.length === 0) {
      LOG.info(`[IngestionAgent] Message "${message.subject}" has no PDF attachments — ignoring without LLM.`);
      continue;
    }

    // 3. AI classification of email intent
    let classification: ClassificationDecision;
    let reason: string;
    let tokenUsage: TokenUsage | undefined;
    let modelName: string | undefined;

    try {
      const prompt = buildPrompt(message);
      const aiResponse = await deps.generateTextWithUsage(prompt);
      const parsed = parseClassification(aiResponse.content);
      classification = parsed.classification;
      reason = parsed.reason;
      tokenUsage = aiResponse.usage;
      modelName = aiResponse.model;
    } catch (aiErr) {
      LOG.warn(`[IngestionAgent] GenAI classification failed for "${message.subject}": ${(aiErr as Error).message}. Using heuristic fallback.`);
      const fallback = heuristicFallback(message);
      classification = fallback.classification;
      reason = fallback.reason;
    }

    results.push({
      messageId: message.messageId,
      subject: message.subject,
      from: message.from,
      classification,
      reason,
      tokenUsage,
      model: modelName,
      pdfAttachments:
        classification === CLASSIFICATION_DECISION.RELEVANT
          ? pdfAttachments.map((a) => ({ filename: a.filename, content: a.content }))
          : [],
      isDuplicate: false,
    });
  }

  return results;
}
