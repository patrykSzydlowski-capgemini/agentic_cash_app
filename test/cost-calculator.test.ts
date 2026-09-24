import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTokenCost, calculateCapacityUnits } from '../srv/genai/cost-calculator.js';

test('calculateTokenCost: gemini-2.5-flash pricing', () => {
    // 10,000 prompt tokens + 1,000 completion tokens
    // Prompt: 10000 * 0.075 / 1M = 0.00075
    // Completion: 1000 * 0.30 / 1M = 0.0003
    // Total = 0.00105 -> rounded to 0.0011 or 0.001
    const cost = calculateTokenCost('gemini-2.5-flash', 10000, 1000);
    assert.equal(cost, 0.0011);
});

test('calculateCapacityUnits: gemini-2.5-flash CU schedule', () => {
    // 10,000 prompt tokens * 0.10 / 1M = 0.0010 CU
    // 1,000 completion tokens * 0.40 / 1M = 0.0004 CU
    // Total = 0.0014 CU
    const cu = calculateCapacityUnits('gemini-2.5-flash', 10000, 1000);
    assert.equal(cu, 0.0014);
});

test('calculateCapacityUnits: claude-3-5-sonnet CU schedule', () => {
    // 10,000 prompt * 3.00 / 1M = 0.03 CU
    // 1,000 completion * 15.00 / 1M = 0.015 CU
    // Total = 0.045 CU
    const cu = calculateCapacityUnits('anthropic--claude-3.5-sonnet', 10000, 1000);
    assert.equal(cu, 0.045);
});

test('calculateTokenCost: anthropic--claude-4.5-sonnet pricing', () => {
    // 10,000 prompt tokens + 1,000 completion tokens
    // Prompt: 10000 * 3.00 / 1M = 0.03
    // Completion: 1000 * 15.00 / 1M = 0.015
    // Total = 0.045
    const cost = calculateTokenCost('anthropic--claude-4.5-sonnet', 10000, 1000);
    assert.equal(cost, 0.045);
});

test('calculateTokenCost: anthropic--claude-3.5-sonnet with dots matches claude-3-5-sonnet', () => {
    const cost = calculateTokenCost('anthropic--claude-3.5-sonnet', 10000, 1000);
    assert.equal(cost, 0.045);
});

test('calculateTokenCost: claude-3.5-haiku pricing', () => {
    // 10,000 prompt tokens * 0.80 / 1M = 0.008
    // 1,000 completion tokens * 4.00 / 1M = 0.004
    // Total = 0.012
    const cost = calculateTokenCost('claude-3.5-haiku', 10000, 1000);
    assert.equal(cost, 0.012);
});

test('calculateTokenCost: fallback model pricing', () => {
    const cost = calculateTokenCost('unknown-future-model', 10000, 1000);
    assert.ok(cost > 0);
});

