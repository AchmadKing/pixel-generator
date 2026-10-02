import { PixelCanvas } from './pixel-canvas.js';

/**
 * Finds the tight non-transparent bounding box in a PixelCanvas.
 * @param {PixelCanvas} canvas
 * @param {number} [alphaThreshold=1]
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, isEmpty: boolean }}
 */
export function getContentBoundingBox(canvas, alphaThreshold = 1) {
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const p = canvas.getPixel(x, y);
      if (p.a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, isEmpty: true };
  }

  return { minX, minY, maxX, maxY, isEmpty: false };
}

/**
 * Resamples and frames an image into target dimensions with aspect ratio preservation,
 * centering, continuous area-averaged resampling, and anti-dark halo alpha weighting.
 * 
 * @param {PixelCanvas} sourceCanvas
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @param {object} [options]
 * @param {boolean} [options.cropToContent=true] - If true, crops to content bounding box before scaling
 * @param {number} [options.alphaThreshold=1] - Minimum alpha to consider non-empty
 * @param {number} [options.padding=0] - Inner padding in target pixels
 * @returns {PixelCanvas}
 */
export function frameAndCenter(sourceCanvas, targetWidth, targetHeight, options = {}) {
  const cropToContent = options.cropToContent !== false;
  const alphaThreshold = typeof options.alphaThreshold === 'number' ? options.alphaThreshold : 1;
  const padding = typeof options.padding === 'number' ? Math.max(0, options.padding) : 0;

  const targetCanvas = new PixelCanvas(targetWidth, targetHeight);

  // 1. Determine bounding box
  let bbox;
  if (cropToContent) {
    bbox = getContentBoundingBox(sourceCanvas, alphaThreshold);
    if (bbox.isEmpty) {
      return targetCanvas; // Return blank canvas
    }
  } else {
    bbox = {
      minX: 0,
      minY: 0,
      maxX: sourceCanvas.width - 1,
      maxY: sourceCanvas.height - 1,
      isEmpty: false
    };
  }

  const bboxW = bbox.maxX - bbox.minX + 1;
  const bboxH = bbox.maxY - bbox.minY + 1;

  // 2. Usable area inside target considering padding
  const availW = Math.max(1, targetWidth - padding * 2);
  const availH = Math.max(1, targetHeight - padding * 2);

  // 3. Proportional scale
  const scale = Math.min(availW / bboxW, availH / bboxH);
  const scaledW = Math.max(1, Math.min(availW, Math.round(bboxW * scale)));
  const scaledH = Math.max(1, Math.min(availH, Math.round(bboxH * scale)));

  // 4. Centering offsets
  const offsetX = Math.floor((targetWidth - scaledW) / 2);
  const offsetY = Math.floor((targetHeight - scaledH) / 2);

  // 5. Continuous area-averaged resampling with anti-dark halo
  for (let dy = 0; dy < scaledH; dy++) {
    const srcY0 = bbox.minY + (dy / scaledH) * bboxH;
    const srcY1 = bbox.minY + ((dy + 1) / scaledH) * bboxH;

    const startY = Math.max(bbox.minY, Math.floor(srcY0));
    const endY = Math.min(bbox.maxY, Math.ceil(srcY1) - 1);

    for (let dx = 0; dx < scaledW; dx++) {
      const srcX0 = bbox.minX + (dx / scaledW) * bboxW;
      const srcX1 = bbox.minX + ((dx + 1) / scaledW) * bboxW;

      const startX = Math.max(bbox.minX, Math.floor(srcX0));
      const endX = Math.min(bbox.maxX, Math.ceil(srcX1) - 1);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalEffectiveWeight = 0;
      let totalAreaWeight = 0;

      for (let sy = startY; sy <= endY; sy++) {
        const top = Math.max(sy, srcY0);
        const bottom = Math.min(sy + 1, srcY1);
        const oh = Math.max(0, bottom - top);
        if (oh <= 0) continue;

        for (let sx = startX; sx <= endX; sx++) {
          const left = Math.max(sx, srcX0);
          const right = Math.min(sx + 1, srcX1);
          const ow = Math.max(0, right - left);
          if (ow <= 0) continue;

          const areaWeight = ow * oh;
          totalAreaWeight += areaWeight;

          const p = sourceCanvas.getPixel(sx, sy);
          const alphaNorm = p.a / 255;
          const effectiveWeight = areaWeight * alphaNorm;

          sumR += p.r * effectiveWeight;
          sumG += p.g * effectiveWeight;
          sumB += p.b * effectiveWeight;
          totalEffectiveWeight += effectiveWeight;
        }
      }

      if (totalEffectiveWeight > 0 && totalAreaWeight > 0) {
        const finalR = Math.round(sumR / totalEffectiveWeight);
        const finalG = Math.round(sumG / totalEffectiveWeight);
        const finalB = Math.round(sumB / totalEffectiveWeight);
        const finalA = Math.round(255 * (totalEffectiveWeight / totalAreaWeight));

        targetCanvas.setPixel(offsetX + dx, offsetY + dy, finalR, finalG, finalB, finalA);
      }
    }
  }

  return targetCanvas;
}
