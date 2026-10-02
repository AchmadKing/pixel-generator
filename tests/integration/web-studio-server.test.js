import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { JobStore } from '../../studio/server/queue/job-store.js';
import { JobQueue } from '../../studio/server/queue/job-queue.js';
import { AssetCoordinator } from '../../studio/server/queue/asset-coordinator.js';
import { startStudioServer, stopStudioServer } from '../../studio/server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/web_studio_test');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function makeRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            json = JSON.parse(buffer.toString('utf8'));
          } catch (_) {}
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer,
          text: buffer.toString('utf8'),
          json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(data));
      req.write(data);
    }

    req.end();
  });
}

test('Web Studio Server HTTP & End-to-End Workflow Suite', async (t) => {
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
  const assetCoordinator = new AssetCoordinator(db);
  const jobQueue = new JobQueue(db, {}, storageManager, assetCoordinator);

  const config = {
    server: { host: '127.0.0.1', port: 0 }, // Random free port
    storage: storageConfig,
    providers: { default: 'mock', falKey: '' },
    defaults: { palette: 'endesga-32', targetWidth: 32, targetHeight: 32 }
  };

  // Start live HTTP server on dynamic port
  const serverInfo = await startStudioServer({
    db,
    jobQueue,
    storageManager,
    config,
    port: 0
  });

  const baseUrl = serverInfo.url;

  t.after(async () => {
    await stopStudioServer(serverInfo.server, jobQueue, db, 2000);
    if (fs.existsSync(FIXTURES_DIR)) {
      try {
        fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('1. Static File Serving & Security Headers', async () => {
    // A. Root index.html
    const resRoot = await makeRequest(`${baseUrl}/`);
    assert.equal(resRoot.statusCode, 200);
    assert.ok(resRoot.headers['content-type'].includes('text/html'));
    assert.ok(resRoot.text.includes('Pixel Game Asset Studio'));
    assert.equal(resRoot.headers['x-content-type-options'], 'nosniff');

    // B. CSS
    const resCss = await makeRequest(`${baseUrl}/css/main.css`);
    assert.equal(resCss.statusCode, 200);
    assert.ok(resCss.headers['content-type'].includes('text/css'));

    // C. JavaScript Module
    const resJs = await makeRequest(`${baseUrl}/js/app.js`);
    assert.equal(resJs.statusCode, 200);
    assert.ok(resJs.headers['content-type'].includes('javascript'));

    // D. Path Traversal on Static Files Blocked
    const resTraversal = await makeRequest(`${baseUrl}/css/..%2f..%2fpackage.json`);
    assert.ok(resTraversal.statusCode === 400 || resTraversal.statusCode === 403);
  });

  await t.test('2. Configuration & Projects API', async () => {
    // A. GET /api/config
    const resConfig = await makeRequest(`${baseUrl}/api/config`);
    assert.equal(resConfig.statusCode, 200);
    assert.equal(resConfig.json.success, true);
    assert.equal(resConfig.json.data.provider.active, 'mock');
    assert.ok(resConfig.json.data.palettes['endesga-32']);

    // B. GET /api/projects
    const resProj = await makeRequest(`${baseUrl}/api/projects`);
    assert.equal(resProj.statusCode, 200);
    assert.equal(resProj.json.success, true);
    assert.ok(resProj.json.data.some(p => p.id === 'proj_default'));
  });

  let createdAssetId = null;
  let firstVersionId = null;

  await t.test('3. Generation Job Lifecycle via Mock Provider', async () => {
    // A. Validation failure on invalid category
    const resInvalid = await makeRequest(`${baseUrl}/api/jobs`, { method: 'POST' }, {
      prompt: 'test potion',
      category: 'weapons_invalid'
    });
    assert.equal(resInvalid.statusCode, 400);
    assert.equal(resInvalid.json.success, false);
    assert.equal(resInvalid.json.error.code, 'ERR_INVALID_CATEGORY');

    // B. Submit valid generation job
    const resSubmit = await makeRequest(`${baseUrl}/api/jobs`, { method: 'POST' }, {
      projectId: 'proj_default',
      prompt: 'pixel art health potion bottle',
      category: 'items',
      paletteId: 'endesga-32',
      targetWidth: 32,
      targetHeight: 32,
      seed: 12345,
      skipPostProcessing: false
    });

    assert.equal(resSubmit.statusCode, 202);
    assert.equal(resSubmit.json.success, true);
    const jobId = resSubmit.json.data.jobId;
    assert.ok(jobId);

    // C. Poll job status until completed
    let completed = false;
    let attempts = 0;
    while (!completed && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      const resPoll = await makeRequest(`${baseUrl}/api/jobs/${jobId}`);
      assert.equal(resPoll.statusCode, 200);
      if (resPoll.json.data.status === 'completed') {
        completed = true;
        createdAssetId = resPoll.json.data.asset_id;
        firstVersionId = resPoll.json.data.created_version_id;
      }
      attempts++;
    }

    assert.equal(completed, true, 'Job must finish with completed status');
    assert.ok(createdAssetId);
    assert.ok(firstVersionId);
  });

  await t.test('4. Asset Detail, Version History & Binary Streaming', async () => {
    // A. GET /api/projects/proj_default/assets
    const resAssets = await makeRequest(`${baseUrl}/api/projects/proj_default/assets`);
    assert.equal(resAssets.statusCode, 200);
    const assetCard = resAssets.json.data.find(a => a.id === createdAssetId);
    assert.ok(assetCard);
    assert.equal(assetCard.current_version_id, firstVersionId);

    // B. GET /api/assets/:id
    const resDetail = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}`);
    assert.equal(resDetail.statusCode, 200);
    assert.equal(resDetail.json.data.id, createdAssetId);
    assert.equal(resDetail.json.data.versions.length, 1);
    assert.equal(resDetail.json.data.versions[0].id, firstVersionId);

    // C. Stream Raw PNG
    const resRaw = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}/versions/${firstVersionId}/raw`);
    assert.equal(resRaw.statusCode, 200);
    assert.equal(resRaw.headers['content-type'], 'image/png');
    assert.ok(resRaw.buffer.slice(0, 8).equals(PNG_HEADER), 'Raw output must have valid PNG magic bytes');

    // D. Stream Processed PNG
    const resProc = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}/versions/${firstVersionId}/processed`);
    assert.equal(resProc.statusCode, 200);
    assert.equal(resProc.headers['content-type'], 'image/png');
    assert.ok(resProc.buffer.slice(0, 8).equals(PNG_HEADER), 'Processed output must have valid PNG magic bytes');

    // E. Cross-asset version isolation
    const resWrongAsset = await makeRequest(`${baseUrl}/api/assets/ast_different_999/versions/${firstVersionId}/processed`);
    assert.equal(resWrongAsset.statusCode, 404);
  });

  let secondVersionId = null;

  await t.test('5. Non-Destructive Version Rollback', async () => {
    // A. Generate second version for same asset
    const resSubmit2 = await makeRequest(`${baseUrl}/api/jobs`, { method: 'POST' }, {
      projectId: 'proj_default',
      assetId: createdAssetId,
      prompt: 'pixel art health potion bottle with blue mana aura',
      paletteId: 'pico-8',
      targetWidth: 32,
      targetHeight: 32
    });
    assert.equal(resSubmit2.statusCode, 202);

    let completed = false;
    let attempts = 0;
    while (!completed && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      const resPoll = await makeRequest(`${baseUrl}/api/jobs/${resSubmit2.json.data.jobId}`);
      if (resPoll.json.data.status === 'completed') {
        completed = true;
        secondVersionId = resPoll.json.data.created_version_id;
      }
      attempts++;
    }
    assert.ok(secondVersionId);

    // Verify current_version_id moved to second version
    const resDetailBefore = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}`);
    assert.equal(resDetailBefore.json.data.current_version_id, secondVersionId);
    assert.equal(resDetailBefore.json.data.versions.length, 2);

    // B. Roll back active version to firstVersionId
    const resRollback = await makeRequest(
      `${baseUrl}/api/assets/${createdAssetId}/current-version`,
      { method: 'PUT' },
      { versionId: firstVersionId }
    );
    assert.equal(resRollback.statusCode, 200);
    assert.equal(resRollback.json.data.current_version_id, firstVersionId);

    // Verify database reflects rollback
    const resDetailAfter = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}`);
    assert.equal(resDetailAfter.json.data.current_version_id, firstVersionId);
    assert.equal(resDetailAfter.json.data.versions.length, 2, 'Both versions must remain preserved');
  });

  await t.test('6. Safe Asset Deletion Orchestration', async () => {
    // Delete asset
    const resDelete = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}`, { method: 'DELETE' });
    assert.equal(resDelete.statusCode, 200);
    assert.equal(resDelete.json.data.dbDeleted, true);
    assert.equal(resDelete.json.data.fsCleaned, true);

    // Verify DB record gone
    const resCheck = await makeRequest(`${baseUrl}/api/assets/${createdAssetId}`);
    assert.equal(resCheck.statusCode, 404);

    // Verify physical folder gone
    const physicalDir = path.join(storageConfig.generatedDir, createdAssetId);
    assert.equal(fs.existsSync(physicalDir), false);
  });
});
