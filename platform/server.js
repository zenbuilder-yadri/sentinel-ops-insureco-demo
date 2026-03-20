/**
 * InsureCo Platform API
 * A minimal insurance SaaS backend that serves as the
 * "target application" governed by Sentinel-Ops.
 */

import http from 'node:http';
import { DataStore } from './data/seed.js';

const PORT = process.env.PORT || 4000;
const store = new DataStore();

// Make store available to agents
export { store };

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // ── Health ─────────────────────────────────────────
  if (path === '/health') {
    return json(res, 200, { status: 'ok', service: 'insureco-platform' });
  }

  // ── Customers ──────────────────────────────────────
  if (method === 'GET' && path.startsWith('/api/customers/')) {
    const id = path.split('/')[3];
    const safe = url.searchParams.get('fields') === 'protected'
      ? store.getCustomerProtected(id)
      : store.getCustomerSafe(id);
    return safe ? json(res, 200, safe) : json(res, 404, { error: 'Customer not found' });
  }

  if (method === 'GET' && path === '/api/customers') {
    const all = [...store.customers.values()].map(({ protected: _p, ...c }) => c);
    return json(res, 200, all);
  }

  // ── Policies ───────────────────────────────────────
  if (method === 'GET' && path.startsWith('/api/policies/')) {
    const id = path.split('/')[3];
    const p = store.getPolicy(id);
    return p ? json(res, 200, p) : json(res, 404, { error: 'Policy not found' });
  }

  if (method === 'GET' && path === '/api/policies') {
    return json(res, 200, [...store.policies.values()]);
  }

  // ── Claims ─────────────────────────────────────────
  if (method === 'GET' && path.startsWith('/api/claims/')) {
    const id = path.split('/')[3];
    const c = store.getClaim(id);
    return c ? json(res, 200, c) : json(res, 404, { error: 'Claim not found' });
  }

  if (method === 'GET' && path === '/api/claims') {
    const customerId = url.searchParams.get('customerId');
    const policyId = url.searchParams.get('policyId');
    let claims;
    if (customerId) claims = store.getClaimsForCustomer(customerId);
    else if (policyId) claims = store.getClaimsForPolicy(policyId);
    else claims = [...store.claims.values()];
    return json(res, 200, claims);
  }

  if (method === 'PATCH' && path.startsWith('/api/claims/')) {
    const id = path.split('/')[3];
    const body = await parseBody(req);
    const updated = store.updateClaim(id, body);
    return updated ? json(res, 200, updated) : json(res, 404, { error: 'Claim not found' });
  }

  // ── Audit log ──────────────────────────────────────
  if (method === 'GET' && path === '/api/audit') {
    return json(res, 200, store.auditLog);
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`InsureCo Platform API running on http://localhost:${PORT}`);
  console.log(`  ${store.customers.size} customers, ${store.policies.size} policies, ${store.claims.size} claims loaded`);
});
