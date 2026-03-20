/**
 * Test Framework & Helpers — SOE-356
 * Shared utilities for InsureCo SOE test suite.
 *
 * Provides: createStore(), evaluate() direct caller, agent factories,
 * assertion helpers.
 *
 * All tests run with SOE_MODE=local — no API dependency.
 */

import { strict as assert } from 'node:assert';
import { DataStore } from '../platform/data/seed.js';
import { evaluate, guardedAction } from '../platform/soe-client.js';
import { ClaimsBot } from '../platform/agents/claims-bot/index.js';
import { UnderwriteAI } from '../platform/agents/underwrite-ai/index.js';
import { FraudHunter } from '../platform/agents/fraud-hunter/index.js';
import { PolicyAdvisor } from '../platform/agents/policy-advisor/index.js';

// Force local mode
process.env.SOE_MODE = 'local';

/** Create a fresh DataStore for test isolation. */
export function createStore() {
  return new DataStore();
}

/** Create all 4 agent instances with a shared store. */
export function createAgents(store) {
  return {
    claimsBot: new ClaimsBot(store),
    underwriteAI: new UnderwriteAI(store),
    fraudHunter: new FraudHunter(store),
    policyAdvisor: new PolicyAdvisor(store),
  };
}

/** Direct evaluate call — tests SOE rules without agent business logic. */
export { evaluate, guardedAction };

// ── Assertion helpers ────────────────────────────────────────────────

export function assertAllow(result, msg) {
  assert.equal(result.decision, 'allow', msg || `Expected allow, got ${result.decision}: ${result.reason}`);
}

export function assertDeny(result, msg) {
  assert.equal(result.decision, 'deny', msg || `Expected deny, got ${result.decision}: ${result.reason}`);
}

export function assertExecuted(result, msg) {
  assert.equal(result.executed, true, msg || 'Expected executed=true');
}

export function assertNotExecuted(result, msg) {
  assert.equal(result.executed, false, msg || 'Expected executed=false');
}

export function assertDecision(result, expected, msg) {
  assert.equal(result.decision, expected, msg || `Expected ${expected}, got ${result.decision}`);
}
