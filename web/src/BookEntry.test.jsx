import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import BookEntry from './BookEntry.jsx';
import {createBook, identifyBook} from './book-entry.js';
import {uploadCover} from './books.js';

vi.mock('./book-entry.js', () => ({createBook: vi.fn(), identifyBook: vi.fn()}));
vi.mock('./books.js', () => ({uploadCover: vi.fn()}));
const saved = {id: '000000000000000000000099', title: 'Synthetic book', author: null};

let originalMediaDevices;
let originalCreateObjectURL;
let originalRevokeObjectURL;

beforeEach(() => {
  createBook.mockReset().mockResolvedValue(saved);
  identifyBook.mockReset();
  uploadCover.mockReset().mockResolvedValue({...saved, has_cover_photo: true});

  originalMediaDevices = navigator.mediaDevices;
  originalCreateObjectURL = globalThis.URL.createObjectURL;
  originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

  const mockTrack = {kind: 'video', stop: vi.fn(), enabled: true};
  const mockStream = {getTracks: vi.fn(() => [mockTrack]), getVideoTracks: vi.fn(() => [mockTrack])};

  Object.defineProperty(navigator, 'mediaDevices', {
    value: {getUserMedia: vi.fn().mockResolvedValue(mockStream)},
    configurable: true,
    writable: true,
  });

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({drawImage: vi.fn()});
  HTMLCanvasElement.prototype.toBlob = vi.fn(function(cb, type) {
    cb(new Blob(['fake-jpg'], {type: type || 'image/jpeg'}));
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', {configurable: true, get: () => 1920});
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoHeight', {configurable: true, get: () => 1080});
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: originalMediaDevices,
    configurable: true,
    writable: true,
  });
  globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
});

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
  expect(input).not.toHaveAttribute('capture');
  expect(input).toHaveAttribute('aria-describedby', 'cover-help');
  const nativePhoto = new File(['native'], 'native.jpg', {type: 'image/jpeg'});
  fireEvent.change(input, {target: {files: [nativePhoto]}});
  expect(await screen.findByDisplayValue('Photo title')).toBeVisible();
  expect(identifyBook).toHaveBeenCalledWith(expect.any(Function), nativePhoto, expect.objectContaining({signal: expect.any(AbortSignal)}));
  expect(createBook).not.toHaveBeenCalled();

  const zone = screen.getByRole('group', {name: 'Cover photo options'});
  const droppedPhoto = new File(['dropped'], 'dropped.png', {type: 'image/png'});
  const dropTarget = zone.querySelector('.cover-dropzone');
  fireEvent.dragOver(dropTarget, {dataTransfer: {files: [droppedPhoto]}});
  expect(dropTarget).toHaveClass('is-drag-over');
  fireEvent.drop(dropTarget, {dataTransfer: {files: [droppedPhoto]}});
  expect(await screen.findByDisplayValue('Photo title')).toBeVisible();
  expect(identifyBook).toHaveBeenLastCalledWith(expect.any(Function), droppedPhoto, expect.objectContaining({signal: expect.any(AbortSignal)}));
  expect(createBook).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Photo title'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(createBook).toHaveBeenCalledTimes(1));
  expect(input).toBeDisabled();
  fireEvent.drop(dropTarget, {dataTransfer: {files: [nativePhoto]}});
  expect(identifyBook).toHaveBeenCalledTimes(2);
  finishSave(saved);
  await screen.findByRole('status');
});

test('camera is the primary action while gallery selection is secondary without capture attribute', () => {
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const cameraBtn = screen.getByRole('button', {name: 'Take cover photo'});
  expect(cameraBtn).toBeInTheDocument();
  expect(screen.getByText('Choose from gallery')).toBeInTheDocument();
  const input = screen.getByLabelText('Cover photo');
  expect(input).not.toHaveAttribute('capture');
  expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
});

test('opening camera, capturing photo and using it passes File to identifyBook', async () => {
  identifyBook.mockResolvedValue({title: 'Camera Book', author: 'Camera Author', text: 'Scanned text'});
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();

  fireEvent.click(screen.getByRole('button', {name: 'Take cover photo'}));
  expect(await screen.findByRole('dialog', {name: 'Camera'})).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Take photo'));
  const useBtn = await screen.findByRole('button', {name: 'Use photo'});
  fireEvent.click(useBtn);

  expect(await screen.findByDisplayValue('Camera Book')).toBeVisible();
  expect(screen.getByDisplayValue('Camera Author')).toBeVisible();
  expect(identifyBook).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({name: 'cover.jpg', type: 'image/jpeg'}),
    expect.anything()
  );
  expect(screen.queryByRole('dialog', {name: 'Camera'})).not.toBeInTheDocument();
});

test('camera permission denied displays fallback message and leaves gallery available', async () => {
  const notAllowed = new Error('Permission denied');
  notAllowed.name = 'NotAllowedError';
  navigator.mediaDevices.getUserMedia.mockRejectedValue(notAllowed);

  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  fireEvent.click(screen.getByRole('button', {name: 'Take cover photo'}));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Camera permission was denied. Choose a photo from the gallery instead.'
  );
  expect(screen.queryByRole('dialog', {name: 'Camera'})).not.toBeInTheDocument();
  expect(screen.getByLabelText('Cover photo')).not.toBeDisabled();
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

test('saving a book with a cover photo uploads the cover to the server', async () => {
  const receive = vi.fn();
  identifyBook.mockResolvedValue({title: 'Photo Book', author: null, text: ''});
  uploadCover.mockResolvedValue({...saved, title: 'Photo Book', has_cover_photo: true});
  render(<BookEntry getToken={vi.fn()} onCreated={receive} />); open();

  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});
  expect(await screen.findByDisplayValue('Photo Book')).toBeVisible();

  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(uploadCover).toHaveBeenCalledWith(expect.any(Function), saved.id, photo, expect.anything()));
  expect(receive).toHaveBeenCalledWith({...saved, title: 'Photo Book', has_cover_photo: true});
});

test('keeps the book and reports when the cover photo upload fails', async () => {
  const receive = vi.fn();
  identifyBook.mockResolvedValue({title: 'Photo Book', author: null, text: ''});
  uploadCover.mockRejectedValue(new Error('R2 unavailable'));
  render(<BookEntry getToken={vi.fn()} onCreated={receive} />); open();

  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});
  expect(await screen.findByDisplayValue('Photo Book')).toBeVisible();

  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(receive).toHaveBeenCalledWith(saved));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Saved “Synthetic book” to your library, but its cover photo could not be stored.')).toBeInTheDocument();
});

test('keeps the created book unchanged when the upload response is not a book', async () => {
  const receive = vi.fn();
  identifyBook.mockResolvedValue({title: 'Photo Book', author: null, text: ''});
  uploadCover.mockResolvedValue({});
  render(<BookEntry getToken={vi.fn()} onCreated={receive} />); open();
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [new File(['image'], 'cover.png', {type: 'image/png'})]}});
  expect(await screen.findByDisplayValue('Photo Book')).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(receive).toHaveBeenCalledWith(saved));
  expect(screen.getByText('Saved “Synthetic book” to your library.')).toBeInTheDocument();
});

test('manual entry never calls uploadCover', async () => {
  const receive = vi.fn();
  render(<BookEntry getToken={vi.fn()} onCreated={receive} />); open();
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Manual Only'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save book'}));
  await waitFor(() => expect(receive).toHaveBeenCalled());
  expect(uploadCover).not.toHaveBeenCalled();
});

test('save is marked busy only while the book is being saved', async () => {
  createBook.mockReturnValue(new Promise(() => {}));
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const save = screen.getByRole('button', {name: 'Save book'});
  expect(save).toBeDisabled();
  expect(save).not.toHaveAttribute('aria-busy', 'true');
  fireEvent.change(screen.getByLabelText('Title'), {target: {value: 'Synthetic book'}});
  fireEvent.click(save);
  expect(await screen.findByRole('button', {name: 'Saving book…'})).toHaveAttribute('aria-busy', 'true');
});

test('a photo dropped while a cover is being read is ignored', async () => {
  identifyBook.mockReturnValue(new Promise(() => {}));
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [new File(['a'], 'a.jpg', {type: 'image/jpeg'})]}});
  expect(await screen.findByText(/Reading cover/)).toBeInTheDocument();
  const dropTarget = screen.getByRole('group', {name: 'Cover photo options'}).querySelector('.cover-dropzone');
  fireEvent.drop(dropTarget, {dataTransfer: {files: [new File(['b'], 'b.png', {type: 'image/png'})]}});
  expect(identifyBook).toHaveBeenCalledTimes(1);
});

test('detected text preview shows one box per line with role classes and percentage coordinates', async () => {
  const sampleLines = [
    {text: 'The Title', box: [0.1, 0.2, 0.7, 0.08], role: 'title'},
    {text: 'The Author', box: [0.15, 0.35, 0.5, 0.05], role: 'author'},
    {text: 'Publisher Notes', box: [0.2, 0.8, 0.4, 0.03], role: null},
  ];
  identifyBook.mockResolvedValue({
    title: 'The Title',
    author: 'The Author',
    text: 'The Title\nThe Author\nPublisher Notes',
    lines: sampleLines,
  });
  const {container} = render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});

  const img = await screen.findByAltText('Cover photo with detected text highlighted');
  expect(img).toBeInTheDocument();
  expect(img).toHaveAttribute('src', 'blob:mock-url');
  expect(screen.getByText('Highlighted: text the photo reading found. Darker: used for the title and author.')).toBeInTheDocument();

  const boxesContainer = container.querySelector('.cover-ocr-boxes');
  expect(boxesContainer).toHaveAttribute('aria-hidden', 'true');

  const boxes = container.querySelectorAll('.ocr-box');
  expect(boxes).toHaveLength(3);

  expect(boxes[0]).toHaveClass('title');
  expect(boxes[0].style.left).toBe('10%');
  expect(boxes[0].style.top).toBe('20%');
  expect(boxes[0].style.width).toBe('70%');
  expect(boxes[0].style.height).toBe('8%');

  expect(boxes[1]).toHaveClass('author');
  expect(boxes[1].style.left).toBe('15%');
  expect(boxes[1].style.top).toBe('35%');
  expect(boxes[1].style.width).toBe('50%');
  expect(boxes[1].style.height).toBe('5%');

  expect(boxes[2]).not.toHaveClass('title');
  expect(boxes[2]).not.toHaveClass('author');
  expect(boxes[2].style.left).toBe('20%');
  expect(boxes[2].style.top).toBe('80%');
  expect(boxes[2].style.width).toBe('40%');
  expect(boxes[2].style.height).toBe('3%');

  const details = container.querySelector('details');
  expect(details).toBeInTheDocument();
  expect(details.open).toBe(false);
});

test('object URL is revoked when form closes, photo changes, and component unmounts', async () => {
  const sampleLines = [{text: 'Book', box: [0.1, 0.1, 0.8, 0.1], role: 'title'}];
  identifyBook.mockResolvedValue({title: 'Book', author: null, text: 'Book', lines: sampleLines});

  const {unmount} = render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const photo1 = new File(['image1'], 'cover1.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo1]}});
  await screen.findByAltText('Cover photo with detected text highlighted');
  expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);

  // Changing photo revokes the previous URL
  const photo2 = new File(['image2'], 'cover2.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo2]}});
  await waitFor(() => expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'));

  // Closing the form revokes URL
  globalThis.URL.revokeObjectURL.mockClear();
  fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

  // Reopening and unmounting revokes URL
  globalThis.URL.revokeObjectURL.mockClear();
  open();
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo1]}});
  await screen.findByAltText('Cover photo with detected text highlighted');
  unmount();
  expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
});

test('no preview shown and preview cleaned up when reading fails', async () => {
  identifyBook.mockRejectedValue(new Error('OCR failed'));
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByAltText('Cover photo with detected text highlighted')).not.toBeInTheDocument();
  expect(screen.queryByText(/Highlighted: text the photo reading found/)).not.toBeInTheDocument();
});

test('no preview shown if lines is missing or empty', async () => {
  identifyBook.mockResolvedValue({title: 'Book Only', author: null, text: 'Book Only', lines: []});
  render(<BookEntry getToken={vi.fn()} onCreated={vi.fn()} />); open();
  const photo = new File(['image'], 'cover.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Cover photo'), {target: {files: [photo]}});
  expect(await screen.findByDisplayValue('Book Only')).toBeVisible();
  expect(screen.queryByAltText('Cover photo with detected text highlighted')).not.toBeInTheDocument();
  expect(screen.getByText('Book Only')).toBeInTheDocument();
});
