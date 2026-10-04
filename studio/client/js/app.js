import { api } from './api-client.js';
import { CanvasViewport } from './canvas-viewport.js';
import { CompareSlider } from './compare-slider.js';
import { VersionTimeline } from './version-timeline.js';
import { AssetDetailsPanel } from './asset-details.js';
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
        const agentPrompt = `Please revise asset "${asset.name}" (${asset.category}): ${version.prompt}`;
        try {
          navigator.clipboard.writeText(agentPrompt);
          alert(`Revision prompt copied to clipboard!\n\nPaste this in your IDE / Terminal AI agent to create the revised version:\n\n"${agentPrompt}"`);
        } catch (_) {
          prompt('Copy this revision prompt for your AI agent:', agentPrompt);
        }
        this.switchTab('tabDetails');
      }
    });

    // 4. Initialize Asset Details Panel
    this.detailsPanel = new AssetDetailsPanel({
      containerEl: document.getElementById('tabDetails'),
      onRescan: async () => {
        await this.handleRescan();
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
          this.detailsPanel.setAsset(null);
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
    const btnToggleLib = document.getElementById('btnToggleLibrary');
    if (btnToggleLib) {
      btnToggleLib.addEventListener('click', () => {
        this.library.toggleCollapse();
      });
    }

    // Rescan Assets Button
    const btnRescan = document.getElementById('btnRescanAssets');
    if (btnRescan) {
      btnRescan.addEventListener('click', () => {
        this.handleRescan();
      });
    }

    // Delete Current Asset Button
    const btnDelete = document.getElementById('btnDeleteAsset');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (this.currentAsset) {
          this.library.requestDelete(this.currentAsset.id, this.currentAsset.name);
        }
      });
    }

    // View Mode Buttons
    const modeButtons = [
      { id: 'btnModeSplit', mode: 'split' },
      { id: 'btnModeProcessed', mode: 'processed' },
      { id: 'btnModeRaw', mode: 'raw' },
      { id: 'btnModeSideBySide', mode: 'side-by-side' }
    ];

    modeButtons.forEach(({ id, mode }) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          if (!this.slider.hasComparison && mode !== 'processed') {
            return;
          }
          modeButtons.forEach(b => {
            const el = document.getElementById(b.id);
            if (el) el.classList.remove('active');
          });
          btn.classList.add('active');
          this.slider.setMode(mode);
        });
      }
    });

    // Zoom Controls
    document.getElementById('btnZoomIn')?.addEventListener('click', () => this.viewport.zoomIn());
    document.getElementById('btnZoomOut')?.addEventListener('click', () => this.viewport.zoomOut());
    document.getElementById('btnZoom100')?.addEventListener('click', () => this.viewport.setZoom100());
    document.getElementById('btnZoomFit')?.addEventListener('click', () => this.viewport.fitToScreen());

    const btnGrid = document.getElementById('btnToggleGrid');
    if (btnGrid) {
      btnGrid.addEventListener('click', () => {
        const active = this.viewport.toggleGrid();
        btnGrid.classList.toggle('active', active);
      });
    }

    // Right Panel Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });
  }

  async handleRescan() {
    const btnRescan = document.getElementById('btnRescanAssets');
    const origHtml = btnRescan ? btnRescan.innerHTML : '';
    if (btnRescan) {
      btnRescan.disabled = true;
      btnRescan.innerHTML = `Scanning...`;
    }

    try {
      const scanRes = await api.scanAssets();
      await this.refreshLibrary();

      if (this.currentAsset) {
        await this.loadAsset(this.currentAsset.id);
      } else if (this.library.assets.length > 0) {
        const firstId = this.library.assets[0].id;
        this.library.selectAsset(firstId);
        await this.loadAsset(firstId);
      }
    } catch (err) {
      alert(`Asset scan failed: ${err.message}`);
    } finally {
      if (btnRescan) {
        btnRescan.disabled = false;
        btnRescan.innerHTML = origHtml;
      }
    }
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
      const badge = document.getElementById('workflowBadge');
      if (badge) {
        badge.textContent = 'AI Agent Mode';
        badge.title = 'External AI Coding Agent generates assets; Studio inspects and manages them.';
      }
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

      this.detailsPanel.setAsset(asset, targetVersion);

      if (targetVersion) {
        this.currentVersion = targetVersion;
        const width = targetVersion.target_width || 32;
        const height = targetVersion.target_height || 32;

        this.viewport.setDimensions(width, height);
        const hasComparison = await this.slider.loadImages(targetVersion.raw_url, targetVersion.processed_url, width, height);

        // Update mode button states based on whether comparison image exists
        const btnSplit = document.getElementById('btnModeSplit');
        const btnRaw = document.getElementById('btnModeRaw');
        const btnSide = document.getElementById('btnModeSideBySide');
        const btnProc = document.getElementById('btnModeProcessed');

        if (!hasComparison) {
          if (btnSplit) { btnSplit.classList.remove('active'); btnSplit.style.opacity = '0.4'; btnSplit.title = 'Single image: No Before/After pair recorded'; }
          if (btnRaw) { btnRaw.classList.remove('active'); btnRaw.style.opacity = '0.4'; }
          if (btnSide) { btnSide.classList.remove('active'); btnSide.style.opacity = '0.4'; }
          if (btnProc) { btnProc.classList.add('active'); }
        } else {
          if (btnSplit) { btnSplit.classList.add('active'); btnSplit.style.opacity = '1'; btnSplit.title = 'Before/After Split Comparison'; }
          if (btnRaw) { btnRaw.style.opacity = '1'; }
          if (btnSide) { btnSide.style.opacity = '1'; }
          if (btnProc) { btnProc.classList.remove('active'); }
        }

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
