export function registerProjectRoutes(router, db) {
  // 1. List Projects
  router.get('/api/projects', async (req, res) => {
    const projects = db.prepare(`
      SELECT id, name, description, default_palette, created_at, updated_at
      FROM projects 
      ORDER BY created_at ASC
    `).all();

    router.sendJson(res, 200, projects);
  });

  // 2. List Assets in Project
  router.get('/api/projects/:projectId/assets', async (req, res) => {
    const { projectId } = req.params;

    // Verify project exists
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return router.sendError(res, 404, 'ERR_PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    }

    const assets = db.prepare(`
      SELECT 
        a.id, 
        a.project_id, 
        a.name, 
        a.category, 
        a.current_version_id, 
        a.created_at, 
        a.updated_at,
        v.version_number AS current_version_number,
        v.prompt AS current_prompt,
        v.target_width AS current_width,
        v.target_height AS current_height,
        v.palette_id AS current_palette_id,
        v.created_at AS current_version_created_at,
        (SELECT COUNT(*) FROM asset_versions WHERE asset_id = a.id) AS version_count
      FROM assets a
      LEFT JOIN asset_versions v ON v.id = a.current_version_id
      WHERE a.project_id = ?
      ORDER BY a.updated_at DESC
    `).all(projectId);

    // Format response without exposing physical file paths
    const formatted = assets.map(row => {
      let currentVersion = null;
      if (row.current_version_id) {
        currentVersion = {
          id: row.current_version_id,
          version_number: row.current_version_number,
          prompt: row.current_prompt,
          target_width: row.current_width,
          target_height: row.current_height,
          palette_id: row.current_palette_id,
          raw_url: `/api/assets/${row.id}/versions/${row.current_version_id}/raw`,
          processed_url: `/api/assets/${row.id}/versions/${row.current_version_id}/processed`,
          created_at: row.current_version_created_at
        };
      }

      return {
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        category: row.category,
        current_version_id: row.current_version_id,
        current_version: currentVersion,
        version_count: row.version_count || 0,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });

    router.sendJson(res, 200, formatted);
  });
}
