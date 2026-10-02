import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PixelCanvas } from '../../studio/server/post-processing/pixel-canvas.js';
import { frameAndCenter, getContentBoundingBox } from '../../studio/server/post-processing/framer.js';

describe('Framer Unit Test Suite', () => {
  test('getContentBoundingBox detects content boundaries accurately', () => {
    const canvas = new PixelCanvas(10, 10);
    // Draw an opaque 3x2 box from (2, 3) to (4, 4)
    for (let y = 3; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        canvas.setPixel(x, y, 100, 150, 200, 255);
      }
    }

    const bbox = getContentBoundingBox(canvas);
    assert.equal(bbox.isEmpty, false);
    assert.equal(bbox.minX, 2);
    assert.equal(bbox.minY, 3);
    assert.equal(bbox.maxX, 4);
    assert.equal(bbox.maxY, 4);
  });

  test('getContentBoundingBox returns empty for transparent canvas', () => {
    const canvas = new PixelCanvas(8, 8);
    const bbox = getContentBoundingBox(canvas);
    assert.equal(bbox.isEmpty, true);
  });

  test('frameAndCenter centers content and preserves aspect ratio', () => {
    // 8x8 source with a 2x2 green square at top-left (0, 0)
    const source = new PixelCanvas(8, 8);
    source.setPixel(0, 0, 0, 255, 0, 255);
    source.setPixel(0, 1, 0, 255, 0, 255);
    source.setPixel(1, 0, 0, 255, 0, 255);
    source.setPixel(1, 1, 0, 255, 0, 255);

    // Frame into 16x16
    const framed = frameAndCenter(source, 16, 16, { cropToContent: true });
    assert.equal(framed.width, 16);
    assert.equal(framed.height, 16);

    // The 2x2 content scaled to 16x16 should fill 16x16 uniformly green
    assert.deepEqual(framed.getPixel(0, 0), { r: 0, g: 255, b: 0, a: 255 });
    assert.deepEqual(framed.getPixel(15, 15), { r: 0, g: 255, b: 0, a: 255 });
    assert.deepEqual(framed.getPixel(8, 8), { r: 0, g: 255, b: 0, a: 255 });
  });

  test('Anti-dark halo preserves vibrant RGB color on semi-transparent edges', () => {
    // 2x1 image: pixel 0 is solid cyan [0, 255, 255, 255], pixel 1 is semi-transparent cyan [0, 255, 255, 50]
    const source = new PixelCanvas(2, 1);
    source.setPixel(0, 0, 0, 255, 255, 255);
    source.setPixel(1, 0, 0, 255, 255, 50);

    // Downscale or resample to 2x1
    const result = frameAndCenter(source, 2, 1, { cropToContent: false });
    const p1 = result.getPixel(1, 0);

    // Color must NOT be darkened by zero (black)
    assert.equal(p1.r, 0);
    assert.equal(p1.g, 255); // vibrant green preserved!
    assert.equal(p1.b, 255); // vibrant blue preserved!
    assert.ok(p1.a > 0 && p1.a <= 255);
  });

  test('frameAndCenter returns empty canvas when source is completely transparent', () => {
    const emptySource = new PixelCanvas(8, 8);
    const framed = frameAndCenter(emptySource, 32, 32);
    assert.equal(framed.width, 32);
    assert.equal(framed.height, 32);
    assert.equal(framed.getPixel(16, 16).a, 0);
  });
});
