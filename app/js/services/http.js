// Shared fetch plumbing for the service adapters: one timeout per request, and every failure
// turned into a ServiceError that names the service and (for HTTP failures) the status code.
// No DOM access, so adapters stay importable anywhere.

export const DEFAULT_TIMEOUT_MS = 30_000;

export class ServiceError extends Error {
  /**
   * @param {string} service  human-readable service name, e.g. "SIMBAD TAP"
   * @param {'http'|'timeout'|'network'|'response'} kind
   * @param {string} message  full message, already naming the service
   * @param {{status?: number|null, detail?: string}} [extra]
   */
  constructor(service, kind, message, { status = null, detail = '' } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.service = service;
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * GET `url` and hand the successful Response to `readBody`. The timeout covers the body read too.
 * `readErrorDetail(text)` may pull a short explanation out of an error body ('' if none).
 */
export async function fetchFromService(url, { service, readBody, readErrorDetail, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () =>
    new ServiceError(service, 'timeout', `${service} timed out after ${Math.round(timeoutMs / 1000)} s`);
  try {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw timedOut();
      throw new ServiceError(service, 'network', `${service} could not be reached (network error)`);
    }
    if (!response.ok) {
      let detail = '';
      if (readErrorDetail) {
        try {
          detail = readErrorDetail(await response.text());
        } catch {
          detail = '';
        }
      }
      const suffix = detail ? `: ${detail}` : '';
      throw new ServiceError(service, 'http', `${service} returned HTTP ${response.status}${suffix}`,
        { status: response.status, detail });
    }
    try {
      return await readBody(response);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      if (controller.signal.aborted) throw timedOut();
      throw new ServiceError(service, 'response', `${service} sent a response that could not be read (${err.message})`,
        { status: response.status });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse whitespace and cap the length of upstream error text before it reaches the UI. */
export function shorten(text, max = 200) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
