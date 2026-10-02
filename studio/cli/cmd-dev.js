import { config } from '../server/config.js';
import { initDatabase } from '../server/db/database.js';
import { reconcileStorageAndDatabase } from '../server/storage/reconciler.js';
import { JobStore } from '../server/queue/job-store.js';

export async function runDev() {
  console.log('='.repeat(65));
  console.log('   PIXEL GAME ASSET STUDIO - PHASE 1 FOUNDATION SERVER   ');
  console.log('='.repeat(65));

  console.log(`[INIT] Initializing database at ${config.storage.dbPath}...`);
  const db = initDatabase(config.storage.dbPath);

  console.log(`[INIT] Running startup storage & database reconciler...`);
  const report = reconcileStorageAndDatabase(db, config.storage);
  console.log(`       - Stale staging pruned: ${report.staleStagingPruned}`);
  console.log(`       - Orphan folders quarantined: ${report.orphansQuarantined.length}`);
  console.log(`       - Missing backing files flagged: ${report.missingBackingFiles.length}`);

  console.log(`[INIT] Recovering interrupted queue jobs...`);
  const jobStore = new JobStore(db);
  const recoveredCount = jobStore.recoverInterruptedJobs();
  console.log(`       - Interrupted jobs recovered: ${recoveredCount}`);

  console.log(`[INFO] Server host: ${config.server.host}:${config.server.port}`);
  if (config.providers.falKey) {
    console.log(`[INFO] Active Provider: Fal.ai Cloud Provider Ready`);
  } else {
    console.log(`[INFO] Active Provider: [OFFLINE / MOCK MODE]`);
  }
  console.log(`[READY] Phase 1 Foundation is operational.`);
  console.log('='.repeat(65));
}
