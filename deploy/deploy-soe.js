/**
 * Deploy all SOE definitions to Sentinel-Ops.
 * Run: SOE_API_URL=https://api.yadriworks.ai SOE_API_KEY=xxx node deploy/deploy-soe.js
 */

import { readFileSync, readdirSync } from 'node:fs';
import { deploy } from '../platform/soe-client.js';

const SOE_DIR = new URL('../soe-definitions', import.meta.url).pathname;

async function main() {
  const files = readdirSync(SOE_DIR).filter(f => f.endsWith('.soe.json'));
  console.log(`Deploying ${files.length} SOE definitions...\n`);

  for (const file of files) {
    const soe = JSON.parse(readFileSync(`${SOE_DIR}/${file}`, 'utf-8'));
    const result = await deploy(soe);
    const status = result.deployed ? 'OK' : 'FAIL';
    console.log(`  [${status}] ${soe.agentId} (${soe.classification?.euAiAct || 'unclassified'})`);
    if (!result.deployed) console.log(`         ${result.error || JSON.stringify(result)}`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
