import { 
  BaseProvider, 
  ProviderAuthError, 
  ProviderSubmitError, 
  ProviderPollError, 
  ProviderTimeoutError, 
  ProviderValidationError,
  redactSecret 
} from './provider-interface.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB streaming limit
const MAX_DIMENSION = 2048; // Max width/height to prevent pixel bombs
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * Validates an image URL for protocol, SSRF prevention, and host whitelist.
 * @param {string} urlString 
 * @returns {URL}
 */
export function validateImageUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new ProviderValidationError(`Invalid image URL: ${urlString}`);
  }

  // 1. Protocol must be HTTPS
  if (parsed.protocol !== 'https:') {
    throw new ProviderValidationError(`Security violation: Image URL must use HTTPS protocol, received: ${parsed.protocol}`);
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    throw new ProviderValidationError('Security violation: Image URL must not contain user credentials');
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Reject loopback, link-local, metadata, and private IP patterns
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[') || hostname === 'localhost';
  if (isIp) {
    throw new ProviderValidationError(`Security violation: IP addresses and localhost are forbidden as image source: ${hostname}`);
  }

  // 4. Strict hostname whitelist: must be exact or valid subdomain of fal.media, googleapis.com, or fal.run
  const isAllowedHost = 
    hostname === 'fal.media' ||
    hostname.endsWith('.fal.media') ||
    hostname === 'storage.googleapis.com' ||
    hostname === 'queue.fal.run' ||
    hostname.endsWith('.fal.run');

  if (!isAllowedHost) {
    throw new ProviderValidationError(`Security violation: Hostname is not in the allowed provider domain whitelist: ${hostname}`);
  }

  return parsed;
}

export class FalProvider extends BaseProvider {
  constructor(options = {}, falKey = process.env.FAL_KEY || '') {
    super('fal-ai', 'Fal.ai Flux LoRA Provider');
    this.falKey = (falKey || '').trim();
    this.endpoint = options.endpoint || 'https://queue.fal.run/fal-ai/flux-lora';
    this.model = options.model || 'flux-lora';
    this.requestTimeoutMs = Number(options.requestTimeoutMs) || 15000;
    this.totalJobTimeoutMs = Number(options.totalJobTimeoutMs) || 120000;
    this.pollIntervalMs = Number(options.pollIntervalMs) || 1000;
    // Allow custom fetch injection for testing/mocking
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  isAvailable() {
    return Boolean(this.falKey && this.falKey.length > 0);
  }

  /**
   * Orchestrates the 4-stage generation lifecycle: Submit -> Poll -> Result -> Download & Validate
   */
  async generate(job, hooks = {}) {
    if (!this.isAvailable()) {
      throw new ProviderAuthError('Fal.ai provider is not available: Missing FAL_KEY in environment.', null, this.falKey);
    }

    if (hooks.onSubmitting) hooks.onSubmitting(job);

    // STAGE 1: Single-shot POST submit (0 auto-retries on 429/5xx/timeout)
    const requestId = await this._submitJob(job);

    // Persistence Boundary: commit provider_request_id BEFORE polling begins
    if (hooks.onSubmitted) {
      await hooks.onSubmitted(job, requestId);
    }

    // STAGE 2: Bounded polling GET requests
    await this._pollJobStatus(requestId, job, hooks);

    // STAGE 3: Fetch Result
    const imageUrl = await this._fetchJobResult(requestId);

    // STAGE 4: Download, stream size-check, and validate PNG
    if (hooks.onDownloading) hooks.onDownloading(job);
    const { imageBuffer, width, height } = await this._downloadAndValidateImage(imageUrl);

    const payload = job.request_payload || {};
    return {
      imageBuffer,
      mimeType: 'image/png',
      width,
      height,
      seed: payload.seed || null,
      metadata: {
        provider: 'fal-ai',
        model: this.model,
        requestId,
        endpoint: this.endpoint
      }
    };
  }

  /**
   * Stage 1: Single-shot POST Submit
   * Strict billing safety: 0 auto-retries. Any failure or abort is flagged immediately.
   */
  async _submitJob(job) {
    const payload = job.request_payload || {};
    const submitBody = {
      prompt: payload.prompt || '',
      output_format: 'png', // Strictly enforce PNG from model
      image_size: {
        width: Number(payload.targetWidth || payload.width || 512),
        height: Number(payload.targetHeight || payload.height || 512)
      }
    };
    if (payload.seed !== undefined && payload.seed !== null) {
      submitBody.seed = Number(payload.seed);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let res;
    try {
      res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${this.falKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(submitBody),
        signal: controller.signal
      });
    } catch (networkErr) {
      clearTimeout(timeoutId);
      const isTimeout = networkErr.name === 'AbortError';
      const msg = isTimeout 
        ? `[AMBIGUOUS_SUBMIT] Submit request timed out after ${this.requestTimeoutMs}ms. Request may have reached provider.` 
        : `[AMBIGUOUS_SUBMIT] Network error during submit: ${networkErr.message}`;
      throw new ProviderSubmitError(msg, true, networkErr, this.falKey);
    } finally {
      clearTimeout(timeoutId);
    }

    // Process HTTP response status
    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthError(`Fal.ai authentication failed with status ${res.status}. Invalid FAL_KEY.`, null, this.falKey);
    }

    if (res.status === 400 || res.status === 422) {
      let errText = '';
      try { errText = await res.text(); } catch {}
      throw new ProviderSubmitError(`Provider rejected request with status ${res.status}: ${errText}`, false, null, this.falKey);
    }

    if (!res.ok) {
      // 429, 500, 502, 503, 504 on POST: Ambiguous outcome, zero auto-retry!
      let errBody = '';
      try { errBody = await res.text(); } catch {}
      throw new ProviderSubmitError(
        `[AMBIGUOUS_SUBMIT] Provider submit returned status ${res.status}. Automatic retry blocked for billing safety. Response: ${errBody}`,
        true,
        null,
        this.falKey
      );
    }

    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      throw new ProviderSubmitError('[AMBIGUOUS_SUBMIT] Malformed JSON response received on submit.', true, jsonErr, this.falKey);
    }

    const requestId = data.request_id || data.id;
    if (!requestId) {
      throw new ProviderSubmitError('[AMBIGUOUS_SUBMIT] Provider response missing request_id.', true, null, this.falKey);
    }

    return requestId;
  }

  /**
   * Stage 2: Polling Status (Idempotent GET with bounded retry and total deadline)
   */
  async _pollJobStatus(requestId, job, hooks) {
    const startTime = Date.now();
    const statusUrl = `${this.endpoint}/requests/${requestId}/status`;
    let pollAttempts = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > this.totalJobTimeoutMs) {
        throw new ProviderTimeoutError(`Total job execution time exceeded timeout limit of ${this.totalJobTimeoutMs}ms.`, null, this.falKey);
      }

      let res;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        res = await this.fetchFn(statusUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Key ${this.falKey}`,
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchErr) {
        consecutiveErrors++;
        if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
          throw new ProviderPollError(`Polling failed after ${consecutiveErrors} consecutive network errors: ${fetchErr.message}`, fetchErr, this.falKey);
        }
        const baseBackoff = Math.max(this.pollIntervalMs, 25);
        await new Promise(r => setTimeout(r, Math.min(baseBackoff * Math.pow(2, consecutiveErrors - 1), 8000)));
        continue;
      }

      if (res.status === 404) {
        throw new ProviderPollError(`Job not found on provider queue (404) for request: ${requestId}`, null, this.falKey);
      }

      if (res.status === 429 || res.status >= 500) {
        consecutiveErrors++;
        if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
          throw new ProviderPollError(`Polling received repeated server errors (${res.status}) exceeding retry budget.`, null, this.falKey);
        }
        const baseBackoff = Math.max(this.pollIntervalMs, 25);
        await new Promise(r => setTimeout(r, Math.min(baseBackoff * Math.pow(2, consecutiveErrors - 1), 8000)));
        continue;
      }

      if (!res.ok) {
        throw new ProviderPollError(`Polling request failed with unexpected status: ${res.status}`, null, this.falKey);
      }

      // Successful poll response
      consecutiveErrors = 0;
      let statusData;
      try {
        statusData = await res.json();
      } catch (jsonErr) {
        throw new ProviderPollError(`Invalid JSON received during status polling: ${jsonErr.message}`, jsonErr, this.falKey);
      }

      const status = statusData.status;
      if (hooks.onPolling) {
        hooks.onPolling(job, statusData);
      }

      if (status === 'COMPLETED') {
        return; // Proceed to result stage
      }

      if (status === 'FAILED') {
        const errMsg = statusData.error || statusData.logs || 'Provider reported job failure.';
        throw new ProviderPollError(`Job failed during execution: ${errMsg}`, null, this.falKey);
      }

      // Still IN_QUEUE or IN_PROGRESS, wait poll interval
      pollAttempts++;
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }

  /**
   * Stage 3: Fetch Job Result (Idempotent GET)
   */
  async _fetchJobResult(requestId) {
    const resultUrl = `${this.endpoint}/requests/${requestId}`;
    let res;
    try {
      res = await this.fetchFn(resultUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Key ${this.falKey}`,
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      throw new ProviderPollError(`Failed to fetch job result: ${err.message}`, err, this.falKey);
    }

    if (!res.ok) {
      throw new ProviderPollError(`Result fetch returned status ${res.status}`, null, this.falKey);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new ProviderPollError('Malformed JSON received in job result.', e, this.falKey);
    }

    if (!data.images || !Array.isArray(data.images) || data.images.length === 0 || !data.images[0].url) {
      throw new ProviderValidationError('Provider result payload does not contain a valid image URL in images array.');
    }

    return data.images[0].url;
  }

  /**
   * Stage 4: Streaming Download, Security Validation, and PNG Magic Bytes Check
   */
  async _downloadAndValidateImage(rawUrl) {
    // 1. Strict URL & SSRF Validation
    let currentUrl = validateImageUrl(rawUrl);

    // 2. Fetch with manual redirect validation (max 3 hops). Never pass Authorization to CDN!
    let hops = 0;
    let res;
    while (hops < 3) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        res = await this.fetchFn(currentUrl.href, {
          method: 'GET',
          redirect: 'manual', // Enforce manual redirect verification
          headers: {
            'Accept': 'image/png'
          },
          signal: controller.signal
        });
      } catch (downloadErr) {
        clearTimeout(timeoutId);
        throw new ProviderValidationError(`Download failed: ${downloadErr.message}`, downloadErr, this.falKey);
      } finally {
        clearTimeout(timeoutId);
      }

      if ([301, 302, 307, 308].includes(res.status)) {
        hops++;
        const location = res.headers.get('location');
        if (!location) {
          throw new ProviderValidationError('Redirect received without Location header.');
        }
        currentUrl = validateImageUrl(new URL(location, currentUrl.href).href);
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      throw new ProviderValidationError(`Image download returned status ${res ? res.status : 'unknown'}`);
    }

    // 3. Strict PNG Format Policy Check
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('image/png') && !contentType.includes('application/octet-stream')) {
      throw new ProviderValidationError(`Unsupported image format: Only image/png is supported by the pixel art pipeline. Received: ${contentType}`);
    }

    // 4. Streaming Size Check: enforce 10MB ceiling
    const chunks = [];
    let receivedBytes = 0;

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length;
          if (receivedBytes > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new ProviderValidationError(`Downloaded image exceeds maximum size limit of 10MB (${receivedBytes} bytes received).`);
          }
          chunks.push(Buffer.from(value));
        }
      }
    } else {
      // Buffer / ArrayBuffer fallback for Node test environments
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
        throw new ProviderValidationError(`Downloaded image exceeds maximum size limit of 10MB (${arrayBuf.byteLength} bytes).`);
      }
      chunks.push(Buffer.from(arrayBuf));
    }

    const imageBuffer = Buffer.concat(chunks);

    // 5. PNG Magic Bytes Validation (89 50 4E 47 0D 0A 1A 0A)
    if (imageBuffer.length < 24) {
      throw new ProviderValidationError('Downloaded file is too small to be a valid PNG image.');
    }
    const signature = imageBuffer.subarray(0, 8);
    if (!signature.equals(PNG_MAGIC)) {
      throw new ProviderValidationError('Corrupted or non-PNG image: Magic bytes check failed.');
    }

    // 6. IHDR Dimension Inspection (bytes 16..24)
    const width = imageBuffer.readUInt32BE(16);
    const height = imageBuffer.readUInt32BE(20);
    if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new ProviderValidationError(`Image dimensions out of bounds (${width}x${height}). Maximum allowed is ${MAX_DIMENSION}x${MAX_DIMENSION}.`);
    }

    return { imageBuffer, width, height };
  }
}
