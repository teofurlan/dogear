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
