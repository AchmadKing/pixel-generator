import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, withTransaction } from '../../studio/server/db/database.js';
import { cleanupEmptyDraftAssets } from '../../studio/server/db/safe-deletion.js';

test('Empty Asset Handling and Surgical Cleanup Suite', async (t) => {
  let db;

  t.beforeEach(() => {
    db = initDatabase(':memory:');
  });

  await t.test('Transaction rollback prevents creation of empty ghost assets on generation failure', () => {
    // Simulate generation failure in the middle of atomic commit
    assert.throws(() => {
      withTransaction(db, () => {
        // Step 1: Insert asset with NULL version
        db.prepare(`
          INSERT INTO assets (id, project_id, name, category, current_version_id)
          VALUES ('ast_ghost', 'proj_default', 'Failed Asset', 'items', NULL)
        `).run();

        // Step 2: Injected failure before version 1 can be committed
        throw new Error('Simulated image pipeline failure before version commit');
      });
    }, /Simulated image pipeline failure/);

    // Verify NO ghost asset exists in the assets table
    const check = db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_ghost');
    assert.equal(check, undefined, 'Ghost asset must be completely rolled back');
  });

  await t.test('Surgical cleanup only removes uninitialized drafts without versions', () => {
    // 1. Create a legitimate asset with version 1
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_valid', 'proj_default', 'Valid Item', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_v1', 'ast_valid', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();
    db.prepare(`UPDATE assets SET current_version_id = 'ver_v1' WHERE id = 'ast_valid'`).run();

    // 2. Create an empty draft asset (simulating an abandoned creation)
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_empty_draft', 'proj_default', 'Empty Draft', 'items', NULL)`).run();

    // 3. Create another asset that temporarily has current_version_id = NULL but HAS versions
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_unlinked_version', 'proj_default', 'Unlinked', 'items', NULL)`).run();
    db.prepare(`INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) VALUES ('ver_u1', 'ast_unlinked_version', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')`).run();

    // Execute surgical cleanup across all assets
    const cleanedCount = cleanupEmptyDraftAssets(db);
    assert.equal(cleanedCount, 1, 'Only ast_empty_draft should be cleaned up');

    // Verify ast_empty_draft is deleted
    assert.equal(db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_empty_draft'), undefined);

    // Verify valid assets are 100% intact
    assert.ok(db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_valid'));
    assert.ok(db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_unlinked_version'));
  });

  await t.test('Targeted surgical cleanup by specific asset ID', () => {
    db.prepare(`INSERT INTO assets (id, project_id, name, category, current_version_id) VALUES ('ast_targeted_draft', 'proj_default', 'Targeted', 'items', NULL)`).run();
    
    const count = cleanupEmptyDraftAssets(db, 'ast_targeted_draft');
    assert.equal(count, 1);
    assert.equal(db.prepare('SELECT id FROM assets WHERE id = ?').get('ast_targeted_draft'), undefined);
  });
});
