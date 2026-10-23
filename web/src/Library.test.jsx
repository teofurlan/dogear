import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import App from './App.jsx';
import {listBooks} from './books.js';
import {listQuotes} from './quotes.js';

const auth = vi.hoisted(() => ({isLoading: false, isAuthenticated: true, user: {sub: 'reader-a'}, error: null,
  loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn()}));
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => auth}));
vi.mock('./books.js', () => ({PAGE_SIZE: 24, listBooks: vi.fn(), BooksError: class extends Error {}}));
vi.mock('./covers.js', () => ({loadCovers: vi.fn(async (books, receive) => books.forEach(item => receive(item.id, null)))}));
vi.mock('./quotes.js', () => ({listQuotes: vi.fn()}));
vi.mock('./BookView.jsx', () => ({default: ({book, onBack}) => <div><h1>View of {book.title}</h1><button onClick={onBack}>Back to library</button></div>}));

const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  listBooks.mockReset().mockResolvedValue([book]);
  listQuotes.mockReset().mockResolvedValue([]);
});
afterEach(() => window.history.replaceState(null, '', '/'));

test('clicking a book opens its view and syncs the hash; back returns to the library', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('link', {name: /A quiet afternoon/}));
  expect(await screen.findByRole('heading', {name: 'View of A quiet afternoon'})).toBeInTheDocument();
  expect(window.location.hash).toBe('#book=' + book.id);
  await userEvent.click(screen.getByRole('button', {name: 'Back to library'}));
  expect(await screen.findByRole('heading', {name: 'Your library'})).toBeInTheDocument();
  expect(window.location.hash).toBe('');
});

test('loading with #book=<id> opens that book (reload)', async () => {
  window.history.replaceState(null, '', '/#book=' + book.id);
  render(<App />);
  expect(await screen.findByRole('heading', {name: 'View of A quiet afternoon'})).toBeInTheDocument();
});

test('the browser back button leaves the book view', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('link', {name: /A quiet afternoon/}));
  await screen.findByRole('heading', {name: 'View of A quiet afternoon'});
  window.history.back();
  expect(await screen.findByRole('heading', {name: 'Your library'})).toBeInTheDocument();
});

test('a banner links to the book when quotes wait for review', async () => {
  listQuotes.mockResolvedValue([{id: 'q1', book_id: book.id}, {id: 'q2', book_id: book.id}]);
  render(<App />);
  const link = await screen.findByRole('link', {name: /Review/});
  expect(screen.getByText(/2 quotes are waiting for review/)).toBeInTheDocument();
  expect(link).toHaveAttribute('href', '#book=' + book.id);
  expect(listQuotes).toHaveBeenCalledWith(expect.any(Function), {status: 'pending'}, expect.anything());
});

test('no banner when nothing is waiting, and a failed lookup stays silent', async () => {
  const {unmount} = render(<App />);
  await screen.findByRole('link', {name: /A quiet afternoon/});
  expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
  unmount();
  listQuotes.mockRejectedValue(new Error('down'));
  render(<App />);
  await screen.findByRole('link', {name: /A quiet afternoon/});
  await waitFor(() => expect(listQuotes).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
});
