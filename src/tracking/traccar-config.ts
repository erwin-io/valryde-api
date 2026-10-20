export interface TraccarConfig {
  baseUrl: string;
  email: string;
  password: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

// Loaded only by server-side tracking composition, independently of API startup.
export function loadTraccarConfig(source: NodeJS.ProcessEnv = process.env): TraccarConfig {
  const baseUrl = source.TRACCAR_BASE_URL ?? '';
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('TRACCAR_BASE_URL must be an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TRACCAR_BASE_URL must be an HTTP(S) origin without credentials or path');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Remote Traccar connections require HTTPS');
  }
  const email = source.TRACCAR_EMAIL?.trim();
  const password = source.TRACCAR_PASSWORD;
  if (!email || !password) throw new Error('TRACCAR_EMAIL and TRACCAR_PASSWORD are required');
  const config = {
    baseUrl: url.origin, email, password,
    timeoutMs: bounded(source, 'TRACCAR_TIMEOUT_MS', 5_000, 1, 60_000),
    maxRetries: bounded(source, 'TRACCAR_MAX_RETRIES', 2, 0, 5),
    retryBaseMs: bounded(source, 'TRACCAR_RETRY_BASE_MS', 250, 1, 30_000),
    retryMaxMs: bounded(source, 'TRACCAR_RETRY_MAX_MS', 5_000, 1, 60_000),
  };
  if (config.retryMaxMs < config.retryBaseMs) throw new Error('Traccar retry maximum must cover base delay');
  return config;
}

export function bounded(source: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const value = Number(source[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} is outside allowed bounds`);
  return value;
}
