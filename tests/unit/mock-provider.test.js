import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MockProvider } from '../../studio/server/providers/mock-provider.js';
import { encodePng, crc32 } from '../../studio/server/providers/png-builder.js';

test('Mock Procedural Provider & Pure JS PNG Builder Suite', async (t) => {
  const provider = new MockProvider();

  await t.test('Provider reports availability unconditionally (100% offline ready)', () => {
    assert.equal(provider.isAvailable(), true);
    assert.equal(provider.id, 'mock');
  });

  await t.test('Determinism: Same seed + category produces identical PNG byte-for-byte', async () => {
    const jobA = {
      id: 'job_det_a',
      request_payload: {
        category: 'items',
        prompt: 'crystal magic sword',
        seed: 42,
        width: 32,
        height: 32
      }
    };

    const jobB = {
      id: 'job_det_b',
      request_payload: {
        category: 'items',
        prompt: 'crystal magic sword',
        seed: 42,
        width: 32,
        height: 32
      }
    };

    const resultA = await provider.generate(jobA);
    const resultB = await provider.generate(jobB);

    const hashA = crypto.createHash('sha256').update(resultA.imageBuffer).digest('hex');
    const hashB = crypto.createHash('sha256').update(resultB.imageBuffer).digest('hex');

    assert.equal(hashA, hashB, 'Output PNG buffers must be bit-identical for the same seed');
    assert.equal(resultA.seed, 42);
    assert.equal(resultB.seed, 42);
  });

  await t.test('Different seeds produce different image buffers', async () => {
    const job1 = { id: 'job_1', request_payload: { category: 'items', seed: 101, width: 32, height: 32 } };
    const job2 = { id: 'job_2', request_payload: { category: 'items', seed: 202, width: 32, height: 32 } };

    const res1 = await provider.generate(job1);
    const res2 = await provider.generate(job2);

    const hash1 = crypto.createHash('sha256').update(res1.imageBuffer).digest('hex');
    const hash2 = crypto.createHash('sha256').update(res2.imageBuffer).digest('hex');

    assert.notEqual(hash1, hash2, 'Different seeds should produce different outputs');
  });

  await t.test('Generates valid PNGs across all 5 asset categories', async () => {
    const categories = ['items', 'characters', 'environment', 'vfx', 'ui'];
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    for (const cat of categories) {
      const job = {
        id: `job_cat_${cat}`,
        request_payload: { category: cat, seed: 777, width: 32, height: 32 }
      };

      const result = await provider.generate(job);
      assert.ok(result.imageBuffer.length > 50, `Category ${cat} should output non-empty buffer`);
      assert.equal(result.mimeType, 'image/png');
      assert.equal(result.width, 32);
      assert.equal(result.height, 32);

      // Verify PNG Magic Bytes
      const sig = result.imageBuffer.subarray(0, 8);
      assert.deepEqual(sig, pngMagic, `Category ${cat} output must have valid PNG magic bytes`);

      // Verify IHDR Chunk
      const ihdrType = result.imageBuffer.subarray(12, 16).toString('ascii');
      assert.equal(ihdrType, 'IHDR');
      const w = result.imageBuffer.readUInt32BE(16);
      const h = result.imageBuffer.readUInt32BE(20);
      assert.equal(w, 32);
      assert.equal(h, 32);

      // Verify IEND Chunk at end
      const iendType = result.imageBuffer.subarray(result.imageBuffer.length - 8, result.imageBuffer.length - 4).toString('ascii');
      assert.equal(iendType, 'IEND');
    }
  });

  await t.test('Lifecycle hooks: onSubmitting, onSubmitted, onPolling, onDownloading are called', async () => {
    const calledHooks = [];
    const job = { id: 'job_hooks', request_payload: { seed: 1 } };
    const hooks = {
      onSubmitting: () => calledHooks.push('submitting'),
      onSubmitted: (j, id) => calledHooks.push(`submitted:${id}`),
      onPolling: () => calledHooks.push('polling'),
      onDownloading: () => calledHooks.push('downloading')
    };

    await provider.generate(job, hooks);
    assert.deepEqual(calledHooks, ['submitting', 'submitted:mock_req_00000001', 'polling', 'downloading']);
  });

  await t.test('encodePng rejects invalid dimensions or invalid data length', () => {
    assert.throws(() => encodePng(0, 32, new Uint8Array(0)), /Invalid dimensions/);
    assert.throws(() => encodePng(32, -1, new Uint8Array(0)), /Invalid dimensions/);
    assert.throws(() => encodePng(2, 2, new Uint8Array(10)), /Invalid pixel data length/);
  });

  await t.test('crc32 accurately computes checksum', () => {
    const data = Buffer.from('123456789', 'ascii');
    // Standard test vector for CRC32 of '123456789' is 0xCBF43926
    const calculated = crc32([data]);
    assert.equal(calculated, 0xCBF43926);
  });
});
