import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from './routes/router.js';
import { registerConfigRoutes } from './routes/api-config.js';
import { registerProjectRoutes } from './routes/api-projects.js';
import { registerAssetRoutes } from './routes/api-assets.js';
import { registerJobRoutes } from './routes/api-jobs.js';
import { registerStreamRoutes } from './routes/api-stream.js';
import { AssetDeletionOrchestrator } from './storage/asset-deletion-orchestrator.js';
import { AssetCoordinator } from './queue/asset-coordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export function createStudioApp({ db, jobQueue, storageManager, config, assetCoordinator = null }) {
  const coordinator = assetCoordinator || new AssetCoordinator(db);
  const deletionOrchestrator = new AssetDeletionOrchestrator(db, storageManager, coordinator);
  
  // Link coordinator to jobQueue if not already linked
  if (jobQueue && !jobQueue.assetCoordinator) {
    jobQueue.assetCoordinator = coordinator;
  }

  const router = new Router(config);

  // Register API Endpoints
  registerConfigRoutes(router, config);
  registerProjectRoutes(router, db);
  registerAssetRoutes(router, db, deletionOrchestrator);
  registerJobRoutes(router, db, jobQueue, config);
  registerStreamRoutes(router, db, storageManager.config);

  // Main HTTP Request Listener
  async function requestListener(req, res) {
    try {
      // 1. Try API Router
      const handled = await router.handle(req, res);
      if (handled) return;

      // 2. Fallback to Static File Server for studio/client
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return router.sendError(res, 405, 'ERR_METHOD_NOT_ALLOWED', `Method ${req.method} not allowed.`);
      }

      let reqPath = req.url.split('?')[0];
      if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
      }

      // Sanitize and decode URL
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(reqPath);
      } catch (_) {
        return router.sendError(res, 400, 'ERR_MALFORMED_URI', 'Malformed URI.');
      }

      if (decodedPath.includes('\0') || decodedPath.includes('..')) {
        return router.sendError(res, 403, 'ERR_SECURITY_VIOLATION', 'Path traversal attempt blocked.');
      }

      const filePath = path.join(CLIENT_DIR, decodedPath);
      const canonicalClient = fs.realpathSync.native(CLIENT_DIR);

      if (!fs.existsSync(filePath)) {
        return router.sendError(res, 404, 'ERR_STATIC_NOT_FOUND', `File not found: ${decodedPath}`);
      }

      const canonicalFile = fs.realpathSync.native(filePath);
      const rel = path.relative(canonicalClient, canonicalFile);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return router.sendError(res, 403, 'ERR_SECURITY_VIOLATION', 'Access outside static directory denied.');
      }

      const stat = fs.statSync(canonicalFile);
      if (!stat.isFile()) {
        return router.sendError(res, 400, 'ERR_NOT_A_FILE', 'Requested resource is not a file.');
      }

      const ext = path.extname(canonicalFile).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';

      res.statusCode = 200;
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-cache');

      if (req.method === 'HEAD') {
        return res.end();
      }

      const stream = fs.createReadStream(canonicalFile);
      stream.pipe(res);
      stream.on('error', (err) => {
        if (!res.headersSent) {
          router.sendError(res, 500, 'ERR_STATIC_STREAM', err.message);
        }
      });
    } catch (unhandledErr) {
      if (!res.headersSent) {
        router.sendError(res, 500, 'ERR_UNHANDLED_EXCEPTION', unhandledErr.message);
      }
    }
  }

  return { requestListener, router, deletionOrchestrator, coordinator };
}

export function startStudioServer({ db, jobQueue, storageManager, config, port = null, host = null }) {
  const serverPort = port || config.server?.port || 5178;
  const serverHost = host || config.server?.host || '127.0.0.1';

  const { requestListener, router, deletionOrchestrator, coordinator } = createStudioApp({
    db,
    jobQueue,
    storageManager,
    config
  });

  const server = http.createServer(requestListener);

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n[FATAL] Port ${serverPort} is already in use by another process.`);
        console.error(`Please terminate the conflicting process or specify a different port:`);
        console.error(`  PowerShell: $env:PORT="5179"; npm run dev`);
      }
      reject(err);
    });

    server.listen(serverPort, serverHost, () => {
      resolve({
        server,
        port: server.address().port,
        host: serverHost,
        url: `http://${serverHost}:${server.address().port}`,
        router,
        deletionOrchestrator,
        coordinator
      });
    });
  });
}

export async function stopStudioServer(serverInstance, jobQueue = null, db = null, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!serverInstance) return resolve();

    // 1. Stop taking new connections
    serverInstance.close(async () => {
      // 2. Drain worker if active
      if (jobQueue) {
        jobQueue.drain();
        await jobQueue.waitForIdle(timeoutMs);
      }

      // 3. Checkpoint WAL and close SQLite connection
      if (db) {
        try {
          db.exec('PRAGMA wal_checkpoint(PASSIVE);');
          db.close();
        } catch (_) {}
      }

      resolve();
    });
  });
}
