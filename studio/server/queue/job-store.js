import crypto from 'node:crypto';

export class JobStore {
  constructor(db) {
    this.db = db;
  }

  createJob({
    id = `job_${crypto.randomUUID().slice(0, 8)}`,
    assetId = null,
    providerId = 'mock',
    requestPayload = {}
  }) {
    const payloadStr = typeof requestPayload === 'string' 
      ? requestPayload 
      : JSON.stringify(requestPayload);

    this.db.prepare(`
      INSERT INTO jobs (id, asset_id, provider_id, status, stage, request_payload)
      VALUES (?, ?, ?, 'queued', 'queued', ?)
    `).run(id, assetId, providerId, payloadStr);

    return this.getJob(id);
  }

  getJob(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      request_payload: JSON.parse(row.request_payload || '{}')
    };
  }

  updateStage(id, stage, status = 'running') {
    this.db.prepare(`
      UPDATE jobs 
      SET stage = ?, status = ?, updated_at = unixepoch() 
      WHERE id = ?
    `).run(stage, status, id);
  }

  setProviderRequestId(id, providerRequestId) {
    this.db.prepare(`
      UPDATE jobs 
      SET provider_request_id = ?, stage = 'polling', updated_at = unixepoch() 
      WHERE id = ?
    `).run(providerRequestId, id);
  }

  completeJob(id, createdVersionId, assetId = null) {
    this.db.prepare(`
      UPDATE jobs 
      SET status = 'completed', stage = 'completed', created_version_id = ?, 
          asset_id = COALESCE(?, asset_id), updated_at = unixepoch() 
      WHERE id = ?
    `).run(createdVersionId, assetId, id);
  }

  failJob(id, errorMessage) {
    this.db.prepare(`
      UPDATE jobs 
      SET status = 'failed', stage = 'failed', error_message = ?, updated_at = unixepoch() 
      WHERE id = ?
    `).run(errorMessage, id);
  }

  /**
   * Recovers jobs interrupted by a server restart.
   * Guardrail: Jobs in 'submitting' stage without provider_request_id are marked as
   * 'interrupted' with ambiguous_submit message and NEVER automatically re-submitted!
   */
  recoverInterruptedJobs() {
    const interruptedJobs = this.db.prepare(`
      SELECT * FROM jobs 
      WHERE status IN ('queued', 'running')
    `).all();

    for (const job of interruptedJobs) {
      if (job.stage === 'submitting' && !job.provider_request_id) {
        this.db.prepare(`
          UPDATE jobs 
          SET status = 'interrupted',
              stage = 'interrupted',
              error_message = 'Ambiguous submit state: connection dropped during provider submission. Automatic re-submission blocked to prevent duplicate billing.',
              updated_at = unixepoch()
          WHERE id = ?
        `).run(job.id);
      } else if (job.provider_request_id) {
        this.db.prepare(`
          UPDATE jobs 
          SET status = 'interrupted',
              stage = 'interrupted',
              error_message = 'Job interrupted by restart; has provider request ID for manual check or recovery',
              updated_at = unixepoch()
          WHERE id = ?
        `).run(job.id);
      } else {
        this.db.prepare(`
          UPDATE jobs 
          SET status = 'interrupted',
              stage = 'interrupted',
              error_message = 'Process interrupted by application restart',
              updated_at = unixepoch()
          WHERE id = ?
        `).run(job.id);
      }
    }

    return interruptedJobs.length;
  }
}
