import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../../studio/server/db/database.js';
import { JobStore } from '../../studio/server/queue/job-store.js';
import { JobQueue } from '../../studio/server/queue/job-queue.js';

test('Job Lifecycle and Restart Recovery Suite', async (t) => {
  let db;
  let jobStore;

  t.beforeEach(() => {
    db = initDatabase(':memory:');
    jobStore = new JobStore(db);
  });

  await t.test('Job Lifecycle: create, update stage, set provider id, complete with valid foreign keys', () => {
    // 1. Create job
    const job = jobStore.createJob({
      id: 'job_test_01',
      providerId: 'mock',
      requestPayload: { prompt: 'fantasy dagger', size: 32 }
    });

    assert.equal(job.status, 'queued');
    assert.equal(job.stage, 'queued');

    jobStore.updateStage('job_test_01', 'submitting');
    assert.equal(jobStore.getJob('job_test_01').stage, 'submitting');

    jobStore.setProviderRequestId('job_test_01', 'fal_req_9988');
    const pollingJob = jobStore.getJob('job_test_01');
    assert.equal(pollingJob.stage, 'polling');
    assert.equal(pollingJob.provider_request_id, 'fal_req_9988');

    // 2. Prepare valid asset & version in database to satisfy foreign keys
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id) 
      VALUES ('ast_created_1', 'proj_default', 'Test Dagger', 'items', NULL)
    `).run();
    db.prepare(`
      INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) 
      VALUES ('ver_created_1', 'ast_created_1', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')
    `).run();

    // 3. Complete job
    jobStore.completeJob('job_test_01', 'ver_created_1', 'ast_created_1');
    const completedJob = jobStore.getJob('job_test_01');
    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.stage, 'completed');
    assert.equal(completedJob.created_version_id, 'ver_created_1');
    assert.equal(completedJob.asset_id, 'ast_created_1');
  });

  await t.test('Crash during submitting stage without provider ID marks job as interrupted (ambiguous_submit) without re-submit', async () => {
    // Create job stuck in submitting stage when server dies
    jobStore.createJob({
      id: 'job_ambiguous_01',
      providerId: 'fal-ai',
      requestPayload: { prompt: 'gold sword' }
    });
    jobStore.updateStage('job_ambiguous_01', 'submitting', 'running');

    // Server crash and startup recovery triggers
    const recoveredCount = jobStore.recoverInterruptedJobs();
    assert.equal(recoveredCount, 1);

    const recoveredJob = jobStore.getJob('job_ambiguous_01');
    assert.equal(recoveredJob.status, 'interrupted');
    assert.equal(recoveredJob.stage, 'interrupted');
    assert.ok(
      recoveredJob.error_message.includes('Ambiguous submit state'),
      'Must contain ambiguous submit explanation'
    );
    assert.ok(
      recoveredJob.error_message.includes('Automatic re-submission blocked'),
      'Must state that automatic re-submission is blocked to prevent double billing'
    );

    // Active Verification: Verify database has 0 executable jobs
    const activeJobs = db.prepare(`SELECT count(*) as c FROM jobs WHERE status IN ('queued', 'running')`).get();
    assert.equal(activeJobs.c, 0, 'No active jobs must remain in queue after recovery');

    // Active Verification: Spin up a fresh queue worker with a spy handler
    let reSubmitAttempted = false;
    const testQueue = new JobQueue(db, {
      'fal-ai': async () => { reSubmitAttempted = true; }
    });
    // Attempt processing
    await testQueue.processNext();
    assert.equal(reSubmitAttempted, false, 'Queue worker must NEVER automatically re-submit an interrupted ambiguous job');
  });

  await t.test('Crash during polling stage preserves provider request ID for manual check without auto-resubmit', () => {
    jobStore.createJob({
      id: 'job_polling_crash',
      providerId: 'fal-ai',
      requestPayload: { prompt: 'silver shield' }
    });
    jobStore.updateStage('job_polling_crash', 'submitting', 'running');
    jobStore.setProviderRequestId('job_polling_crash', 'fal_req_actual_456');

    // Server crashes while in polling stage
    jobStore.recoverInterruptedJobs();

    const recoveredJob = jobStore.getJob('job_polling_crash');
    assert.equal(recoveredJob.status, 'interrupted');
    assert.equal(recoveredJob.provider_request_id, 'fal_req_actual_456', 'Provider request ID must be preserved');
    assert.ok(recoveredJob.error_message.includes('has provider request ID'));
  });

  await t.test('In-process JobQueue executes registered handler sequentially and respects foreign keys', async () => {
    // Insert valid asset container first
    db.prepare(`
      INSERT INTO assets (id, project_id, name, category, current_version_id) 
      VALUES ('ast_q', 'proj_default', 'Queue Item', 'items', NULL)
    `).run();

    let executedJob = null;
    const handlers = {
      mock: async (job, store) => {
        executedJob = job;
        // Create version in DB
        db.prepare(`
          INSERT INTO asset_versions (id, asset_id, version_number, prompt, provider_id, palette_id, target_width, target_height, raw_file_path, processed_file_path, processing_config_json) 
          VALUES ('ver_mock_res', 'ast_q', 1, 'p', 'm', 'pal', 32, 32, 'r', 'p', '{}')
        `).run();
        store.completeJob(job.id, 'ver_mock_res', 'ast_q');
      }
    };

    const queue = new JobQueue(db, handlers);
    const enqueued = await queue.enqueue({
      assetId: 'ast_q',
      providerId: 'mock',
      requestPayload: { prompt: 'potion' }
    });

    // Wait for async queue runner to process
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.ok(executedJob);
    assert.equal(executedJob.id, enqueued.id);

    const check = queue.getJob(enqueued.id);
    assert.equal(check.status, 'completed');
    assert.equal(check.created_version_id, 'ver_mock_res');
  });

  await t.test('Job failure handling records error message properly', () => {
    jobStore.createJob({
      id: 'job_fail_01',
      providerId: 'mock',
      requestPayload: { prompt: 'failing job' }
    });

    jobStore.failJob('job_fail_01', 'Simulated provider quota exceeded');
    const failedJob = jobStore.getJob('job_fail_01');

    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.stage, 'failed');
    assert.equal(failedJob.error_message, 'Simulated provider quota exceeded');
  });
});
