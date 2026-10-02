import { PALETTES } from '../post-processing/quantizer.js';

const ALLOWED_CATEGORIES = new Set(['characters', 'items', 'environment', 'vfx', 'ui']);
const ALLOWED_RESOLUTIONS = new Set([16, 24, 32, 48, 64]);

export function registerJobRoutes(router, db, jobQueue, config) {
  // 1. Submit Generation Job with Validation Adapter
  router.post('/api/jobs', async (req, res) => {
    const body = await router.readJson(req);

    // --- Validation Adapter ---
    // A. Project
    const projectId = body.projectId || 'proj_default';
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return router.sendError(res, 404, 'ERR_PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    }

    // B. Asset (if revising / iterating on existing asset)
    let assetId = body.assetId || null;
    if (assetId) {
      const asset = db.prepare('SELECT id, project_id FROM assets WHERE id = ?').get(assetId);
      if (!asset) {
        return router.sendError(res, 404, 'ERR_ASSET_NOT_FOUND', `Asset not found: ${assetId}`);
      }
      if (asset.project_id !== projectId) {
        return router.sendError(res, 409, 'ERR_ASSET_PROJECT_MISMATCH', `Asset ${assetId} does not belong to project ${projectId}.`);
      }
    }

    // C. Prompt
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 500) {
      return router.sendError(res, 400, 'ERR_INVALID_PROMPT', 'Prompt must be a non-empty string with maximum 500 characters.');
    }

    // D. Category
    const category = body.category || 'items';
    if (!ALLOWED_CATEGORIES.has(category)) {
      return router.sendError(res, 400, 'ERR_INVALID_CATEGORY', `Category must be one of: ${[...ALLOWED_CATEGORIES].join(', ')}`);
    }

    // E. Provider
    const providerId = body.providerId || config.providers?.default || 'mock';
    if (providerId !== 'mock' && providerId !== 'fal-ai') {
      return router.sendError(res, 400, 'ERR_INVALID_PROVIDER', `Provider must be 'mock' or 'fal-ai', received: ${providerId}`);
    }
    if (providerId === 'fal-ai' && (!config.providers.falKey || config.providers.falKey.length === 0)) {
      return router.sendError(res, 400, 'ERR_PROVIDER_UNAVAILABLE', 'Fal.ai provider is not configured with an API key on this server.');
    }

    // F. Palette
    const paletteId = body.paletteId || body.palette || config.defaults?.palette || 'endesga-32';
    if (!PALETTES[paletteId]) {
      return router.sendError(res, 400, 'ERR_INVALID_PALETTE', `Unknown palette '${paletteId}'. Allowed: ${Object.keys(PALETTES).join(', ')}`);
    }

    // G. Resolutions
    const targetWidth = Number(body.targetWidth || 32);
    const targetHeight = Number(body.targetHeight || 32);
    if (!ALLOWED_RESOLUTIONS.has(targetWidth) || !ALLOWED_RESOLUTIONS.has(targetHeight)) {
      return router.sendError(res, 400, 'ERR_INVALID_RESOLUTION', `Target resolution must be in [${[...ALLOWED_RESOLUTIONS].join(', ')}], received: ${targetWidth}x${targetHeight}`);
    }

    // H. Seed
    let seed = null;
    if (body.seed !== undefined && body.seed !== null && body.seed !== '') {
      const parsedSeed = Number(body.seed);
      if (!Number.isInteger(parsedSeed) || parsedSeed < 0 || parsedSeed > 2147483647) {
        return router.sendError(res, 400, 'ERR_INVALID_SEED', 'Seed must be a non-negative integer between 0 and 2147483647.');
      }
      seed = parsedSeed;
    }

    // I. skipPostProcessing
    if (body.skipPostProcessing !== undefined && typeof body.skipPostProcessing !== 'boolean') {
      return router.sendError(res, 400, 'ERR_INVALID_SKIP_POST_PROCESSING', 'skipPostProcessing must be a boolean value.');
    }
    const skipPostProcessing = Boolean(body.skipPostProcessing);

    // Build normalized JobQueue request payload
    const requestPayload = {
      projectId,
      assetId,
      name: body.name ? String(body.name).trim().slice(0, 50) : prompt.slice(0, 30),
      category,
      prompt,
      negative_prompt: body.negativePrompt ? String(body.negativePrompt).trim() : null,
      negativePrompt: body.negativePrompt ? String(body.negativePrompt).trim() : null,
      palette: paletteId,
      palette_id: paletteId,
      targetWidth,
      targetHeight,
      seed,
      skipPostProcessing
    };

    try {
      const job = await jobQueue.enqueue({
        assetId,
        providerId,
        requestPayload
      });

      router.sendJson(res, 202, {
        jobId: job.id,
        status: job.status,
        stage: job.stage
      });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'ERR_ENQUEUE_FAILED';
      router.sendError(res, statusCode, code, err.message);
    }
  });

  // 2. Poll Job Status
  router.get('/api/jobs/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = jobQueue.getJob(jobId);

    if (!job) {
      return router.sendError(res, 404, 'ERR_JOB_NOT_FOUND', `Job not found: ${jobId}`);
    }

    router.sendJson(res, 200, {
      id: job.id,
      status: job.status,
      stage: job.stage,
      asset_id: job.asset_id,
      created_version_id: job.created_version_id,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at
    });
  });

  // 3. List Recent Jobs
  router.get('/api/jobs', async (req, res) => {
    const jobs = db.prepare(`
      SELECT id, asset_id, created_version_id, provider_id, status, stage, error_message, created_at, updated_at
      FROM jobs 
      ORDER BY created_at DESC 
      LIMIT 20
    `).all();

    router.sendJson(res, 200, jobs);
  });
}
