/**
 * ClaimsBot Tests — SOE-357
 * 31 tests: positive (authorized) + negative (unauthorized)
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createStore, createAgents, evaluate, assertAllow, assertDeny, assertExecuted, assertNotExecuted } from './helpers.js';

let store, agents;

beforeEach(() => {
  store = createStore();
  agents = createAgents(store);
});

// ── Positive Tests (Authorized) ──────────────────────────────────────

describe('ClaimsBot — Authorized Read', () => {
  it('can read claims data', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/claims/CLM-5001' });
    assertAllow(r);
  });

  it('can read claims with wildcard path', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/claims/any-claim' });
    assertAllow(r);
  });

  it('can read policies', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/policies/POL-1001' });
    assertAllow(r);
  });

  it('can read nested policy data', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/policies/POL-1001/details' });
    assertAllow(r);
  });

  it('can read customer top-level', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001' });
    assertAllow(r);
  });
});

describe('ClaimsBot — Authorized Write', () => {
  it('can write claims data', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'data/claims/CLM-5001' });
    assertAllow(r);
  });

  it('can write fraud flags', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'data/fraud-flags/CLM-5001' });
    assertAllow(r);
  });
});

describe('ClaimsBot — processClaim business logic', () => {
  it('auto-approves small claim (CLM-5001, €2,800 < €5,000)', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5001');
    assert.equal(result.status, 'approve');
    assert.ok(result.decision);
    assert.equal(result.decision.action, 'approve');
  });

  it('auto-approves tiny windshield claim (CLM-5005, €800)', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5005');
    assert.equal(result.status, 'approve');
    assert.equal(result.decision.action, 'approve');
  });

  it('escalates large claim (CLM-5002, €12,500 > €5,000)', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5002');
    assert.equal(result.status, 'escalate');
    assert.equal(result.decision.action, 'escalate');
    assert.ok(result.decision.reason.includes('Art. 14'));
  });

  it('escalates very large claim (CLM-5004, €45,000 > €5,000)', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5004');
    assert.equal(result.status, 'escalate');
    assert.equal(result.decision.action, 'escalate');
  });

  it('all processClaim steps go through SOE gate', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5001');
    assert.ok(result.steps.length >= 4, `Expected at least 4 steps, got ${result.steps.length}`);
    for (const step of result.steps) {
      assert.ok(step.evaluation, 'Each step must have an evaluation');
      assert.ok(step.evaluation.decision, 'Each evaluation must have a decision');
    }
  });
});

// ── Negative Tests (Unauthorized) ────────────────────────────────────

describe('ClaimsBot — Denied Read', () => {
  it('DENY read protected customer data', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001/protected' });
    assertDeny(r);
  });

  it('DENY read nested protected data (ethnicity)', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001/protected/ethnicity' });
    assertDeny(r);
  });

  it('DENY read cross-tenant data', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'tenants/acme/data/claims/CLM-1' });
    assertDeny(r);
  });

  it('DENY read .env file', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: '.env' });
    assertDeny(r);
  });

  it('DENY read config/.env.production', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'config/.env.production' });
    assertDeny(r);
  });

  it('DENY read credentials.json', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'credentials.json' });
    assertDeny(r);
  });

  it('DENY read secrets.yaml', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: 'secrets.yaml' });
    assertDeny(r);
  });
});

describe('ClaimsBot — Denied Write', () => {
  it('DENY write policies', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'data/policies/POL-1001' });
    assertDeny(r);
  });

  it('DENY write customer data', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'data/customers/CUST-001' });
    assertDeny(r);
  });

  it('DENY write risk assessments', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'data/risk-assessments/CUST-001-auto' });
    assertDeny(r);
  });

  it('DENY write config', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'config/app.json' });
    assertDeny(r);
  });

  it('DENY write system', async () => {
    const r = await evaluate('claims-bot', 'Write', { file_path: 'system/core.js' });
    assertDeny(r);
  });
});

describe('ClaimsBot — Denied Bash', () => {
  it('DENY any bash command', async () => {
    const r = await evaluate('claims-bot', 'Bash', { command: 'ls -la' });
    assertDeny(r);
  });

  it('DENY dangerous bash command', async () => {
    const r = await evaluate('claims-bot', 'Bash', { command: 'rm -rf /' });
    assertDeny(r);
  });
});

describe('ClaimsBot — attemptReadProtectedData (deny path)', () => {
  it('protected data read is not executed', async () => {
    const result = await agents.claimsBot.attemptReadProtectedData('CUST-001');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
    assert.equal(result.output, null);
  });
});
