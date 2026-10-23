import {afterEach, expect, test, vi} from 'vitest';
import {listPages, uploadPage} from './pages.js';
import {addQuote, deleteQuote, fetchCrop, listQuotes, updateQuote} from './quotes.js';

afterEach(() => vi.unstubAllGlobals());
const ok = (body, status = 200) => ({ok: true, status, json: async () => body, blob: async () => body});
const getToken = async () => 'tok';
const id = '000000000000000000000001';

test('uploadPage posts the raw jpeg with a bearer token and never caches', async () => {
  const fetch = vi.fn().mockResolvedValue(ok({id: 'p1', status: 'pending'}, 201));
  vi.stubGlobal('fetch', fetch);
  const blob = new Blob(['jpeg'], {type: 'image/jpeg'});
  await uploadPage(getToken, id, blob);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`/api/books/${id}/pages`);
  expect(options).toMatchObject({method: 'POST', body: blob, credentials: 'omit', cache: 'no-store'});
  expect(options.headers).toEqual({Authorization: 'Bearer tok', 'Content-Type': 'image/jpeg'});
});

test('upload failures expose the HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 413}));
  await expect(uploadPage(getToken, id, new Blob(['x']))).rejects.toMatchObject({status: 413});
});

test('listPages and listQuotes use owner-scoped query paths', async () => {
  const fetch = vi.fn().mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetch);
  await listPages(getToken, id);
  await listQuotes(getToken, {bookId: id, status: 'pending'});
  await listQuotes(getToken, {status: 'pending'});
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    `/api/books/${id}/pages`, `/api/quotes?book_id=${id}&status=pending`, '/api/quotes?status=pending'
  ]);
  expect(fetch.mock.calls[1][1].headers).toEqual({Authorization: 'Bearer tok'});
});

test('quote mutations send the contract shapes', async () => {
  const fetch = vi.fn().mockResolvedValue(ok({id: 'q1'}));
  vi.stubGlobal('fetch', fetch);
  await updateQuote(getToken, 'q1', {text: 'Edited', status: 'kept'});
  await addQuote(getToken, id, 'A passage');
  fetch.mockResolvedValue({ok: true, status: 204});
  await deleteQuote(getToken, 'q1');
  const [[patchUrl, patch], [postUrl, post], [delUrl, del]] = fetch.mock.calls;
  expect([patchUrl, patch.method, JSON.parse(patch.body)]).toEqual(['/api/quotes/q1', 'PATCH', {text: 'Edited', status: 'kept'}]);
  expect(patch.headers).toEqual({Authorization: 'Bearer tok', 'Content-Type': 'application/json'});
  expect([postUrl, post.method, JSON.parse(post.body)]).toEqual([`/api/books/${id}/quotes`, 'POST', {text: 'A passage'}]);
  expect([delUrl, del.method]).toEqual(['/api/quotes/q1', 'DELETE']);
});

test('fetchCrop returns the authorized image blob', async () => {
  const blob = new Blob(['c'], {type: 'image/jpeg'});
  const fetch = vi.fn().mockResolvedValue(ok(blob));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchCrop(getToken, 'q1')).toBe(blob);
  expect(fetch.mock.calls[0][0]).toBe('/api/quotes/q1/crop');
  expect(fetch.mock.calls[0][1].headers).toEqual({Authorization: 'Bearer tok'});
});
