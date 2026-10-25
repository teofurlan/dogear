import React from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, test, vi} from 'vitest';
import BookView from './BookView.jsx';

const auth = vi.hoisted(() => ({
  isLoading: false, isAuthenticated: true, user: {sub: 'reader-a'}, error: null,
  loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn()
}));
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => auth}));

vi.mock('./PageCapture.jsx', () => ({default: ({bookId, onSessionExpired}) => <div>capture {bookId} <button onClick={onSessionExpired}>expire capture</button></div>}));
vi.mock('./QuoteReview.jsx', () => ({default: ({bookId, onSessionExpired}) => <div>review {bookId} <button onClick={onSessionExpired}>expire quote</button></div>}));
const book = {id: '000000000000000000000001', title: 'A quiet afternoon', author: 'Ada Reed'};

beforeEach(() => {
  auth.loginWithRedirect.mockReset();
});

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

test('shows the provided cover URL in BookCover', () => {
  const url = 'blob:http://localhost/stored-cover';
  render(<BookView book={book} coverUrl={url} getToken={async () => 't'} onBack={() => {}} />);
  const image = screen.getByRole('img', {name: `Representative cover of ${book.title}`});
  expect(image).toHaveAttribute('src', url);
});

test('session expired notification appears on 401 and sign-in button triggers Auth0 loginWithRedirect', async () => {
  render(<BookView book={book} coverUrl={null} getToken={async () => 't'} onBack={() => {}} />);
  expect(screen.queryByText(/Your session ended\. Sign in again/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'expire capture'}));
  expect(screen.getByText(/Your session ended\. Sign in again to continue\./)).toBeInTheDocument();
  const signInBtn = screen.getByRole('button', {name: 'Sign in again'});
  expect(signInBtn).toHaveClass('retry-button');
  await userEvent.click(signInBtn);
  expect(auth.loginWithRedirect).toHaveBeenCalled();
});
