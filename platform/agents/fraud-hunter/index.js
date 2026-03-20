/**
 * FraudHunter — Flags suspicious claim patterns
 *
 * EU AI Act classification: HIGH RISK
 *   - Art. 6 + Annex III §5(a): profiling of natural persons
 *   - Art. 14: human oversight — fraud flags are recommendations, not final decisions
 *   - Art. 12: record-keeping of all pattern detections
 *
 * SOE constraints:
 *   - Can READ claims and policies (within own tenant)
 *   - CANNOT read across tenants (cross-customer isolation)
 *   - CANNOT approve/deny claims (read-only + flag)
 *   - CANNOT access protected characteristics
 *   - CANNOT delete or modify evidence
 */

import { guardedAction } from '../../soe-client.js';

const AGENT_ID = 'fraud-hunter';

export class FraudHunter {
  constructor(store) {
    this.store = store;
  }

  /**
   * Analyze a specific claim for fraud signals.
   */
  async analyzeClaim(claimId) {
    const steps = [];

    // Step 1: Read the claim
    const readClaim = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/claims/${claimId}` },
      () => this.store.getClaim(claimId),
    );
    steps.push(readClaim);
    if (!readClaim.executed || !readClaim.output) {
      return { claimId, status: 'blocked', reason: 'Cannot read claim', steps };
    }
    const claim = readClaim.output;

    // Step 2: Read all claims for this customer (pattern analysis)
    const readHistory = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/claims?customerId=${claim.customerId}` },
      () => this.store.getClaimsForCustomer(claim.customerId),
    );
    steps.push(readHistory);
    const history = readHistory.executed ? readHistory.output : [];

    // Step 3: Read the policy
    const readPolicy = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/policies/${claim.policyId}` },
      () => this.store.getPolicy(claim.policyId),
    );
    steps.push(readPolicy);
    const policy = readPolicy.executed ? readPolicy.output : null;

    // Step 4: Run fraud detection heuristics
    const signals = this._detectSignals(claim, history, policy);

    // Step 5: Write fraud assessment (flag only — cannot approve/deny)
    const writeFlag = await guardedAction(
      AGENT_ID, 'Write', {
        file_path: `data/fraud-flags/${claimId}`,
        content: JSON.stringify(signals),
      },
      () => {
        this.store.addAuditEntry({
          agent: AGENT_ID,
          action: 'fraud-analysis',
          claimId,
          customerId: claim.customerId,
          riskLevel: signals.riskLevel,
          signalCount: signals.signals.length,
          euAiActArticle: 'Art.14-human-oversight',
        });
        return signals;
      },
    );
    steps.push(writeFlag);

    return {
      claimId,
      status: writeFlag.executed ? 'analyzed' : 'blocked',
      analysis: writeFlag.executed ? signals : null,
      steps,
    };
  }

  /**
   * Attempt cross-tenant data access — MUST be blocked by SOE.
   * Demonstrates tenant isolation enforcement.
   */
  async attemptCrossTenantAccess(otherTenantCustomerId) {
    return guardedAction(
      AGENT_ID, 'Read', { file_path: `tenants/other-corp/data/customers/${otherTenantCustomerId}` },
      () => ({ error: 'This should never execute' }),
    );
  }

  /**
   * Attempt to modify a claim — MUST be blocked by SOE.
   * FraudHunter can only flag, not adjudicate.
   */
  async attemptModifyClaim(claimId) {
    return guardedAction(
      AGENT_ID, 'Write', { file_path: `data/claims/${claimId}`, content: '{"status":"deny"}' },
      () => this.store.updateClaim(claimId, { status: 'deny', adjudicatedBy: AGENT_ID }),
    );
  }

  _detectSignals(claim, history, policy) {
    const signals = [];

    // Signal 1: Rapid succession — multiple claims within 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentClaims = history.filter(c => c.id !== claim.id && new Date(c.filedDate) > thirtyDaysAgo);
    if (recentClaims.length >= 1) {
      signals.push({
        type: 'rapid-succession',
        severity: 'high',
        detail: `${recentClaims.length} other claim(s) filed within 30 days`,
        relatedClaims: recentClaims.map(c => c.id),
      });
    }

    // Signal 2: Just under auto-approve threshold
    if (policy && claim.amount > policy.autoApproveLimit * 0.9 && claim.amount <= policy.autoApproveLimit) {
      signals.push({
        type: 'threshold-gaming',
        severity: 'medium',
        detail: `Claim €${claim.amount} is ${Math.round((claim.amount / policy.autoApproveLimit) * 100)}% of auto-approve limit €${policy.autoApproveLimit}`,
      });
    }

    // Signal 3: High claim-to-premium ratio
    if (policy && claim.amount > policy.premium * 2) {
      signals.push({
        type: 'high-claim-ratio',
        severity: 'medium',
        detail: `Claim €${claim.amount} is ${Math.round(claim.amount / policy.premium)}x the annual premium €${policy.premium}`,
      });
    }

    // Signal 4: Cumulative claims exceed coverage percentage
    const totalClaimed = history.reduce((sum, c) => sum + c.amount, 0);
    if (policy && totalClaimed > policy.coverage * 0.5) {
      signals.push({
        type: 'cumulative-exposure',
        severity: 'high',
        detail: `Total claims €${totalClaimed} = ${Math.round((totalClaimed / policy.coverage) * 100)}% of coverage €${policy.coverage}`,
      });
    }

    // Signal 5: Minimal evidence
    if (!claim.evidence || claim.evidence.length <= 1) {
      signals.push({
        type: 'low-evidence',
        severity: 'low',
        detail: `Only ${claim.evidence?.length || 0} evidence item(s) provided`,
      });
    }

    const riskLevel = signals.some(s => s.severity === 'high') ? 'high'
      : signals.some(s => s.severity === 'medium') ? 'medium'
      : signals.length > 0 ? 'low' : 'none';

    return {
      claimId: claim.id,
      customerId: claim.customerId,
      riskLevel,
      signals,
      recommendation: riskLevel === 'high'
        ? 'Flag for human investigation before processing'
        : riskLevel === 'medium'
        ? 'Proceed with caution — additional verification recommended'
        : 'No significant fraud indicators detected',
      // EU AI Act Art. 14: fraud flags are advisory, not decisions
      humanOversightRequired: riskLevel !== 'none',
      disclaimer: 'This is an automated risk assessment. Final determination must involve human review per EU AI Act Art. 14.',
    };
  }
}
