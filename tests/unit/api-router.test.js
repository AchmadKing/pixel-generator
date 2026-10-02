import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../studio/server/routes/router.js';

// Mock HTTP Request/Response helpers
function createMockReq({
  method = 'GET',
  url = '/test',
  headers = { host: '127.0.0.1:5178' },
  body = null
} = {}) {
  const listeners = {};
  const req = {
    method,
    url,
    headers,
    on(event, cb) {
      listeners[event] = cb;
      return req;
    },
    pause() {}
  };

  // Simulates stream delivery
  req._emitBody = () => {
    if (body !== null) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      if (listeners['data']) listeners['data'](Buffer.from(data));
    }
    if (listeners['end']) listeners['end']();
  };

  req._emitError = (err) => {
    if (listeners['error']) listeners['error'](err);
  };

  return req;
}

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    getHeader(key) {
      return headers[key.toLowerCase()];
    },
    end(data = '') {
      res.writableEnded = true;
      res.headersSent = true;
      res.body += data;
    }
  };
  return res;
}

test('API Router Security & Validation Suite', async (t) => {
  await t.test('Applies mandatory security headers on every response', async () => {
    const router = new Router();
    router.get('/test', (req, res) => router.sendJson(res, 200, { ok: true }));

    const req = createMockReq({ url: '/test' });
    const res = createMockRes();

    await router.handle(req, res);

    assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    assert.equal(res.getHeader('x-frame-options'), 'DENY');
    assert.equal(res.getHeader('referrer-policy'), 'strict-origin-when-cross-origin');
  });

  await t.test('Host validation: Rejects unknown / DNS rebinding host with 400', async () => {
    const router = new Router({ server: { host: '127.0.0.1' } });
    router.get('/test', (req, res) => router.sendJson(res, 200, { ok: true }));

    const req = createMockReq({
      url: '/test',
      headers: { host: 'evil-attacker.com:5178' }
    });
    const res = createMockRes();

    await router.handle(req, res);

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'ERR_INVALID_HOST');
  });

  await t.test('Origin validation: Rejects untrusted cross-origin mutating request with 403', async () => {
    const router = new Router();
    router.post('/api/action', (req, res) => router.sendJson(res, 200, { done: true }));

    const req = createMockReq({
      method: 'POST',
      url: '/api/action',
      headers: {
        host: '127.0.0.1:5178',
        origin: 'http://malicious-site.com'
      }
    });
    const res = createMockRes();

    await router.handle(req, res);

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'ERR_CROSS_ORIGIN_DENIED');
  });

  await t.test('Path traversal rejection: Rejects null bytes and traversal patterns in URI', async () => {
    const router = new Router();

    const req1 = createMockReq({ url: '/api/assets/..%2f..%2fsecret' });
    const res1 = createMockRes();
    await router.handle(req1, res1);
    assert.equal(res1.statusCode, 400);

    const req2 = createMockReq({ url: '/api/assets/foo%00bar' });
    const res2 = createMockRes();
    await router.handle(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('Parameter ID validation: Rejects non-alphanumeric IDs with 400', async () => {
    const router = new Router();
    router.get('/api/assets/:assetId', (req, res) => router.sendJson(res, 200, { id: req.params.assetId }));

    const req = createMockReq({ url: '/api/assets/invalid@id!$' });
    const res = createMockRes();

    await router.handle(req, res);

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'ERR_INVALID_PARAM');
  });

  await t.test('JSON Body Parsing: Rejects malformed JSON with 400', async () => {
    const router = new Router();
    const req = createMockReq({ method: 'POST', url: '/test', body: '{ invalid json here' });

    const promise = router.readJson(req);
    req._emitBody();

    await assert.rejects(promise, (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'ERR_MALFORMED_JSON');
      return true;
    });
  });

  await t.test('JSON Body Parsing: Rejects payload exceeding 1 MB limit with 413', async () => {
    const router = new Router();
    const req = createMockReq({
      method: 'POST',
      url: '/test',
      headers: { 'content-length': String(2 * 1024 * 1024) } // 2 MB
    });

    const promise = router.readJson(req);

    await assert.rejects(promise, (err) => {
      assert.equal(err.statusCode, 413);
      assert.equal(err.code, 'ERR_PAYLOAD_TOO_LARGE');
      return true;
    });
  });
});
