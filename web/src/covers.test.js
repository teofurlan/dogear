import {afterEach, expect, test, vi} from 'vitest';
import {findCover, coverUrl, loadCovers} from './covers.js';
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});
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
