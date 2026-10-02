import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { processImage, PostProcessor } from '../../studio/server/post-processing/post-processor.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';
import { decodePng } from '../../studio/server/post-processing/png-decoder.js';

describe('Post-Processor Unit Test Suite', () => {
  test('Complete pipeline processes raw image into framed, quantized PNG', () => {
    // Create an 8x8 input image with white background and a 4x4 red square in the center
    const inputW = 8;
    const inputH = 8;
    const inputRgba = Buffer.alloc(inputW * inputH * 4);
    for (let i = 0; i < inputRgba.length; i += 4) {
      inputRgba[i] = 255;
      inputRgba[i + 1] = 255;
      inputRgba[i + 2] = 255;
      inputRgba[i + 3] = 255;
    }
    // Red center (2, 2) to (5, 5)
    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        const idx = (y * inputW + x) * 4;
        inputRgba[idx] = 255;
        inputRgba[idx + 1] = 0;
        inputRgba[idx + 2] = 0;
        inputRgba[idx + 3] = 255;
      }
    }

    const rawPng = encodePng(inputW, inputH, inputRgba);

    // Process to 16x16 with PICO-8 palette and padding: 2
    const result = processImage(rawPng, {
      removeBg: true,
      targetWidth: 16,
      targetHeight: 16,
      padding: 2,
      palette: 'pico-8'
    });

    assert.ok(Buffer.isBuffer(result.processedBuffer));
    assert.equal(result.width, 16);
    assert.equal(result.height, 16);
    assert.equal(result.metadata.palette, 'pico-8');
    assert.ok(result.metadata.erasedCount > 0);

    // Decode processed PNG to verify dimensions and pixel values
    const decoded = decodePng(result.processedBuffer);
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 16);

    // Corners should be transparent
    assert.equal(decoded.getPixel(0, 0).a, 0);
    assert.equal(decoded.getPixel(15, 15).a, 0);

    // Center should be red (PICO-8 red #FF004D -> [255, 0, 77])
    const center = decoded.getPixel(8, 8);
    assert.equal(center.a, 255);
    assert.equal(center.r, 255);
  });

  test('PostProcessor class instance works with default options and overrides', () => {
    const proc = new PostProcessor({
      targetWidth: 32,
      targetHeight: 32,
      palette: 'gameboy-4'
    });

    const simplePng = encodePng(2, 2, Buffer.from([
      0, 255, 0, 255,  0, 255, 0, 255,
      0, 255, 0, 255,  0, 255, 0, 255
    ]));

    const res = proc.process(simplePng, { targetWidth: 8, targetHeight: 8 });
    assert.equal(res.width, 8);
    assert.equal(res.height, 8);
    assert.equal(res.metadata.palette, 'gameboy-4');
  });
});
