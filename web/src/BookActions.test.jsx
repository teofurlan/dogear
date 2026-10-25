import React from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, test, vi} from 'vitest';
import BookActions from './BookActions.jsx';

vi.mock('./books.js', () => ({updateBook: vi.fn(), deleteBook: vi.fn()}));
vi.mock('./quotes.js', () => ({listQuotes: vi.fn()}));
import {deleteBook, updateBook} from './books.js';
import {listQuotes} from './quotes.js';

const book = {id: '000000000000000000000001', title: 'Teh quiet afternoon', author: 'Ada Reed', has_cover_photo: false};
const getToken = async () => 't';
const failure = status => Object.assign(new Error('Request failed'), {status});

function setup(props = {}) {
  const handlers = {onSessionExpired: vi.fn(), onChanged: vi.fn(), onDeleted: vi.fn()};
  render(<BookActions book={book} getToken={getToken} uploading={false} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => {
  vi.mocked(updateBook).mockReset();
  vi.mocked(deleteBook).mockReset();
  vi.mocked(listQuotes).mockReset().mockResolvedValue([{id: 'q1'}, {id: 'q2'}, {id: 'q3'}]);
});

test('edits the title and author and hands back the saved book', async () => {
  const saved = {...book, title: 'The quiet afternoon', author: null};
  vi.mocked(updateBook).mockResolvedValue(saved);
  const {onChanged} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Edit details'}));
  const title = screen.getByLabelText('Title');
  expect(title).toHaveFocus();
  expect(title).toHaveValue('Teh quiet afternoon');
  await userEvent.clear(title);
  await userEvent.type(title, '  The quiet afternoon ');
  await userEvent.clear(screen.getByLabelText(/Author/));
  await userEvent.click(screen.getByRole('button', {name: 'Save details'}));
  expect(updateBook).toHaveBeenCalledWith(getToken, book.id, {title: 'The quiet afternoon', author: null});
  expect(onChanged).toHaveBeenCalledWith(saved);
  expect(screen.queryByRole('form', {name: 'Edit book details'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Edit details'})).toHaveFocus();
});

test('an empty title is not sent, and cancel leaves the book unchanged', async () => {
  const {onChanged} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Edit details'}));
  await userEvent.clear(screen.getByLabelText('Title'));
  await userEvent.click(screen.getByRole('button', {name: 'Save details'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Add a title.');
  expect(updateBook).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
});

test('a failed save keeps the form and what was typed', async () => {
  vi.mocked(updateBook).mockRejectedValue(failure(503));
  setup();
  await userEvent.click(screen.getByRole('button', {name: 'Edit details'}));
  await userEvent.type(screen.getByLabelText('Title'), '!');
  await userEvent.click(screen.getByRole('button', {name: 'Save details'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('The changes were not saved. Please try again.');
  expect(screen.getByLabelText('Title')).toHaveValue('Teh quiet afternoon!');
});

test('deleting asks first and names how many kept quotes are lost', async () => {
  vi.mocked(deleteBook).mockResolvedValue(null);
  const {onDeleted} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  const dialog = screen.getByRole('alertdialog', {name: 'Delete “Teh quiet afternoon”?'});
  expect(dialog).toHaveAccessibleDescription('This deletes 3 kept quotes, its waiting pages and their photos. This cannot be undone.');
  expect(listQuotes).toHaveBeenCalledWith(getToken, {bookId: book.id, status: 'kept'}, expect.anything());
  expect(screen.getByRole('button', {name: 'Keep book'})).toHaveFocus();
  expect(deleteBook).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  expect(deleteBook).toHaveBeenCalledWith(getToken, book.id);
  expect(onDeleted).toHaveBeenCalledWith(book.id);
});

test('keeping the book closes the confirmation without deleting', async () => {
  vi.mocked(listQuotes).mockResolvedValue([]);
  const {onDeleted} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  expect(await screen.findByText(/This deletes no kept quotes/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Keep book'}));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Delete book'})).toHaveFocus();
  expect(deleteBook).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
});

test('confirmation waits for the count and still works when counting fails', async () => {
  let fail;
  vi.mocked(listQuotes).mockReturnValue(new Promise((_, reject) => {fail = reject;}));
  setup();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  expect(screen.getByText('Counting kept quotes…')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Delete book'})).toBeDisabled();
  fail(failure(503));
  expect(await screen.findByText(/This deletes its kept quotes/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Delete book'})).toBeEnabled();
});

test('a failed deletion keeps the book and says so', async () => {
  vi.mocked(deleteBook).mockRejectedValue(failure(503));
  const {onDeleted} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  await screen.findByText(/3 kept quotes/);
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('The book was not deleted. Please try again.');
  expect(onDeleted).not.toHaveBeenCalled();
});

test('a book already deleted elsewhere is treated as deleted', async () => {
  vi.mocked(deleteBook).mockRejectedValue(failure(404));
  const {onDeleted} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  await screen.findByText(/3 kept quotes/);
  await userEvent.click(screen.getByRole('button', {name: 'Delete book'}));
  expect(onDeleted).toHaveBeenCalledWith(book.id);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('editing a book deleted elsewhere says it is no longer in the library', async () => {
  vi.mocked(updateBook).mockRejectedValue(failure(404));
  const {onChanged} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Edit details'}));
  await userEvent.click(screen.getByRole('button', {name: 'Save details'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('This book is no longer in your library.');
  expect(onChanged).not.toHaveBeenCalled();
});

test('an expired session reports it instead of an error', async () => {
  vi.mocked(updateBook).mockRejectedValue(failure(401));
  const {onSessionExpired} = setup();
  await userEvent.click(screen.getByRole('button', {name: 'Edit details'}));
  await userEvent.click(screen.getByRole('button', {name: 'Save details'}));
  expect(onSessionExpired).toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('deleting is unavailable while photos are uploading', () => {
  setup({uploading: true});
  expect(screen.getByRole('button', {name: 'Delete book'})).toBeDisabled();
});
