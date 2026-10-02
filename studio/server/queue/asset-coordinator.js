/**
 * AssetCoordinator manages in-memory concurrency locks between asynchronous
 * generation jobs and asset deletion operations.
 *
 * Guarantees:
 * 1. An asset undergoing deletion cannot be targeted by newly enqueued or currently executing jobs.
 * 2. An asset with active or queued jobs cannot be deleted (produces ERR_ASSET_BUSY).
 */
export class AssetCoordinator {
  constructor(db) {
    this.db = db;
    // Map<assetId, Set<jobId>>
    this.activeJobLocks = new Map();
    // Set<assetId>
    this.deletingAssets = new Set();
  }

  /**
   * Checks if an asset is currently locked for deletion.
   */
  isDeleting(assetId) {
    if (!assetId) return false;
    return this.deletingAssets.has(assetId);
  }

  /**
   * Registers a job as actively processing an asset.
   * Throws Error if the asset is currently being deleted.
   */
  acquireJobLock(assetId, jobId) {
    if (!assetId) return;
    if (this.deletingAssets.has(assetId)) {
      throw new Error(`Cannot process job: Asset ${assetId} is currently being deleted.`);
    }
    if (!this.activeJobLocks.has(assetId)) {
      this.activeJobLocks.set(assetId, new Set());
    }
    this.activeJobLocks.get(assetId).add(jobId);
  }

  /**
   * Releases an active job lock for an asset.
   */
  releaseJobLock(assetId, jobId) {
    if (!assetId) return;
    const locks = this.activeJobLocks.get(assetId);
    if (locks) {
      locks.delete(jobId);
      if (locks.size === 0) {
        this.activeJobLocks.delete(assetId);
      }
    }
  }

  /**
   * Checks if an asset has active jobs in-flight (in-memory or in SQLite).
   */
  hasActiveJobs(assetId) {
    if (!assetId) return false;

    // 1. In-memory check
    const inMem = this.activeJobLocks.get(assetId);
    if (inMem && inMem.size > 0) return true;

    // 2. Database check
    if (this.db) {
      const row = this.db.prepare(`
        SELECT COUNT(*) AS count 
        FROM jobs 
        WHERE asset_id = ? AND status IN ('queued', 'running')
      `).get(assetId);
      if (row && row.count > 0) return true;
    }

    return false;
  }

  /**
   * Attempts to acquire an exclusive deletion lock for an asset.
   * Fails if any active job is queued or running for this asset.
   * @returns {boolean} true if lock acquired, false if busy
   */
  acquireDeletionLock(assetId) {
    if (!assetId) return false;
    if (this.deletingAssets.has(assetId)) return false; // Already locked for deletion

    if (this.hasActiveJobs(assetId)) {
      return false; // Busy with active or queued jobs
    }

    this.deletingAssets.add(assetId);
    return true;
  }

  /**
   * Releases an exclusive deletion lock for an asset.
   */
  releaseDeletionLock(assetId) {
    if (!assetId) return;
    this.deletingAssets.delete(assetId);
  }
}
