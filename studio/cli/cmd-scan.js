import { initDatabase } from '../server/db/database.js';
import { StorageManager } from '../server/storage/storage-manager.js';
import { scanAndSyncAssets } from '../server/storage/asset-scanner.js';
import { config } from '../server/config.js';

export async function runScan() {
  console.log('='.repeat(60));
  console.log(' Pixel Game Asset Studio — Filesystem Asset Scanner');
  console.log('='.repeat(60));
  console.log(`Scanning: ${config.storage.generatedDir}`);

  const storageManager = new StorageManager(config.storage);
  storageManager.ensureDirectories();

  const db = initDatabase(config.storage.dbPath);

  try {
    const summary = scanAndSyncAssets(db, config.storage);
    console.log(`\nScan Complete:`);
    console.log(`  Directories Scanned: ${summary.scannedAssets}`);
    console.log(`  Assets Added:        ${summary.addedAssets}`);
    console.log(`  Versions Added:      ${summary.addedVersions}`);
    console.log(`  Versions Updated:    ${summary.updatedVersions}`);

    if (summary.errors && summary.errors.length > 0) {
      console.warn(`\nWarnings/Errors encountered:`);
      for (const err of summary.errors) {
        console.warn(`  - ${err}`);
      }
    }
    console.log('='.repeat(60));
    return true;
  } catch (err) {
    console.error(`\n[ERROR] Scan failed: ${err.message}`);
    return false;
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}
