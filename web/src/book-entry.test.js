import {afterEach, expect, test, vi} from 'vitest';
import {createBook, identifyBook} from './book-entry.js';
afterEach(() => vi.unstubAllGlobals());
const book = {id:'000000000000000000000001',title:'Synthetic',author:null};

test('confirmation sends only editable fields with the token to the same-origin API', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>book}));
  expect(await createBook(async()=> 'token', {title:book.title,author:null})).toEqual(book);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books');
  expect(JSON.parse(options.body)).toEqual({title:'Synthetic',author:null});
  expect(options.headers.Authorization).toBe('Bearer token');
  expect(options.cache).toBe('no-store');
  expect(options.credentials).toBe('omit');
});

test('photo requests are transient binary data and malformed replies are rejected', async () => {
  const photo = new File(['photo'],'cover.png',{type:'image/png'});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({title:42,author:null,text:''})}));
  await expect(identifyBook(async()=> 'token', photo)).rejects.toThrow();
  expect(fetch.mock.calls[0][0]).toBe('/api/books/identify');
  expect(fetch.mock.calls[0][1].body).toBe(photo);
  expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('image/png');
});

test('invalid photos and cancelled token acquisition send no request', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(identifyBook(vi.fn(), new File(['x'],'file.heic',{type:'image/heic'}))).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(createBook(async()=> 'token', book, {signal:controller.signal})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test('requests work on browsers without AbortSignal.any (iOS Safari before 17.4)', async () => {
  vi.stubGlobal('AbortSignal', {timeout: AbortSignal.timeout.bind(AbortSignal)});
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({id: '000000000000000000000001', title: 'T', author: null})});
  vi.stubGlobal('fetch', fetch);
  await createBook(async () => 'tok', {title: 'T', author: null}).catch(() => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});
