/**
 * Risk Models — Domain-specific risk scoring per InsureCo agent
 *
 * Each model implements a custom risk scoring algorithm tailored to the agent's
 * role and regulatory requirements. These models plug into Sentinel-Ops
 * Arbiter webhooks to replace or augment default risk scoring.
 *
 * Architecture:
 *   SOE Gate → Arbiter webhook → Risk Model → riskScore (0-100)
 *                                            → factors[] (explainability)
 *                                            → regulatoryFlags[]
 *
 * EU AI Act compliance:
 *   - Art. 9:  Risk management — quantified, per-action risk
 *   - Art. 10: Data governance — protected characteristics never factor into scoring
 *   - Art. 13: Transparency — every score includes explainable factors
 */

// ── Base Risk Model ──────────────────────────────────────────────────────

class BaseRiskModel {
  constructor(agentId, config = {}) {
    this.agentId = agentId;
    this.config = {
      baselineScore: 10,
      maxScore: 100,
      ...config,
    };
  }

  /**
   * Score a tool call. Returns { riskScore, factors, regulatoryFlags, explanation }.
   * Subclasses override _computeFactors() to add domain-specific logic.
   */
  score(toolName, toolInput, context = {}) {
    const factors = this._computeFactors(toolName, toolInput, context);
    const rawScore = this.config.baselineScore + factors.reduce((sum, f) => sum + f.impact, 0);
    const riskScore = Math.max(0, Math.min(this.config.maxScore, Math.round(rawScore)));

    const regulatoryFlags = this._checkRegulatoryFlags(toolName, toolInput, riskScore, context);

    return {
      riskScore,
      riskTier: riskScore <= 25 ? 'low' : riskScore <= 50 ? 'medium' : riskScore <= 75 ? 'high' : 'critical',
      factors,
      regulatoryFlags,
      explanation: this._explain(riskScore, factors, regulatoryFlags),
      model: this.agentId,
      modelVersion: '1.0.0',
      scoredAt: new Date().toISOString(),
    };
  }

  _computeFactors(_toolName, _toolInput, _context) {
    return [];
  }

  _checkRegulatoryFlags(_toolName, _toolInput, _riskScore, _context) {
    return [];
  }

  _explain(riskScore, factors, regulatoryFlags) {
    const topFactors = factors
      .filter(f => f.impact !== 0)
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 3)
      .map(f => `${f.name}: ${f.impact > 0 ? '+' : ''}${f.impact} (${f.reason})`)
      .join('; ');
    const flagStr = regulatoryFlags.length > 0
      ? ` Regulatory flags: ${regulatoryFlags.map(f => f.flag).join(', ')}.`
      : '';
    return `Risk ${riskScore}/100. ${topFactors || 'No significant factors'}.${flagStr}`;
  }
}

// ── ClaimsBot Risk Model ─────────────────────────────────────────────────

class ClaimsBotRiskModel extends BaseRiskModel {
  constructor(config = {}) {
    super('claims-bot', {
      baselineScore: 15,
      autoApproveThreshold: 5000,
      writeEscalationThreshold: 10000,
      ...config,
    });
  }

  _computeFactors(toolName, toolInput, context) {
    const factors = [];
    const path = toolInput?.file_path || toolInput?.path || '';
    const tool = toolName.toLowerCase();

    // Write operations carry inherent risk (financial impact)
    if (tool === 'write' || tool === 'edit') {
      factors.push({ name: 'write-operation', impact: 20, reason: 'Claim state mutation' });

      // Parse claim amount from context or content
      const amount = context.claimAmount || this._parseAmount(toolInput?.content);
      if (amount > 0) {
        if (amount > this.config.writeEscalationThreshold) {
          factors.push({ name: 'high-value-claim', impact: 40, reason: `Claim €${amount} exceeds escalation threshold` });
        } else if (amount > this.config.autoApproveThreshold) {
          factors.push({ name: 'above-auto-approve', impact: 25, reason: `Claim €${amount} above auto-approve limit` });
        } else {
          factors.push({ name: 'within-limits', impact: -5, reason: `Claim €${amount} within auto-approve range` });
        }
      }
    }

    // Bulk operations (reading multiple claims at once)
    if (context.batchSize && context.batchSize > 10) {
      factors.push({ name: 'bulk-read', impact: 10, reason: `Batch of ${context.batchSize} claims` });
    }

    // Protected data proximity
    if (path.includes('customers') && !path.includes('protected')) {
      factors.push({ name: 'customer-data-access', impact: 5, reason: 'Customer record access' });
    }
    if (path.includes('protected')) {
      factors.push({ name: 'protected-data-attempt', impact: 80, reason: 'Protected characteristics access attempt' });
    }

    // Cross-tenant access
    if (path.includes('tenants/') && context.tenantId && !path.includes(context.tenantId)) {
      factors.push({ name: 'cross-tenant', impact: 90, reason: 'Cross-tenant data access attempt' });
    }

    // Fraud-flagged claims
    if (context.fraudFlagged) {
      factors.push({ name: 'fraud-flagged', impact: 30, reason: 'Claim has active fraud flags' });
    }

    // Time-based risk: off-hours processing
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      factors.push({ name: 'off-hours', impact: 10, reason: 'Processing outside business hours' });
    }

    return factors;
  }

  _checkRegulatoryFlags(toolName, toolInput, riskScore, context) {
    const flags = [];
    const amount = context.claimAmount || this._parseAmount(toolInput?.content);

    if (amount > this.config.autoApproveThreshold) {
      flags.push({
        flag: 'Art.14-human-oversight',
        reason: `Claim €${amount} requires human review per EU AI Act Art. 14`,
        action: 'escalate',
      });
    }

    if (riskScore > 75) {
      flags.push({
        flag: 'Art.9-risk-management',
        reason: 'High risk score requires additional controls',
        action: 'audit',
      });
    }

    if (toolName.toLowerCase() === 'write') {
      flags.push({
        flag: 'Art.12-record-keeping',
        reason: 'Claim state change must be logged',
        action: 'log',
      });
    }

    return flags;
  }

  _parseAmount(content) {
    if (!content) return 0;
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      return parsed?.amount || 0;
    } catch {
      return 0;
    }
  }
}

// ── UnderwriteAI Risk Model ──────────────────────────────────────────────

class UnderwriteAIRiskModel extends BaseRiskModel {
  constructor(config = {}) {
    super('underwrite-ai', {
      baselineScore: 20,
      highPremiumThreshold: 5000,
      ...config,
    });
  }

  _computeFactors(toolName, toolInput, context) {
    const factors = [];
    const path = toolInput?.file_path || toolInput?.path || '';
    const tool = toolName.toLowerCase();

    // Writing risk assessments — always elevated (affects premiums)
    if (tool === 'write' || tool === 'edit') {
      factors.push({ name: 'risk-assessment-write', impact: 25, reason: 'Writing risk assessment affects policy pricing' });

      // High-premium recommendations
      const premium = context.recommendedPremium || 0;
      if (premium > this.config.highPremiumThreshold) {
        factors.push({ name: 'high-premium', impact: 15, reason: `Premium €${premium} exceeds review threshold` });
      }
    }

    // Reading customer data — moderate risk (PII exposure)
    if (path.includes('customers/')) {
      factors.push({ name: 'customer-pii', impact: 10, reason: 'Customer PII access' });
    }

    // Protected characteristics — maximum risk
    if (path.includes('protected')) {
      factors.push({ name: 'protected-data-attempt', impact: 80, reason: 'Protected characteristics — Art. 10 violation' });
    }

    // Cross-tenant
    if (path.includes('tenants/') && context.tenantId && !path.includes(context.tenantId)) {
      factors.push({ name: 'cross-tenant', impact: 90, reason: 'Cross-tenant scoring attempt' });
    }

    // Risk score concentration — multiple assessments for same customer
    if (context.recentAssessmentsForCustomer && context.recentAssessmentsForCustomer > 3) {
      factors.push({
        name: 'assessment-velocity',
        impact: 15,
        reason: `${context.recentAssessmentsForCustomer} assessments for same customer in short period`,
      });
    }

    // Model drift indicator — if scoring diverges significantly from historical
    if (context.historicalAvgScore && context.currentScore) {
      const drift = Math.abs(context.currentScore - context.historicalAvgScore);
      if (drift > 30) {
        factors.push({ name: 'score-drift', impact: 20, reason: `Score deviates ${drift} points from historical average` });
      }
    }

    return factors;
  }

  _checkRegulatoryFlags(toolName, toolInput, riskScore, context) {
    const flags = [];
    const path = toolInput?.file_path || toolInput?.path || '';

    // Art. 10 — data governance (most critical for underwriting)
    if (path.includes('protected')) {
      flags.push({
        flag: 'Art.10-data-governance-violation',
        reason: 'Attempted use of protected characteristics in underwriting',
        action: 'block-and-report',
        severity: 'critical',
      });
    }

    // Art. 13 — transparency
    if (toolName.toLowerCase() === 'write') {
      flags.push({
        flag: 'Art.13-transparency',
        reason: 'Risk assessment must include explainable factors',
        action: 'verify',
      });
    }

    // Art. 22 GDPR — automated decision-making
    const premium = context.recommendedPremium || 0;
    if (premium > this.config.highPremiumThreshold) {
      flags.push({
        flag: 'GDPR-Art.22',
        reason: `Automated premium recommendation €${premium} — customer has right to human review`,
        action: 'flag-for-review',
      });
    }

    return flags;
  }
}

// ── FraudHunter Risk Model ───────────────────────────────────────────────

class FraudHunterRiskModel extends BaseRiskModel {
  constructor(config = {}) {
    super('fraud-hunter', {
      baselineScore: 10,
      ...config,
    });
  }

  _computeFactors(toolName, toolInput, context) {
    const factors = [];
    const path = toolInput?.file_path || toolInput?.path || '';
    const tool = toolName.toLowerCase();

    // FraudHunter should NEVER write to claims — only fraud-flags
    if (tool === 'write' || tool === 'edit') {
      if (path.includes('claims/')) {
        factors.push({ name: 'claim-write-attempt', impact: 90, reason: 'FraudHunter must not modify claims (read-only + flag)' });
      } else if (path.includes('fraud-flags/')) {
        factors.push({ name: 'fraud-flag-write', impact: 5, reason: 'Expected: writing fraud analysis flags' });
      } else {
        factors.push({ name: 'unexpected-write', impact: 50, reason: `Unexpected write target: ${path}` });
      }
    }

    // Reading claims — normal operation
    if (tool === 'read' && path.includes('claims/')) {
      factors.push({ name: 'claims-read', impact: -5, reason: 'Normal: reading claims for analysis' });
    }

    // Customer data access — FraudHunter should NOT read customer data
    if (path.includes('customers/')) {
      factors.push({ name: 'customer-access', impact: 60, reason: 'FraudHunter should not access customer records' });
    }

    // Protected data
    if (path.includes('protected')) {
      factors.push({ name: 'protected-data-attempt', impact: 80, reason: 'Protected characteristics access' });
    }

    // Cross-tenant snooping
    if (path.includes('tenants/') && context.tenantId && !path.includes(context.tenantId)) {
      factors.push({ name: 'cross-tenant-investigation', impact: 90, reason: 'Cross-tenant data access — isolation breach' });
    }

    // Investigation scope — many claims read in short window
    if (context.claimsReadInWindow && context.claimsReadInWindow > 50) {
      factors.push({ name: 'broad-investigation', impact: 15, reason: `${context.claimsReadInWindow} claims read — broad sweep investigation` });
    }

    // Pattern: multiple fraud flags written rapidly
    if (context.recentFlagWrites && context.recentFlagWrites > 10) {
      factors.push({ name: 'flag-velocity', impact: 20, reason: `${context.recentFlagWrites} fraud flags in short window — mass flagging` });
    }

    return factors;
  }

  _checkRegulatoryFlags(toolName, toolInput, riskScore, context) {
    const flags = [];

    // Art. 14 — all fraud determinations require human oversight
    if (toolName.toLowerCase() === 'write') {
      flags.push({
        flag: 'Art.14-human-oversight',
        reason: 'Fraud flags are advisory — final determination requires human investigator',
        action: 'flag-for-review',
      });
    }

    // Art. 6 — profiling risk
    if (context.claimsReadInWindow && context.claimsReadInWindow > 20) {
      flags.push({
        flag: 'Art.6-profiling',
        reason: 'Broad data access may constitute profiling under Annex III §5(a)',
        action: 'audit',
      });
    }

    return flags;
  }
}

// ── PolicyAdvisor Risk Model ─────────────────────────────────────────────

class PolicyAdvisorRiskModel extends BaseRiskModel {
  constructor(config = {}) {
    super('policy-advisor', {
      baselineScore: 5, // lowest baseline — read-only, limited risk
      ...config,
    });
  }

  _computeFactors(toolName, toolInput, context) {
    const factors = [];
    const path = toolInput?.file_path || toolInput?.path || '';
    const tool = toolName.toLowerCase();

    // ANY write attempt is max risk (policy-advisor is read-only)
    if (tool === 'write' || tool === 'edit') {
      factors.push({ name: 'write-attempt', impact: 95, reason: 'PolicyAdvisor is read-only — all writes blocked' });
    }

    // Any bash attempt is max risk
    if (tool === 'bash') {
      factors.push({ name: 'bash-attempt', impact: 95, reason: 'PolicyAdvisor cannot execute system commands' });
    }

    // Claims access — PolicyAdvisor should not see claims
    if (path.includes('claims/')) {
      factors.push({ name: 'claims-access', impact: 60, reason: 'PolicyAdvisor has no claims access — privacy boundary' });
    }

    // Fraud flags — should not access
    if (path.includes('fraud-flags/')) {
      factors.push({ name: 'fraud-data-access', impact: 70, reason: 'PolicyAdvisor should not access fraud investigation data' });
    }

    // Risk assessments — should not access
    if (path.includes('risk-assessments/')) {
      factors.push({ name: 'risk-data-access', impact: 50, reason: 'PolicyAdvisor should not access internal risk data' });
    }

    // Protected data
    if (path.includes('protected')) {
      factors.push({ name: 'protected-data-attempt', impact: 80, reason: 'Protected characteristics access' });
    }

    // Normal read of policies — low risk
    if (tool === 'read' && path.includes('policies/')) {
      factors.push({ name: 'policy-read', impact: -5, reason: 'Normal: reading policy information for customer' });
    }

    // High query volume from single customer session
    if (context.queriesInSession && context.queriesInSession > 20) {
      factors.push({ name: 'session-velocity', impact: 10, reason: `${context.queriesInSession} queries in session — unusual volume` });
    }

    return factors;
  }

  _checkRegulatoryFlags(toolName, _toolInput, riskScore, _context) {
    const flags = [];

    // Art. 52 — transparency for all interactions
    flags.push({
      flag: 'Art.52-transparency',
      reason: 'AI system must identify itself as non-human',
      action: 'verify-disclosure',
    });

    // Art. 13 — user must understand capabilities
    if (riskScore > 50) {
      flags.push({
        flag: 'Art.13-capability-limits',
        reason: 'High-risk action attempted — user must be informed of system limitations',
        action: 'inform-user',
      });
    }

    return flags;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

const MODELS = {
  'claims-bot': ClaimsBotRiskModel,
  'underwrite-ai': UnderwriteAIRiskModel,
  'fraud-hunter': FraudHunterRiskModel,
  'policy-advisor': PolicyAdvisorRiskModel,
};

function createRiskModel(agentId, config = {}) {
  const ModelClass = MODELS[agentId];
  if (!ModelClass) {
    return new BaseRiskModel(agentId, config);
  }
  return new ModelClass(config);
}

function listModels() {
  return Object.keys(MODELS);
}

export {
  BaseRiskModel,
  ClaimsBotRiskModel,
  UnderwriteAIRiskModel,
  FraudHunterRiskModel,
  PolicyAdvisorRiskModel,
  createRiskModel,
  listModels,
};
