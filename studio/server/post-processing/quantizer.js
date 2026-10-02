import { PixelCanvas } from './pixel-canvas.js';

export const PALETTES = {
  'endesga-32': [
    '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'
  ],
  'pico-8': [
    '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
    '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'
  ],
  'gameboy-4': [
    '#0F380F', '#306230', '#8BAC0F', '#9BBC0F'
  ],
  'nes-54': [
    '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020', '#A81000', '#881400',
    '#503000', '#007800', '#006800', '#005800', '#004058', '#000000', '#BCBCBC', '#0078F8',
    '#0058F8', '#6844FC', '#D800CC', '#E40058', '#F83800', '#E45C10', '#AC7C00', '#00B800',
    '#00A800', '#00A844', '#008888', '#F8F8F8', '#3CBCFC', '#6888FC', '#9878F8', '#F878F8',
    '#F85898', '#F87858', '#FCA044', '#F8B800', '#B8F818', '#58D854', '#58F898', '#00E8D8',
    '#787878', '#FCFCFC', '#A4E4FC', '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0',
    '#FCE0A8', '#F8D878', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC'
  ]
};

/**
 * Parses a hex color string (#RGB, #RRGGBB) to { r, g, b }.
 */
export function hexToRgb(hex) {
  let cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 0xFF,
    g: (num >> 8) & 0xFF,
    b: num & 0xFF
  };
}

/**
 * Normalizes input palette (array of hex strings, [r, g, b], or { r, g, b }) into an array of { r, g, b }.
 */
export function normalizePalette(palette) {
  if (typeof palette === 'string') {
    const preset = PALETTES[palette.toLowerCase()];
    if (!preset) {
      throw new Error(`Unknown palette preset: ${palette}`);
    }
    return preset.map(hexToRgb);
  }

  if (!Array.isArray(palette) || palette.length === 0) {
    throw new Error('Palette must be a non-empty array or a known palette name.');
  }

  return palette.map(item => {
    if (typeof item === 'string') return hexToRgb(item);
    if (Array.isArray(item)) return { r: item[0], g: item[1], b: item[2] };
    if (typeof item === 'object' && item !== null) {
      return { r: item.r, g: item.g, b: item.b };
    }
    throw new Error(`Invalid palette color format: ${JSON.stringify(item)}`);
  });
}

/**
 * Finds the index and RGB of the closest palette color using Weighted Squared RGB Distance.
 * Luma weights: 0.30 R, 0.59 G, 0.11 B.
 * 
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Array<{ r: number, g: number, b: number }>} paletteRgbList
 * @returns {{ index: number, color: { r: number, g: number, b: number }, distance: number }}
 */
export function findClosestPaletteColor(r, g, b, paletteRgbList) {
  let minDistance = Infinity;
  let closestIndex = 0;

  for (let i = 0; i < paletteRgbList.length; i++) {
    const p = paletteRgbList[i];
    const dr = r - p.r;
    const dg = g - p.g;
    const db = b - p.b;

    // Weighted Squared RGB Distance (0.30 R, 0.59 G, 0.11 B)
    const dist = 0.30 * (dr * dr) + 0.59 * (dg * dg) + 0.11 * (db * db);

    if (dist < minDistance) {
      minDistance = dist;
      closestIndex = i;
    }
  }

  return {
    index: closestIndex,
    color: paletteRgbList[closestIndex],
    distance: minDistance
  };
}

/**
 * Quantizes colors of a PixelCanvas to a retro palette.
 * Preserves transparency and crisp pixel art contours.
 * 
 * @param {PixelCanvas} canvas - Input canvas (mutated or cloned depending on options)
 * @param {string|Array} palette - Palette preset name or array of colors
 * @param {object} [options]
 * @param {boolean} [options.mutate=false] - If true, mutates input canvas in-place; otherwise clones
 * @param {number} [options.alphaThreshold=128] - Pixels with alpha < threshold become 0, >= threshold become 255
 * @returns {PixelCanvas}
 */
export function quantizeColors(canvas, palette = 'endesga-32', options = {}) {
  const normalizedPalette = normalizePalette(palette);
  const targetCanvas = options.mutate ? canvas : canvas.clone();
  const alphaThreshold = typeof options.alphaThreshold === 'number' ? options.alphaThreshold : 128;

  for (let y = 0; y < targetCanvas.height; y++) {
    for (let x = 0; x < targetCanvas.width; x++) {
      const p = targetCanvas.getPixel(x, y);

      if (p.a < alphaThreshold) {
        // Completely transparent
        targetCanvas.setPixel(x, y, 0, 0, 0, 0);
      } else {
        const closest = findClosestPaletteColor(p.r, p.g, p.b, normalizedPalette);
        targetCanvas.setPixel(x, y, closest.color.r, closest.color.g, closest.color.b, 255);
      }
    }
  }

  return targetCanvas;
}
