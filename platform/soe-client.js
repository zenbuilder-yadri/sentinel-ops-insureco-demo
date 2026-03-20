/**
 * Sentinel-Ops client — wraps the SOE evaluate API.
 * Every agent action goes through this gate before execution.
 *
 * Required env:
 *   SOE_API_URL     — Sentinel-Ops API endpoint (your CFN stack URL)
 *   SOE_API_KEY     — API key auth
 *   SOE_JWT_TOKEN   — JWT auth (takes precedence over API key)
 *
 * Internal (test only):
 *   SOE_MODE=local  — used by test suite to evaluate against .soe.json files
 *                      without a running Sentinel-Ops instance
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from './soe-local.js';

function getMode() { return process.env.SOE_MODE === 'local' ? 'local' : 'remote'; }
function getApiUrl() { return process.env.SOE_API_URL; }

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOE_DIR = resolve(__dirname, '..', 'soe-definitions');

// Cache loaded SOE definitions
const _soeCache = new Map();

function loadSoe(agentId) {
  if (_soeCache.has(agentId)) return _soeCache.get(agentId);
  try {
    const raw = readFileSync(resolve(SOE_DIR, `${agentId}.soe.json`), 'utf-8');
    const soe = JSON.parse(raw);
    _soeCache.set(agentId, soe);
    return soe;
  } catch {
    return null;
  }
}

/**
 * Local SOE evaluation — same logic as Sentinel-Ops deterministic pre-filter.
 */
function evaluateLocal(agentId, toolName, toolInput) {
  const soe = loadSoe(agentId);
  if (!soe) {
    return { decision: 'deny', reason: `No SOE definition found for "${agentId}"`, layer: 'local' };
  }

  const tool = toolName.toLowerCase();
  const path = toolInput?.file_path || toolInput?.path || '';

  // Bash check
  if (tool === 'bash') {
    const cmd = toolInput?.command || '';
    const bashRules = soe.toolActions?.bash;
    if (bashRules) {
      for (const pattern of (bashRules.deny || [])) {
        if (pattern === '*' || minimatch(cmd, pattern)) {
          return { decision: 'deny', reason: `Bash command "${cmd}" denied by pattern "${pattern}".`, layer: 'local', agentId, toolName };
        }
      }
    }
  }

  // Read check
  if (tool === 'read') {
    for (const pattern of (soe.dataAccess?.readDeny || [])) {
      if (minimatch(path, pattern)) {
        return { decision: 'deny', reason: `Path "${path}" matches readDeny pattern "${pattern}".`, layer: 'local', agentId, toolName };
      }
    }
    for (const pattern of (soe.dataAccess?.readAllow || [])) {
      if (minimatch(path, pattern)) {
        return { decision: 'allow', reason: `Path "${path}" matches readAllow pattern "${pattern}".`, layer: 'local', agentId, toolName };
      }
    }
    return { decision: 'deny', reason: `Path "${path}" not in readAllow.`, layer: 'local', agentId, toolName };
  }

  // Write check
  if (tool === 'write' || tool === 'edit') {
    for (const pattern of (soe.dataAccess?.writeDeny || [])) {
      if (minimatch(path, pattern)) {
        return { decision: 'deny', reason: `Path "${path}" matches writeDeny pattern "${pattern}".`, layer: 'local', agentId, toolName };
      }
    }
    for (const pattern of (soe.dataAccess?.writeAllow || [])) {
      if (minimatch(path, pattern)) {
        return { decision: 'allow', reason: `Path "${path}" matches writeAllow pattern "${pattern}".`, layer: 'local', agentId, toolName };
      }
    }
    return { decision: 'deny', reason: `Path "${path}" not in writeAllow.`, layer: 'local', agentId, toolName };
  }

  // Unknown tool — deny by default
  return { decision: 'deny', reason: `Tool "${toolName}" not recognized.`, layer: 'local', agentId, toolName };
}

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
 * Calls the Sentinel-Ops API deployed in your AWS account.
 * Fail-closed: if the API is unreachable or credentials missing, all actions are denied.
 *
 * SOE_MODE=local is reserved for the test suite only.
 */
export async function evaluate(agentId, toolName, toolInput) {
  if (getMode() === 'local') {
    return evaluateLocal(agentId, toolName, toolInput);
  }

  if (!getApiUrl()) {
    return {
      decision: 'deny',
      reason: 'SOE_API_URL not configured. Deploy Sentinel-Ops in your AWS account and set SOE_API_URL + SOE_API_KEY. See https://yadriworks.ai/docs',
      layer: 'client-error',
      failClosed: true,
    };
  }

  if (!process.env.SOE_API_KEY && !process.env.SOE_JWT_TOKEN) {
    return {
      decision: 'deny',
      reason: 'No SOE credentials. Set SOE_API_KEY or SOE_JWT_TOKEN. See https://yadriworks.ai/docs',
      layer: 'client-error',
      failClosed: true,
    };
  }

  try {
    const res = await fetch(`${getApiUrl()}/v1/evaluate`, {
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
    return {
      decision: 'deny',
      reason: `SOE gate unreachable: ${err.message}`,
      layer: 'client-error',
      failClosed: true,
    };
  }
}

/**
 * Deploy an SOE definition to the Sentinel-Ops API.
 */
export async function deploy(soeDefinition) {
  if (getMode() === 'local') {
    return { deployed: true, mode: 'local', agentId: soeDefinition.agentId };
  }

  if (!getApiUrl() || (!process.env.SOE_API_KEY && !process.env.SOE_JWT_TOKEN)) {
    return { deployed: false, error: 'SOE_API_URL and SOE_API_KEY required. Deploy Sentinel-Ops first. See https://yadriworks.ai/docs' };
  }

  try {
    const res = await fetch(`${getApiUrl()}/v1/deploy`, {
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
