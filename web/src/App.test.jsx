import React from 'react';
import {render, screen, waitFor, fireEvent, within, act} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import App from './App.jsx';
import {listBooks} from './books.js';
import {loadCovers} from './covers.js';

const auth = vi.hoisted(() => ({
  isLoading: false, isAuthenticated: false, user: {sub: 'reader-a'}, error: null,
  loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn()
}));
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => auth}));
vi.mock('./books.js', () => ({PAGE_SIZE: 24, listBooks: vi.fn(), getBook: vi.fn(), BooksError: class extends Error {constructor(status) {super('Books unavailable'); this.status = status;}}}));
vi.mock('./covers.js', () => ({loadCovers: vi.fn()}));

const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  Object.assign(auth, {isLoading: false, isAuthenticated: false, user: {sub: 'reader-a'}, error: null});
  listBooks.mockReset().mockResolvedValue([book]);
  loadCovers.mockReset().mockImplementation(async (books, receive) => books.forEach(item => receive(item.id, null)));
});

test('signed-out users can start login without fetching books', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', {name: 'Sign in to library'}));
  expect(auth.loginWithRedirect).toHaveBeenCalled();
  expect(listBooks).not.toHaveBeenCalled();
});

test('header shows the complete name with red punctuation', () => {
  render(<App />);
  const brand = screen.getByRole('link', {name: 'Dogear home'});
  expect(brand).toHaveTextContent(/^dogear\.$/);
  expect(brand.querySelector('span')).toHaveTextContent('.');
});

test('sign-in explains the photo-to-quote loop', () => {
  render(<App />);
  expect(screen.getByRole('main').parentElement).toHaveClass('catalog-shell--signin');
  expect(screen.getByText('One home for your books and favorite quotes. Photograph your highlighted pages—no copying, no retyping.')).toBeVisible();
  expect(screen.getByText('Snap a page while you read. A small open model types the highlights overnight; you review them in the morning.')).toBeVisible();
});

test('signed-out example covers show loading feedback until their image loads', () => {
  render(<App />);
  const gallery = screen.getByRole('region', {name: 'A few familiar covers'});
  expect(within(gallery).getAllByRole('progressbar')).toHaveLength(4);
  expect(within(gallery).queryByText('Loading cover…')).not.toBeInTheDocument();
  expect(within(gallery).queryByText('No cover available')).not.toBeInTheDocument();
  for (const item of within(gallery).getAllByRole('listitem')) {
    expect(item.querySelector('.fallback-title')).not.toBeInTheDocument();
    expect(within(item).getByRole('heading', {level: 3})).toBeVisible();
  }
});

test('signed-out cover gallery labels public examples without accessing account data', () => {
  render(<App />);
  const gallery = screen.getByRole('region', {name: 'A few familiar covers'});
  expect(within(gallery).getByRole('list', {name: 'Example book covers'})).not.toHaveAttribute('tabindex');
  expect(within(gallery).getAllByRole('listitem')).toHaveLength(4);
  const images = within(gallery).getAllByRole('img');
  expect(images).toHaveLength(4);
  for (const image of images) {
    expect(image.src).toMatch(/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-M\.jpg\?default=false$/);
    expect(image).toHaveAttribute('referrerPolicy', 'no-referrer');
  }
  expect(within(gallery).getByText('Public catalog examples, not books in your library.')).toBeVisible();
  fireEvent.error(images[0]);
  expect(within(gallery).getAllByRole('img')).toHaveLength(3);
  expect(within(within(gallery).getAllByRole('listitem')[0]).getByText('No cover available')).toBeVisible();
  expect(listBooks).not.toHaveBeenCalled();
  expect(loadCovers).not.toHaveBeenCalled();
});

test('example selection stays stable while the signed-out screen rerenders', () => {
  const view = render(<App />);
  const titles = () => screen.getAllByRole('heading', {level: 3}).map(heading => heading.textContent);
  const initial = titles();
  view.rerender(<App />);
  expect(titles()).toEqual(initial);
});

test('returning to sign-in after an authenticated session selects new examples', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const view = render(<App />);
  const initial = screen.getAllByRole('heading', {level: 3}).map(heading => heading.textContent);
  auth.isAuthenticated = true;
  listBooks.mockResolvedValue([]);
  view.rerender(<App />);
  expect(await screen.findByText('Your library is empty.')).toBeVisible();
  expect(screen.queryByRole('region', {name: 'A few familiar covers'})).not.toBeInTheDocument();
  random.mockReturnValue(0.999);
  auth.isAuthenticated = false;
  view.rerender(<App />);
  const next = screen.getAllByRole('heading', {level: 3}).map(heading => heading.textContent);
  expect(next).toHaveLength(4);
  expect(next).not.toEqual(initial);
});

test('example gallery stays out of session loading and authenticated empty libraries', async () => {
  auth.isLoading = true;
  const view = render(<App />);
  expect(screen.queryByRole('region', {name: 'A few familiar covers'})).not.toBeInTheDocument();
  auth.isLoading = false;
  auth.isAuthenticated = true;
  listBooks.mockResolvedValue([]);
  view.rerender(<App />);
  expect(await screen.findByText('Your library is empty.')).toBeVisible();
  expect(screen.queryByRole('region', {name: 'A few familiar covers'})).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('authenticated library shows title, author and a neutral missing-cover treatment', async () => {
  auth.isAuthenticated = true;
  render(<App />);
  expect(screen.getByRole('main').parentElement).not.toHaveClass('catalog-shell--signin');
  expect(await screen.findByRole('heading', {name: book.title})).toBeVisible();
  expect(screen.getByText(book.author)).toBeVisible();
  const fallback = await screen.findByText('No cover available');
  expect(fallback).toBeVisible();
  expect(fallback.closest('.cover-wrap')).not.toHaveClass('is-loaded');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(listBooks).toHaveBeenCalledWith(auth.getAccessTokenSilently, expect.objectContaining({signal: expect.any(AbortSignal)}));
  fireEvent.click(screen.getByRole('button', {name: 'Sign out'}));
  expect(auth.logout).toHaveBeenCalledWith({logoutParams: {returnTo: window.location.origin}});
});

test('library cover loader remains through lookup and download, then stops on load', async () => {
  auth.isAuthenticated = true;
  let receive;
  loadCovers.mockImplementation((books, callback) => {receive = callback;});
  render(<App />);
  await screen.findByRole('heading', {name: book.title});
  expect(screen.getByRole('progressbar', {name: `Loading cover of ${book.title}`})).toBeVisible();
  expect(screen.queryByText('No cover available')).not.toBeInTheDocument();
  act(() => receive(book.id, 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false'));
  expect(screen.getByRole('progressbar')).toBeVisible();
  fireEvent.load(screen.getByRole('img'));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', {name: book.title})).toBeVisible();
});

test('cover failures do not remove a book or hide its full title', async () => {
  auth.isAuthenticated = true;
  loadCovers.mockImplementation(async (books, receive) => receive(book.id, 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false'));
  render(<App />);
  const image = await screen.findByRole('img', {name: `Representative cover of ${book.title}`});
  fireEvent.error(image);
  expect(screen.getByRole('heading', {name: book.title})).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('No cover available')).toBeVisible();
});

test('loading and empty states are explicit, with no invented book records', async () => {
  auth.isAuthenticated = true;
  let finish;
  listBooks.mockReturnValue(new Promise(resolve => {finish = resolve;}));
  render(<App />);
  expect(screen.getByText('Loading your library…')).toBeVisible();
  finish([]);
  expect(await screen.findByText('Your library is empty.')).toBeVisible();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('storage errors are recoverable and do not expose server details', async () => {
  auth.isAuthenticated = true;
  listBooks.mockRejectedValueOnce(new Error('private backend connection details'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', {name: 'Try again'}));
  expect(await screen.findByRole('heading', {name: book.title})).toBeVisible();
  expect(screen.queryByText(/private backend/)).not.toBeInTheDocument();
});

test('switching accounts removes old books and aborts the previous request', async () => {
  auth.isAuthenticated = true;
  const view = render(<App />);
  await screen.findByRole('heading', {name: book.title});
  const oldSignal = listBooks.mock.calls[0][1].signal;
  listBooks.mockReturnValue(new Promise(() => {}));
  auth.user = {sub: 'reader-b'};
  view.rerender(<App />);
  await waitFor(() => expect(screen.queryByRole('heading', {name: book.title})).not.toBeInTheDocument());
  expect(oldSignal.aborted).toBe(true);
});

test('another page uses the last owned-book ID rather than a client owner parameter', async () => {
  auth.isAuthenticated = true;
  const firstPage = Array.from({length: 24}, (_, index) => ({...book, id: String(index + 1).padStart(24, '0'), title: `Example ${index + 1}`}));
  listBooks.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([{...book, id:'000000000000000000000025',title:'Last example'}]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', {name: 'Load more books'}));
  expect(await screen.findByRole('heading', {name: 'Last example'})).toBeVisible();
  expect(listBooks.mock.calls[1][1].after).toBe(firstPage.at(-1).id);
  expect(screen.queryByRole('button', {name: 'Load more books'})).not.toBeInTheDocument();
});
