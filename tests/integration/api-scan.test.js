import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { initDatabase } from '../../studio/server/db/database.js';
import { StorageManager } from '../../studio/server/storage/storage-manager.js';
import { startStudioServer, stopStudioServer } from '../../studio/server/index.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';

function makeRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Connection': 'close',
        ...(options.headers || {})
      }
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

function createDummyPng(width, height) {
  const rgba = Buffer.alloc(width * height * 4, 200);
  return encodePng(width, height, rgba);
}

test('External AI Agent Integration & Scan API Suite', async (t) => {
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_scan_api_test_'));
  const generatedDir = path.join(tempBaseDir, 'generated');
  const projectsDir = path.join(tempBaseDir, 'projects');
  const exportsDir = path.join(tempBaseDir, 'exports');
  const referencesDir = path.join(tempBaseDir, 'references');
  const stagingDir = path.join(tempBaseDir, 'staging');
  const quarantineDir = path.join(tempBaseDir, 'quarantine');

  const storageConfig = {
    baseDir: tempBaseDir,
    generatedDir,
    projectsDir,
    exportsDir,
    referencesDir,
    stagingDir,
    quarantineDir,
    dbPath: ':memory:'
  };

  const storageManager = new StorageManager(storageConfig);
  storageManager.ensureDirectories();

  const db = initDatabase(storageConfig.dbPath);

  const testConfig = {
    server: { port: 0, host: '127.0.0.1' },
    storage: storageConfig,
    provider: { falAvailable: false }
  };

  const serverInfo = await startStudioServer({
    db,
    jobQueue: null,
    storageManager,
    config: testConfig
  });

  const serverUrl = serverInfo.url;

  t.after(async () => {
    await stopStudioServer(serverInfo.server, null, db, 1000);
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('POST /api/scan discovers agent generated asset and exposes it to Studio endpoints', async () => {
    // 1. Simulate external agent creating asset files on disk
    const slug = 'hero-knight';
    const v1Dir = path.join(storageConfig.generatedDir, slug, 'v1');
    fs.mkdirSync(v1Dir, { recursive: true });

    const png = createDummyPng(32, 32);
    fs.writeFileSync(path.join(v1Dir, 'processed.png'), png);
    fs.writeFileSync(path.join(v1Dir, 'metadata.json'), JSON.stringify({
      name: 'Hero Knight Sprite',
      category: 'characters',
      version_number: 1,
      prompt: 'Pixel art knight with steel armor and broadsword',
      palette_id: 'endesga-32',
      source_tool: 'ai-agent',
      created_at: 1727920000
    }));

    // 2. Call POST /api/scan
    const scanRes = await makeRequest(`${serverUrl}/api/scan`, { method: 'POST' });
    assert.equal(scanRes.statusCode, 200);
    assert.equal(scanRes.json.success, true);
    assert.equal(scanRes.json.data.scannedAssets, 1);
    assert.equal(scanRes.json.data.addedAssets, 1);
    assert.equal(scanRes.json.data.addedVersions, 1);

    // 3. Verify asset appears in project assets list
    const listRes = await makeRequest(`${serverUrl}/api/projects/proj_default/assets`);
    assert.equal(listRes.statusCode, 200);
    const assets = listRes.json.data;
    assert.equal(assets.length, 1);
    assert.equal(assets[0].id, slug);
    assert.equal(assets[0].name, 'Hero Knight Sprite');
    assert.equal(assets[0].category, 'characters');
    assert.ok(assets[0].current_version);
    assert.equal(assets[0].current_version.target_width, 32);

    // 4. Verify asset details endpoint
    const detailRes = await makeRequest(`${serverUrl}/api/assets/${slug}`);
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.json.data;
    assert.equal(detail.name, 'Hero Knight Sprite');
    assert.equal(detail.versions.length, 1);
    assert.equal(detail.versions[0].prompt, 'Pixel art knight with steel armor and broadsword');
    assert.equal(detail.versions[0].provider_id, 'ai-agent');

    // 5. Stream image via endpoint
    const streamRes = await makeRequest(`${serverUrl}${detail.versions[0].processed_url}`);
    assert.equal(streamRes.statusCode, 200);
    assert.equal(streamRes.headers['content-type'], 'image/png');
    assert.equal(streamRes.buffer.length, png.length);
    assert.deepEqual(streamRes.buffer.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  });

  await t.test('GET /api/scan also returns scan summary safely', async () => {
    const res = await makeRequest(`${serverUrl}/api/scan`, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.success, true);
    assert.ok(typeof res.json.data.scannedAssets === 'number');
  });
});
