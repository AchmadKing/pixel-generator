import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase } from '../../studio/server/db/database.js';
import { scanAndSyncAssets, readPngDimensions } from '../../studio/server/storage/asset-scanner.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';

function createDummyPng(width, height) {
  const rgba = Buffer.alloc(width * height * 4, 128);
  return encodePng(width, height, rgba);
}

test('Asset Scanner & External AI Agent Ingestion Suite', async (t) => {
  let db;
  let tempBaseDir;
  let generatedDir;

  t.beforeEach(() => {
    db = initDatabase(':memory:');
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_scan_test_'));
    generatedDir = path.join(tempBaseDir, 'generated');
    fs.mkdirSync(generatedDir, { recursive: true });
  });

  t.afterEach(() => {
    try {
      db.close();
    } catch (_) {}
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('readPngDimensions parses exact dimensions without buffering full image', () => {
    const pngBuf = createDummyPng(48, 64);
    const filePath = path.join(tempBaseDir, 'sample_48x64.png');
    fs.writeFileSync(filePath, pngBuf);

    const dims = readPngDimensions(filePath);
    assert.ok(dims);
    assert.equal(dims.width, 48);
    assert.equal(dims.height, 64);
    assert.equal(dims.size, pngBuf.length);

    // Non-PNG returns null
    const textFile = path.join(tempBaseDir, 'not_a_png.txt');
    fs.writeFileSync(textFile, 'Just plain text');
    assert.equal(readPngDimensions(textFile), null);

    // Truncated file returns null
    const shortFile = path.join(tempBaseDir, 'truncated.png');
    fs.writeFileSync(shortFile, pngBuf.subarray(0, 10));
    assert.equal(readPngDimensions(shortFile), null);

    // Non-existent file returns null
    assert.equal(readPngDimensions(path.join(tempBaseDir, 'nonexistent.png')), null);
  });

  await t.test('scanAndSyncAssets handles empty generated directory', () => {
    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.scannedAssets, 0);
    assert.equal(summary.addedAssets, 0);
    assert.equal(summary.errors.length, 0);
  });

  await t.test('scanAndSyncAssets ignores hidden and staging folders', () => {
    fs.mkdirSync(path.join(generatedDir, '.staging'), { recursive: true });
    fs.mkdirSync(path.join(generatedDir, '.quarantine'), { recursive: true });
    fs.mkdirSync(path.join(generatedDir, '.recovery'), { recursive: true });

    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.scannedAssets, 0);
    assert.equal(summary.addedAssets, 0);
  });

  await t.test('scanAndSyncAssets discovers single asset with metadata.json', () => {
    const assetSlug = 'healing-potion';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });

    const pngBuf = createDummyPng(32, 32);
    fs.writeFileSync(path.join(v1Dir, 'processed.png'), pngBuf);

    const meta = {
      asset_id: 'healing-potion',
      name: 'Elixir of Healing',
      category: 'items',
      version_number: 1,
      prompt: '32x32 red potion in round bottle with cork stopper',
      palette_id: 'endesga-32',
      source_tool: 'ai-agent'
    };
    fs.writeFileSync(path.join(v1Dir, 'metadata.json'), JSON.stringify(meta));

    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.scannedAssets, 1);
    assert.equal(summary.addedAssets, 1);
    assert.equal(summary.addedVersions, 1);

    // Verify database record
    const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetSlug);
    assert.ok(assetRow);
    assert.equal(assetRow.name, 'Elixir of Healing');
    assert.equal(assetRow.category, 'items');
    assert.ok(assetRow.current_version_id);

    const versionRow = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(assetRow.current_version_id);
    assert.ok(versionRow);
    assert.equal(versionRow.asset_id, assetSlug);
    assert.equal(versionRow.version_number, 1);
    assert.equal(versionRow.prompt, meta.prompt);
    assert.equal(versionRow.target_width, 32);
    assert.equal(versionRow.target_height, 32);
    assert.equal(versionRow.palette_id, 'endesga-32');
    assert.equal(versionRow.provider_id, 'ai-agent');
    assert.equal(versionRow.integrity_status, 'ok');
  });

  await t.test('scanAndSyncAssets infers missing metadata safely without crashing', () => {
    const assetSlug = 'iron-greatsword';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });

    const pngBuf = createDummyPng(64, 64);
    fs.writeFileSync(path.join(v1Dir, 'image.png'), pngBuf); // Using 'image.png'

    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.scannedAssets, 1);
    assert.equal(summary.addedAssets, 1);
    assert.equal(summary.addedVersions, 1);

    const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetSlug);
    assert.equal(assetRow.name, 'Iron Greatsword');
    assert.equal(assetRow.category, 'items');

    const versionRow = db.prepare('SELECT * FROM asset_versions WHERE asset_id = ?').get(assetSlug);
    assert.equal(versionRow.target_width, 64);
    assert.equal(versionRow.target_height, 64);
    assert.equal(versionRow.provider_id, 'ai-agent');
    assert.equal(versionRow.palette_id, 'endesga-32');
  });

  await t.test('scanAndSyncAssets ingests multi-version lineage and updates active version to latest', () => {
    const assetSlug = 'cyber-ninja';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    const v2Dir = path.join(generatedDir, assetSlug, 'v2');
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.mkdirSync(v2Dir, { recursive: true });

    fs.writeFileSync(path.join(v1Dir, 'processed.png'), createDummyPng(32, 32));
    fs.writeFileSync(path.join(v1Dir, 'metadata.json'), JSON.stringify({
      name: 'Cyber Ninja',
      category: 'characters',
      version_number: 1,
      prompt: 'Ninja sprite in black armor'
    }));

    fs.writeFileSync(path.join(v2Dir, 'processed.png'), createDummyPng(32, 32));
    fs.writeFileSync(path.join(v2Dir, 'metadata.json'), JSON.stringify({
      name: 'Cyber Ninja',
      category: 'characters',
      version_number: 2,
      prompt: 'Ninja sprite in glowing blue neon armor',
      change_summary: 'Added glowing blue neon accents'
    }));

    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.scannedAssets, 1);
    assert.equal(summary.addedAssets, 1);
    assert.equal(summary.addedVersions, 2);

    const versions = db.prepare('SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version_number ASC').all(assetSlug);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version_number, 1);
    assert.equal(versions[1].version_number, 2);
    assert.equal(versions[1].notes, 'Added glowing blue neon accents');

    const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetSlug);
    assert.equal(assetRow.current_version_id, versions[1].id, 'Active version must point to latest version v2');
  });

  await t.test('scanAndSyncAssets is idempotent: repeated scans do not duplicate records', () => {
    const assetSlug = 'mana-gem';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.writeFileSync(path.join(v1Dir, 'processed.png'), createDummyPng(16, 16));

    // First scan
    const scan1 = scanAndSyncAssets(db, { generatedDir });
    assert.equal(scan1.addedAssets, 1);
    assert.equal(scan1.addedVersions, 1);

    // Second scan
    const scan2 = scanAndSyncAssets(db, { generatedDir });
    assert.equal(scan2.addedAssets, 0, 'Must not duplicate asset');
    assert.equal(scan2.addedVersions, 0, 'Must not duplicate version');
    assert.equal(scan2.updatedVersions, 1, 'Updates existing version record');

    const totalAssets = db.prepare('SELECT COUNT(*) as count FROM assets').get();
    assert.equal(totalAssets.count, 1);
    const totalVersions = db.prepare('SELECT COUNT(*) as count FROM asset_versions').get();
    assert.equal(totalVersions.count, 1);
  });

  await t.test('scanAndSyncAssets marks missing backing file if image is removed from disk', () => {
    const assetSlug = 'ghost-shield';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });
    const imgPath = path.join(v1Dir, 'processed.png');
    fs.writeFileSync(imgPath, createDummyPng(32, 32));

    scanAndSyncAssets(db, { generatedDir });

    const verBefore = db.prepare('SELECT integrity_status FROM asset_versions WHERE asset_id = ?').get(assetSlug);
    assert.equal(verBefore.integrity_status, 'ok');

    // Delete image from disk
    fs.unlinkSync(imgPath);

    // Scan again
    scanAndSyncAssets(db, { generatedDir });

    const verAfter = db.prepare('SELECT integrity_status FROM asset_versions WHERE asset_id = ?').get(assetSlug);
    assert.equal(verAfter.integrity_status, 'missing_backing_file');
  });

  await t.test('scanAndSyncAssets ignores temporary .tmp files', () => {
    const assetSlug = 'writing-asset';
    const v1Dir = path.join(generatedDir, assetSlug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });

    // File currently being written
    fs.writeFileSync(path.join(v1Dir, 'output.png.tmp'), Buffer.alloc(100));

    const summary = scanAndSyncAssets(db, { generatedDir });
    assert.equal(summary.addedAssets, 0, 'Should not import temporary writing files');
  });
});
