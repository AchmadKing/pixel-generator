import fs from 'node:fs';
import path from 'node:path';
import { deleteAssetSafely } from '../db/safe-deletion.js';
import { resolveSafePath } from './path-jail.js';

export class AssetDeletionOrchestrator {
  constructor(db, storageManager, assetCoordinator = null) {
    this.db = db;
    this.storageManager = storageManager;
    this.coordinator = assetCoordinator;
  }

  /**
   * Executes a failure-safe, crash-recoverable asset deletion.
   */
  async deleteAssetWithStorage(assetId) {
    if (!assetId || typeof assetId !== 'string') {
      const err = new Error('Invalid asset ID provided.');
      err.code = 'ERR_INVALID_ASSET_ID';
      err.statusCode = 400;
      throw err;
    }

    // 1. In-flight job & deletion concurrency guard
    if (this.coordinator) {
      const lockAcquired = this.coordinator.acquireDeletionLock(assetId);
      if (!lockAcquired) {
        const err = new Error(`Cannot delete asset ${assetId}: Asset has active or queued generation jobs.`);
        err.code = 'ERR_ASSET_BUSY';
        err.statusCode = 409;
        throw err;
      }
    } else {
      // Fallback direct DB check if no coordinator supplied
      const activeJob = this.db.prepare(`
        SELECT id FROM jobs 
        WHERE asset_id = ? AND status IN ('queued', 'running')
      `).get(assetId);
      if (activeJob) {
        const err = new Error(`Cannot delete asset ${assetId}: Asset has active or queued generation jobs.`);
        err.code = 'ERR_ASSET_BUSY';
        err.statusCode = 409;
        throw err;
      }
    }

    try {
      // 2. Verify asset exists in SQLite
      const asset = this.db.prepare('SELECT id, project_id FROM assets WHERE id = ?').get(assetId);
      if (!asset) {
        const err = new Error(`Asset not found: ${assetId}`);
        err.code = 'ERR_ASSET_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      // 3. Pre-compute and validate canonical storage path
      const generatedDir = this.storageManager.config.generatedDir;
      const targetDir = resolveSafePath(generatedDir, assetId);

      // 4. Record 'pending' state in persistent deletion journal
      this.db.prepare(`
        INSERT INTO asset_deletion_journal (asset_id, stage, target_dir, created_at, updated_at)
        VALUES (?, 'pending', ?, unixepoch(), unixepoch())
        ON CONFLICT(asset_id) DO UPDATE SET 
          stage = 'pending',
          target_dir = excluded.target_dir,
          updated_at = unixepoch()
      `).run(assetId, targetDir);

      // 5. Atomic database deletion
      const dbChanges = deleteAssetSafely(this.db, assetId);
      if (!dbChanges) {
        this.db.prepare(`
          UPDATE asset_deletion_journal 
          SET stage = 'failed', error_message = 'deleteAssetSafely returned 0 changes', updated_at = unixepoch()
          WHERE asset_id = ?
        `).run(assetId);
        const err = new Error(`Failed to delete asset ${assetId} from database.`);
        err.code = 'ERR_DB_DELETE_FAILED';
        err.statusCode = 500;
        throw err;
      }

      // 6. Record 'db_deleted' stage in journal
      this.db.prepare(`
        UPDATE asset_deletion_journal 
        SET stage = 'db_deleted', updated_at = unixepoch()
        WHERE asset_id = ?
      `).run(assetId);

      // 7. Physical filesystem purge
      let fsCleaned = false;
      let quarantined = false;
      let warning = null;

      if (fs.existsSync(targetDir)) {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
          fsCleaned = true;
          // Completed cleanly: remove journal entry
          this.db.prepare('DELETE FROM asset_deletion_journal WHERE asset_id = ?').run(assetId);
        } catch (fsErr) {
          // File lock (EBUSY / EPERM on Windows) or filesystem error
          warning = `Filesystem purge error: ${fsErr.message}`;
          try {
            const quarantineDir = this.storageManager.config.quarantineDir;
            if (!fs.existsSync(quarantineDir)) {
              fs.mkdirSync(quarantineDir, { recursive: true });
            }
            const quarantinedPath = path.join(quarantineDir, `deleted_${Date.now()}_${assetId}`);
            fs.renameSync(targetDir, quarantinedPath);
            quarantined = true;
            this.db.prepare(`
              UPDATE asset_deletion_journal 
              SET stage = 'quarantined', target_dir = ?, error_message = ?, updated_at = unixepoch()
              WHERE asset_id = ?
            `).run(quarantinedPath, fsErr.message, assetId);
          } catch (quarantineErr) {
            this.db.prepare(`
              UPDATE asset_deletion_journal 
              SET stage = 'db_deleted', error_message = ?, updated_at = unixepoch()
              WHERE asset_id = ?
            `).run(`${fsErr.message} | Quarantine failed: ${quarantineErr.message}`, assetId);
          }
        }
      } else {
        // Physical directory was already absent
        fsCleaned = true;
        this.db.prepare('DELETE FROM asset_deletion_journal WHERE asset_id = ?').run(assetId);
      }

      return {
        success: true,
        assetId,
        dbDeleted: true,
        fsCleaned,
        quarantined,
        warning
      };
    } finally {
      if (this.coordinator) {
        this.coordinator.releaseDeletionLock(assetId);
      }
    }
  }

  /**
   * Recovers any incomplete deletion journal records during startup.
   */
  static recoverIncompleteDeletions(db, storageConfig) {
    const report = {
      recovered: 0,
      purged: 0,
      quarantined: 0,
      errors: []
    };

    try {
      const records = db.prepare(`
        SELECT * FROM asset_deletion_journal 
        WHERE stage IN ('pending', 'db_deleted', 'quarantined')
      `).all();

      for (const rec of records) {
        try {
          const assetExists = db.prepare('SELECT 1 FROM assets WHERE id = ?').get(rec.asset_id);
          
          if (rec.stage === 'pending' && assetExists) {
            // DB was NOT deleted before crash: retain data, cancel deletion journal entry
            db.prepare('DELETE FROM asset_deletion_journal WHERE asset_id = ?').run(rec.asset_id);
            report.recovered++;
          } else {
            // DB was deleted: complete physical cleanup
            if (fs.existsSync(rec.target_dir)) {
              try {
                fs.rmSync(rec.target_dir, { recursive: true, force: true });
                db.prepare('DELETE FROM asset_deletion_journal WHERE asset_id = ?').run(rec.asset_id);
                report.purged++;
              } catch (e) {
                // If rmSync fails, ensure it is quarantined
                const quarantineTarget = path.join(storageConfig.quarantineDir, `startup_${Date.now()}_${rec.asset_id}`);
                try {
                  fs.renameSync(rec.target_dir, quarantineTarget);
                  db.prepare(`
                    UPDATE asset_deletion_journal 
                    SET stage = 'quarantined', target_dir = ?, updated_at = unixepoch()
                    WHERE asset_id = ?
                  `).run(quarantineTarget, rec.asset_id);
                  report.quarantined++;
                } catch (qErr) {
                  report.errors.push(`Failed to purge or quarantine ${rec.target_dir}: ${qErr.message}`);
                }
              }
            } else {
              db.prepare('DELETE FROM asset_deletion_journal WHERE asset_id = ?').run(rec.asset_id);
              report.purged++;
            }
          }
        } catch (recErr) {
          report.errors.push(`Error processing journal ${rec.asset_id}: ${recErr.message}`);
        }
      }
    } catch (tableErr) {
      // Table might not exist yet if schema was not run
      report.errors.push(tableErr.message);
    }

    return report;
  }
}
