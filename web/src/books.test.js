import {afterEach, expect, test, vi} from 'vitest';
import {listBooks} from './books.js';
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

test('unauthorized, unavailable and malformed replies are not accepted as library data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:false,status:401}));
  await expect(listBooks(async () => 'token')).rejects.toMatchObject({status:401});
  fetch.mockResolvedValue({ok:false,status:503});
  await expect(listBooks(async () => 'token')).rejects.toMatchObject({status:503});
  fetch.mockResolvedValue({ok:true,json:async()=>[{...book,title:null}]});
  await expect(listBooks(async () => 'token')).rejects.toThrow();
});

test('requests work on browsers without AbortSignal.any (iOS Safari before 17.4)', async () => {
  vi.stubGlobal('AbortSignal', {timeout: AbortSignal.timeout.bind(AbortSignal)});
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({id: '000000000000000000000001', title: 'T', author: null})});
  vi.stubGlobal('fetch', fetch);
  await listBooks(async () => 'tok').catch(() => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});
