/**
 * PixelCanvas: A pure 2D RGBA canvas for pixel-manipulation and post-processing.
 * Local-first, zero external dependencies, 4-byte-per-pixel RGBA layout.
 */
export class PixelCanvas {
  /**
   * @param {number} width - Positive integer <= 2048
   * @param {number} height - Positive integer <= 2048
   * @param {Uint8ClampedArray|Uint8Array|Buffer|null} [data] - Flat RGBA buffer (width * height * 4)
   */
  constructor(width, height, data = null) {
    if (!Number.isInteger(width) || width <= 0 || width > 2048) {
      throw new Error(`Invalid canvas width: ${width}. Must be integer between 1 and 2048.`);
    }
    if (!Number.isInteger(height) || height <= 0 || height > 2048) {
      throw new Error(`Invalid canvas height: ${height}. Must be integer between 1 and 2048.`);
    }
    if (width * height > 4194304) {
      throw new Error(`Total pixel count exceeds 4,194,304 limit: ${width * height}`);
    }

    this.width = width;
    this.height = height;

    const expectedLength = width * height * 4;
    if (data !== null) {
      if (data.length !== expectedLength) {
        throw new Error(`Invalid pixel buffer length: expected ${expectedLength}, got ${data.length}`);
      }
      this.data = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.data = new Uint8ClampedArray(expectedLength);
    }
  }

  /**
   * Gets RGBA color at (x, y). Returns null if outside canvas bounds.
   * @param {number} x
   * @param {number} y
   * @returns {{ r: number, g: number, b: number, a: number } | null}
   */
  getPixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    const idx = (y * this.width + x) * 4;
    return {
      r: this.data[idx],
      g: this.data[idx + 1],
      b: this.data[idx + 2],
      a: this.data[idx + 3]
    };
  }

  /**
   * Sets RGBA color at (x, y). Silent no-op if outside canvas bounds.
   * @param {number} x
   * @param {number} y
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} a
   */
  setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    const idx = (y * this.width + x) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  /**
   * Returns flat byte offset for (x, y).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getIndex(x, y) {
    return (y * this.width + x) * 4;
  }

  /**
   * Clones this PixelCanvas with an independent copy of pixel data.
   * @returns {PixelCanvas}
   */
  clone() {
    const copy = new Uint8ClampedArray(this.data);
    return new PixelCanvas(this.width, this.height, copy);
  }

  /**
   * Exports data as a Node.js Buffer.
   * @returns {Buffer}
   */
  toBuffer() {
    return Buffer.from(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }

  /**
   * Fills the entire canvas with a specific RGBA color.
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} a
   */
  fill(r, g, b, a) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = a;
    }
  }

  /**
   * Clears the entire canvas to transparent black (0, 0, 0, 0).
   */
  clear() {
    this.data.fill(0);
  }
}
