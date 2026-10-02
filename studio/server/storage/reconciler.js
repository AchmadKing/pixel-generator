import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { AssetDeletionOrchestrator } from './asset-deletion-orchestrator.js';

const STALE_STAGING_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Reconciles the filesystem with the SQLite database upon server startup.
 * 0. Recovers incomplete asset deletions from the deletion journal.
 * 1. Prunes only stale staging files (>15m). Preserves active staging files.
 * 2. Scans generated folder, excluding hidden directories (.staging, .quarantine).
 *    Moves orphan version folders to .quarantine/ and logs audit warning.
 * 3. Checks backing files for all asset_versions in SQLite. Flags missing files
 *    with integrity_status = 'missing_backing_file' without deleting the metadata.
 */
export function reconcileStorageAndDatabase(db, storageConfig = config.storage) {
  const auditReport = {
    staleStagingPruned: 0,
    orphansQuarantined: [],
    missingBackingFiles: [],
    incompleteDeletionsRecovered: 0
  };

  // 0. Incomplete Asset Deletions Recovery
  const deletionReport = AssetDeletionOrchestrator.recoverIncompleteDeletions(db, storageConfig);
  auditReport.incompleteDeletionsRecovered = deletionReport.purged + deletionReport.quarantined;

  // 1. Staging Cleanup (Stale only)
  if (fs.existsSync(storageConfig.stagingDir)) {
    const now = Date.now();
    const files = fs.readdirSync(storageConfig.stagingDir);
    for (const file of files) {
      if (file.startsWith('.')) continue; // Keep .gitkeep, etc.
      const filePath = path.join(storageConfig.stagingDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > STALE_STAGING_TTL_MS) {
          fs.unlinkSync(filePath);
          auditReport.staleStagingPruned++;
        }
      } catch (e) {
        console.warn(`[RECONCILER] Error checking staging file ${file}: ${e.message}`);
      }
    }
  }

  // 2. Quarantine Orphan Version Folders
  if (fs.existsSync(storageConfig.generatedDir)) {
    const assetFolders = fs.readdirSync(storageConfig.generatedDir);
    for (const assetId of assetFolders) {
      // Guardrail: Exclude hidden/special directories
      if (assetId.startsWith('.')) continue;

      const assetDirPath = path.join(storageConfig.generatedDir, assetId);
      if (!fs.statSync(assetDirPath).isDirectory()) continue;

      const versionFolders = fs.readdirSync(assetDirPath);
      for (const versionId of versionFolders) {
        if (versionId.startsWith('.')) continue;

        const versionDirPath = path.join(assetDirPath, versionId);
        if (!fs.statSync(versionDirPath).isDirectory()) continue;

        // Verify if version exists in SQLite database
        const exists = db.prepare(`
          SELECT 1 FROM asset_versions 
          WHERE asset_id = ? AND id = ?
        `).get(assetId, versionId);

        if (!exists) {
          // Do NOT delete directly! Quarantine the folder.
          if (!fs.existsSync(storageConfig.quarantineDir)) {
            fs.mkdirSync(storageConfig.quarantineDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const quarantineTarget = path.join(
            storageConfig.quarantineDir,
            `${timestamp}_${assetId}_${versionId}`
          );

          fs.renameSync(versionDirPath, quarantineTarget);
          auditReport.orphansQuarantined.push({
            assetId,
            versionId,
            quarantinedTo: quarantineTarget
          });
          console.warn(`[AUDIT WARN] Orphan version folder quarantined: ${quarantineTarget}`);
        }
      }

      // If asset directory is now empty and has no versions in DB, clean it
      const remainingVersions = fs.readdirSync(assetDirPath).filter(f => !f.startsWith('.'));
      if (remainingVersions.length === 0) {
        const hasAssetInDb = db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId);
        if (!hasAssetInDb) {
          try {
            fs.rmdirSync(assetDirPath);
          } catch (_) {}
        }
      }
    }
  }

  // 3. Check for Missing Backing Files in Database Records
  const allVersions = db.prepare(`
    SELECT id, asset_id, raw_file_path, processed_file_path, integrity_status 
    FROM asset_versions
  `).all();

  for (const ver of allVersions) {
    const rawExists = fs.existsSync(ver.raw_file_path);
    const procExists = fs.existsSync(ver.processed_file_path);

    if (!rawExists || !procExists) {
      db.prepare(`
        UPDATE asset_versions 
        SET integrity_status = 'missing_backing_file',
            integrity_error = ?
        WHERE id = ?
      `).run(
        `Backing file missing: raw=${rawExists ? 'ok' : 'missing'}, processed=${procExists ? 'ok' : 'missing'}`,
        ver.id
      );

      auditReport.missingBackingFiles.push({
        id: ver.id,
        assetId: ver.asset_id,
        rawMissing: !rawExists,
        procMissing: !procExists
      });
      console.warn(`[AUDIT WARN] Missing backing file for version ${ver.id} of asset ${ver.asset_id}`);
    } else if (ver.integrity_status !== 'ok') {
      // Restore to ok if files were restored
      db.prepare(`
        UPDATE asset_versions 
        SET integrity_status = 'ok',
            integrity_error = NULL
        WHERE id = ?
      `).run(ver.id);
    }
  }

  return auditReport;
}
