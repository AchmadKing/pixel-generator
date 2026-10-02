import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PixelCanvas } from '../../studio/server/post-processing/pixel-canvas.js';
import { removeBackground } from '../../studio/server/post-processing/background-remover.js';

describe('Background Remover Unit Test Suite', () => {
  test('Removes flat background from 4 corners', () => {
    // 6x6 canvas with white background (255, 255, 255) and a 2x2 red square in the center
    const canvas = new PixelCanvas(6, 6);
    canvas.fill(255, 255, 255, 255);

    // Center 2x2 red object at (2, 2), (2, 3), (3, 2), (3, 3)
    canvas.setPixel(2, 2, 255, 0, 0, 255);
    canvas.setPixel(2, 3, 255, 0, 0, 255);
    canvas.setPixel(3, 2, 255, 0, 0, 255);
    canvas.setPixel(3, 3, 255, 0, 0, 255);

    const result = removeBackground(canvas, { tolerance: 10 });
    assert.equal(result.erasedCount, 32); // 36 - 4 = 32

    // Check corners are transparent
    assert.equal(canvas.getPixel(0, 0).a, 0);
    assert.equal(canvas.getPixel(5, 5).a, 0);

    // Check center red object is preserved
    assert.deepEqual(canvas.getPixel(2, 2), { r: 255, g: 0, b: 0, a: 255 });
    assert.deepEqual(canvas.getPixel(3, 3), { r: 255, g: 0, b: 0, a: 255 });
  });

  test('Preserves interior closed contour (doughnut test)', () => {
    // 7x7 canvas with black background (0, 0, 0)
    // A hollow blue box (outline only):
    // outer (1,1) to (5,5), with center (3,3) filled with black (0, 0, 0)
    const canvas = new PixelCanvas(7, 7);
    canvas.fill(0, 0, 0, 255);

    // Draw opaque blue ring
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        if (x === 1 || x === 5 || y === 1 || y === 5) {
          canvas.setPixel(x, y, 0, 0, 255, 255);
        }
      }
    }
    // (3, 3) is black interior closed contour

    const result = removeBackground(canvas, { tolerance: 5 });

    // Outer background is removed
    assert.equal(canvas.getPixel(0, 0).a, 0);
    assert.equal(canvas.getPixel(6, 6).a, 0);

    // Ring is intact
    assert.deepEqual(canvas.getPixel(1, 1), { r: 0, g: 0, b: 255, a: 255 });

    // Interior center is completely preserved (not erased!)
    const interior = canvas.getPixel(3, 3);
    assert.equal(interior.a, 255);
    assert.deepEqual(interior, { r: 0, g: 0, b: 0, a: 255 });
  });

  test('Tolerates subtle color variations within tolerance', () => {
    const canvas = new PixelCanvas(4, 4);
    // Fill with slight gradient: (250..255)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        canvas.setPixel(x, y, 250 + x, 250 + y, 250, 255);
      }
    }
    // High contrast object at (1, 1)
    canvas.setPixel(1, 1, 0, 100, 200, 255);

    const result = removeBackground(canvas, { tolerance: 20 });
    // Object preserved
    assert.deepEqual(canvas.getPixel(1, 1), { r: 0, g: 100, b: 200, a: 255 });
    // Corners removed
    assert.equal(canvas.getPixel(0, 0).a, 0);
    assert.equal(canvas.getPixel(3, 3).a, 0);
  });

  test('Flags excessive erasure when over 90% non-transparent pixels are removed', () => {
    const canvas = new PixelCanvas(10, 10);
    canvas.fill(255, 255, 255, 255);
    // Only 2 pixels are different
    canvas.setPixel(5, 5, 255, 0, 0, 255);
    canvas.setPixel(5, 6, 255, 0, 0, 255);

    const result = removeBackground(canvas, { tolerance: 10 });
    assert.equal(result.erasedCount, 98);
    assert.equal(result.excessiveErasure, true);
  });
});
