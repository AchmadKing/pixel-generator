/**
 * VersionTimeline renders and coordinates the immutable snapshot history for an asset.
 */
export class VersionTimeline {
  constructor({ containerEl, countBadgeEl, nameTitleEl, categoryTitleEl, onActivateVersion, onForkVersion }) {
    this.container = containerEl;
    this.countBadge = countBadgeEl;
    this.nameTitle = nameTitleEl;
    this.categoryTitle = categoryTitleEl;
    this.onActivate = onActivateVersion;
    this.onFork = onForkVersion;
    this.currentAsset = null;
  }

  setAsset(asset) {
    this.currentAsset = asset;
    if (!asset) {
      this.nameTitle.textContent = 'No Asset Selected';
      this.categoryTitle.textContent = 'Select or create an asset';
      this.countBadge.textContent = '0';
      this.container.innerHTML = '<div class="empty-state">No version history available.</div>';
      return;
    }

    this.nameTitle.textContent = asset.name || 'Untitled Asset';
    this.categoryTitle.textContent = `Category: ${asset.category} • ID: ${asset.id}`;
    const versions = asset.versions || [];
    this.countBadge.textContent = String(versions.length);

    if (versions.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No versions recorded yet.</div>';
      return;
    }

    this.container.innerHTML = '';
    versions.forEach(v => {
      const card = this.createVersionCard(asset, v);
      this.container.appendChild(card);
    });
  }

  createVersionCard(asset, version) {
    const card = document.createElement('div');
    const isActive = version.id === asset.current_version_id;
    card.className = `version-card ${isActive ? 'is-active' : ''}`;

    const dateStr = new Date(version.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="version-card-header">
        <span class="version-badge">Version ${version.version_number}</span>
        ${isActive ? '<span class="active-pill">ACTIVE</span>' : ''}
      </div>
      <div class="version-thumb-row">
        <img class="version-thumb" src="${version.processed_url}" alt="v${version.version_number}">
        <div class="version-specs">
          <div>Size: <span>${version.target_width}×${version.target_height}</span></div>
          <div>Palette: <span>${version.palette_id}</span></div>
          <div>Seed: <span>${version.seed !== null ? version.seed : 'auto'}</span></div>
          <div>Time: <span>${dateStr}</span></div>
        </div>
      </div>
      <div class="version-prompt" title="${this.escapeHtml(version.prompt)}">${this.escapeHtml(version.prompt)}</div>
      <div class="version-actions">
        ${!isActive ? `<button type="button" class="btn btn-secondary btn-sm btn-activate" data-ver="${version.id}">Set Active</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm btn-fork" data-ver="${version.id}">Fork / Revise</button>
      </div>
    `;

    const btnActivate = card.querySelector('.btn-activate');
    if (btnActivate) {
      btnActivate.addEventListener('click', () => {
        if (this.onActivate) this.onActivate(asset.id, version.id);
      });
    }

    const btnFork = card.querySelector('.btn-fork');
    if (btnFork) {
      btnFork.addEventListener('click', () => {
        if (this.onFork) this.onFork(asset, version);
      });
    }

    return card;
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
