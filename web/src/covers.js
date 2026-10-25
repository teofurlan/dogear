import {fetchCover, setCatalogCover} from './books.js';
import {anySignal} from './signals.js';

const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
let queue = Promise.resolve();
let nextRequestAt = 0;

export function coverUrl(id) {
  return Number.isSafeInteger(id) && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false` : null;
}

const checkedRecently = book => book?.catalog_cover_id === null && book.catalog_checked_at &&
  Date.now() - new Date(book.catalog_checked_at).getTime() < 30 * 24 * 60 * 60 * 1000;

async function photoFallback(book, signal, getToken) {
  if (book.has_cover_photo && getToken) {
    try { return URL.createObjectURL(await fetchCover(getToken, book.id, {signal})); }
    catch { return null; }
  }
  return null;
}

export async function findCover(book, signal, {getToken} = {}) {
  const stored = coverUrl(book?.catalog_cover_id);
  if (stored) return stored;
  if (checkedRecently(book)) return photoFallback(book, signal, getToken);
  let definite = false;
  let coverId = null;
  try {
    const query = new URLSearchParams({title: book.title, fields: 'title,author_name,cover_i,key', limit: '5'});
    if (book.author) query.set('author', book.author);
    const response = await fetch('https://openlibrary.org/search.json?' + query, {
      credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: anySignal([signal, AbortSignal.timeout(4000)].filter(Boolean))
    });
    if (!response.ok) throw new Error('Open Library lookup failed');
    const data = await response.json();
    if (Array.isArray(data.docs)) {
      const matches = data.docs.filter(candidate =>
        normalize(candidate.title) === normalize(book.title) && coverUrl(candidate.cover_i) &&
        (!book.author || (Array.isArray(candidate.author_name) && candidate.author_name.some(author => normalize(author) === normalize(book.author))))
      );
      if ((book.author || matches.length === 1) && matches.length) coverId = matches[0].cover_i;
      definite = coverId !== null || matches.length === 0;
    } else throw new Error('Malformed Open Library response');
  } catch { /* lookup failed; do not persist a no-match */ }

  // Best effort: a failed save only means the next visit searches again.
  if (definite && getToken) Promise.resolve(setCatalogCover(getToken, book.id, coverId, {title: book.title, author: book.author})).catch(() => {});
  return coverUrl(coverId) || photoFallback(book, signal, getToken);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, {once: true});
  });
}

export async function loadCovers(books, receive, signal, {getToken} = {}) {
  for (const book of books) {
    if (signal.aborted) return;
    if (coverUrl(book?.catalog_cover_id) || checkedRecently(book)) {
      try {
        const cover = await findCover(book, signal, {getToken});
        if (signal.aborted) {
          if (cover?.startsWith('blob:')) URL.revokeObjectURL(cover);
          return;
        }
        receive(book.id, cover);
      } catch { if (signal.aborted) return; }
      continue;
    }
    // One shared rate queue, but no account metadata or token cache lives here.
    const request = queue.catch(() => {}).then(async () => {
      await wait(Math.max(0, nextRequestAt - Date.now()), signal);
      nextRequestAt = Date.now() + 1100;
      return findCover(book, signal, {getToken});
    });
    queue = request;
    try {
      const cover = await request;
      if (signal.aborted) {
        if (cover?.startsWith('blob:')) URL.revokeObjectURL(cover);
        return;
      }
      receive(book.id, cover);
    } catch { if (signal.aborted) return; }
  }
}
