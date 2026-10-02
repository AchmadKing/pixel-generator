import zlib from 'node:zlib';
import { crc32 } from '../providers/png-builder.js';
import { PixelCanvas } from './pixel-canvas.js';

export class UnsupportedPngError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedPngError';
  }
}

export class CorruptedPngError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CorruptedPngError';
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const MAX_PNG_FILE_SIZE = 20 * 1024 * 1024; // 20 MiB limit

/**
 * Paeth predictor according to RFC 2083.
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes a PNG buffer into a PixelCanvas.
 * Supports Color Types 0 (Grayscale), 2 (RGB), 3 (Indexed), and 6 (RGBA), 8-bit, non-interlaced.
 * Zero external npm dependencies.
 * 
 * @param {Buffer} buffer - Raw PNG file buffer
 * @param {object} [options]
 * @param {boolean} [options.strictTrns=false] - If true, throws CorruptedPngError when tRNS sample > 0x00FF
 * @returns {PixelCanvas}
 */
export function decodePng(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new CorruptedPngError('Input must be a Node.js Buffer');
  }

  // 1. Fail-fast file size limit (20 MiB)
  if (buffer.length > MAX_PNG_FILE_SIZE) {
    throw new UnsupportedPngError(`PNG file size exceeds 20 MiB limit: ${buffer.length} bytes`);
  }

  // 2. Validate PNG 8-byte signature
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new CorruptedPngError('Invalid PNG signature');
  }

  let offset = 8;
  let seenIHDR = false;
  let seenPLTE = false;
  let seenIDAT = false;
  let seenIEND = false;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;

  let palette = null; // Array of { r, g, b }
  let trnsData = null; // Object or Uint8Array
  const idatChunks = [];

  while (offset < buffer.length) {
    if (seenIEND) {
      throw new CorruptedPngError('Unexpected data encountered after IEND chunk');
    }

    if (offset + 8 > buffer.length) {
      throw new CorruptedPngError('Truncated PNG chunk header');
    }

    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkLength;
    const chunkTotalEnd = chunkDataEnd + 4; // includes CRC

    if (chunkTotalEnd > buffer.length) {
      throw new CorruptedPngError(`Truncated PNG chunk: ${chunkType}`);
    }

    // Reserved bit check: character 3 must be uppercase (bit 5 === 0)
    if ((chunkType.charCodeAt(2) & 0x20) !== 0) {
      throw new CorruptedPngError(`Invalid chunk type: reserved bit is set: ${chunkType}`);
    }

    // CRC-32 verification
    const expectedCrc = buffer.readUInt32BE(chunkDataEnd);
    const typeBuf = buffer.subarray(offset + 4, offset + 8);
    const dataBuf = buffer.subarray(chunkDataStart, chunkDataEnd);
    const actualCrc = crc32([typeBuf, dataBuf]);
    if (actualCrc !== expectedCrc) {
      throw new CorruptedPngError(`CRC mismatch in chunk ${chunkType}: expected ${expectedCrc}, got ${actualCrc}`);
    }

    // IHDR validation
    if (!seenIHDR) {
      if (chunkType !== 'IHDR') {
        throw new CorruptedPngError('First chunk must be IHDR');
      }
      if (chunkLength !== 13) {
        throw new CorruptedPngError(`Invalid IHDR chunk length: expected 13, got ${chunkLength}`);
      }

      width = dataBuf.readUInt32BE(0);
      height = dataBuf.readUInt32BE(4);
      bitDepth = dataBuf.readUInt8(8);
      colorType = dataBuf.readUInt8(9);
      compressionMethod = dataBuf.readUInt8(10);
      filterMethod = dataBuf.readUInt8(11);
      interlaceMethod = dataBuf.readUInt8(12);

      // Dimension and pixel count bounds
      if (width < 1 || width > 2048 || height < 1 || height > 2048) {
        throw new UnsupportedPngError(`Unsupported PNG dimensions: ${width}x${height}. Max allowed is 2048x2048.`);
      }
      if (width * height > 4194304) {
        throw new UnsupportedPngError(`Total pixel count exceeds 4,194,304 limit: ${width * height}`);
      }

      // Bit depth: strictly 8-bit per channel
      if (bitDepth !== 8) {
        throw new UnsupportedPngError(`Unsupported bit depth: ${bitDepth}. Only 8-bit depth is supported.`);
      }

      // Compression and filter method
      if (compressionMethod !== 0) {
        throw new UnsupportedPngError(`Unsupported compression method: ${compressionMethod}`);
      }
      if (filterMethod !== 0) {
        throw new UnsupportedPngError(`Unsupported filter method: ${filterMethod}`);
      }

      // Non-interlaced only
      if (interlaceMethod !== 0) {
        throw new UnsupportedPngError('Interlaced PNG is not supported');
      }

      // Supported color types: 0 (Grayscale), 2 (RGB), 3 (Indexed), 6 (RGBA)
      if (colorType !== 0 && colorType !== 2 && colorType !== 3 && colorType !== 6) {
        throw new UnsupportedPngError(`Unsupported color type: ${colorType}`);
      }

      seenIHDR = true;
      offset = chunkTotalEnd;
      continue;
    }

    // Subsequent chunks handling
    if (chunkType === 'IHDR') {
      throw new CorruptedPngError('Duplicate IHDR chunk');
    }

    if (chunkType === 'PLTE') {
      if (seenPLTE) {
        throw new CorruptedPngError('Duplicate PLTE chunk');
      }
      if (seenIDAT) {
        throw new CorruptedPngError('PLTE chunk must precede IDAT');
      }
      if (colorType === 0) {
        throw new CorruptedPngError('PLTE chunk forbidden for grayscale images');
      }
      if (chunkLength % 3 !== 0 || chunkLength < 3 || chunkLength > 768) {
        throw new CorruptedPngError(`Invalid PLTE length: ${chunkLength}. Must be divisible by 3 and between 3 and 768.`);
      }

      palette = [];
      for (let i = 0; i < chunkLength; i += 3) {
        palette.push({
          r: dataBuf[i],
          g: dataBuf[i + 1],
          b: dataBuf[i + 2]
        });
      }
      seenPLTE = true;
      offset = chunkTotalEnd;
      continue;
    }

    if (chunkType === 'tRNS') {
      if (trnsData !== null) {
        throw new CorruptedPngError('Duplicate tRNS chunk');
      }
      if (seenIDAT) {
        throw new CorruptedPngError('tRNS chunk must precede IDAT');
      }
      if (colorType === 6) {
        throw new CorruptedPngError('tRNS chunk forbidden for RGBA images');
      }

      if (colorType === 0) {
        // Grayscale: 2 bytes
        if (chunkLength !== 2) {
          throw new CorruptedPngError(`Invalid tRNS chunk length for grayscale: expected 2, got ${chunkLength}`);
        }
        const rawVal = dataBuf.readUInt16BE(0);
        if (options.strictTrns && rawVal > 0x00FF) {
          throw new CorruptedPngError(`Strict tRNS violation: sample value exceeds 8-bit range: ${rawVal}`);
        }
        trnsData = { gray: rawVal & 0x00FF };
      } else if (colorType === 2) {
        // RGB: 6 bytes
        if (chunkLength !== 6) {
          throw new CorruptedPngError(`Invalid tRNS chunk length for RGB: expected 6, got ${chunkLength}`);
        }
        const rawR = dataBuf.readUInt16BE(0);
        const rawG = dataBuf.readUInt16BE(2);
        const rawB = dataBuf.readUInt16BE(4);
        if (options.strictTrns && (rawR > 0x00FF || rawG > 0x00FF || rawB > 0x00FF)) {
          throw new CorruptedPngError(`Strict tRNS violation: sample value exceeds 8-bit range: [${rawR}, ${rawG}, ${rawB}]`);
        }
        trnsData = {
          r: rawR & 0x00FF,
          g: rawG & 0x00FF,
          b: rawB & 0x00FF
        };
      } else if (colorType === 3) {
        // Indexed: up to palette.length bytes
        if (!seenPLTE || !palette) {
          throw new CorruptedPngError('tRNS chunk before PLTE chunk for indexed color image');
        }
        if (chunkLength > palette.length) {
          throw new CorruptedPngError(`tRNS chunk length (${chunkLength}) exceeds palette entry count (${palette.length})`);
        }
        trnsData = new Uint8Array(chunkLength);
        for (let i = 0; i < chunkLength; i++) {
          trnsData[i] = dataBuf[i];
        }
      }

      offset = chunkTotalEnd;
      continue;
    }

    if (chunkType === 'IDAT') {
      if (colorType === 3 && !seenPLTE) {
        throw new CorruptedPngError('PLTE chunk missing for indexed color image');
      }
      seenIDAT = true;
      idatChunks.push(dataBuf);
      offset = chunkTotalEnd;
      continue;
    }

    if (chunkType === 'IEND') {
      if (!seenIDAT) {
        throw new CorruptedPngError('IEND chunk encountered before IDAT');
      }
      if (chunkLength !== 0) {
        throw new CorruptedPngError('IEND chunk length must be 0');
      }
      seenIEND = true;
      offset = chunkTotalEnd;
      break;
    }

    // Ignore other ancillary chunks (tEXt, zTXt, iCCP, pHYs, etc.)
    offset = chunkTotalEnd;
  }

  if (!seenIEND) {
    throw new CorruptedPngError('Missing IEND chunk');
  }

  // 3. Decompress IDAT payload
  let bpp = 1;
  if (colorType === 2) bpp = 3;
  else if (colorType === 6) bpp = 4;

  const scanlineDataLength = width * bpp;
  const expectedUncompressedBytes = height * (1 + scanlineDataLength);
  const concatenatedIdat = Buffer.concat(idatChunks);

  let inflated;
  try {
    inflated = zlib.inflateSync(concatenatedIdat, { maxOutputLength: expectedUncompressedBytes });
  } catch (zlibErr) {
    throw new CorruptedPngError(`Deflate decompression failed: ${zlibErr.message}`);
  }

  if (inflated.length !== expectedUncompressedBytes) {
    throw new CorruptedPngError(`Decompressed scanline length mismatch: expected ${expectedUncompressedBytes}, got ${inflated.length}`);
  }

  // 4. RFC 2083 Unfiltering
  const unfiltered = Buffer.alloc(height * scanlineDataLength);
  const stride = 1 + scanlineDataLength;

  for (let y = 0; y < height; y++) {
    const rawLineOffset = y * stride;
    const filterType = inflated[rawLineOffset];
    const outLineOffset = y * scanlineDataLength;

    if (filterType < 0 || filterType > 4) {
      throw new CorruptedPngError(`Unknown filter type: ${filterType} at scanline ${y}`);
    }

    for (let x = 0; x < scanlineDataLength; x++) {
      const raw = inflated[rawLineOffset + 1 + x];
      const prior = y > 0 ? unfiltered[(y - 1) * scanlineDataLength + x] : 0;
      const left = x >= bpp ? unfiltered[outLineOffset + x - bpp] : 0;
      const priorLeft = (y > 0 && x >= bpp) ? unfiltered[(y - 1) * scanlineDataLength + x - bpp] : 0;

      let val = 0;
      switch (filterType) {
        case 0: // None
          val = raw;
          break;
        case 1: // Sub
          val = (raw + left) & 0xFF;
          break;
        case 2: // Up
          val = (raw + prior) & 0xFF;
          break;
        case 3: // Average
          val = (raw + Math.floor((left + prior) / 2)) & 0xFF;
          break;
        case 4: // Paeth
          val = (raw + paethPredictor(left, prior, priorLeft)) & 0xFF;
          break;
      }
      unfiltered[outLineOffset + x] = val;
    }
  }

  // 5. Convert to PixelCanvas (RGBA 8-bit)
  const canvas = new PixelCanvas(width, height);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * scanlineDataLength;

    for (let x = 0; x < width; x++) {
      if (colorType === 6) {
        // RGBA
        const offsetPix = lineOffset + x * 4;
        const r = unfiltered[offsetPix];
        const g = unfiltered[offsetPix + 1];
        const b = unfiltered[offsetPix + 2];
        const a = unfiltered[offsetPix + 3];
        canvas.setPixel(x, y, r, g, b, a);
      } else if (colorType === 2) {
        // RGB
        const offsetPix = lineOffset + x * 3;
        const r = unfiltered[offsetPix];
        const g = unfiltered[offsetPix + 1];
        const b = unfiltered[offsetPix + 2];
        let a = 255;
        if (trnsData && trnsData.r === r && trnsData.g === g && trnsData.b === b) {
          a = 0;
        }
        canvas.setPixel(x, y, r, g, b, a);
      } else if (colorType === 3) {
        // Indexed-color
        const paletteIdx = unfiltered[lineOffset + x];
        if (paletteIdx >= palette.length) {
          throw new CorruptedPngError(`Palette index out of bounds: ${paletteIdx} >= ${palette.length}`);
        }
        const entry = palette[paletteIdx];
        let a = 255;
        if (trnsData && paletteIdx < trnsData.length) {
          a = trnsData[paletteIdx];
        }
        canvas.setPixel(x, y, entry.r, entry.g, entry.b, a);
      } else if (colorType === 0) {
        // Grayscale
        const gray = unfiltered[lineOffset + x];
        let a = 255;
        if (trnsData && trnsData.gray === gray) {
          a = 0;
        }
        canvas.setPixel(x, y, gray, gray, gray, a);
      }
    }
  }

  return canvas;
}
