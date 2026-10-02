export function registerAssetRoutes(router, db, deletionOrchestrator) {
  // 1. Get Asset Details with Full Version History
  router.get('/api/assets/:assetId', async (req, res) => {
    const { assetId } = req.params;

    const asset = db.prepare(`
      SELECT id, project_id, name, category, current_version_id, created_at, updated_at
      FROM assets 
      WHERE id = ?
    `).get(assetId);

    if (!asset) {
      return router.sendError(res, 404, 'ERR_ASSET_NOT_FOUND', `Asset not found: ${assetId}`);
    }

    const versions = db.prepare(`
      SELECT 
        id, 
        asset_id, 
        version_number, 
        parent_version_id, 
        prompt, 
        negative_prompt, 
        provider_id, 
        seed, 
        palette_id, 
        target_width, 
        target_height, 
        processing_config_json, 
        integrity_status, 
        notes, 
        created_at
      FROM asset_versions 
      WHERE asset_id = ? 
      ORDER BY version_number DESC
    `).all(assetId);

    // Map versions into sanitized public records (zero local file paths leaked)
    const sanitizedVersions = versions.map(v => {
      let processingConfig = {};
      try {
        processingConfig = JSON.parse(v.processing_config_json || '{}');
      } catch (_) {}

      return {
        id: v.id,
        version_number: v.version_number,
        parent_version_id: v.parent_version_id,
        prompt: v.prompt,
        negative_prompt: v.negative_prompt,
        provider_id: v.provider_id,
        seed: v.seed,
        palette_id: v.palette_id,
        target_width: v.target_width,
        target_height: v.target_height,
        raw_url: `/api/assets/${asset.id}/versions/${v.id}/raw`,
        processed_url: `/api/assets/${asset.id}/versions/${v.id}/processed`,
        processing_config: processingConfig,
        integrity_status: v.integrity_status,
        notes: v.notes,
        created_at: v.created_at
      };
    });

    router.sendJson(res, 200, {
      id: asset.id,
      project_id: asset.project_id,
      name: asset.name,
      category: asset.category,
      current_version_id: asset.current_version_id,
      versions: sanitizedVersions,
      created_at: asset.created_at,
      updated_at: asset.updated_at
    });
  });

  // 2. Set / Rollback Active Version
  router.put('/api/assets/:assetId/current-version', async (req, res) => {
    const { assetId } = req.params;
    const body = await router.readJson(req);

    const versionId = body.versionId;
    if (!versionId || typeof versionId !== 'string') {
      return router.sendError(res, 400, 'ERR_INVALID_VERSION_ID', 'Missing or invalid versionId in request body.');
    }

    // Check asset exists
    const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    if (!asset) {
      return router.sendError(res, 404, 'ERR_ASSET_NOT_FOUND', `Asset not found: ${assetId}`);
    }

    // Verify version exists and belongs to this asset
    const version = db.prepare('SELECT id FROM asset_versions WHERE id = ? AND asset_id = ?').get(versionId, assetId);
    if (!version) {
      return router.sendError(res, 400, 'ERR_INVALID_VERSION_RELATION', `Version ${versionId} does not belong to asset ${assetId}.`);
    }

    // Update active version
    db.prepare(`
      UPDATE assets 
      SET current_version_id = ?, updated_at = unixepoch() 
      WHERE id = ?
    `).run(versionId, assetId);

    router.sendJson(res, 200, {
      assetId,
      current_version_id: versionId
    });
  });

  // 3. Failure-Safe Asset Deletion
  router.delete('/api/assets/:assetId', async (req, res) => {
    const { assetId } = req.params;

    try {
      const result = await deletionOrchestrator.deleteAssetWithStorage(assetId);
      router.sendJson(res, 200, result);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'ERR_DELETION_FAILED';
      router.sendError(res, statusCode, code, err.message);
    }
  });
}
