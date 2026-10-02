import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  persistEmergencyRecoveryRecord,
  verifyFilePayload,
  evaluateLockStatus,
  writeAllSync,
  canonicalizeJson,
  canonicalStringify
} from '../../studio/server/storage/recovery-manager.js';
import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { JobQueue } from '../../studio/server/queue/job-queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.resolve(__dirname, '../fixtures/test_recovery_contracts');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {}
  }
}

test('Recovery Manager Contract & Identity Defense Suite', async (t) => {
  t.beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  t.afterEach(() => {
    cleanup();
  });

  await t.test('Contract 1: Payload without job_id is defensively normalized to caller jobId', () => {
    const payload = { error: 'Simulated failure without explicit job_id', timestamp: 12345 };
    const res = persistEmergencyRecoveryRecord(TEST_DIR, 'job_norm_1', payload);

    assert.equal(res.status, 'committed');
    assert.equal(res.verified, true);
    assert.ok(fs.existsSync(res.path));

    const check = verifyFilePayload(res.path, 'job_norm_1');
    assert.equal(check.status, 'valid');
    assert.equal(check.data.job_id, 'job_norm_1');
    assert.equal(check.data.error, 'Simulated failure without explicit job_id');
  });

  await t.test('Contract 2: Payload with matching job_id is accepted directly and envelope verified', () => {
    const payload = { job_id: 'job_match_1', details: 'explicit_match', value: 42 };
    const res = persistEmergencyRecoveryRecord(TEST_DIR, 'job_match_1', payload);

    assert.equal(res.status, 'committed');
    assert.equal(res.verified, true);

    const check = verifyFilePayload(res.path, 'job_match_1');
    assert.equal(check.status, 'valid');
    assert.equal(check.data.job_id, 'job_match_1');
  });

  await t.test('Contract 3: Conflicting payload.job_id throws RecoveryConflictError and aborts without creating files', () => {
    const conflictingPayload = { job_id: 'job_imposter_99', evil: true };

    assert.throws(() => {
      persistEmergencyRecoveryRecord(TEST_DIR, 'job_real_1', conflictingPayload);
    }, (err) => {
      assert.equal(err.code, 'ERR_RECOVERY_JOB_ID_CONFLICT');
      assert.ok(err.message.includes('conflicts with caller jobId'));
      return true;
    });

    // Verify zero files created in test directory
    const files = fs.readdirSync(TEST_DIR);
    assert.equal(files.length, 0, 'No files or lock files must be created when conflict error is thrown');
  });

  await t.test('Contract 4: Invalid payload types throw TypeError', () => {
    assert.throws(() => {
      persistEmergencyRecoveryRecord(TEST_DIR, 'job_bad_type', null);
    }, TypeError);

    assert.throws(() => {
      persistEmergencyRecoveryRecord(TEST_DIR, 'job_bad_type', [1, 2, 3]);
    }, TypeError);

    assert.throws(() => {
      persistEmergencyRecoveryRecord(TEST_DIR, 'job_bad_type', 'string_payload');
    }, TypeError);
  });

  await t.test('Contract 5: Backward compatibility with legacy envelope-free JSON records', () => {
    const legacyPath = path.join(TEST_DIR, 'job_legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ job_id: 'job_legacy', old_field: 'legacy_data' }));

    const check = verifyFilePayload(legacyPath, 'job_legacy');
    assert.equal(check.status, 'legacy_unverified');
    assert.equal(check.data.job_id, 'job_legacy');
    assert.equal(check.warning, 'missing_integrity_envelope');
  });

  await t.test('Contract 6: SQLite locked/unwritable in JobQueue triggers emergency recovery record without mismatch', async () => {
    const storageManager = new StorageManager({
      baseDir: TEST_DIR,
      projectsDir: path.join(TEST_DIR, 'projects'),
      generatedDir: path.join(TEST_DIR, 'generated'),
      exportsDir: path.join(TEST_DIR, 'exports'),
      referencesDir: path.join(TEST_DIR, 'references'),
      stagingDir: path.join(TEST_DIR, 'generated/.staging'),
      quarantineDir: path.join(TEST_DIR, 'generated/.quarantine'),
      recoveryDir: path.join(TEST_DIR, 'generated/.recovery')
    });
    storageManager.ensureDirectories();

    const db = initDatabase(':memory:');
    const failingProvider = {
      name: 'Fatal Provider',
      generate: async () => {
        // Close database during generation so store.failJob will fail on closed database
        db.close();
        throw new Error('Fatal provider failure to trigger catch');
      }
    };

    const queue = new JobQueue(db, { 'mock': failingProvider }, storageManager);
    const job = await queue.enqueue({
      providerId: 'mock',
      requestPayload: { prompt: 'sqlite crash test' }
    });

    // Give queue loop time to catch error and attempt DB update, which throws and falls back to persistEmergencyRecoveryRecord
    await new Promise(r => setTimeout(r, 60));

    // Check that recovery record was successfully written and verified on disk
    const recoveryDir = storageManager.config.recoveryDir;
    assert.ok(fs.existsSync(recoveryDir), 'Recovery directory must exist');

    const recoveryFiles = fs.readdirSync(recoveryDir).filter(f => f.startsWith(job.id) && f.endsWith('.json'));
    assert.ok(recoveryFiles.length > 0, 'Emergency recovery record must be created when DB is closed');

    const recFile = path.join(recoveryDir, recoveryFiles[0]);
    const check = verifyFilePayload(recFile, job.id);
    assert.equal(check.status, 'valid');
    assert.equal(check.data.job_id, job.id);
    assert.ok(check.data.error.includes('Fatal provider failure'));
  });
});
