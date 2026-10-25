import React from 'react';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, test, vi} from 'vitest';
import QuoteReview from './QuoteReview.jsx';
import {addQuote, deleteQuote, fetchCrop, listQuotes, updateQuote} from './quotes.js';

vi.mock('./quotes.js', () => ({listQuotes: vi.fn(), updateQuote: vi.fn(), deleteQuote: vi.fn(), addQuote: vi.fn(), fetchCrop: vi.fn()}));
const getToken = async () => 'tok';
const id = '000000000000000000000001';
const quote = (over = {}) => ({id: 'q1', book_id: id, page_id: 'p1', text: 'Found line', flags: [], status: 'pending', has_crop: false, created_at: 'x', ...over});
let pending, kept;

beforeEach(() => {
  pending = []; kept = [];
  listQuotes.mockReset().mockImplementation(async (_t, {status}) => status === 'pending' ? pending : kept);
  updateQuote.mockReset(); deleteQuote.mockReset().mockResolvedValue(null); addQuote.mockReset(); fetchCrop.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:crop-1');
  URL.revokeObjectURL = vi.fn();
});

test('empty states explain what happens next', async () => {
  render(<QuoteReview getToken={getToken} bookId={id} />);
  expect(await screen.findByText("Tonight's run will find your highlights")).toBeInTheDocument();
  expect(screen.getByText('No kept quotes yet.')).toBeInTheDocument();
  expect(listQuotes).toHaveBeenCalledWith(getToken, {bookId: id, status: 'pending'}, expect.anything());
  expect(listQuotes).toHaveBeenCalledWith(getToken, {bookId: id, status: 'kept'}, expect.anything());
});

test('keep sends the edited text and moves the quote to kept', async () => {
  pending = [quote()];
  updateQuote.mockResolvedValue(quote({text: 'Fixed line', status: 'kept'}));
  render(<QuoteReview getToken={getToken} bookId={id} />);
  const box = await screen.findByLabelText('Quote text');
  await userEvent.clear(box); await userEvent.type(box, 'Fixed line');
  await userEvent.click(screen.getByRole('button', {name: 'Keep'}));
  expect(updateQuote).toHaveBeenCalledWith(getToken, 'q1', {text: 'Fixed line', status: 'kept'});
  const keptList = await screen.findByRole('list', {name: 'Kept quotes'});
  expect(within(keptList).getByText('Fixed line')).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Keep'})).not.toBeInTheDocument();
});

test('delete removes a pending quote and calls deleteQuote when undo window closes', async () => {
  pending = [quote()];
  render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={25} />);
  await userEvent.click(await screen.findByRole('button', {name: 'Delete'}));
  expect(screen.queryByLabelText('Quote text')).not.toBeInTheDocument();
  const notice = screen.getByRole('status');
  expect(notice).toHaveAttribute('aria-live', 'polite');
  expect(notice).toHaveTextContent(/Quote deleted\.\s*Undo/);
  expect(deleteQuote).not.toHaveBeenCalled();
  await waitFor(() => expect(deleteQuote).toHaveBeenCalledWith(getToken, 'q1'));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

test('kept quotes can be edited and deleted', async () => {
  kept = [quote({status: 'kept', text: 'Old'})];
  updateQuote.mockResolvedValue(quote({status: 'kept', text: 'New'}));
  render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={25} />);
  await userEvent.click(await screen.findByRole('button', {name: 'Edit quote'}));
  const box = screen.getByLabelText('Edit quote text');
  await userEvent.clear(box); await userEvent.type(box, 'New');
  await userEvent.click(screen.getByRole('button', {name: 'Save'}));
  expect(updateQuote).toHaveBeenCalledWith(getToken, 'q1', {text: 'New'});
  expect(await screen.findByText('New')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Delete quote'}));
  expect(screen.queryByText('New')).not.toBeInTheDocument();
  expect(screen.getByText('No kept quotes yet.')).toBeInTheDocument();
  expect(deleteQuote).not.toHaveBeenCalled();
  await waitFor(() => expect(deleteQuote).toHaveBeenCalledWith(getToken, 'q1'));
});

test('undo restores a pending quote in its original place with its text and status', async () => {
  pending = [quote({id: 'q1', text: 'First passage'}), quote({id: 'q2', text: 'Second passage'})];
  render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={5000} />);
  const deleteButtons = await screen.findAllByRole('button', {name: 'Delete'});
  await userEvent.click(deleteButtons[0]);
  expect(screen.queryByDisplayValue('First passage')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('Second passage')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Undo'}));
  const textareas = screen.getAllByLabelText('Quote text');
  expect(textareas).toHaveLength(2);
  expect(textareas[0]).toHaveValue('First passage');
  expect(textareas[1]).toHaveValue('Second passage');
  expect(deleteQuote).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('undo restores a kept quote in its original place with its text and status', async () => {
  kept = [quote({id: 'k1', status: 'kept', text: 'First kept'}), quote({id: 'k2', status: 'kept', text: 'Second kept'}), quote({id: 'k3', status: 'kept', text: 'Third kept'})];
  render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={5000} />);
  await screen.findByText('First kept');
  const deleteButtons = screen.getAllByRole('button', {name: 'Delete quote'});
  await userEvent.click(deleteButtons[1]); // delete k2
  expect(screen.queryByText('Second kept')).not.toBeInTheDocument();
  expect(screen.getByText('First kept')).toBeInTheDocument();
  expect(screen.getByText('Third kept')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Undo'}));
  const blockquotes = screen.getAllByRole('list', {name: 'Kept quotes'})[0].querySelectorAll('blockquote');
  expect(blockquotes).toHaveLength(3);
  expect(blockquotes[0]).toHaveTextContent('First kept');
  expect(blockquotes[1]).toHaveTextContent('Second kept');
  expect(blockquotes[2]).toHaveTextContent('Third kept');
  expect(deleteQuote).not.toHaveBeenCalled();
});

test('leaving the book view during the undo window sends deleteQuote right away', async () => {
  pending = [quote({id: 'q1'})];
  const {unmount} = render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={5000} />);
  await userEvent.click(await screen.findByRole('button', {name: 'Delete'}));
  expect(deleteQuote).not.toHaveBeenCalled();
  unmount();
  expect(deleteQuote).toHaveBeenCalledWith(getToken, 'q1');
});

test('deleting another quote flushes the previous pending delete immediately', async () => {
  pending = [quote({id: 'q1', text: 'Quote 1'}), quote({id: 'q2', text: 'Quote 2'})];
  render(<QuoteReview getToken={getToken} bookId={id} undoTimeout={5000} />);
  const deleteButtons = await screen.findAllByRole('button', {name: 'Delete'});
  await userEvent.click(deleteButtons[0]);
  expect(deleteQuote).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: 'Delete'}));
  expect(deleteQuote).toHaveBeenCalledWith(getToken, 'q1');
  expect(deleteQuote).not.toHaveBeenCalledWith(getToken, 'q2');
  await userEvent.click(screen.getByRole('button', {name: 'Undo'}));
  expect(screen.getByDisplayValue('Quote 2')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Quote 1')).not.toBeInTheDocument();
});

test('a passage typed by hand is added as a kept quote', async () => {
  addQuote.mockResolvedValue(quote({id: 'q9', status: 'kept', text: 'Typed passage', page_id: null}));
  render(<QuoteReview getToken={getToken} bookId={id} />);
  await userEvent.type(await screen.findByLabelText('Add a passage you highlighted'), '  Typed passage ');
  await userEvent.click(screen.getByRole('button', {name: 'Add passage'}));
  expect(addQuote).toHaveBeenCalledWith(getToken, id, 'Typed passage');
  expect(await screen.findByText('Typed passage')).toBeInTheDocument();
  expect(screen.getByLabelText('Add a passage you highlighted')).toHaveValue('');
});

test('the crop is fetched with the token, shown, and its object URL revoked on unmount', async () => {
  pending = [quote({has_crop: true})];
  const blob = new Blob(['c'], {type: 'image/jpeg'});
  fetchCrop.mockResolvedValue(blob);
  const {unmount} = render(<QuoteReview getToken={getToken} bookId={id} />);
  const image = await screen.findByAltText('Photo of the highlighted passage');
  expect(fetchCrop).toHaveBeenCalledWith(getToken, 'q1', expect.anything());
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(image).toHaveAttribute('src', 'blob:crop-1');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:crop-1');
});

test('quotes without a crop do not request one', async () => {
  pending = [quote()];
  render(<QuoteReview getToken={getToken} bookId={id} />);
  await screen.findByLabelText('Quote text');
  expect(fetchCrop).not.toHaveBeenCalled();
});

test('flags explain why the text needs a second look', async () => {
  pending = [quote({id: 'a', flags: ['disagreement']}), quote({id: 'b', flags: ['ocr_only']}), quote({id: 'c', flags: ['model_unavailable']}), quote({id: 'd', flags: []})];
  render(<QuoteReview getToken={getToken} bookId={id} />);
  await screen.findAllByLabelText('Quote text');
  expect(screen.getAllByText('The two readers disagreed — check it against the photo.')).toHaveLength(1);
  expect(screen.getAllByText(/came from OCR only/)).toHaveLength(2);
});

test('a failed save keeps the quote and says so', async () => {
  pending = [quote()];
  updateQuote.mockRejectedValue(Object.assign(new Error('x'), {status: 503}));
  render(<QuoteReview getToken={getToken} bookId={id} />);
  await userEvent.click(await screen.findByRole('button', {name: 'Keep'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
  expect(screen.getByLabelText('Quote text')).toBeInTheDocument();
});
