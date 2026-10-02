import fs from 'node:fs';
import path from 'node:path';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function registerStreamRoutes(router, db, storageConfig) {
  async function serveImage(req, res, assetId, versionId, type) {
    // 1. Verify existence in SQLite and ensure version belongs to assetId
    const row = db.prepare(`
      SELECT id, asset_id, raw_file_path, processed_file_path 
      FROM asset_versions 
      WHERE id = ? AND asset_id = ?
    `).get(versionId, assetId);

    if (!row) {
      return router.sendError(res, 404, 'ERR_VERSION_NOT_FOUND', `Version ${versionId} for asset ${assetId} not found.`);
    }

    const targetFilePath = type === 'raw' ? row.raw_file_path : row.processed_file_path;
    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      return router.sendError(res, 404, 'ERR_IMAGE_FILE_NOT_FOUND', `Image file missing on disk.`);
    }

    // 2. Canonical path containment verification
    try {
      const canonicalRoot = fs.realpathSync.native(storageConfig.generatedDir);
      const canonicalFile = fs.realpathSync.native(targetFilePath);

      const rel = path.relative(canonicalRoot, canonicalFile);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return router.sendError(res, 403, 'ERR_SECURITY_VIOLATION', 'Access outside allowed storage boundary.');
      }

      const stat = fs.statSync(canonicalFile);
      if (!stat.isFile()) {
        return router.sendError(res, 400, 'ERR_NOT_A_FILE', 'Requested resource is not a file.');
      }

      // 3. Lightweight 8-byte PNG magic header check without loading whole file
      const fd = fs.openSync(canonicalFile, 'r');
      const headerBuf = Buffer.alloc(8);
      fs.readSync(fd, headerBuf, 0, 8, 0);
      fs.closeSync(fd);

      if (!headerBuf.equals(PNG_HEADER)) {
        return router.sendError(res, 500, 'ERR_CORRUPT_PNG', 'File is not a valid PNG.');
      }

      // 4. Conditional ETag handling (304 Not Modified)
      const etag = `W/"${versionId}_${type}_${Math.floor(stat.mtimeMs)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        return res.end();
      }

      // 5. Stream response
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', etag);

      const stream = fs.createReadStream(canonicalFile);
      stream.pipe(res);
      stream.on('error', (err) => {
        if (!res.headersSent) {
          router.sendError(res, 500, 'ERR_STREAM_FAILED', err.message);
        }
      });
    } catch (fsErr) {
      return router.sendError(res, 403, 'ERR_FILE_ACCESS_DENIED', `File access error: ${fsErr.message}`);
    }
  }

  router.get('/api/assets/:assetId/versions/:versionId/raw', async (req, res) => {
    await serveImage(req, res, req.params.assetId, req.params.versionId, 'raw');
  });

  router.get('/api/assets/:assetId/versions/:versionId/processed', async (req, res) => {
    await serveImage(req, res, req.params.assetId, req.params.versionId, 'processed');
  });
}
