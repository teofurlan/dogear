import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {expect, test} from 'vitest';
import BookCover from './BookCover.jsx';

const book = {title: 'A quiet afternoon'};
const url = 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false';

test('shows a catalog loader without overlapping title until the image loads', () => {
  const {container} = render(<BookCover book={book} url={url} />);
  const image = screen.getByRole('img', {name: `Representative cover of ${book.title}`});
  expect(screen.getByRole('progressbar', {name: `Loading cover of ${book.title}`})).toBeVisible();
  expect(screen.queryByText(book.title)).not.toBeInTheDocument();
  expect(screen.queryByText('Loading cover…')).not.toBeInTheDocument();
  expect(screen.queryByText('No cover available')).not.toBeInTheDocument();
  expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
  expect(image).toHaveAttribute('width', '200');
  expect(image).toHaveAttribute('height', '300');
  fireEvent.load(image);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(container.firstChild).toHaveAttribute('aria-busy', 'false');
});

test('uses the neutral fallback after an image error', () => {
  render(<BookCover book={book} url={url} />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('No cover available')).toBeVisible();
});

test('URL replacement resets loading and error state for the new image', () => {
  const view = render(<BookCover book={book} url={url} />);
  fireEvent.error(screen.getByRole('img'));
  const nextUrl = 'https://covers.openlibrary.org/b/id/456-M.jpg?default=false';
  view.rerender(<BookCover book={book} url={nextUrl} />);
  expect(screen.getByRole('progressbar')).toBeVisible();
  fireEvent.load(screen.getByRole('img'));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('recognizes an already-cached successful image', () => {
  const {container} = render(<BookCover book={book} url={url} />);
  const image = screen.getByRole('img');
  Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 200}});
  fireEvent.load(image);
  expect(container.firstChild).toHaveAttribute('aria-busy', 'false');
});
