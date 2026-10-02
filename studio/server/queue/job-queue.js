import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { JobStore } from './job-store.js';
import { StorageManager } from '../storage/storage-manager.js';
import { withTransaction } from '../db/database.js';
import { MockProvider } from '../providers/mock-provider.js';
import { FalProvider } from '../providers/fal-provider.js';
import { config } from '../config.js';
import { processImage } from '../post-processing/post-processor.js';
import { cleanupEmptyDraftAssets } from '../db/safe-deletion.js';
import {
  canonicalizeJson,
  canonicalStringify,
  writeAllSync,
  evaluateLockStatus,
  verifyFilePayload,
  persistEmergencyRecoveryRecord
} from '../storage/recovery-manager.js';

export {
  canonicalizeJson,
  canonicalStringify,
  writeAllSync,
  evaluateLockStatus,
  verifyFilePayload,
  persistEmergencyRecoveryRecord
};

export class JobQueue {
  constructor(db, handlersOrOptions = {}, storageManager = null) {
    this.db = db;
    this.store = new JobStore(db);
    this.storageManager = storageManager || new StorageManager();
    this.queue = [];
    this.isProcessing = false;
    this.concurrency = 1; // Strict FIFO local execution
    this.providers = new Map();
    this.handlers = {};

    // Support legacy / custom test handlers
    if (typeof handlersOrOptions === 'object') {
      for (const [key, val] of Object.entries(handlersOrOptions)) {
        if (typeof val === 'function') {
          this.handlers[key] = val;
        } else if (val && typeof val.generate === 'function') {
          this.providers.set(key, val);
        }
      }
    }

    // Default registered providers if not explicitly overridden
    if (!this.handlers['mock'] && !this.providers.has('mock')) {
      this.registerProvider('mock', new MockProvider());
    }
    if (!this.handlers['fal-ai'] && !this.providers.has('fal-ai')) {
      this.registerProvider('fal-ai', new FalProvider(config.providers.fal, config.providers.falKey));
    }
  }

  registerProvider(id, providerInstance) {
    this.providers.set(id, providerInstance);
  }

  async enqueue({ assetId = null, providerId = 'mock', requestPayload = {} }) {
    const job = this.store.createJob({ assetId, providerId, requestPayload });
    this.queue.push(job.id);
    this.processNext();
    return job;
  }

  /**
   * Non-destructive reprocessing of an existing asset version with new post-processing parameters.
   * Runs 100% locally on CPU ($0.00 cloud cost).
   */
  async reprocess({ assetId, parentVersionId, processingConfig = {} }) {
    if (!assetId || !parentVersionId) {
      throw new Error('Both assetId and parentVersionId are required for reprocessing.');
    }

    const parentVer = this.db.prepare(`
      SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?
    `).get(parentVersionId, assetId);

    if (!parentVer) {
      throw new Error(`Parent version not found: ${parentVersionId} for asset ${assetId}`);
    }

    if (!fs.existsSync(parentVer.raw_file_path)) {
      throw new Error(`Raw image file not found on disk for version ${parentVersionId}: ${parentVer.raw_file_path}`);
    }

    return this.enqueue({
      assetId,
      providerId: 'reprocess',
      requestPayload: {
        parentVersionId,
        processingConfig,
        prompt: parentVer.prompt,
        negativePrompt: parentVer.negative_prompt,
        palette: processingConfig.palette || parentVer.palette_id,
        targetWidth: processingConfig.targetWidth || parentVer.target_width,
        targetHeight: processingConfig.targetHeight || parentVer.target_height
      }
    });
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const jobId = this.queue.shift();
    const job = this.store.getJob(jobId);

    if (!job) {
      this.isProcessing = false;
      return this.processNext();
    }

    let currentAssetId = job.asset_id;
    let currentVersionId = null;

    try {
      // 1. Check for custom function handler (e.g. from existing unit/integration tests)
      const customHandler = this.handlers[job.provider_id];
      if (customHandler) {
        this.store.updateStage(jobId, 'processing', 'running');
        await customHandler(job, this.store);
        return;
      }

      let result;
      let parentVersionId = null;

      if (job.provider_id === 'reprocess') {
        this.store.updateStage(jobId, 'processing', 'running');
        const payload = job.request_payload || {};
        parentVersionId = payload.parentVersionId;

        const parentVer = this.db.prepare(`
          SELECT * FROM asset_versions WHERE id = ?
        `).get(parentVersionId);

        if (!parentVer || !fs.existsSync(parentVer.raw_file_path)) {
          throw new Error(`Cannot reprocess: source raw file missing for parent version ${parentVersionId}`);
        }

        const rawBuffer = fs.readFileSync(parentVer.raw_file_path);
        result = {
          imageBuffer: rawBuffer,
          seed: parentVer.seed,
          width: payload.targetWidth || parentVer.target_width,
          height: payload.targetHeight || parentVer.target_height,
          metadata: { reprocessedFrom: parentVersionId }
        };
      } else {
        // 2. Resolve Provider Instance
        const provider = this.providers.get(job.provider_id);
        if (!provider) {
          throw new Error(`No provider registered for ID: ${job.provider_id}`);
        }

        // 3. Define lifecycle hooks
        const hooks = {
          onSubmitting: (j) => this.store.updateStage(j.id, 'submitting', 'running'),
          onSubmitted: async (j, reqId) => this.store.setProviderRequestId(j.id, reqId),
          onPolling: (j, details) => this.store.updateStage(j.id, 'polling', 'running'),
          onDownloading: (j) => this.store.updateStage(j.id, 'processing', 'running')
        };

        // 4. Generate asset through provider abstraction
        result = await provider.generate(job, hooks);
        if (!result || !result.imageBuffer) {
          throw new Error('Provider returned empty generation result.');
        }
      }

      // 5. Ensure an asset container exists in SQLite if assetId was not supplied
      if (!currentAssetId) {
        currentAssetId = `ast_${crypto.randomUUID().slice(0, 8)}`;
        const payload = job.request_payload || {};
        const assetName = payload.name || payload.prompt?.slice(0, 30) || 'Generated Asset';
        const category = payload.category || 'items';

        this.db.prepare(`
          INSERT INTO assets (id, project_id, name, category, current_version_id)
          VALUES (?, 'proj_default', ?, ?, NULL)
        `).run(currentAssetId, assetName, category);
      }

      // 6. Post-Processing Pipeline Execution
      const payload = job.request_payload || {};
      const procOptions = payload.processingConfig || payload;

      let processedBuffer;
      let finalConfigJson;

      if (payload.skipPostProcessing === true) {
        processedBuffer = result.imageBuffer;
        finalConfigJson = JSON.stringify(result.metadata || {});
      } else {
        const postResult = processImage(result.imageBuffer, procOptions);
        processedBuffer = postResult.processedBuffer;
        finalConfigJson = JSON.stringify({
          ...(result.metadata || {}),
          ...postResult.metadata
        });
      }

      // 7. Save raw and processed images to staging
      this.storageManager.saveToStaging(jobId, 'raw.png', result.imageBuffer);
      this.storageManager.saveToStaging(jobId, 'processed.png', processedBuffer);

      const stagedRaw = path.join(this.storageManager.config.stagingDir, `${jobId}_raw.png`);
      const stagedProcessed = path.join(this.storageManager.config.stagingDir, `${jobId}_processed.png`);

      if (!this.storageManager.isValidPng(stagedRaw) || !this.storageManager.isValidPng(stagedProcessed)) {
        throw new Error('Staged file failed PNG magic bytes validation.');
      }

      // 8. Relocate from staging to permanent asset version directory
      currentVersionId = `ver_${crypto.randomUUID().slice(0, 8)}`;
      const { rawFilePath, processedFilePath } = this.storageManager.relocateFromStaging(
        jobId, 
        currentAssetId, 
        currentVersionId
      );

      // 9. Atomic Database Transaction: monotonic version & update asset current_version_id
      withTransaction(this.db, (txDb) => {
        const nextVerRow = txDb.prepare(`
          SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver 
          FROM asset_versions 
          WHERE asset_id = ?
        `).get(currentAssetId);
        const versionNumber = nextVerRow ? nextVerRow.next_ver : 1;

        txDb.prepare(`
          INSERT INTO asset_versions (
            id, asset_id, version_number, parent_version_id, prompt, negative_prompt, provider_id, seed,
            palette_id, target_width, target_height, raw_file_path, processed_file_path,
            processing_config_json, integrity_status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)
        `).run(
          currentVersionId,
          currentAssetId,
          versionNumber,
          parentVersionId || null,
          payload.prompt || 'Generated Pixel Asset',
          payload.negative_prompt || null,
          job.provider_id,
          result.seed || payload.seed || null,
          payload.palette || 'endesga-32',
          result.width || payload.targetWidth || 32,
          result.height || payload.targetHeight || 32,
          rawFilePath,
          processedFilePath,
          finalConfigJson,
          `Generated via ${job.provider_id}`
        );

        txDb.prepare(`
          UPDATE assets 
          SET current_version_id = ?, updated_at = unixepoch() 
          WHERE id = ?
        `).run(currentVersionId, currentAssetId);
      });

      // 10. Mark Job Completed
      this.store.completeJob(jobId, currentVersionId, currentAssetId);

    } catch (error) {
      // Compensating storage cleanup if files were moved
      if (currentAssetId && currentVersionId) {
        this.storageManager.compensatingCleanup(jobId, currentAssetId, currentVersionId);
      } else {
        this.storageManager.compensatingCleanup(jobId, null, null);
      }

      // Surgically prune empty draft asset if this job created it and it has zero versions
      if (!job.asset_id && currentAssetId) {
        try {
          cleanupEmptyDraftAssets(this.db, currentAssetId);
        } catch (cleanupErr) {
          console.warn(`[WARN] Failed to cleanup empty draft asset ${currentAssetId}: ${cleanupErr.message}`);
        }
      }

      // Check if this error represents an ambiguous submit
      if (error.isAmbiguous) {
        try {
          this.db.prepare(`
            UPDATE jobs 
            SET status = 'interrupted', stage = 'interrupted', error_message = ?, updated_at = unixepoch()
            WHERE id = ?
          `).run(error.message, jobId);
        } catch (dbErr) {
          // If SQLite is locked / unwritable, persist emergency recovery record
          const recoveryDir = this.storageManager.config.recoveryDir || path.resolve(this.storageManager.config.baseDir, 'generated/.recovery');
          persistEmergencyRecoveryRecord(recoveryDir, jobId, {
            job_id: jobId,
            error: error.message,
            dbError: dbErr.message,
            assetId: currentAssetId,
            versionId: currentVersionId,
            timestamp: Date.now()
          });
        }
      } else {
        try {
          this.store.failJob(jobId, error.message);
        } catch (dbErr) {
          const recoveryDir = this.storageManager.config.recoveryDir || path.resolve(this.storageManager.config.baseDir, 'generated/.recovery');
          persistEmergencyRecoveryRecord(recoveryDir, jobId, {
            job_id: jobId,
            error: error.message,
            dbError: dbErr.message,
            assetId: currentAssetId,
            versionId: currentVersionId,
            timestamp: Date.now()
          });
        }
      }
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  getJob(jobId) {
    return this.store.getJob(jobId);
  }
}
