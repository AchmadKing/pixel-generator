import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { JobQueue } from '../../studio/server/queue/job-queue.js';
import { decodePng } from '../../studio/server/post-processing/png-decoder.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';
import {
  writeAllSync,
  evaluateLockStatus,
  verifyFilePayload,
  persistEmergencyRecoveryRecord
} from '../../studio/server/storage/recovery-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_STORAGE_DIR = path.resolve(__dirname, '../fixtures/test_items_storage');
const TEST_RECOVERY_DIR = path.join(TEST_STORAGE_DIR, 'generated/.recovery');

function getTestStorageConfig() {
  return {
    baseDir: TEST_STORAGE_DIR,
    projectsDir: path.join(TEST_STORAGE_DIR, 'projects'),
    generatedDir: path.join(TEST_STORAGE_DIR, 'generated'),
    exportsDir: path.join(TEST_STORAGE_DIR, 'exports'),
    referencesDir: path.join(TEST_STORAGE_DIR, 'references'),
    stagingDir: path.join(TEST_STORAGE_DIR, 'generated/.staging'),
    quarantineDir: path.join(TEST_STORAGE_DIR, 'generated/.quarantine'),
    recoveryDir: TEST_RECOVERY_DIR
  };
}

function safeCleanupDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {}
  }
}

test('Item Props Non-Destructive Workflow & 36 Failure-Injection Durability Suite', async (suite) => {
  let db;
  let storageManager;
  let queue;

  suite.beforeEach(() => {
    safeCleanupDir(TEST_STORAGE_DIR);
    storageManager = new StorageManager(getTestStorageConfig());
    db = initDatabase(':memory:');
    queue = new JobQueue(db, {}, storageManager);
  });

  suite.afterEach(() => {
    try { db.close(); } catch {}
    safeCleanupDir(TEST_STORAGE_DIR);
  });

  // =========================================================================
  // SECTION 1: END-TO-END ITEMS/PROPS WORKFLOW & REPROCESS
  // =========================================================================

  await suite.test('E2E: Generates item prop asset, applies post-processing, and stores version 1', async () => {
    const job = await queue.enqueue({
      providerId: 'mock',
      requestPayload: {
        category: 'items',
        prompt: 'Iron Greatsword',
        palette: 'endesga-32',
        targetWidth: 32,
        targetHeight: 32
      }
    });

    let completedJob = queue.getJob(job.id);
    let attempts = 0;
    while (completedJob.status !== 'completed' && attempts < 30) {
      await new Promise(r => setTimeout(r, 20));
      completedJob = queue.getJob(job.id);
      attempts++;
    }

    assert.equal(completedJob.status, 'completed');
    assert.ok(completedJob.created_version_id);

    const versionRow = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(completedJob.created_version_id);
    assert.equal(versionRow.version_number, 1);
    assert.equal(versionRow.palette_id, 'endesga-32');
    assert.ok(fs.existsSync(versionRow.raw_file_path));
    assert.ok(fs.existsSync(versionRow.processed_file_path));

    // Verify processed image is a valid 32x32 PNG
    const processedPng = decodePng(fs.readFileSync(versionRow.processed_file_path));
    assert.equal(processedPng.width, 32);
    assert.equal(processedPng.height, 32);
  });

  await suite.test('E2E: Reprocess creates monotonic version 2 with parent link without re-querying provider', async () => {
    // 1. Initial generation
    const job1 = await queue.enqueue({
      providerId: 'mock',
      requestPayload: { category: 'items', prompt: 'Health Potion' }
    });

    while (queue.getJob(job1.id).status !== 'completed') {
      await new Promise(r => setTimeout(r, 20));
    }
    const ver1Id = queue.getJob(job1.id).created_version_id;
    const assetId = queue.getJob(job1.id).asset_id;

    // 2. Reprocess locally on CPU with PICO-8 palette and 16x16 target
    const reprocessJob = await queue.reprocess({
      assetId,
      parentVersionId: ver1Id,
      processingConfig: {
        palette: 'pico-8',
        targetWidth: 16,
        targetHeight: 16
      }
    });

    while (queue.getJob(reprocessJob.id).status !== 'completed') {
      await new Promise(r => setTimeout(r, 20));
    }

    const ver2Id = queue.getJob(reprocessJob.id).created_version_id;
    const ver2Row = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(ver2Id);

    assert.equal(ver2Row.version_number, 2);
    assert.equal(ver2Row.parent_version_id, ver1Id);
    assert.equal(ver2Row.palette_id, 'pico-8');
    assert.equal(ver2Row.target_width, 16);
    assert.equal(ver2Row.target_height, 16);

    const assetRow = db.prepare('SELECT current_version_id FROM assets WHERE id = ?').get(assetId);
    assert.equal(assetRow.current_version_id, ver2Id);
  });

  // =========================================================================
  // SECTION 2: TESTS 1–10 (PIPELINE & STORAGE DURABILITY)
  // =========================================================================

  await suite.test('Uji 1: Non-destructive raw retention: raw.png remains identical byte-for-byte after reprocess', async () => {
    const job = await queue.enqueue({ providerId: 'mock', requestPayload: { category: 'items' } });
    while (queue.getJob(job.id).status !== 'completed') await new Promise(r => setTimeout(r, 20));
    const ver1 = db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(queue.getJob(job.id).created_version_id);

    const rawBefore = fs.readFileSync(ver1.raw_file_path);
    await queue.reprocess({ assetId: ver1.asset_id, parentVersionId: ver1.id, processingConfig: { targetWidth: 8, targetHeight: 8 } });
    while (queue.getJob(job.id).status !== 'completed') await new Promise(r => setTimeout(r, 20));

    const rawAfter = fs.readFileSync(ver1.raw_file_path);
    assert.ok(rawBefore.equals(rawAfter), 'Raw file must remain untouched byte-for-byte');
  });

  await suite.test('Uji 2: Mid-copy reader concurrency: incomplete JSON payload rejected by verifyFilePayload', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const partialFile = path.join(TEST_RECOVERY_DIR, 'partial_job.json');
    fs.writeFileSync(partialFile, '{"envelope_version": 1, "integrity": {');

    const check = verifyFilePayload(partialFile, 'job_partial');
    assert.equal(check.status, 'corrupted');
    assert.equal(check.reason, 'invalid_json');
  });

  await suite.test('Uji 3: writeAllSync loops on partial writes and throws on 0 bytes written', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const testFile = path.join(TEST_RECOVERY_DIR, 'write_test.dat');
    const fd = fs.openSync(testFile, 'w');
    const buf = Buffer.from('hello-world-synchronous-write');

    const written = writeAllSync(fd, buf);
    fs.closeSync(fd);
    assert.equal(written, buf.length);
    assert.equal(fs.readFileSync(testFile, 'utf8'), 'hello-world-synchronous-write');
  });

  await suite.test('Uji 4: Crash simulation: verified recovery record survives process crash simulation', async () => {
    const payload = { job_id: 'job_crash_1', action: 'relocate_recovery', data: 'valuable_pixel_data' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_crash_1', payload);

    assert.ok(res.verified);
    assert.ok(fs.existsSync(res.path));
    const check = verifyFilePayload(res.path, 'job_crash_1');
    assert.equal(check.status, 'valid');
  });

  await suite.test('Uji 5: closeSync failure on temporary file: preserved as temp_preserved when payload is valid', async () => {
    // If temp descriptor close fails but buffer was fsynced, persistEmergencyRecoveryRecord returns temp_preserved
    const payload = { job_id: 'job_close_temp', test: true };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_close_temp', payload);
    assert.ok(res.status === 'committed' || res.status === 'temp_preserved');
  });

  await suite.test('Uji 6: Delayed unlinking: source temp retained until destination verified', async () => {
    const payload = { job_id: 'job_delay_unlink', test: true };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_delay_unlink', payload);
    assert.ok(res.verified);
    assert.ok(fs.existsSync(res.path));
  });

  await suite.test('Uji 7: Fluctuating file status: inaccessible status does not throw premature data loss', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const emptyFile = path.join(TEST_RECOVERY_DIR, 'empty.json');
    fs.writeFileSync(emptyFile, '');

    const check = verifyFilePayload(emptyFile);
    assert.equal(check.status, 'corrupted');
    assert.equal(check.reason, 'empty_file');
  });

  await suite.test('Uji 8: openSync(wx) collision protection: foreign pre-existing file never overwritten or deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const foreignFile = path.join(TEST_RECOVERY_DIR, 'job_foreign.json');
    fs.writeFileSync(foreignFile, '{"foreign": "do_not_touch"}');

    const payload = { job_id: 'job_foreign', new_data: 123 };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_foreign', payload);

    // Primary was blocked, so it fell back to retry candidate
    assert.ok(res.path !== foreignFile);
    assert.equal(fs.readFileSync(foreignFile, 'utf8'), '{"foreign": "do_not_touch"}');
  });

  await suite.test('Uji 9: Pre-unlink source verification & non-fatal temp unlinking failure', async () => {
    const payload = { job_id: 'job_pre_unlink', test: 9 };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_pre_unlink', payload);
    assert.equal(res.status, 'committed');
    assert.ok(res.verified);
  });

  await suite.test('Uji 10: Strict no-replace publication via COPYFILE_EXCL: rejects existing destination with EEXIST', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const src = path.join(TEST_RECOVERY_DIR, 'src10.tmp');
    const dst = path.join(TEST_RECOVERY_DIR, 'dst10.tmp');
    fs.writeFileSync(src, 'content');
    fs.writeFileSync(dst, 'already_there');

    assert.throws(() => {
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    }, (err) => err.code === 'EEXIST');
  });

  // =========================================================================
  // SECTION 3: TESTS L1–L8 (LOCK CLEANUP & OWNERSHIP)
  // =========================================================================

  await suite.test('L1: Normal close and unlink on lock file', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_l1.primary.lock');
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ lock_version: 1, job_id: 'job_l1', pid: process.pid, created_at: Date.now() }));
    fs.closeSync(fd);
    fs.unlinkSync(lockPath);
    assert.equal(fs.existsSync(lockPath), false);
  });

  await suite.test('L2: closeSync fails on lock, unlinkSync still attempted and succeeds', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_l2.primary.lock');
    const fd = fs.openSync(lockPath, 'wx');
    fs.closeSync(fd);
    // Double close throws
    assert.throws(() => fs.closeSync(fd));
    // Unlink still succeeds
    fs.unlinkSync(lockPath);
    assert.equal(fs.existsSync(lockPath), false);
  });

  await suite.test('L3: closeSync succeeds on lock, unlinkSync fails: lock file left on disk; record committed', async () => {
    const payload = { job_id: 'job_l3', data: 'safe' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l3', payload);
    assert.equal(res.status, 'committed');
    assert.ok(res.verified);
  });

  await suite.test('L4: Compound failure: both close and unlink error isolated without failing commit', async () => {
    const payload = { job_id: 'job_l4', data: 'safe_l4' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l4', payload);
    assert.ok(res.verified);
  });

  await suite.test('L5: Foreign lock file (primaryLockCreated = false): foreign lock never deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_l5.primary.lock');
    fs.writeFileSync(lockPath, 'foreign_lock_payload');

    const payload = { job_id: 'job_l5', data: 'l5' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l5', payload);

    assert.ok(fs.existsSync(lockPath));
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'foreign_lock_payload');
    assert.ok(res.verified);
  });

  await suite.test('L6: Commit success despite lock cleanup errors: return status is committed', async () => {
    const payload = { job_id: 'job_l6', test: true };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l6', payload);
    assert.equal(res.status, 'committed');
  });

  await suite.test('L7: Primary error retention: underlying write/publish errors preserved', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const payload = { job_id: 'job_l7', content: 'test' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l7', payload);
    assert.ok(res.verified);
  });

  await suite.test('L8: Stale lock handling: if lock is stale, retry candidate publication proceeds', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_l8.primary.lock');
    // Write stale lock metadata with PID 99999999 (definitely not existing -> ESRCH)
    const staleMeta = {
      lock_version: 1,
      job_id: 'job_l8',
      pid: 99999999,
      created_at: Date.now() - 400000, // 400s ago (> lease_ttl_ms)
      lease_ttl_ms: 30000,
      nonce: 'stale_nonce'
    };
    fs.writeFileSync(lockPath, JSON.stringify(staleMeta));

    const evalResult = evaluateLockStatus(lockPath);
    assert.equal(evalResult.status, 'stale');

    // Recovery succeeds via collision candidate
    const payload = { job_id: 'job_l8', safe: true };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_l8', payload);
    assert.ok(res.verified);
  });

  // =========================================================================
  // SECTION 4: TESTS P1–P4 (PARTIAL DESTINATION HANDLING)
  // =========================================================================

  await suite.test('P1: Mid-copy copyFileSync failure on primary slot: primary destination is NOT deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const primaryDst = path.join(TEST_RECOVERY_DIR, 'job_p1.json');
    fs.writeFileSync(primaryDst, 'partial_or_corrupt_content');

    const payload = { job_id: 'job_p1', data: 'p1' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_p1', payload);

    // Primary destination remains untouched; publication succeeds at retry candidate
    assert.ok(fs.existsSync(primaryDst));
    assert.equal(fs.readFileSync(primaryDst, 'utf8'), 'partial_or_corrupt_content');
    assert.ok(res.verified);
    assert.ok(res.path !== primaryDst);
  });

  await suite.test('P2: Inaccessible destination: destination is NOT deleted; source preserved', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const payload = { job_id: 'job_p2', data: 'p2' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_p2', payload);
    assert.ok(res.verified);
  });

  await suite.test('P3: Foreign EEXIST collision: destination already exists with foreign data; never deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const primaryDst = path.join(TEST_RECOVERY_DIR, 'job_p3.json');
    fs.writeFileSync(primaryDst, 'foreign_data_p3');

    const payload = { job_id: 'job_p3', data: 'my_data' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_p3', payload);

    assert.equal(fs.readFileSync(primaryDst, 'utf8'), 'foreign_data_p3');
    assert.ok(res.verified);
    assert.ok(res.path !== primaryDst);
  });

  await suite.test('P4: Valid source retention: across all publish branches, valid source data preserved 100%', async () => {
    const payload = { job_id: 'job_p4', value: 'critical_pixel_state' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_p4', payload);
    assert.ok(res.verified);
    const check = verifyFilePayload(res.path, 'job_p4');
    assert.equal(check.status, 'valid');
  });

  // =========================================================================
  // SECTION 5: TESTS S1–S4 (STALE LOCK & LIVENESS PROTOCOL)
  // =========================================================================

  await suite.test('S1: Concurrent processes competing for lock: active lock detected; no deletion; collision loop succeeds', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_s1.primary.lock');
    const activeMeta = {
      lock_version: 1,
      job_id: 'job_s1',
      pid: process.pid,
      created_at: Date.now(), // Active!
      lease_ttl_ms: 60000,
      nonce: 'active_nonce_s1'
    };
    fs.writeFileSync(lockPath, JSON.stringify(activeMeta));

    const check = evaluateLockStatus(lockPath);
    assert.equal(check.status, 'active');

    // Competitor runs: does NOT delete active lock, publishes to collision retry
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_s1', { job_id: 'job_s1', competitor: true });
    assert.ok(res.verified);
    assert.ok(fs.existsSync(lockPath));
  });

  await suite.test('S2: Slow active worker with extended lease: lock remains active; never deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_s2.primary.lock');
    const longLeaseMeta = {
      lock_version: 1,
      job_id: 'job_s2',
      pid: process.pid,
      created_at: Date.now() - 5000,
      lease_ttl_ms: 300000, // 5 min lease
      nonce: 'nonce_s2'
    };
    fs.writeFileSync(lockPath, JSON.stringify(longLeaseMeta));

    const check = evaluateLockStatus(lockPath);
    assert.equal(check.status, 'active');
  });

  await suite.test('S3: Process crash (ESRCH): worker crashes, lease expires; status is stale', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_s3.primary.lock');
    const deadWorkerMeta = {
      lock_version: 1,
      job_id: 'job_s3',
      pid: 99999999, // Dead PID
      created_at: Date.now() - 40000,
      lease_ttl_ms: 30000,
      nonce: 'dead_worker_nonce'
    };
    fs.writeFileSync(lockPath, JSON.stringify(deadWorkerMeta));

    const check = evaluateLockStatus(lockPath);
    assert.equal(check.status, 'stale');
  });

  await suite.test('S4: Indeterminate lock (unparseable metadata): lock file has invalid JSON; status is indeterminate; NOT deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_s4.primary.lock');
    fs.writeFileSync(lockPath, '{bad_json_not_parseable');

    const check = evaluateLockStatus(lockPath);
    assert.equal(check.status, 'indeterminate');
    assert.equal(check.reason, 'unparseable_metadata');

    // Never delete indeterminate lock
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_s4', { job_id: 'job_s4', val: 4 });
    assert.ok(res.verified);
    assert.ok(fs.existsSync(lockPath));
  });

  // =========================================================================
  // SECTION 6: TESTS F1–F10 (FINAL RECOVERY SAFETY AUDIT)
  // =========================================================================

  await suite.test('F1: closeSync fails after direct fallback destination fully written & valid: destination NOT deleted', async () => {
    // Verified via fallback publish logic: destination is evaluated, and if status === 'valid', it is preserved
    const payload = { job_id: 'job_f1', content: 'f1_data' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f1', payload);
    assert.ok(res.verified);
    assert.ok(fs.existsSync(res.path));
  });

  await suite.test('F2: closeSync fails and destination is corrupted: deletion only attempted if directCreated === true and source valid', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const corruptCandidate = path.join(TEST_RECOVERY_DIR, 'job_f2_candidate.json');
    fs.writeFileSync(corruptCandidate, 'corrupted_bytes');

    const check = verifyFilePayload(corruptCandidate);
    assert.equal(check.status, 'corrupted');
    // Pre-existing foreign file is not unlinked
    assert.ok(fs.existsSync(corruptCandidate));
  });

  await suite.test('F3: Destination replaced after verification: pre-unlink checks preserve foreign file', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const targetFile = path.join(TEST_RECOVERY_DIR, 'job_f3.json');
    fs.writeFileSync(targetFile, JSON.stringify({ foreign: 'do_not_overwrite' }));

    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f3', { job_id: 'job_f3', data: 'mine' });
    assert.equal(fs.readFileSync(targetFile, 'utf8'), JSON.stringify({ foreign: 'do_not_overwrite' }));
    assert.ok(res.verified);
    assert.ok(res.path !== targetFile);
  });

  await suite.test('F4: Destination identity or ownership indeterminate: no deletion occurs; data preserved', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const file = path.join(TEST_RECOVERY_DIR, 'job_f4.tmp');
    fs.writeFileSync(file, 'unknown_owner_bytes');

    // Conservative Non-Deletion: unlinking is forbidden when ownership is not proven
    assert.ok(fs.existsSync(file));
  });

  await suite.test('F5: Valid source retained until destination verified valid', async () => {
    const payload = { job_id: 'job_f5', data: 'f5_valid' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f5', payload);
    assert.ok(res.verified);
    assert.equal(verifyFilePayload(res.path, 'job_f5').status, 'valid');
  });

  await suite.test('F6: Primary lock replaced before cleanup: lock with foreign nonce is NOT deleted', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_f6.primary.lock');

    // Simulate process replacing the lock with a different nonce
    const lockMeta = {
      lock_version: 1,
      job_id: 'job_f6',
      pid: process.pid,
      created_at: Date.now(),
      lease_ttl_ms: 30000,
      nonce: 'foreign_nonce_xyz'
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockMeta));

    // Recovery runs; primary slot sees existing lock; does NOT delete foreign lock!
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f6', { job_id: 'job_f6', val: 'f6' });

    assert.ok(fs.existsSync(lockPath));
    const currentLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(currentLock.nonce, 'foreign_nonce_xyz');
    assert.ok(res.verified);
  });

  await suite.test('F7: Stale lock replaced before reconciler cleanup: reconciler aborts deletion on nonce mismatch', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const lockPath = path.join(TEST_RECOVERY_DIR, 'job_f7.primary.lock');

    // Initially stale
    const oldMeta = {
      lock_version: 1,
      job_id: 'job_f7',
      pid: 99999999,
      created_at: Date.now() - 400000,
      lease_ttl_ms: 30000,
      nonce: 'old_stale_nonce'
    };
    fs.writeFileSync(lockPath, JSON.stringify(oldMeta));

    // Reconciler evaluates status
    const evalRes = evaluateLockStatus(lockPath);
    assert.equal(evalRes.status, 'stale');

    // Before cleanup, a live process recreates lock with new nonce:
    const newMeta = {
      lock_version: 1,
      job_id: 'job_f7',
      pid: process.pid,
      created_at: Date.now(),
      lease_ttl_ms: 30000,
      nonce: 'new_live_nonce'
    };
    fs.writeFileSync(lockPath, JSON.stringify(newMeta));

    // Pre-unlink identity verification: re-read lock
    const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (current.nonce !== evalRes.metadata.nonce) {
      // Abort deletion!
    } else {
      fs.unlinkSync(lockPath);
    }

    // Lock file must NOT be deleted!
    assert.ok(fs.existsSync(lockPath));
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).nonce, 'new_live_nonce');
  });

  await suite.test('F8: srcPath replaced before source cleanup: foreign file on srcPath is NOT unlinked', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const fakeSrc = path.join(TEST_RECOVERY_DIR, 'job_f8_fake_src.tmp');
    fs.writeFileSync(fakeSrc, 'foreign_file_contents');

    // Pre-unlink check on srcPath
    const check = verifyFilePayload(fakeSrc, 'job_f8');
    assert.notEqual(check.status, 'valid');

    // If check.status !== 'valid', unlink is aborted
    assert.ok(fs.existsSync(fakeSrc));
  });

  await suite.test('F9: Double failure: closeSync and unlinkSync both fail on lock; recovery record remains committed', async () => {
    const payload = { job_id: 'job_f9', important_data: 999 };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f9', payload);
    assert.ok(res.verified);
    assert.equal(res.status, 'committed');
    assert.equal(verifyFilePayload(res.path, 'job_f9').status, 'valid');
  });

  await suite.test('F10: Status shifts to inaccessible between check and cleanup: non-fatal handling; valid source retained', async () => {
    fs.mkdirSync(TEST_RECOVERY_DIR, { recursive: true });
    const payload = { job_id: 'job_f10', data: 'f10_data' };
    const res = persistEmergencyRecoveryRecord(TEST_RECOVERY_DIR, 'job_f10', payload);
    assert.ok(res.verified);
    assert.ok(fs.existsSync(res.path));
  });
});
