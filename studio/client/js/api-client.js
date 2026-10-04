/**
 * ApiClient provides a standardized wrapper for the Studio REST API.
 */
export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (netErr) {
      throw new Error(`Network connection error: ${netErr.message}`);
    }

    let json;
    try {
      json = await response.json();
    } catch (_) {
      throw new Error(`Invalid server response (Status: ${response.status})`);
    }

    if (!response.ok || json.success === false) {
      const err = new Error(json.error?.message || `HTTP ${response.status}`);
      err.code = json.error?.code || 'ERR_REQUEST_FAILED';
      err.statusCode = response.status;
      err.details = json.error?.details || null;
      throw err;
    }

    return json.data;
  }

  async getConfig() {
    return this.request('/api/config');
  }

  async getProjects() {
    return this.request('/api/projects');
  }

  async getProjectAssets(projectId = 'proj_default') {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/assets`);
  }

  async getAsset(assetId) {
    return this.request(`/api/assets/${encodeURIComponent(assetId)}`);
  }

  async setActiveVersion(assetId, versionId) {
    return this.request(`/api/assets/${encodeURIComponent(assetId)}/current-version`, {
      method: 'PUT',
      body: { versionId }
    });
  }

  async deleteAsset(assetId) {
    return this.request(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE'
    });
  }

  async createJob(payload) {
    return this.request('/api/jobs', {
      method: 'POST',
      body: payload
    });
  }

  async getJob(jobId) {
    return this.request(`/api/jobs/${encodeURIComponent(jobId)}`);
  }

  async scanAssets() {
    return this.request('/api/scan', {
      method: 'POST'
    });
  }
}

export const api = new ApiClient();
