import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import App from './App.jsx';
import {getBook, listBooks} from './books.js';
import {listQuotes} from './quotes.js';
import {exportAllQuotes} from './export.js';

const auth = vi.hoisted(() => ({isLoading: false, isAuthenticated: true, user: {sub: 'reader-a'}, error: null,
  loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn()}));
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => auth}));
vi.mock('./books.js', () => ({PAGE_SIZE: 24, listBooks: vi.fn(), getBook: vi.fn(), BooksError: class extends Error {}}));
vi.mock('./covers.js', () => ({loadCovers: vi.fn(async (books, receive) => books.forEach(item => receive(item.id, null)))}));
vi.mock('./quotes.js', () => ({listQuotes: vi.fn()}));
vi.mock('./export.js', () => ({exportAllQuotes: vi.fn(), exportBookQuotes: vi.fn()}));
vi.mock('./BookView.jsx', () => ({default: ({book, onBack, onChanged, onDeleted}) => <div>
  <h1>View of {book.title}</h1>
  <button onClick={onBack}>Back to library</button>
  <button onClick={() => onChanged({...book, title: 'A quieter afternoon', author: null})}>rename</button>
  <button onClick={() => onDeleted(book.id)}>delete</button>
</div>}));

const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  listBooks.mockReset().mockResolvedValue([book]);
  getBook.mockReset();
  listQuotes.mockReset().mockResolvedValue([]);
  exportAllQuotes.mockReset();
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
}, 15000);

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

test('each book link is named by its title and author, not by its cover placeholder', async () => {
  render(<App />);
  expect(await screen.findByRole('link', {name: 'A quiet afternoon by Ada Reed'})).toBeInTheDocument();
});

test('book not in loaded library is fetched by id on direct link', async () => {
  const other = {id: '000000000000000000000099', title: 'Deep in the shelf', author: 'Leo'};
  listBooks.mockResolvedValue([book]);
  getBook.mockResolvedValue(other);
  window.history.replaceState(null, '', '/#book=' + other.id);
  render(<App />);
  expect(await screen.findByRole('heading', {name: 'View of Deep in the shelf'})).toBeInTheDocument();
  expect(getBook).toHaveBeenCalledWith(expect.any(Function), other.id, expect.anything());
});

test('book returning 404 shows not in your library state with back to library button', async () => {
  listBooks.mockResolvedValue([book]);
  getBook.mockRejectedValue({status: 404});
  window.history.replaceState(null, '', '/#book=000000000000000000000404');
  render(<App />);
  expect(await screen.findByText('This book is not in your library.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Back to library'}));
  expect(await screen.findByRole('heading', {name: 'Your library'})).toBeInTheDocument();
  expect(window.location.hash).toBe('');
});

test('book cards show a pending badge and open in one tap', async () => {
  listQuotes.mockResolvedValue([{id: 'q1', book_id: book.id}, {id: 'q2', book_id: book.id}]);
  render(<App />);
  const badge = await screen.findByText('2 to review');
  expect(badge).toBeInTheDocument();
  await userEvent.click(badge);
  expect(await screen.findByRole('heading', {name: 'View of A quiet afternoon'})).toBeInTheDocument();
});

test('unloaded books with pending quotes are fetched and listed in the banner', async () => {
  const unloaded = {id: '000000000000000000000088', title: 'Unloaded volume', author: 'Author B'};
  listBooks.mockResolvedValue([book]);
  getBook.mockResolvedValue(unloaded);
  listQuotes.mockResolvedValue([
    {id: 'q1', book_id: book.id},
    {id: 'q2', book_id: unloaded.id},
    {id: 'q3', book_id: unloaded.id}
  ]);
  render(<App />);
  expect(await screen.findByText('3 quotes are waiting for review.')).toBeInTheDocument();
  const bannerLink = await screen.findByRole('link', {name: /Review “Unloaded volume”/});
  expect(bannerLink).toBeInTheDocument();
  await userEvent.click(bannerLink);
  expect(await screen.findByRole('heading', {name: 'View of Unloaded volume'})).toBeInTheDocument();
});

test('returning from a book refreshes pending quote counts', async () => {
  listQuotes.mockResolvedValueOnce([{id: 'q1', book_id: book.id}]);
  render(<App />);
  expect(await screen.findByText('1 to review')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', {name: 'A quiet afternoon by Ada Reed'}));
  expect(await screen.findByRole('heading', {name: 'View of A quiet afternoon'})).toBeInTheDocument();
  listQuotes.mockResolvedValueOnce([]);
  await userEvent.click(screen.getByRole('button', {name: 'Back to library'}));
  expect(await screen.findByRole('heading', {name: 'Your library'})).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/to review/)).not.toBeInTheDocument());
});

test('search field queries by q with debounce and cancels stale requests', async () => {
  const matchingBook = {id: '000000000000000000000042', title: 'Cien años', author: 'García'};
  listBooks.mockResolvedValueOnce([book]).mockResolvedValueOnce([matchingBook]);
  render(<App />);
  await screen.findByRole('heading', {name: book.title});
  const input = screen.getByRole('searchbox', {name: 'Search by title or author'});
  await userEvent.type(input, 'García');
  expect(await screen.findByRole('heading', {name: 'Cien años'})).toBeInTheDocument();
  expect(listBooks).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({q: 'García'}));
  expect(listBooks.mock.calls[0][1].signal.aborted).toBe(true);
});

test('clearing search restores the normal library', async () => {
  const matchingBook = {id: '000000000000000000000042', title: 'Cien años', author: 'García'};
  listBooks.mockResolvedValueOnce([book]).mockResolvedValueOnce([matchingBook]).mockResolvedValueOnce([book]);
  render(<App />);
  await screen.findByRole('heading', {name: book.title});
  const input = screen.getByRole('searchbox', {name: 'Search by title or author'});
  await userEvent.type(input, 'García');
  expect(await screen.findByRole('heading', {name: 'Cien años'})).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Clear'}));
  expect(await screen.findByRole('heading', {name: book.title})).toBeInTheDocument();
  expect(input).toHaveValue('');
});

test('empty search results show no books found feedback', async () => {
  listBooks.mockResolvedValueOnce([book]).mockResolvedValueOnce([]);
  render(<App />);
  await screen.findByRole('heading', {name: book.title});
  const input = screen.getByRole('searchbox', {name: 'Search by title or author'});
  await userEvent.type(input, 'Nonexistent');
  expect(await screen.findByRole('heading', {name: 'No books found'})).toBeInTheDocument();
  expect(screen.getByText('No books match “Nonexistent”.')).toBeInTheDocument();
});

test('an edited book shows its new details in the view and the library', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('link', {name: /A quiet afternoon/}));
  await userEvent.click(await screen.findByRole('button', {name: 'rename'}));
  expect(await screen.findByRole('heading', {name: 'View of A quieter afternoon'})).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Back to library'}));
  expect(await screen.findByRole('link', {name: 'A quieter afternoon'})).toBeInTheDocument();
  expect(screen.queryByRole('link', {name: /A quiet afternoon by/})).not.toBeInTheDocument();
}, 15000);

test('a deleted book returns to the library without that book', async () => {
  const other = {id: '000000000000000000000002', title: 'A loud morning', author: null};
  listBooks.mockResolvedValue([book, other]);
  listQuotes.mockResolvedValue([{id: 'q1', book_id: book.id, status: 'pending'}]);
  render(<App />);
  await userEvent.click(await screen.findByRole('link', {name: 'A quiet afternoon by Ada Reed'}));
  listQuotes.mockResolvedValue([]);
  await userEvent.click(await screen.findByRole('button', {name: 'delete'}));
  expect(await screen.findByRole('heading', {name: 'Your library'})).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(screen.queryByRole('link', {name: /A quiet afternoon/})).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name: 'A loud morning'})).toBeInTheDocument();
  expect(screen.queryByText(/waiting for review/i)).not.toBeInTheDocument();
  expect(getBook).not.toHaveBeenCalled();
}, 15000);

test('library export actions are shown when the library has books and hidden when empty', async () => {
  const {unmount} = render(<App />);
  expect(await screen.findByRole('group', {name: 'Export quotes'})).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Export Markdown'})).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Export CSV'})).toBeInTheDocument();
  unmount();

  listBooks.mockResolvedValueOnce([]);
  render(<App />);
  await screen.findByRole('heading', {name: 'Your library is empty.'});
  expect(screen.queryByRole('group', {name: 'Export quotes'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Export Markdown'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Export CSV'})).not.toBeInTheDocument();
});

test('clicking export markdown in library calls exportAllQuotes with markdown format', async () => {
  exportAllQuotes.mockResolvedValueOnce();
  render(<App />);
  const button = await screen.findByRole('button', {name: 'Export Markdown'});
  await userEvent.click(button);
  expect(exportAllQuotes).toHaveBeenCalledWith(expect.any(Function), 'markdown');
});

test('clicking export csv in library calls exportAllQuotes with csv format', async () => {
  exportAllQuotes.mockResolvedValueOnce();
  render(<App />);
  const button = await screen.findByRole('button', {name: 'Export CSV'});
  await userEvent.click(button);
  expect(exportAllQuotes).toHaveBeenCalledWith(expect.any(Function), 'csv');
});

test('library export shows busy state while export is in progress', async () => {
  let finishExport;
  exportAllQuotes.mockReturnValueOnce(new Promise(resolve => { finishExport = resolve; }));
  render(<App />);
  const mdButton = await screen.findByRole('button', {name: 'Export Markdown'});
  const csvButton = screen.getByRole('button', {name: 'Export CSV'});
  await userEvent.click(mdButton);
  expect(mdButton).toHaveTextContent('Exporting…');
  expect(mdButton).toBeDisabled();
  expect(csvButton).toBeDisabled();
  finishExport();
  await waitFor(() => expect(mdButton).toHaveTextContent('Export Markdown'));
  expect(mdButton).not.toBeDisabled();
  expect(csvButton).not.toBeDisabled();
});

test('a 401 during library export shows the shared session-ended notice', async () => {
  exportAllQuotes.mockRejectedValueOnce({status: 401});
  render(<App />);
  const button = await screen.findByRole('button', {name: 'Export Markdown'});
  await userEvent.click(button);
  expect(await screen.findByText('Your session ended. Sign in again to continue.')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Sign in again'})).toBeInTheDocument();
});

test('a failure during library export shows an inline error', async () => {
  exportAllQuotes.mockRejectedValueOnce(new Error('network error'));
  render(<App />);
  const button = await screen.findByRole('button', {name: 'Export Markdown'});
  await userEvent.click(button);
  expect(await screen.findByText('Export failed. Please try again.')).toBeInTheDocument();
});

