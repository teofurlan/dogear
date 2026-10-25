import {BooksError} from './books.js';
import {anySignal} from './signals.js';

async function send(getToken, path, body, contentType, signal, timeout) {
  const token = await getToken({timeoutInSeconds: 10});
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch('/api/books' + path, {
    method: 'POST', body, headers: {Authorization: `Bearer ${token}`, 'Content-Type': contentType},
    credentials: 'omit', cache: 'no-store',
    signal: anySignal([signal, AbortSignal.timeout(timeout)].filter(Boolean))
  });
  if (!response.ok) throw new BooksError(response.status);
  return response.json();
}

export async function createBook(getToken, book, {signal} = {}) {
  const result = await send(getToken, '', JSON.stringify(book), 'application/json', signal, 10000);
  if (!result || !/^[a-f0-9]{24}$/i.test(result.id) || typeof result.title !== 'string' ||
      !result.title.trim() || (result.author !== null && typeof result.author !== 'string')) throw new BooksError(503);
  return result;
}

export async function identifyBook(getToken, file, {signal} = {}) {
  if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 6 * 1024 * 1024) throw new BooksError(415);
  const result = await send(getToken, '/identify', file, file.type, signal, 25000);
  if (!result || typeof result.title !== 'string' || result.title.length > 300 ||
      (result.author !== null && (typeof result.author !== 'string' || result.author.length > 300)) ||
      typeof result.text !== 'string' || result.text.length > 2000 ||
      (result.lines !== undefined && (!Array.isArray(result.lines) ||
        result.lines.some(l => !l || typeof l.text !== 'string' || !Array.isArray(l.box) || l.box.length !== 4 || !l.box.every(Number.isFinite))))) throw new BooksError(503);
  return result;
}
