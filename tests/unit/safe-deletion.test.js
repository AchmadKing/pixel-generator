import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, withTransaction } from '../../studio/server/db/database.js';
import { deleteAssetSafely, deleteProjectSafely } from '../../studio/server/db/safe-deletion.js';

test('Safe Deletion and Cascade Suite', async (t) => {
  let db;

  t.beforeEach(() => {
    db = initDatabase(':memory:');
  });

  await t.test('Safe Asset Deletion: unlinks active version and cascades to versions and frames', () => {
    // Setup project, asset, 2 versions, and 1 frame
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_del_1', 'proj_default', 'Sword', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_1', 'ast_del_1', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_2', 'ast_del_1', 2, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`INSERT INTO asset_frames (id, version_id, frame_index, width, height, file_path) VALUES ('fr_1', 'ver_1', 0, 32, 32, 'frame0.png')`).run();
    
    // Set ver_2 as active
    db.prepare(`UPDATE assets SET current_version_id = 'ver_2' WHERE id = 'ast_del_1'`).run();

    // Direct delete would fail due to trigger. Use deleteAssetSafely:
    const success = deleteAssetSafely(db, 'ast_del_1');
    assert.equal(success, true);

    // Verify asset, versions, and frames are all gone
    const checkAsset = db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_del_1');
    assert.equal(checkAsset, undefined);

    const checkVersions = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ?').all('ast_del_1');
    assert.equal(checkVersions.length, 0);

    const checkFrames = db.prepare('SELECT id FROM asset_frames WHERE version_id IN (?, ?)').all('ver_1', 'ver_2');
    assert.equal(checkFrames.length, 0);
  });

  await t.test('Safe Project Deletion: cascades to all assets, versions, and frames', () => {
    // Create new project
    db.prepare(`INSERT INTO projects (id, name, description) VALUES ('proj_custom', 'Custom Project', 'desc')`).run();
    
    // Create 2 assets under proj_custom
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_c1', 'proj_custom', 'Item 1', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_c1', 'ast_c1', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_c1' WHERE id = 'ast_c1'`).run();

    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_c2', 'proj_custom', 'Item 2', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_c2', 'ast_c2', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_c2' WHERE id = 'ast_c2'`).run();

    // Safe delete of project
    const success = deleteProjectSafely(db, 'proj_custom');
    assert.equal(success, true);

    // Verify project, assets, and versions are all cleanly removed
    assert.equal(db.prepare('SELECT id FROM projects WHERE id = ?').get('proj_custom'), undefined);
    assert.equal(db.prepare('SELECT id FROM assets WHERE project_id = ?').all('proj_custom').length, 0);
    assert.equal(db.prepare('SELECT id FROM asset_versions WHERE id IN (?, ?)').all('ver_c1', 'ver_c2').length, 0);
  });

  await t.test('deleteAssetSafely rolls back completely if a failure occurs mid-deletion', () => {
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_rb_asset', 'proj_default', 'Rollback Asset', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_rb1', 'ast_rb_asset', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_rb1' WHERE id = 'ast_rb_asset'`).run();

    // Install temporary failure trigger to simulate failure during the DELETE step
    db.exec(`
      CREATE TRIGGER test_fail_asset_delete
      BEFORE DELETE ON assets
      FOR EACH ROW
      WHEN OLD.id = 'ast_rb_asset'
      BEGIN
        SELECT RAISE(ABORT, 'Simulated mid-cascade failure on asset delete');
      END;
    `);

    assert.throws(() => {
      deleteAssetSafely(db, 'ast_rb_asset');
    }, /Simulated mid-cascade failure on asset delete/);

    // Verify asset and version are completely intact and current_version_id was rolled back
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get('ast_rb_asset');
    assert.ok(asset, 'Asset must still exist');
    assert.equal(asset.current_version_id, 'ver_rb1', 'current_version_id must remain restored');

    const version = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get('ver_rb1');
    assert.ok(version, 'Version must not be deleted');

    // Clean up temporary test trigger
    db.exec('DROP TRIGGER test_fail_asset_delete;');
  });

  await t.test('deleteProjectSafely rolls back completely if a failure occurs mid-cascade', () => {
    db.prepare(`INSERT INTO projects (id, name) VALUES ('proj_rb', 'Rollback Proj')`).run();
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_rb_p1', 'proj_rb', 'Item', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_rb_p1', 'ast_rb_p1', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_rb_p1' WHERE id = 'ast_rb_p1'`).run();

    // Install temporary failure trigger on projects DELETE
    db.exec(`
      CREATE TRIGGER test_fail_proj_delete
      BEFORE DELETE ON projects
      FOR EACH ROW
      WHEN OLD.id = 'proj_rb'
      BEGIN
        SELECT RAISE(ABORT, 'Simulated mid-cascade failure on project delete');
      END;
    `);

    assert.throws(() => {
      deleteProjectSafely(db, 'proj_rb');
    }, /Simulated mid-cascade failure on project delete/);

    // Verify project, asset, and version are all still intact
    assert.ok(db.prepare('SELECT id FROM projects WHERE id = ?').get('proj_rb'), 'Project must exist');
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get('ast_rb_p1');
    assert.ok(asset, 'Asset must exist');
    assert.equal(asset.current_version_id, 'ver_rb_p1', 'current_version_id must be restored');
    assert.ok(db.prepare('SELECT id FROM asset_versions WHERE id = ?').get('ver_rb_p1'), 'Version must exist');

    // Clean up temporary test trigger
    db.exec('DROP TRIGGER test_fail_proj_delete;');
  });
});
