import {afterEach, expect, test, vi} from 'vitest';
import {deleteBook, fetchCover, getBook, listBooks, updateBook, uploadCover} from './books.js';
afterEach(() => vi.unstubAllGlobals());
const book = {id:'000000000000000000000001',title:'Example',author:null};

test('book requests forward only a bearer token to the local API with bounded pagination', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>[book]});
  vi.stubGlobal('fetch',fetch);
  expect(await listBooks(async () => 'access-token', {after:book.id})).toEqual([book]);
  const [url,options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books?limit=24&after='+book.id);
  expect(options.headers).toEqual({Authorization:'Bearer access-token'});
  expect(options.credentials).toBe('omit');
});

test('listBooks appends trimmed q parameter when provided', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>[book]});
  vi.stubGlobal('fetch', fetch);
  await listBooks(async () => 'access-token', {q: '  García  '});
  expect(fetch.mock.calls[0][0]).toBe('/api/books?limit=24&q=Garc%C3%ADa');
  await listBooks(async () => 'access-token', {q: '   '});
  expect(fetch.mock.calls[1][0]).toBe('/api/books?limit=24');
});

test('unauthorized, unavailable and malformed replies are not accepted as library data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:false,status:401}));
  await expect(listBooks(async () => 'token')).rejects.toMatchObject({status:401});
  fetch.mockResolvedValue({ok:false,status:503});
  await expect(listBooks(async () => 'token')).rejects.toMatchObject({status:503});
  fetch.mockResolvedValue({ok:true,json:async()=>[{...book,title:null}]});
  await expect(listBooks(async () => 'token')).rejects.toThrow();
});

test('getBook requests authenticated book from /api/books/:id', async () => {
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => book});
  vi.stubGlobal('fetch', fetch);
  const result = await getBook(async () => 'auth-token', book.id);
  expect(result).toEqual(book);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books/' + book.id);
  expect(options.headers).toEqual({Authorization: 'Bearer auth-token'});
});

test('getBook rejects on 404 with status 404', async () => {
  const fetch = vi.fn().mockResolvedValue({ok: false, status: 404});
  vi.stubGlobal('fetch', fetch);
  await expect(getBook(async () => 'auth-token', 'nonexistent')).rejects.toMatchObject({status: 404});
});

test('requests work on browsers without AbortSignal.any (iOS Safari before 17.4)', async () => {
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({id: '000000000000000000000001', title: 'T', author: null})});
  vi.stubGlobal('fetch', fetch);
  await listBooks(async () => 'tok').catch(() => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});

test('fetchCover requests authenticated blob from /api/books/:id/cover', async () => {
  const blob = new Blob(['bytes']);
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, blob: async () => blob});
  vi.stubGlobal('fetch', fetch);
  const result = await fetchCover(async () => 'auth-token', 'book123');
  expect(result).toBe(blob);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books/book123/cover');
  expect(options.headers).toEqual({Authorization: 'Bearer auth-token'});
});

test('uploadCover puts binary image to /api/books/:id/cover', async () => {
  const updated = {id: 'book123', title: 'T', author: null, has_cover_photo: true};
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => updated});
  vi.stubGlobal('fetch', fetch);
  const file = new File(['fake-image'], 'cover.png', {type: 'image/png'});
  const result = await uploadCover(async () => 'auth-token', 'book123', file);
  expect(result).toEqual(updated);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books/book123/cover');
  expect(options.method).toBe('PUT');
  expect(options.headers).toEqual({Authorization: 'Bearer auth-token', 'Content-Type': 'image/png'});
  expect(options.body).toBe(file);
});

test('updateBook patches title and author as JSON, omitting a missing author', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>book});
  vi.stubGlobal('fetch', fetch);
  expect(await updateBook(async () => 'token', book.id, {title:'Example', author:'Ada'})).toEqual(book);
  let [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/books/'+book.id);
  expect(options).toMatchObject({method:'PATCH', credentials:'omit', body:'{"title":"Example","author":"Ada"}'});
  expect(options.headers).toEqual({Authorization:'Bearer token', 'Content-Type':'application/json'});
  await updateBook(async () => 'token', book.id, {title:'Example', author:null});
  [, options] = fetch.mock.calls[1];
  expect(options.body).toBe('{"title":"Example"}');
});

test('deleteBook sends DELETE and rejects with the status on failure', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:true,status:204});
  vi.stubGlobal('fetch', fetch);
  expect(await deleteBook(async () => 'token', book.id)).toBeNull();
  expect(fetch.mock.calls[0][0]).toBe('/api/books/'+book.id);
  expect(fetch.mock.calls[0][1]).toMatchObject({method:'DELETE', credentials:'omit'});
  fetch.mockResolvedValue({ok:false,status:404});
  await expect(deleteBook(async () => 'token', book.id)).rejects.toMatchObject({status:404});
});
