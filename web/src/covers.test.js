import {afterEach, expect, test, vi} from 'vitest';
vi.mock('./books.js', async importOriginal => ({...await importOriginal(), setCatalogCover: vi.fn()}));
import {setCatalogCover} from './books.js';
import {findCover, coverUrl, loadCovers} from './covers.js';
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks();});
const book = {id:'example',title:'A quiet afternoon',author:'Ada Reed'};

test('a representative cover requires matching title and author and a safe numeric cover ID', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({docs:[{title:book.title,author_name:[book.author],cover_i:123}]})});
  vi.stubGlobal('fetch',fetch);
  expect(await findCover(book,new AbortController().signal)).toBe(coverUrl(123));
  const [url,options] = fetch.mock.calls[0];
  expect(url).toContain('https://openlibrary.org/search.json?');
  expect(options.credentials).toBe('omit');
  expect(options.headers).toBeUndefined();
  expect(coverUrl('https://untrusted.example/image')).toBeNull();
});

test('wrong authors, ambiguous authorless books and unavailable services use the fallback', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({docs:[{title:book.title,author_name:['Other writer'],cover_i:123}]})}));
  expect(await findCover(book,new AbortController().signal)).toBeNull();
  fetch.mockResolvedValue({ok:true,json:async()=>({docs:[{title:book.title,cover_i:123},{title:book.title,cover_i:456}]})});
  expect(await findCover({...book,author:null},new AbortController().signal)).toBeNull();
  fetch.mockRejectedValue(new Error('offline'));
  expect(await findCover(book,new AbortController().signal)).toBeNull();
});

test('cover lookup stops after cancellation and never returns another account record', async () => {
  const receive=vi.fn(); const controller=new AbortController(); controller.abort();
  vi.stubGlobal('fetch',vi.fn());
  await loadCovers([book],receive,controller.signal);
  expect(fetch).not.toHaveBeenCalled();
  expect(receive).not.toHaveBeenCalled();
});

test('stored cover photo is used as fallback when Open Library has no match', async () => {
  const blob = new Blob(['photo-bytes'], {type: 'image/jpeg'});
  const objectUrl = 'blob:http://localhost/stored-cover-123';
  vi.stubGlobal('URL', {...URL, createObjectURL: vi.fn(() => objectUrl), revokeObjectURL: vi.fn()});

  // Mock fetch for Open Library (returns no matches) and for /api/books/example/cover (returns blob)
  const fetch = vi.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('openlibrary.org')) {
      return {ok: true, json: async () => ({docs: []})};
    }
    if (typeof url === 'string' && url.includes('/api/books/example/cover')) {
      return {ok: true, blob: async () => blob};
    }
    return {ok: false, status: 404};
  });
  vi.stubGlobal('fetch', fetch);

  const bookWithCover = {...book, has_cover_photo: true};
  const getToken = async () => 'test-token';
  const result = await findCover(bookWithCover, new AbortController().signal, {getToken});

  expect(result).toBe(objectUrl);
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
});

test('stored catalog cover is returned without searching', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await findCover({...book, catalog_cover_id: 321}, new AbortController().signal)).toBe(coverUrl(321));
  expect(fetch).not.toHaveBeenCalled();
  expect(setCatalogCover).not.toHaveBeenCalled();
});

test('recently checked no-match skips search and uses photo fallback', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const url = 'blob:recent-photo';
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(url);
  vi.spyOn(await import('./books.js'), 'fetchCover').mockResolvedValue(new Blob(['photo']));
  const recent = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
  expect(await findCover({...book, catalog_cover_id: null, catalog_checked_at: recent, has_cover_photo: true}, new AbortController().signal, {getToken: vi.fn()})).toBe(url);
  expect(fetch).not.toHaveBeenCalled();
});

test('stale no-match is searched again', async () => {
  const fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({docs: []})}); vi.stubGlobal('fetch', fetch);
  const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await findCover({...book, catalog_cover_id: null, catalog_checked_at: stale}, new AbortController().signal, {getToken: 'token'});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(setCatalogCover).toHaveBeenCalledWith('token', book.id, null);
});

test.each([
  ['network error', () => Promise.reject(new Error('offline'))],
  ['server error', () => Promise.resolve({ok: false, status: 500})],
  ['malformed JSON', () => Promise.resolve({ok: true, json: async () => {throw new Error('invalid json');}})],
])('%s is not saved as a no-match', async (_label, response) => {
  vi.stubGlobal('fetch', vi.fn(response));
  await findCover(book, new AbortController().signal);
  expect(setCatalogCover).not.toHaveBeenCalled();
});

test('matched cover is saved and failed save does not hide it', async () => {
  setCatalogCover.mockRejectedValue(new Error('save failed'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({docs: [{title: book.title, author_name: [book.author], cover_i: 456}]})}));
  expect(await findCover(book, new AbortController().signal, {getToken: 'token'})).toBe(coverUrl(456));
  expect(setCatalogCover).toHaveBeenCalledWith('token', book.id, 456);
});

test('searched no-match is saved as null and failed save preserves fallback', async () => {
  setCatalogCover.mockRejectedValue(new Error('save failed'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({docs: []})}));
  expect(await findCover(book, new AbortController().signal, {getToken: 'token'})).toBeNull();
  expect(setCatalogCover).toHaveBeenCalledWith('token', book.id, null);
});

test('Open Library match takes priority over stored cover photo', async () => {
  const fetch = vi.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('openlibrary.org')) {
      return {ok: true, json: async () => ({docs: [{title: book.title, author_name: [book.author], cover_i: 999}]})};
    }
    return {ok: false, status: 500};
  });
  vi.stubGlobal('fetch', fetch);

  const bookWithCover = {...book, has_cover_photo: true};
  const getToken = async () => 'test-token';
  const result = await findCover(bookWithCover, new AbortController().signal, {getToken});

  expect(result).toBe(coverUrl(999));
});

test('loadCovers delivers stored covers without sending Open Library requests', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const receive = vi.fn();
  const storedBook = {...book, catalog_cover_id: 888};
  await loadCovers([storedBook], receive, new AbortController().signal);
  expect(fetch).not.toHaveBeenCalled();
  expect(receive).toHaveBeenCalledWith(storedBook.id, coverUrl(888));
});
