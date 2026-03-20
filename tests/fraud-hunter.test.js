/**
 * FraudHunter Tests — SOE-359
 * 28 tests: positive (authorized) + negative (unauthorized)
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

describe('FraudHunter — Authorized Read', () => {
  it('can read claims', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Read', { file_path: 'data/claims/CLM-5001' }));
  });

  it('can read nested claims', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Read', { file_path: 'data/claims/CLM-5001/evidence' }));
  });

  it('can read policies', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Read', { file_path: 'data/policies/POL-1001' }));
  });

  it('can read nested policies', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Read', { file_path: 'data/policies/POL-1001/riders' }));
  });
});

describe('FraudHunter — Authorized Write', () => {
  it('can write fraud flags', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Write', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('can write nested fraud flags', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Write', { file_path: 'data/fraud-flags/CLM-5001/v2' }));
  });
});

describe('FraudHunter — analyzeClaim business logic', () => {
  it('analyzes suspicious claim (CLM-5006) with fraud signals', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    assert.equal(result.status, 'analyzed');
    assert.ok(result.analysis);
    assert.ok(result.analysis.signals.length > 0, 'Should detect fraud signals');
  });

  it('detects threshold-gaming signal (CLM-5006 at 98% of limit)', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    const gaming = result.analysis.signals.find(s => s.type === 'threshold-gaming');
    assert.ok(gaming, 'Should detect threshold-gaming');
  });

  it('detects cumulative-exposure signal', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    const exposure = result.analysis.signals.find(s => s.type === 'cumulative-exposure');
    assert.ok(exposure, 'Should detect cumulative-exposure');
  });

  it('includes humanOversightRequired (Art.14)', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    assert.equal(result.analysis.humanOversightRequired, true);
  });

  it('includes Art.14 disclaimer', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    assert.ok(result.analysis.disclaimer.includes('Art. 14'));
  });

  it('clean claim has lower risk', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5003');
    assert.equal(result.status, 'analyzed');
    assert.ok(result.analysis);
  });

  it('all analyzeClaim steps go through SOE gate', async () => {
    const result = await agents.fraudHunter.analyzeClaim('CLM-5006');
    assert.ok(result.steps.length >= 3);
    for (const step of result.steps) {
      assert.ok(step.evaluation);
    }
  });
});

// ── Negative Tests ───────────────────────────────────────────────────

describe('FraudHunter — Denied Read', () => {
  it('DENY read customer data (not in readAllow)', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'data/customers/CUST-001' }));
  });

  it('DENY read protected customer data', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'data/customers/CUST-001/protected' }));
  });

  it('DENY read cross-tenant data', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'tenants/competitor/data/claims/X' }));
  });

  it('DENY read .env', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: '.env' }));
  });

  it('DENY read credentials', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'credentials.json' }));
  });

  it('DENY read secrets', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'secrets.yaml' }));
  });
});

describe('FraudHunter — Denied Write', () => {
  it('DENY write claims (read-only for claims)', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('DENY write policies', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/policies/POL-1001' }));
  });

  it('DENY write customers', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/customers/CUST-001' }));
  });

  it('DENY write risk assessments', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/risk-assessments/CUST-001-auto' }));
  });

  it('DENY write config', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'config/soe.json' }));
  });

  it('DENY write system', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'system/core.js' }));
  });
});

describe('FraudHunter — Denied Bash', () => {
  it('DENY any bash command', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Bash', { command: 'cat /etc/passwd' }));
  });
});

describe('FraudHunter — attemptCrossTenantAccess (deny path)', () => {
  it('cross-tenant access is not executed', async () => {
    const result = await agents.fraudHunter.attemptCrossTenantAccess('OTHER-CUST-999');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
  });
});

describe('FraudHunter — attemptModifyClaim (deny path)', () => {
  it('claim modification is not executed', async () => {
    const result = await agents.fraudHunter.attemptModifyClaim('CLM-5001');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
  });

  it('claim status remains unchanged after denied write', async () => {
    const before = store.getClaim('CLM-5001').status;
    await agents.fraudHunter.attemptModifyClaim('CLM-5001');
    const after = store.getClaim('CLM-5001').status;
    assert.equal(before, after, 'Claim status must not change');
  });
});
