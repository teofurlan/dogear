import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, test, vi} from 'vitest';
import PageCapture from './PageCapture.jsx';
import {listPages, uploadPage} from './pages.js';
import {prepareImage} from './downscale.js';

vi.mock('./pages.js', () => ({listPages: vi.fn(), uploadPage: vi.fn()}));
vi.mock('./downscale.js', () => ({prepareImage: vi.fn()}));
const getToken = async () => 'tok';
const id = '000000000000000000000001';
const file = name => new File(['raw'], name, {type: 'image/jpeg'});

beforeEach(() => {
  listPages.mockReset().mockResolvedValue([]);
  uploadPage.mockReset().mockResolvedValue({id: 'p', status: 'pending'});
  prepareImage.mockReset().mockImplementation(async f => new Blob(['small-' + f.name], {type: 'image/jpeg'}));
});

test('the capture input is camera-first, multiple and image-only', async () => {
  render(<PageCapture getToken={getToken} bookId={id} />);
  const input = screen.getByLabelText(/Photograph a page/);
  expect(input).toHaveAttribute('type', 'file');
  expect(input).toHaveAttribute('accept', 'image/*');
  expect(input).toHaveAttribute('capture', 'environment');
  expect(input).toHaveAttribute('multiple');
  await waitFor(() => expect(listPages).toHaveBeenCalled());
});

test('files are downscaled and uploaded one at a time with progress', async () => {
  let release;
  uploadPage.mockImplementationOnce(() => new Promise(resolve => {release = () => resolve({id: 'p1'});}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Photograph a page/), [file('a.jpg'), file('b.jpg')]);
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

test('an oversized photo shows a clear message and the next photo still uploads', async () => {
  uploadPage.mockRejectedValueOnce(Object.assign(new Error('x'), {status: 413}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Photograph a page/), [file('a.jpg'), file('b.jpg')]);
  expect(await screen.findByText(/a\.jpg: .*too large/i)).toBeInTheDocument();
  expect(await screen.findByText('b.jpg: uploaded')).toBeInTheDocument();
});

test.each([[415, /JPEG or PNG/], [422, /could not be read/], [503, /storage is not available/]])('status %i has a clear message', async (status, pattern) => {
  uploadPage.mockRejectedValueOnce(Object.assign(new Error('x'), {status}));
  render(<PageCapture getToken={getToken} bookId={id} />);
  await userEvent.upload(screen.getByLabelText(/Photograph a page/), file('a.jpg'));
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
  await userEvent.upload(screen.getByLabelText(/Photograph a page/), file('a.jpg'));
  expect(await screen.findByText("1 page waiting for tonight's run")).toBeInTheDocument();
});
