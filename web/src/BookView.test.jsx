import React from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect, test, vi} from 'vitest';
import BookView from './BookView.jsx';

vi.mock('./PageCapture.jsx', () => ({default: ({bookId}) => <div>capture {bookId}</div>}));
vi.mock('./QuoteReview.jsx', () => ({default: ({bookId}) => <div>review {bookId}</div>}));
const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};

test('shows the book, its capture and review sections, and focuses the heading', () => {
  render(<BookView book={book} coverUrl={null} getToken={async () => 't'} onBack={() => {}} />);
  const heading = screen.getByRole('heading', {level: 1, name: 'A quiet afternoon'});
  expect(heading).toHaveFocus();
  expect(screen.getByText('Ada Reed')).toBeInTheDocument();
  expect(screen.getByText(`capture ${book.id}`)).toBeInTheDocument();
  expect(screen.getByText(`review ${book.id}`)).toBeInTheDocument();
});

test('the back button returns to the library', async () => {
  const onBack = vi.fn();
  render(<BookView book={book} coverUrl={null} getToken={async () => 't'} onBack={onBack} />);
  await userEvent.click(screen.getByRole('button', {name: 'Back to library'}));
  expect(onBack).toHaveBeenCalled();
});
