import {anySignal} from './signals.js';

const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
let queue = Promise.resolve();
let nextRequestAt = 0;

export function coverUrl(id) {
  return Number.isSafeInteger(id) && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false` : null;
}

export async function findCover(book, signal) {
  try {
    const query = new URLSearchParams({title: book.title, fields: 'title,author_name,cover_i,key', limit: '5'});
    if (book.author) query.set('author', book.author);
    const response = await fetch('https://openlibrary.org/search.json?' + query, {
      credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: anySignal([signal, AbortSignal.timeout(4000)].filter(Boolean))
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data.docs)) return null;
    const matches = data.docs.filter(candidate =>
      normalize(candidate.title) === normalize(book.title) && coverUrl(candidate.cover_i) &&
      (!book.author || (Array.isArray(candidate.author_name) && candidate.author_name.some(author => normalize(author) === normalize(book.author))))
    );
    if (!book.author && matches.length !== 1) return null;
    return matches.length ? coverUrl(matches[0].cover_i) : null;
  } catch { return null; }
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, {once: true});
  });
}

export async function loadCovers(books, receive, signal) {
  for (const book of books) {
    if (signal.aborted) return;
    // One shared rate queue, but no account metadata or token cache lives here.
    const request = queue.catch(() => {}).then(async () => {
      await wait(Math.max(0, nextRequestAt - Date.now()), signal);
      nextRequestAt = Date.now() + 1100;
      return findCover(book, signal);
    });
    queue = request;
    try {
      const cover = await request;
      if (signal.aborted) return;
      receive(book.id, cover);
    } catch { if (signal.aborted) return; }
  }
}
