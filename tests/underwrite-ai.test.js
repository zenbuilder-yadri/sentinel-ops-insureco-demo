/**
 * UnderwriteAI Tests — SOE-358
 * 26 tests: positive (authorized) + negative (unauthorized)
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createStore, createAgents, evaluate, assertAllow, assertDeny, assertNotExecuted } from './helpers.js';

let store, agents;

beforeEach(() => {
  store = createStore();
  agents = createAgents(store);
});

// ── Positive Tests ───────────────────────────────────────────────────

describe('UnderwriteAI — Authorized Read', () => {
  it('can read customer top-level', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Read', { file_path: 'data/customers/CUST-001' }));
  });

  it('can read policies', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Read', { file_path: 'data/policies/POL-1001' }));
  });

  it('can read nested policy data', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Read', { file_path: 'data/policies/POL-1001/riders' }));
  });

  it('can read claims', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Read', { file_path: 'data/claims/CLM-5001' }));
  });
});

describe('UnderwriteAI — Authorized Write', () => {
  it('can write risk assessments', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Write', { file_path: 'data/risk-assessments/CUST-001-auto' }));
  });

  it('can write nested risk assessment', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Write', { file_path: 'data/risk-assessments/CUST-004-home/v2' }));
  });
});

describe('UnderwriteAI — scoreCustomer business logic', () => {
  it('scores low-risk customer (Alice, credit 742)', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    assert.equal(result.status, 'scored');
    assert.ok(result.scoring);
    assert.ok(result.scoring.riskCategory);
    assert.ok(result.scoring.factors.length > 0);
  });

  it('scores high-risk customer (Dimitri, credit 655, 7 claims)', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-004', 'auto');
    assert.equal(result.status, 'scored');
    assert.ok(result.scoring.riskScore > 50, 'High-risk customer should have score > 50');
  });

  it('includes explanation (Art.13 transparency)', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    assert.ok(result.scoring.explanation, 'Must include explanation');
    assert.ok(result.scoring.explanation.includes('factor'));
  });

  it('protectedCharacteristicsUsed is false (Art.10)', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    assert.equal(result.scoring.dataGovernance.protectedCharacteristicsUsed, false);
  });

  it('includes premium recommendation', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    const pr = result.scoring.premiumRecommendation;
    assert.ok(pr.basePremium > 0);
    assert.ok(pr.multiplier > 0);
    assert.ok(pr.recommendedPremium > 0);
  });

  it('includes factors considered list', async () => {
    const result = await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    assert.ok(result.scoring.dataGovernance.factorsConsidered.length > 0);
  });
});

// ── Negative Tests ───────────────────────────────────────────────────

describe('UnderwriteAI — Denied Read', () => {
  it('DENY read protected customer data', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Read', { file_path: 'data/customers/CUST-002/protected' }));
  });

  it('DENY read protected disability', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Read', { file_path: 'data/customers/CUST-002/protected/disability.json' }));
  });

  it('DENY read .env', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Read', { file_path: '.env' }));
  });

  it('DENY read credentials', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Read', { file_path: 'credentials.json' }));
  });

  it('DENY read cross-tenant', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Read', { file_path: 'tenants/other/data/customers/X' }));
  });
});

describe('UnderwriteAI — Denied Write', () => {
  it('DENY write claims', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('DENY write policies', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'data/policies/POL-1001' }));
  });

  it('DENY write customers', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'data/customers/CUST-001' }));
  });

  it('DENY write config', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'config/app.json' }));
  });

  it('DENY write system', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'system/core.js' }));
  });
});

describe('UnderwriteAI — Denied Bash', () => {
  it('DENY any bash command', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Bash', { command: 'whoami' }));
  });
});

describe('UnderwriteAI — attemptAccessProtectedData (deny path)', () => {
  it('protected data access is not executed', async () => {
    const result = await agents.underwriteAI.attemptAccessProtectedData('CUST-002');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
    assert.equal(result.output, null);
  });
});
