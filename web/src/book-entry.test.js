import {afterEach, expect, test, vi} from 'vitest';
import {createBook, identifyBook, isValidLine} from './book-entry.js';
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

test('isValidLine validates line structure, box bounds, and roles', () => {
  expect(isValidLine({text: 'Book', box: [0, 0.1, 0.9, 1], role: 'title'})).toBe(true);
  expect(isValidLine({text: 'Author', box: [0.1, 0.2, 0.3, 0.4], role: 'author'})).toBe(true);
  expect(isValidLine({text: 'Other', box: [0, 0, 0.5, 0.5], role: null})).toBe(true);
  expect(isValidLine({text: 'Other', box: [0, 0, 0.5, 0.5]})).toBe(true);

  expect(isValidLine(null)).toBe(false);
  expect(isValidLine(undefined)).toBe(false);
  expect(isValidLine({})).toBe(false);
  expect(isValidLine({text: 123, box: [0, 0, 1, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, 1, 1, 0]})).toBe(false);
  expect(isValidLine({text: 'T', box: 'not-array'})).toBe(false);
  expect(isValidLine({text: 'T', box: [-0.01, 0, 1, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, 1.01, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, NaN, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, Infinity, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: ['0', 0, 1, 1]})).toBe(false);
  expect(isValidLine({text: 'T', box: [0, 0, 1, 1], role: 'other'})).toBe(false);
});

test('identifyBook accepts valid lines and rejects malformed lines', async () => {
  const photo = new File(['photo'], 'cover.png', {type: 'image/png'});
  const valid = {
    title: 'Book', author: null, text: 'Book',
    lines: [{text: 'Book', box: [0.1, 0.2, 0.3, 0.4], role: 'title'}]
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => valid}));
  expect(await identifyBook(async () => 'token', photo)).toEqual(valid);

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({title: 'Book', author: null, text: 'Book', lines: 'not-an-array'})
  }));
  await expect(identifyBook(async () => 'token', photo)).rejects.toThrow();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({title: 'Book', author: null, text: 'Book', lines: [{text: 'Line', box: [1, 2]}]})
  }));
  await expect(identifyBook(async () => 'token', photo)).rejects.toThrow();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({title: 'Book', author: null, text: 'Book', lines: [{text: 'Line', box: [0, 0, 1.1, 1], role: 'title'}]})
  }));
  await expect(identifyBook(async () => 'token', photo)).rejects.toThrow();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({title: 'Book', author: null, text: 'Book', lines: [{text: 'Line', box: [0, 0, 1, 1], role: 'publisher'}]})
  }));
  await expect(identifyBook(async () => 'token', photo)).rejects.toThrow();
});
