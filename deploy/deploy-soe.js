/**
 * Deploy all SOE definitions to Sentinel-Ops.
 *
 * Usage:
 *   SOE_API_URL=https://your-alb.amazonaws.com SOE_API_KEY=your-key node deploy/deploy-soe.js
 *   SOE_API_URL=... SOE_API_KEY=... node deploy/deploy-soe.js --dry-run
 *
 * See: https://github.com/aiworksllc/sentinel-ops/blob/main/docs/GETTING_STARTED.md
 */

import { readFileSync, readdirSync } from 'node:fs';
import { deploy } from '../platform/soe-client.js';

const SOE_DIR = new URL('../soe-definitions', import.meta.url).pathname;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // Pre-flight checks
  if (!process.env.SOE_API_URL) {
    console.error('ERROR: SOE_API_URL not set.\n');
    console.error('  Export your Sentinel-Ops API endpoint:');
    console.error('    export SOE_API_URL=https://your-sentinel-ops-alb.amazonaws.com\n');
    console.error('  See: https://github.com/aiworksllc/sentinel-ops/blob/main/docs/GETTING_STARTED.md');
    process.exit(1);
  }
  if (!process.env.SOE_API_KEY && !process.env.SOE_JWT_TOKEN) {
    console.error('ERROR: SOE_API_KEY (or SOE_JWT_TOKEN) not set.\n');
    console.error('  Retrieve your API key from Secrets Manager:');
    console.error('    aws secretsmanager get-secret-value --secret-id <SoeApiKeySecretArn> --query SecretString --output text | jq -r .key\n');
    console.error('  See: https://github.com/aiworksllc/sentinel-ops/blob/main/docs/GETTING_STARTED.md');
    process.exit(1);
  }

  const files = readdirSync(SOE_DIR).filter(f => f.endsWith('.soe.json'));
  console.log(`\n  InsureCo SOE Deployment${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`  Target: ${process.env.SOE_API_URL}`);
  console.log(`  Definitions: ${files.length}\n`);

  let ok = 0;
  let fail = 0;

  for (const file of files) {
    const soe = JSON.parse(readFileSync(`${SOE_DIR}/${file}`, 'utf-8'));
    const euClass = soe.classification?.euAiAct || 'unclassified';

    if (DRY_RUN) {
      console.log(`  [DRY] ${soe.agentId.padEnd(20)} ${euClass}`);
      ok++;
      continue;
    }

    const result = await deploy(soe);
    if (result.deployed) {
      console.log(`  [OK]   ${soe.agentId.padEnd(20)} ${euClass}`);
      ok++;
    } else {
      console.log(`  [FAIL] ${soe.agentId.padEnd(20)} ${euClass}`);
      console.log(`         ${result.error || JSON.stringify(result)}`);
      fail++;
    }
  }

  console.log(`\n  Summary: ${ok}/${files.length} deployed${fail ? `, ${fail} failed` : ''}${DRY_RUN ? ' (dry run)' : ''}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
