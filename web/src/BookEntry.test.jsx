import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {beforeEach, expect, test, vi} from 'vitest';
import BookEntry from './BookEntry.jsx';
import {createBook, identifyBook} from './book-entry.js';

vi.mock('./book-entry.js', () => ({createBook: vi.fn(), identifyBook: vi.fn()}));
const saved = {id: '000000000000000000000099', title: 'Synthetic book', author: null};
beforeEach(() => {createBook.mockReset().mockResolvedValue(saved); identifyBook.mockReset();});
const open = () => fireEvent.click(screen.getByRole('button', {name: 'Add book'}));

test('manual entry requires a title and saves trimmed fields only after confirmation', async () => {
  const receive = vi.fn();
  render(<BookEntry getToken={vi.fn()} onCreated={receive} />); open();
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  expect(createBook).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: ' Synthetic book '}});
  fireEvent.submit(screen.getByRole('form', {name: 'Add a book'}));
  await waitFor(() => expect(receive).toHaveBeenCalledWith(saved));
  expect(createBook.mock.calls[0][1]).toEqual({title: 'Synthetic book', author: null});
});

test('photo fills editable suggestions but never saves until the reader confirms', async () => {
  identifyBook.mockResolvedValue({title: 'OCR title', author: 'OCR author', text: 'Detected text'});
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});
  expect(await screen.findByDisplayValue('OCR title')).toBeVisible();
  expect(createBook).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Corrected title'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(createBook).toHaveBeenCalled());
  expect(createBook.mock.calls[0][1]).toEqual({title: 'Corrected title', author: 'OCR author'});
});

test('the accessible cover zone accepts native selection and one dropped photo without saving automatically', async () => {
  let finishSave;
  createBook.mockReturnValue(new Promise(resolve => {finishSave = resolve;}));
  identifyBook.mockResolvedValue({title: 'Photo title', author: '', text: ''});
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const input = screen.getByLabelText('Cover photo');
  expect(input).toHaveAttribute('type', 'file');
  expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
  expect(input).toHaveAttribute('capture', 'environment');
  expect(input).toHaveAttribute('aria-describedby', 'cover-help');
  const nativePhoto = new File(['native'], 'native.jpg', {type: 'image/jpeg'});
  fireEvent.change(input, {target: {files: [nativePhoto]}});
  expect(await screen.findByDisplayValue('Photo title')).toBeVisible();
  expect(identifyBook).toHaveBeenCalledWith(expect.any(Function), nativePhoto, expect.objectContaining({signal: expect.any(AbortSignal)}));
  expect(createBook).not.toHaveBeenCalled();

  const zone = screen.getByRole('group', {name: 'Cover photo options'});
  const droppedPhoto = new File(['dropped'], 'dropped.png', {type: 'image/png'});
  fireEvent.dragOver(zone, {dataTransfer: {files: [droppedPhoto]}});
  expect(zone).toHaveClass('is-drag-over');
  fireEvent.drop(zone, {dataTransfer: {files: [droppedPhoto]}});
  expect(await screen.findByDisplayValue('Photo title')).toBeVisible();
  expect(identifyBook).toHaveBeenLastCalledWith(expect.any(Function), droppedPhoto, expect.objectContaining({signal: expect.any(AbortSignal)}));
  expect(createBook).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Photo title'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(createBook).toHaveBeenCalledTimes(1));
  expect(input).toBeDisabled();
  fireEvent.drop(zone, {dataTransfer: {files: [nativePhoto]}});
  expect(identifyBook).toHaveBeenCalledTimes(2);
  finishSave(saved);
  await screen.findByRole('status');
});

test('touch presentation offers a camera action while retaining desktop drop and native capture', () => {
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const camera = screen.getByText('Take a cover photo');
  expect(camera.closest('.cover-dropzone-copy')).toHaveClass('cover-dropzone-touch');
  expect(screen.getByText('Drop a cover photo here').closest('.cover-dropzone-copy')).toHaveClass('cover-dropzone-desktop');
  expect(screen.getByLabelText('Cover photo')).toHaveAttribute('capture', 'environment');
  expect(screen.getByLabelText('Cover photo')).toHaveAttribute('accept', 'image/jpeg,image/png');
});

test('unreadable covers keep manual entry usable without exposing server details', async () => {
  identifyBook.mockRejectedValue(new Error('private process details'));
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [new File(['x'], 'cover.png', {type: 'image/png'})]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter the details manually');
  expect(screen.queryByText(/private process/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Manual fallback'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(createBook).toHaveBeenCalled());
});

test('cancel aborts identification and late replies cannot restore discarded data', async () => {
  let finish;
  identifyBook.mockReturnValue(new Promise(resolve => {finish = resolve;}));
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [new File(['x'], 'cover.png', {type: 'image/png'})]}});
  fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(identifyBook.mock.calls[0][2].signal.aborted).toBe(true);
  finish({title: 'Discarded', author: null, text: ''});
  open();
  expect(screen.getByLabelText('Title')).toHaveValue('');
  expect(createBook).not.toHaveBeenCalled();
});
