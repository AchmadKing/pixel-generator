import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, withTransaction } from '../../studio/server/db/database.js';

test('SQLite Database Schema & Integrity Trigger Suite', async (t) => {
  let db;

  t.beforeEach(() => {
    db = initDatabase(':memory:');
  });

  await t.test('Test 1: Insert new asset with current_version_id = NULL succeeds', () => {
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES ('ast_01', 'proj_default', 'Iron Sword', 'items', NULL)
    `).run();

    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get('ast_01');
    assert.ok(row);
    assert.equal(row.id, 'ast_01');
    assert.equal(row.current_version_id, null);
  });

  await t.test('Test 2: Insert new asset with invalid current_version_id fails trigger validation', () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO assets (id, project_id, name, category, current_version_id)
        VALUES ('ast_02', 'proj_default', 'Bronze Shield', 'items', 'ver_fake')
      `).run();
    }, /Integrity error: current_version_id must reference an existing version/);
  });

  await t.test('Test 3: Insert version 1 for an asset succeeds', () => {
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES ('ast_03', 'proj_default', 'Healing Potion', 'items', NULL)
    `).run();

    db.prepare(`
      INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json)
      VALUES ('ver_01', 'ast_03', 1, 'red potion', 'mock', 'endesga-32', 32, 32, 'raw.png', 'proc.png', '{}')
    `).run();

    const ver = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get('ver_01');
    assert.ok(ver);
    assert.equal(ver.version_number, 1);
    assert.equal(ver.integrity_status, 'ok');
  });

  await t.test('Test 4: Update asset current_version_id to valid version succeeds', () => {
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id)
      VALUES ('ast_04', 'proj_default', 'Magic Staff', 'items', NULL)
    `).run();

    db.prepare(`
      INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json)
      VALUES ('ver_staff_1', 'ast_04', 1, 'wooden staff', 'mock', 'endesga-32', 32, 32, 'raw.png', 'proc.png', '{}')
    `).run();

    db.prepare(`
      UPDATE assets SET current_version_id = 'ver_staff_1' WHERE id = 'ast_04'
    `).run();

    const asset = db.prepare('SELECT current_version_id FROM assets WHERE id = ?').get('ast_04');
    assert.equal(asset.current_version_id, 'ver_staff_1');
  });

  await t.test('Test 5: Update current_version_id to version belonging to another asset fails trigger validation', () => {
    // Create asset A with version A
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_A', 'proj_default', 'A', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_A', 'ast_A', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();

    // Create asset B
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_B', 'proj_default', 'B', 'items', NULL)`).run();

    // Try setting asset B's current_version_id to ver_A (belonging to asset A)
    assert.throws(() => {
      db.prepare(`UPDATE assets SET current_version_id = 'ver_A' WHERE id = 'ast_B'`).run();
    }, /Integrity error: current_version_id must reference an existing version/);
  });

  await t.test('Test 6: Direct deletion of active version fails via prevent_delete_active_version trigger', () => {
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_06', 'proj_default', 'Bow', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_bow_1', 'ast_06', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_bow_1' WHERE id = 'ast_06'`).run();

    // Attempt direct delete of the active version
    assert.throws(() => {
      db.prepare(`DELETE FROM asset_versions WHERE id = 'ver_bow_1'`).run();
    }, /Integrity error: Cannot delete the currently active version/);

    // Verify version is still intact
    const ver = db.prepare('SELECT id FROM asset_versions WHERE id = ?').get('ver_bow_1');
    assert.ok(ver);
  });

  await t.test('Test 7: Unlink current_version_id then delete version succeeds', () => {
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_07', 'proj_default', 'Axe', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_axe_1', 'ast_07', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_axe_1' WHERE id = 'ast_07'`).run();

    // Unlink first
    db.prepare(`UPDATE assets SET current_version_id = NULL WHERE id = 'ast_07'`).run();

    // Now delete version
    const res = db.prepare(`DELETE FROM asset_versions WHERE id = 'ver_axe_1'`).run();
    assert.equal(res.changes, 1);

    const check = db.prepare('SELECT id FROM asset_versions WHERE id = ?').get('ver_axe_1');
    assert.equal(check, undefined);
  });

  await t.test('Test 8: Duplicate version_number on same asset is rejected by UNIQUE constraint', () => {
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_08', 'proj_default', 'Dagger', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_d1', 'ast_08', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();

    assert.throws(() => {
      // Duplicate version_number = 1
      db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_d2', 'ast_08', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    }, /UNIQUE constraint failed/);
  });

  await t.test('Test 9: withTransaction rolls back completely upon error', () => {
    assert.throws(() => {
      withTransaction(db, () => {
        db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_tx', 'proj_default', 'Tx Test', 'items', NULL)`).run();
        throw new Error('Forced transaction failure');
      });
    }, /Forced transaction failure/);

    const check = db.prepare('SELECT * FROM assets WHERE id = ?').get('ast_tx');
    assert.equal(check, undefined, 'Asset must not exist after rollback');
  });
});
