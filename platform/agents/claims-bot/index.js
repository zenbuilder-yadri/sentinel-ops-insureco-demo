/**
 * ClaimsBot — Auto-adjudicates insurance claims
 *
 * EU AI Act classification: HIGH RISK
 *   - Art. 6 + Annex III §5(b): automated decision-making in insurance
 *   - Art. 14: human oversight required for claims above auto-approve limit
 *   - Art. 12: all decisions must be logged
 *
 * SOE constraints:
 *   - Can READ claims, policies, customer (safe fields only)
 *   - Can WRITE claim status (approve/deny/escalate)
 *   - CANNOT access protected characteristics
 *   - CANNOT approve claims above policy autoApproveLimit
 *   - CANNOT modify policies or customer records
 */

import { guardedAction } from '../../soe-client.js';

const AGENT_ID = 'claims-bot';

export class ClaimsBot {
  constructor(store) {
    this.store = store;
  }

  /**
   * Process a claim — the main entry point.
   * Every step goes through the SOE gate.
   */
  async processClaim(claimId) {
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

    // Step 2: Read the policy
    const readPolicy = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/policies/${claim.policyId}` },
      () => this.store.getPolicy(claim.policyId),
    );
    steps.push(readPolicy);
    if (!readPolicy.executed || !readPolicy.output) {
      return { claimId, status: 'blocked', reason: 'Cannot read policy', steps };
    }
    const policy = readPolicy.output;

    // Step 3: Read customer (safe fields — no protected characteristics)
    const readCustomer = await guardedAction(
      AGENT_ID, 'Read', { file_path: `data/customers/${claim.customerId}` },
      () => this.store.getCustomerSafe(claim.customerId),
    );
    steps.push(readCustomer);

    // Step 4: Decide
    const decision = this._adjudicate(claim, policy);

    // Step 5: Execute decision through SOE gate
    const executeDecision = await guardedAction(
      AGENT_ID, 'Write', { file_path: `data/claims/${claimId}`, content: JSON.stringify(decision) },
      () => {
        this.store.updateClaim(claimId, {
          status: decision.action,
          adjudicatedBy: AGENT_ID,
          adjudicationReason: decision.reason,
          adjudicatedAt: new Date().toISOString(),
        });
        this.store.addAuditEntry({
          agent: AGENT_ID,
          action: `claim-${decision.action}`,
          claimId,
          amount: claim.amount,
          reason: decision.reason,
          euAiActArticle: decision.action === 'escalate' ? 'Art.14-human-oversight' : 'Art.12-record-keeping',
        });
        return { claimId, ...decision };
      },
    );
    steps.push(executeDecision);

    return {
      claimId,
      status: executeDecision.executed ? decision.action : 'blocked',
      decision: executeDecision.executed ? decision : null,
      steps,
    };
  }

  /**
   * Attempt to read protected characteristics — this SHOULD be blocked by SOE.
   * Included to demonstrate the deny path.
   */
  async attemptReadProtectedData(customerId) {
    return guardedAction(
      AGENT_ID, 'Read', { file_path: `data/customers/${customerId}/protected` },
      () => this.store.getCustomerProtected(customerId),
    );
  }

  _adjudicate(claim, policy) {
    // Rule 1: Amount exceeds auto-approve limit → escalate
    if (claim.amount > policy.autoApproveLimit) {
      return {
        action: 'escalate',
        reason: `Claim amount €${claim.amount} exceeds auto-approve limit €${policy.autoApproveLimit}. Human review required (EU AI Act Art. 14).`,
      };
    }

    // Rule 2: Amount exceeds coverage → deny
    if (claim.amount > policy.coverage) {
      return {
        action: 'deny',
        reason: `Claim amount €${claim.amount} exceeds policy coverage €${policy.coverage}.`,
      };
    }

    // Rule 3: Policy not active → deny
    if (policy.status !== 'active') {
      return {
        action: 'deny',
        reason: `Policy ${policy.id} is ${policy.status}, not active.`,
      };
    }

    // Rule 4: Within limits → approve
    return {
      action: 'approve',
      reason: `Claim €${claim.amount} within auto-approve limit €${policy.autoApproveLimit}. Auto-adjudicated.`,
    };
  }
}
