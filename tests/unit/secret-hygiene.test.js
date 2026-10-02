import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecret, ProviderError, ProviderSubmitError, ProviderAuthError } from '../../studio/server/providers/provider-interface.js';
import { FalProvider } from '../../studio/server/providers/fal-provider.js';

test('Secret Hygiene & FAL_KEY Redaction Suite', async (t) => {
  const SECRET_KEY = 'fal_live_super_secret_key_abcdef987654321';

  await t.test('redactSecret replaces secret with [REDACTED]', () => {
    const input = `Error: Request failed with authorization Key ${SECRET_KEY} at endpoint https://queue.fal.run`;
    const cleaned = redactSecret(input, SECRET_KEY);

    assert.equal(cleaned.includes(SECRET_KEY), false, 'Cleaned string must not contain secret key');
    assert.ok(cleaned.includes('[REDACTED]'), 'Must replace with [REDACTED]');
  });

  await t.test('redactSecret handles null, undefined, and short strings gracefully', () => {
    assert.equal(redactSecret(null, SECRET_KEY), '');
    assert.equal(redactSecret(undefined, SECRET_KEY), '');
    assert.equal(redactSecret('sample', null), 'sample');
    assert.equal(redactSecret('sample', 'abc'), 'sample'); // Key too short (< 4) is skipped
  });

  await t.test('ProviderError sanitizes message and stack trace', () => {
    const rawError = new Error(`Connection failed with credentials: ${SECRET_KEY}`);
    const providerErr = new ProviderError(
      `Failed to authenticate with ${SECRET_KEY}`, 
      rawError, 
      SECRET_KEY
    );

    assert.equal(providerErr.message.includes(SECRET_KEY), false);
    assert.ok(providerErr.message.includes('[REDACTED]'));

    if (providerErr.stack) {
      assert.equal(providerErr.stack.includes(SECRET_KEY), false);
    }
  });

  await t.test('FalProvider scrubs FAL_KEY from thrown errors when network/API leaks it', async () => {
    const mockFetch = async () => {
      // Simulate raw network exception leaking the key
      throw new Error(`ETIMEDOUT while connecting with Key ${SECRET_KEY}`);
    };

    const provider = new FalProvider({ fetchFn: mockFetch, requestTimeoutMs: 100 }, SECRET_KEY);
    let capturedErr;
    try {
      await provider.generate({ id: 'job_secret_test' });
    } catch (err) {
      capturedErr = err;
    }

    assert.ok(capturedErr);
    assert.equal(capturedErr.message.includes(SECRET_KEY), false, 'Captured error message must NOT leak key');
    assert.ok(capturedErr.message.includes('[REDACTED]'));
    if (capturedErr.stack) {
      assert.equal(capturedErr.stack.includes(SECRET_KEY), false, 'Stack trace must NOT leak key');
    }
  });
});
