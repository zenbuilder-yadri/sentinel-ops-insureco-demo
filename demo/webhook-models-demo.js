#!/usr/bin/env node
/**
 * webhook-models-demo.js — Showcases custom risk + audit models via webhooks
 *
 * Runs simulated SOE events through each agent's risk and audit models,
 * demonstrating how InsureCo customizes Sentinel-Ops behavior per use case.
 *
 * Usage:
 *   node demo/webhook-models-demo.js
 *   node demo/webhook-models-demo.js --agent claims-bot
 *   node demo/webhook-models-demo.js --verbose
 */

import { createRiskModel, listModels } from '../platform/models/risk-models.js';
import { createAuditModel, listAuditModels } from '../platform/models/audit-models.js';

const args = process.argv.slice(2);
const filterAgent = args.find(a => !a.startsWith('--'));
const verbose = args.includes('--verbose');

// ── Color helpers ────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function tierColor(tier) {
  switch (tier) {
  case 'low': return c.green;
  case 'medium': return c.yellow;
  case 'high': return c.red;
  case 'critical': return `${c.bold}${c.red}`;
  default: return c.gray;
  }
}

// ── Test Scenarios per Agent ─────────────────────────────────────────────

const scenarios = {
  'claims-bot': [
    {
      name: 'Auto-approve small claim',
      tool: 'Write', input: { file_path: 'data/claims/CLM-5005', content: '{"action":"approve"}' },
      context: { claimAmount: 800, autoApproveLimit: 5000 },
      expectedDecision: 'allow',
    },
    {
      name: 'High-value claim escalation',
      tool: 'Write', input: { file_path: 'data/claims/CLM-5004', content: '{"action":"escalate"}' },
      context: { claimAmount: 45000, autoApproveLimit: 5000 },
      expectedDecision: 'allow',
    },
    {
      name: 'Attempt protected data access',
      tool: 'Read', input: { file_path: 'data/customers/CUST-001/protected' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Fraud-flagged claim processing',
      tool: 'Write', input: { file_path: 'data/claims/CLM-5006', content: '{"action":"approve"}' },
      context: { claimAmount: 4900, fraudFlagged: true },
      expectedDecision: 'allow',
    },
    {
      name: 'Cross-tenant access attempt',
      tool: 'Read', input: { file_path: 'tenants/competitor/data/claims/CLM-001' },
      context: { tenantId: 'insureco' },
      expectedDecision: 'deny',
    },
  ],

  'underwrite-ai': [
    {
      name: 'Write risk assessment (standard)',
      tool: 'Write', input: { file_path: 'data/risk-assessments/CUST-001-auto' },
      context: { recommendedPremium: 1200, riskCategory: 'medium' },
      expectedDecision: 'allow',
    },
    {
      name: 'Write high-premium assessment',
      tool: 'Write', input: { file_path: 'data/risk-assessments/CUST-004-auto' },
      context: { recommendedPremium: 7200, riskCategory: 'high' },
      expectedDecision: 'allow',
    },
    {
      name: 'Attempt protected characteristics',
      tool: 'Read', input: { file_path: 'data/customers/CUST-002/protected/disability.json' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Customer data access for scoring',
      tool: 'Read', input: { file_path: 'data/customers/CUST-003' },
      context: {},
      expectedDecision: 'allow',
    },
    {
      name: 'Score drift detection',
      tool: 'Write', input: { file_path: 'data/risk-assessments/CUST-002-home' },
      context: { historicalAvgScore: 40, currentScore: 85, recommendedPremium: 4800 },
      expectedDecision: 'allow',
    },
  ],

  'fraud-hunter': [
    {
      name: 'Read claim for analysis (normal)',
      tool: 'Read', input: { file_path: 'data/claims/CLM-5006' },
      context: {},
      expectedDecision: 'allow',
    },
    {
      name: 'Write fraud flag (normal)',
      tool: 'Write', input: { file_path: 'data/fraud-flags/CLM-5006' },
      context: { riskLevel: 'high' },
      expectedDecision: 'allow',
    },
    {
      name: 'Attempt to modify claim (blocked)',
      tool: 'Write', input: { file_path: 'data/claims/CLM-5006', content: '{"status":"deny"}' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Attempt customer data access',
      tool: 'Read', input: { file_path: 'data/customers/CUST-004' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Broad investigation sweep',
      tool: 'Read', input: { file_path: 'data/claims/CUST-004' },
      context: { claimsReadInWindow: 75 },
      expectedDecision: 'allow',
    },
    {
      name: 'Cross-tenant snooping',
      tool: 'Read', input: { file_path: 'tenants/competitor/data/claims/CLM-999' },
      context: { tenantId: 'insureco' },
      expectedDecision: 'deny',
    },
  ],

  'policy-advisor': [
    {
      name: 'Read policy (normal)',
      tool: 'Read', input: { file_path: 'data/policies/POL-1001' },
      context: { queryContext: 'coverage-inquiry' },
      expectedDecision: 'allow',
    },
    {
      name: 'Attempt write (blocked)',
      tool: 'Write', input: { file_path: 'data/policies/POL-1001', content: '{"premium":0}' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Attempt bash command (blocked)',
      tool: 'Bash', input: { command: 'rm -rf /' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Attempt claims access (blocked)',
      tool: 'Read', input: { file_path: 'data/claims/CLM-5001' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'Attempt fraud data access',
      tool: 'Read', input: { file_path: 'data/fraud-flags/CLM-5006' },
      context: {},
      expectedDecision: 'deny',
    },
    {
      name: 'High session velocity',
      tool: 'Read', input: { file_path: 'data/policies/POL-1003' },
      context: { queriesInSession: 25, queryContext: 'premium-inquiry' },
      expectedDecision: 'allow',
    },
  ],
};

// ── Run Demo ─────────────────────────────────────────────────────────────

console.log(`\n${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
console.log(`${c.bold}  InsureCo Custom Risk & Audit Models Demo${c.reset}`);
console.log(`${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`);

const agents = filterAgent ? [filterAgent] : listModels();
let totalScenarios = 0;
let totalFlags = 0;

for (const agentId of agents) {
  const agentScenarios = scenarios[agentId];
  if (!agentScenarios) {
    console.log(`${c.yellow}  No scenarios defined for ${agentId}${c.reset}\n`);
    continue;
  }

  const riskModel = createRiskModel(agentId);
  const auditModel = createAuditModel(agentId);

  console.log(`${c.bold}${c.magenta}┌─ ${agentId.toUpperCase()} ─────────────────────────────────────────────${c.reset}`);
  console.log(`${c.gray}│  Risk model: ${agentId}-risk-v1 | Audit model: ${agentId}-audit-v1${c.reset}`);
  console.log(`${c.gray}│${c.reset}`);

  for (const scenario of agentScenarios) {
    totalScenarios++;

    // Run risk model
    const riskResult = riskModel.score(scenario.tool, scenario.input, scenario.context);

    // Run audit model
    const auditEvent = {
      decision: scenario.expectedDecision,
      agentId,
      toolName: scenario.tool,
      toolInput: scenario.input,
      riskScore: riskResult.riskScore,
      reason: `Risk score: ${riskResult.riskScore}`,
    };
    const auditRecord = auditModel.classify(auditEvent, scenario.context);

    // Display
    const tc = tierColor(riskResult.riskTier);
    const decisionIcon = scenario.expectedDecision === 'allow' ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;

    console.log(`${c.gray}│${c.reset}  ${decisionIcon} ${c.bold}${scenario.name}${c.reset}`);
    console.log(`${c.gray}│${c.reset}    Risk: ${tc}${riskResult.riskScore}/100 (${riskResult.riskTier})${c.reset}  |  Audit: ${auditRecord.category}/${auditRecord.subcategory}  |  Severity: ${auditRecord.severity}`);

    if (riskResult.regulatoryFlags.length > 0) {
      totalFlags += riskResult.regulatoryFlags.length;
      for (const flag of riskResult.regulatoryFlags) {
        console.log(`${c.gray}│${c.reset}    ${c.yellow}⚑ ${flag.flag}${c.reset}: ${flag.reason}`);
      }
    }

    if (auditRecord.compliance.length > 0 && verbose) {
      for (const fw of auditRecord.compliance) {
        const refs = (fw.articles || fw.functions || fw.criteria || []).map(a => `${a.ref}:${a.status}`).join(', ');
        console.log(`${c.gray}│${c.reset}    ${c.blue}📋 ${fw.framework}${c.reset}: ${refs}`);
      }
    }

    if (verbose && riskResult.factors.length > 0) {
      for (const f of riskResult.factors) {
        const impactStr = f.impact > 0 ? `${c.red}+${f.impact}${c.reset}` : f.impact < 0 ? `${c.green}${f.impact}${c.reset}` : `${c.gray}0${c.reset}`;
        console.log(`${c.gray}│${c.reset}      ${c.gray}→ ${f.name}: ${impactStr} (${f.reason})${c.reset}`);
      }
    }

    console.log(`${c.gray}│${c.reset}    ${c.gray}Retention: ${auditRecord.retention.days} days — ${auditRecord.retention.reason}${c.reset}`);
  }

  console.log(`${c.gray}│${c.reset}`);
  console.log(`${c.bold}${c.magenta}└────────────────────────────────────────────────────────────${c.reset}\n`);
}

console.log(`${c.bold}Summary:${c.reset} ${totalScenarios} scenarios across ${agents.length} agents, ${totalFlags} regulatory flags raised`);
console.log(`${c.gray}Run with --verbose for detailed factor breakdown and compliance mapping${c.reset}\n`);
