/**
 * AssetLibrary manages the project asset grid, category filtering,
 * and safe deletion modal orchestration.
 */
export class AssetLibrary {
  constructor({
    panelEl,
    gridEl,
    filterChipsContainer,
    confirmModal,
    modalTitleEl,
    modalMessageEl,
    btnModalConfirm,
    btnModalCancel,
    apiClient,
    onSelectAsset,
    onAssetDeleted
  }) {
    this.panel = panelEl;
    this.grid = gridEl;
    this.filterContainer = filterChipsContainer;
    this.modal = confirmModal;
    this.modalTitle = modalTitleEl;
    this.modalMessage = modalMessageEl;
    this.btnConfirm = btnModalConfirm;
    this.btnCancel = btnModalCancel;

    this.api = apiClient;
    this.onSelect = onSelectAsset;
    this.onDeleted = onAssetDeleted;

    this.assets = [];
    this.activeCategory = 'all';
    this.selectedAssetId = null;
    this.assetPendingDelete = null;

    this.initEvents();
  }

  initEvents() {
    // Category filter chips
    this.filterContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.filterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeCategory = chip.dataset.category || 'all';
        this.render();
      });
    });

    // Delete modal cancel
    this.btnCancel.addEventListener('click', () => {
      this.modal.close();
      this.assetPendingDelete = null;
    });

    // Delete modal confirm
    this.btnConfirm.addEventListener('click', async () => {
      if (!this.assetPendingDelete) return;
      const assetId = this.assetPendingDelete;
      this.modal.close();
      this.assetPendingDelete = null;

      try {
        await this.api.deleteAsset(assetId);
        if (this.onDeleted) {
          this.onDeleted(assetId);
        }
      } catch (err) {
        alert(`Deletion Error: ${err.message}`);
      }
    });
  }

  toggleCollapse() {
    this.panel.classList.toggle('collapsed');
  }

  setAssets(assets) {
    this.assets = assets || [];
    this.render();
  }

  selectAsset(assetId) {
    this.selectedAssetId = assetId;
    this.grid.querySelectorAll('.asset-card').forEach(card => {
      if (card.dataset.id === assetId) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  requestDelete(assetId, assetName = '') {
    this.assetPendingDelete = assetId;
    this.modalTitle.textContent = 'Delete Asset';
    this.modalMessage.textContent = `Are you sure you want to permanently delete "${assetName || assetId}" and all its historical versions?`;
    this.modal.showModal();
  }

  render() {
    const filtered = this.assets.filter(a => {
      if (this.activeCategory === 'all') return true;
      return a.category === this.activeCategory;
    });

    if (filtered.length === 0) {
      this.grid.innerHTML = '<div class="empty-state">No assets found in this category.</div>';
      return;
    }

    this.grid.innerHTML = '';
    filtered.forEach(asset => {
      const card = document.createElement('div');
      card.className = `asset-card ${asset.id === this.selectedAssetId ? 'active' : ''}`;
      card.dataset.id = asset.id;

      const thumbUrl = asset.current_version?.processed_url || '';

      card.innerHTML = `
        <div class="card-thumb-wrap">
          ${thumbUrl 
            ? `<img class="card-thumb" src="${thumbUrl}" alt="${this.escapeHtml(asset.name)}">`
            : '<span style="font-size: 10px; color: var(--text-muted);">Draft</span>'}
        </div>
        <div class="card-info">
          <div class="card-name" title="${this.escapeHtml(asset.name)}">${this.escapeHtml(asset.name)}</div>
          <div class="card-meta">
            <span>${asset.category}</span>
            <span>v${asset.current_version?.version_number || 1}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectAsset(asset.id);
        if (this.onSelect) {
          this.onSelect(asset.id);
        }
      });

      this.grid.appendChild(card);
    });
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
