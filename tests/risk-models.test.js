/**
 * risk-models.test.js — Tests for custom per-agent risk scoring models
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRiskModel, listModels,
  ClaimsBotRiskModel, UnderwriteAIRiskModel,
  FraudHunterRiskModel, PolicyAdvisorRiskModel,
} from '../platform/models/risk-models.js';

// ── Factory ──────────────────────────────────────────────────────────────

describe('Risk Models — Factory', () => {
  it('lists all 4 agent models', () => {
    const models = listModels();
    assert.deepEqual(models.sort(), ['claims-bot', 'fraud-hunter', 'policy-advisor', 'underwrite-ai']);
  });

  it('creates correct model class per agent', () => {
    assert.ok(createRiskModel('claims-bot') instanceof ClaimsBotRiskModel);
    assert.ok(createRiskModel('underwrite-ai') instanceof UnderwriteAIRiskModel);
    assert.ok(createRiskModel('fraud-hunter') instanceof FraudHunterRiskModel);
    assert.ok(createRiskModel('policy-advisor') instanceof PolicyAdvisorRiskModel);
  });

  it('returns base model for unknown agent', () => {
    const model = createRiskModel('unknown-agent');
    const result = model.score('Read', { file_path: 'data/test' });
    assert.ok(result.riskScore >= 0);
    assert.equal(result.model, 'unknown-agent');
  });
});

// ── ClaimsBot Risk Model ─────────────────────────────────────────────────

describe('Risk Models — ClaimsBot', () => {
  const model = createRiskModel('claims-bot');

  it('low risk for small auto-approved claim', () => {
    const r = model.score('Write', { file_path: 'data/claims/CLM-5005', content: '{"amount":800}' }, { claimAmount: 800 });
    assert.ok(r.riskScore <= 40, `Expected <=40, got ${r.riskScore}`);
    assert.ok(['low', 'medium'].includes(r.riskTier));
  });

  it('high risk for large claim above auto-approve', () => {
    const r = model.score('Write', { file_path: 'data/claims/CLM-5004' }, { claimAmount: 45000 });
    assert.ok(r.riskScore >= 60, `Expected >=60, got ${r.riskScore}`);
    assert.ok(['high', 'critical'].includes(r.riskTier));
  });

  it('critical risk for protected data access', () => {
    const r = model.score('Read', { file_path: 'data/customers/CUST-001/protected' });
    assert.ok(r.riskScore >= 80);
    assert.equal(r.riskTier, 'critical');
  });

  it('max risk for cross-tenant access', () => {
    const r = model.score('Read', { file_path: 'tenants/competitor/data/claims/CLM-1' }, { tenantId: 'insureco' });
    assert.equal(r.riskScore, 100);
  });

  it('elevated risk for fraud-flagged claims', () => {
    const base = model.score('Write', { file_path: 'data/claims/CLM-5006' }, { claimAmount: 4900 });
    const flagged = model.score('Write', { file_path: 'data/claims/CLM-5006' }, { claimAmount: 4900, fraudFlagged: true });
    assert.ok(flagged.riskScore > base.riskScore);
  });

  it('flags Art.14 for claims above auto-approve', () => {
    const r = model.score('Write', { file_path: 'data/claims/CLM-5004' }, { claimAmount: 10000 });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.14-human-oversight'));
  });

  it('flags Art.12 for all claim writes', () => {
    const r = model.score('Write', { file_path: 'data/claims/CLM-5005' }, { claimAmount: 100 });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.12-record-keeping'));
  });

  it('includes model version and timestamp', () => {
    const r = model.score('Read', { file_path: 'data/claims/CLM-5001' });
    assert.equal(r.model, 'claims-bot');
    assert.equal(r.modelVersion, '1.0.0');
    assert.ok(r.scoredAt);
  });
});

// ── UnderwriteAI Risk Model ──────────────────────────────────────────────

describe('Risk Models — UnderwriteAI', () => {
  const model = createRiskModel('underwrite-ai');

  it('elevated risk for writing risk assessments', () => {
    const r = model.score('Write', { file_path: 'data/risk-assessments/CUST-001-auto' });
    assert.ok(r.riskScore >= 40);
  });

  it('higher risk for high-premium recommendations', () => {
    const standard = model.score('Write', { file_path: 'data/risk-assessments/CUST-001' }, { recommendedPremium: 1200 });
    const high = model.score('Write', { file_path: 'data/risk-assessments/CUST-001' }, { recommendedPremium: 7200 });
    assert.ok(high.riskScore > standard.riskScore);
  });

  it('critical risk for protected characteristics access', () => {
    const r = model.score('Read', { file_path: 'data/customers/CUST-002/protected/disability.json' });
    assert.ok(r.riskScore >= 80);
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.10-data-governance-violation'));
  });

  it('detects score drift', () => {
    const normal = model.score('Write', { file_path: 'data/risk-assessments/CUST-002' });
    const drifted = model.score('Write', { file_path: 'data/risk-assessments/CUST-002' }, { historicalAvgScore: 30, currentScore: 85 });
    assert.ok(drifted.riskScore > normal.riskScore);
  });

  it('flags Art.13 for risk assessment writes', () => {
    const r = model.score('Write', { file_path: 'data/risk-assessments/CUST-001-auto' });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.13-transparency'));
  });

  it('flags GDPR Art.22 for high premiums', () => {
    const r = model.score('Write', { file_path: 'data/risk-assessments/CUST-004' }, { recommendedPremium: 7200 });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'GDPR-Art.22'));
  });
});

// ── FraudHunter Risk Model ───────────────────────────────────────────────

describe('Risk Models — FraudHunter', () => {
  const model = createRiskModel('fraud-hunter');

  it('low risk for normal claims read', () => {
    const r = model.score('Read', { file_path: 'data/claims/CLM-5006' });
    assert.ok(r.riskScore <= 15);
  });

  it('low risk for writing fraud flags', () => {
    const r = model.score('Write', { file_path: 'data/fraud-flags/CLM-5006' });
    assert.ok(r.riskScore <= 20);
  });

  it('critical risk for attempting to modify claims', () => {
    const r = model.score('Write', { file_path: 'data/claims/CLM-5006' });
    assert.ok(r.riskScore >= 90);
    assert.equal(r.riskTier, 'critical');
  });

  it('high risk for customer data access', () => {
    const r = model.score('Read', { file_path: 'data/customers/CUST-004' });
    assert.ok(r.riskScore >= 60);
  });

  it('elevated risk for broad investigation sweeps', () => {
    const normal = model.score('Read', { file_path: 'data/claims/CUST-004' });
    const broad = model.score('Read', { file_path: 'data/claims/CUST-004' }, { claimsReadInWindow: 75 });
    assert.ok(broad.riskScore > normal.riskScore);
  });

  it('flags Art.14 for fraud flag writes', () => {
    const r = model.score('Write', { file_path: 'data/fraud-flags/CLM-5006' });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.14-human-oversight'));
  });

  it('flags Art.6 profiling for broad sweeps', () => {
    const r = model.score('Read', { file_path: 'data/claims/all' }, { claimsReadInWindow: 25 });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.6-profiling'));
  });
});

// ── PolicyAdvisor Risk Model ─────────────────────────────────────────────

describe('Risk Models — PolicyAdvisor', () => {
  const model = createRiskModel('policy-advisor');

  it('minimal risk for policy reads', () => {
    const r = model.score('Read', { file_path: 'data/policies/POL-1001' });
    assert.ok(r.riskScore <= 5);
    assert.equal(r.riskTier, 'low');
  });

  it('critical risk for any write attempt', () => {
    const r = model.score('Write', { file_path: 'data/policies/POL-1001' });
    assert.equal(r.riskScore, 100);
    assert.equal(r.riskTier, 'critical');
  });

  it('critical risk for bash attempt', () => {
    const r = model.score('Bash', { command: 'ls' });
    assert.equal(r.riskScore, 100);
  });

  it('high risk for claims access', () => {
    const r = model.score('Read', { file_path: 'data/claims/CLM-5001' });
    assert.ok(r.riskScore >= 60);
  });

  it('high risk for fraud data access', () => {
    const r = model.score('Read', { file_path: 'data/fraud-flags/CLM-5006' });
    assert.ok(r.riskScore >= 70);
  });

  it('always flags Art.52 transparency', () => {
    const r = model.score('Read', { file_path: 'data/policies/POL-1001' });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.52-transparency'));
  });

  it('flags Art.13 capability limits for high-risk actions', () => {
    const r = model.score('Write', { file_path: 'data/policies/POL-1001' });
    assert.ok(r.regulatoryFlags.some(f => f.flag === 'Art.13-capability-limits'));
  });
});

// ── Score Structure ──────────────────────────────────────────────────────

describe('Risk Models — Score Structure', () => {
  it('all models return consistent structure', () => {
    for (const agentId of listModels()) {
      const model = createRiskModel(agentId);
      const r = model.score('Read', { file_path: 'data/test' });
      assert.equal(typeof r.riskScore, 'number');
      assert.ok(r.riskScore >= 0 && r.riskScore <= 100);
      assert.ok(['low', 'medium', 'high', 'critical'].includes(r.riskTier));
      assert.ok(Array.isArray(r.factors));
      assert.ok(Array.isArray(r.regulatoryFlags));
      assert.equal(typeof r.explanation, 'string');
      assert.equal(r.model, agentId);
      assert.equal(r.modelVersion, '1.0.0');
    }
  });

  it('factors have name, impact, reason', () => {
    const model = createRiskModel('claims-bot');
    const r = model.score('Write', { file_path: 'data/claims/CLM-5004' }, { claimAmount: 50000 });
    for (const f of r.factors) {
      assert.equal(typeof f.name, 'string');
      assert.equal(typeof f.impact, 'number');
      assert.equal(typeof f.reason, 'string');
    }
  });

  it('regulatory flags have flag, reason, action', () => {
    const model = createRiskModel('claims-bot');
    const r = model.score('Write', { file_path: 'data/claims/CLM-5004' }, { claimAmount: 50000 });
    for (const f of r.regulatoryFlags) {
      assert.equal(typeof f.flag, 'string');
      assert.equal(typeof f.reason, 'string');
      assert.equal(typeof f.action, 'string');
    }
  });
});
