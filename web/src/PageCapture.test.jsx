import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import PageCapture from './PageCapture.jsx';
import {listPages, uploadPage} from './pages.js';
import {prepareImage} from './downscale.js';

vi.mock('./pages.js', () => ({listPages: vi.fn(), uploadPage: vi.fn()}));
vi.mock('./downscale.js', () => ({prepareImage: vi.fn(), ImageDecodeError: class ImageDecodeError extends Error {}}));
const getToken = async () => 'tok';
const id = '000000000000000000000001';
const file = name => new File(['raw'], name, {type: 'image/jpeg'});

let originalMediaDevices;
let originalCreateObjectURL;
let originalRevokeObjectURL;

beforeEach(() => {
  listPages.mockReset().mockResolvedValue([]);
  uploadPage.mockReset().mockResolvedValue({id: 'p', status: 'pending'});
  prepareImage.mockReset().mockImplementation(async f => new Blob(['small-' + f.name], {type: 'image/jpeg'}));

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

test('camera is the primary action while gallery selection is secondary, multiple and image-only', async () => {
  render(<PageCapture getToken={getToken} bookId={id} />);
  expect(screen.getByRole('button', {name: /Photograph a page/i})).toBeInTheDocument();
  const input = screen.getByLabelText(/Choose from gallery/i);
  expect(input).toHaveAttribute('type', 'file');
  expect(input).toHaveAttribute('accept', 'image/*');
  expect(input).not.toHaveAttribute('capture');
  expect(input).toHaveAttribute('multiple');
  await waitFor(() => expect(listPages).toHaveBeenCalled());
});

test('files from gallery are downscaled and uploaded one at a time with progress', async () => {
  let release;
  uploadPage.mockImplementationOnce(() => new Promise(resolve => {release = () => resolve({id: 'p1'});}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.jpg'), file('b.jpg')]);
  expect(await screen.findByText('a.jpg: uploading…')).toBeInTheDocument();
  expect(screen.getByText('b.jpg: waiting')).toBeInTheDocument();
  expect(uploadPage).toHaveBeenCalledTimes(1);
  release();
  expect(await screen.findByText('b.jpg: uploaded')).toBeInTheDocument();
  expect(uploadPage).toHaveBeenCalledTimes(2);
  expect(screen.getByText('a.jpg: uploaded')).toBeInTheDocument();
  const [, bookId, blob] = uploadPage.mock.calls[0];
  expect(bookId).toBe(id);
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe('image/jpeg');
});

test('opening camera, capturing photo and using it uploads one page', async () => {
  render(<PageCapture getToken={getToken} bookId={id} />);
  fireEvent.click(screen.getByRole('button', {name: /Photograph a page/i}));

  expect(await screen.findByRole('dialog', {name: 'Camera'})).toBeInTheDocument();
  expect(document.querySelector('.camera-guide-page')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Take photo'));
  const useBtn = await screen.findByRole('button', {name: 'Use photo'});
  fireEvent.click(useBtn);

  expect(await screen.findByText('page.jpg: uploaded')).toBeInTheDocument();
  expect(uploadPage).toHaveBeenCalledTimes(1);
  const [, bookId, blob] = uploadPage.mock.calls[0];
  expect(bookId).toBe(id);
  expect(blob).toBeInstanceOf(Blob);
  expect(screen.queryByRole('dialog', {name: 'Camera'})).not.toBeInTheDocument();

  // Reader can open camera again for the next page
  fireEvent.click(screen.getByRole('button', {name: /Photograph a page/i}));
  expect(await screen.findByRole('dialog', {name: 'Camera'})).toBeInTheDocument();
});

test('camera permission denied displays fallback message and leaves gallery available', async () => {
  const notAllowed = new Error('Permission denied');
  notAllowed.name = 'NotAllowedError';
  navigator.mediaDevices.getUserMedia.mockRejectedValue(notAllowed);

  render(<PageCapture getToken={getToken} bookId={id} />);
  fireEvent.click(screen.getByRole('button', {name: /Photograph a page/i}));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Camera permission was denied. Choose a photo from the gallery instead.'
  );
  expect(screen.queryByRole('dialog', {name: 'Camera'})).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Choose from gallery/i)).not.toBeDisabled();
});

test('an oversized photo shows a clear message and the next photo still uploads', async () => {
  uploadPage.mockRejectedValueOnce(Object.assign(new Error('x'), {status: 413}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.jpg'), file('b.jpg')]);
  expect(await screen.findByText(/a\.jpg: .*too large/i)).toBeInTheDocument();
  expect(await screen.findByText('b.jpg: uploaded')).toBeInTheDocument();
});

test('an undecodable photo shows a format message and the next photo still uploads', async () => {
  prepareImage.mockRejectedValueOnce(new Error('cannot decode'));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.heic'), file('b.jpg')]);
  expect(await screen.findByText(/a\.heic: This photo format could not be read on this device\. Try a JPEG or PNG, or take the photo with the camera\./)).toBeInTheDocument();
  expect(await screen.findByText('b.jpg: uploaded')).toBeInTheDocument();
});

test('a connection error shows the connection message and the next photo still uploads', async () => {
  uploadPage.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.jpg'), file('b.jpg')]);
  expect(await screen.findByText(/a\.jpg: The upload failed\. Check your connection and try again\./)).toBeInTheDocument();
  expect(await screen.findByText('b.jpg: uploaded')).toBeInTheDocument();
});

test.each([[415, /JPEG or PNG/], [422, /could not be read/], [503, /storage is not available/]])('status %i has a clear message', async (status, pattern) => {
  uploadPage.mockRejectedValueOnce(Object.assign(new Error('x'), {status}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), file('a.jpg'));
  expect(await screen.findByText(pattern)).toBeInTheDocument();
});

test('pending and processing pages count as waiting for tonight', async () => {
  listPages.mockResolvedValue([{status: 'pending'}, {status: 'processing'}, {status: 'processed'}, {status: 'failed'}]);
  render(<PageCapture getToken={getToken} bookId={id} />);
  expect(await screen.findByText("2 pages waiting for tonight's run")).toBeInTheDocument();
});

test('no pages yet shows an empty state', async () => {
  render(<PageCapture getToken={getToken} bookId={id} />);
  expect(await screen.findByText(/No pages yet/)).toBeInTheDocument();
});

test('the waiting count refreshes after an upload', async () => {
  listPages.mockResolvedValueOnce([]).mockResolvedValue([{status: 'pending'}]);
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), file('a.jpg'));
  expect(await screen.findByText("1 page waiting for tonight's run")).toBeInTheDocument();
});

test('pages already read by the night run are not reported as no pages', async () => {
  listPages.mockResolvedValue([{status: 'processed'}, {status: 'processed'}]);
  render(<PageCapture getToken={getToken} bookId={id} />);
  expect(await screen.findByText('All 2 photographed pages have been read. Their quotes are in the review below.')).toBeInTheDocument();
  expect(screen.queryByText(/No pages yet/)).toBeNull();
});

test('a 401 during upload notifies onSessionExpired and halts further uploads', async () => {
  const onSessionExpired = vi.fn();
  uploadPage.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), {status: 401}));
  render(<PageCapture getToken={getToken} bookId={id} onSessionExpired={onSessionExpired} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.jpg'), file('b.jpg')]);
  expect(await screen.findByText(/a\.jpg: Your session ended\. Sign in again before uploading\./)).toBeInTheDocument();
  expect(onSessionExpired).toHaveBeenCalledTimes(1);
  expect(uploadPage).toHaveBeenCalledTimes(1);
});

test('a 401 when fetching page list notifies onSessionExpired', async () => {
  const onSessionExpired = vi.fn();
  listPages.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), {status: 401}));
  render(<PageCapture getToken={getToken} bookId={id} onSessionExpired={onSessionExpired} />);
  await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
});

test('shows Uploading N of M progress summary and fires onUploadingChange', async () => {
  let releaseA, releaseB;
  uploadPage
    .mockImplementationOnce(() => new Promise(resolve => { releaseA = () => resolve({id: 'p1'}); }))
    .mockImplementationOnce(() => new Promise(resolve => { releaseB = () => resolve({id: 'p2'}); }));
  const onUploadingChange = vi.fn();
  listPages.mockResolvedValueOnce([]).mockResolvedValue([{status: 'pending'}, {status: 'pending'}]);

  render(<PageCapture getToken={getToken} bookId={id} onUploadingChange={onUploadingChange} />);
  await userEvent.upload(screen.getByLabelText(/Choose from gallery/i), [file('a.jpg'), file('b.jpg')]);

  expect(onUploadingChange).toHaveBeenCalledWith(true);
  expect(await screen.findByText('Uploading 1 of 2…')).toBeInTheDocument();

  releaseA();
  expect(await screen.findByText('Uploading 2 of 2…')).toBeInTheDocument();

  releaseB();
  await waitFor(() => expect(screen.queryByText(/Uploading/)).not.toBeInTheDocument());
  expect(onUploadingChange).toHaveBeenLastCalledWith(false);
  expect(await screen.findByText("2 pages waiting for tonight's run")).toBeInTheDocument();
});
