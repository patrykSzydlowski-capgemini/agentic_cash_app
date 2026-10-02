/**
 * Centralized Enterprise Constants for CashSync Service
 * Modeled after enterprise CAP best practices (DHL template benchmark)
 */

export const PAYMENT_STATUS = Object.freeze({
    PENDING: 'pending',
    EXTRACTED: 'extracted',
    MATCHED: 'matched',
    NEEDS_REVIEW: 'needsReview',
    CLEARED: 'cleared',
    FAILED: 'failed'
} as const);

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

export const PROPOSED_MATCH_STATUS = Object.freeze({
    APPROVED: 'approved',
    PENDING: 'pending',
    REJECTED: 'rejected',
    POSTED: 'posted'
} as const);

export type ProposedMatchStatus = typeof PROPOSED_MATCH_STATUS[keyof typeof PROPOSED_MATCH_STATUS];

export const MATCH_RESULT_STATUS = Object.freeze({
    MATCHED: 'MATCHED',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    PENDING: 'PENDING',
    REJECTED: 'REJECTED'
} as const);

export const REVIEW_STATUS = Object.freeze({
    APPROVED: 'APPROVED',
    PENDING: 'PENDING',
    REJECTED: 'REJECTED',
    MANUAL_REVIEW: 'MANUAL_REVIEW'
} as const);

export const CRITICALITY = Object.freeze({
    NEUTRAL: 0,
    NEGATIVE: 1, // Red
    CRITICAL: 2, // Yellow/Orange
    POSITIVE: 3  // Green
} as const);

export const SOURCE_SYSTEM = Object.freeze({
    S4: 'S4',
    S4_OPENITEM: 'S4_OPENITEM',
    LOCAL: 'LOCAL'
} as const);

export const AI_MODELS = Object.freeze({
    DEFAULT: 'gemini-2.5-flash',
    MOCK: 'mock-deterministic'
} as const);

export const CONFIDENCE_THRESHOLDS = Object.freeze({
    AGENT_MATCH: 0.80,
    AI_EVALUATION: 0.85,
    LOW: 0.60
} as const);
