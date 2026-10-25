import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import BookCover from './BookCover.jsx';
import PageCapture from './PageCapture.jsx';
import QuoteReview from './QuoteReview.jsx';
import {findCover} from './covers.js';
import './book-view.css';

export default function BookView({book, coverUrl, getToken, onBack}) {
  const {loginWithRedirect} = useAuth0();
  const heading = useRef(null);
  const [localCover, setLocalCover] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const onSessionExpired = useCallback(() => setSessionExpired(true), []);
  useEffect(() => {heading.current?.focus();}, []);

  async function signIn() {
    try {
      await loginWithRedirect();
    } catch {}
  }

  useEffect(() => {
    if (coverUrl !== undefined || !book?.id || !getToken) return undefined;
    const controller = new AbortController();
    let objectUrl = null;
    findCover(book, controller.signal, {getToken}).then(url => {
      if (controller.signal.aborted) return;
      if (url?.startsWith('blob:')) objectUrl = url;
      setLocalCover(url);
    }).catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [book, coverUrl, getToken]);

  const activeCover = coverUrl !== undefined ? coverUrl : localCover;
  const isPending = coverUrl === undefined && localCover === null && Boolean(book?.has_cover_photo);

  return <article className="book-view">
    <button type="button" className="back-button" onClick={onBack}>Back to library</button>
    {sessionExpired ? <section className="feedback" role="status">
      <p>Your session ended. Sign in again to continue.</p>
      <button type="button" className="retry-button" onClick={signIn}>Sign in again</button>
    </section> : null}
    <header className="book-view-head">
      <div className="book-view-cover"><BookCover book={book} url={activeCover || undefined} pending={isPending} /></div>
      <div>
        <h1 ref={heading} tabIndex={-1}>{book.title}</h1>
        <p className="book-author">{book.author || 'Author not provided'}</p>
      </div>
    </header>
    <PageCapture getToken={getToken} bookId={book.id} onSessionExpired={onSessionExpired} />
    <QuoteReview getToken={getToken} bookId={book.id} onSessionExpired={onSessionExpired} />
  </article>;
}
