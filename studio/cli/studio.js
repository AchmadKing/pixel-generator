#!/usr/bin/env node
import { runDoctor } from './cmd-doctor.js';
import { runDev } from './cmd-dev.js';
import { runScan } from './cmd-scan.js';

const command = process.argv[2] || 'help';

async function main() {
  switch (command.toLowerCase()) {
    case 'doctor': {
      const ok = await runDoctor();
      process.exit(ok ? 0 : 1);
      break;
    }
    case 'scan': {
      const ok = await runScan();
      process.exit(ok ? 0 : 1);
      break;
    }
    case 'dev': {
      await runDev();
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    default: {
      console.log(`
Pixel Game Asset Studio CLI
Usage: node studio/cli/studio.js <command>

Commands:
  doctor    Run environment, database, storage & security diagnostics
  scan      Scan assets/generated/ and synchronize external agent assets
  dev       Initialize and run the local studio foundation server
  help      Show this help message
      `);
      break;
    }
  }
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
