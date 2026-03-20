/**
 * Sentinel-Ops client — wraps the SOE evaluate API.
 * Every agent action goes through this gate before execution.
 *
 * Config via env:
 *   SOE_API_URL    — Sentinel-Ops API endpoint (default: http://localhost:3000)
 *   SOE_API_KEY    — API key auth
 *   SOE_JWT_TOKEN  — JWT auth (takes precedence over API key)
 */

const SOE_API_URL = process.env.SOE_API_URL || 'http://localhost:3000';

function authHeaders() {
  if (process.env.SOE_JWT_TOKEN) {
    return { Authorization: `Bearer ${process.env.SOE_JWT_TOKEN}` };
  }
  if (process.env.SOE_API_KEY) {
    return { 'X-SOE-Api-Key': process.env.SOE_API_KEY };
  }
  return {};
}

/**
 * Evaluate a tool call against the agent's SOE.
 * Returns { decision, reason, ... } from Sentinel-Ops.
 * On network failure: returns deny (fail-closed).
 */
export async function evaluate(agentId, toolName, toolInput) {
  try {
    const res = await fetch(`${SOE_API_URL}/v1/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ appId: agentId, toolName, toolInput }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        decision: 'deny',
        reason: `SOE gate returned HTTP ${res.status}: ${body}`,
        layer: 'client-error',
        failClosed: true,
      };
    }

    return await res.json();
  } catch (err) {
    // Fail closed — if we can't reach the gate, deny
    return {
      decision: 'deny',
      reason: `SOE gate unreachable: ${err.message}`,
      layer: 'client-error',
      failClosed: true,
    };
  }
}

/**
 * Deploy an SOE definition for an agent.
 */
export async function deploy(soeDefinition) {
  try {
    const res = await fetch(`${SOE_API_URL}/v1/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ soe: soeDefinition }),
      signal: AbortSignal.timeout(10000),
    });
    return await res.json();
  } catch (err) {
    return { deployed: false, error: err.message };
  }
}

/**
 * Guarded action — evaluate first, execute only if allowed.
 * This is the primary function agents use.
 */
export async function guardedAction(agentId, toolName, toolInput, executeFn) {
  const evaluation = await evaluate(agentId, toolName, toolInput);

  const result = {
    agentId,
    toolName,
    toolInput,
    evaluation,
    executed: false,
    output: null,
  };

  if (evaluation.decision === 'allow') {
    result.executed = true;
    result.output = await executeFn();
  } else if (evaluation.decision === 'escalate') {
    result.output = { escalated: true, reason: evaluation.reason };
  }
  // deny: result.executed stays false

  return result;
}
