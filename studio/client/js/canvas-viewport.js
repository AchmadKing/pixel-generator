/**
 * CanvasViewport manages pixel-crisp 2D rendering, integer zoom levels (1x to 32x),
 * pan navigation, and pixel grid overlay.
 */
export class CanvasViewport {
  constructor({
    containerEl,
    wrapperEl,
    checkerCanvas,
    gridCanvas,
    zoomIndicatorEl,
    hudCoordsEl,
    hudDimensionsEl
  }) {
    this.container = containerEl;
    this.wrapper = wrapperEl;
    this.checkerCanvas = checkerCanvas;
    this.gridCanvas = gridCanvas;
    this.zoomIndicator = zoomIndicatorEl;
    this.hudCoords = hudCoordsEl;
    this.hudDimensions = hudDimensionsEl;

    // Zoom Levels (Integer discrete scales)
    this.zoomLevels = [1, 2, 4, 8, 12, 16, 24, 32];
    this.currentZoomIndex = 3; // 8x (800%) default
    this.zoom = this.zoomLevels[this.currentZoomIndex];

    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;

    this.showGrid = true;
    this.contentWidth = 32;
    this.contentHeight = 32;

    this.initEvents();
    this.updateTransform();
  }

  setDimensions(width, height) {
    this.contentWidth = width;
    this.contentHeight = height;

    this.checkerCanvas.width = width;
    this.checkerCanvas.height = height;

    this.gridCanvas.width = width;
    this.gridCanvas.height = height;

    this.wrapper.style.width = `${width}px`;
    this.wrapper.style.height = `${height}px`;

    if (this.hudDimensions) {
      this.hudDimensions.textContent = `${width} × ${height} px`;
    }

    this.renderCheckerboard();
    this.renderGrid();
  }

  initEvents() {
    // Mouse drag pan
    this.container.addEventListener('mousedown', (e) => {
      // Don't pan if clicking directly on split handle
      if (e.target.closest('#splitHandle')) return;
      this.isPanning = true;
      this.container.classList.add('panning');
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.updateTransform();
      }

      // Update hover pixel coordinates
      if (this.hudCoords) {
        const rect = this.wrapper.getBoundingClientRect();
        const px = Math.floor((e.clientX - rect.left) / this.zoom);
        const py = Math.floor((e.clientY - rect.top) / this.zoom);
        if (px >= 0 && px < this.contentWidth && py >= 0 && py < this.contentHeight) {
          this.hudCoords.textContent = `X: ${px} Y: ${py}`;
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.container.classList.remove('panning');
    });

    // Mouse wheel zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }, { passive: false });
  }

  zoomIn() {
    if (this.currentZoomIndex < this.zoomLevels.length - 1) {
      this.currentZoomIndex++;
      this.zoom = this.zoomLevels[this.currentZoomIndex];
      this.updateTransform();
    }
  }

  zoomOut() {
    if (this.currentZoomIndex > 0) {
      this.currentZoomIndex--;
      this.zoom = this.zoomLevels[this.currentZoomIndex];
      this.updateTransform();
    }
  }

  setZoom100() {
    this.currentZoomIndex = 0; // 1x
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  fitToScreen() {
    const containerW = this.container.clientWidth - 80;
    const containerH = this.container.clientHeight - 80;
    const scaleX = containerW / this.contentWidth;
    const scaleY = containerH / this.contentHeight;
    const fitScale = Math.min(scaleX, scaleY);

    // Pick closest integer zoom level <= fitScale
    let bestIndex = 0;
    for (let i = 0; i < this.zoomLevels.length; i++) {
      if (this.zoomLevels[i] <= fitScale) {
        bestIndex = i;
      }
    }
    this.currentZoomIndex = bestIndex;
    this.zoom = this.zoomLevels[this.currentZoomIndex];
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.renderGrid();
    return this.showGrid;
  }

  updateTransform() {
    this.wrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    if (this.zoomIndicator) {
      this.zoomIndicator.textContent = `${this.zoom * 100}%`;
    }
    this.renderGrid();
  }

  renderCheckerboard() {
    const ctx = this.checkerCanvas.getContext('2d');
    const w = this.checkerCanvas.width;
    const h = this.checkerCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const size = 4; // 4x4 pixel checker tiles
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        const isEven = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
        ctx.fillStyle = isEven ? '#1c2128' : '#2d333b';
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  renderGrid() {
    const ctx = this.gridCanvas.getContext('2d');
    const w = this.gridCanvas.width;
    const h = this.gridCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Only draw grid when zoom >= 4x and grid is toggled on
    if (!this.showGrid || this.zoom < 4) return;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1 / this.zoom; // Always 1 screen pixel wide

    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y++) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }
}
