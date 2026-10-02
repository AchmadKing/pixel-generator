import test from 'node:test';
import assert from 'node:assert/strict';
import { FalProvider, validateImageUrl } from '../../studio/server/providers/fal-provider.js';
import { 
  ProviderAuthError, 
  ProviderSubmitError, 
  ProviderPollError, 
  ProviderTimeoutError, 
  ProviderValidationError 
} from '../../studio/server/providers/provider-interface.js';
import { encodePng } from '../../studio/server/providers/png-builder.js';

test('Fal.ai Queue Provider Mock HTTP & Billing Safety Suite', async (t) => {
  const FAKE_KEY = 'fal_test_secret_key_12345';
  const VALID_PNG_BUFFER = encodePng(32, 32, new Uint8Array(32 * 32 * 4));

  await t.test('Availability check reflects FAL_KEY presence', () => {
    const unauthed = new FalProvider({}, '');
    assert.equal(unauthed.isAvailable(), false);

    const authed = new FalProvider({}, FAKE_KEY);
    assert.equal(authed.isAvailable(), true);
  });

  await t.test('Throws ProviderAuthError immediately if FAL_KEY is missing upon generate()', async () => {
    const provider = new FalProvider({}, '');
    await assert.rejects(
      () => provider.generate({ id: 'job_no_key' }),
      ProviderAuthError
    );
  });

  await t.test('Happy Path: Complete 4-stage lifecycle (Submit -> Poll -> Result -> Download)', async () => {
    let submitCallCount = 0;
    let pollCallCount = 0;
    let resultCallCount = 0;
    let downloadCallCount = 0;

    const mockFetch = async (url, options = {}) => {
      const urlStr = url.toString();

      // 1. Submit POST
      if (urlStr === 'https://queue.fal.run/fal-ai/flux-lora' && options.method === 'POST') {
        submitCallCount++;
        // Verify payload explicitly includes output_format: 'png'
        const body = JSON.parse(options.body);
        assert.equal(body.output_format, 'png');
        assert.equal(body.prompt, 'pixel art ruby sword');
        return {
          ok: true,
          status: 200,
          json: async () => ({ request_id: 'req_success_001', status_url: '...' })
        };
      }

      // 2. Status Poll GET
      if (urlStr.includes('/requests/req_success_001/status')) {
        pollCallCount++;
        if (pollCallCount === 1) {
          return { ok: true, status: 200, json: async () => ({ status: 'IN_QUEUE' }) };
        }
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
      }

      // 3. Result Fetch GET
      if (urlStr === 'https://queue.fal.run/fal-ai/flux-lora/requests/req_success_001') {
        resultCallCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            images: [{ url: 'https://fal.media/files/monkey/sample.png', content_type: 'image/png' }]
          })
        };
      }

      // 4. Download Image GET
      if (urlStr === 'https://fal.media/files/monkey/sample.png') {
        downloadCallCount++;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: async () => Uint8Array.from(VALID_PNG_BUFFER).buffer
        };
      }

      throw new Error(`Unexpected fetch call to: ${urlStr}`);
    };

    const provider = new FalProvider({
      fetchFn: mockFetch,
      pollIntervalMs: 10
    }, FAKE_KEY);

    const lifecycleLog = [];
    const hooks = {
      onSubmitting: () => lifecycleLog.push('submitting'),
      onSubmitted: (job, id) => lifecycleLog.push(`submitted:${id}`),
      onPolling: (job, d) => lifecycleLog.push(`polling:${d.status}`),
      onDownloading: () => lifecycleLog.push('downloading')
    };

    const job = {
      id: 'job_happy_01',
      request_payload: { prompt: 'pixel art ruby sword', width: 32, height: 32 }
    };

    const result = await provider.generate(job, hooks);

    assert.equal(submitCallCount, 1);
    assert.equal(pollCallCount, 2);
    assert.equal(resultCallCount, 1);
    assert.equal(downloadCallCount, 1);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.width, 32);
    assert.equal(result.height, 32);
    assert.deepEqual(lifecycleLog, [
      'submitting',
      'submitted:req_success_001',
      'polling:IN_QUEUE',
      'polling:COMPLETED',
      'downloading'
    ]);
  });

  await t.test('Submit 401 Unauthorized fails immediately with ProviderAuthError (0 retries)', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return { ok: false, status: 401, text: async () => 'Invalid Key' };
    };

    const provider = new FalProvider({ fetchFn: mockFetch }, FAKE_KEY);
    await assert.rejects(
      () => provider.generate({ id: 'job_401' }),
      ProviderAuthError
    );
    assert.equal(callCount, 1, 'Submit must NOT retry on 401');
  });

  await t.test('Submit 429 Rate Limit fails immediately with ambiguous submit error (ZERO retries)', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return { ok: false, status: 429, text: async () => 'Rate Limited' };
    };

    const provider = new FalProvider({ fetchFn: mockFetch }, FAKE_KEY);
    let capturedErr;
    try {
      await provider.generate({ id: 'job_429' });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr instanceof ProviderSubmitError, 'Must throw ProviderSubmitError');
    assert.equal(capturedErr.isAmbiguous, true, 'Submit 429 must be flagged as ambiguous');
    assert.ok(capturedErr.message.includes('[AMBIGUOUS_SUBMIT]'));
    assert.equal(callCount, 1, 'POST Submit MUST NEVER retry on 429 to protect billing');
  });

  await t.test('Submit 500 Server Error fails immediately with ambiguous submit error (ZERO retries)', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return { ok: false, status: 500, text: async () => 'Internal Gateway Error' };
    };

    const provider = new FalProvider({ fetchFn: mockFetch }, FAKE_KEY);
    let capturedErr;
    try {
      await provider.generate({ id: 'job_500' });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr instanceof ProviderSubmitError);
    assert.equal(capturedErr.isAmbiguous, true);
    assert.ok(capturedErr.message.includes('[AMBIGUOUS_SUBMIT]'));
    assert.equal(callCount, 1, 'POST Submit MUST NEVER retry on 500 to protect billing');
  });

  await t.test('Submit Network Abort / Timeout marks job as ambiguous submit (ZERO retries)', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    const provider = new FalProvider({ fetchFn: mockFetch, requestTimeoutMs: 50 }, FAKE_KEY);
    let capturedErr;
    try {
      await provider.generate({ id: 'job_timeout' });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr instanceof ProviderSubmitError);
    assert.equal(capturedErr.isAmbiguous, true);
    assert.ok(capturedErr.message.includes('[AMBIGUOUS_SUBMIT]'));
    assert.equal(callCount, 1, 'POST Submit MUST NEVER retry on timeout/network abort');
  });

  await t.test('Polling transient 503 error performs bounded retries then succeeds', async () => {
    let pollCount = 0;
    const mockFetch = async (url, options = {}) => {
      const u = url.toString();
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_poll_retry' }) };
      }
      if (u.includes('/status')) {
        pollCount++;
        if (pollCount === 1) return { ok: false, status: 503 }; // Transient failure 1
        if (pollCount === 2) return { ok: false, status: 502 }; // Transient failure 2
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) }; // Success on attempt 3
      }
      if (u.includes('/requests/req_poll_retry')) {
        return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://fal.media/sample.png' }] }) };
      }
      return { 
        ok: true, 
        status: 200, 
        headers: new Headers({ 'content-type': 'image/png' }), 
        arrayBuffer: async () => Uint8Array.from(VALID_PNG_BUFFER).buffer 
      };
    };

    const provider = new FalProvider({ fetchFn: mockFetch, pollIntervalMs: 5 }, FAKE_KEY);
    const res = await provider.generate({ id: 'job_retry' });
    assert.ok(res);
    assert.equal(pollCount, 3, 'Polling should have retried transient 503/502 and then completed');
  });

  await t.test('Polling 404 job throws ProviderPollError', async () => {
    const mockFetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_404' }) };
      }
      return { ok: false, status: 404 };
    };

    const provider = new FalProvider({ fetchFn: mockFetch, pollIntervalMs: 5 }, FAKE_KEY);
    await assert.rejects(
      () => provider.generate({ id: 'job_404' }),
      ProviderPollError
    );
  });

  await t.test('Total job timeout (exceeded deadline) throws ProviderTimeoutError', async () => {
    const mockFetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_slow' }) };
      }
      // Never completes
      return { ok: true, status: 200, json: async () => ({ status: 'IN_PROGRESS' }) };
    };

    const provider = new FalProvider({
      fetchFn: mockFetch,
      pollIntervalMs: 10,
      totalJobTimeoutMs: 35 // Extremely short timeout for test
    }, FAKE_KEY);

    await assert.rejects(
      () => provider.generate({ id: 'job_slow' }),
      ProviderTimeoutError
    );
  });

  await t.test('SSRF Defense: Validates URLs and blocks dangerous destinations', () => {
    // Valid hosts
    assert.ok(validateImageUrl('https://fal.media/file.png'));
    assert.ok(validateImageUrl('https://sub.fal.media/file.png'));
    assert.ok(validateImageUrl('https://storage.googleapis.com/bucket/file.png'));
    assert.ok(validateImageUrl('https://queue.fal.run/file.png'));

    // Non-HTTPS
    assert.throws(() => validateImageUrl('http://fal.media/file.png'), /must use HTTPS protocol/);

    // Credentials in URL
    assert.throws(() => validateImageUrl('https://user:pass@fal.media/file.png'), /user credentials/);

    // Localhost & Loopback
    assert.throws(() => validateImageUrl('https://localhost/file.png'), /forbidden/);
    assert.throws(() => validateImageUrl('https://127.0.0.1/file.png'), /forbidden/);

    // Private IP & Link-local (Cloud metadata)
    assert.throws(() => validateImageUrl('https://169.254.169.254/latest/meta-data/'), /forbidden/);
    assert.throws(() => validateImageUrl('https://10.0.0.1/file.png'), /forbidden/);
    assert.throws(() => validateImageUrl('https://192.168.1.1/file.png'), /forbidden/);

    // Domain spoofing attempts
    assert.throws(() => validateImageUrl('https://fake-fal.media/file.png'), /not in the allowed provider domain whitelist/);
    assert.throws(() => validateImageUrl('https://fal.media.attacker.com/file.png'), /not in the allowed provider domain whitelist/);
  });

  await t.test('Streaming download exceeding 10MB limit is rejected immediately', async () => {
    const OVERSIZED_BYTES = 11 * 1024 * 1024; // 11MB
    const mockFetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_oversized' }) };
      }
      if (url.toString().includes('/status')) {
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
      }
      if (url.toString().includes('/requests/req_oversized')) {
        return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://fal.media/big.png' }] }) };
      }
      // Return oversized stream
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new Uint8Array(OVERSIZED_BYTES).buffer
      };
    };

    const provider = new FalProvider({ fetchFn: mockFetch, pollIntervalMs: 5 }, FAKE_KEY);
    await assert.rejects(
      () => provider.generate({ id: 'job_big' }),
      /exceeds maximum size limit/
    );
  });

  await t.test('Strict PNG policy: Non-PNG format (image/jpeg) is rejected', async () => {
    const mockFetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_jpeg' }) };
      }
      if (url.toString().includes('/status')) {
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
      }
      if (url.toString().includes('/requests/req_jpeg')) {
        return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://fal.media/test.jpg' }] }) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => Buffer.from('FAKE JPEG CONTENT').buffer
      };
    };

    const provider = new FalProvider({ fetchFn: mockFetch, pollIntervalMs: 5 }, FAKE_KEY);
    await assert.rejects(
      () => provider.generate({ id: 'job_jpeg' }),
      /Only image\/png is supported/
    );
  });

  await t.test('Corrupted PNG (magic bytes mismatch) is rejected', async () => {
    const corruptBuffer = Buffer.from('NOT A VALID PNG FILE HEADER AT ALL 12345678');
    const mockFetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ request_id: 'req_corrupt' }) };
      }
      if (url.toString().includes('/status')) {
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
      }
      if (url.toString().includes('/requests/req_corrupt')) {
        return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://fal.media/corrupt.png' }] }) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => corruptBuffer.buffer
      };
    };

    const provider = new FalProvider({ fetchFn: mockFetch, pollIntervalMs: 5 }, FAKE_KEY);
    await assert.rejects(
      () => provider.generate({ id: 'job_corrupt' }),
      /Magic bytes check failed/
    );
  });
});
