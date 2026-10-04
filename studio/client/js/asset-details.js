/**
 * AssetDetailsPanel renders technical asset specifications, metadata provenance,
 * and AI agent workflow instructions when no asset is selected.
 */
export class AssetDetailsPanel {
  constructor({ containerEl, onRescan, onExport }) {
    this.containerEl = containerEl;
    this.onRescan = onRescan;
    this.onExport = onExport;
    this.asset = null;
    this.version = null;

    this.renderEmpty();
  }

  setAsset(asset, version = null) {
    this.asset = asset;
    this.version = version || asset?.versions?.find(v => v.id === asset.current_version_id) || asset?.versions?.[0] || null;

    if (!this.asset || !this.version) {
      this.renderEmpty();
    } else {
      this.renderDetails();
    }
  }

  renderEmpty() {
    this.containerEl.innerHTML = `
      <div class="agent-workflow-card">
        <div class="workflow-header">
          <div class="workflow-icon">🤖</div>
          <h3>AI Agent External Workflow</h3>
        </div>
        <p class="workflow-desc">
          Pixel art generation is performed by your <strong>AI coding agent</strong> in your IDE or terminal. Studio serves as your local inspector, viewer, and asset manager.
        </p>

        <div class="workflow-steps">
          <div class="workflow-step">
            <span class="step-num">1</span>
            <div class="step-text">
              <strong>Generate via AI Agent</strong>
              <code>Prompt your AI agent to create 2D pixel art</code>
            </div>
          </div>
          <div class="workflow-step">
            <span class="step-num">2</span>
            <div class="step-text">
              <strong>Automatic Storage</strong>
              <code>Saved to assets/generated/&lt;slug&gt;/v1/</code>
            </div>
          </div>
          <div class="workflow-step">
            <span class="step-num">3</span>
            <div class="step-text">
              <strong>Inspect in Studio</strong>
              <code>Click "Rescan Assets" or run: node studio scan</code>
            </div>
          </div>
        </div>

        <div class="workflow-actions">
          <button type="button" class="btn btn-primary btn-block" id="btnEmptyRescan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Rescan Assets Folder
          </button>
        </div>

        <div class="workflow-hint">
          <small>Skills available: <code>pixel-art-generation</code>, <code>pixel-art-revise</code>, <code>asset-review</code></small>
        </div>
      </div>
    `;

    const btn = this.containerEl.querySelector('#btnEmptyRescan');
    if (btn && this.onRescan) {
      btn.addEventListener('click', () => this.onRescan());
    }
  }

  renderDetails() {
    const a = this.asset;
    const v = this.version;

    const relPath = `assets/generated/${a.id}/v${v.version_number}/processed.png`;
    const dateStr = v.created_at ? new Date(v.created_at * 1000).toLocaleString() : 'Recently';
    const isIntegrityOk = v.integrity_status === 'ok';

    this.containerEl.innerHTML = `
      <div class="asset-details-container">
        <!-- Asset Header Info -->
        <div class="details-section">
          <div class="details-header-row">
            <div>
              <h2 class="details-title">${this.escapeHtml(a.name)}</h2>
              <span class="details-id"><code>${this.escapeHtml(a.id)}</code></span>
            </div>
            <span class="badge badge-category">${this.escapeHtml(a.category)}</span>
          </div>
          <div class="details-badges">
            <span class="badge badge-version">v${v.version_number} ${v.id === a.current_version_id ? '(Active)' : ''}</span>
            <span class="badge ${isIntegrityOk ? 'badge-success' : 'badge-danger'}">
              ${isIntegrityOk ? '● Backing File OK' : '⚠ Missing File'}
            </span>
          </div>
        </div>

        <!-- Technical Specifications Table -->
        <div class="details-section">
          <h3 class="section-title">Technical Specifications</h3>
          <div class="spec-grid">
            <div class="spec-item">
              <span class="spec-label">Resolution</span>
              <span class="spec-value">${v.target_width} × ${v.target_height} px</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Color Palette</span>
              <span class="spec-value">${this.escapeHtml(v.palette_id || 'endesga-32')}</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Format</span>
              <span class="spec-value">PNG (32-bit RGBA)</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Tool / Model</span>
              <span class="spec-value">${this.escapeHtml(v.provider_id || 'ai-agent')}</span>
            </div>
            <div class="spec-item full-width">
              <span class="spec-label">Relative Path</span>
              <div class="spec-path-box">
                <code id="specRelPath">${this.escapeHtml(relPath)}</code>
                <button type="button" class="btn btn-secondary btn-xs" id="btnCopyPath" title="Copy relative path">Copy</button>
              </div>
            </div>
            <div class="spec-item">
              <span class="spec-label">Created At</span>
              <span class="spec-value">${this.escapeHtml(dateStr)}</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Seed</span>
              <span class="spec-value">${v.seed != null ? v.seed : 'None'}</span>
            </div>
          </div>
        </div>

        <!-- Prompt & Context -->
        <div class="details-section">
          <h3 class="section-title">Generation Prompt & Context</h3>
          <div class="prompt-box">
            <div class="prompt-text">${this.escapeHtml(v.prompt || 'No prompt recorded.')}</div>
            ${v.negative_prompt ? `<div class="negative-prompt-text"><small>Negative:</small> ${this.escapeHtml(v.negative_prompt)}</div>` : ''}
          </div>
          ${v.notes ? `<div class="notes-box"><small>Change Summary:</small> ${this.escapeHtml(v.notes)}</div>` : ''}
        </div>

        <!-- Action Buttons -->
        <div class="details-actions">
          <a href="${v.processed_url}" download="${a.id}_v${v.version_number}.png" class="btn btn-primary btn-block">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PNG File
          </a>
        </div>
      </div>
    `;

    // Bind Copy Path Button
    const btnCopy = this.containerEl.querySelector('#btnCopyPath');
    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(relPath);
          btnCopy.textContent = 'Copied!';
          setTimeout(() => { btnCopy.textContent = 'Copy'; }, 2000);
        } catch (_) {
          prompt('Relative file path:', relPath);
        }
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
