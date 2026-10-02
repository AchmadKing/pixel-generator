import { config } from '../server/config.js';
import { initDatabase } from '../server/db/database.js';
import { reconcileStorageAndDatabase } from '../server/storage/reconciler.js';
import { StorageManager } from '../server/storage/storage-manager.js';
import { JobStore } from '../server/queue/job-store.js';
import { JobQueue } from '../server/queue/job-queue.js';
import { AssetCoordinator } from '../server/queue/asset-coordinator.js';
import { startStudioServer, stopStudioServer } from '../server/index.js';

export async function runDev() {
  console.log('='.repeat(70));
  console.log('       PIXEL GAME ASSET STUDIO — LOCAL WEB WORKBENCH');
  console.log('='.repeat(70));

  console.log(`[INIT] Initializing database at ${config.storage.dbPath}...`);
  const db = initDatabase(config.storage.dbPath);

  console.log(`[INIT] Running startup storage & database reconciler...`);
  const report = reconcileStorageAndDatabase(db, config.storage);
  console.log(`       - Incomplete deletions recovered: ${report.incompleteDeletionsRecovered || 0}`);
  console.log(`       - Stale staging pruned: ${report.staleStagingPruned}`);
  console.log(`       - Orphan folders quarantined: ${report.orphansQuarantined.length}`);
  console.log(`       - Missing backing files flagged: ${report.missingBackingFiles.length}`);

  console.log(`[INIT] Recovering interrupted queue jobs...`);
  const jobStore = new JobStore(db);
  const recoveredCount = jobStore.recoverInterruptedJobs();
  console.log(`       - Interrupted jobs recovered: ${recoveredCount}`);

  const storageManager = new StorageManager(config.storage);
  const assetCoordinator = new AssetCoordinator(db);
  const jobQueue = new JobQueue(db, {}, storageManager, assetCoordinator);

  console.log(`[INIT] Starting native HTTP server...`);
  let serverInfo;
  try {
    serverInfo = await startStudioServer({
      db,
      jobQueue,
      storageManager,
      config
    });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      console.error(`[FATAL] Failed to start server: ${err.message}`);
    }
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log(`  🚀 STUDIO WEB RUNNING AT: ${serverInfo.url}`);
  console.log(`  📁 Storage: ${config.storage.baseDir}`);
  if (config.providers.falKey) {
    console.log(`  ⚡ Active Provider: Fal.ai Cloud Queue (Flux LoRA)`);
  } else {
    console.log(`  🎨 Active Provider: Mock Procedural Pixel Generator [100% OFFLINE READY]`);
  }
  console.log(`  🛑 Press Ctrl+C to stop server cleanly.`);
  console.log('='.repeat(70));

  // Graceful shutdown handling
  let isShuttingDown = false;
  const handleShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[SHUTDOWN] Received ${signal}. Draining queue and closing database cleanly...`);
    try {
      await stopStudioServer(serverInfo.server, jobQueue, db, 5000);
      console.log(`[SHUTDOWN] Server stopped. Goodbye!`);
      process.exit(0);
    } catch (e) {
      console.error(`[SHUTDOWN ERROR] ${e.message}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  return serverInfo;
}
