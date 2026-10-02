import { api } from './api-client.js';
import { CanvasViewport } from './canvas-viewport.js';
import { CompareSlider } from './compare-slider.js';
import { VersionTimeline } from './version-timeline.js';
import { GenerationForm } from './generation-form.js';
import { AssetLibrary } from './asset-library.js';

class StudioApp {
  constructor() {
    this.currentAsset = null;
    this.currentVersion = null;
  }

  async init() {
    // 1. Initialize Viewport
    this.viewport = new CanvasViewport({
      containerEl: document.getElementById('canvasContainer'),
      wrapperEl: document.getElementById('viewportWrapper'),
      checkerCanvas: document.getElementById('checkerboardCanvas'),
      gridCanvas: document.getElementById('gridCanvas'),
      zoomIndicatorEl: document.getElementById('zoomLevel'),
      hudCoordsEl: document.getElementById('hudCoords'),
      hudDimensionsEl: document.getElementById('hudDimensions')
    });

    // 2. Initialize Comparison Slider
    this.slider = new CompareSlider({
      rawCanvas: document.getElementById('rawCanvas'),
      processedCanvas: document.getElementById('processedCanvas'),
      splitClipWrapper: document.getElementById('splitClipWrapper'),
      splitHandle: document.getElementById('splitHandle'),
      viewportWrapper: document.getElementById('viewportWrapper')
    });

    // 3. Initialize Version Timeline
    this.timeline = new VersionTimeline({
      containerEl: document.getElementById('versionTimelineList'),
      countBadgeEl: document.getElementById('versionCountBadge'),
      nameTitleEl: document.getElementById('currentAssetNameTitle'),
      categoryTitleEl: document.getElementById('currentAssetCategoryTitle'),
      onActivateVersion: async (assetId, versionId) => {
        try {
          await api.setActiveVersion(assetId, versionId);
          await this.loadAsset(assetId, versionId);
          await this.refreshLibrary();
        } catch (err) {
          alert(`Failed to activate version: ${err.message}`);
        }
      },
      onForkVersion: (asset, version) => {
        this.form.setFormValues({
          prompt: version.prompt,
          negativePrompt: version.negative_prompt,
          category: asset.category,
          resolution: version.target_width,
          palette: version.palette_id,
          seed: version.seed,
          assetId: asset.id
        });
        this.switchTab('tabGenerate');
      }
    });

    // 4. Initialize Generation Form
    this.form = new GenerationForm({
      formEl: document.getElementById('generationForm'),
      promptInput: document.getElementById('promptInput'),
      negativePromptInput: document.getElementById('negativePromptInput'),
      categorySelect: document.getElementById('categorySelect'),
      resolutionSelect: document.getElementById('resolutionSelect'),
      paletteSelect: document.getElementById('paletteSelect'),
      paletteSwatchesEl: document.getElementById('palettePreviewSwatches'),
      seedInput: document.getElementById('seedInput'),
      btnRandomSeed: document.getElementById('btnRandomSeed'),
      skipPostProcessingCheck: document.getElementById('skipPostProcessingCheck'),
      progressHudEl: document.getElementById('jobProgressHud'),
      progressTitleEl: document.getElementById('jobStageTitle'),
      progressSubtitleEl: document.getElementById('jobStageSubtitle'),
      progressFillEl: document.getElementById('jobProgressFill'),
      apiClient: api,
      onJobCompleted: async (assetId, versionId) => {
        await this.refreshLibrary();
        await this.loadAsset(assetId, versionId);
      }
    });

    // 5. Initialize Asset Library
    this.library = new AssetLibrary({
      panelEl: document.getElementById('libraryPanel'),
      gridEl: document.getElementById('assetGrid'),
      filterChipsContainer: document.getElementById('categoryFilters'),
      confirmModal: document.getElementById('confirmModal'),
      modalTitleEl: document.getElementById('modalTitle'),
      modalMessageEl: document.getElementById('modalMessage'),
      btnModalConfirm: document.getElementById('modalConfirm'),
      btnModalCancel: document.getElementById('modalCancel'),
      apiClient: api,
      onSelectAsset: (assetId) => {
        this.loadAsset(assetId);
      },
      onAssetDeleted: async (deletedId) => {
        if (this.currentAsset?.id === deletedId) {
          this.currentAsset = null;
          this.currentVersion = null;
          this.timeline.setAsset(null);
        }
        await this.refreshLibrary();
      }
    });

    // 6. Bind Global Header & Toolbar Controls
    this.initToolbarControls();

    // 7. Load Initial Studio Configuration & Assets
    await this.loadConfig();
    await this.refreshLibrary();

    // Select first asset if available
    if (this.library.assets.length > 0) {
      const firstId = this.library.assets[0].id;
      this.library.selectAsset(firstId);
      await this.loadAsset(firstId);
    }
  }

  initToolbarControls() {
    // Library Panel Toggle
    document.getElementById('btnToggleLibrary').addEventListener('click', () => {
      this.library.toggleCollapse();
    });

    // New Asset Button
    document.getElementById('btnNewAsset').addEventListener('click', () => {
      this.form.setFormValues({
        prompt: '',
        negativePrompt: '',
        category: 'items',
        resolution: 32,
        palette: 'endesga-32',
        seed: null,
        assetId: null
      });
      this.switchTab('tabGenerate');
      document.getElementById('promptInput').focus();
    });

    // Delete Current Asset Button
    document.getElementById('btnDeleteAsset').addEventListener('click', () => {
      if (this.currentAsset) {
        this.library.requestDelete(this.currentAsset.id, this.currentAsset.name);
      }
    });

    // View Mode Buttons
    const modeButtons = [
      { id: 'btnModeSplit', mode: 'split' },
      { id: 'btnModeProcessed', mode: 'processed' },
      { id: 'btnModeRaw', mode: 'raw' },
      { id: 'btnModeSideBySide', mode: 'side-by-side' }
    ];

    modeButtons.forEach(({ id, mode }) => {
      const btn = document.getElementById(id);
      btn.addEventListener('click', () => {
        modeButtons.forEach(b => document.getElementById(b.id).classList.remove('active'));
        btn.classList.add('active');
        this.slider.setMode(mode);
      });
    });

    // Zoom Controls
    document.getElementById('btnZoomIn').addEventListener('click', () => this.viewport.zoomIn());
    document.getElementById('btnZoomOut').addEventListener('click', () => this.viewport.zoomOut());
    document.getElementById('btnZoom100').addEventListener('click', () => this.viewport.setZoom100());
    document.getElementById('btnZoomFit').addEventListener('click', () => this.viewport.fitToScreen());

    const btnGrid = document.getElementById('btnToggleGrid');
    btnGrid.addEventListener('click', () => {
      const active = this.viewport.toggleGrid();
      btnGrid.classList.toggle('active', active);
    });

    // Right Workbench Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const activeContent = document.getElementById(tabId);
    if (activeBtn) activeBtn.classList.add('active');
    if (activeContent) activeContent.classList.add('active');
  }

  async loadConfig() {
    try {
      const configData = await api.getConfig();
      const badge = document.getElementById('providerBadge');
      if (configData.provider?.falAvailable) {
        badge.textContent = 'Fal.ai Cloud';
        badge.style.borderColor = 'rgba(168, 85, 247, 0.4)';
        badge.style.color = '#a855f7';
        badge.style.backgroundColor = 'rgba(168, 85, 247, 0.1)';
      } else {
        badge.textContent = 'Mock [Offline]';
      }

      this.form.setPalettes(configData.palettes);
    } catch (e) {
      console.warn('Failed to load studio configuration:', e.message);
    }
  }

  async refreshLibrary() {
    try {
      const assets = await api.getProjectAssets('proj_default');
      this.library.setAssets(assets);
    } catch (e) {
      console.warn('Failed to refresh asset library:', e.message);
    }
  }

  async loadAsset(assetId, specificVersionId = null) {
    try {
      const asset = await api.getAsset(assetId);
      this.currentAsset = asset;
      this.timeline.setAsset(asset);

      const targetVersionId = specificVersionId || asset.current_version_id;
      const targetVersion = asset.versions?.find(v => v.id === targetVersionId) || asset.versions?.[0];

      if (targetVersion) {
        this.currentVersion = targetVersion;
        const width = targetVersion.target_width || 32;
        const height = targetVersion.target_height || 32;

        this.viewport.setDimensions(width, height);
        await this.slider.loadImages(targetVersion.raw_url, targetVersion.processed_url, width, height);

        // Update HUD
        const hudVersion = document.getElementById('hudVersion');
        if (hudVersion) {
          hudVersion.textContent = `v${targetVersion.version_number} ${targetVersion.id === asset.current_version_id ? '(Active)' : ''}`;
        }
      }
    } catch (e) {
      console.error('Failed to load asset details:', e.message);
    }
  }
}

// Bootstrap on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  const app = new StudioApp();
  app.init().catch(err => {
    console.error('Studio initialization error:', err);
  });
});
