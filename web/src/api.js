export class ApiError extends Error {
  constructor(status) { super('Request failed'); this.status = status; }
}

// AbortSignal.any is missing before iOS Safari 17.4, where phone captures happen.
function anySignal(signals) {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break; }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {once: true});
  }
  return controller.signal;
}

// Authenticated same-origin call. Nothing is cached: responses, tokens and photos stay in memory only.
export async function api(getToken, path, {method = 'GET', body, contentType, signal, timeout = 10000, as = 'json'} = {}) {
  const token = await getToken({timeoutInSeconds: 10});
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const headers = {Authorization: `Bearer ${token}`};
  if (contentType) headers['Content-Type'] = contentType;
  const options = {
    method, headers, credentials: 'omit', cache: 'no-store',
    signal: anySignal([signal, AbortSignal.timeout(timeout)].filter(Boolean))
  };
  if (body !== undefined) options.body = body;
  const response = await fetch('/api' + path, options);
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return null;
  return as === 'blob' ? response.blob() : response.json();
}
