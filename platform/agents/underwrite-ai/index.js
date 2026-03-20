/**
 * UnderwriteAI — Risk scoring for policy pricing
 *
 * EU AI Act classification: HIGH RISK
 *   - Art. 6 + Annex III §5(b): credit scoring / insurance risk assessment
 *   - Art. 10: data governance — must not use protected characteristics
 *   - Art. 13: transparency — must explain scoring factors
 *
 * SOE constraints:
 *   - Can READ customer safe fields, policies, claims history
 *   - CANNOT read customer protected characteristics (ethnicity, disability, religion, politics)
 *   - Can WRITE risk score + premium recommendation
 *   - CANNOT modify existing policies directly
 */

import { guardedAction } from '../../soe-client.js';

const AGENT_ID = 'underwrite-ai';

export class UnderwriteAI {
  constructor(store) {
    this.store = store;
  }

  /**
   * Score a customer for a policy type.
   * Returns risk score, premium recommendation, and explainability data.
   */
  async scoreCustomer(customerId, policyType) {
    const steps = [];

    // Step 1: Read customer safe data
    const readCustomer = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/customers/${customerId}` },
      () => this.store.getCustomerSafe(customerId),
    );
    steps.push(readCustomer);
    if (!readCustomer.executed || !readCustomer.output) {
      return { customerId, status: 'blocked', reason: 'Cannot read customer', steps };
    }
    const customer = readCustomer.output;

    // Step 2: Read claims history
    const readClaims = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/claims/${customerId}` },
      () => this.store.getClaimsForCustomer(customerId),
    );
    steps.push(readClaims);
    const claimsHistory = readClaims.executed ? readClaims.output : [];

    // Step 3: Compute risk score (deterministic, explainable)
    const scoring = this._computeRiskScore(customer, claimsHistory, policyType);

    // Step 4: Write risk assessment through SOE gate
    const writeScore = await guardedAction(
      AGENT_ID, 'Write', {
        file_path: `data/risk-assessments/${customerId}-${policyType}`,
        content: JSON.stringify(scoring),
      },
      () => {
        this.store.addAuditEntry({
          agent: AGENT_ID,
          action: 'risk-assessment',
          customerId,
          policyType,
          riskScore: scoring.riskScore,
          factors: scoring.factors,
          euAiActArticle: 'Art.13-transparency',
        });
        return scoring;
      },
    );
    steps.push(writeScore);

    return {
      customerId,
      policyType,
      status: writeScore.executed ? 'scored' : 'blocked',
      scoring: writeScore.executed ? scoring : null,
      steps,
    };
  }

  /**
   * Attempt to access protected characteristics — MUST be blocked by SOE.
   * This demonstrates EU AI Act Art. 10 data governance enforcement.
   */
  async attemptAccessProtectedData(customerId) {
    return guardedAction(
      AGENT_ID, 'Read', { file_path: `data/customers/${customerId}/protected` },
      () => this.store.getCustomerProtected(customerId),
    );
  }

  _computeRiskScore(customer, claimsHistory, policyType) {
    const factors = [];
    let score = 50; // baseline

    // Credit score factor
    const credit = customer.riskProfile?.creditScore || 650;
    if (credit >= 750) { score -= 15; factors.push({ factor: 'creditScore', value: credit, impact: -15, reason: 'Excellent credit' }); }
    else if (credit >= 700) { score -= 5; factors.push({ factor: 'creditScore', value: credit, impact: -5, reason: 'Good credit' }); }
    else if (credit < 650) { score += 15; factors.push({ factor: 'creditScore', value: credit, impact: +15, reason: 'Below average credit' }); }
    else { factors.push({ factor: 'creditScore', value: credit, impact: 0, reason: 'Average credit' }); }

    // Claims history factor
    const claimCount = customer.riskProfile?.claimsHistory || 0;
    if (claimCount === 0) { score -= 10; factors.push({ factor: 'claimsHistory', value: claimCount, impact: -10, reason: 'No prior claims' }); }
    else if (claimCount <= 2) { factors.push({ factor: 'claimsHistory', value: claimCount, impact: 0, reason: 'Low claims history' }); }
    else if (claimCount <= 5) { score += 10; factors.push({ factor: 'claimsHistory', value: claimCount, impact: +10, reason: 'Moderate claims history' }); }
    else { score += 20; factors.push({ factor: 'claimsHistory', value: claimCount, impact: +20, reason: 'High claims history' }); }

    // Customer tenure factor
    const tenure = customer.riskProfile?.yearsAsCustomer || 0;
    if (tenure >= 10) { score -= 10; factors.push({ factor: 'tenure', value: tenure, impact: -10, reason: 'Long-term customer' }); }
    else if (tenure >= 5) { score -= 5; factors.push({ factor: 'tenure', value: tenure, impact: -5, reason: 'Established customer' }); }
    else { factors.push({ factor: 'tenure', value: tenure, impact: 0, reason: 'New customer' }); }

    // Recent claims velocity
    const recentClaims = claimsHistory.filter(c => {
      const filed = new Date(c.filedDate);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return filed > sixMonthsAgo;
    });
    if (recentClaims.length >= 3) {
      score += 15;
      factors.push({ factor: 'recentClaimsVelocity', value: recentClaims.length, impact: +15, reason: 'High recent claim frequency' });
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Premium multiplier
    const basePremiums = { auto: 1200, home: 2400, health: 3600, life: 4800 };
    const basePremium = basePremiums[policyType] || 2000;
    const multiplier = 0.5 + (score / 100);
    const recommendedPremium = Math.round(basePremium * multiplier);

    return {
      riskScore: score,
      riskCategory: score <= 30 ? 'low' : score <= 60 ? 'medium' : 'high',
      factors,
      premiumRecommendation: {
        basePremium,
        multiplier: Math.round(multiplier * 100) / 100,
        recommendedPremium,
      },
      // EU AI Act Art. 13 — transparency
      explanation: `Risk score ${score}/100 based on ${factors.length} factors. No protected characteristics were used in this assessment.`,
      dataGovernance: {
        protectedCharacteristicsUsed: false,
        factorsConsidered: factors.map(f => f.factor),
        euAiActCompliance: 'Art.10 — data governance verified',
      },
    };
  }
}
