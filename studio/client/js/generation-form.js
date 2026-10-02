/**
 * GenerationForm coordinates user input, parameter validation, job submission,
 * and real-time progress HUD polling.
 */
export class GenerationForm {
  constructor({
    formEl,
    promptInput,
    negativePromptInput,
    categorySelect,
    resolutionSelect,
    paletteSelect,
    paletteSwatchesEl,
    seedInput,
    btnRandomSeed,
    skipPostProcessingCheck,
    progressHudEl,
    progressTitleEl,
    progressSubtitleEl,
    progressFillEl,
    apiClient,
    onJobCompleted
  }) {
    this.form = formEl;
    this.promptInput = promptInput;
    this.negativePromptInput = negativePromptInput;
    this.categorySelect = categorySelect;
    this.resolutionSelect = resolutionSelect;
    this.paletteSelect = paletteSelect;
    this.paletteSwatches = paletteSwatchesEl;
    this.seedInput = seedInput;
    this.btnRandomSeed = btnRandomSeed;
    this.skipPostProcessingCheck = skipPostProcessingCheck;

    this.progressHud = progressHudEl;
    this.progressTitle = progressTitleEl;
    this.progressSubtitle = progressSubtitleEl;
    this.progressFill = progressFillEl;

    this.api = apiClient;
    this.onCompleted = onJobCompleted;

    this.activeAssetId = null; // null if creating a brand new asset
    this.palettes = {};

    this.initEvents();
  }

  setPalettes(palettes) {
    this.palettes = palettes || {};
    this.updatePaletteSwatches();
  }

  updatePaletteSwatches() {
    const selected = this.paletteSelect.value;
    const colors = this.palettes[selected] || [];
    this.paletteSwatches.innerHTML = '';
    colors.forEach(hex => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch-color';
      swatch.style.backgroundColor = hex;
      swatch.title = hex;
      this.paletteSwatches.appendChild(swatch);
    });
  }

  initEvents() {
    this.paletteSelect.addEventListener('change', () => this.updatePaletteSwatches());

    this.btnRandomSeed.addEventListener('click', () => {
      this.seedInput.value = Math.floor(Math.random() * 2147483647);
    });

    // Token chips
    document.querySelectorAll('.token-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.text;
        if (text) {
          const current = this.promptInput.value.trim();
          this.promptInput.value = current ? `${current}, ${text}` : text;
        }
      });
    });

    // Form submit
    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSubmit();
    });
  }

  setFormValues({ prompt, negativePrompt, category, resolution, palette, seed, assetId }) {
    if (prompt !== undefined) this.promptInput.value = prompt;
    if (negativePrompt !== undefined) this.negativePromptInput.value = negativePrompt || '';
    if (category !== undefined) this.categorySelect.value = category;
    if (resolution !== undefined) this.resolutionSelect.value = String(resolution);
    if (palette !== undefined) {
      this.paletteSelect.value = palette;
      this.updatePaletteSwatches();
    }
    if (seed !== undefined) this.seedInput.value = seed !== null ? seed : '';
    this.activeAssetId = assetId || null;
  }

  async handleSubmit() {
    const prompt = this.promptInput.value.trim();
    if (!prompt) return;

    const category = this.categorySelect.value;
    const resolution = Number(this.resolutionSelect.value);
    const paletteId = this.paletteSelect.value;
    const negativePrompt = this.negativePromptInput.value.trim() || null;
    const seedVal = this.seedInput.value.trim();
    const seed = seedVal ? Number(seedVal) : null;
    const skipPostProcessing = this.skipPostProcessingCheck.checked;

    const payload = {
      projectId: 'proj_default',
      assetId: this.activeAssetId,
      prompt,
      negativePrompt,
      category,
      paletteId,
      targetWidth: resolution,
      targetHeight: resolution,
      seed,
      skipPostProcessing
    };

    const submitBtn = document.getElementById('btnGenerate');
    submitBtn.disabled = true;

    try {
      this.showProgress('Submitting Job...', 'Registering task in queue', 15);
      const res = await this.api.createJob(payload);
      const jobId = res.jobId;

      await this.pollJob(jobId);
    } catch (err) {
      alert(`Generation Error: ${err.message}`);
      this.hideProgress();
    } finally {
      submitBtn.disabled = false;
    }
  }

  async pollJob(jobId) {
    const STAGE_CONFIG = {
      queued: { title: 'Queued...', subtitle: 'Waiting in local task queue', percent: 25 },
      submitting: { title: 'Submitting...', subtitle: 'Dispatching to generation engine', percent: 45 },
      polling: { title: 'Generating...', subtitle: 'Waiting for model output', percent: 65 },
      processing: { title: 'Post-Processing...', subtitle: 'Alpha cutout, framing & palette quantization', percent: 85 },
      completed: { title: 'Completed!', subtitle: 'Rendering pixel canvas', percent: 100 }
    };

    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 600));
      try {
        const job = await this.api.getJob(jobId);
        const stage = job.stage || 'queued';
        const info = STAGE_CONFIG[stage] || { title: stage, subtitle: '', percent: 50 };

        this.showProgress(info.title, info.subtitle, info.percent);

        if (job.status === 'completed') {
          done = true;
          setTimeout(() => {
            this.hideProgress();
            if (this.onCompleted) {
              this.onCompleted(job.asset_id, job.created_version_id);
            }
          }, 400);
        } else if (job.status === 'failed' || job.status === 'interrupted') {
          done = true;
          this.hideProgress();
          alert(`Job Failed (${job.status}): ${job.error_message || 'Unknown error'}`);
        }
      } catch (pollErr) {
        done = true;
        this.hideProgress();
        alert(`Polling Error: ${pollErr.message}`);
      }
    }
  }

  showProgress(title, subtitle, percent) {
    this.progressHud.style.display = 'flex';
    this.progressTitle.textContent = title;
    this.progressSubtitle.textContent = subtitle;
    this.progressFill.style.width = `${percent}%`;
  }

  hideProgress() {
    this.progressHud.style.display = 'none';
  }
}
