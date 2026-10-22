import React from 'react';
import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {beforeEach, expect, test, vi} from 'vitest';
import App from './App.jsx';
import {listBooks} from './books.js';
import {loadCovers} from './covers.js';

const auth = vi.hoisted(() => ({
  isLoading: false, isAuthenticated: false, user: {sub: 'reader-a'}, error: null,
  loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn()
}));
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => auth}));
vi.mock('./books.js', () => ({PAGE_SIZE: 24, listBooks: vi.fn(), BooksError: class extends Error {constructor(status) {super('Books unavailable'); this.status = status;}}}));
vi.mock('./covers.js', () => ({loadCovers: vi.fn()}));

const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};
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

test('authenticated library shows title, author and a neutral missing-cover treatment', async () => {
  auth.isAuthenticated = true;
  render(<App />);
  expect(await screen.findByRole('heading', {name: book.title})).toBeVisible();
  expect(screen.getByText(book.author)).toBeVisible();
  expect(screen.getByText('No cover available')).toBeVisible();
  expect(listBooks).toHaveBeenCalledWith(auth.getAccessTokenSilently, expect.objectContaining({signal: expect.any(AbortSignal)}));
  fireEvent.click(screen.getByRole('button', {name: 'Sign out'}));
  expect(auth.logout).toHaveBeenCalledWith({logoutParams: {returnTo: window.location.origin}});
});

test('cover failures do not remove a book or hide its full title', async () => {
  auth.isAuthenticated = true;
  loadCovers.mockImplementation(async (books, receive) => receive(book.id, 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false'));
  render(<App />);
  const image = await screen.findByRole('img', {name: `Representative cover of ${book.title}`});
  fireEvent.error(image);
  expect(screen.getByRole('heading', {name: book.title})).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
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
