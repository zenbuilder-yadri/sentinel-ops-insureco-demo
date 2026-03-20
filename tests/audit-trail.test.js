/**
 * Audit Trail Tests — SOE-362
 * 20 tests: allowed actions logged, denied actions no side effects, evaluation metadata
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createStore, createAgents, assertExecuted, assertNotExecuted } from './helpers.js';

let store, agents;

beforeEach(() => {
  store = createStore();
  agents = createAgents(store);
});

// ── Allowed Actions Logged ───────────────────────────────────────────

describe('Audit Trail — Allowed actions logged', () => {
  it('processClaim approve creates audit entry', async () => {
    const before = store.auditLog.length;
    await agents.claimsBot.processClaim('CLM-5001');
    assert.ok(store.auditLog.length > before, 'Audit log should grow');
    const entry = store.auditLog.find(e => e.claimId === 'CLM-5001');
    assert.ok(entry, 'Should have audit entry for CLM-5001');
    assert.equal(entry.agent, 'claims-bot');
    assert.equal(entry.action, 'claim-approve');
  });

  it('processClaim escalate creates audit entry with Art.14', async () => {
    await agents.claimsBot.processClaim('CLM-5002');
    const entry = store.auditLog.find(e => e.claimId === 'CLM-5002');
    assert.ok(entry);
    assert.equal(entry.action, 'claim-escalate');
    assert.equal(entry.euAiActArticle, 'Art.14-human-oversight');
  });

  it('scoreCustomer creates audit entry with Art.13', async () => {
    await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    const entry = store.auditLog.find(e => e.agent === 'underwrite-ai' && e.customerId === 'CUST-001');
    assert.ok(entry);
    assert.equal(entry.action, 'risk-assessment');
    assert.equal(entry.euAiActArticle, 'Art.13-transparency');
  });

  it('analyzeClaim creates audit entry with Art.14', async () => {
    await agents.fraudHunter.analyzeClaim('CLM-5006');
    const entry = store.auditLog.find(e => e.agent === 'fraud-hunter' && e.claimId === 'CLM-5006');
    assert.ok(entry);
    assert.equal(entry.action, 'fraud-analysis');
    assert.equal(entry.euAiActArticle, 'Art.14-human-oversight');
  });

  it('all audit entries have timestamp', async () => {
    await agents.claimsBot.processClaim('CLM-5001');
    await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    for (const entry of store.auditLog) {
      assert.ok(entry.timestamp, 'Every audit entry must have a timestamp');
    }
  });
});

// ── Denied Actions: No Side Effects ──────────────────────────────────

describe('Audit Trail — Denied actions no side effects', () => {
  it('attemptReadProtectedData does not add audit entry', async () => {
    const before = store.auditLog.length;
    await agents.claimsBot.attemptReadProtectedData('CUST-001');
    assert.equal(store.auditLog.length, before, 'Audit log should not grow on deny');
  });

  it('attemptModifyClaim does not mutate claim', async () => {
    const before = JSON.stringify(store.getClaim('CLM-5001'));
    await agents.fraudHunter.attemptModifyClaim('CLM-5001');
    const after = JSON.stringify(store.getClaim('CLM-5001'));
    assert.equal(before, after, 'Claim should be unchanged');
  });

  it('attemptWritePolicy does not mutate policy', async () => {
    const before = JSON.stringify(store.getPolicy('POL-1001'));
    await agents.policyAdvisor.attemptWritePolicy('POL-1001', { premium: 100 });
    const after = JSON.stringify(store.getPolicy('POL-1001'));
    assert.equal(before, after, 'Policy should be unchanged');
  });

  it('attemptBashCommand returns executed=false', async () => {
    const result = await agents.policyAdvisor.attemptBashCommand('cat /etc/passwd');
    assertNotExecuted(result);
  });

  it('attemptBashCommand does not add audit entry', async () => {
    const before = store.auditLog.length;
    await agents.policyAdvisor.attemptBashCommand('rm -rf /');
    assert.equal(store.auditLog.length, before);
  });

  it('attemptCrossTenantAccess does not add audit entry', async () => {
    const before = store.auditLog.length;
    await agents.fraudHunter.attemptCrossTenantAccess('OTHER-CUST-999');
    assert.equal(store.auditLog.length, before);
  });
});

// ── Evaluation Metadata ──────────────────────────────────────────────

describe('Audit Trail — Evaluation metadata', () => {
  it('allow result contains agentId and toolName', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5001');
    const readStep = result.steps[0];
    assert.equal(readStep.agentId, 'claims-bot');
    assert.equal(readStep.toolName, 'Read');
  });

  it('allow result contains layer=local', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5001');
    assert.equal(result.steps[0].evaluation.layer, 'local');
  });

  it('deny result contains reason with matched pattern', async () => {
    const result = await agents.claimsBot.attemptReadProtectedData('CUST-001');
    assert.ok(result.evaluation.reason.includes('pattern') || result.evaluation.reason.includes('readDeny'));
  });

  it('guardedAction result has all 6 fields', async () => {
    const result = await agents.claimsBot.attemptReadProtectedData('CUST-001');
    assert.ok('agentId' in result);
    assert.ok('toolName' in result);
    assert.ok('toolInput' in result);
    assert.ok('evaluation' in result);
    assert.ok('executed' in result);
    assert.ok('output' in result);
  });

  it('allow guardedAction has executed=true and output', async () => {
    const result = await agents.claimsBot.processClaim('CLM-5001');
    const readStep = result.steps[0]; // Read claim
    assertExecuted(readStep);
    assert.ok(readStep.output !== null);
  });

  it('deny guardedAction has executed=false and null output', async () => {
    const result = await agents.claimsBot.attemptReadProtectedData('CUST-001');
    assertNotExecuted(result);
    assert.equal(result.output, null);
  });

  it('processClaim approve audit entry has amount', async () => {
    await agents.claimsBot.processClaim('CLM-5001');
    const entry = store.auditLog.find(e => e.claimId === 'CLM-5001');
    assert.equal(entry.amount, 2800);
  });

  it('scoreCustomer audit entry has riskScore and factors', async () => {
    await agents.underwriteAI.scoreCustomer('CUST-001', 'auto');
    const entry = store.auditLog.find(e => e.agent === 'underwrite-ai');
    assert.ok(typeof entry.riskScore === 'number');
    assert.ok(Array.isArray(entry.factors));
  });
});
