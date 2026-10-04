/**
 * CompareSlider orchestrates the synchronized Before (Raw AI / Reference) vs After (Processed Pixel Art)
 * comparison layers and interactive split-screen slider.
 *
 * Honors real data constraints: if no separate raw/reference image exists,
 * the split slider is gracefully disabled and single output mode is used.
 */
export class CompareSlider {
  constructor({
    rawCanvas,
    processedCanvas,
    splitClipWrapper,
    splitHandle,
    viewportWrapper
  }) {
    this.rawCanvas = rawCanvas;
    this.processedCanvas = processedCanvas;
    this.splitClipWrapper = splitClipWrapper;
    this.splitHandle = splitHandle;
    this.viewportWrapper = viewportWrapper;

    this.mode = 'processed'; // 'split' | 'processed' | 'raw' | 'side-by-side'
    this.splitPercent = 50;
    this.isDragging = false;
    this.hasComparison = false;

    this.rawImage = null;
    this.processedImage = null;

    this.initHandleDrag();
  }

  initHandleDrag() {
    this.splitHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.isDragging = true;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || this.mode !== 'split' || !this.hasComparison) return;

      const rect = this.viewportWrapper.getBoundingClientRect();
      const clientX = e.clientX;
      const relX = clientX - rect.left;
      let percent = (relX / rect.width) * 100;
      percent = Math.max(0, Math.min(100, percent));

      this.setSplitPercent(percent);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  setSplitPercent(percent) {
    this.splitPercent = percent;
    this.splitHandle.style.left = `${percent}%`;
    this.splitClipWrapper.style.clipPath = `inset(0 0 0 ${percent}%)`;
  }

  setMode(mode) {
    // If no distinct raw image exists, stay in processed (single) mode
    if (!this.hasComparison && (mode === 'split' || mode === 'raw' || mode === 'side-by-side')) {
      mode = 'processed';
    }

    this.mode = mode;

    if (mode === 'split' && this.hasComparison) {
      this.splitHandle.style.display = 'block';
      this.rawCanvas.style.display = 'block';
      this.splitClipWrapper.style.display = 'block';
      this.setSplitPercent(50);
    } else if (mode === 'processed' || !this.hasComparison) {
      this.splitHandle.style.display = 'none';
      this.rawCanvas.style.display = 'none';
      this.splitClipWrapper.style.display = 'block';
      this.splitClipWrapper.style.clipPath = 'none';
    } else if (mode === 'raw' && this.hasComparison) {
      this.splitHandle.style.display = 'none';
      this.rawCanvas.style.display = 'block';
      this.splitClipWrapper.style.display = 'none';
    } else if (mode === 'side-by-side' && this.hasComparison) {
      this.splitHandle.style.display = 'none';
      this.rawCanvas.style.display = 'block';
      this.splitClipWrapper.style.display = 'block';
      this.setSplitPercent(50);
    }
  }

  async loadImages(rawUrl, processedUrl, width, height) {
    this.rawCanvas.width = width;
    this.rawCanvas.height = height;
    this.processedCanvas.width = width;
    this.processedCanvas.height = height;

    const hasDistinctRaw = Boolean(rawUrl && processedUrl && rawUrl !== processedUrl);
    this.hasComparison = hasDistinctRaw;

    if (hasDistinctRaw) {
      const [rawImg, procImg] = await Promise.all([
        this.loadImageElement(rawUrl),
        this.loadImageElement(processedUrl)
      ]);
      this.rawImage = rawImg;
      this.processedImage = procImg;
      this.setMode('split');
    } else {
      const procImg = await this.loadImageElement(processedUrl || rawUrl);
      this.rawImage = null;
      this.processedImage = procImg;
      this.setMode('processed');
    }

    this.render();
    return this.hasComparison;
  }

  loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = `${url}?t=${Date.now()}`;
    });
  }

  render() {
    if (this.rawImage && this.hasComparison) {
      const rawCtx = this.rawCanvas.getContext('2d');
      rawCtx.imageSmoothingEnabled = false;
      rawCtx.clearRect(0, 0, this.rawCanvas.width, this.rawCanvas.height);
      rawCtx.drawImage(this.rawImage, 0, 0, this.rawCanvas.width, this.rawCanvas.height);
    }

    if (this.processedImage) {
      const procCtx = this.processedCanvas.getContext('2d');
      procCtx.imageSmoothingEnabled = false;
      procCtx.clearRect(0, 0, this.processedCanvas.width, this.processedCanvas.height);
      procCtx.drawImage(this.processedImage, 0, 0, this.processedCanvas.width, this.processedCanvas.height);
    }
  }
}
