/**
 * Provider Abstraction & Error Hierarchy
 * Enforces uniform provider contracts and strict secret sanitization.
 */

/**
 * Sanitizes any occurrences of a secret key from an error message, stack trace, or text.
 * @param {string} text 
 * @param {string} secret 
 * @returns {string}
 */
export function redactSecret(text, secret) {
  if (!text || typeof text !== 'string') return text || '';
  if (!secret || typeof secret !== 'string' || secret.length < 4) return text;
  return text.replaceAll(secret, '[REDACTED]');
}

export class ProviderError extends Error {
  constructor(message, originalError = null, secretToRedact = '') {
    const sanitizedMsg = redactSecret(message, secretToRedact);
    super(sanitizedMsg);
    this.name = 'ProviderError';
    this.originalError = originalError;
    if (this.stack && secretToRedact) {
      this.stack = redactSecret(this.stack, secretToRedact);
    }
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message, originalError = null, secretToRedact = '') {
    super(message, originalError, secretToRedact);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderSubmitError extends ProviderError {
  constructor(message, isAmbiguous = false, originalError = null, secretToRedact = '') {
    super(message, originalError, secretToRedact);
    this.name = 'ProviderSubmitError';
    this.isAmbiguous = isAmbiguous;
  }
}

export class ProviderPollError extends ProviderError {
  constructor(message, originalError = null, secretToRedact = '') {
    super(message, originalError, secretToRedact);
    this.name = 'ProviderPollError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message, originalError = null, secretToRedact = '') {
    super(message, originalError, secretToRedact);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderValidationError extends ProviderError {
  constructor(message, originalError = null, secretToRedact = '') {
    super(message, originalError, secretToRedact);
    this.name = 'ProviderValidationError';
  }
}

/**
 * Base Provider Interface Contract
 */
export class BaseProvider {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  /**
   * Checks if provider is available in the current environment.
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error('Not implemented');
  }

  /**
   * Generates asset for a job.
   * @param {Object} job - Database job record (id, asset_id, request_payload)
   * @param {Object} hooks - Lifecycle callbacks: { onSubmitting, onSubmitted, onPolling, onDownloading }
   * @returns {Promise<{ imageBuffer: Buffer, mimeType: string, width: number, height: number, seed: number, metadata: Object }>}
   */
  async generate(job, hooks = {}) {
    throw new Error('Not implemented');
  }
}
