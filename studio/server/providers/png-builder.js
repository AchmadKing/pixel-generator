import zlib from 'node:zlib';

/**
 * Precomputed CRC-32 lookup table for standard PNG chunks (polynomial 0xEDB88320).
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xEDB88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  CRC_TABLE[n] = c;
}

/**
 * Computes CRC-32 over one or more Buffer slices.
 * @param {Buffer[]} buffers 
 * @returns {number}
 */
export function crc32(buffers) {
  let c = 0xFFFFFFFF;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Creates a standard PNG chunk.
 * Chunk format: Length (4 bytes) | Type (4 bytes) | Data (N bytes) | CRC32 (4 bytes over Type + Data)
 * @param {string} type - 4-character ASCII chunk type (e.g. 'IHDR', 'IDAT', 'IEND')
 * @param {Buffer} data - Chunk payload
 * @returns {Buffer}
 */
export function createPngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);

  const crcVal = crc32([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

/**
 * Encodes RGBA pixel array into a valid, standard binary PNG Buffer.
 * Zero external npm dependencies; uses built-in node:zlib.
 * 
 * @param {number} width - Image width in pixels (> 0)
 * @param {number} height - Image height in pixels (> 0)
 * @param {Uint8Array|Buffer} rgbaData - Flat RGBA byte array (length must equal width * height * 4)
 * @returns {Buffer} Standard PNG buffer
 */
export function encodePng(width, height, rgbaData) {
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid dimensions for PNG: ${width}x${height}`);
  }
  if (rgbaData.length !== width * height * 4) {
    throw new Error(`Invalid pixel data length. Expected ${width * height * 4} bytes, received ${rgbaData.length}`);
  }

  // 1. PNG Signature (8 bytes)
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // 2. IHDR Chunk (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // Bit depth: 8 bits per channel
  ihdrData.writeUInt8(6, 9);   // Color type: 6 (RGBA with alpha)
  ihdrData.writeUInt8(0, 10);  // Compression method: 0 (deflate)
  ihdrData.writeUInt8(0, 11);  // Filter method: 0 (standard adaptive filtering)
  ihdrData.writeUInt8(0, 12);  // Interlace method: 0 (no interlace)
  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  // 3. IDAT Chunk (Scanlines with Filter Byte 0x00 = None)
  const scanlineWidth = width * 4;
  const rawScanlines = Buffer.alloc(height * (1 + scanlineWidth));
  
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + scanlineWidth);
    rawScanlines[rawOffset] = 0; // Filter: 0 (None)
    const srcOffset = y * scanlineWidth;
    for (let x = 0; x < scanlineWidth; x++) {
      rawScanlines[rawOffset + 1 + x] = rgbaData[srcOffset + x];
    }
  }

  const compressedData = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = createPngChunk('IDAT', compressedData);

  // 4. IEND Chunk (Empty data)
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
