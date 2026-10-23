import React, {useEffect, useRef} from 'react';
import BookCover from './BookCover.jsx';
import PageCapture from './PageCapture.jsx';
import QuoteReview from './QuoteReview.jsx';
import './book-view.css';

export default function BookView({book, coverUrl, getToken, onBack}) {
  const heading = useRef(null);
  useEffect(() => {heading.current?.focus();}, []);
  return <article className="book-view">
    <button type="button" className="back-button" onClick={onBack}>Back to library</button>
    <header className="book-view-head">
      <div className="book-view-cover"><BookCover book={book} url={coverUrl || undefined} pending={coverUrl === undefined} /></div>
      <div>
        <h1 ref={heading} tabIndex={-1}>{book.title}</h1>
        <p className="book-author">{book.author || 'Author not provided'}</p>
      </div>
    </header>
    <PageCapture getToken={getToken} bookId={book.id} />
    <QuoteReview getToken={getToken} bookId={book.id} />
  </article>;
}
