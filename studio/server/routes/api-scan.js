import { scanAndSyncAssets } from '../storage/asset-scanner.js';

export function registerScanRoutes(router, db, storageConfig) {
  // 1. Trigger Filesystem Asset Rescan
  router.post('/api/scan', async (req, res) => {
    try {
      const summary = scanAndSyncAssets(db, storageConfig);
      router.sendJson(res, 200, summary);
    } catch (err) {
      router.sendError(res, 500, 'ERR_SCAN_FAILED', `Failed to scan assets: ${err.message}`);
    }
  });

  // 2. GET /api/scan as a convenience check
  router.get('/api/scan', async (req, res) => {
    try {
      const summary = scanAndSyncAssets(db, storageConfig);
      router.sendJson(res, 200, summary);
    } catch (err) {
      router.sendError(res, 500, 'ERR_SCAN_FAILED', `Failed to scan assets: ${err.message}`);
    }
  });
}
