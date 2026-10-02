import path from 'node:path';

const MAX_JSON_BYTES = 1024 * 1024; // 1 MB limit

export class Router {
  constructor(config = {}) {
    this.config = config;
    this.routes = [];
  }

  add(method, pattern, handler) {
    // Convert pattern like /api/assets/:assetId/versions/:versionId into regex
    const paramNames = [];
    const regexPattern = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${regexPattern}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, paramNames, handler });
  }

  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }
  put(pattern, handler) { this.add('PUT', pattern, handler); }
  delete(pattern, handler) { this.add('DELETE', pattern, handler); }

  async handle(req, res) {
    // 1. Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 2. Host Validation (DNS Rebinding Defense)
    const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
    const allowedHosts = new Set(['localhost', '127.0.0.1']);
    if (this.config.server?.host) {
      allowedHosts.add(this.config.server.host.toLowerCase());
    }
    if (hostHeader && !allowedHosts.has(hostHeader)) {
      return this.sendError(res, 400, 'ERR_INVALID_HOST', `Invalid or untrusted Host header: ${hostHeader}`);
    }

    // 3. Origin & CSRF Validation on Mutative Requests
    const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    if (isMutating) {
      const origin = req.headers.origin || req.headers.referer;
      if (origin) {
        try {
          const parsedOrigin = new URL(origin);
          const originHost = parsedOrigin.hostname.toLowerCase();
          if (!allowedHosts.has(originHost)) {
            return this.sendError(res, 403, 'ERR_CROSS_ORIGIN_DENIED', `Cross-origin request forbidden from: ${origin}`);
          }
        } catch (_) {
          return this.sendError(res, 400, 'ERR_INVALID_ORIGIN', 'Malformed Origin or Referer header.');
        }
      }
    }

    // 4. Parse URL & Sanitize Path
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch (_) {
      return this.sendError(res, 400, 'ERR_INVALID_URL', 'Malformed request URL.');
    }

    let pathname;
    try {
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch (_) {
      return this.sendError(res, 400, 'ERR_MALFORMED_URI', 'URI malformed or invalid percent-encoding.');
    }

    // Reject null bytes or traversal characters in URL
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes('..')) {
      return this.sendError(res, 400, 'ERR_PATH_TRAVERSAL', 'Illegal characters or traversal patterns detected in path.');
    }

    // 5. Match Routes
    for (const route of this.routes) {
      if (route.method !== req.method && route.method !== 'ALL') continue;
      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, idx) => {
          params[name] = match[idx + 1];
        });

        // Strict alphanumeric validation for path IDs
        for (const [key, val] of Object.entries(params)) {
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(val)) {
            return this.sendError(res, 400, 'ERR_INVALID_PARAM', `Parameter ${key} contains invalid characters.`);
          }
        }

        req.params = params;
        req.query = Object.fromEntries(parsedUrl.searchParams.entries());

        try {
          await route.handler(req, res);
          return true;
        } catch (err) {
          const status = err.statusCode || 500;
          const code = err.code || 'ERR_INTERNAL_SERVER_ERROR';
          const msg = err.expose !== false ? err.message : 'An internal server error occurred.';
          return this.sendError(res, status, code, msg);
        }
      }
    }

    return false; // Not matched by router (fallback to static file server)
  }

  async readJson(req) {
    return new Promise((resolve, reject) => {
      const contentLength = Number(req.headers['content-length']);
      if (contentLength && contentLength > MAX_JSON_BYTES) {
        const err = new Error('Payload too large: JSON body exceeds 1 MB limit.');
        err.statusCode = 413;
        err.code = 'ERR_PAYLOAD_TOO_LARGE';
        return reject(err);
      }

      let data = '';
      let receivedBytes = 0;

      req.on('data', chunk => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_JSON_BYTES) {
          const err = new Error('Payload too large: JSON body exceeds 1 MB limit.');
          err.statusCode = 413;
          err.code = 'ERR_PAYLOAD_TOO_LARGE';
          req.pause();
          return reject(err);
        }
        data += chunk;
      });

      req.on('end', () => {
        if (!data.trim()) {
          return resolve({});
        }
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (parseErr) {
          const err = new Error(`Malformed JSON payload: ${parseErr.message}`);
          err.statusCode = 400;
          err.code = 'ERR_MALFORMED_JSON';
          reject(err);
        }
      });

      req.on('error', err => {
        reject(err);
      });
    });
  }

  sendJson(res, statusCode, data) {
    if (res.writableEnded) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: true, data }));
  }

  sendError(res, statusCode, code, message, details = null) {
    if (res.writableEnded) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      success: false,
      error: { code, message, details }
    }));
  }
}
