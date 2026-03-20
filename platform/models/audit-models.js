/**
 * Audit Models — Domain-specific audit classification per InsureCo agent
 *
 * Each model classifies SOE events into regulatory categories, maps to
 * compliance frameworks, and generates structured audit records.
 * These models plug into Sentinel-Ops Chronicle webhooks.
 *
 * Architecture:
 *   SOE Gate → Chronicle webhook → Audit Model → AuditRecord
 *                                               → complianceMapping
 *                                               → retentionPolicy
 *
 * Compliance frameworks:
 *   - EU AI Act (Art. 9, 10, 12, 13, 14, 52)
 *   - NIST AI RMF (Map, Measure, Manage, Govern)
 *   - SOC 2 Type II (CC6, CC7, CC8)
 *   - GDPR (Art. 22, 25, 35)
 */

// ── Compliance Framework Mappings ────────────────────────────────────────

const EU_AI_ACT = {
  'Art.6':  { title: 'Classification Rules', category: 'high-risk-classification' },
  'Art.9':  { title: 'Risk Management System', category: 'risk-management' },
  'Art.10': { title: 'Data Governance', category: 'data-governance' },
  'Art.12': { title: 'Record-Keeping', category: 'record-keeping' },
  'Art.13': { title: 'Transparency', category: 'transparency' },
  'Art.14': { title: 'Human Oversight', category: 'human-oversight' },
  'Art.52': { title: 'Transparency Obligations', category: 'ai-disclosure' },
};

const NIST_AI_RMF = {
  MAP:     { title: 'Map', description: 'Contextualize risks' },
  MEASURE: { title: 'Measure', description: 'Quantify risks' },
  MANAGE:  { title: 'Manage', description: 'Prioritize and act on risks' },
  GOVERN:  { title: 'Govern', description: 'Cultivate risk-aware culture' },
};

const SOC2 = {
  CC6: { title: 'Logical and Physical Access Controls' },
  CC7: { title: 'System Operations' },
  CC8: { title: 'Change Management' },
};

// ── Base Audit Model ─────────────────────────────────────────────────────

class BaseAuditModel {
  constructor(agentId) {
    this.agentId = agentId;
  }

  /**
   * Classify an SOE event into a structured audit record.
   *
   * @param {object} event — SOE gate event { decision, agentId, toolName, toolInput, riskScore, reason }
   * @param {object} context — additional context (claimAmount, customerId, etc.)
   * @returns {object} — AuditRecord
   */
  classify(event, context = {}) {
    const category = this._categorize(event, context);
    const compliance = this._mapCompliance(event, category, context);
    const severity = this._assessSeverity(event, category);
    const retention = this._retentionPolicy(category, severity);

    return {
      // Record identity
      recordId: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      model: `${this.agentId}-audit-v1`,

      // Event data
      event: {
        decision: event.decision,
        toolName: event.toolName,
        toolInput: this._sanitizeInput(event.toolInput),
        riskScore: event.riskScore,
        reason: event.reason,
      },

      // Classification
      category: category.name,
      subcategory: category.subcategory,
      severity,
      impactArea: category.impactArea,

      // Compliance mapping
      compliance,

      // Retention
      retention,

      // Lineage
      context: this._sanitizeContext(context),
    };
  }

  _categorize(event, _context) {
    if (event.decision === 'deny') {
      return {
        name: 'access-denied',
        subcategory: 'policy-enforcement',
        impactArea: 'security',
      };
    }
    if (event.decision === 'escalate') {
      return {
        name: 'escalation',
        subcategory: 'human-oversight-required',
        impactArea: 'compliance',
      };
    }
    return {
      name: 'access-granted',
      subcategory: 'normal-operation',
      impactArea: 'operational',
    };
  }

  _mapCompliance(event, category, _context) {
    const frameworks = [];

    // EU AI Act — always applies
    frameworks.push({
      framework: 'EU AI Act',
      articles: [{ ref: 'Art.12', ...EU_AI_ACT['Art.12'], status: 'compliant' }],
    });

    // NIST AI RMF
    if (event.decision === 'deny') {
      frameworks.push({
        framework: 'NIST AI RMF',
        functions: [{ ref: 'MANAGE', ...NIST_AI_RMF.MANAGE, status: 'risk-mitigated' }],
      });
    }

    // SOC 2
    frameworks.push({
      framework: 'SOC 2 Type II',
      criteria: [{ ref: 'CC6', ...SOC2.CC6, status: category.name === 'access-denied' ? 'control-enforced' : 'access-logged' }],
    });

    return frameworks;
  }

  _assessSeverity(event, category) {
    if (event.riskScore >= 75) return 'critical';
    if (event.decision === 'deny' && category.impactArea === 'security') return 'high';
    if (event.decision === 'escalate') return 'medium';
    return 'low';
  }

  _retentionPolicy(category, severity) {
    // EU AI Act Art. 12 requires records be kept for the AI system's lifetime
    // Insurance regulatory requirements: 7+ years for financial decisions
    if (severity === 'critical') return { days: 2555, reason: '7 years — regulatory requirement for critical events' };
    if (category.name === 'escalation') return { days: 2555, reason: '7 years — human oversight records' };
    if (category.impactArea === 'security') return { days: 1825, reason: '5 years — security events' };
    return { days: 365, reason: '1 year — standard operational records' };
  }

  _sanitizeInput(toolInput) {
    if (!toolInput) return {};
    const sanitized = { ...toolInput };
    // Remove raw content from audit (may contain PII)
    if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 200) {
      sanitized.content = `[${sanitized.content.length} chars — truncated for audit]`;
    }
    return sanitized;
  }

  _sanitizeContext(context) {
    const safe = {};
    // Only include non-PII context fields
    const allowedKeys = ['claimId', 'policyId', 'policyType', 'claimAmount', 'action', 'batchSize'];
    for (const key of allowedKeys) {
      if (context[key] !== undefined) safe[key] = context[key];
    }
    return safe;
  }
}

// ── ClaimsBot Audit Model ────────────────────────────────────────────────

class ClaimsBotAuditModel extends BaseAuditModel {
  constructor() { super('claims-bot'); }

  _categorize(event, context) {
    const path = event.toolInput?.file_path || '';
    const tool = event.toolName?.toLowerCase() || '';

    // Protected data access attempt — most severe
    if (path.includes('protected')) {
      return {
        name: 'protected-data-violation',
        subcategory: 'eu-ai-act-art10',
        impactArea: 'regulatory',
      };
    }

    // Claim adjudication (write to claims)
    if (tool === 'write' && path.includes('claims/')) {
      const amount = context.claimAmount || 0;
      if (amount > (context.autoApproveLimit || 5000)) {
        return {
          name: 'claim-escalation',
          subcategory: 'high-value-claim',
          impactArea: 'financial',
        };
      }
      return {
        name: 'claim-adjudication',
        subcategory: event.decision === 'allow' ? 'auto-approved' : 'blocked',
        impactArea: 'financial',
      };
    }

    // Fraud flag writing
    if (tool === 'write' && path.includes('fraud-flags/')) {
      return {
        name: 'fraud-flagging',
        subcategory: 'cross-agent-collaboration',
        impactArea: 'risk',
      };
    }

    return super._categorize(event, context);
  }

  _mapCompliance(event, category, context) {
    const frameworks = super._mapCompliance(event, category, context);

    // Claims-specific EU AI Act articles
    const euFramework = frameworks.find(f => f.framework === 'EU AI Act');
    if (euFramework) {
      if (category.name === 'claim-escalation') {
        euFramework.articles.push({ ref: 'Art.14', ...EU_AI_ACT['Art.14'], status: 'escalated-to-human' });
      }
      if (category.name === 'protected-data-violation') {
        euFramework.articles.push({ ref: 'Art.10', ...EU_AI_ACT['Art.10'], status: 'violation-blocked' });
      }
      if (category.name === 'claim-adjudication') {
        euFramework.articles.push({ ref: 'Art.6', ...EU_AI_ACT['Art.6'], status: 'high-risk-system' });
      }
    }

    // GDPR for automated financial decisions
    if (category.impactArea === 'financial') {
      frameworks.push({
        framework: 'GDPR',
        articles: [{ ref: 'Art.22', title: 'Automated Decision-Making', status: 'logged' }],
      });
    }

    return frameworks;
  }
}

// ── UnderwriteAI Audit Model ─────────────────────────────────────────────

class UnderwriteAIAuditModel extends BaseAuditModel {
  constructor() { super('underwrite-ai'); }

  _categorize(event, context) {
    const path = event.toolInput?.file_path || '';
    const tool = event.toolName?.toLowerCase() || '';

    if (path.includes('protected')) {
      return {
        name: 'data-governance-violation',
        subcategory: 'protected-characteristics',
        impactArea: 'regulatory',
      };
    }

    if (tool === 'write' && path.includes('risk-assessments/')) {
      return {
        name: 'risk-assessment-generated',
        subcategory: context.riskCategory || 'uncategorized',
        impactArea: 'underwriting',
      };
    }

    if (tool === 'read' && path.includes('customers/')) {
      return {
        name: 'customer-data-access',
        subcategory: 'underwriting-input',
        impactArea: 'data-governance',
      };
    }

    return super._categorize(event, context);
  }

  _mapCompliance(event, category, context) {
    const frameworks = super._mapCompliance(event, category, context);
    const euFramework = frameworks.find(f => f.framework === 'EU AI Act');

    if (euFramework) {
      // Art. 10 — data governance is critical for underwriting
      euFramework.articles.push({
        ref: 'Art.10',
        ...EU_AI_ACT['Art.10'],
        status: category.name === 'data-governance-violation' ? 'violation-blocked' : 'compliant',
      });

      // Art. 13 — transparency for risk assessments
      if (category.name === 'risk-assessment-generated') {
        euFramework.articles.push({ ref: 'Art.13', ...EU_AI_ACT['Art.13'], status: 'factors-documented' });
      }
    }

    // GDPR Art. 22 + Art. 35 for automated underwriting
    if (category.impactArea === 'underwriting') {
      frameworks.push({
        framework: 'GDPR',
        articles: [
          { ref: 'Art.22', title: 'Automated Decision-Making', status: 'logged' },
          { ref: 'Art.35', title: 'Data Protection Impact Assessment', status: 'required' },
        ],
      });
    }

    return frameworks;
  }

  _assessSeverity(event, category) {
    // Protected data violations in underwriting are always critical
    if (category.name === 'data-governance-violation') return 'critical';
    return super._assessSeverity(event, category);
  }
}

// ── FraudHunter Audit Model ──────────────────────────────────────────────

class FraudHunterAuditModel extends BaseAuditModel {
  constructor() { super('fraud-hunter'); }

  _categorize(event, context) {
    const path = event.toolInput?.file_path || '';
    const tool = event.toolName?.toLowerCase() || '';

    if (path.includes('protected')) {
      return { name: 'protected-data-violation', subcategory: 'investigation-overreach', impactArea: 'regulatory' };
    }

    if (tool === 'write' && path.includes('claims/')) {
      return { name: 'separation-of-duties-violation', subcategory: 'claim-modification-attempt', impactArea: 'security' };
    }

    if (path.includes('tenants/')) {
      return { name: 'cross-tenant-violation', subcategory: 'investigation-boundary-breach', impactArea: 'security' };
    }

    if (tool === 'write' && path.includes('fraud-flags/')) {
      return {
        name: 'fraud-flag-created',
        subcategory: context.riskLevel || 'unknown',
        impactArea: 'investigation',
      };
    }

    if (tool === 'read' && path.includes('claims/')) {
      return { name: 'investigation-read', subcategory: 'claims-analysis', impactArea: 'investigation' };
    }

    return super._categorize(event, context);
  }

  _mapCompliance(event, category, context) {
    const frameworks = super._mapCompliance(event, category, context);
    const euFramework = frameworks.find(f => f.framework === 'EU AI Act');

    if (euFramework) {
      // Art. 14 — all fraud flags require human oversight
      if (category.name === 'fraud-flag-created') {
        euFramework.articles.push({ ref: 'Art.14', ...EU_AI_ACT['Art.14'], status: 'human-review-required' });
      }
      // Art. 6 — profiling classification
      euFramework.articles.push({ ref: 'Art.6', ...EU_AI_ACT['Art.6'], status: 'profiling-activity' });
    }

    return frameworks;
  }

  _retentionPolicy(category, severity) {
    // Fraud investigation records: 10 years (regulatory + litigation)
    if (category.impactArea === 'investigation') {
      return { days: 3650, reason: '10 years — fraud investigation records' };
    }
    return super._retentionPolicy(category, severity);
  }
}

// ── PolicyAdvisor Audit Model ────────────────────────────────────────────

class PolicyAdvisorAuditModel extends BaseAuditModel {
  constructor() { super('policy-advisor'); }

  _categorize(event, context) {
    const path = event.toolInput?.file_path || '';
    const tool = event.toolName?.toLowerCase() || '';

    if (tool === 'write' || tool === 'edit') {
      return { name: 'write-boundary-violation', subcategory: 'read-only-agent', impactArea: 'security' };
    }

    if (tool === 'bash') {
      return { name: 'execution-boundary-violation', subcategory: 'no-bash-access', impactArea: 'security' };
    }

    if (path.includes('claims/')) {
      return { name: 'data-boundary-violation', subcategory: 'no-claims-access', impactArea: 'privacy' };
    }

    if (path.includes('protected')) {
      return { name: 'protected-data-violation', subcategory: 'customer-facing-agent', impactArea: 'regulatory' };
    }

    if (tool === 'read' && path.includes('policies/')) {
      return {
        name: 'policy-inquiry',
        subcategory: context.queryContext || 'general',
        impactArea: 'customer-service',
      };
    }

    return super._categorize(event, context);
  }

  _mapCompliance(event, category, context) {
    const frameworks = super._mapCompliance(event, category, context);
    const euFramework = frameworks.find(f => f.framework === 'EU AI Act');

    if (euFramework) {
      // Art. 52 — transparency for ALL PolicyAdvisor interactions
      euFramework.articles.push({ ref: 'Art.52', ...EU_AI_ACT['Art.52'], status: 'ai-disclosure-required' });
    }

    return frameworks;
  }

  _assessSeverity(event, category) {
    // Any boundary violation from customer-facing agent is high severity
    if (category.name.includes('violation')) return 'high';
    return 'low'; // PolicyAdvisor normal ops are low severity
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

const AUDIT_MODELS = {
  'claims-bot': ClaimsBotAuditModel,
  'underwrite-ai': UnderwriteAIAuditModel,
  'fraud-hunter': FraudHunterAuditModel,
  'policy-advisor': PolicyAdvisorAuditModel,
};

function createAuditModel(agentId) {
  const ModelClass = AUDIT_MODELS[agentId];
  if (!ModelClass) return new BaseAuditModel(agentId);
  return new ModelClass();
}

function listAuditModels() {
  return Object.keys(AUDIT_MODELS);
}

export {
  BaseAuditModel,
  ClaimsBotAuditModel,
  UnderwriteAIAuditModel,
  FraudHunterAuditModel,
  PolicyAdvisorAuditModel,
  createAuditModel,
  listAuditModels,
  EU_AI_ACT,
  NIST_AI_RMF,
  SOC2,
};
