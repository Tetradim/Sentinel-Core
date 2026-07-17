import type { GeneralApiSettings, SuiteConfig, SuiteSnapshot } from './types';

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).error : undefined;
    throw new Error(typeof detail === 'string' ? detail : `${response.status} ${response.statusText}`);
  }

  return payload as T;
}

export function loadSuiteConfig() {
  return requestJson<SuiteConfig>('/api/sentinel-core/config');
}

export function loadSuiteSnapshot() {
  return requestJson<SuiteSnapshot>('/api/sentinel-core/snapshot');
}

export function loadGeneralApiSettings() {
  return requestJson<{ settings: GeneralApiSettings; contract: string; boundary: string }>('/api/general-api');
}

export function saveGeneralApiSettings(settings: Record<string, unknown>) {
  return requestJson<{ settings: GeneralApiSettings }>('/api/general-api', { method: 'PUT', body: JSON.stringify(settings) });
}

export function testGeneralApi() {
  return requestJson<Record<string, unknown>>('/api/general-api/test', { method: 'POST', body: '{}' });
}

export function registerGeneralApi() {
  return requestJson<Record<string, unknown>>('/api/general-api/register', { method: 'POST', body: '{}' });
}
