import {api} from './api.js';
import {anySignal} from './signals.js';

export const PAGE_SIZE = 24;

export class BooksError extends Error {
  constructor(status) { super('Book storage unavailable'); this.status = status; }
}

export async function listBooks(getToken, {after, q, signal} = {}) {
  const token = await getToken({timeoutInSeconds: 10});
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const query = new URLSearchParams({limit: String(PAGE_SIZE)});
  if (after) query.set('after', after);
  if (q?.trim()) query.set('q', q.trim());
  const response = await fetch('/api/books?' + query, {
    headers: {Authorization: `Bearer ${token}`}, credentials: 'omit',
    signal: anySignal([signal, AbortSignal.timeout(8000)].filter(Boolean))
  });
  if (!response.ok) throw new BooksError(response.status);
  const books = await response.json();
  if (!Array.isArray(books) || books.length > PAGE_SIZE || books.some(book =>
    typeof book.id !== 'string' || !/^[a-f0-9]{24}$/i.test(book.id) ||
    typeof book.title !== 'string' || !book.title.trim() ||
    (book.author !== null && typeof book.author !== 'string')
  )) throw new BooksError(503);
  return books;
}

export const getBook = (getToken, bookId, {signal} = {}) =>
  api(getToken, `/books/${bookId}`, {signal});

export const updateBook = (getToken, bookId, {title, author}) =>
  api(getToken, `/books/${bookId}`, {
    method: 'PATCH', body: JSON.stringify(author ? {title, author} : {title}), contentType: 'application/json'
  });

export const deleteBook = (getToken, bookId) =>
  api(getToken, `/books/${bookId}`, {method: 'DELETE', timeout: 20000});

export const fetchCover =(getToken, bookId, {signal} = {}) =>
  api(getToken, `/books/${bookId}/cover`, {as: 'blob', signal});

export const uploadCover = (getToken, bookId, file, {signal} = {}) =>
  api(getToken, `/books/${bookId}/cover`, {
    method: 'PUT',
    body: file,
    contentType: file.type,
    signal,
    timeout: 25000,
  });

export const setCatalogCover = (getToken, bookId, coverId, {signal} = {}) =>
  api(getToken, `/books/${bookId}/catalog-cover`, {
    method: 'PUT',
    body: JSON.stringify({cover_id: coverId}),
    contentType: 'application/json',
    signal,
  });
