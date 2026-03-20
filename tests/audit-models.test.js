/**
 * audit-models.test.js — Tests for custom per-agent audit classification models
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuditModel, listAuditModels,
  ClaimsBotAuditModel, UnderwriteAIAuditModel,
  FraudHunterAuditModel, PolicyAdvisorAuditModel,
} from '../platform/models/audit-models.js';

// ── Factory ──────────────────────────────────────────────────────────────

describe('Audit Models — Factory', () => {
  it('lists all 4 agent models', () => {
    assert.deepEqual(listAuditModels().sort(), ['claims-bot', 'fraud-hunter', 'policy-advisor', 'underwrite-ai']);
  });

  it('creates correct model class per agent', () => {
    assert.ok(createAuditModel('claims-bot') instanceof ClaimsBotAuditModel);
    assert.ok(createAuditModel('underwrite-ai') instanceof UnderwriteAIAuditModel);
    assert.ok(createAuditModel('fraud-hunter') instanceof FraudHunterAuditModel);
    assert.ok(createAuditModel('policy-advisor') instanceof PolicyAdvisorAuditModel);
  });

  it('returns base model for unknown agent', () => {
    const model = createAuditModel('unknown');
    const record = model.classify({ decision: 'allow', toolName: 'Read', toolInput: {} });
    assert.equal(record.agentId, 'unknown');
  });
});

// ── Record Structure ─────────────────────────────────────────────────────

describe('Audit Models — Record Structure', () => {
  it('all models return consistent structure', () => {
    for (const agentId of listAuditModels()) {
      const model = createAuditModel(agentId);
      const record = model.classify({ decision: 'allow', toolName: 'Read', toolInput: { file_path: 'test' }, riskScore: 10 });

      assert.ok(record.recordId.startsWith('aud-'));
      assert.ok(record.timestamp);
      assert.equal(record.agentId, agentId);
      assert.ok(record.model.includes(agentId));
      assert.equal(typeof record.category, 'string');
      assert.equal(typeof record.subcategory, 'string');
      assert.ok(['low', 'medium', 'high', 'critical'].includes(record.severity));
      assert.ok(Array.isArray(record.compliance));
      assert.ok(record.retention.days > 0);
      assert.ok(record.retention.reason);
    }
  });

  it('compliance always includes EU AI Act Art.12', () => {
    const model = createAuditModel('claims-bot');
    const record = model.classify({ decision: 'allow', toolName: 'Read', toolInput: {} });
    const euAct = record.compliance.find(f => f.framework === 'EU AI Act');
    assert.ok(euAct);
    assert.ok(euAct.articles.some(a => a.ref === 'Art.12'));
  });

  it('compliance always includes SOC 2', () => {
    const model = createAuditModel('fraud-hunter');
    const record = model.classify({ decision: 'deny', toolName: 'Write', toolInput: { file_path: 'data/claims/x' } });
    const soc2 = record.compliance.find(f => f.framework === 'SOC 2 Type II');
    assert.ok(soc2);
  });

  it('sanitizes long content in toolInput', () => {
    const model = createAuditModel('claims-bot');
    const longContent = 'x'.repeat(500);
    const record = model.classify({ decision: 'allow', toolName: 'Write', toolInput: { file_path: 'test', content: longContent } });
    assert.ok(record.event.toolInput.content.includes('truncated'));
  });

  it('sanitizes context to only safe keys', () => {
    const model = createAuditModel('claims-bot');
    const record = model.classify(
      { decision: 'allow', toolName: 'Read', toolInput: {} },
      { claimId: 'CLM-5001', customerId: 'CUST-001', secretField: 'should-not-appear' }
    );
    assert.equal(record.context.claimId, 'CLM-5001');
    assert.equal(record.context.secretField, undefined);
  });
});

// ── ClaimsBot Audit Model ────────────────────────────────────────────────

describe('Audit Models — ClaimsBot', () => {
  const model = createAuditModel('claims-bot');

  it('categorizes claim adjudication correctly', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/claims/CLM-5005' }, riskScore: 20 },
      { claimAmount: 800 }
    );
    assert.equal(record.category, 'claim-adjudication');
    assert.equal(record.subcategory, 'auto-approved');
  });

  it('categorizes high-value claim escalation', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/claims/CLM-5004' }, riskScore: 70 },
      { claimAmount: 45000, autoApproveLimit: 5000 }
    );
    assert.equal(record.category, 'claim-escalation');
    assert.equal(record.subcategory, 'high-value-claim');
    assert.equal(record.impactArea, 'financial');
  });

  it('categorizes protected data violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Read', toolInput: { file_path: 'data/customers/CUST-001/protected' }, riskScore: 95 }
    );
    assert.equal(record.category, 'protected-data-violation');
    const euAct = record.compliance.find(f => f.framework === 'EU AI Act');
    assert.ok(euAct.articles.some(a => a.ref === 'Art.10'));
  });

  it('maps GDPR Art.22 for financial decisions', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/claims/CLM-5001' }, riskScore: 30 },
      { claimAmount: 2800 }
    );
    const gdpr = record.compliance.find(f => f.framework === 'GDPR');
    assert.ok(gdpr);
    assert.ok(gdpr.articles.some(a => a.ref === 'Art.22'));
  });

  it('7-year retention for critical events', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/claims/CLM-5004' }, riskScore: 80 },
      { claimAmount: 45000, autoApproveLimit: 5000 }
    );
    assert.equal(record.retention.days, 2555);
  });
});

// ── UnderwriteAI Audit Model ─────────────────────────────────────────────

describe('Audit Models — UnderwriteAI', () => {
  const model = createAuditModel('underwrite-ai');

  it('categorizes risk assessment writes', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/risk-assessments/CUST-001-auto' }, riskScore: 40 },
      { riskCategory: 'medium' }
    );
    assert.equal(record.category, 'risk-assessment-generated');
    assert.equal(record.subcategory, 'medium');
  });

  it('categorizes data governance violation as critical', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Read', toolInput: { file_path: 'data/customers/CUST-002/protected' }, riskScore: 100 }
    );
    assert.equal(record.category, 'data-governance-violation');
    assert.equal(record.severity, 'critical');
  });

  it('maps Art.13 transparency for risk assessments', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/risk-assessments/CUST-001' }, riskScore: 40 }
    );
    const euAct = record.compliance.find(f => f.framework === 'EU AI Act');
    assert.ok(euAct.articles.some(a => a.ref === 'Art.13'));
  });

  it('maps GDPR DPIA for underwriting', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/risk-assessments/CUST-004' }, riskScore: 50 }
    );
    const gdpr = record.compliance.find(f => f.framework === 'GDPR');
    assert.ok(gdpr);
    assert.ok(gdpr.articles.some(a => a.ref === 'Art.35'));
  });
});

// ── FraudHunter Audit Model ──────────────────────────────────────────────

describe('Audit Models — FraudHunter', () => {
  const model = createAuditModel('fraud-hunter');

  it('categorizes fraud flag creation', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/fraud-flags/CLM-5006' }, riskScore: 15 },
      { riskLevel: 'high' }
    );
    assert.equal(record.category, 'fraud-flag-created');
    assert.equal(record.subcategory, 'high');
  });

  it('categorizes separation of duties violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Write', toolInput: { file_path: 'data/claims/CLM-5006' }, riskScore: 100 }
    );
    assert.equal(record.category, 'separation-of-duties-violation');
    assert.equal(record.severity, 'critical');
  });

  it('categorizes cross-tenant violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Read', toolInput: { file_path: 'tenants/competitor/data/claims/x' }, riskScore: 95 }
    );
    assert.equal(record.category, 'cross-tenant-violation');
  });

  it('10-year retention for investigation records', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/fraud-flags/CLM-5006' }, riskScore: 15 }
    );
    assert.equal(record.retention.days, 3650);
  });

  it('maps Art.14 for fraud flags', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Write', toolInput: { file_path: 'data/fraud-flags/CLM-5006' }, riskScore: 15 }
    );
    const euAct = record.compliance.find(f => f.framework === 'EU AI Act');
    assert.ok(euAct.articles.some(a => a.ref === 'Art.14'));
  });
});

// ── PolicyAdvisor Audit Model ────────────────────────────────────────────

describe('Audit Models — PolicyAdvisor', () => {
  const model = createAuditModel('policy-advisor');

  it('categorizes policy inquiry', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Read', toolInput: { file_path: 'data/policies/POL-1001' }, riskScore: 5 },
      { queryContext: 'coverage-inquiry' }
    );
    assert.equal(record.category, 'policy-inquiry');
    assert.equal(record.subcategory, 'coverage-inquiry');
    assert.equal(record.severity, 'low');
  });

  it('categorizes write boundary violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Write', toolInput: { file_path: 'data/policies/POL-1001' }, riskScore: 100 }
    );
    assert.equal(record.category, 'write-boundary-violation');
    assert.equal(record.severity, 'high');
  });

  it('categorizes bash execution violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Bash', toolInput: { command: 'ls' }, riskScore: 100 }
    );
    assert.equal(record.category, 'execution-boundary-violation');
  });

  it('categorizes claims data boundary violation', () => {
    const record = model.classify(
      { decision: 'deny', toolName: 'Read', toolInput: { file_path: 'data/claims/CLM-5001' }, riskScore: 65 }
    );
    assert.equal(record.category, 'data-boundary-violation');
    assert.equal(record.subcategory, 'no-claims-access');
  });

  it('always maps Art.52 transparency', () => {
    const record = model.classify(
      { decision: 'allow', toolName: 'Read', toolInput: { file_path: 'data/policies/POL-1001' }, riskScore: 5 }
    );
    const euAct = record.compliance.find(f => f.framework === 'EU AI Act');
    assert.ok(euAct.articles.some(a => a.ref === 'Art.52'));
  });
});
