/**
 * InsureCo mock data — customers, policies, claims
 * Run: node platform/data/seed.js
 */

// ── Customers ──────────────────────────────────────────────────────
export const customers = [
  {
    id: 'CUST-001',
    name: 'Alice Moreau',
    email: 'alice.moreau@example.eu',
    dateOfBirth: '1985-03-14',
    nationality: 'FR',
    address: { street: '12 Rue de Rivoli', city: 'Paris', country: 'FR', postal: '75001' },
    // Protected characteristics — agents must NOT access these for underwriting
    protected: {
      ethnicity: 'European',
      disability: 'none',
      religion: 'Catholic',
      politicalAffiliation: 'none disclosed',
    },
    riskProfile: { creditScore: 742, claimsHistory: 1, yearsAsCustomer: 6 },
  },
  {
    id: 'CUST-002',
    name: 'Bjorn Eriksson',
    email: 'bjorn.eriksson@example.eu',
    dateOfBirth: '1978-11-22',
    nationality: 'SE',
    address: { street: '45 Sveavägen', city: 'Stockholm', country: 'SE', postal: '11134' },
    protected: {
      ethnicity: 'Scandinavian',
      disability: 'mobility impairment',
      religion: 'Lutheran',
      politicalAffiliation: 'Social Democrat',
    },
    riskProfile: { creditScore: 698, claimsHistory: 3, yearsAsCustomer: 12 },
  },
  {
    id: 'CUST-003',
    name: 'Chiara Bianchi',
    email: 'chiara.bianchi@example.eu',
    dateOfBirth: '1992-07-08',
    nationality: 'IT',
    address: { street: '8 Via Roma', city: 'Milan', country: 'IT', postal: '20121' },
    protected: {
      ethnicity: 'Mediterranean',
      disability: 'none',
      religion: 'none disclosed',
      politicalAffiliation: 'none disclosed',
    },
    riskProfile: { creditScore: 781, claimsHistory: 0, yearsAsCustomer: 3 },
  },
  {
    id: 'CUST-004',
    name: 'Dimitri Petrov',
    email: 'dimitri.petrov@example.eu',
    dateOfBirth: '1969-01-30',
    nationality: 'DE',
    address: { street: '22 Friedrichstraße', city: 'Berlin', country: 'DE', postal: '10117' },
    protected: {
      ethnicity: 'Eastern European',
      disability: 'hearing impairment',
      religion: 'Orthodox',
      politicalAffiliation: 'Green Party',
    },
    riskProfile: { creditScore: 655, claimsHistory: 7, yearsAsCustomer: 18 },
  },
];

// ── Policies ───────────────────────────────────────────────────────
export const policies = [
  {
    id: 'POL-1001',
    customerId: 'CUST-001',
    type: 'auto',
    status: 'active',
    premium: 1200,
    coverage: 50000,
    deductible: 500,
    startDate: '2025-01-01',
    endDate: '2026-01-01',
    autoApproveLimit: 5000,
  },
  {
    id: 'POL-1002',
    customerId: 'CUST-002',
    type: 'home',
    status: 'active',
    premium: 2400,
    coverage: 350000,
    deductible: 1000,
    startDate: '2024-06-01',
    endDate: '2025-06-01',
    autoApproveLimit: 5000,
  },
  {
    id: 'POL-1003',
    customerId: 'CUST-003',
    type: 'health',
    status: 'active',
    premium: 3600,
    coverage: 100000,
    deductible: 250,
    startDate: '2025-03-01',
    endDate: '2026-03-01',
    autoApproveLimit: 3000,
  },
  {
    id: 'POL-1004',
    customerId: 'CUST-004',
    type: 'auto',
    status: 'active',
    premium: 1800,
    coverage: 75000,
    deductible: 750,
    startDate: '2025-02-01',
    endDate: '2026-02-01',
    autoApproveLimit: 5000,
  },
  {
    id: 'POL-1005',
    customerId: 'CUST-001',
    type: 'life',
    status: 'active',
    premium: 4800,
    coverage: 500000,
    deductible: 0,
    startDate: '2024-01-01',
    endDate: '2034-01-01',
    autoApproveLimit: 0, // life claims always require human review
  },
];

// ── Claims ─────────────────────────────────────────────────────────
export const claims = [
  {
    id: 'CLM-5001',
    policyId: 'POL-1001',
    customerId: 'CUST-001',
    type: 'auto',
    amount: 2800,
    status: 'pending',
    description: 'Rear-end collision at intersection, minor body damage',
    filedDate: '2025-11-15',
    evidence: ['photos/clm-5001-damage.jpg', 'police-report-5001.pdf'],
  },
  {
    id: 'CLM-5002',
    policyId: 'POL-1002',
    customerId: 'CUST-002',
    type: 'home',
    amount: 12500,
    status: 'pending',
    description: 'Water damage from burst pipe, kitchen and basement flooded',
    filedDate: '2025-12-01',
    evidence: ['photos/clm-5002-flood.jpg', 'plumber-report-5002.pdf'],
  },
  {
    id: 'CLM-5003',
    policyId: 'POL-1003',
    customerId: 'CUST-003',
    type: 'health',
    amount: 1500,
    status: 'pending',
    description: 'Emergency room visit for sprained ankle during skiing',
    filedDate: '2025-12-20',
    evidence: ['medical-report-5003.pdf'],
  },
  {
    id: 'CLM-5004',
    policyId: 'POL-1004',
    customerId: 'CUST-004',
    type: 'auto',
    amount: 45000,
    status: 'pending',
    description: 'Total loss — vehicle struck by uninsured driver on Autobahn',
    filedDate: '2026-01-05',
    evidence: ['photos/clm-5004-total.jpg', 'police-report-5004.pdf', 'tow-receipt-5004.pdf'],
  },
  {
    id: 'CLM-5005',
    policyId: 'POL-1001',
    customerId: 'CUST-001',
    type: 'auto',
    amount: 800,
    status: 'pending',
    description: 'Windshield crack from road debris',
    filedDate: '2026-02-10',
    evidence: ['photos/clm-5005-windshield.jpg'],
  },
  // Suspicious claim for fraud detection
  {
    id: 'CLM-5006',
    policyId: 'POL-1004',
    customerId: 'CUST-004',
    type: 'auto',
    amount: 4900,
    status: 'pending',
    description: 'Catalytic converter theft from parked vehicle',
    filedDate: '2026-02-12',
    evidence: ['photos/clm-5006-undercarriage.jpg'],
    _flags: { rapidSuccession: true, justUnderAutoApprove: true }, // fraud signals
  },
];

// ── In-memory store ────────────────────────────────────────────────
export class DataStore {
  constructor() {
    this.customers = new Map(customers.map(c => [c.id, structuredClone(c)]));
    this.policies = new Map(policies.map(p => [p.id, structuredClone(p)]));
    this.claims = new Map(claims.map(c => [c.id, structuredClone(c)]));
    this.auditLog = [];
  }

  getCustomer(id) { return this.customers.get(id) || null; }
  getPolicy(id) { return this.policies.get(id) || null; }
  getClaim(id) { return this.claims.get(id) || null; }

  getCustomerSafe(id) {
    const c = this.getCustomer(id);
    if (!c) return null;
    const { protected: _p, ...safe } = c;
    return safe;
  }

  getCustomerProtected(id) {
    const c = this.getCustomer(id);
    return c?.protected || null;
  }

  getClaimsForCustomer(customerId) {
    return [...this.claims.values()].filter(c => c.customerId === customerId);
  }

  getClaimsForPolicy(policyId) {
    return [...this.claims.values()].filter(c => c.policyId === policyId);
  }

  updateClaim(id, updates) {
    const claim = this.claims.get(id);
    if (!claim) return null;
    Object.assign(claim, updates, { updatedAt: new Date().toISOString() });
    return claim;
  }

  addAuditEntry(entry) {
    this.auditLog.push({ ...entry, timestamp: new Date().toISOString() });
  }
}

// CLI: create and print summary
if (process.argv[1]?.endsWith('seed.js')) {
  const store = new DataStore();
  console.log(`Seeded: ${store.customers.size} customers, ${store.policies.size} policies, ${store.claims.size} claims`);
}
