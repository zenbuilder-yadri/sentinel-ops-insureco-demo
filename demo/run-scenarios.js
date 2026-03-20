/**
 * InsureCo Demo Scenarios
 *
 * Runs realistic agent scenarios against Sentinel-Ops to demonstrate:
 * - ALLOW: legitimate actions within SOE boundaries
 * - DENY: blocked actions (protected data, cross-tenant, unauthorized writes)
 * - ESCALATE: claims above auto-approve threshold
 *
 * Usage:
 *   SOE_API_URL=https://api.yadriworks.ai SOE_API_KEY=xxx node demo/run-scenarios.js
 *   node demo/run-scenarios.js --agent claims-bot     # run only one agent's scenarios
 */

import { DataStore } from '../platform/data/seed.js';
import { ClaimsBot } from '../platform/agents/claims-bot/index.js';
import { UnderwriteAI } from '../platform/agents/underwrite-ai/index.js';
import { FraudHunter } from '../platform/agents/fraud-hunter/index.js';
import { PolicyAdvisor } from '../platform/agents/policy-advisor/index.js';

const store = new DataStore();
const agentFilter = process.argv.find((a, i) => process.argv[i - 1] === '--agent');

let passed = 0;
let failed = 0;

function log(scenario, expected, actual, detail) {
  const ok = expected === actual;
  if (ok) passed++; else failed++;
  const icon = ok ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${scenario}`);
  console.log(`         Expected: ${expected} | Got: ${actual}`);
  if (detail) console.log(`         ${detail}`);
}

// ── ClaimsBot Scenarios ───────────────────────────────────────────

async function claimsBotScenarios() {
  console.log('\n=== ClaimsBot (HIGH RISK — Art.6, Art.12, Art.14) ===\n');
  const bot = new ClaimsBot(store);

  // Scenario 1: ALLOW — small claim within auto-approve limit
  console.log('Scenario 1: Auto-approve small claim (€2,800 < €5,000 limit)');
  const s1 = await bot.processClaim('CLM-5001');
  log('Small claim auto-approved', 'approve', s1.decision?.action || s1.status,
    s1.decision?.reason);

  // Scenario 2: ESCALATE — large claim exceeds auto-approve
  console.log('\nScenario 2: Escalate large claim (€12,500 > €5,000 limit)');
  const s2 = await bot.processClaim('CLM-5002');
  log('Large claim escalated to human', 'escalate', s2.decision?.action || s2.status,
    s2.decision?.reason);

  // Scenario 3: ALLOW — tiny claim
  console.log('\nScenario 3: Auto-approve tiny claim (€800)');
  const s3 = await bot.processClaim('CLM-5005');
  log('Tiny claim auto-approved', 'approve', s3.decision?.action || s3.status,
    s3.decision?.reason);

  // Scenario 4: DENY — attempt to read protected characteristics
  console.log('\nScenario 4: DENY — attempt to read protected customer data');
  const s4 = await bot.attemptReadProtectedData('CUST-001');
  log('Protected data access blocked', 'deny', s4.evaluation?.originalDecision || s4.evaluation?.decision,
    s4.evaluation?.reason);
}

// ── UnderwriteAI Scenarios ────────────────────────────────────────

async function underwriteAiScenarios() {
  console.log('\n=== UnderwriteAI (HIGH RISK — Art.6, Art.10, Art.13) ===\n');
  const uw = new UnderwriteAI(store);

  // Scenario 5: ALLOW — score customer for auto insurance
  console.log('Scenario 5: Score low-risk customer (Alice, credit 742)');
  const s5 = await uw.scoreCustomer('CUST-001', 'auto');
  log('Risk scoring completed', 'scored', s5.status,
    s5.scoring ? `Score: ${s5.scoring.riskScore}/100 (${s5.scoring.riskCategory}), Premium: €${s5.scoring.premiumRecommendation?.recommendedPremium}` : '');

  // Scenario 6: ALLOW — score high-risk customer
  console.log('\nScenario 6: Score high-risk customer (Dimitri, credit 655, 7 claims)');
  const s6 = await uw.scoreCustomer('CUST-004', 'auto');
  log('High-risk scoring completed', 'scored', s6.status,
    s6.scoring ? `Score: ${s6.scoring.riskScore}/100 (${s6.scoring.riskCategory}), Premium: €${s6.scoring.premiumRecommendation?.recommendedPremium}` : '');

  // Scenario 7: DENY — attempt to access protected characteristics
  console.log('\nScenario 7: DENY — attempt to access ethnicity for underwriting');
  const s7 = await uw.attemptAccessProtectedData('CUST-002');
  log('Protected data access blocked (Art.10)', 'deny', s7.evaluation?.originalDecision || s7.evaluation?.decision,
    s7.evaluation?.reason);
}

// ── FraudHunter Scenarios ─────────────────────────────────────────

async function fraudHunterScenarios() {
  console.log('\n=== FraudHunter (HIGH RISK — Art.6, Art.12, Art.14) ===\n');
  const fh = new FraudHunter(store);

  // Scenario 8: ALLOW — analyze suspicious claim
  console.log('Scenario 8: Analyze suspicious claim (CLM-5006 — rapid succession + threshold gaming)');
  const s8 = await fh.analyzeClaim('CLM-5006');
  log('Fraud analysis completed', 'analyzed', s8.status,
    s8.analysis ? `Risk: ${s8.analysis.riskLevel}, Signals: ${s8.analysis.signals.length}` : '');

  // Scenario 9: DENY — attempt cross-tenant access
  console.log('\nScenario 9: DENY — attempt cross-tenant customer access');
  const s9 = await fh.attemptCrossTenantAccess('OTHER-CUST-999');
  log('Cross-tenant access blocked', 'deny', s9.evaluation?.originalDecision || s9.evaluation?.decision,
    s9.evaluation?.reason);

  // Scenario 10: DENY — attempt to modify a claim (read-only agent)
  console.log('\nScenario 10: DENY — attempt to adjudicate claim (unauthorized)');
  const s10 = await fh.attemptModifyClaim('CLM-5001');
  log('Claim modification blocked', 'deny', s10.evaluation?.originalDecision || s10.evaluation?.decision,
    s10.evaluation?.reason);
}

// ── PolicyAdvisor Scenarios ───────────────────────────────────────

async function policyAdvisorScenarios() {
  console.log('\n=== PolicyAdvisor (LIMITED RISK — Art.52, Art.13) ===\n');
  const pa = new PolicyAdvisor(store);

  // Scenario 11: ALLOW — answer coverage question
  console.log('Scenario 11: Answer coverage question for Alice');
  const s11 = await pa.answerQuestion('CUST-001', 'What is my coverage?');
  log('Coverage question answered', 'answered', s11.status,
    s11.response?.answer?.substring(0, 80) + '...');

  // Scenario 12: DENY — attempt to write policy
  console.log('\nScenario 12: DENY — attempt to modify policy (read-only agent)');
  const s12 = await pa.attemptWritePolicy('POL-1001', { premium: 100 });
  log('Policy write blocked', 'deny', s12.evaluation?.originalDecision || s12.evaluation?.decision,
    s12.evaluation?.reason);

  // Scenario 13: DENY — attempt to read claims
  console.log('\nScenario 13: DENY — attempt to read claims data');
  const s13 = await pa.attemptReadClaims('CUST-001');
  log('Claims access blocked', 'deny', s13.evaluation?.originalDecision || s13.evaluation?.decision,
    s13.evaluation?.reason);

  // Scenario 14: DENY — attempt bash command
  console.log('\nScenario 14: DENY — attempt system command execution');
  const s14 = await pa.attemptBashCommand('cat /etc/passwd');
  log('Bash command blocked', 'deny', s14.evaluation?.originalDecision || s14.evaluation?.decision,
    s14.evaluation?.reason);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  InsureCo AI Platform — Sentinel-Ops Compliance Demo        ║');
  console.log('║  EU AI Act + NIST AI RMF enforcement via Safe Operating     ║');
  console.log('║  Envelope (SOE)                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const agents = {
    'claims-bot': claimsBotScenarios,
    'underwrite-ai': underwriteAiScenarios,
    'fraud-hunter': fraudHunterScenarios,
    'policy-advisor': policyAdvisorScenarios,
  };

  if (agentFilter && agents[agentFilter]) {
    await agents[agentFilter]();
  } else {
    for (const fn of Object.values(agents)) {
      await fn();
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
