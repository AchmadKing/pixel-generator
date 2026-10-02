import { decodePng } from './png-decoder.js';
import { removeBackground } from './background-remover.js';
import { frameAndCenter } from './framer.js';
import { quantizeColors } from './quantizer.js';
import { encodePng } from '../providers/png-builder.js';

/**
 * Runs the complete post-processing pipeline on a raw PNG image buffer.
 * Pipeline stages: Decode PNG -> 4-Corner BG Removal -> Framing & Continuous Resampling -> Color Quantization -> Encode PNG.
 * 100% CPU local, zero external network or paid API calls.
 * 
 * @param {Buffer} rawImageBuffer - Input raw PNG buffer
 * @param {object} [options]
 * @param {boolean} [options.removeBg=true] - Remove background using 4-corner BFS
 * @param {number} [options.bgTolerance=25] - Color distance tolerance for background removal
 * @param {number} [options.targetWidth=32] - Output width in pixels
 * @param {number} [options.targetHeight=32] - Output height in pixels
 * @param {boolean} [options.cropToContent=true] - Crop to bounding box before centering
 * @param {number} [options.padding=0] - Inner padding in target pixels
 * @param {boolean} [options.quantize=true] - Quantize colors to target retro palette
 * @param {string|Array} [options.palette='endesga-32'] - Retro palette name or color array
 * @param {boolean} [options.strictTrns=false] - Strict tRNS audit mode
 * @returns {{ processedBuffer: Buffer, width: number, height: number, metadata: object }}
 */
export function processImage(rawImageBuffer, options = {}) {
  const removeBg = options.removeBg !== false;
  const bgTolerance = typeof options.bgTolerance === 'number' ? options.bgTolerance : 25;
  const targetWidth = typeof options.targetWidth === 'number' ? options.targetWidth : 32;
  const targetHeight = typeof options.targetHeight === 'number' ? options.targetHeight : 32;
  const cropToContent = options.cropToContent !== false;
  const padding = typeof options.padding === 'number' ? options.padding : 0;
  const quantize = options.quantize !== false;
  const palette = options.palette || 'endesga-32';
  const strictTrns = options.strictTrns === true;

  // Stage 1: PNG Decoding
  const decodedCanvas = decodePng(rawImageBuffer, { strictTrns });

  // Stage 2: Background Removal
  let bgResult = null;
  if (removeBg) {
    bgResult = removeBackground(decodedCanvas, { tolerance: bgTolerance });
  }

  // Stage 3: Framing & Continuous Resampling
  const framedCanvas = frameAndCenter(decodedCanvas, targetWidth, targetHeight, {
    cropToContent,
    padding
  });

  // Stage 4: Color Quantization
  if (quantize) {
    quantizeColors(framedCanvas, palette, { mutate: true });
  }

  // Stage 5: PNG Encoding
  const processedBuffer = encodePng(targetWidth, targetHeight, framedCanvas.data);

  return {
    processedBuffer,
    width: targetWidth,
    height: targetHeight,
    metadata: {
      removeBg,
      bgTolerance,
      erasedCount: bgResult ? bgResult.erasedCount : 0,
      excessiveErasure: bgResult ? bgResult.excessiveErasure : false,
      targetWidth,
      targetHeight,
      cropToContent,
      padding,
      quantize,
      palette: typeof palette === 'string' ? palette : 'custom'
    }
  };
}

export class PostProcessor {
  constructor(defaultOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  process(rawImageBuffer, overrideOptions = {}) {
    return processImage(rawImageBuffer, { ...this.defaultOptions, ...overrideOptions });
  }
}
