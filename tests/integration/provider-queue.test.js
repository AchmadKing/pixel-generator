import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { JobQueue } from '../../studio/server/queue/job-queue.js';
import { JobStore } from '../../studio/server/queue/job-store.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_STORAGE_DIR = path.resolve(__dirname, '../fixtures/test_provider_storage');

function getTestStorageConfig() {
  return {
    baseDir: TEST_STORAGE_DIR,
    projectsDir: path.join(TEST_STORAGE_DIR, 'projects'),
    generatedDir: path.join(TEST_STORAGE_DIR, 'generated'),
    exportsDir: path.join(TEST_STORAGE_DIR, 'exports'),
    referencesDir: path.join(TEST_STORAGE_DIR, 'references'),
    stagingDir: path.join(TEST_STORAGE_DIR, 'generated/.staging'),
    quarantineDir: path.join(TEST_STORAGE_DIR, 'generated/.quarantine')
  };
}

function safeCleanupDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {}
  }
}

test('Provider Queue & Storage Integration Suite', async (t) => {
  let db;
  let storageManager;

  t.beforeEach(() => {
    safeCleanupDir(TEST_STORAGE_DIR);
    storageManager = new StorageManager(getTestStorageConfig());
    db = initDatabase(':memory:');
  });

  t.afterEach(() => {
    safeCleanupDir(TEST_STORAGE_DIR);
  });

  await t.test('End-to-End: Enqueue Mock Provider job -> Staging -> Relocate -> DB commit -> Completed', async () => {
    const queue = new JobQueue(db, {}, storageManager);

    // Enqueue generation job
    const job = await queue.enqueue({
      providerId: 'mock',
      requestPayload: {
        category: 'items',
        prompt: 'legendary ruby blade',
        seed: 42,
        targetWidth: 32,
        targetHeight: 32
      }
    });

    assert.equal(job.status, 'queued');

    // Wait for in-process queue worker to complete
    let attempts = 0;
    let completedJob = queue.getJob(job.id);
    while (completedJob.status !== 'completed' && attempts < 20) {
      await new Promise(r => setTimeout(r, 25));
      completedJob = queue.getJob(job.id);
      attempts++;
    }

    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.stage, 'completed');
    assert.ok(completedJob.created_version_id, 'Must link created version ID');
    assert.ok(completedJob.asset_id, 'Must link asset ID');

    // Verify Asset in SQLite
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(completedJob.asset_id);
    assert.ok(asset, 'Asset must exist in DB');
    assert.equal(asset.current_version_id, completedJob.created_version_id, 'Asset current_version_id must match created version');
    assert.equal(asset.category, 'items');

    // Verify Asset Version in SQLite
    const version = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(completedJob.created_version_id);
    assert.ok(version, 'Version must exist in DB');
    assert.equal(version.version_number, 1);
    assert.equal(version.seed, 42);
    assert.equal(version.integrity_status, 'ok');

    // Verify Physical Files on Disk
    assert.ok(fs.existsSync(version.raw_file_path), 'Raw file must exist on disk');
    assert.ok(fs.existsSync(version.processed_file_path), 'Processed file must exist on disk');

    // Verify Valid PNG bytes
    assert.equal(storageManager.isValidPng(version.raw_file_path), true);
    assert.equal(storageManager.isValidPng(version.processed_file_path), true);

    // Verify Staging was cleaned after relocation
    const stagedRaw = path.join(storageManager.config.stagingDir, `${job.id}_raw.png`);
    assert.equal(fs.existsSync(stagedRaw), false, 'Staging file must be moved, not left behind');
  });

  await t.test('Crash before ID saved: Submitting job without request ID is marked ambiguous_submit and NEVER auto-resubmitted', async () => {
    const jobStore = new JobStore(db);
    jobStore.createJob({
      id: 'job_crash_mid_submit',
      providerId: 'fal-ai',
      requestPayload: { prompt: 'phoenix feather' }
    });
    jobStore.updateStage('job_crash_mid_submit', 'submitting', 'running');

    // Restart recovery occurs
    const recovered = jobStore.recoverInterruptedJobs();
    assert.equal(recovered, 1);

    const recoveredJob = jobStore.getJob('job_crash_mid_submit');
    assert.equal(recoveredJob.status, 'interrupted');
    assert.equal(recoveredJob.stage, 'interrupted');
    assert.ok(recoveredJob.error_message.includes('Ambiguous submit state'));

    // Verify queue worker ignores interrupted jobs and never re-submits
    let reSubmitCalled = false;
    const testQueue = new JobQueue(db, {
      'fal-ai': {
        generate: async () => { reSubmitCalled = true; }
      }
    }, storageManager);

    await testQueue.processNext();
    assert.equal(reSubmitCalled, false, 'Queue runner must NEVER auto-resubmit interrupted ambiguous jobs');
  });

  await t.test('Crash after ID saved: Polling job with provider request ID is marked interrupted with ID preserved for manual check', async () => {
    const jobStore = new JobStore(db);
    jobStore.createJob({
      id: 'job_crash_mid_poll',
      providerId: 'fal-ai',
      requestPayload: { prompt: 'ice crystal shield' }
    });
    jobStore.updateStage('job_crash_mid_poll', 'submitting', 'running');
    jobStore.setProviderRequestId('job_crash_mid_poll', 'fal_req_saved_999');

    // Restart occurs
    jobStore.recoverInterruptedJobs();

    const recoveredJob = jobStore.getJob('job_crash_mid_poll');
    assert.equal(recoveredJob.status, 'interrupted');
    assert.equal(recoveredJob.stage, 'interrupted');
    assert.equal(recoveredJob.provider_request_id, 'fal_req_saved_999', 'Provider request ID must be preserved');
    assert.ok(recoveredJob.error_message.includes('has provider request ID'));

    // Verify queue does not create a replacement request
    let newRequestCreated = false;
    const testQueue = new JobQueue(db, {
      'fal-ai': {
        generate: async () => { newRequestCreated = true; }
      }
    }, storageManager);

    await testQueue.processNext();
    assert.equal(newRequestCreated, false, 'Queue runner must NOT create a replacement request');
  });

  await t.test('Storage Compensation: Database failure after file relocation triggers compensating cleanup', async () => {
    // We create a provider that outputs a valid PNG, but we create an asset where updating
    // will trigger an error (e.g. invalid category constraint or table locked)
    const mockProvider = {
      name: 'Failing Provider',
      generate: async () => ({
        imageBuffer: encodePng(1, 1, Buffer.from([255, 0, 0, 255])),
        mimeType: 'image/png',
        width: 1,
        height: 1,
        seed: 1
      })
    };

    // Pre-insert an asset with invalid project to simulate foreign key failure
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES ('ast_fail_test', 'proj_default', 'Fail Test', 'items', NULL)
    `).run();

    // Temporarily tamper with DB statement or inject constraint failure:
    // Insert a dummy version with version_number = 1
    db.prepare(`
      INSERT INTO asset_versions (
        id, asset_id, version_number, prompt, provider_id, palette_id,
        target_width, target_height, raw_file_path, processed_file_path
      ) VALUES ('ver_existing', 'ast_fail_test', 1, 'p', 'm', 'pal', 1, 1, 'r', 'p')
    `).run();

    // Now if someone tries to insert another version with version_number = 1, UNIQUE(asset_id, version_number) aborts.
    // In our queue, next_ver is SELECT COALESCE(MAX(version_number), 0) + 1.
    // So to force a failure, we can drop the asset_versions table or trigger abort.
    db.exec(`
      CREATE TRIGGER force_tx_abort
      BEFORE INSERT ON asset_versions
      FOR EACH ROW
      WHEN NEW.asset_id = 'ast_fail_test'
      BEGIN
        SELECT RAISE(ABORT, 'Simulated DB commit error for compensating cleanup test');
      END;
    `);

    const queue = new JobQueue(db, { 'mock': mockProvider }, storageManager);

    const job = await queue.enqueue({
      assetId: 'ast_fail_test',
      providerId: 'mock',
      requestPayload: { prompt: 'fail test item' }
    });

    // Wait for queue processing to catch failure
    let attempts = 0;
    let failedJob = queue.getJob(job.id);
    while (failedJob.status !== 'failed' && attempts < 20) {
      await new Promise(r => setTimeout(r, 25));
      failedJob = queue.getJob(job.id);
      attempts++;
    }

    assert.equal(failedJob.status, 'failed');
    assert.ok(failedJob.error_message.includes('Simulated DB commit error'));

    // Verify Asset's current_version_id remained NULL (no broken active version pointer)
    const asset = db.prepare('SELECT current_version_id FROM assets WHERE id = ?').get('ast_fail_test');
    assert.equal(asset.current_version_id, null, 'Active version pointer must remain NULL on commit failure');

    // Verify Compensating Cleanup deleted any relocated target folders
    const targetAssetDir = path.join(storageManager.config.generatedDir, 'ast_fail_test');
    if (fs.existsSync(targetAssetDir)) {
      const files = fs.readdirSync(targetAssetDir);
      // If folder exists, it should not have any new version folders left behind
      assert.equal(files.filter(f => f.startsWith('ver_')).length, 0, 'No orphaned version directory must remain');
    }
  });

  await t.test('Pipeline Failure: Corrupted PNG buffer from provider aborts job before database commit and cleans staging', async () => {
    // Provider outputs a corrupted PNG (magic bytes only, missing chunks)
    const corruptedProvider = {
      name: 'Corrupted Provider',
      generate: async () => ({
        imageBuffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]),
        mimeType: 'image/png',
        width: 1,
        height: 1,
        seed: 2
      })
    };

    const queue = new JobQueue(db, { 'mock': corruptedProvider }, storageManager);
    const job = await queue.enqueue({
      providerId: 'mock',
      requestPayload: { prompt: 'corrupt image test' }
    });

    let attempts = 0;
    let failedJob = queue.getJob(job.id);
    while (failedJob.status !== 'failed' && attempts < 20) {
      await new Promise(r => setTimeout(r, 25));
      failedJob = queue.getJob(job.id);
      attempts++;
    }

    assert.equal(failedJob.status, 'failed');
    assert.ok(failedJob.error_message.length > 0);

    // Verify staging files were surgically cleaned up
    const stagedRaw = path.join(storageManager.config.stagingDir, `${job.id}_raw.png`);
    const stagedProcessed = path.join(storageManager.config.stagingDir, `${job.id}_processed.png`);
    assert.equal(fs.existsSync(stagedRaw), false, 'Raw staging file must not remain on failure');
    assert.equal(fs.existsSync(stagedProcessed), false, 'Processed staging file must not remain on failure');

    // Verify no version was committed
    const versions = db.prepare('SELECT * FROM asset_versions').all();
    assert.equal(versions.length, 0, 'Zero asset versions must be created on pipeline failure');
  });

  await t.test('Pipeline Skip Mode: Explicit skipPostProcessing: true bypasses processImage safely', async () => {
    const validProvider = {
      name: 'Valid Provider',
      generate: async () => ({
        imageBuffer: encodePng(2, 2, Buffer.from([
          255, 0, 0, 255,   0, 255, 0, 255,
          0, 0, 255, 255,   255, 255, 0, 255
        ])),
        mimeType: 'image/png',
        width: 2,
        height: 2,
        seed: 3,
        metadata: { rawInfo: 'untouched' }
      })
    };

    const queue = new JobQueue(db, { 'mock': validProvider }, storageManager);
    const job = await queue.enqueue({
      providerId: 'mock',
      requestPayload: {
        prompt: 'skip post-processing test',
        skipPostProcessing: true
      }
    });

    let attempts = 0;
    let completedJob = queue.getJob(job.id);
    while (completedJob.status !== 'completed' && attempts < 20) {
      await new Promise(r => setTimeout(r, 25));
      completedJob = queue.getJob(job.id);
      attempts++;
    }

    assert.equal(completedJob.status, 'completed');
    assert.ok(completedJob.created_version_id);

    const version = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(completedJob.created_version_id);
    assert.ok(version);
    assert.equal(version.integrity_status, 'ok');

    // Both files exist and raw buffer equals processed buffer
    const rawBuf = fs.readFileSync(version.raw_file_path);
    const procBuf = fs.readFileSync(version.processed_file_path);
    assert.ok(rawBuf.equals(procBuf), 'Processed file must match raw file when post-processing is explicitly skipped');
  });
});
