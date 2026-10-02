import { PixelCanvas } from './pixel-canvas.js';

/**
 * Computes Euclidean color distance between two RGB colors.
 */
function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Removes background using 4-corner BFS flood-fill based on an immutable original snapshot.
 * Preserves interior closed contours and isolates seed evaluations.
 * 
 * @param {PixelCanvas} canvas - Input PixelCanvas (mutated in-place or returned)
 * @param {object} [options]
 * @param {number} [options.tolerance=25] - Color distance tolerance (0..255)
 * @returns {{ canvas: PixelCanvas, erasedCount: number, totalPixels: number, excessiveErasure: boolean }}
 */
export function removeBackground(canvas, options = {}) {
  const tolerance = typeof options.tolerance === 'number' ? options.tolerance : 25;
  const width = canvas.width;
  const height = canvas.height;
  const totalPixels = width * height;

  // 1. Immutable snapshot of original pixel data
  const originalData = new Uint8ClampedArray(canvas.data);

  // Helper to read original pixel
  function getOrigPixel(x, y) {
    const idx = (y * width + x) * 4;
    return {
      r: originalData[idx],
      g: originalData[idx + 1],
      b: originalData[idx + 2],
      a: originalData[idx + 3]
    };
  }

  // 2. Count initial non-transparent pixels
  let initialNonTransparentCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (originalData[i * 4 + 3] > 0) {
      initialNonTransparentCount++;
    }
  }

  // 3. Four corner coordinates
  const corners = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 }
  ];

  // Accumulated erasure mask (1 = erase, 0 = keep)
  const erasedMask = new Uint8Array(totalPixels);

  // Linear 1D queue (Int32Array, 4 bytes per pixel)
  const queue = new Int32Array(totalPixels);

  for (const corner of corners) {
    const seed = getOrigPixel(corner.x, corner.y);
    const cornerVisited = new Uint8Array(totalPixels);

    let head = 0;
    let tail = 0;

    const startIdx = corner.y * width + corner.x;
    queue[tail++] = startIdx;
    cornerVisited[startIdx] = 1;

    // Check if seed itself is within flood fill
    if (seed.a > 0) {
      erasedMask[startIdx] = 1;
    }

    while (head < tail) {
      const currIdx = queue[head++];
      const cx = currIdx % width;
      const cy = Math.floor(currIdx / width);

      // 4-connectivity neighbors: Up, Down, Left, Right
      const neighbors = [
        { x: cx, y: cy - 1 },
        { x: cx, y: cy + 1 },
        { x: cx - 1, y: cy },
        { x: cx + 1, y: cy }
      ];

      for (const n of neighbors) {
        if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
        const nIdx = n.y * width + n.x;

        if (cornerVisited[nIdx] === 1) continue;
        cornerVisited[nIdx] = 1;

        const np = getOrigPixel(n.x, n.y);

        if (np.a === 0) {
          // Transparent pixel: traverse through it
          queue[tail++] = nIdx;
        } else {
          // Non-transparent: check Euclidean distance against corner seed
          const dist = colorDistance(np.r, np.g, np.b, seed.r, seed.g, seed.b);
          if (dist <= tolerance) {
            erasedMask[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }
    }
  }

  // 4. Deterministic single-pass merge of erased mask
  let erasedCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (erasedMask[i] === 1) {
      const byteOffset = i * 4;
      if (canvas.data[byteOffset + 3] > 0) {
        erasedCount++;
        canvas.data[byteOffset] = 0;
        canvas.data[byteOffset + 1] = 0;
        canvas.data[byteOffset + 2] = 0;
        canvas.data[byteOffset + 3] = 0;
      }
    }
  }

  // 5. Excessive erasure detection (> 90% non-transparent pixels erased)
  const erasureRatio = initialNonTransparentCount > 0 ? (erasedCount / initialNonTransparentCount) : 0;
  const excessiveErasure = erasureRatio > 0.90;

  if (excessiveErasure) {
    console.warn(`[WARN] Excessive background erasure detected: ${(erasureRatio * 100).toFixed(1)}% of non-transparent pixels removed.`);
  }

  return {
    canvas,
    erasedCount,
    totalPixels,
    excessiveErasure
  };
}
