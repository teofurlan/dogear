// Public Open Library catalog selections; these are never account records.
export const exampleBooks = [
  {title: 'Dune', author: 'Frank Herbert', coverId: 11481354},
  {title: 'Dune Messiah', author: 'Frank Herbert', coverId: 980253},
  {title: 'Children of Dune', author: 'Frank Herbert', coverId: 6976407},
  {title: 'A Game of Thrones', author: 'George R. R. Martin', coverId: 9269962},
  {title: 'A Clash of Kings', author: 'George R. R. Martin', coverId: 8231751},
  {title: 'A Storm of Swords', author: 'George R. R. Martin', coverId: 15124196},
  {title: 'Twenty Thousand Leagues Under the Sea', author: 'Jules Verne', coverId: 10817535},
  {title: 'Journey to the Center of the Earth', author: 'Jules Verne', coverId: 8359565},
  {title: 'Around the World in Eighty Days', author: 'Jules Verne', coverId: 11531296},
  {title: '1984', author: 'George Orwell', coverId: 9267242},
  {title: 'Animal Farm', author: 'George Orwell', coverId: 11261770},
  {title: 'Homage to Catalonia', author: 'George Orwell', coverId: 7282177}
];

export function chooseExampleBooks(random = Math.random) {
  const shuffled = [...exampleBooks];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.slice(0, 4);
}
