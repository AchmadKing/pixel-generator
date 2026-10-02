import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, withTransaction } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { reconcileStorageAndDatabase } from '../../studio/server/storage/reconciler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_STORAGE_DIR = path.join(__dirname, '../fixtures/test_storage');

test('Storage Compensation and Startup Crash Recovery Suite', async (t) => {
  let db;
  let storage;
  const storageConfig = {
    baseDir: TEST_STORAGE_DIR,
    projectsDir: path.join(TEST_STORAGE_DIR, 'projects'),
    generatedDir: path.join(TEST_STORAGE_DIR, 'generated'),
    exportsDir: path.join(TEST_STORAGE_DIR, 'exports'),
    referencesDir: path.join(TEST_STORAGE_DIR, 'references'),
    stagingDir: path.join(TEST_STORAGE_DIR, 'generated/.staging'),
    quarantineDir: path.join(TEST_STORAGE_DIR, 'generated/.quarantine')
  };

  t.beforeEach(() => {
    // Clean and re-init test storage dir
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    storage = new StorageManager(storageConfig);
    db = initDatabase(':memory:');
  });

  t.afterEach(() => {
    if (db) {
      try { db.close(); } catch (_) {}
    }
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      try {
        fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch (_) {}
    }
  });

  await t.test('Compensating Cleanup removes relocated files when database transaction fails', () => {
    const jobId = 'job_comp_01';
    const assetId = 'ast_comp_01';
    const versionId = 'ver_comp_01';

    // 1. Stage raw and processed buffers
    const dummyPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    storage.saveToStaging(jobId, 'raw.png', dummyPng);
    storage.saveToStaging(jobId, 'processed.png', dummyPng);

    // 2. Relocate to final destination
    const { rawFilePath, processedFilePath } = storage.relocateFromStaging(jobId, assetId, versionId);
    assert.ok(fs.existsSync(rawFilePath), 'Raw file must exist in target dir after relocation');
    assert.ok(fs.existsSync(processedFilePath), 'Processed file must exist in target dir after relocation');

    // 3. Injected failure in database commit -> trigger compensating cleanup
    try {
      withTransaction(db, () => {
        db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES (?, 'proj_default', 'Comp Test', 'items', NULL)`).run(assetId);
        throw new Error('Simulated database write error before commit');
      });
    } catch (e) {
      storage.compensatingCleanup(jobId, assetId, versionId);
    }

    // 4. Verify target directory and files are completely removed by compensation
    assert.equal(fs.existsSync(rawFilePath), false, 'Raw file must be removed by compensating cleanup');
    assert.equal(fs.existsSync(processedFilePath), false, 'Processed file must be removed by compensating cleanup');
    const targetDir = path.dirname(rawFilePath);
    assert.equal(fs.existsSync(targetDir), false, 'Target directory must be removed');
  });

  await t.test('Startup Reconciler quarantines orphan version folders instead of deleting them', () => {
    const orphanAssetId = 'ast_orphan_99';
    const orphanVerId = 'ver_orphan_99';
    const orphanDir = path.join(storageConfig.generatedDir, orphanAssetId, orphanVerId);
    fs.mkdirSync(orphanDir, { recursive: true });
    const dummyFile = path.join(orphanDir, 'raw.png');
    fs.writeFileSync(dummyFile, 'valuable orphan image');

    // Run startup reconciler
    const report = reconcileStorageAndDatabase(db, storageConfig);

    // Verify orphan was quarantined, NOT deleted
    assert.equal(report.orphansQuarantined.length, 1);
    assert.equal(report.orphansQuarantined[0].assetId, orphanAssetId);
    assert.equal(report.orphansQuarantined[0].versionId, orphanVerId);

    // File should not exist in original folder
    assert.equal(fs.existsSync(dummyFile), false);

    // File should exist in .quarantine/
    const quarantinedDir = report.orphansQuarantined[0].quarantinedTo;
    assert.ok(fs.existsSync(quarantinedDir), 'Quarantined folder must exist');
    assert.ok(fs.existsSync(path.join(quarantinedDir, 'raw.png')), 'Quarantined file must be preserved');
  });

  await t.test('Startup Reconciler flags DB records with missing files without deleting DB records', () => {
    const assetId = 'ast_missing_files';
    const verId = 'ver_missing_files';

    // Insert valid asset and version into DB pointing to non-existent disk paths
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES (?, 'proj_default', 'Missing Files', 'items', NULL)`).run(assetId);
    db.prepare(`
      INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json)
      VALUES (?, ?, 1, 'p', 'm', 'pal', 32, 32, '/non/existent/raw.png', '/non/existent/proc.png', '{}')
    `).run(verId, assetId);
    db.prepare(`UPDATE assets SET current_version_id = ? WHERE id = ?`).run(verId, assetId);

    // Run startup reconciler
    const report = reconcileStorageAndDatabase(db, storageConfig);

    assert.equal(report.missingBackingFiles.length, 1);
    assert.equal(report.missingBackingFiles[0].id, verId);

    // Verify DB record still exists and is flagged as missing_backing_file
    const verRow = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(verId);
    assert.ok(verRow, 'Version row in DB must NOT be deleted');
    assert.equal(verRow.integrity_status, 'missing_backing_file');
    assert.ok(verRow.integrity_error.includes('Backing file missing'));
  });

  await t.test('Startup Reconciler preserves active staging and only prunes stale files', () => {
    storage.ensureDirectories();
    const staleFile = path.join(storageConfig.stagingDir, 'stale_job.png');
    const activeFile = path.join(storageConfig.stagingDir, 'active_job.png');

    fs.writeFileSync(staleFile, 'stale');
    fs.writeFileSync(activeFile, 'active');

    // Manipulate staleFile mtime to 20 minutes ago
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(staleFile, twentyMinsAgo, twentyMinsAgo);

    // Reconcile
    const report = reconcileStorageAndDatabase(db, storageConfig);

    assert.equal(report.staleStagingPruned, 1);
    assert.equal(fs.existsSync(staleFile), false, 'Stale staging file must be pruned');
    assert.equal(fs.existsSync(activeFile), true, 'Active staging file must be preserved');
    assert.ok(fs.existsSync(storageConfig.stagingDir), 'Staging directory itself must never be deleted');
  });

  await t.test('Crash Simulation: process killed after files relocated to target but BEFORE database commit', () => {
    const crashJobId = 'job_hard_crash';
    const crashAssetId = 'ast_hard_crash';
    const crashVerId = 'ver_hard_crash';

    // 1. Files are staged
    const dummyPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xEE]);
    storage.saveToStaging(crashJobId, 'raw.png', dummyPng);
    storage.saveToStaging(crashJobId, 'processed.png', dummyPng);

    // 2. Files are relocated to target directory
    const { rawFilePath, processedFilePath } = storage.relocateFromStaging(crashJobId, crashAssetId, crashVerId);
    assert.ok(fs.existsSync(rawFilePath), 'Raw file in target dir');
    assert.ok(fs.existsSync(processedFilePath), 'Processed file in target dir');

    // 3. HARD CRASH SIMULATED:
    // Process dies right here. DB transaction is NEVER executed or committed.
    // Notice compensatingCleanup is NOT called because process crashed abruptly.
    // Database has NO record of crashAssetId or crashVerId.
    const checkDb = db.prepare('SELECT id FROM asset_versions WHERE id = ?').get(crashVerId);
    assert.equal(checkDb, undefined, 'Database must have zero records of uncommitted version');

    // 4. Server restarts and reconciler runs
    const report = reconcileStorageAndDatabase(db, storageConfig);

    // 5. Verify orphan files were quarantined, NOT deleted
    assert.equal(report.orphansQuarantined.length, 1);
    assert.equal(report.orphansQuarantined[0].assetId, crashAssetId);
    assert.equal(report.orphansQuarantined[0].versionId, crashVerId);

    // The original uncommitted target directory should no longer exist in generated/
    assert.equal(fs.existsSync(rawFilePath), false);
    assert.equal(fs.existsSync(processedFilePath), false);

    // The files must be safely preserved in .quarantine/
    const quarantinedFolder = report.orphansQuarantined[0].quarantinedTo;
    assert.ok(fs.existsSync(quarantinedFolder), 'Quarantine folder must exist');
    assert.ok(fs.existsSync(path.join(quarantinedFolder, 'raw.png')), 'Quarantined raw file must be preserved');
    assert.ok(fs.existsSync(path.join(quarantinedFolder, 'processed.png')), 'Quarantined processed file must be preserved');
  });
});

