import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PixelCanvas } from '../../studio/server/post-processing/pixel-canvas.js';
import {
  hexToRgb,
  normalizePalette,
  findClosestPaletteColor,
  quantizeColors,
  PALETTES
} from '../../studio/server/post-processing/quantizer.js';

describe('Quantizer Unit Test Suite', () => {
  test('hexToRgb parses 3-character and 6-character hex strings accurately', () => {
    assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
    assert.deepEqual(hexToRgb('#000'), { r: 0, g: 0, b: 0 });
    assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
    assert.deepEqual(hexToRgb('1D2B53'), { r: 29, g: 43, b: 83 });
  });

  test('normalizePalette accepts preset names and custom arrays', () => {
    const p8 = normalizePalette('pico-8');
    assert.equal(p8.length, 16);
    assert.deepEqual(p8[0], { r: 0, g: 0, b: 0 });

    const gb = normalizePalette('gameboy-4');
    assert.equal(gb.length, 4);

    const custom = normalizePalette(['#ff0000', [0, 255, 0], { r: 0, g: 0, b: 255 }]);
    assert.equal(custom.length, 3);
    assert.deepEqual(custom[0], { r: 255, g: 0, b: 0 });
    assert.deepEqual(custom[1], { r: 0, g: 255, b: 0 });
    assert.deepEqual(custom[2], { r: 0, g: 0, b: 255 });
  });

  test('Weighted Squared RGB Distance prioritizes luma (green > red > blue)', () => {
    // Suppose reference is gray (100, 100, 100)
    // Option A: green delta +10 (100, 110, 100) -> dist = 0.59 * 100 = 59
    // Option B: blue delta +10 (100, 100, 110) -> dist = 0.11 * 100 = 11
    // Option B has lower distance because human eyes are less sensitive to blue!
    const palette = [
      { r: 100, g: 110, b: 100 },
      { r: 100, g: 100, b: 110 }
    ];

    const match = findClosestPaletteColor(100, 100, 100, palette);
    assert.equal(match.index, 1); // Blue shift preferred over green shift under luma weighting
    assert.deepEqual(match.color, { r: 100, g: 100, b: 110 });
  });

  test('quantizeColors maps colors to retro palette and preserves transparency', () => {
    const canvas = new PixelCanvas(2, 2);
    // (0, 0): transparent
    canvas.setPixel(0, 0, 100, 100, 100, 0);
    // (1, 0): semi-transparent below threshold (100) -> becomes transparent
    canvas.setPixel(1, 0, 255, 255, 255, 50);
    // (0, 1): lime green -> should map to gameboy bright green
    canvas.setPixel(0, 1, 150, 200, 30, 255);
    // (1, 1): dark color -> should map to darkest gameboy green
    canvas.setPixel(1, 1, 10, 30, 10, 255);

    const quantized = quantizeColors(canvas, 'gameboy-4', { alphaThreshold: 128 });

    // Verify transparency
    assert.equal(quantized.getPixel(0, 0).a, 0);
    assert.equal(quantized.getPixel(1, 0).a, 0);

    // Verify non-transparent are exact gameboy-4 colors
    const gbPalette = normalizePalette('gameboy-4');
    const p01 = quantized.getPixel(0, 1);
    assert.equal(p01.a, 255);
    const matchesGb01 = gbPalette.some(c => c.r === p01.r && c.g === p01.g && c.b === p01.b);
    assert.ok(matchesGb01, 'Pixel (0, 1) should be in gameboy palette');

    const p11 = quantized.getPixel(1, 1);
    assert.equal(p11.a, 255);
    const matchesGb11 = gbPalette.some(c => c.r === p11.r && c.g === p11.g && c.b === p11.b);
    assert.ok(matchesGb11, 'Pixel (1, 1) should be in gameboy palette');
  });
});
