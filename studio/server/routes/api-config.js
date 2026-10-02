import { PALETTES } from '../post-processing/quantizer.js';

export function registerConfigRoutes(router, config) {
  router.get('/api/config', async (req, res) => {
    const falAvailable = Boolean(config.providers.falKey && config.providers.falKey.length > 0);
    const activeProvider = falAvailable ? (config.providers.default || 'mock') : 'mock';

    router.sendJson(res, 200, {
      provider: {
        active: activeProvider,
        falAvailable
      },
      defaults: {
        palette: config.defaults?.palette || 'endesga-32',
        targetWidth: config.defaults?.targetWidth || 32,
        targetHeight: config.defaults?.targetHeight || 32
      },
      palettes: PALETTES,
      resolutions: [16, 24, 32, 48, 64],
      categories: ['characters', 'items', 'environment', 'vfx', 'ui']
    });
  });
}
