import { withTransaction } from './database.js';

/**
 * Safely deletes an asset and cascades to all versions and frames.
 * Step 1: Unlinks current_version_id to avoid trigger prevent_delete_active_version aborting cascade.
 * Step 2: Deletes the asset, letting ON DELETE CASCADE cleanly purge versions and frames.
 */
export function deleteAssetSafely(db, assetId) {
  return withTransaction(db, () => {
    // Check asset exists
    const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    if (!asset) return false;

    // 1. Unlink active version pointer
    db.prepare('UPDATE assets SET current_version_id = NULL WHERE id = ?').run(assetId);

    // 2. Delete asset (cascade purges asset_versions and asset_frames)
    const result = db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    return result.changes > 0;
  });
}

/**
 * Safely deletes an entire project and cascades to all its assets, versions, and frames.
 * Step 1: Unlinks all current_version_id pointers for all assets in this project.
 * Step 2: Deletes the project, letting ON DELETE CASCADE cleanly purge all assets and versions.
 */
export function deleteProjectSafely(db, projectId) {
  return withTransaction(db, () => {
    // Check project exists
    const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!proj) return false;

    // 1. Unlink active version pointers across all assets in this project
    db.prepare('UPDATE assets SET current_version_id = NULL WHERE project_id = ?').run(projectId);

    // 2. Delete project (cascade purges all assets and child versions)
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    return result.changes > 0;
  });
}

/**
 * Surgically cleans up uninitialized draft assets that have current_version_id = NULL
 * and have ZERO versions associated with them.
 * Guarantees that valid assets with existing versions are NEVER touched.
 */
export function cleanupEmptyDraftAssets(db, assetId = null) {
  return withTransaction(db, () => {
    if (assetId) {
      const stmt = db.prepare(`
        DELETE FROM assets 
        WHERE id = ? 
          AND current_version_id IS NULL 
          AND NOT EXISTS (SELECT 1 FROM asset_versions WHERE asset_id = assets.id)
      `);
      return stmt.run(assetId).changes;
    } else {
      const stmt = db.prepare(`
        DELETE FROM assets 
        WHERE current_version_id IS NULL 
          AND NOT EXISTS (SELECT 1 FROM asset_versions WHERE asset_id = assets.id)
      `);
      return stmt.run().changes;
    }
  });
}
