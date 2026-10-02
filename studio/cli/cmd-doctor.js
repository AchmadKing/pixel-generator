import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../server/config.js';
import { initDatabase } from '../server/db/database.js';
import { resolveSafePath } from '../server/storage/path-jail.js';

export async function runDoctor() {
  console.log('='.repeat(65));
  console.log('   PIXEL GAME ASSET STUDIO - ENVIRONMENT & DIAGNOSTIC DOCTOR   ');
  console.log('='.repeat(65));

  let passed = true;

  // 1. Runtime Version Check
  const nodeVer = process.version;
  const [major, minor] = process.versions.node.split('.').map(Number);
  const meetsMin = major > 22 || (major === 22 && minor >= 13);

  if (meetsMin) {
    console.log(`[PASS] Node.js Runtime: ${nodeVer} (Meets requirement >= 22.13.0)`);
    console.log(`       Notice: Built-in node:sqlite is active without experimental flags.`);
    console.log(`       (Note: Upstream Node.js marks node:sqlite API as under active stabilization).`);
  } else {
    console.error(`[FAIL] Node.js Runtime: ${nodeVer} (Requires >= 22.13.0 for stable node:sqlite)`);
    passed = false;
  }

  // 2. Platform / OS Check
  console.log(`[INFO] Operating System: ${process.platform} (${process.arch})`);

  // 3. Native node:sqlite Verification
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const memDb = new DatabaseSync(':memory:');
    memDb.exec('CREATE TABLE test (id INT); INSERT INTO test VALUES (1);');
    const row = memDb.prepare('SELECT id FROM test').get();
    if (row && row.id === 1) {
      console.log(`[PASS] Native SQLite Engine: Operational (DatabaseSync verified)`);
    } else {
      throw new Error('Unexpected query output');
    }
  } catch (e) {
    console.error(`[FAIL] Native SQLite Engine: Failed (${e.message})`);
    passed = false;
  }

  // 4. Storage Directories & Permissions
  const requiredDirs = [
    config.storage.baseDir,
    config.storage.projectsDir,
    config.storage.generatedDir,
    config.storage.exportsDir,
    config.storage.referencesDir,
    config.storage.stagingDir,
    config.storage.quarantineDir
  ];

  let storageOk = true;
  for (const dir of requiredDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Test write permission with test file
      const testFile = path.join(dir, `.doctor_test_${Date.now()}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
    } catch (e) {
      console.error(`[FAIL] Storage Dir Error: ${dir} (${e.message})`);
      storageOk = false;
      passed = false;
    }
  }
  if (storageOk) {
    console.log(`[PASS] Storage Directories: All 7 directories exist and are writable`);
  }

  // 5. Database Schema & Migration Check
  try {
    const db = initDatabase(':memory:');
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all().map(r => r.name);
    
    const requiredTables = ['projects', 'assets', 'asset_versions', 'asset_frames', 'jobs'];
    const missingTables = requiredTables.filter(t => !tables.includes(t));

    if (missingTables.length === 0) {
      console.log(`[PASS] Database Schema: All tables (${requiredTables.join(', ')}) verified`);
    } else {
      console.error(`[FAIL] Database Schema: Missing tables: ${missingTables.join(', ')}`);
      passed = false;
    }

    // Check triggers
    const triggers = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name
    `).all().map(r => r.name);
    const requiredTriggers = [
      'validate_current_version_before_insert',
      'validate_current_version_before_update',
      'prevent_delete_active_version'
    ];
    const missingTriggers = requiredTriggers.filter(t => !triggers.includes(t));
    if (missingTriggers.length === 0) {
      console.log(`[PASS] Database Triggers: All 3 integrity triggers installed`);
    } else {
      console.error(`[FAIL] Database Triggers: Missing triggers: ${missingTriggers.join(', ')}`);
      passed = false;
    }
  } catch (e) {
    console.error(`[FAIL] Database Migration: ${e.message}`);
    passed = false;
  }

  // 6. Path Traversal Jail Security Check
  try {
    let securityBlocked = false;
    try {
      resolveSafePath(config.storage.baseDir, '../../outside_test');
    } catch (secErr) {
      if (secErr.message.includes('Security Violation')) {
        securityBlocked = true;
      }
    }
    if (securityBlocked) {
      console.log(`[PASS] Path Traversal Jail: Successfully blocked path escape attempt`);
    } else {
      console.error(`[FAIL] Path Traversal Jail: Failed to block traversal!`);
      passed = false;
    }
  } catch (e) {
    console.error(`[FAIL] Security Check: ${e.message}`);
    passed = false;
  }

  // 7. Provider Setup & Mode Status
  try {
    const { MockProvider } = await import('../server/providers/mock-provider.js');
    const mock = new MockProvider();
    if (mock.isAvailable()) {
      console.log(`[PASS] Mock Provider: Operational (100% Offline Procedural Generator ready)`);
    }

    const { FalProvider } = await import('../server/providers/fal-provider.js');
    const fal = new FalProvider(config.providers.fal, config.providers.falKey);
    if (fal.isAvailable()) {
      const raw = config.providers.falKey.trim();
      const masked = raw.length > 8 
        ? `${raw.slice(0, 4)}...${raw.slice(-3)}` 
        : '****';
      console.log(`[INFO] Fal.ai Provider: Key detected (${masked}). Cloud AI Mode (Flux LoRA) is AVAILABLE.`);
    } else {
      console.log(`[INFO] Fal.ai Provider: No FAL_KEY in environment.`);
      console.log(`       Studio runs 100% locally with zero cost using Mock Generator.`);
    }
  } catch (provErr) {
    console.error(`[FAIL] Provider Inspection: ${provErr.message}`);
    passed = false;
  }

  console.log('='.repeat(65));
  if (passed) {
    console.log('>>> DOCTOR STATUS: ALL HEALTH CHECKS PASSED (SYSTEM READY) <<<');
  } else {
    console.error('>>> DOCTOR STATUS: DIAGNOSTIC FAILED (PLEASE FIX ERRORS) <<<');
  }
  console.log('='.repeat(65));

  return passed;
}
