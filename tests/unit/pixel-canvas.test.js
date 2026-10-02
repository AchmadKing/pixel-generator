import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PixelCanvas } from '../../studio/server/post-processing/pixel-canvas.js';

describe('PixelCanvas Unit Test Suite', () => {
  test('Instantiates with valid dimensions and defaults to transparent pixels', () => {
    const canvas = new PixelCanvas(16, 16);
    assert.equal(canvas.width, 16);
    assert.equal(canvas.height, 16);
    assert.equal(canvas.data.length, 16 * 16 * 4);

    const p = canvas.getPixel(0, 0);
    assert.deepEqual(p, { r: 0, g: 0, b: 0, a: 0 });
  });

  test('Validates dimensions fail-fast', () => {
    assert.throws(() => new PixelCanvas(0, 10), /Invalid canvas width/);
    assert.throws(() => new PixelCanvas(10, -5), /Invalid canvas height/);
    assert.throws(() => new PixelCanvas(2049, 10), /Invalid canvas width/);
    assert.throws(() => new PixelCanvas(10, 2049), /Invalid canvas height/);
    assert.throws(() => new PixelCanvas(2048, 2049), /Invalid canvas height/);
  });

  test('getPixel and setPixel manipulate colors accurately', () => {
    const canvas = new PixelCanvas(4, 4);
    canvas.setPixel(2, 1, 255, 128, 64, 255);

    const pix = canvas.getPixel(2, 1);
    assert.deepEqual(pix, { r: 255, g: 128, b: 64, a: 255 });

    // Out of bounds get returns null
    assert.equal(canvas.getPixel(-1, 0), null);
    assert.equal(canvas.getPixel(4, 0), null);
    assert.equal(canvas.getPixel(0, 4), null);

    // Out of bounds set is a safe no-op
    assert.doesNotThrow(() => canvas.setPixel(10, 10, 255, 0, 0, 255));
  });

  test('clone() produces an independent deep copy', () => {
    const original = new PixelCanvas(2, 2);
    original.setPixel(0, 0, 10, 20, 30, 255);

    const cloned = original.clone();
    assert.equal(cloned.width, original.width);
    assert.equal(cloned.height, original.height);
    assert.deepEqual(cloned.getPixel(0, 0), { r: 10, g: 20, b: 30, a: 255 });

    // Mutate cloned, original must remain untouched
    cloned.setPixel(0, 0, 99, 99, 99, 255);
    assert.deepEqual(cloned.getPixel(0, 0), { r: 99, g: 99, b: 99, a: 255 });
    assert.deepEqual(original.getPixel(0, 0), { r: 10, g: 20, b: 30, a: 255 });
  });

  test('fill() and clear() work across all pixels', () => {
    const canvas = new PixelCanvas(3, 3);
    canvas.fill(200, 150, 100, 255);

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        assert.deepEqual(canvas.getPixel(x, y), { r: 200, g: 150, b: 100, a: 255 });
      }
    }

    canvas.clear();
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        assert.deepEqual(canvas.getPixel(x, y), { r: 0, g: 0, b: 0, a: 0 });
      }
    }
  });

  test('toBuffer() returns a valid Node.js Buffer', () => {
    const canvas = new PixelCanvas(2, 2);
    canvas.setPixel(1, 1, 255, 0, 0, 255);
    const buf = canvas.toBuffer();

    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.length, 16);
    assert.equal(buf[12], 255); // (1, 1) -> index (1*2+1)*4 = 12
    assert.equal(buf[13], 0);
    assert.equal(buf[14], 0);
    assert.equal(buf[15], 255);
  });
});
