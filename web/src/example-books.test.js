import {expect, test} from 'vitest';
import {exampleBooks, chooseExampleBooks} from './example-books.js';

test('catalog includes the requested sagas and authors with unique public cover IDs', () => {
  expect(exampleBooks).toHaveLength(12);
  expect(new Set(exampleBooks.map(book => book.coverId)).size).toBe(12);
  expect(exampleBooks.map(book => book.author)).toEqual(expect.arrayContaining([
    'Frank Herbert', 'George R. R. Martin', 'Jules Verne', 'George Orwell'
  ]));
  expect(exampleBooks.map(book => book.title)).toEqual(expect.arrayContaining(['Dune', 'A Game of Thrones', '1984']));
});

test('random sampling returns four distinct covers without changing the catalog', () => {
  const original = structuredClone(exampleBooks);
  const first = chooseExampleBooks(() => 0);
  const second = chooseExampleBooks(() => 0.999);
  expect(first).toHaveLength(4);
  expect(new Set(first.map(book => book.coverId)).size).toBe(4);
  expect(first.every(book => exampleBooks.includes(book))).toBe(true);
  expect(first).not.toEqual(second);
  expect(exampleBooks).toEqual(original);
});
