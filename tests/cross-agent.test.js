/**
 * Cross-Agent Boundary Tests — SOE-361
 * 28 tests: separation of duties, universal denies, deny-first, fail-closed
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluate, assertAllow, assertDeny } from './helpers.js';

const ALL_AGENTS = ['claims-bot', 'underwrite-ai', 'fraud-hunter', 'policy-advisor'];

// ── Separation of Duties ─────────────────────────────────────────────

describe('Separation of Duties — Write permissions', () => {
  it('claims-bot CAN write claims', async () => {
    assertAllow(await evaluate('claims-bot', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('fraud-hunter CANNOT write claims', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('fraud-hunter CAN write fraud-flags', async () => {
    assertAllow(await evaluate('fraud-hunter', 'Write', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('underwrite-ai CANNOT write fraud-flags', async () => {
    assertDeny(await evaluate('underwrite-ai', 'Write', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('underwrite-ai CAN write risk-assessments', async () => {
    assertAllow(await evaluate('underwrite-ai', 'Write', { file_path: 'data/risk-assessments/CUST-001-auto' }));
  });

  it('claims-bot CANNOT write risk-assessments', async () => {
    assertDeny(await evaluate('claims-bot', 'Write', { file_path: 'data/risk-assessments/CUST-001-auto' }));
  });

  it('policy-advisor CANNOT write anything claims-bot can', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });

  it('policy-advisor CANNOT write anything fraud-hunter can', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/fraud-flags/CLM-5001' }));
  });

  it('policy-advisor CANNOT write anything underwrite-ai can', async () => {
    assertDeny(await evaluate('policy-advisor', 'Write', { file_path: 'data/risk-assessments/X' }));
  });
});

describe('Separation of Duties — Read permissions', () => {
  it('claims-bot CAN read customers', async () => {
    assertAllow(await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001' }));
  });

  it('fraud-hunter CANNOT read customers', async () => {
    assertDeny(await evaluate('fraud-hunter', 'Read', { file_path: 'data/customers/CUST-001' }));
  });
});

// ── Universal Denies (all 4 agents) ─────────────────────────────────

describe('Universal Denies — Protected data', () => {
  for (const agent of ALL_AGENTS) {
    it(`${agent} DENY read protected data`, async () => {
      assertDeny(await evaluate(agent, 'Read', { file_path: 'data/customers/CUST-001/protected' }));
    });
  }
});

describe('Universal Denies — Secrets', () => {
  for (const agent of ALL_AGENTS) {
    it(`${agent} DENY read .env`, async () => {
      assertDeny(await evaluate(agent, 'Read', { file_path: '.env' }));
    });
  }
});

describe('Universal Denies — Bash', () => {
  for (const agent of ALL_AGENTS) {
    it(`${agent} DENY bash commands`, async () => {
      assertDeny(await evaluate(agent, 'Bash', { command: 'whoami' }));
    });
  }
});

// ── Deny-First Evaluation Order ──────────────────────────────────────

describe('Deny-first evaluation order', () => {
  it('readDeny overrides readAllow (customers/*/protected vs customers/*)', async () => {
    // claims-bot has readAllow: data/customers/* and readDeny: data/customers/*/protected
    assertAllow(await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001' }));
    assertDeny(await evaluate('claims-bot', 'Read', { file_path: 'data/customers/CUST-001/protected' }));
  });

  it('writeDeny overrides writeAllow when both match (fraud-hunter claims)', async () => {
    // fraud-hunter: writeDeny includes data/claims/**, no writeAllow for claims
    assertDeny(await evaluate('fraud-hunter', 'Write', { file_path: 'data/claims/CLM-5001' }));
  });
});

// ── Fail-Closed ──────────────────────────────────────────────────────

describe('Fail-closed behavior', () => {
  it('unknown agent → deny', async () => {
    const r = await evaluate('unknown-agent', 'Read', { file_path: 'data/claims/CLM-5001' });
    assertDeny(r);
    assert.ok(r.reason.includes('No SOE definition'));
  });

  it('empty path → deny (not in any allow pattern)', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: '' });
    assertDeny(r);
  });

  it('path traversal → deny', async () => {
    const r = await evaluate('claims-bot', 'Read', { file_path: '../../../etc/passwd' });
    assertDeny(r);
  });

  it('unknown tool type → deny', async () => {
    const r = await evaluate('claims-bot', 'Execute', { command: 'anything' });
    assertDeny(r);
    assert.ok(r.reason.includes('not recognized'));
  });
});
