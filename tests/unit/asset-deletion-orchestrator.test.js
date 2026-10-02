import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { AssetCoordinator } from '../../studio/server/queue/asset-coordinator.js';
import { AssetDeletionOrchestrator } from '../../studio/server/storage/asset-deletion-orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/deletion_orchestrator');

function setupTestEnvironment() {
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const storageConfig = {
    baseDir: FIXTURES_DIR,
    projectsDir: path.join(FIXTURES_DIR, 'projects'),
    generatedDir: path.join(FIXTURES_DIR, 'generated'),
    exportsDir: path.join(FIXTURES_DIR, 'exports'),
    referencesDir: path.join(FIXTURES_DIR, 'references'),
    stagingDir: path.join(FIXTURES_DIR, 'generated/.staging'),
    quarantineDir: path.join(FIXTURES_DIR, 'generated/.quarantine'),
    recoveryDir: path.join(FIXTURES_DIR, 'generated/.recovery'),
    dbPath: ':memory:'
  };

  const db = initDatabase(storageConfig.dbPath);
  const storageManager = new StorageManager(storageConfig);
  const coordinator = new AssetCoordinator(db);
  const orchestrator = new AssetDeletionOrchestrator(db, storageManager, coordinator);

  return { db, storageManager, coordinator, orchestrator, storageConfig };
}

test('Asset Deletion Orchestrator & Recovery Suite', async (t) => {
  t.afterEach(() => {
    if (fs.existsSync(FIXTURES_DIR)) {
      try {
        fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('Test 1: In-flight job guard rejects deletion with 409 Conflict', async () => {
    const { db, orchestrator } = setupTestEnvironment();

    // Create asset
    const assetId = 'ast_busy_1';
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES (?, 'proj_default', 'Busy Asset', 'items', NULL)
    `).run(assetId);

    // Create active job
    db.prepare(`
      INSERT INTO jobs (id, asset_id, provider_id, status, stage, request_payload)
      VALUES ('job_active_1', ?, 'mock', 'running', 'processing', '{}')
    `).run(assetId);

    await assert.rejects(
      async () => orchestrator.deleteAssetWithStorage(assetId),
      (err) => {
        assert.equal(err.code, 'ERR_ASSET_BUSY');
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    // Verify asset still exists in database
    const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    assert.ok(asset);
  });

  await t.test('Test 2: Non-existent asset throws 404 Not Found', async () => {
    const { orchestrator } = setupTestEnvironment();

    await assert.rejects(
      async () => orchestrator.deleteAssetWithStorage('ast_missing_999'),
      (err) => {
        assert.equal(err.code, 'ERR_ASSET_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  await t.test('Test 3: Clean deletion removes SQLite record and physical directory', async () => {
    const { db, orchestrator, storageConfig } = setupTestEnvironment();

    const assetId = 'ast_clean_1';
    const versionId = 'ver_clean_1';

    // 1. Create physical asset folder and files
    const assetDir = path.join(storageConfig.generatedDir, assetId);
    const verDir = path.join(assetDir, versionId);
    fs.mkdirSync(verDir, { recursive: true });
    const rawFile = path.join(verDir, 'raw.png');
    const procFile = path.join(verDir, 'processed.png');
    fs.writeFileSync(rawFile, Buffer.from([1, 2, 3]));
    fs.writeFileSync(procFile, Buffer.from([4, 5, 6]));

    // 2. Insert DB records
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES (?, 'proj_default', 'Clean Asset', 'items', NULL)
    `).run(assetId);

    db.prepare(`
      INSERT INTO asset_versions (
        id, asset_id, version_number, prompt, provider_id, palette_id,
        target_width, target_height, raw_file_path, processed_file_path
      ) VALUES (?, ?, 1, 'prompt', 'mock', 'endesga-32', 32, 32, ?, ?)
    `).run(versionId, assetId, rawFile, procFile);

    db.prepare('UPDATE assets SET current_version_id = ? WHERE id = ?').run(versionId, assetId);

    // 3. Execute deletion
    const result = await orchestrator.deleteAssetWithStorage(assetId);

    assert.equal(result.success, true);
    assert.equal(result.dbDeleted, true);
    assert.equal(result.fsCleaned, true);

    // 4. Verify DB records cascade deleted
    const dbAsset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    assert.equal(dbAsset, undefined);
    const dbVer = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ?').get(assetId);
    assert.equal(dbVer, undefined);

    // 5. Verify physical directory deleted
    assert.equal(fs.existsSync(assetDir), false);

    // 6. Verify journal record purged
    const journal = db.prepare('SELECT * FROM asset_deletion_journal WHERE asset_id = ?').get(assetId);
    assert.equal(journal, undefined);
  });

  await t.test('Test 4: Filesystem lock falls back to quarantine with transparent warning', async () => {
    const { db, orchestrator, storageConfig } = setupTestEnvironment();

    const assetId = 'ast_lock_1';
    const assetDir = path.join(storageConfig.generatedDir, assetId);
    fs.mkdirSync(assetDir, { recursive: true });

    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES (?, 'proj_default', 'Locked Asset', 'items', NULL)
    `).run(assetId);

    // Monkey-patch fs.rmSync to simulate Windows file lock error (EBUSY)
    const originalRmSync = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (target === assetDir) {
        const err = new Error('EBUSY: resource busy or locked');
        err.code = 'EBUSY';
        throw err;
      }
      return originalRmSync(target, options);
    };

    try {
      const result = await orchestrator.deleteAssetWithStorage(assetId);

      assert.equal(result.success, true);
      assert.equal(result.dbDeleted, true);
      assert.equal(result.fsCleaned, false);
      assert.equal(result.quarantined, true);
      assert.ok(result.warning.includes('EBUSY'));

      // Check journal record
      const journal = db.prepare('SELECT * FROM asset_deletion_journal WHERE asset_id = ?').get(assetId);
      assert.equal(journal.stage, 'quarantined');
      assert.ok(fs.existsSync(journal.target_dir));
    } finally {
      fs.rmSync = originalRmSync;
    }
  });

  await t.test('Test 5: Startup recovery purges leftover journal deletions', async () => {
    const { db, storageConfig } = setupTestEnvironment();

    // Create a quarantined directory that was interrupted before cleanup
    const leftoverDir = path.join(storageConfig.quarantineDir, 'deleted_test_123');
    fs.mkdirSync(leftoverDir, { recursive: true });
    fs.writeFileSync(path.join(leftoverDir, 'test.txt'), 'abandoned file');

    db.prepare(`
      INSERT INTO asset_deletion_journal (asset_id, stage, target_dir, created_at, updated_at)
      VALUES ('ast_abandoned_1', 'quarantined', ?, unixepoch(), unixepoch())
    `).run(leftoverDir);

    const report = AssetDeletionOrchestrator.recoverIncompleteDeletions(db, storageConfig);

    assert.equal(report.purged, 1);
    assert.equal(fs.existsSync(leftoverDir), false);

    const remainingJournal = db.prepare('SELECT * FROM asset_deletion_journal WHERE asset_id = ?').get('ast_abandoned_1');
    assert.equal(remainingJournal, undefined);
  });
});
