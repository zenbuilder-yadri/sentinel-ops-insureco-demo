/**
 * PolicyAdvisor Tests — SOE-360
 * 38 tests: positive (authorized) + negative (unauthorized)
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

describe('PolicyAdvisor — Authorized Read', () => {
  it('can read customer top-level', async () => {
    assertAllow(await evaluate('policy-advisor', 'Read', { file_path: 'data/customers/CUST-001' }));
  });

  it('can read policies', async () => {
    assertAllow(await evaluate('policy-advisor', 'Read', { file_path: 'data/policies/POL-1001' }));
  });

  it('can read nested policy data', async () => {
    assertAllow(await evaluate('policy-advisor', 'Read', { file_path: 'data/policies/POL-1001/details' }));
  });
});

describe('PolicyAdvisor — answerQuestion business logic', () => {
  it('answers coverage question', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'What is my coverage?');
    assert.equal(result.status, 'answered');
    assert.ok(result.response.answer);
    assert.equal(result.response.context, 'coverage-inquiry');
  });

  it('answers premium question', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'What is my premium?');
    assert.equal(result.status, 'answered');
    assert.equal(result.response.context, 'premium-inquiry');
  });

  it('answers renewal question', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'Is my policy expiring soon?');
    assert.equal(result.status, 'answered');
    assert.equal(result.response.context, 'renewal-inquiry');
  });

  it('handles general question', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'Hello, I need help');
    assert.equal(result.status, 'answered');
    assert.equal(result.response.context, 'general');
  });

  it('includes AI disclosure (Art.52)', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'What is my coverage?');
    assert.ok(result.response.aiDisclosure);
    assert.ok(result.response.aiDisclosure.includes('AI'));
  });

  it('all steps go through SOE gate', async () => {
    const result = await agents.policyAdvisor.answerQuestion('CUST-001', 'coverage');
    assert.ok(result.steps.length >= 2);
    for (const step of result.steps) {
      assert.ok(step.evaluation);
    }
  });
});

// ── Negative Tests ───────────────────────────────────────────────────

describe('PolicyAdvisor — Denied Read (claims, fraud, risk)', () => {
  it('DENY read claims', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/claims/CLM-5001' }));
  });

  it('DENY read claims wildcard', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/claims/any-claim' }));
  });

  it('DENY read fraud flags', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('DENY read risk assessments', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/risk-assessments/CUST-001-auto' }));
  });

  it('DENY read protected customer data', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/customers/CUST-001/protected' }));
  });

  it('DENY read nested protected data', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'data/customers/CUST-001/protected/ethnicity' }));
  });

  it('DENY read .env', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: '.env' }));
  });

  it('DENY read credentials', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'credentials.json' }));
  });

  it('DENY read secrets', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'secrets.yaml' }));
  });

  it('DENY read cross-tenant', async () => {
    assertDeny(await evaluate('policy-advisor', 'Read', { file_path: 'tenants/other/data/policies/X' }));
  });
});

describe('PolicyAdvisor — Denied Write (everything)', () => {
  it('DENY write policies (writeDeny=**)', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/policies/POL-1001' }));
  });

  it('DENY write claims', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('DENY write customers', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/customers/CUST-001' }));
  });

  it('DENY write fraud flags', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('DENY write risk assessments', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/risk-assessments/X' }));
  });

  it('DENY write config', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'config/app.json' }));
  });

  it('DENY write system', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'system/core.js' }));
  });

  it('DENY write arbitrary path', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'anything/anywhere' }));
  });
});

describe('PolicyAdvisor — Denied Edit (everything)', () => {
  it('DENY edit policies', async () => {
    assertDeny(await evaluate('policy-advisor', 'Edit', { file_path: 'data/policies/POL-1001' }));
  });

  it('DENY edit claims', async () => {
    assertDeny(await evaluate('policy-advisor', 'Edit', { file_path: 'data/claims/CLM-5001' }));
  });
});

describe('PolicyAdvisor — Denied Bash', () => {
  it('DENY cat /etc/passwd', async () => {
    assertDeny(await evaluate('policy-advisor', 'Bash', { command: 'cat /etc/passwd' }));
  });

  it('DENY harmless ls', async () => {
    assertDeny(await evaluate('policy-advisor', 'Bash', { command: 'ls' }));
  });
});

describe('PolicyAdvisor — Unknown tools (fail-closed)', () => {
  it('DENY Execute tool', async () => {
    assertDeny(await evaluate('policy-advisor', 'Execute', { command: 'run something' }));
  });

  it('DENY Delete tool', async () => {
    assertDeny(await evaluate('policy-advisor', 'Delete', { file_path: 'data/policies/POL-1001' }));
  });

  it('DENY Spawn tool', async () => {
    assertDeny(await evaluate('policy-advisor', 'Spawn', { agent: 'rogue-agent' }));
  });
});

describe('PolicyAdvisor — attempt methods (deny paths)', () => {
  it('attemptWritePolicy is not executed', async () => {
    const result = await agents.policyAdvisor.attemptWritePolicy('POL-1001', { premium: 100 });
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
  });

  it('attemptReadClaims is not executed', async () => {
    const result = await agents.policyAdvisor.attemptReadClaims('CUST-001');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
  });

  it('attemptBashCommand is not executed', async () => {
    const result = await agents.policyAdvisor.attemptBashCommand('cat /etc/passwd');
    assertNotExecuted(result);
    assert.equal(result.evaluation.decision, 'deny');
  });
});
