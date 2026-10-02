import { BaseProvider } from './provider-interface.js';
import { encodePng } from './png-builder.js';

/**
 * Endesga-32 curated color palette (Hex to RGBA [r, g, b, a])
 */
const ENDESGA_32 = [
  [190, 74, 47, 255],   // 0: Deep Red
  [215, 118, 67, 255],  // 1: Orange Red
  [234, 212, 170, 255], // 2: Pale Skin
  [228, 166, 114, 255], // 3: Warm Peach
  [184, 111, 80, 255],  // 4: Warm Brown
  [115, 62, 57, 255],   // 5: Dark Brown
  [62, 39, 49, 255],    // 6: Deep Burgundy / Dark Outline
  [162, 38, 51, 255],   // 7: Crimson
  [228, 59, 68, 255],   // 8: Bright Red
  [247, 118, 34, 255],  // 9: Bright Orange
  [254, 174, 52, 255],  // 10: Golden Amber
  [254, 231, 97, 255],  // 11: Yellow Gold
  [99, 199, 77, 255],   // 12: Bright Green
  [62, 137, 72, 255],   // 13: Mid Green
  [38, 92, 66, 255],    // 14: Dark Pine
  [25, 60, 62, 255],    // 15: Deep Teal
  [18, 78, 137, 255],   // 16: Deep Blue
  [0, 153, 219, 255],   // 17: Sky Blue
  [44, 232, 245, 255],  // 18: Cyan / Mana
  [255, 255, 255, 255], // 19: Pure White
  [192, 203, 220, 255], // 20: Light Steel
  [139, 155, 180, 255], // 21: Slate Grey
  [90, 105, 136, 255],  // 22: Navy Grey
  [53, 43, 66, 255],    // 23: Dark Purple Slate
  [40, 31, 41, 255],    // 24: Near Black Outline
  [104, 56, 108, 255],  // 25: Plum Purple
  [181, 80, 136, 255],  // 26: Magenta
  [246, 117, 122, 255], // 27: Pink Coral
  [232, 183, 214, 255], // 28: Soft Lavender
  [0, 0, 0, 0]          // 29: Transparent
];

/**
 * SplitMix32 high-entropy 32-bit PRNG
 */
function createPrng(seed) {
  let s = (Math.abs(seed | 0) || 12345) >>> 0;
  return function next() {
    s = (s + 0x9E3779B9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD);
    z = Math.imul(z ^ (z >>> 15), 0x735A2D97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

/**
 * Derives a 32-bit integer seed from a string prompt.
 */
function hashPrompt(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class MockProvider extends BaseProvider {
  constructor() {
    super('mock', 'Mock Procedural Pixel Generator');
  }

  isAvailable() {
    return true; // 100% offline ready, no API key or network required
  }

  /**
   * Generates a deterministic pixel art asset based on seed and category.
   */
  async generate(job, hooks = {}) {
    if (hooks.onSubmitting) hooks.onSubmitting(job);

    const payload = job.request_payload || {};
    const prompt = (payload.prompt || 'pixel art item').toLowerCase();
    const category = payload.category || 'items';
    const width = Number(payload.targetWidth || payload.width || 32);
    const height = Number(payload.targetHeight || payload.height || 32);

    // Deterministic seed derivation
    const seed = payload.seed !== undefined && payload.seed !== null 
      ? Number(payload.seed) 
      : hashPrompt(prompt);

    const rand = createPrng(seed);

    // Call submitted hook with pseudo request ID
    const pseudoRequestId = `mock_req_${Math.abs(seed).toString(16).padStart(8, '0')}`;
    if (hooks.onSubmitted) {
      await hooks.onSubmitted(job, pseudoRequestId);
    }

    if (hooks.onPolling) {
      hooks.onPolling(job, { status: 'COMPLETED' });
    }

    if (hooks.onDownloading) {
      hooks.onDownloading(job);
    }

    // Allocate RGBA buffer (initialized to transparent)
    const rgba = new Uint8Array(width * height * 4);

    const setPixel = (x, y, color) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    };

    // Render category-specific procedural pixel art
    switch (category) {
      case 'characters':
        this._drawCharacter(width, height, rand, setPixel);
        break;
      case 'environment':
        this._drawEnvironment(width, height, rand, setPixel);
        break;
      case 'vfx':
        this._drawVfx(width, height, rand, setPixel);
        break;
      case 'ui':
        this._drawUi(width, height, rand, setPixel);
        break;
      case 'items':
      default:
        this._drawItem(width, height, rand, setPixel);
        break;
    }

    const imageBuffer = encodePng(width, height, rgba);

    return {
      imageBuffer,
      mimeType: 'image/png',
      width,
      height,
      seed,
      metadata: {
        provider: 'mock',
        category,
        seed,
        generator: 'procedural-mulberry32',
        palette: 'endesga-32'
      }
    };
  }

  _drawItem(w, h, rand, setPixel) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const outline = ENDESGA_32[24]; // Dark near-black
    const itemType = Math.floor(rand() * 3); // 0: Sword/Blade, 1: Potion, 2: Shield/Gem

    const swordThemes = [
      { primary: ENDESGA_32[20], shadow: ENDESGA_32[22], hilt: ENDESGA_32[10] }, // Steel & Gold
      { primary: ENDESGA_32[18], shadow: ENDESGA_32[16], hilt: ENDESGA_32[21] }, // Mana Cyan & Silver
      { primary: ENDESGA_32[8],  shadow: ENDESGA_32[0],  hilt: ENDESGA_32[24] }, // Crimson & Obsidian
      { primary: ENDESGA_32[11], shadow: ENDESGA_32[9],  hilt: ENDESGA_32[7]  }  // Golden Sun
    ];
    const potionColors = [
      { liquid: ENDESGA_32[8],  highlight: ENDESGA_32[27] }, // Crimson / Pink
      { liquid: ENDESGA_32[12], highlight: ENDESGA_32[11] }, // Green / Yellow
      { liquid: ENDESGA_32[18], highlight: ENDESGA_32[19] }, // Cyan / White
      { liquid: ENDESGA_32[25], highlight: ENDESGA_32[28] }  // Plum / Lavender
    ];
    const shieldThemes = [
      { border: ENDESGA_32[10], bg: ENDESGA_32[16], emblem: ENDESGA_32[11] }, // Gold & Blue
      { border: ENDESGA_32[21], bg: ENDESGA_32[7],  emblem: ENDESGA_32[19] }, // Silver & Crimson
      { border: ENDESGA_32[11], bg: ENDESGA_32[14], emblem: ENDESGA_32[12] }  // Gold & Pine
    ];

    if (itemType === 0) {
      // Diagonal Sword
      const theme = swordThemes[Math.floor(rand() * swordThemes.length)];
      const primary = theme.primary;
      const shadow = theme.shadow;
      const hilt = theme.hilt;

      for (let i = -Math.floor(w / 3); i <= Math.floor(w / 3); i++) {
        const px = cx + i;
        const py = cy - i;
        setPixel(px, py, primary);
        setPixel(px + 1, py, shadow);
        setPixel(px - 1, py, outline);
        setPixel(px + 2, py, outline);
        setPixel(px, py - 1, outline);
        setPixel(px, py + 1, outline);
      }
      // Crossguard
      const guardBaseX = cx - Math.floor(w / 6);
      const guardBaseY = cy + Math.floor(w / 6);
      setPixel(guardBaseX - 1, guardBaseY, hilt);
      setPixel(guardBaseX, guardBaseY + 1, hilt);
      setPixel(guardBaseX - 2, guardBaseY, outline);
      setPixel(guardBaseX, guardBaseY + 2, outline);
    } else if (itemType === 1) {
      // Potion Flask
      const pColor = potionColors[Math.floor(rand() * potionColors.length)];
      const glass = ENDESGA_32[20]; // Glass outline
      const liquid = pColor.liquid;
      const highlight = pColor.highlight;
      const cork = ENDESGA_32[4];   // Cork

      // Neck & Cork
      setPixel(cx, cy - 6, cork);
      setPixel(cx - 1, cy - 6, outline);
      setPixel(cx + 1, cy - 6, outline);

      // Bulb body
      for (let dy = -4; dy <= 6; dy++) {
        const radius = Math.floor(6 - Math.abs(dy - 2) * 0.6);
        for (let dx = -radius; dx <= radius; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (dx === -radius || dx === radius || dy === 6) {
            setPixel(px, py, outline);
          } else if (dy < 0) {
            setPixel(px, py, glass);
          } else {
            setPixel(px, py, dx < 0 ? highlight : liquid);
          }
        }
      }
    } else {
      // Shield
      const sTheme = shieldThemes[Math.floor(rand() * shieldThemes.length)];
      const border = sTheme.border;
      const shieldBg = sTheme.bg;
      const emblem = sTheme.emblem;

      for (let y = -7; y <= 7; y++) {
        const span = Math.floor(7 - Math.max(0, y - 1) * 0.9);
        for (let x = -span; x <= span; x++) {
          const px = cx + x;
          const py = cy + y;
          if (x === -span || x === span || y === -7 || y === 7) {
            setPixel(px, py, outline);
          } else if (Math.abs(x) === span - 1 || y === -6) {
            setPixel(px, py, border);
          } else if (x === 0 || y === 0) {
            setPixel(px, py, emblem);
          } else {
            setPixel(px, py, shieldBg);
          }
        }
      }
    }
  }

  _drawCharacter(w, h, rand, setPixel) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const outline = ENDESGA_32[24];
    const skin = ENDESGA_32[2];
    const armor = ENDESGA_32[16];
    const hair = ENDESGA_32[5];

    // Head
    for (let y = cy - 8; y <= cy - 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        if (y === cy - 8 || x === cx - 3 || x === cx + 3) {
          setPixel(x, y, outline);
        } else if (y <= cy - 6) {
          setPixel(x, y, hair);
        } else {
          setPixel(x, y, skin);
        }
      }
    }
    // Eyes
    setPixel(cx - 1, cy - 4, outline);
    setPixel(cx + 1, cy - 4, outline);

    // Body / Armor
    for (let y = cy - 2; y <= cy + 4; y++) {
      for (let x = cx - 4; x <= cx + 4; x++) {
        if (x === cx - 4 || x === cx + 4 || y === cy + 4) {
          setPixel(x, y, outline);
        } else {
          setPixel(x, y, armor);
        }
      }
    }

    // Legs
    for (let y = cy + 5; y <= cy + 8; y++) {
      setPixel(cx - 2, y, outline);
      setPixel(cx - 3, y, outline);
      setPixel(cx + 2, y, outline);
      setPixel(cx + 3, y, outline);
    }
  }

  _drawEnvironment(w, h, rand, setPixel) {
    const baseCol = ENDESGA_32[14]; // Dark Pine
    const highlight = ENDESGA_32[12]; // Bright Green
    const dirt = ENDESGA_32[4]; // Warm Brown

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y < Math.floor(h * 0.4)) {
          // Foliage / Grass pattern
          const p = rand();
          setPixel(x, y, p > 0.6 ? highlight : baseCol);
        } else {
          // Dirt / Stone ground with brick lines
          if (y % 4 === 0 || (x + (Math.floor(y / 4) % 2) * 4) % 8 === 0) {
            setPixel(x, y, ENDESGA_32[6]); // Grid mortar
          } else {
            setPixel(x, y, dirt);
          }
        }
      }
    }
  }

  _drawVfx(w, h, rand, setPixel) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const core = ENDESGA_32[19]; // White
    const flameInner = ENDESGA_32[11]; // Yellow
    const flameMid = ENDESGA_32[9]; // Orange
    const flameOuter = ENDESGA_32[8]; // Crimson

    for (let r = 8; r >= 1; r--) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        const dist = r + (rand() - 0.5) * 2;
        const px = Math.round(cx + Math.cos(angle) * dist);
        const py = Math.round(cy + Math.sin(angle) * dist);
        let col = flameOuter;
        if (r <= 3) col = core;
        else if (r <= 5) col = flameInner;
        else if (r <= 7) col = flameMid;
        setPixel(px, py, col);
      }
    }
  }

  _drawUi(w, h, rand, setPixel) {
    const frameDark = ENDESGA_32[24];
    const frameGold = ENDESGA_32[10];
    const frameLight = ENDESGA_32[11];
    const bgDark = ENDESGA_32[23];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
          setPixel(x, y, frameDark);
        } else if (x === 1 || x === w - 2 || y === 1 || y === h - 2) {
          setPixel(x, y, frameGold);
        } else if (x === 2 || y === 2) {
          setPixel(x, y, frameLight);
        } else {
          setPixel(x, y, bgDark);
        }
      }
    }
  }
}
