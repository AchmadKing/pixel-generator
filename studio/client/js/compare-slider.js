/**
 * CompareSlider orchestrates the synchronized Before (Raw AI) vs After (Processed Pixel Art)
 * comparison layers and interactive split-screen slider.
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

    this.mode = 'split'; // 'split' | 'processed' | 'raw' | 'side-by-side'
    this.splitPercent = 50;
    this.isDragging = false;

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
      if (!this.isDragging || this.mode !== 'split') return;

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
    this.mode = mode;

    if (mode === 'split') {
      this.splitHandle.style.display = 'block';
      this.rawCanvas.style.display = 'block';
      this.splitClipWrapper.style.display = 'block';
      this.setSplitPercent(50);
    } else if (mode === 'processed') {
      this.splitHandle.style.display = 'none';
      this.rawCanvas.style.display = 'none';
      this.splitClipWrapper.style.display = 'block';
      this.splitClipWrapper.style.clipPath = 'none';
    } else if (mode === 'raw') {
      this.splitHandle.style.display = 'none';
      this.rawCanvas.style.display = 'block';
      this.splitClipWrapper.style.display = 'none';
    } else if (mode === 'side-by-side') {
      // In side-by-side mode, both are visible 50/50 without slider
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

    const [rawImg, procImg] = await Promise.all([
      this.loadImageElement(rawUrl),
      this.loadImageElement(processedUrl)
    ]);

    this.rawImage = rawImg;
    this.processedImage = procImg;

    this.render();
  }

  loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));
      img.src = `${url}?t=${Date.now()}`; // Bust cache for live updates
    });
  }

  render() {
    if (this.rawImage) {
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
