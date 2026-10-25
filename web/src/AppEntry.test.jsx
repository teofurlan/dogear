import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {expect, test, vi} from 'vitest';
import App from './App.jsx';
import {listBooks} from './books.js';
import {createBook} from './book-entry.js';
vi.mock('@auth0/auth0-react', () => ({useAuth0: () => ({isAuthenticated: true, user: {sub: 'synthetic-reader'}, getAccessTokenSilently: token})}));
const token = vi.fn();
vi.mock('./books.js', () => ({PAGE_SIZE: 24, listBooks: vi.fn(), getBook: vi.fn()}));
vi.mock('./covers.js', () => ({loadCovers: vi.fn()}));
vi.mock('./book-entry.js', () => ({createBook: vi.fn(), identifyBook: vi.fn()}));

test('a confirmed book appears immediately without moving the existing pagination cursor', async () => {
  const first = Array.from({length:24}, (_,i) => ({id: String(i + 1).padStart(24,'0'), title: `Synthetic ${i}`, author:null}));
  listBooks.mockResolvedValueOnce(first).mockResolvedValueOnce([]);
  createBook.mockResolvedValue({id:'000000000000000000000099', title:'Just saved', author:null});
  render(<App />);
  await screen.findByRole('button', {name:'Load more books'});
  fireEvent.click(screen.getByRole('button', {name:'Add book'}));
  fireEvent.change(screen.getByLabelText('Title'), {target: {value:'Just saved'}});
  fireEvent.click(screen.getByRole('button', {name:'Save book'}));
  expect(await screen.findByRole('heading', {name:'Just saved'})).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name:'Load more books'}));
  await waitFor(() => expect(listBooks).toHaveBeenCalledTimes(2));
  expect(listBooks.mock.calls[1][1].after).toBe(first.at(-1).id);
  expect(screen.getByRole('heading', {name:'Just saved'})).toBeVisible();
}, 15000);
